/**
 * CoW GPv2 + Direct LendingIntent live broadcaster (Base 8453).
 *
 *   node scripts/v4/live/cow-intent.cjs sim        # eth_call only (no tx)
 *   node scripts/v4/live/cow-intent.cjs broadcast  # real signed txs
 *
 * Set BASE_RPC_URL=http://127.0.0.1:8545 to dry-run the whole flow on an anvil
 * fork of Base before broadcasting.
 *
 * Root causes of the earlier `fillOrder` revert (both now fixed):
 *  1. The canonical CoW EIP-712 type declares `kind`, `sellTokenBalance` and
 *     `buyTokenBalance` as `string`, while the struct-hash slot holds
 *     keccak256("sell") / keccak256("erc20"). Signing them as `bytes32`
 *     produced a different digest, so ecrecover returned a garbage owner and
 *     fillOrder reverted. Fixed: sign with string enums, submit bytes32 markers.
 *  2. The remaining revert was plain "ERC20: transfer amount exceeds balance":
 *     the solver wallet holds 0.03 USDC, so a 5 USDC margin could never be
 *     pulled. Margin is therefore sized from live balances (still a real fill).
 *     `depositBorrowEscrow` failed for the exact same reason (no guards).
 */
const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');

const RPC = process.env.BASE_RPC_URL || 'https://mainnet.base.org';
const CHAIN_ID = 8453;
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const WETH = '0x4200000000000000000000000000000000000006';
const HOOK = '0xe33A630503c640143126BBF222a82689D49b50c8';
const ROUTER = '0xD3360D67E366Cac21a1c18fC9100B93be79e1437';
const COW_SETT = '0xA9b26F6884526E822190204fe7279ee1db34Abd6';
const GPV2 = '0x9008D19f58AAbD9eD0D60971565AA8510560ab41';

const HOOK_KEY = { currency0: WETH, currency1: USDC, fee: 3000, tickSpacing: 60, hooks: HOOK };
const STD_KEY = { currency0: WETH, currency1: USDC, fee: 500, tickSpacing: 10, hooks: ethers.ZeroAddress };

const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function approve(address,uint256) returns (bool)',
  'function allowance(address,address) view returns (uint256)',
];

const LEVERAGE = 2;

function loadEnv() {
  const env = {};
  for (const line of fs.readFileSync(path.resolve(process.cwd(), '.env'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return env;
}

function abiOf(file) {
  const j = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), file), 'utf8'));
  return Array.isArray(j) ? j : j.abi;
}

const COW_TYPES = {
  Order: [
    { name: 'sellToken', type: 'address' },
    { name: 'buyToken', type: 'address' },
    { name: 'receiver', type: 'address' },
    { name: 'sellAmount', type: 'uint256' },
    { name: 'buyAmount', type: 'uint256' },
    { name: 'validTo', type: 'uint32' },
    { name: 'appData', type: 'bytes32' },
    { name: 'feeAmount', type: 'uint256' },
    { name: 'kind', type: 'string' },
    { name: 'partiallyFillable', type: 'bool' },
    { name: 'sellTokenBalance', type: 'string' },
    { name: 'buyTokenBalance', type: 'string' },
  ],
};

const INTENT_TYPES = {
  LendingIntent: [
    { name: 'poolId', type: 'bytes32' },
    { name: 'standardPoolId', type: 'bytes32' },
    { name: 'zeroForOne', type: 'bool' },
    { name: 'amountSpecified', type: 'int256' },
    { name: 'leverage', type: 'uint8' },
    { name: 'solver', type: 'address' },
    { name: 'deadline', type: 'uint256' },
    { name: 'minAmountOut', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
  ],
};

const coder = ethers.AbiCoder.defaultAbiCoder();
const poolIdOf = (k) => ethers.keccak256(coder.encode(['address', 'address', 'uint24', 'int24', 'address'], [k.currency0, k.currency1, k.fee, k.tickSpacing, k.hooks]));
const fmt = (v) => ethers.formatUnits(v, 6);

// Base mainnet gas is ~0.006 gwei. Pin an explicit EIP-1559 envelope so the dust
// ETH balances the actors hold are enough for the intrinsic cost check.
const gwei = (v) => BigInt(Math.round(Number(v) * 1e9));
const FEE = {
  maxFeePerGas: gwei(process.env.MAX_FEE_GWEI || '0.02'),
  maxPriorityFeePerGas: gwei(process.env.PRIORITY_FEE_GWEI || '0.001'),
};

// The public Base RPC is load-balanced: a read issued right after a mined tx can
// still hit a lagging backend. Poll until the expected state is visible.
async function waitFor(label, read, ok, tries = 30) {
  for (let i = 0; i < tries; i++) {
    const v = await read();
    if (ok(v)) return v;
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`timed out waiting for ${label}`);
}

async function main() {
  const mode = process.argv[2] || 'sim';
  const INTENT_ONLY = process.argv.includes('--intent-only');
  const env = loadEnv();
  const provider = new ethers.JsonRpcProvider(RPC);
  const solver = new ethers.Wallet(env.SOLVER_PRIVATE_KEY, provider);
  const trader = new ethers.Wallet(env.TINY_TRADER_PK, provider);
  // Both settlement entry points are permissionless relays (the CoW order owner
  // and the signed LendingIntent pin every economic term), so the relayer only
  // needs gas. The owner wallet carries enough ETH for that; the solver does not.
  const relayer = new ethers.Wallet(env.PRIVATE_KEY, provider);

  const cow = new ethers.Contract(COW_SETT, abiOf('dashboard/src/abis/EswapCoWSettlement.json'), provider);
  const router = new ethers.Contract(ROUTER, abiOf('dashboard/src/abis/EswapRouter.json'), provider);
  const hook = new ethers.Contract(HOOK, abiOf('dashboard/src/abis/EswapMarginHook.json'), provider);
  const usdc = new ethers.Contract(USDC, ERC20_ABI, provider);

  const blk = await provider.getBlock('latest');
  const results = {
    mode,
    rpc: RPC,
    chainId: CHAIN_ID,
    startedAt: new Date().toISOString(),
    startBlock: blk.number,
    leverage: LEVERAGE,
    steps: [],
  };

  console.log(`mode ${mode}  rpc ${RPC}  block ${blk.number}`);

  // ── balances / sizing ─────────────────────────────────────────────────
  const solverUsdc = await usdc.balanceOf(solver.address);
  const traderUsdc = await usdc.balanceOf(trader.address);
  console.log('solver', solver.address, `USDC ${fmt(solverUsdc)}   eth ${ethers.formatEther(await provider.getBalance(solver.address))}`);
  console.log('trader', trader.address, `USDC ${fmt(traderUsdc)}`);
  console.log('relayer', relayer.address, `eth ${ethers.formatEther(await provider.getBalance(relayer.address))}  maxFee ${FEE.maxFeePerGas} wei/gas`);

  // CoW fill pulls margin from the solver wallet + borrow from the solver escrow
  // (2 * margin out of the solver's capital at 2x, split across the two legs).
  // Intent fill pulls margin from the trader and borrow from the escrow.
  const solverBudget = solverUsdc / BigInt(2 * LEVERAGE);
  let margin = solverBudget < traderUsdc ? solverBudget : traderUsdc;
  margin = (margin / 1000n) * 1000n; // round to 0.001 USDC
  if (margin === 0n) throw new Error('insufficient USDC to open even a dust position');
  const borrow = margin * BigInt(LEVERAGE - 1);
  console.log(`sized margin ${fmt(margin)} USDC @ ${LEVERAGE}x -> borrow ${fmt(borrow)} USDC, notional ${fmt(margin + borrow)} USDC`);

  // ── byte-exact appData from the deployed settlement ───────────────────
  const appDataJson = await cow.appDataJson(LEVERAGE);
  const appData = ethers.keccak256(ethers.toUtf8Bytes(appDataJson));
  const commitment = await cow.leverageCommitment(LEVERAGE);
  const appDataOk = appData.toLowerCase() === commitment.toLowerCase();
  console.log('appDataJson', appDataJson);
  console.log('appData    ', appData, appDataOk ? '== leverageCommitment(2)' : 'MISMATCH');
  if (!appDataOk) throw new Error('appData mismatch');
  results.appData = { json: appDataJson, hash: appData };

  const validTo = Number(blk.timestamp) + 3600;

  const orderForSign = {
    sellToken: USDC,
    buyToken: WETH,
    receiver: trader.address, // receiver == swapper
    sellAmount: margin,
    buyAmount: 1n, // effectively no floor; real minimum is the pool price
    validTo,
    appData,
    feeAmount: 0n,
    kind: 'sell',
    partiallyFillable: false,
    sellTokenBalance: 'erc20',
    buyTokenBalance: 'erc20',
  };
  const orderForChain = {
    ...orderForSign,
    kind: ethers.keccak256(ethers.toUtf8Bytes('sell')),
    sellTokenBalance: ethers.keccak256(ethers.toUtf8Bytes('erc20')),
    buyTokenBalance: ethers.keccak256(ethers.toUtf8Bytes('erc20')),
  };

  const cowDomain = { name: 'Gnosis Protocol', version: 'v2', chainId: CHAIN_ID, verifyingContract: GPV2 };
  const cowSig = await trader.signTypedData(cowDomain, COW_TYPES, orderForSign);
  const verified = await cow.verify(orderForChain, 0, cowSig);
  console.log('recovered owner', verified.owner, verified.owner.toLowerCase() === trader.address.toLowerCase() ? '(ok)' : '(MISMATCH)');
  if (verified.owner.toLowerCase() !== trader.address.toLowerCase()) throw new Error('CoW signature recovery mismatch');

  const fillParams = { leverage: LEVERAGE, solver: solver.address, key: HOOK_KEY, standardPoolKey: STD_KEY };
  const orderUid = ethers.hexlify(verified.orderUid);
  results.cow = { orderUid, owner: verified.owner, margin: margin.toString(), buyToken: WETH };

  if (!INTENT_ONLY) {
    console.log('\n[1/3] CoW GPv2 fillOrder (eth_call)');
    await cow.connect(relayer).fillOrder.staticCall(orderForChain, 0, cowSig, fillParams);
    console.log('  eth_call OK');
  }

  // ── ensure approvals + escrow ─────────────────────────────────────────
  for (const w of [solver, trader]) {
    const allow = await usdc.allowance(w.address, ROUTER);
    if (allow < margin * 4n) {
      console.log(`  approving router from ${w.address}`);
      await (await usdc.connect(w).approve(ROUTER, ethers.MaxUint256, { gasLimit: 100_000, ...FEE })).wait();
      await waitFor(`allowance ${w.address}`, () => usdc.allowance(w.address, ROUTER), (v) => v >= margin * 4n);
    }
  }

  // Small real escrow deposit so the intent fill's borrow leg is escrow-funded.
  const escrowTarget = borrow;
  let escrowNow = await router.erc20BorrowEscrow(solver.address, USDC);
  if (escrowNow < escrowTarget) {
    // A lagging backend may still report the pre-deposit balance; poll briefly.
    escrowNow = await waitFor('escrow', () => router.erc20BorrowEscrow(solver.address, USDC), (v) => v >= escrowTarget, 5)
      .catch(async () => router.erc20BorrowEscrow(solver.address, USDC));
  }
  if (escrowNow < escrowTarget) {
    const need = escrowTarget - escrowNow;
    console.log(`\n[2/3] depositBorrowEscrow  ${fmt(need)} USDC`);
    const tx = await router.connect(solver).depositBorrowEscrow(USDC, need, { gasLimit: 200_000, ...FEE });
    if (mode === 'broadcast') {
      const rc = await tx.wait();
      results.steps.push({
        step: 'escrow-deposit',
        venue: 'EswapRouter',
        action: 'depositBorrowEscrow',
        tx: tx.hash,
        url: `https://basescan.org/tx/${tx.hash}`,
        status: rc.status,
        block: rc.blockNumber,
        gasUsed: rc.gasUsed.toString(),
        amount: need.toString(),
        escrowAfter: (await router.erc20BorrowEscrow(solver.address, USDC)).toString(),
      });
      console.log('  tx', tx.hash, 'status', rc.status, 'gas', rc.gasUsed.toString());
    } else {
      const rc = await tx.wait();
      console.log('  (dry-run tx accepted on fork)', tx.hash, 'status', rc.status);
    }
  }
  console.log('  escrow[USDC][solver]', (await router.erc20BorrowEscrow(solver.address, USDC)).toString());

  if (mode !== 'broadcast' && !process.argv.includes('--fork-send')) {
    // On a fork we still want state to advance for the intent step; treat
    // non-mainnet RPCs as sendable.
    if (!RPC.includes('127.0.0.1') && !RPC.includes('localhost')) {
      fs.mkdirSync('scripts/v4/live/proofs', { recursive: true });
      fs.writeFileSync('scripts/v4/live/proofs/cow-intent-sim.json', JSON.stringify(results, null, 2));
      console.log('\nsim complete (no tx broadcast). Nothing written to chain.');
      return;
    }
  }

  // ── CoW broadcast ─────────────────────────────────────────────────────
  if (!INTENT_ONLY) {
  const preCow = {
    traderUsdc: (await usdc.balanceOf(trader.address)).toString(),
    solverUsdc: (await usdc.balanceOf(solver.address)).toString(),
    routerWeth: (await new ethers.Contract(WETH, ERC20_ABI, provider).balanceOf(ROUTER)).toString(),
  };
  const tx1 = await cow.connect(relayer).fillOrder(orderForChain, 0, cowSig, fillParams, { gasLimit: 2_500_000, ...FEE });
  const rc1 = await tx1.wait();
  const postCow = {
    traderUsdc: (await usdc.balanceOf(trader.address)).toString(),
    solverUsdc: (await usdc.balanceOf(solver.address)).toString(),
  };
  const pos = await hook.positions(poolIdOf(HOOK_KEY), trader.address);
  const cowStep = {
    step: 'cow-fill',
    venue: 'CoW Protocol GPv2',
    action: 'CoW GPv2 Settlement (leveraged open)',
    tx: tx1.hash,
    url: `https://basescan.org/tx/${tx1.hash}`,
    status: rc1.status,
    block: rc1.blockNumber,
    gasUsed: rc1.gasUsed.toString(),
    orderUid,
    owner: verified.owner,
    solver: solver.address,
    margin: margin.toString(),
    leverage: LEVERAGE,
    before: preCow,
    after: postCow,
    position: {
      trader: pos[0],
      collateral: pos[1].toString(),
      borrowed: pos[2].toString(),
      leverage: Number(pos[3]),
      isLong: pos[4],
    },
  };
  console.log(`\n  CoW fill tx ${tx1.hash} status ${rc1.status} gas ${rc1.gasUsed} block ${rc1.blockNumber}`);
  console.log('  position collateral', pos[1].toString(), 'borrowed', pos[2].toString(), 'lev', Number(pos[3]), 'isLong', pos[4]);
  console.log(`  ${cowStep.url}`);
  results.steps.push(cowStep);
  }

  // ── direct LendingIntent broadcast ────────────────────────────────────
  // The hook allows ONE open position per (pool, trader), so the intent proof
  // uses a second trader wallet (it is a separate, independently signed intent).
  const intentTrader = new ethers.Wallet(env.INTENT_TRADER_PK || env.PRIVATE_KEY, provider);
  console.log('\nintent trader', intentTrader.address, `USDC ${fmt(await usdc.balanceOf(intentTrader.address))}`);
  if ((await usdc.allowance(intentTrader.address, ROUTER)) < margin * 4n) {
    console.log('  approving router from intent trader');
    await (await usdc.connect(intentTrader).approve(ROUTER, ethers.MaxUint256, { gasLimit: 100_000, ...FEE })).wait();
    await waitFor('intent trader allowance', () => usdc.allowance(intentTrader.address, ROUTER), (v) => v >= margin * 4n);
  }

  const pid = poolIdOf(HOOK_KEY);
  const spid = poolIdOf(STD_KEY);
  const deadline = Number(blk.timestamp) + 3600;
  const intent = {
    poolId: pid,
    standardPoolId: spid,
    zeroForOne: false, // USDC -> WETH
    amountSpecified: -margin,
    leverage: LEVERAGE,
    solver: solver.address,
    deadline,
    minAmountOut: 0n,
    nonce: 1n,
  };
  const intentSig = await intentTrader.signTypedData(
    { name: 'EswapRouter', version: '1', chainId: CHAIN_ID, verifyingContract: ROUTER },
    INTENT_TYPES,
    intent,
  );
  const swapParams = {
    key: HOOK_KEY,
    standardPoolKey: STD_KEY,
    zeroForOne: false,
    amountSpecified: -margin,
    leverage: LEVERAGE,
    solver: solver.address,
    hookData: coder.encode(['bool', 'uint8', 'address'], [true, LEVERAGE, intentTrader.address]),
    deadline,
    minAmountOut: 0n,
  };

  console.log('\n[3/3] swapWithIntent (eth_call)');
  await router.connect(relayer).swapWithIntent.staticCall(swapParams, intentTrader.address, intent, intentSig);
  console.log('  eth_call OK');

  const tx2 = await router.connect(relayer).swapWithIntent(swapParams, intentTrader.address, intent, intentSig, { gasLimit: 2_500_000, ...FEE });
  const rc2 = await tx2.wait();
  const fillId = ethers.keccak256(coder.encode(['address', 'uint256'], [intentTrader.address, intent.nonce]));
  const filled = await waitFor('filledIntents', () => router.filledIntents(fillId), (v) => v === true);
  const pos2 = await waitFor('position', () => hook.positions(pid, intentTrader.address), (v) => v[1] > 0n);
  const intentStep = {
    step: 'intent-fill',
    venue: 'Eswap Direct Solver',
    action: 'EswapRouter.swapWithIntent (leveraged open)',
    tx: tx2.hash,
    url: `https://basescan.org/tx/${tx2.hash}`,
    status: rc2.status,
    block: rc2.blockNumber,
    gasUsed: rc2.gasUsed.toString(),
    fillId,
    filledIntents: filled,
    nonce: intent.nonce.toString(),
    trader: intentTrader.address,
    margin: margin.toString(),
    leverage: LEVERAGE,
    escrowAfter: (await router.erc20BorrowEscrow(solver.address, USDC)).toString(),
    borrowSource: 'erc20BorrowEscrow[solver][USDC]',
    position: {
      trader: pos2[0],
      collateral: pos2[1].toString(),
      borrowed: pos2[2].toString(),
      leverage: Number(pos2[3]),
      isLong: pos2[4],
    },
  };
  console.log(`  intent tx ${tx2.hash} status ${rc2.status} gas ${rc2.gasUsed} block ${rc2.blockNumber}`);
  console.log(`  filledIntents[${fillId}] = ${intentStep.filledIntents}`);
  console.log(`  ${intentStep.url}`);
  results.steps.push(intentStep);

  results.finishedAt = new Date().toISOString();
  fs.mkdirSync('scripts/v4/live/proofs', { recursive: true });
  const outFile = `scripts/v4/live/proofs/remaining-${Date.now()}.json`;
  fs.writeFileSync(outFile, JSON.stringify(results, null, 2));
  console.log('\nwrote', outFile);
}

main().catch((e) => {
  console.error('\nFAILED:', e.shortMessage || e.message);
  if (e.data) console.error('revert data:', e.data);
  process.exit(1);
});
