/**
 * Eswap aggregator-route live broadcaster (Base 8453).
 *
 *   node scripts/v4/live/agg-fill.cjs setup       # whitelist venues + fund dust traders
 *   node scripts/v4/live/agg-fill.cjs sim         # quote + eth_call preflight only
 *   node scripts/v4/live/agg-fill.cjs broadcast   # real txs through swapMultiPoolForAggregator
 *   node scripts/v4/live/agg-fill.cjs broadcast --only=enso
 *
 * Every route is fetched FRESH from the venue API for `sellAmount == notional`
 * with `recipient/receiver = live router`, because the checked-in fixtures were
 * captured at an old block for a different taker and cannot be replayed.
 *
 * Set BASE_RPC_URL=http://127.0.0.1:8545 to rehearse the whole flow on an anvil
 * fork of Base before spending anything.
 */
const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');
const { loadEnv, getProvider, loadABIs, USDC, WETH, ROUTER, HOOK, ZEROX, ENSO, PARASWAP, KYBER } = require('./common.cjs');

const env = loadEnv();
const ADDR = {
  zeroXAllowanceHolder: '0x0000000000001fF3684f28c67538d4D072C22734',
  paraSwapV6: '0x59C7C832e96D2568bea6db468C1aAdcbbDa08A52',
  paraSwapTokenProxy: '0x93aAAe79a53759cD164340E4C8766E4Db5331cD7',
};

const HOOK_KEY = { currency0: WETH, currency1: USDC, fee: 3000, tickSpacing: 60, hooks: HOOK };
const STD_KEY = { currency0: WETH, currency1: USDC, fee: 500, tickSpacing: 10, hooks: ethers.ZeroAddress };
const LEVERAGE = 2;
const MARGIN = 4000n; // USDC units (6dp) => notional 8000 = 0.008 USDC (dust, sized to live balances)
const NOTIONAL = MARGIN * BigInt(LEVERAGE);
const SLIPPAGE_BPS = 300; // minAmountOut = 97% of the venue quote

const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function approve(address,uint256) returns (bool)',
  'function allowance(address,address) view returns (uint256)',
  'function transfer(address,uint256) returns (bool)',
];

const coder = ethers.AbiCoder.defaultAbiCoder();
const poolIdOf = (k) => ethers.keccak256(coder.encode(['address', 'address', 'uint24', 'int24', 'address'], [k.currency0, k.currency1, k.fee, k.tickSpacing, k.hooks]));
const HOOK_POOL_ID = poolIdOf(HOOK_KEY);
const fmt = (v) => ethers.formatUnits(v, 6);
const gwei = (v) => BigInt(Math.round(Number(v) * 1e9));
const FEE = {
  maxFeePerGas: gwei(process.env.MAX_FEE_GWEI || '0.02'),
  maxPriorityFeePerGas: gwei(process.env.PRIORITY_FEE_GWEI || '0.001'),
};

function abiOf(file) {
  const j = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), file), 'utf8'));
  return Array.isArray(j) ? j : j.abi;
}

async function jfetch(url, opts = {}) {
  const res = await fetch(url, opts);
  const txt = await res.text();
  let body;
  try { body = JSON.parse(txt); } catch { body = txt; }
  if (!res.ok) {
    const e = new Error(`${res.status} ${typeof body === 'string' ? body.slice(0, 300) : JSON.stringify(body).slice(0, 400)}`);
    e.status = res.status;
    throw e;
  }
  return body;
}

async function waitFor(label, read, ok, tries = 30) {
  for (let i = 0; i < tries; i++) {
    const v = await read();
    if (ok(v)) return v;
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`timed out waiting for ${label}`);
}

// Deterministic dust trader per venue: the hook allows ONE open position per
// (pool, trader), and the earlier CoW/intent/Fusion proofs already own the
// three funded EOAs.
function traderFor(venue) {
  return new ethers.Wallet(ethers.keccak256(ethers.toUtf8Bytes(`eswap-aggregator-live-v1/${venue}`)));
}

// ── venue quote adapters ───────────────────────────────────────────────────
async function quoteZerox(amount) {
  const u = `https://api.0x.org/swap/allowance-holder/quote?chainId=8453&sellToken=${USDC}&buyToken=${WETH}`
    + `&sellAmount=${amount}&taker=${ROUTER}&slippageBps=${SLIPPAGE_BPS}`;
  const b = await jfetch(u, { headers: { '0x-api-key': env.ZERO_X_API_KEY, '0x-version': 'v2' } });
  const tx = b.transaction || b;
  return {
    exchangeProxy: tx.to,
    callData: tx.data,
    expectedOut: BigInt(b.buyAmount ?? b.order?.buyAmount ?? 0),
    raw: b,
  };
}

async function quoteEnso(amount) {
  const u = `https://api.enso.finance/api/v1/shortcuts/route?chainId=8453&fromAddress=${ROUTER}&receiver=${ROUTER}`
    + `&spender=${ROUTER}&tokenIn=${USDC}&tokenOut=${WETH}&amountIn=${amount}&routingStrategy=router&slippage=${SLIPPAGE_BPS}`;
  const h = env.ENSO_API_KEY ? { authorization: `Bearer ${env.ENSO_API_KEY}` } : {};
  const b = await jfetch(u, { headers: h });
  return { exchangeProxy: b.tx.to, callData: b.tx.data, expectedOut: BigInt(b.amountOut), raw: { amountOut: b.amountOut, gas: b.gas, route: b.route } };
}

async function quoteKyber(amount) {
  const h = { 'x-client-id': 'eswap-live-proof' };
  const r = await jfetch(
    `https://aggregator-api.kyberswap.com/base/api/v1/routes?tokenIn=${USDC}&tokenOut=${WETH}&amountIn=${amount}&to=${ROUTER}&gasInclude=1`,
    { headers: h },
  );
  const b = await jfetch('https://aggregator-api.kyberswap.com/base/api/v1/route/build', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...h },
    body: JSON.stringify({ routeSummary: r.data.routeSummary, sender: ROUTER, recipient: ROUTER, slippageTolerance: SLIPPAGE_BPS / 100 }),
  });
  return {
    exchangeProxy: b.data.routerAddress,
    callData: b.data.data,
    expectedOut: BigInt(b.data.amountOut),
    raw: r.data.routeSummary,
  };
}

async function quoteParaSwap(amount) {
  // version=6.2 pins Augustus (0x6A00...) as BOTH the swap target and the token
  // transfer proxy, so the router's single forceApprove(exchangeProxy, notional)
  // is exactly the allowance Augustus pulls with. The default 5.x route target
  // (0x59C7...) pulls through a separate TokenTransferProxy that the router
  // never approves, so it reverts with "ERC20: transfer amount exceeds allowance".
  const pr = await jfetch(
    `https://api.paraswap.io/prices/?srcToken=${USDC}&destToken=${WETH}&amount=${amount}&srcDecimals=6&destDecimals=18`
    + `&side=SELL&network=8453&partner=eswap&version=6.2`,
  );
  const tx = await jfetch(`https://api.paraswap.io/transactions/8453?partner=eswap&ignoreChecks=true`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      srcToken: USDC,
      destToken: WETH,
      srcAmount: amount.toString(),
      destAmount: pr.priceRoute.destAmount,
      priceRoute: pr.priceRoute,
      userAddress: ROUTER,
      receiver: ROUTER,
    }),
  });
  return {
    exchangeProxy: tx.to,
    callData: tx.data,
    expectedOut: BigInt(pr.priceRoute.destAmount),
    raw: { destAmount: pr.priceRoute.destAmount, contractAddress: pr.priceRoute.contractAddress, tokenTransferProxy: pr.priceRoute.tokenTransferProxy },
  };
}

// OpenOcean's API sits behind a Cloudflare managed challenge that rejects
// server-side fetches, so the swap_quote response is captured from a real
// Chrome session (same-origin fetch, saved as a download) into
// proofs/openocean-quote.json. The adapter refuses a file that is older than
// QUOTE_MAX_AGE_MS or whose router is not the expected OpenOcean exchange.
const OPENOCEAN_ROUTER = '0x6352a56caadC4F1E25CD6c75970Fa768A3304e64';
const QUOTE_MAX_AGE_MS = 15 * 60 * 1000;

async function quoteOpenOcean() {
  const file = path.resolve(process.cwd(), process.env.OPENOCEAN_QUOTE_FILE || 'scripts/v4/live/proofs/openocean-quote.json');
  const ageMs = Date.now() - fs.statSync(file).mtimeMs;
  if (ageMs > QUOTE_MAX_AGE_MS) throw new Error(`openocean quote is ${Math.round(ageMs / 60000)} min old; re-capture it`);
  const d = JSON.parse(fs.readFileSync(file, 'utf8')).data;
  if (d.to.toLowerCase() !== OPENOCEAN_ROUTER.toLowerCase()) throw new Error(`unexpected openocean router ${d.to}`);
  if (d.value !== '0') throw new Error('openocean quote carries native value; not supported');
  return {
    exchangeProxy: d.to,
    callData: d.data,
    expectedOut: BigInt(d.outAmount),
    minOut: BigInt(d.minOutAmount),
    raw: { outAmount: d.outAmount, minOutAmount: d.minOutAmount, estimatedGas: d.estimatedGas, blockNumber: d.blockNumber, priceImpact: d.price_impact },
  };
}

const VENUES = {
  '0x': { label: '0x AllowanceHolder', quote: quoteZerox, whitelist: ADDR.zeroXAllowanceHolder },
  enso: { label: 'Enso Router V2', quote: quoteEnso, whitelist: ENSO },
  paraswap: { label: 'ParaSwap Augustus V6.2', quote: quoteParaSwap, whitelist: PARASWAP },
  kyber: { label: 'KyberSwap MetaAggregator', quote: quoteKyber, whitelist: KYBER },
  openocean: { label: 'OpenOcean Exchange', quote: quoteOpenOcean, whitelist: OPENOCEAN_ROUTER },
};

async function main() {
  const mode = process.argv[2] || 'sim';
  const only = (process.argv.find((a) => a.startsWith('--only=')) || '').split('=')[1];
  const venueKeys = Object.keys(VENUES).filter((k) => !only || only.split(',').includes(k));

  const provider = getProvider();
  // The public Base RPC is load-balanced and anvil's fork backend lags, so a
  // fresh getTransactionCount can hand out an already-mined nonce. Cache and
  // increment locally for every signer that sends more than one tx.
  const owner = new ethers.NonceManager(new ethers.Wallet(env.PRIVATE_KEY, provider));
  const solver = new ethers.NonceManager(new ethers.Wallet(env.SOLVER_PRIVATE_KEY, provider));
  const ownerAddr = await owner.getAddress();
  const solverAddr = await solver.getAddress();
  const router = new ethers.Contract(ROUTER, abiOf('dashboard/src/abis/EswapRouter.json'), provider);
  const hook = new ethers.Contract(HOOK, abiOf('dashboard/src/abis/EswapMarginHook.json'), provider);
  const usdc = new ethers.Contract(USDC, ERC20_ABI, provider);
  const weth = new ethers.Contract(WETH, ERC20_ABI, provider);

  const blk = await provider.getBlock('latest');
  const results = {
    mode, rpc: provider._getConnection().url, chainId: 8453, startedAt: new Date().toISOString(),
    startBlock: blk.number, leverage: LEVERAGE, margin: MARGIN.toString(), notional: NOTIONAL.toString(),
    hookPoolId: HOOK_POOL_ID, steps: [],
  };
  console.log(`mode ${mode}  block ${blk.number}  notional ${fmt(NOTIONAL)} USDC @ ${LEVERAGE}x  venues ${venueKeys.join(',')}`);
  console.log(`owner ${ownerAddr} USDC ${fmt(await usdc.balanceOf(ownerAddr))}  ETH ${ethers.formatEther(await provider.getBalance(ownerAddr))}`);
  console.log(`solver ${solverAddr} USDC ${fmt(await usdc.balanceOf(solverAddr))}  allowance->router ${await usdc.allowance(solverAddr, ROUTER)}`);

  const traderAddrs = {};
  const traders = {};
  for (const v of venueKeys) {
    traders[v] = new ethers.NonceManager(new ethers.Wallet(traderFor(v).privateKey, provider));
    traderAddrs[v] = traderFor(v).address;
  }

  // ── 1. whitelist venue proxies ─────────────────────────────────────────
  if (mode !== 'sim') {
    for (const v of venueKeys) {
      const proxy = VENUES[v].whitelist;
      if (await router.allowedAggregators(proxy)) {
        console.log(`allowedAggregators[${VENUES[v].label}] already true`);
        continue;
      }
      const tx = await router.connect(owner).setAllowedAggregator(proxy, true, { gasLimit: 120_000, ...FEE });
      const rc = await tx.wait();
      const ok = await waitFor(`whitelist ${v}`, () => router.allowedAggregators(proxy), (x) => x === true);
      console.log(`whitelisted ${VENUES[v].label} ${proxy} tx ${tx.hash} (block ${rc.blockNumber}) -> ${ok}`);
      results.steps.push({ step: `whitelist-${v}`, action: 'setAllowedAggregator', tx: tx.hash, block: rc.blockNumber, proxy });
    }
  }

  // ── 2. fund dust traders + solver borrow inventory ─────────────────────
  const GAS_TOPUP = 6n * 10n ** 13n; // 0.00006 ETH each (fills at ~0.006 gwei are ~1e13 wei)
  if (mode !== 'sim') {
    for (const v of venueKeys) {
      const t = traders[v];
      const ta = traderAddrs[v];
      const [u, e] = await Promise.all([usdc.balanceOf(ta), provider.getBalance(ta)]);
      if (u < MARGIN) {
        const tx = await usdc.connect(owner).transfer(ta, MARGIN - u, { gasLimit: 80_000, ...FEE });
        await tx.wait();
        await waitFor(`fund usdc ${v}`, () => usdc.balanceOf(ta), (x) => x >= MARGIN);
        console.log(`funded ${v} trader ${ta} with ${fmt(MARGIN - u)} USDC (${tx.hash})`);
      }
      if (e < GAS_TOPUP / 2n) {
        const tx = await owner.sendTransaction({ to: ta, value: GAS_TOPUP - e, gasLimit: 21_000, ...FEE });
        await tx.wait();
        // The public RPC is load-balanced: a balance read right after the tx can
        // still hit a backend that has not seen it, which makes ethers reject the
        // next (approve) tx for "insufficient funds". Poll until it is visible.
        await waitFor(`eth ${v}`, () => provider.getBalance(ta), (x) => x >= GAS_TOPUP / 2n);
        console.log(`funded ${v} trader gas ${ethers.formatEther(GAS_TOPUP - e)} ETH (${tx.hash})`);
      }
      const allow = await usdc.allowance(ta, ROUTER);
      if (allow < NOTIONAL) {
        const tx = await usdc.connect(t).approve(ROUTER, ethers.MaxUint256, { gasLimit: 90_000, ...FEE });
        await tx.wait();
        await waitFor(`approve ${v}`, () => usdc.allowance(ta, ROUTER), (x) => x >= NOTIONAL);
        console.log(`approved router from ${v} trader (${tx.hash})`);
      }
    }
    // borrow legs are pulled straight from the registered solver
    const solverBal = await usdc.balanceOf(solverAddr);
    const need = MARGIN * BigInt(venueKeys.length);
    if (solverBal < need) {
      const tx = await usdc.connect(owner).transfer(solverAddr, need - solverBal, { gasLimit: 80_000, ...FEE });
      await tx.wait();
      await waitFor('fund solver', () => usdc.balanceOf(solverAddr), (x) => x >= need);
      console.log(`funded solver borrow inventory ${fmt(need - solverBal)} USDC (${tx.hash})`);
    }
    if ((await usdc.allowance(solverAddr, ROUTER)) < need) {
      const tx = await usdc.connect(solver).approve(ROUTER, ethers.MaxUint256, { gasLimit: 90_000, ...FEE });
      await tx.wait();
      await waitFor('solver allowance', () => usdc.allowance(solverAddr, ROUTER), (x) => x >= need);
      console.log(`approved router from solver (${tx.hash})`);
    }
  }

  // ── 3. per-venue fresh quote + preflight + broadcast ───────────────────
  for (const v of venueKeys) {
    const venue = VENUES[v];
    const trader = traders[v];
    const traderAddr = traderAddrs[v];
    console.log(`\n=== ${venue.label} (${v}) trader ${traderAddr}`);

    let q;
    try {
      q = await venue.quote(NOTIONAL);
    } catch (e) {
      console.log(`  quote FAILED: ${e.message}`);
      results.steps.push({ step: `fill-${v}`, venue: venue.label, status: 'quote-failed', error: e.message });
      continue;
    }
    const minOut = q.minOut ?? (q.expectedOut * BigInt(10_000 - SLIPPAGE_BPS)) / 10_000n;
    console.log(`  quote: out ${q.expectedOut} wei WETH  minOut ${minOut}  proxy ${q.exchangeProxy}  calldata ${(q.callData.length - 2) / 2} bytes`);

    const route = {
      exchangeProxy: q.exchangeProxy,
      tokenIn: USDC,
      tokenOut: WETH,
      sellAmount: NOTIONAL,
      value: 0n,
      callData: q.callData,
    };
    const deadline = Number((await provider.getBlock('latest')).timestamp) + 1800;
    const params = {
      key: HOOK_KEY,
      standardPoolKey: STD_KEY,
      zeroForOne: false, // USDC -> WETH (long)
      amountSpecified: -MARGIN,
      leverage: LEVERAGE,
      solver: solverAddr,
      hookData: '0x',
      deadline,
      minAmountOut: minOut,
    };

    // preflight (also proves the whitelist + approvals + calldata shape)
    try {
      await router.connect(trader).swapMultiPoolForAggregator.staticCall(params, traderAddr, route);
      console.log('  eth_call OK');
    } catch (e) {
      const msg = e.shortMessage || e.message;
      console.log(`  eth_call REVERTED: ${msg}`);
      results.steps.push({
        step: `fill-${v}`, venue: venue.label, status: 'preflight-revert', error: msg,
        revertData: e.data || e.info?.error?.data || null, exchangeProxy: q.exchangeProxy, minOut: minOut.toString(),
        calldataLen: (q.callData.length - 2) / 2,
      });
      continue;
    }

    if (mode !== 'broadcast') {
      results.steps.push({
        step: `fill-${v}`, venue: venue.label, status: 'preflight-ok', exchangeProxy: q.exchangeProxy,
        expectedOut: q.expectedOut.toString(), minOut: minOut.toString(), trader: traderAddr,
      });
      continue;
    }

    const pre = {
      traderUsdc: (await usdc.balanceOf(traderAddr)).toString(),
      solverUsdc: (await usdc.balanceOf(solverAddr)).toString(),
      routerWeth: (await weth.balanceOf(ROUTER)).toString(),
    };
    const tx = await router.connect(trader).swapMultiPoolForAggregator(params, traderAddr, route, { gasLimit: 2_600_000, ...FEE });
    const rc = await tx.wait();
    const post = {
      traderUsdc: (await usdc.balanceOf(traderAddr)).toString(),
      solverUsdc: (await usdc.balanceOf(solverAddr)).toString(),
      routerWeth: (await weth.balanceOf(ROUTER)).toString(),
    };
    const pos = await waitFor(`position ${v}`, () => hook.positions(HOOK_POOL_ID, traderAddr), (p) => p[1] > 0n);
    const step = {
      step: `fill-${v}`,
      venue: venue.label,
      action: 'EswapRouter.swapMultiPoolForAggregator (leveraged open)',
      status: rc.status === 1 ? 'filled' : 'reverted',
      tx: tx.hash,
      url: `https://basescan.org/tx/${tx.hash}`,
      block: rc.blockNumber,
      gasUsed: rc.gasUsed.toString(),
      effectiveGasPrice: rc.gasPrice?.toString(),
      trader: traderAddr,
      exchangeProxy: q.exchangeProxy,
      sellAmount: NOTIONAL.toString(),
      expectedOut: q.expectedOut.toString(),
      minOut: minOut.toString(),
      calldataLen: (q.callData.length - 2) / 2,
      before: pre,
      after: post,
      position: {
        trader: pos[0], collateral: pos[1].toString(), borrowed: pos[2].toString(),
        leverage: Number(pos[3]), isLong: pos[4],
      },
      logs: rc.logs.length,
    };
    console.log(`  tx ${tx.hash} status ${rc.status} gas ${rc.gasUsed} block ${rc.blockNumber}`);
    console.log(`  collateral ${pos[1]} wei WETH  borrowed ${pos[2]}  lev ${Number(pos[3])}  long ${pos[4]}`);
    results.steps.push(step);
  }

  results.finishedAt = new Date().toISOString();
  fs.mkdirSync('scripts/v4/live/proofs', { recursive: true });
  const file = `scripts/v4/live/proofs/agg-${mode}-${Date.now()}.json`;
  fs.writeFileSync(file, JSON.stringify(results, null, 2));
  console.log('\nwrote', file);
}

main().catch((e) => {
  console.error('\nFAILED:', e.shortMessage || e.message);
  if (e.data) console.error('revert data:', e.data);
  if (process.env.DEBUG) console.error(e.stack);
  process.exit(1);
});
