/**
 * Canary micro-opens for the new Base aggregators through
 * EswapLeverageAdapter.exactInputSingleWithLeverageAggregator (live, chain 8453).
 *
 *   node scripts/v4/live/test-new-aggregators.cjs setup      # fund trader + solver, approve router
 *   node scripts/v4/live/test-new-aggregators.cjs sim        # fresh quote + eth_call preflight
 *   node scripts/v4/live/test-new-aggregators.cjs broadcast  # real tx
 *   node scripts/v4/live/test-new-aggregators.cjs broadcast --only=lifi
 *
 * Sizing matches §12/§13: margin 4000 USDC-units, leverage 2x, notional 8000.
 *
 * Venues:
 *   lifi       LI.FI Diamond (quote via li.quest)
 *   socket     Socket Swap V3 (quote via public-backend.socket.tech, keyless)
 *   woofi      WOOFi Router V2.1
 *   1inch      AggregationRouterV6
 *   openocean  OpenOcean Router (proven in §13; re-run needs funding)
 *
 * Socket V3 returns txData for the Socket Allowance Holder
 * (0x50c4E75a…5909). The router approves and calls it, so the holder pulls the
 * notional from EswapRouter and forwards it to the Socket Open Router. The
 * output is sent to receiverAddress == EswapRouter.
 *
 * The LI.FI trader is a deterministic key so the run is reproducible. Each
 * trader gets one open position per pool, so a fresh key is needed per venue.
 */
const { ethers } = require('ethers');
const fs = require('fs');
const { loadEnv, getProvider, USDC, WETH, ROUTER, ADAPTER, HOOK } = require('./common.cjs');

const env = loadEnv();
const LEVERAGE = 2;
const MARGIN = BigInt((process.argv.find((a) => a.startsWith('--margin=')) || '--margin=4000').split('=')[1]);
const NOTIONAL = MARGIN * BigInt(LEVERAGE);
const WOOFI = ethers.getAddress('0x4c4af8dbc524681930a27b2f1af5bcc8062e6fb7');
const ONEINCH_ROUTER = ethers.getAddress('0x111111125421ca6dc452d289314280a0f8842a65');
const SOCKET_ALLOWANCE_HOLDER = ethers.getAddress('0x50c4E75a512F2A14A7b304787Adf79C4531A5909');
const SOCKET_API = 'https://public-backend.socket.tech/v3/swap/quote';
const SOCKET_MAX_GAS = 500_000;
const WOOFI_ABI = [
  'function querySwap(address fromToken,address toToken,uint256 fromAmount) view returns (uint256)',
  'function swap(address fromToken,address toToken,uint256 fromAmount,uint256 minToAmount,address to,address rebateTo) returns (uint256)',
];
const SLIPPAGE_BPS = 300;
const HOOK_KEY = { currency0: WETH, currency1: USDC, fee: 3000, tickSpacing: 60, hooks: HOOK };
const ADAPTER_ABI = [
  'function exactInputSingleWithLeverageAggregator(address tokenIn,address tokenOut,uint24 fee,uint8 leverage,uint256 amountIn,uint256 minAmountOut,address recipient,(address exchangeProxy,address tokenIn,address tokenOut,uint256 sellAmount,uint256 value,bytes callData) route) returns (uint256)',
];
const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function approve(address,uint256) returns (bool)',
  'function allowance(address,address) view returns (uint256)',
  'function transfer(address,uint256) returns (bool)',
];
const ROUTER_ABI = [
  'function allowedAggregators(address) view returns (bool)',
  'function registeredSolvers(address) view returns (bool)',
];
const HOOK_ABI = (() => {
  const j = JSON.parse(fs.readFileSync('dashboard/src/abis/EswapMarginHook.json', 'utf8'));
  return Array.isArray(j) ? j : j.abi;
})();

const coder = ethers.AbiCoder.defaultAbiCoder();
const poolIdOf = (k) => ethers.keccak256(coder.encode(['address', 'address', 'uint24', 'int24', 'address'], [k.currency0, k.currency1, k.fee, k.tickSpacing, k.hooks]));
const HOOK_POOL_ID = poolIdOf(HOOK_KEY);
const FEE = {
  maxFeePerGas: BigInt(Math.round(Number(process.env.MAX_FEE_GWEI || '0.006') * 1e9)),
  maxPriorityFeePerGas: BigInt(Math.round(Number(process.env.PRIORITY_FEE_GWEI || '0.001') * 1e9)),
};
const fmt = (v) => ethers.formatUnits(v, 6);

function traderFor(venue) {
  return new ethers.Wallet(ethers.keccak256(ethers.toUtf8Bytes(`eswap-aggregator-live-v1/${venue}`)));
}

async function quoteLifi(fromAddress) {
  const u = `https://li.quest/v1/quote?fromChain=8453&toChain=8453&fromToken=${USDC}&toToken=${WETH}`
    + `&fromAmount=${NOTIONAL}&fromAddress=${fromAddress}&toAddress=${fromAddress}&slippage=${SLIPPAGE_BPS / 10000}`;
  const q = await (await fetch(u)).json();
  if (!q.transactionRequest) throw new Error(`li.quest: ${JSON.stringify(q).slice(0, 300)}`);
  const tr = q.transactionRequest;
  if (BigInt(tr.value || 0) !== 0n) throw new Error('li.quest route carries native value; not supported here');
  return {
    exchangeProxy: tr.to,
    callData: tr.data,
    expectedOut: BigInt(q.estimate.toAmount),
    minOut: BigInt(q.estimate.toAmountMin),
    raw: { tool: q.tool, approvalAddress: q.estimate.approvalAddress, gasLimit: tr.gasLimit },
  };
}

// WOOFi sPMM: the router's own on-chain quote, and the router's own swap entry
// point. The router pulls fromAmount from msg.sender (the aggregator-path caller)
// and sends toToken to `to`, so `to` is EswapRouter itself.
async function quoteWoofi(routerAddr) {
  const provider = getProvider();
  const w = new ethers.Contract(WOOFI, WOOFI_ABI, provider);
  const expectedOut = await w.querySwap(USDC, WETH, NOTIONAL);
  const minOut = (expectedOut * BigInt(10_000 - SLIPPAGE_BPS)) / 10_000n;
  const iface = new ethers.Interface(WOOFI_ABI);
  const callData = iface.encodeFunctionData('swap', [USDC, WETH, NOTIONAL, minOut, routerAddr, routerAddr]);
  return { exchangeProxy: WOOFI, callData, expectedOut, minOut, raw: { source: 'WOOFi Router V2.1 querySwap (on-chain sPMM quote)' } };
}

// 1inch Classic Aggregation Router V6: the live swap API builds the calldata
// for `from = router`. The API returns the router as `tx.to`, which must match
// the whitelisted proxy before anything is sent.
async function quoteOneInch(routerAddr) {
  const key = env.ONEINCH_API_KEY;
  if (!key) throw new Error('ONEINCH_API_KEY not set');
  const u = `https://api.1inch.dev/swap/v6.0/8453/swap?src=${USDC}&dst=${WETH}&amount=${NOTIONAL}`
    + `&from=${routerAddr}&origin=${routerAddr}&slippage=${SLIPPAGE_BPS / 100}&disableEstimate=true&includeTokensInfo=false`;
  const r = await fetch(u, { headers: { Authorization: `Bearer ${key}`, accept: 'application/json' } });
  const b = await r.json();
  if (!r.ok || !b.tx) throw new Error(`1inch ${r.status}: ${JSON.stringify(b).slice(0, 300)}`);
  if (ethers.getAddress(b.tx.to) !== ONEINCH_ROUTER) throw new Error(`1inch tx.to ${b.tx.to} is not the V6 router`);
  if (BigInt(b.tx.value || 0) !== 0n) throw new Error('1inch route carries native value; not supported here');
  const expectedOut = BigInt(b.dstAmount);
  return {
    exchangeProxy: ONEINCH_ROUTER,
    callData: b.tx.data,
    expectedOut,
    minOut: (expectedOut * BigInt(10_000 - SLIPPAGE_BPS)) / 10_000n,
    raw: { protocols: b.protocols?.length, gas: b.tx.gas },
  };
}

// Socket Swap V3 public endpoint (no API key). txData is a call to the Socket
// Allowance Holder, which pulls the input from msg.sender (EswapRouter) and
// forwards it to the Socket Open Router. We ask for the router as both the
// origin user and the receiver so the WETH output lands back on the router.
//
// Some providers misquote dust sizes by orders of magnitude, so routes are
// filtered against the median output before choosing the best one.
async function quoteSocket(routerAddr) {
  const base = {
    userOps: 'tx',
    originChainId: '8453',
    destinationChainId: '8453',
    inputToken: USDC,
    outputToken: WETH,
    inputAmount: NOTIONAL.toString(),
    userAddress: routerAddr,
    receiverAddress: routerAddr,
    slippage: (SLIPPAGE_BPS / 100).toString(),
  };
  // `contractCaller` tells Socket the on-chain caller is a contract (our
  // router). It is optional, so fall back to the plain quote if the API
  // rejects it rather than losing the run.
  const variants = [
    { ...base, contractCaller: process.env.SOCKET_CONTRACT_CALLER || routerAddr },
    base,
  ];

  let body = null;
  let lastErr = '';
  for (const [vi, params] of variants.entries()) {
    const qs = new URLSearchParams(params);
    for (let i = 0; i < 2; i++) {
      const r = await fetch(`${SOCKET_API}?${qs}`, { headers: { accept: 'application/json' } });
      const txt = await r.text();
      try {
        body = JSON.parse(txt);
      } catch {
        body = null;
      }
      if (body?.result?.routes?.length) break;
      lastErr = `HTTP ${r.status} ${txt.slice(0, 260)}`;
      // Never hammer a rate limit: each retry resets the window.
      if (r.status === 429) break;
      // A 400 here means the optional parameter was rejected; try the variant.
      if (r.status === 400 && vi === 0) break;
      await new Promise((res) => setTimeout(res, 1200 * (i + 1)));
    }
    if (body?.result?.routes?.length) break;
  }
  const routes = body?.result?.routes || [];
  if (!routes.length) throw new Error(`socket: ${lastErr || JSON.stringify(body).slice(0, 300)}`);

  const outs = routes.map((x) => BigInt(x.output.amount)).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const median = outs[Math.floor(outs.length / 2)];
  const sane = routes.filter((x) => {
    const o = BigInt(x.output.amount);
    return o * 2n >= median && o <= median * 2n;
  });
  // A dust-size canary should not pay 1M gas for a fraction of a basis point of
  // extra output, and a huge gas reservation also inflates the signer's
  // upfront gasLimit * maxFeePerGas balance requirement.
  const cheap = sane.filter((x) => Number(x.gasFee?.gasLimit || 0) <= SOCKET_MAX_GAS);
  const pool = cheap.length ? cheap : sane.length ? sane : routes;
  const pick = pool.reduce((a, b) => (BigInt(b.output.amount) > BigInt(a.output.amount) ? b : a));

  const to = ethers.getAddress(pick.txData.object.to);
  if (to !== SOCKET_ALLOWANCE_HOLDER) throw new Error(`socket tx.to ${to} is not the Socket Allowance Holder`);
  if (pick.approval && ethers.getAddress(pick.approval.spenderAddress) !== SOCKET_ALLOWANCE_HOLDER) {
    throw new Error(`socket approval spender ${pick.approval.spenderAddress} is not the Allowance Holder`);
  }
  if (BigInt(pick.txData.object.value || 0) !== 0n) throw new Error('socket route carries native value; not supported here');
  const now = Math.floor(Date.now() / 1000);
  if (Number(pick.expiresAt) <= now + 5) throw new Error(`socket quote expired (${pick.expiresAt} <= ${now})`);

  return {
    exchangeProxy: to,
    callData: pick.txData.object.data,
    expectedOut: BigInt(pick.output.amount),
    minOut: BigInt(pick.output.minAmountOut),
    raw: {
      provider: pick.routeDetails?.dexDetails?.protocol?.name,
      quoteId: pick.quoteId,
      expiresAt: pick.expiresAt,
      gasLimit: Number(pick.gasFee?.gasLimit || 0),
      routes: routes.length,
      rejected: routes.length - pool.length,
    },
  };
}

const VENUES = {
  lifi: { label: 'LI.FI Diamond', quote: quoteLifi },
  socket: { label: 'Socket Swap V3 (Allowance Holder)', quote: quoteSocket },
  woofi: { label: 'WOOFi Router V2.1 (sPMM)', quote: quoteWoofi },
  oneinch: { label: '1inch Classic Router V6', quote: quoteOneInch },
};

async function main() {
  const mode = process.argv[2] || 'sim';
  const only = (process.argv.find((a) => a.startsWith('--only=')) || '').split('=')[1];
  const venueKeys = Object.keys(VENUES).filter((k) => !only || only.split(',').includes(k));
  const provider = getProvider();
  const owner = new ethers.Wallet(env.PRIVATE_KEY, provider);
  const maker = new ethers.NonceManager(new ethers.Wallet(env.TINY_TRADER_PK, provider));
  const solver = new ethers.Wallet(env.SOLVER_PRIVATE_KEY, provider);
  const usdc = new ethers.Contract(USDC, ERC20_ABI, provider);
  const weth = new ethers.Contract(WETH, ERC20_ABI, provider);
  const router = new ethers.Contract(ROUTER, ROUTER_ABI, provider);
  const adapter = new ethers.Contract(ADAPTER, ADAPTER_ABI, provider);
  const hook = new ethers.Contract(HOOK, HOOK_ABI, provider);
  const blk = await provider.getBlock('latest');
  const out = { mode, startBlock: blk.number, startedAt: new Date().toISOString(), steps: [] };
  console.log(`mode ${mode}  block ${blk.number}  margin ${fmt(MARGIN)} @ ${LEVERAGE}x  notional ${fmt(NOTIONAL)}  venues ${venueKeys.join(',')}`);

  for (const v of venueKeys) {
    const t = traderFor(v);
    const trader = new ethers.NonceManager(new ethers.Wallet(t.privateKey, provider));
    console.log(`\n=== ${VENUES[v].label} (${v}) trader ${t.address}`);

    if (mode !== 'sim' && mode !== 'broadcast' && mode !== 'setup') throw new Error(`unknown mode ${mode}`);
    if (mode === 'setup' || mode === 'broadcast') {
      const solverUsdc = await usdc.balanceOf(solver.address);
      if (solverUsdc < MARGIN) {
        const tx = await usdc.connect(maker).transfer(solver.address, MARGIN - solverUsdc, { gasLimit: 80_000, ...FEE });
        await tx.wait();
        console.log(`funded solver borrow inventory ${fmt(MARGIN - solverUsdc)} USDC (${tx.hash})`);
      }
      const tu = await usdc.balanceOf(t.address);
      if (tu < MARGIN) {
        const tx = await usdc.connect(maker).transfer(t.address, MARGIN - tu, { gasLimit: 80_000, ...FEE });
        await tx.wait();
        console.log(`funded trader ${fmt(MARGIN - tu)} USDC (${tx.hash})`);
      }
      const te = await provider.getBalance(t.address);
      if (te < 11n * 10n ** 12n) {
        const tx = await maker.sendTransaction({ to: t.address, value: 12n * 10n ** 12n - te, gasLimit: 21_000, ...FEE });
        await tx.wait();
        console.log(`funded trader gas (${tx.hash})`);
      }
      if ((await usdc.allowance(t.address, ROUTER)) < NOTIONAL) {
        const tx = await usdc.connect(trader).approve(ROUTER, ethers.MaxUint256, { gasLimit: 90_000, ...FEE });
        await tx.wait();
        console.log(`trader approved router (${tx.hash})`);
      }
      if (mode === 'setup') continue;
    }

    let q;
    try {
      q = await VENUES[v].quote(ROUTER);
    } catch (e) {
      console.log(`  quote FAILED: ${e.message}`);
      out.steps.push({ venue: v, status: 'quote-failed', error: e.message });
      continue;
    }
    const src = q.raw.tool || q.raw.provider || '';
    console.log(`  quote: out ${q.expectedOut} wei WETH  minOut ${q.minOut}  proxy ${q.exchangeProxy}  calldata ${(q.callData.length - 2) / 2} B  tool ${src}`);

    const route = {
      exchangeProxy: q.exchangeProxy,
      tokenIn: USDC,
      tokenOut: WETH,
      sellAmount: NOTIONAL,
      value: 0n,
      callData: q.callData,
    };
    const args = [USDC, WETH, HOOK_KEY.fee, LEVERAGE, MARGIN, q.minOut, t.address, route];

    try {
      await adapter.connect(trader).exactInputSingleWithLeverageAggregator.staticCall(...args);
      console.log('  eth_call OK');
    } catch (e) {
      const msg = e.shortMessage || e.message;
      console.log(`  eth_call REVERTED: ${msg}`);
      out.steps.push({ venue: v, status: 'preflight-revert', error: msg, exchangeProxy: q.exchangeProxy });
      continue;
    }
    if (mode !== 'broadcast') {
      out.steps.push({ venue: v, status: 'preflight-ok', exchangeProxy: q.exchangeProxy, minOut: q.minOut.toString(), trader: t.address });
      continue;
    }

    const pre = {
      trader: (await usdc.balanceOf(t.address)).toString(),
      solver: (await usdc.balanceOf(solver.address)).toString(),
      routerWeth: (await weth.balanceOf(ROUTER)).toString(),
      routerUsdcToProxy: (await usdc.allowance(ROUTER, q.exchangeProxy)).toString(),
    };
    // The aggregator quote only covers the swap leg; the adapter's own open
    // (margin/borrow pull, hook validation, ERC-6909 mint, PoolManager settle,
    // LP deploy) is ~1.2M on top. Socket's route also reverts with a custom
    // gas-reserve error 0x0564e6be(remaining, 349488) if the calldata does not
    // arrive with enough gas left, so keep a wide floor: replaying the same
    // calldata at 1.60M reverts, 1.65M succeeds.
    const quotedGas = Number(q.raw.gasLimit || 0);
    const gasLimit = Math.min(2_000_000, Math.max(1_800_000, Math.ceil(quotedGas * 1.3) + 1_500_000));
    const reserve = BigInt(gasLimit) * FEE.maxFeePerGas;
    const signerEth = await provider.getBalance(t.address);
    if (signerEth < reserve) {
      const msg = `trader ${t.address} ETH ${signerEth} < gas reserve ${reserve} (gasLimit ${gasLimit} @ ${FEE.maxFeePerGas})`;
      console.log(`  UNFUNDED: ${msg}`);
      out.steps.push({ venue: v, status: 'unfunded', error: msg, exchangeProxy: q.exchangeProxy });
      continue;
    }
    console.log(`  gasLimit ${gasLimit} (quote ${quotedGas}) reserve ${reserve} wei  signer ${signerEth} wei`);

    // Persist the exact quote + calldata before sending so any rejection can be
    // replayed/traced later without asking Socket for another quote.
    fs.mkdirSync('scripts/v4/live/proofs', { recursive: true });
    const dump = {
      venue: v, trader: t.address, at: new Date().toISOString(), margin: MARGIN.toString(),
      notional: NOTIONAL.toString(), minOut: q.minOut.toString(), expectedOut: q.expectedOut.toString(),
      exchangeProxy: q.exchangeProxy, quote: q.raw, callData: q.callData, gasLimit,
      maxFeePerGas: FEE.maxFeePerGas.toString(), maxPriorityFeePerGas: FEE.maxPriorityFeePerGas.toString(),
    };
    const dumpFile = `scripts/v4/live/proofs/socket-attempt-${Date.now()}.json`;
    fs.writeFileSync(dumpFile, JSON.stringify(dump, null, 2));
    console.log(`  attempt saved ${dumpFile}`);

    try {
      const est = await adapter.connect(trader).exactInputSingleWithLeverageAggregator.estimateGas(...args);
      console.log(`  estimateGas ${est}`);
    } catch (e) {
      const d = e?.info?.error?.data || e?.data || e?.info?.error?.message;
      console.log(`  estimateGas FAILED: ${e.shortMessage || e.message}${d ? ` data=${typeof d === 'string' ? d : JSON.stringify(d)}` : ''}`);
    }

    let tx;
    try {
      tx = await adapter.connect(trader).exactInputSingleWithLeverageAggregator(...args, { gasLimit, ...FEE });
    } catch (e) {
      const d = e?.info?.error?.data || e?.data;
      console.log(`  SEND REJECTED: ${e.shortMessage || e.message}`);
      if (d) console.log(`    revert data: ${typeof d === 'string' ? d : JSON.stringify(d)}`);
      out.steps.push({ venue: v, status: 'send-rejected', error: e.shortMessage || e.message, revertData: d, exchangeProxy: q.exchangeProxy, callData: q.callData });
      continue;
    }
    const rc = await tx.wait();
    const pos = await hook.positions(HOOK_POOL_ID, t.address);
    const post = {
      trader: (await usdc.balanceOf(t.address)).toString(),
      solver: (await usdc.balanceOf(solver.address)).toString(),
      routerWeth: (await weth.balanceOf(ROUTER)).toString(),
      routerUsdcToProxy: (await usdc.allowance(ROUTER, q.exchangeProxy)).toString(),
    };
    const step = {
      venue: v,
      label: VENUES[v].label,
      status: rc.status === 1 ? 'filled' : 'reverted',
      tx: tx.hash,
      block: rc.blockNumber,
      gasUsed: rc.gasUsed.toString(),
      effectiveGasPrice: rc.gasPrice?.toString(),
      trader: t.address,
      exchangeProxy: q.exchangeProxy,
      quote: q.raw,
      minOut: q.minOut.toString(),
      expectedOut: q.expectedOut.toString(),
      before: pre,
      after: post,
      position: { collateral: pos.collateralAmount.toString(), borrowed: pos.borrowedAmount.toString(), leverage: Number(pos.leverage), isLong: pos.isLong, liquidity: pos.liquidity.toString(), tickLower: Number(pos.tickLower), tickUpper: Number(pos.tickUpper) },
      logs: rc.logs.length,
    };
    console.log(`  tx ${tx.hash} status ${rc.status} gas ${rc.gasUsed} block ${rc.blockNumber}`);
    console.log(`  collateral ${step.position.collateral}  liquidity ${step.position.liquidity}  ticks [${step.position.tickLower}, ${step.position.tickUpper}]`);
    out.steps.push(step);
  }

  out.finishedAt = new Date().toISOString();
  if (mode === 'broadcast' || mode === 'sim') {
    fs.mkdirSync('scripts/v4/live/proofs', { recursive: true });
    const file = `scripts/v4/live/proofs/new-aggregators-${mode}-${Date.now()}.json`;
    fs.writeFileSync(file, JSON.stringify(out, null, 2));
    console.log('\nwrote', file);
  }
}

main().catch((e) => {
  console.error('\nFAILED:', e.shortMessage || e.message);
  process.exit(1);
});
