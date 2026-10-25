/**
 * Independent verifier for the live B2B aggregator-route fills on Base.
 *
 *   node scripts/v4/live/verify-aggregator.cjs            # all four venues
 *   node scripts/v4/live/verify-aggregator.cjs <txHash>   # one venue
 *
 * Every assertion is derived from the MINED transaction + receipt alone:
 * the router calldata (SwapParams + AggregatorRoute), the ERC20 Transfer logs,
 * the V4 PoolManager ERC-6909 mint log and the hook's MultiPoolMarginOpened
 * event, plus the hook's post-fill position storage. Writes
 * scripts/v4/live/proofs/aggregator-live.json and exits non-zero on any FAIL.
 */
const { ethers } = require('ethers');
const fs = require('fs');

const RPC = process.env.BASE_RPC_URL || 'https://mainnet.base.org';
const CHAIN_ID = 8453;
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const WETH = '0x4200000000000000000000000000000000000006';
const ROUTER = '0xD3360D67E366Cac21a1c18fC9100B93be79e1437';
const HOOK = '0xe33A630503c640143126BBF222a82689D49b50c8';
const POOL_MGR = '0x498581fF718922c3f8e6A244956aF099B2652b2b';
const SOLVER = '0x3fc88b834aC96Fa4c65913a6D3d5523418f7F037';
const HOOK_POOL_ID = '0xdd4958586bcbc340177b3b18ecbf31cfa277e5a8a78735deee01218f54a1d512';

const MARGIN = 4000n;
const NOTIONAL = 8000n;
const LEVERAGE = 2;
const PROTOCOL_FEE_BPS = 5n; // reserveFactor() read live by the harness earlier

const VENUES = {
  '0x': {
    label: '0x Swap API v2 (allowance-holder)',
    proxy: '0x0000000000001fF3684f28c67538d4D072C22734',
    tx: '0x939b12470ae54395f8489cd9a9226fb7d2ca003e406bdb2abd98d8015130f284',
  },
  enso: {
    label: 'Enso Router V2',
    proxy: '0xF75584eF6673aD213a685a1B58Cc0330B8eA22Cf',
    tx: '0x15651c9304c96354dc9504a938b5fb548dec30dfc46dcf34c8f3b66ba0b89fb8',
  },
  paraswap: {
    label: 'ParaSwap Augustus V6.2',
    proxy: '0x6A000F20005980200259B80c5102003040001068',
    tx: '0x01db75552ba9d6cda07b53c7b4ffd64c2b1a534ce792ea5291a2c7769fa41b02',
  },
  kyber: {
    label: 'KyberSwap MetaAggregationRouterV2',
    proxy: '0x6131B5fae19EA4f9D964eAc0408E4408b66337b5',
    tx: '0xb7ca843014e0bb7a1cc5ca9bac185a62287b2210882381360fd0a745d34b2cac',
  },
  openocean: {
    label: 'OpenOcean Exchange',
    proxy: '0x6352a56caadC4F1E25CD6c75970Fa768A3304e64',
    tx: '0xfc6cdeea65115322226a83035d94bf50cd49e4138572bc487315039f96ea4daf',
  },
};

const TRANSFER_TOPIC = ethers.id('Transfer(address,address,uint256)');
const ERC6909_TRANSFER_TOPIC = ethers.id('Transfer(address,address,address,uint256,uint256)');
const topicAddr = (t) => ethers.getAddress('0x' + t.slice(26));
const STALE_RECEIVER = '0x0E5a7a0e5A7A0e5a7A0e5A7a0e5a7a0e5A7a0e5A'.toLowerCase();

function abiOf(file) {
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  return Array.isArray(j) ? j : j.abi;
}

const coder = ethers.AbiCoder.defaultAbiCoder();
const poolIdOf = (k) => ethers.keccak256(coder.encode(['address', 'address', 'uint24', 'int24', 'address'], [k.currency0, k.currency1, k.fee, k.tickSpacing, k.hooks]));

async function verifyVenue(p, router, hook, venue, txHash) {
  const tx = await p.getTransaction(txHash);
  const rc = await p.getTransactionReceipt(txHash);
  if (!tx || !rc) throw new Error(`missing tx/receipt for ${txHash} on ${RPC}`);

  const fn = router.interface.parseTransaction({ data: tx.data, value: tx.value });
  const [params, trader, route] = fn.args;
  const key = params.key;
  const poolId = poolIdOf(key);

  const transfers = rc.logs
    .filter((l) => l.topics[0] === TRANSFER_TOPIC && l.topics.length === 3)
    .map((l) => ({
      logIndex: l.index,
      token: ethers.getAddress(l.address),
      from: topicAddr(l.topics[1]),
      to: topicAddr(l.topics[2]),
      amount: BigInt(l.data),
    }));

  const routerUsdcOut = transfers.filter((t) => t.token === ethers.getAddress(USDC) && t.from === ethers.getAddress(ROUTER));
  const solverUsdcOut = transfers.filter((t) => t.token === ethers.getAddress(USDC) && t.from === ethers.getAddress(SOLVER));
  const routerWethIn = transfers.filter((t) => t.token === ethers.getAddress(WETH) && t.to === ethers.getAddress(ROUTER));
  const routerWethOut = transfers.filter((t) => t.token === ethers.getAddress(WETH) && t.from === ethers.getAddress(ROUTER));
  const wethToManager = routerWethOut.filter((t) => t.to === ethers.getAddress(POOL_MGR));

  const sum = (xs, f = (x) => x.amount) => xs.reduce((a, x) => a + f(x), 0n);

  // hook event
  const hookEvents = rc.logs
    .filter((l) => l.address.toLowerCase() === HOOK.toLowerCase())
    .map((l) => { try { return { logIndex: l.index, parsed: hook.interface.parseLog({ topics: l.topics, data: l.data }) }; } catch { return null; } })
    .filter((x) => x && x.parsed && x.parsed.name === 'MultiPoolMarginOpened');
  const opened = hookEvents[0] && {
    logIndex: hookEvents[0].logIndex,
    poolId: hookEvents[0].parsed.args.poolId ?? hookEvents[0].parsed.args[0],
    trader: hookEvents[0].parsed.args.trader ?? hookEvents[0].parsed.args[1],
    leverage: Number(hookEvents[0].parsed.args.leverage ?? hookEvents[0].parsed.args[2]),
    marginAmount: BigInt(hookEvents[0].parsed.args.marginAmount ?? hookEvents[0].parsed.args[3]),
    boughtAmount: BigInt(hookEvents[0].parsed.args.boughtAmount ?? hookEvents[0].parsed.args[4]),
  };

  // ERC-6909 claim minted to the hook: v4-core emits
  // Transfer(address caller, address indexed from, address indexed to, uint256 indexed id, uint256 amount)
  const erc6909Mints = rc.logs
    .filter((l) => l.address.toLowerCase() === POOL_MGR.toLowerCase() && l.topics[0] === ERC6909_TRANSFER_TOPIC)
    .map((l) => ({
      logIndex: l.index,
      caller: topicAddr('0x' + l.data.slice(2, 66)),
      from: topicAddr(l.topics[1]),
      to: topicAddr(l.topics[2]),
      id: BigInt(l.topics[3]),
      amount: BigInt('0x' + l.data.slice(66, 130)),
    }))
    .filter((m) => m.from === ethers.ZeroAddress && m.to === ethers.getAddress(HOOK) && m.id === BigInt(WETH));

  const pos = await hook.positions(poolId, trader);
  const erc20abi = ['function allowance(address,address) view returns (uint256)', 'function balanceOf(address) view returns (uint256)'];
  const allowance = await new ethers.Contract(USDC, erc20abi, p).allowance(ROUTER, route.exchangeProxy);
  const wethAt = new ethers.Contract(WETH, erc20abi, p);
  const routerWethBal = await wethAt.balanceOf(ROUTER);
  const routerWethBefore = await wethAt.balanceOf(ROUTER, { blockTag: rc.blockNumber - 1 });

  const received = sum(routerWethIn);
  const expectedFee = (received * PROTOCOL_FEE_BPS) / 10000n;

  const checks = [
    ['tx mined with status 1', rc.status === 1],
    ['tx sent to the live EswapRouter', tx.to.toLowerCase() === ROUTER.toLowerCase()],
    ['tx sent by the trader encoded in calldata', tx.from.toLowerCase() === trader.toLowerCase()],
    ['calldata is swapMultiPoolForAggregator(SwapParams,address,AggregatorRoute)', fn.name === 'swapMultiPoolForAggregator'],
    [`route.exchangeProxy is the ${venue.label} proxy`, route.exchangeProxy.toLowerCase() === venue.proxy.toLowerCase()],
    ['route.tokenIn == USDC', route.tokenIn.toLowerCase() === USDC.toLowerCase()],
    ['route.tokenOut == WETH', route.tokenOut.toLowerCase() === WETH.toLowerCase()],
    ['route.sellAmount == notional (margin + borrow)', route.sellAmount === NOTIONAL],
    ['route.value == 0 (no native leg)', route.value === 0n],
    ['params: USDC -> WETH long', params.zeroForOne === false],
    ['params: 2x leverage, margin 4000 USDC-units', params.leverage === BigInt(LEVERAGE) && params.amountSpecified === -MARGIN],
    ['params.solver == registered solver', params.solver.toLowerCase() === SOLVER.toLowerCase()],
    ['params.key is the hook pool [WETH,USDC,3000,60,hook]', poolId === HOOK_POOL_ID],
    ['params.standardPoolKey is the std [WETH,USDC,500,10,0x0] pool', params.standardPoolKey.fee === 500n && params.standardPoolKey.tickSpacing === 10n && params.standardPoolKey.hooks === ethers.ZeroAddress],
    ['fill is NOT replaying the stale fixture taker', route.callData.toLowerCase().includes(STALE_RECEIVER) === false],
    ['router USDC out to the venue == notional (8000)', sum(routerUsdcOut) === NOTIONAL],
    ['solver funded the borrow leg directly (4000 USDC)', sum(solverUsdcOut) === MARGIN],
    ['venue delivered WETH to the router (output > 0)', routerWethIn.length > 0 && received > 0n],
    ['router forwarded the whole output to the PoolManager', sum(wethToManager) === received],
    ['PoolManager minted the ERC-6909 WETH claim to the hook', erc6909Mints.length === 1 && erc6909Mints[0].amount === received && erc6909Mints[0].caller.toLowerCase() === ROUTER.toLowerCase()],
    ['hook emitted MultiPoolMarginOpened(poolId, trader, 2, 4000, received)', !!opened && opened.poolId === poolId && opened.trader.toLowerCase() === trader.toLowerCase() && opened.leverage === LEVERAGE && opened.marginAmount === MARGIN && opened.boughtAmount === received],
    ['position.collateral == output - protocol fee', pos[1] === received - expectedFee && pos[1] > 0n],
    ['position.borrowed == 4000 USDC-units, 2x, long', pos[2] === MARGIN && Number(pos[3]) === LEVERAGE && pos[4] === true],
    ['position.trader == calldata trader', pos[0].toLowerCase() === trader.toLowerCase()],
    ['output cleared minAmountOut', received >= params.minAmountOut],
    ['fill left no dangling WETH at the router (balance unchanged vs pre-fill block)', routerWethBal === routerWethBefore],
    ['venue allowance reset to 0 (AUDIT CRIT-5)', allowance === 0n],
  ];

  return {
    venue: venue.label,
    proxy: venue.proxy,
    tx: { hash: txHash, url: `https://basescan.org/tx/${txHash}`, block: rc.blockNumber, gasUsed: rc.gasUsed.toString(), effectiveGasPrice: rc.gasPrice?.toString() ?? null, from: tx.from, to: tx.to, function: fn.name },
    call: {
      trader,
      solver: params.solver,
      key: { currency0: key.currency0, currency1: key.currency1, fee: Number(key.fee), tickSpacing: Number(key.tickSpacing), hooks: key.hooks },
      poolId,
      zeroForOne: params.zeroForOne,
      amountSpecified: params.amountSpecified.toString(),
      leverage: Number(params.leverage),
      minAmountOut: params.minAmountOut.toString(),
      deadline: params.deadline.toString(),
      route: { exchangeProxy: route.exchangeProxy, tokenIn: route.tokenIn, tokenOut: route.tokenOut, sellAmount: route.sellAmount.toString(), value: route.value.toString(), callDataLen: (route.callData.length - 2) / 2, callDataSelector: route.callData.slice(0, 10) },
    },
    flows: {
      routerUsdcToVenue: routerUsdcOut.map((t) => ({ to: t.to, amount: t.amount.toString() })),
      solverUsdcToRouter: solverUsdcOut.map((t) => ({ from: t.from, to: t.to, amount: t.amount.toString() })),
      wethIntoRouter: routerWethIn.map((t) => ({ from: t.from, amount: t.amount.toString() })),
      wethRouterToManager: wethToManager.map((t) => ({ to: t.to, amount: t.amount.toString() })),
      erc6909Mints: erc6909Mints.map((m) => ({ caller: m.caller, from: m.from, to: m.to, id: m.id.toString(), amount: m.amount.toString() })),
      output: received.toString(),
      protocolFee: expectedFee.toString(),
    },
    event: opened && { poolId: opened.poolId, trader: opened.trader, leverage: opened.leverage, marginAmount: opened.marginAmount.toString(), boughtAmount: opened.boughtAmount.toString() },
    position: { trader: pos[0], collateral: pos[1].toString(), borrowed: pos[2].toString(), leverage: Number(pos[3]), isLong: pos[4] },
    routerWeth: { before: routerWethBefore.toString(), after: routerWethBal.toString() },
    checks: checks.map(([label, ok]) => ({ label, ok })),
    allPassed: checks.every(([, ok]) => ok),
  };
}

async function main() {
  const single = process.argv[2];
  const p = new ethers.JsonRpcProvider(RPC);
  const router = new ethers.Contract(ROUTER, abiOf('out/EswapRouter.sol/EswapRouter.json'), p);
  const hook = new ethers.Contract(HOOK, abiOf('out/EswapMarginHook.sol/EswapMarginHook.json'), p);

  const targets = single
    ? Object.entries(VENUES).filter(([, v]) => v.tx.toLowerCase() === single.toLowerCase())
    : Object.entries(VENUES);

  const proof = { chainId: CHAIN_ID, rpc: RPC, verifiedAt: new Date().toISOString(), router: ROUTER, hook: HOOK, poolManager: POOL_MGR, venues: [] };

  for (const [id, venue] of targets) {
    const res = await verifyVenue(p, router, hook, venue, single || venue.tx);
    proof.venues.push({ id, ...res });
    console.log(`\n=== ${venue.label}  ${venue.tx}`);
    console.log(`block ${res.tx.block}  gas ${res.tx.gasUsed}  output ${ethers.formatEther(res.flows.output)} WETH  collateral ${res.position.collateral}`);
    for (const c of res.checks) console.log(`  ${c.ok ? 'PASS' : 'FAIL'}  ${c.label}`);
    console.log(`  -> ${res.allPassed ? 'ALL CHECKS PASSED' : 'CHECKS FAILED'} (${res.checks.filter((c) => c.ok).length}/${res.checks.length})`);
  }

  proof.allPassed = proof.venues.every((v) => v.allPassed);
  proof.totalChecks = proof.venues.reduce((a, v) => a + v.checks.length, 0);
  proof.passedChecks = proof.venues.reduce((a, v) => a + v.checks.filter((c) => c.ok).length, 0);

  fs.mkdirSync('scripts/v4/live/proofs', { recursive: true });
  fs.writeFileSync('scripts/v4/live/proofs/aggregator-live.json', JSON.stringify(proof, null, 2));
  console.log(`\n${proof.allPassed ? 'ALL VENUES PASSED' : 'SOME VENUES FAILED'}  (${proof.passedChecks}/${proof.totalChecks} checks)`);
  console.log('wrote scripts/v4/live/proofs/aggregator-live.json');
  if (!proof.allPassed) process.exitCode = 1;
}

main().catch((e) => { console.error('FAILED:', e.shortMessage || e.message); process.exit(1); });
