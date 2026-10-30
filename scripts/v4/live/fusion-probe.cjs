/**
 * 1inch Fusion / Limit-Order-Protocol live probe.
 *
 * Purpose: determine, against the REAL deployed LOP on Base, which signature
 * convention the maker must use, without spending any gas. Everything here is
 * eth_call only:
 *
 *   node scripts/v4/live/fusion-probe.cjs
 *
 * It builds a real order (maker = the tiny trader EOA, extension naming
 * EswapOneInchFusionSettlement as the post-interaction target) and tries:
 *   1. signature over LOP.hashOrder(order)          (raw ECDSA over the digest)
 *   2. EIP-712 typed data, uint256 address fields
 *   3. EIP-712 typed data, address address fields
 */
const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');

const RPC = process.env.BASE_RPC_URL || 'https://mainnet.base.org';
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const WETH = '0x4200000000000000000000000000000000000006';
const LOP = '0x111111125421cA6dc452d289314280a0f8842A65';
const FUSION = '0xD0F10948E5E987d9A04aDf4014178D65042f672c';
const CHAINLINK_ETH_USD = '0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70';

const abiOf = (f) => {
  const j = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), f), 'utf8'));
  return Array.isArray(j) ? j : j.abi;
};

// Read whichever cap surface the deployed settler exposes: the split build has
// maxMakingAmount()/maxTakingAmount(), the original build only the single
// maxFillAmount() scalar applied to both legs. Keeps this probe working across
// the pending split-cap redeploy.
const readCaps = async (fusion) => {
  try {
    const [making, taking] = await Promise.all([fusion.maxMakingAmount(), fusion.maxTakingAmount()]);
    return { making, taking, split: true };
  } catch {
    const single = await fusion.maxFillAmount();
    return { making: single, taking: single, split: false };
  }
};

const MAKER = '0xd9Aba9723d14b36588bcF9D47c2FF355EEC47F3c';

const ORDER_FIELDS = [
  'uint256 salt',
  'uint256 maker',
  'uint256 receiver',
  'uint256 makerAsset',
  'uint256 takerAsset',
  'uint256 makingAmount',
  'uint256 takingAmount',
  'uint256 makerTraits',
];

const LOP_ABI = [
  `function hashOrder((${ORDER_FIELDS.join(',')})) view returns (bytes32)`,
  `function fillOrderArgs((${ORDER_FIELDS.join(',')}),bytes32 r,bytes32 vs,uint256 amount,uint256 takerTraits,bytes args) payable returns (uint256 makingAmount,uint256 takingAmount,bytes32 orderHash)`,
];

// 1inch v4 extension: 32-byte length table (8 x uint32 lanes, MSB first) then data.
// Only postInteractionTargetAndData is populated: 20-byte target.
const extensionFor = (target) => ethers.concat([ethers.toBeHex(BigInt(20) << 224n, 32), target]);

const vsOf = (sig) => {
  let vs = BigInt(sig.s);
  if (sig.yParity) vs |= 1n << 255n;
  return ethers.toBeHex(vs, 32);
};

async function main() {
  const p = new ethers.JsonRpcProvider(RPC);
  const lop = new ethers.Contract(LOP, LOP_ABI, p);
  const fusion = new ethers.Contract(FUSION, abiOf('out/EswapOneInchFusionSettlement.sol/EswapOneInchFusionSettlement.json'), p);
  const feed = new ethers.Contract(CHAINLINK_ETH_USD, ['function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)'], p);
  const usdc = new ethers.Contract(USDC, ['function balanceOf(address) view returns(uint256)'], p);

  const [, ethAnswer] = await feed.latestRoundData();
  const p8 = BigInt(ethAnswer);
  const caps = await readCaps(fusion);
  console.log('lod        ', LOP);
  console.log('fusion     ', FUSION);
  console.log('makerAsset ', await fusion.makerAsset(), '(USDC)');
  console.log('takerAsset ', await fusion.takerAsset(), '(WETH)');
  console.log('operator   ', await fusion.operator());
  console.log('caps        making', caps.making.toString(), '/ taking', caps.taking.toString(), `(${caps.split ? 'split' : 'legacy-single'})`);
  console.log('ETH/USD (8dp)', p8.toString(), '=', Number(p8) / 1e8);
  console.log('maker USDC   ', (await usdc.balanceOf(MAKER)).toString());

  // Size just under BOTH caps: the making leg is USDC (6dp), the taking leg is
  // WETH (18dp). On a legacy single-cap settler both equal maxFillAmount, so
  // this reproduces the old 4.8e9-wei taking size; on the split build it can
  // reach the real WETH cap.
  const makingCap = caps.making > 200_000_000n ? caps.making - 200_000_000n : caps.making;
  const takingCap = caps.taking > 200_000_000n ? caps.taking - 200_000_000n : caps.taking;
  let makingAmount = makingCap;
  let takingAmount = (makingAmount * 10n ** 20n) / p8; // fair at the live ETH/USD price
  if (takingAmount > takingCap) {
    takingAmount = takingCap;
    makingAmount = (takingAmount * p8) / 10n ** 20n;
  }
  console.log('makingAmount', makingAmount.toString(), '(USDC units)');
  console.log('takingAmount', takingAmount.toString(), '(WETH wei)');

  const extension = extensionFor(FUSION);
  const makerTraits = (1n << 255n) | (1n << 251n) | (1n << 249n);
  const order = {
    salt: BigInt(ethers.keccak256(extension)),
    maker: BigInt(MAKER),
    receiver: BigInt(MAKER),
    makerAsset: BigInt(USDC),
    takerAsset: BigInt(WETH),
    makingAmount,
    takingAmount,
    makerTraits,
  };
  const takerTraits = (1n << 255n) | (BigInt(ethers.dataLength(extension)) << 224n) | takingAmount;
  const args = extension;

  console.log('\nextension   ', extension, `(${ethers.dataLength(extension)} bytes)`);

  // ── method 1: raw ECDSA over hashOrder ────────────────────────────────
  const hash = await lop.hashOrder(order);
  console.log('hashOrder   ', hash);

  const traderPk = (() => {
    for (const line of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
      const m = line.match(/^TINY_TRADER_PK\s*=\s*(0x[0-9a-fA-F]{64})$/);
      if (m) return m[1];
    }
    throw new Error('TINY_TRADER_PK missing');
  })();
  const trader = new ethers.Wallet(traderPk, p);
  console.log('signer      ', trader.address, trader.address.toLowerCase() === MAKER.toLowerCase() ? '(maker)' : '(MISMATCH)');

  const attempts = [];
  const tryFill = async (label, r, vs) => {
    try {
      const res = await lop.fillOrderArgs.staticCall(order, r, vs, makingAmount, takerTraits, args, { from: MAKER });
      attempts.push({ label, ok: true, makingAmount: res[0].toString(), takingAmount: res[1].toString() });
      console.log(`\n[OK]   ${label} -> making ${res[0]} taking ${res[1]}`);
    } catch (e) {
      const msg = e.shortMessage || e.message;
      attempts.push({ label, ok: false, error: msg });
      console.log(`\n[FAIL] ${label} -> ${msg}`);
      if (e.data && e.data !== '0x') console.log('       revert data', e.data.slice(0, 10));
    }
  };

  const sig = trader.signingKey.sign(hash);
  await tryFill('raw sign(hashOrder)', sig.r, vsOf(sig));

  const typedBase = { chainId: 8453, verifyingContract: LOP };
  for (const [label, addrType] of [
    ['EIP-712 uint256 fields', 'uint256'],
    ['EIP-712 address fields', 'address'],
  ]) {
    const types = {
      Order: [
        { name: 'salt', type: 'uint256' },
        { name: 'maker', type: addrType },
        { name: 'receiver', type: addrType },
        { name: 'makerAsset', type: addrType },
        { name: 'takerAsset', type: addrType },
        { name: 'makingAmount', type: 'uint256' },
        { name: 'takingAmount', type: 'uint256' },
        { name: 'makerTraits', type: 'uint256' },
      ],
    };
    const value = {
      salt: order.salt,
      maker: ethers.getAddress(MAKER),
      receiver: ethers.getAddress(MAKER),
      makerAsset: USDC,
      takerAsset: WETH,
      makingAmount,
      takingAmount,
      makerTraits,
    };
    const s2 = await trader.signTypedData({ name: '1inch Limit Order Protocol', version: '4', ...typedBase }, types, value);
    const parsed = ethers.Signature.from(s2);
    await tryFill(label, parsed.r, vsOf(parsed));
  }

  fs.mkdirSync('scripts/v4/live/proofs', { recursive: true });
  fs.writeFileSync(
    'scripts/v4/live/proofs/fusion-probe.json',
    JSON.stringify({ at: new Date().toISOString(), order: Object.fromEntries(Object.entries(order).map(([k, v]) => [k, v.toString()])), takerTraits: takerTraits.toString(), extension, hash, attempts }, (k, v) => (typeof v === 'bigint' ? v.toString() : v), 2),
  );

  const winner = attempts.find((a) => a.ok);
  console.log('\nwinning convention:', winner ? winner.label : 'NONE');
  console.log('wrote scripts/v4/live/proofs/fusion-probe.json');
}

main().catch((e) => {
  console.error('FAILED:', e.shortMessage || e.message);
  process.exit(1);
});
