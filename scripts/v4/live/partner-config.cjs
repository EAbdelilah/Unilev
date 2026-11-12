// Phase-4 partner parameter extraction: reads the LIVE Base deployment config
// (price feed registry, staleness ceilings, sequencer feed, pool keys) so the
// integration checklist quotes on-chain facts, not documentation guesses.
const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');
// Addresses come from `.env` via common.cjs so a redeploy only requires editing
// `.env`; hardcoding them here is how this probe kept reporting the retired
// 2026-10-20 stack after the Base redeploy.
const { RPC, PRICE_FEED, HOOK, ROUTER, USDC, WETH } = require('./common.cjs');

const PF_ABI = [
  'function priceFeeds(address) view returns (address)',
  'function feedDecimals(address) view returns (uint8)',
  'function MAX_ORACLE_AGE() view returns (uint256)',
  'function maxOracleAgeSec(address) view returns (uint256)',
  'function sequencerUptimeFeed() view returns (address)',
  'function requireBounds() view returns (bool)',
  'function minAnswers(address) view returns (int256)',
  'function maxAnswers(address) view returns (int256)',
  'function getTwapPrice(address) view returns (uint256)',
  'function getAmountInUsd(address,uint256) view returns (uint256)',
  'function owner() view returns (address)',
];
const AGG_ABI = [
  'function decimals() view returns (uint8)',
  'function description() view returns (string)',
  'function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)',
];
const SEQ_ABI = [
  'function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)',
  'function description() view returns (string)',
];
const ROUTER_ABI = [
  'function allowedAggregators(address) view returns (bool)',
  'function executorWhitelist(address) view returns (bool)',
  'function settlementWhitelist(address) view returns (bool)',
  'function owner() view returns (address)',
  'function DOMAIN_SEPARATOR() view returns (bytes32)',
];
const HOOK_ABI = [
  'function owner() view returns (address)',
  'function isAuthorizedPool(bytes32) view returns (bool)',
  'function standardPoolKeys(bytes32) view returns (address,address,uint24,int24,address)',
  'function reserveFactor() view returns (uint256)',
  'function defaultMaxLeverage() view returns (uint256)',
  'function maxPriceSwingBps() view returns (uint256)',
  'function liquidatorIncentiveBps() view returns (uint256)',
  'function insuranceCoverageBps() view returns (uint256)',
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function retry(fn, label, tries = 6) {
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i === tries - 1) throw new Error(`${label}: ${e.shortMessage || e.message}`);
      await sleep(1200 * (i + 1));
    }
  }
}

(async () => {
  const p = new ethers.JsonRpcProvider(RPC, 8453, { staticNetwork: true });
  const block = await retry(() => p.getBlockNumber(), 'blockNumber');
  const pf = new ethers.Contract(PRICE_FEED, PF_ABI, p);
  const router = new ethers.Contract(ROUTER, ROUTER_ABI, p);
  const hook = new ethers.Contract(HOOK, HOOK_ABI, p);

  const out = { chainId: 8453, block, priceFeed: PRICE_FEED, tokens: {} };

  for (const [sym, token] of Object.entries({ WETH, USDC })) {
    const feed = await retry(() => pf.priceFeeds(token), `priceFeeds(${sym})`);
    const dec = await retry(() => pf.feedDecimals(token), `feedDecimals(${sym})`);
    const stale = await retry(() => pf.maxOracleAgeSec(token), `feedStaleness(${sym})`);
    const minA = await retry(() => pf.minAnswers(token), `minAnswers(${sym})`);
    const maxA = await retry(() => pf.maxAnswers(token), `maxAnswers(${sym})`);
    const usd = await retry(() => pf.getAmountInUsd(token, 10n ** 18n), `getAmountInUsd(${sym})`);
    const twap = await retry(() => pf.getTwapPrice(token), `getTwapPrice(${sym})`);
    const entry = {
      token,
      feed,
      feedDecimals: Number(dec),
      perFeedStalenessSec: Number(stale),
      minAnswerRaw: minA.toString(),
      maxAnswerRaw: maxA.toString(),
      usdPer1e18Token: usd.toString(),
      twapPrice18: twap.toString(),
    };
    if (feed !== ethers.ZeroAddress) {
      const agg = new ethers.Contract(feed, AGG_ABI, p);
      const d = await retry(() => agg.decimals(), `agg.decimals(${sym})`);
      const desc = await retry(() => agg.description(), `agg.description(${sym})`);
      const rd = await retry(() => agg.latestRoundData(), `agg.latestRoundData(${sym})`);
      entry.aggregator = {
        decimals: Number(d),
        description: desc,
        roundId: rd[0].toString(),
        answer: rd[1].toString(),
        updatedAt: Number(rd[2]),
        ageSecAtQuery: Math.floor(Date.now() / 1000) - Number(rd[2]),
      };
    }
    out.tokens[sym] = entry;
  }

  const seq = await retry(() => pf.sequencerUptimeFeed(), 'sequencerUptimeFeed');
  out.sequencerUptimeFeed = seq;
  if (seq !== ethers.ZeroAddress) {
    const s = new ethers.Contract(seq, SEQ_ABI, p);
    const rd = await retry(() => s.latestRoundData(), 'seq.latestRoundData');
    out.sequencer = {
      description: await retry(() => s.description(), 'seq.description'),
      answer: rd[1].toString(),
      startedAt: Number(rd[3]),
      updatedAt: Number(rd[2]),
    };
  }
  out.maxOracleAgeSecGlobal = Number(await retry(() => pf.MAX_ORACLE_AGE(), 'MAX_ORACLE_AGE'));
  out.requireBounds = await retry(() => pf.requireBounds(), 'requireBounds');
  out.priceFeedOwner = await retry(() => pf.owner(), 'pf.owner');

  out.router = {
    address: ROUTER,
    owner: await retry(() => router.owner(), 'router.owner'),
    domainSeparator: await retry(() => router.DOMAIN_SEPARATOR(), 'router.DOMAIN_SEPARATOR'),
    aggregators: {},
  };
  for (const [name, addr] of Object.entries({
    ZeroX_AllowanceHolder: '0x0000000000001fF3684f28c67538d4D072C22734',
    ZeroX_ExchangeProxy: '0xDef1C0ded9bec7F1a1670819833240f027b25EfF',
    Enso: '0xF75584eF6673aD213a685a1B58Cc0330B8eA22Cf',
    ParaSwap_AugustusV6_2: '0x6A000F20005980200259B80c5102003040001068',
    ParaSwap_V5: '0x59C7C832e96D2568bea6db468C1aAdcbbDa08A52',
    KyberSwap_MetaAggRouterV2: '0x6131B5fae19EA4f9D964eAc0408E4408b66337b5',
    OneInch_V6: '0x111111125421cA6dc452d289314280a0f8842A65',
    LI_FI: '0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE',
  })) {
    out.router.aggregators[name] = {
      address: addr,
      allowed: await retry(() => router.allowedAggregators(addr), `allowedAggregators(${name})`),
    };
  }

  const safe = async (fn, label) => {
    try {
      return (await retry(fn, label)).toString();
    } catch (e) {
      return `UNAVAILABLE (${e.shortMessage || e.message})`;
    }
  };
  out.hook = {
    address: HOOK,
    owner: await safe(() => hook.owner(), 'hook.owner'),
    reserveFactor: await safe(() => hook.reserveFactor(), 'reserveFactor'),
    defaultMaxLeverage: await safe(() => hook.defaultMaxLeverage(), 'defaultMaxLeverage'),
    maxPriceSwingBps: await safe(() => hook.maxPriceSwingBps(), 'maxPriceSwingBps'),
    liquidatorIncentiveBps: await safe(() => hook.liquidatorIncentiveBps(), 'liquidatorIncentiveBps'),
    insuranceCoverageBps: await safe(() => hook.insuranceCoverageBps(), 'insuranceCoverageBps'),
  };

  const poolId = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ['address', 'address', 'uint24', 'int24', 'address'],
      [WETH, USDC, 3000, 60, HOOK]
    )
  );
  out.pool = {
    currency0: WETH,
    currency1: USDC,
    fee: 3000,
    tickSpacing: 60,
    hooks: HOOK,
    poolId,
    authorized: await retry(() => hook.isAuthorizedPool(poolId), 'isAuthorizedPool'),
  };
  const spk = await retry(() => hook.standardPoolKeys(poolId), 'standardPoolKeys');
  out.pool.standardPoolKey = {
    currency0: spk[0],
    currency1: spk[1],
    fee: Number(spk[2]),
    tickSpacing: Number(spk[3]),
    hooks: spk[4],
  };

  const dir = path.resolve(process.cwd(), 'scripts/v4/live/proofs');
  const file = path.join(dir, `partner-config-${block}.json`);
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
  console.log('\nsaved', file);
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
