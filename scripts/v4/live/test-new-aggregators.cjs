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
 *   lifi       LI.FI Diamond (quote via li.quest)   implemented, runs here
 *   socket     Socket Gateway                       blocked: SOCKET_API_KEY is not set
 *   woofi      WOOFi Router V2.1                    whitelisted; no quote adapter yet
 *   1inch      AggregationRouterV6                  already whitelisted; no quote adapter yet
 *   openocean  OpenOcean Router                     proven in §13; re-run needs funding
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

const VENUES = {
  lifi: { label: 'LI.FI Diamond', quote: quoteLifi },
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
    console.log(`  quote: out ${q.expectedOut} wei WETH  minOut ${q.minOut}  proxy ${q.exchangeProxy}  calldata ${(q.callData.length - 2) / 2} B  tool ${q.raw.tool}`);

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
    const tx = await adapter.connect(trader).exactInputSingleWithLeverageAggregator(...args, { gasLimit: 1_800_000, ...FEE });
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
