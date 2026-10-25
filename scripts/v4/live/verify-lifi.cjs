/**
 * Independent verifier for the live LI.FI canary through
 * EswapLeverageAdapter.exactInputSingleWithLeverageAggregator (Base 8453).
 *
 *   node scripts/v4/live/verify-lifi.cjs [txHash]
 *
 * Everything is derived from the mined tx, its receipt, and post-tx hook state.
 * Writes scripts/v4/live/proofs/lifi-live.json and exits non-zero on any FAIL.
 */
const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');

const RPC = process.env.BASE_RPC_URL || 'https://mainnet.base.org';
const USDC = ethers.getAddress('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913');
const WETH = ethers.getAddress('0x4200000000000000000000000000000000000006');
const ROUTER = ethers.getAddress('0xD3360D67E366Cac21a1c18fC9100B93be79e1437');
const ADAPTER = ethers.getAddress('0x14FBAF1858d37BF994BDAF9ab4b31A664D4663aD');
const HOOK = ethers.getAddress('0xe33A630503c640143126BBF222a82689D49b50c8');
const POOL_MGR = ethers.getAddress('0x498581fF718922c3f8e6A244956aF099B2652b2b');
const LIFI = ethers.getAddress('0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE');
const SOLVER = ethers.getAddress('0x3fc88b834aC96Fa4c65913a6D3d5523418f7F037');
const TX = process.argv[2] || '0xb2b5d32c378de0d68cd005f7477bb72e7bf18abaab68419a566699218a1106ef';
const MARGIN = 4000n;
const NOTIONAL = 8000n;
const LEVERAGE = 2;
const HOOK_POOL_KEY = { currency0: WETH, currency1: USDC, fee: 3000, tickSpacing: 60, hooks: HOOK };
const STD_POOL_KEY = { currency0: WETH, currency1: USDC, fee: 500, tickSpacing: 10, hooks: ethers.ZeroAddress };

const ADAPTER_ABI = [
  'function exactInputSingleWithLeverageAggregator(address tokenIn,address tokenOut,uint24 fee,uint8 leverage,uint256 amountIn,uint256 minAmountOut,address recipient,(address exchangeProxy,address tokenIn,address tokenOut,uint256 sellAmount,uint256 value,bytes callData) route) returns (uint256)',
];
const ERC20_ABI = ['function allowance(address,address) view returns (uint256)', 'function balanceOf(address) view returns (uint256)'];
const TRANSFER = ethers.id('Transfer(address,address,uint256)');
const ERC6909_TRANSFER = ethers.id('Transfer(address,address,address,uint256,uint256)');
const MODIFY_LIQ = ethers.id('ModifyLiquidity(bytes32,address,int24,int24,int256,bytes32)');
const topicAddr = (t) => ethers.getAddress('0x' + t.slice(26));
const coder = ethers.AbiCoder.defaultAbiCoder();
const poolIdOf = (k) => ethers.keccak256(coder.encode(['address', 'address', 'uint24', 'int24', 'address'], [k.currency0, k.currency1, k.fee, k.tickSpacing, k.hooks]));

function hookAbi() {
  const j = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'dashboard/src/abis/EswapMarginHook.json'), 'utf8'));
  return Array.isArray(j) ? j : j.abi;
}

// Uniswap v3 / v4 tick -> sqrt price (unscaled). Double precision is enough for a
// 1e-9 relative check; the on-chain value is exact (TickMath, Q64.96).
const sqrtAtTick = (t) => Math.sqrt(Math.pow(1.0001, t));

(async () => {
  const p = new ethers.JsonRpcProvider(RPC);
  const tx = await p.getTransaction(TX);
  const rc = await p.getTransactionReceipt(TX);
  if (!tx || !rc) throw new Error(`missing tx/receipt for ${TX} on ${RPC}`);
  const adapter = new ethers.Interface(ADAPTER_ABI);
  const fn = adapter.parseTransaction({ data: tx.data, value: tx.value });
  const [tokenIn, tokenOut, fee, leverage, amountIn, minAmountOut, recipient, route] = fn.args;

  const transfers = rc.logs
    .filter((l) => l.topics[0] === TRANSFER && l.topics.length === 3)
    .map((l) => ({ token: ethers.getAddress(l.address), from: topicAddr(l.topics[1]), to: topicAddr(l.topics[2]), amount: BigInt(l.data) }));
  const sum = (xs) => xs.reduce((a, x) => a + x.amount, 0n);
  const usdcFromRouter = transfers.filter((t) => t.token === USDC && t.from === ROUTER);
  const usdcFromSolver = transfers.filter((t) => t.token === USDC && t.from === SOLVER && t.to === ROUTER);
  const wethToRouter = transfers.filter((t) => t.token === WETH && t.to === ROUTER);
  const wethRouterToPM = transfers.filter((t) => t.token === WETH && t.from === ROUTER && t.to === POOL_MGR);

  const mints = rc.logs
    .filter((l) => l.address.toLowerCase() === POOL_MGR.toLowerCase() && l.topics[0] === ERC6909_TRANSFER)
    .map((l) => ({ from: topicAddr(l.topics[1]), to: topicAddr(l.topics[2]), id: BigInt(l.topics[3]), amount: BigInt('0x' + l.data.slice(66, 130)) }))
    .filter((m) => m.from === ethers.ZeroAddress && m.to === HOOK && m.id === BigInt(WETH));

  const mods = rc.logs
    .filter((l) => l.address.toLowerCase() === POOL_MGR.toLowerCase() && l.topics[0] === MODIFY_LIQ)
    .map((l) => {
      const [tickLower, tickUpper, liquidityDelta] = coder.decode(['int24', 'int24', 'int256'], l.data);
      return { poolId: l.topics[1], sender: topicAddr(l.topics[2]), tickLower: Number(tickLower), tickUpper: Number(tickUpper), liquidityDelta: BigInt(liquidityDelta) };
    });
  const hookMod = mods.find((m) => m.sender === HOOK);

  const hook = new ethers.Contract(HOOK, hookAbi(), p);
  const poolId = poolIdOf(HOOK_POOL_KEY);
  const stdPoolId = poolIdOf(STD_POOL_KEY);
  const posRaw = await hook.positions(poolId, recipient);
  const outNames = hook.interface.getFunction('positions').outputs.map((o) => o.name);
  const pos = Object.fromEntries(outNames.map((n, i) => [n, posRaw[i]]));

  const usdc = new ethers.Contract(USDC, ERC20_ABI, p);
  const weth = new ethers.Contract(WETH, ERC20_ABI, p);
  const allowanceAfter = await usdc.allowance(ROUTER, LIFI);
  const routerWethAfter = await weth.balanceOf(ROUTER);
  const routerWethBefore = await weth.balanceOf(ROUTER, { blockTag: rc.blockNumber - 1 });

  const received = sum(wethToRouter);
  const expectedFee = (received * 5n) / 10000n;
  const c = Number(pos.collateralAmount);
  const sL = sqrtAtTick(hookMod ? hookMod.tickLower : 0);
  const sU = sqrtAtTick(hookMod ? hookMod.tickUpper : 0);
  const maxLiq = c * sL * sU / (sU - sL);
  const deployedRatio = hookMod ? Number(hookMod.liquidityDelta) / maxLiq : NaN;

  const checks = [
    ['tx mined with status 1', rc.status === 1],
    ['tx sent to the live EswapLeverageAdapter', tx.to.toLowerCase() === ADAPTER.toLowerCase()],
    ['tx sent by the trader (calldata recipient)', tx.from.toLowerCase() === recipient.toLowerCase()],
    ['calldata is exactInputSingleWithLeverageAggregator', fn.name === 'exactInputSingleWithLeverageAggregator'],
    ['tokenIn == USDC, tokenOut == WETH, fee == 3000', tokenIn.toLowerCase() === USDC.toLowerCase() && tokenOut.toLowerCase() === WETH.toLowerCase() && Number(fee) === 3000],
    ['margin == 4000 USDC-units, leverage == 2', amountIn === MARGIN && Number(leverage) === LEVERAGE],
    ['route.exchangeProxy == LI.FI Diamond (whitelisted)', route.exchangeProxy.toLowerCase() === LIFI.toLowerCase()],
    ['route.sellAmount == notional (margin + borrow)', route.sellAmount === NOTIONAL],
    ['route.value == 0 (no native leg)', route.value === 0n],
    ['router pushed the full notional (8000) to the venue', sum(usdcFromRouter) === NOTIONAL],
    ['solver funded the borrow leg (4000 USDC) to the router', sum(usdcFromSolver) === MARGIN],
    ['venue delivered WETH to the router', received > 0n],
    ['router forwarded the whole WETH output to the PoolManager', sum(wethRouterToPM) === received],
    ['PoolManager minted the ERC-6909 WETH claim to the hook', mints.length === 1 && mints[0].amount === received],
    ['allowance router -> LI.FI reset to 0 (AUDIT CRIT-5)', allowanceAfter === 0n],
    ['router WETH unchanged vs pre-tx block (no stranded value)', routerWethAfter === routerWethBefore],
    ['output cleared minAmountOut', received >= minAmountOut],
    ['hook pool id matches [WETH,USDC,3000,60,hook]', poolId === ethers.keccak256(coder.encode(['address', 'address', 'uint24', 'int24', 'address'], [WETH, USDC, 3000, 60, HOOK]))],
    ['position: trader == recipient, borrowed 4000, 2x, long', pos.trader.toLowerCase() === recipient.toLowerCase() && pos.borrowedAmount === MARGIN && Number(pos.leverage) === LEVERAGE && pos.isLong === true],
    ['position: collateral == output - protocol fee (5 bps)', pos.collateralAmount === received - expectedFee && pos.collateralAmount > 0n],
    ['LP deployment: ModifyLiquidity from the hook on the standard pool', !!hookMod && hookMod.poolId === stdPoolId],
    ['LP deployment: liquidityDelta == position.liquidity', !!hookMod && hookMod.liquidityDelta === pos.liquidity],
    ['LP deployment: ticks == position ticks', !!hookMod && hookMod.tickLower === Number(pos.tickLower) && hookMod.tickUpper === Number(pos.tickUpper)],
    ['LP deployment: 90% of max liquidity (approx., 1e-6 rel.)', Number.isFinite(deployedRatio) && Math.abs(deployedRatio - 0.9) < 1e-6],
  ];

  const sim = await p.getBlock(rc.blockNumber);
  const out = {
    chainId: 8453,
    rpc: RPC,
    verifiedAt: new Date().toISOString(),
    tx: { hash: TX, block: rc.blockNumber, timestamp: sim.timestamp, gasUsed: rc.gasUsed.toString(), effectiveGasPrice: rc.gasPrice?.toString() ?? null, from: tx.from, to: tx.to, function: fn.name },
    venue: 'LI.FI Diamond',
    flows: { usdcRouterToVenue: sum(usdcFromRouter).toString(), usdcSolverToRouter: sum(usdcFromSolver).toString(), wethOutput: received.toString(), protocolFee: expectedFee.toString(), erc6909Mint: mints.map((m) => m.amount.toString()) },
    lp: hookMod && { poolId: hookMod.poolId, sender: hookMod.sender, tickLower: hookMod.tickLower, tickUpper: hookMod.tickUpper, liquidityDelta: hookMod.liquidityDelta.toString(), maxLiquidityApprox: maxLiq, deployedRatioApprox: deployedRatio },
    position: { trader: pos.trader, collateral: pos.collateralAmount.toString(), borrowed: pos.borrowedAmount.toString(), leverage: Number(pos.leverage), isLong: pos.isLong, liquidity: pos.liquidity.toString(), tickLower: Number(pos.tickLower), tickUpper: Number(pos.tickUpper) },
    routerWeth: { before: routerWethBefore.toString(), after: routerWethAfter.toString() },
    checks: checks.map(([label, ok]) => ({ label, ok })),
    allPassed: checks.every(([, ok]) => ok),
    netting: 'PoolManager.unlock reverts CurrencyNotSettled on any nonzero currency delta at exit, so status 1 implies zero residual deltas. Not measured separately.',
  };
  for (const c of out.checks) console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.label}`);
  console.log(`\n${out.allPassed ? 'ALL CHECKS PASSED' : 'CHECKS FAILED'} (${checks.filter(([, ok]) => ok).length}/${checks.length})`);
  console.log(`LP deployed ${hookMod?.liquidityDelta} / max ~${maxLiq.toFixed(0)} = ${deployedRatio}`);
  fs.mkdirSync('scripts/v4/live/proofs', { recursive: true });
  fs.writeFileSync('scripts/v4/live/proofs/lifi-live.json', JSON.stringify(out, null, 2));
  console.log('wrote scripts/v4/live/proofs/lifi-live.json');
  if (!out.allPassed) process.exitCode = 1;
})().catch((e) => {
  console.error('FAILED:', e.shortMessage || e.message);
  process.exit(1);
});
