/**
 * First live fill proof — Base mainnet (8453).
 *
 *   node scripts/v4/live/executeLiveFillProof.cjs                  # preflight only (no tx)
 *   node scripts/v4/live/executeLiveFillProof.cjs --execute        # open + close on chain
 *   node scripts/v4/live/executeLiveFillProof.cjs --execute --margin 1 --leverage 2
 *
 * What it proves
 *   1. A trader signs an EIP-712 `LendingIntent` off chain.
 *   2. A solver relays it through the PERMISSIONLESS `EswapRouter.swapWithIntent`
 *      (no governance whitelist entry is needed for the fill itself).
 *   3. The hook opens a real leveraged position against the live Base
 *      WETH/USDC v4 pool and the protocol takes its fee.
 *   4. The trader closes the position and gets the residual collateral back.
 *
 * Why the default margin is sized from live balances
 *   The proof must be runnable by anyone with a funded wallet, and it must never
 *   silently pull more than the trader approved. The margin is therefore
 *   `min(requested, trader USDC, solver borrow capacity)` rounded down to whole
 *   USDC base units (6 dp). If that is zero the script stops and prints the exact
 *   shortfall instead of broadcasting a revert.
 *
 * Borrow leg
 *   `swapWithIntent` draws the solver's borrow from `erc20BorrowEscrow` first and
 *   falls back to `transferFrom(solver, manager, remainder)`. The escrow check is
 *   skipped only when the relayer IS the solver and that solver is registered, so
 *   by default the script relays from the solver wallet (approve once, no escrow
 *   deposit, one less tx). `--relayer deployer` forces the escrow path instead.
 *
 * Output
 *   - `scripts/v4/live/proofs/first-live-fill-<chainId>-<ts>.json`
 *   - a fenced `LIVE_FILL_PROOF` block in MAINNET_PROOF.md (replaced, not appended
 *     twice, so re-running is safe)
 */
const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');

const CHAIN_ID = 8453;
const USDC = ethers.getAddress('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913');
const WETH = ethers.getAddress('0x4200000000000000000000000000000000000006');

const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address,address) view returns (uint256)',
  'function approve(address,uint256) returns (bool)',
];

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

// ─── args ───────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = argv[i + 1];
  return v && !v.startsWith('--') ? v : fallback;
};

const EXECUTE = flag('execute');
const LEVERAGE = Number(opt('leverage', '2'));
const REQUESTED_MARGIN = opt('margin', null);
const RELAYER_MODE = opt('relayer', 'solver'); // solver | deployer
const APPEND = !flag('no-append');

// ─── env ────────────────────────────────────────────────────────────────────
function loadEnv() {
  const env = {};
  const file = path.resolve(process.cwd(), '.env');
  if (!fs.existsSync(file)) return env;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return env;
}
const env = loadEnv();
const pickEnv = (k, fallback) => process.env[k] || env[k] || fallback;

const RPC = pickEnv('BASE_RPC_URL', 'https://mainnet.base.org');
const ROUTER = ethers.getAddress(pickEnv('V4_ROUTER_ADDRESS', '0x5b226aE5158de86f1E616875dBab886870B9aAd9'));
const HOOK = ethers.getAddress(pickEnv('V4_HOOK_ADDRESS', '0x7b3F232BB5a0346fADb8B92B31B3e7bC60bD90c8'));

const HOOK_KEY = { currency0: WETH, currency1: USDC, fee: 3000, tickSpacing: 60, hooks: HOOK };
const STD_KEY = { currency0: WETH, currency1: USDC, fee: 500, tickSpacing: 10, hooks: ethers.ZeroAddress };

const poolIdOf = (k) =>
  ethers.keccak256(
    coder.encode(
      ['address', 'address', 'uint24', 'int24', 'address'],
      [k.currency0, k.currency1, k.fee, k.tickSpacing, k.hooks],
    ),
  );

const usdc6 = (v) => ethers.formatUnits(v, 6);
const eth = (v) => ethers.formatEther(v);

function abiOf(file) {
  const j = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), file), 'utf8'));
  return Array.isArray(j) ? j : j.abi;
}

// Base's L2 base fee is ~0.006 gwei. Pin an explicit envelope so a spike cannot
// turn a dust proof into an expensive one, and so the intrinsic-cost check passes
// with the small ETH balances these wallets hold.
const gwei = (v) => BigInt(Math.round(Number(v) * 1e9));
const FEE = {
  maxFeePerGas: gwei(pickEnv('MAX_FEE_GWEI', '0.02')),
  maxPriorityFeePerGas: gwei(pickEnv('PRIORITY_FEE_GWEI', '0.001')),
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(label, read, ok, tries = 30) {
  for (let i = 0; i < tries; i++) {
    const v = await read();
    if (ok(v)) return v;
    await sleep(2000);
  }
  throw new Error(`timed out waiting for ${label}`);
}

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC, CHAIN_ID, { staticNetwork: true });
  const net = await provider.getNetwork();
  if (Number(net.chainId) !== CHAIN_ID) {
    throw new Error(`RPC is chain ${net.chainId}, this proof only runs on Base ${CHAIN_ID}`);
  }

  const relayerKey = RELAYER_MODE === 'solver' ? pickEnv('SOLVER_PRIVATE_KEY') : pickEnv('PRIVATE_KEY');
  if (!relayerKey) throw new Error(`missing key for relayer mode "${RELAYER_MODE}"`);

  const solver = new ethers.Wallet(pickEnv('SOLVER_PRIVATE_KEY'), provider);
  const trader = new ethers.Wallet(pickEnv('FILL_TRADER_PK', pickEnv('PRIVATE_KEY')), provider);
  const relayer = new ethers.Wallet(relayerKey, provider);

  const router = new ethers.Contract(ROUTER, abiOf('dashboard/src/abis/EswapRouter.json'), provider);
  const hook = new ethers.Contract(HOOK, abiOf('dashboard/src/abis/EswapMarginHook.json'), provider);
  const usdc = new ethers.Contract(USDC, ERC20_ABI, provider);

  const block = await provider.getBlock('latest');
  const poolId = poolIdOf(HOOK_KEY);
  const stdPoolId = poolIdOf(STD_KEY);

  if (LEVERAGE < 2) throw new Error('leverage must be >= 2 for a margin fill');

  // ── balances ─────────────────────────────────────────────────────────────
  const [traderUsdc, solverUsdc, traderEth, solverEth, relayerEth, escrow, solverRegistered] = await Promise.all([
    usdc.balanceOf(trader.address),
    usdc.balanceOf(solver.address),
    provider.getBalance(trader.address),
    provider.getBalance(solver.address),
    provider.getBalance(relayer.address),
    router.erc20BorrowEscrow(solver.address, USDC),
    router.registeredSolvers(solver.address),
  ]);

  // ── sizing ───────────────────────────────────────────────────────────────
  // margin is an exact-input amount, so 1 USDC base unit is the smallest legal fill.
  //
  // Borrow capacity depends on WHO relays:
  //   relayer == solver  -> `thirdPartyDraw` is false, so a registered solver only
  //                         needs an approval; the borrow is pulled by transferFrom.
  //   anyone else        -> the whole borrow must already sit in erc20BorrowEscrow.
  // The script can always move solver USDC into escrow, so the solver's total USDC
  // is the real ceiling either way; only the number of transactions differs.
  const selfRelay = relayer.address.toLowerCase() === solver.address.toLowerCase();
  const borrowCapacity = escrow + solverUsdc;
  const capacity = [traderUsdc, borrowCapacity / BigInt(LEVERAGE - 1)].reduce((a, b) => (a < b ? a : b));
  let margin = REQUESTED_MARGIN ? BigInt(ethers.parseUnits(REQUESTED_MARGIN, 6)) : capacity;
  if (margin > capacity) margin = capacity;
  const borrow = margin * BigInt(LEVERAGE - 1);

  // Gas floors, at Base's ~0.006 gwei plus an L1-data-fee allowance:
  //   approve ~46k, swap ~1.33M, close ~430k, escrow deposit ~80k.
  // 1.5x headroom so a modest base-fee bump does not trip the check.
  const escrowMode = !(selfRelay && solverRegistered);
  const TRADER_GAS = ethers.parseEther('0.000005');
  const SOLVER_GAS = ethers.parseEther(escrowMode ? '0.0000011' : '0.0000006');
  const RELAYER_GAS = ethers.parseEther('0.000012');

  const shortfall = [];
  if (margin > traderUsdc) {
    shortfall.push({ who: 'trader', need: `${usdc6(margin - traderUsdc)} USDC`, to: trader.address });
  }
  if (borrow > borrowCapacity) {
    shortfall.push({ who: 'solver', need: `${usdc6(borrow - borrowCapacity)} USDC (borrow leg)`, to: solver.address });
  }
  if (traderEth < TRADER_GAS) shortfall.push({ who: 'trader', need: `${eth(TRADER_GAS - traderEth)} ETH (gas)`, to: trader.address });
  if (solverEth < SOLVER_GAS && !shortfall.some((s) => s.to === solver.address)) {
    shortfall.push({ who: 'solver', need: `${eth(SOLVER_GAS - solverEth)} ETH (gas)`, to: solver.address });
  }
  if (relayerEth < RELAYER_GAS && !shortfall.some((s) => s.to === relayer.address)) {
    shortfall.push({ who: 'relayer', need: `${eth(RELAYER_GAS - relayerEth)} ETH (gas)`, to: relayer.address });
  }

  const plan = {
    chainId: CHAIN_ID,
    rpc: RPC.replace(/\/v2\/.*$/, '/v2/***'),
    block: block.number,
    router: ROUTER,
    hook: HOOK,
    poolId,
    standardPoolId: stdPoolId,
    leverage: LEVERAGE,
    margin: margin.toString(),
    marginUsdc: usdc6(margin),
    borrow: borrow.toString(),
    borrowUsdc: usdc6(borrow),
    notionalUsdc: usdc6(margin + borrow),
    wallets: {
      trader: trader.address,
      solver: solver.address,
      relayer: relayer.address,
    },
    balances: {
      traderUsdc: usdc6(traderUsdc),
      solverUsdc: usdc6(solverUsdc),
      solverEscrowUsdc: usdc6(escrow),
      traderEth: eth(traderEth),
      solverEth: eth(solverEth),
      relayerEth: eth(relayerEth),
    },
    shortfall,
  };

  console.log('=== Eswap first live fill — Base 8453 ===');
  console.log(`block      ${plan.block}`);
  console.log(`router     ${ROUTER}`);
  console.log(`hook       ${HOOK}`);
  console.log(`poolId     ${poolId}`);
  console.log(`trader     ${trader.address}  ${plan.balances.traderUsdc} USDC  ${plan.balances.traderEth} ETH`);
  console.log(`solver     ${solver.address}  ${plan.balances.solverUsdc} USDC  ${plan.balances.solverEth} ETH  escrow ${plan.balances.solverEscrowUsdc}`);
  console.log(`relayer    ${relayer.address} (${RELAYER_MODE})  ${plan.balances.relayerEth} ETH`);
  console.log(`fill       margin ${plan.marginUsdc} USDC @ ${LEVERAGE}x -> borrow ${plan.borrowUsdc}, notional ${plan.notionalUsdc} USDC`);

  if (margin === 0n) {
    console.error('\nNo fundable margin: the trader holds no USDC and/or the solver cannot cover the borrow leg.');
    if (shortfall.length) {
      console.error('Fund these first:');
      for (const s of shortfall) console.error(`  ${s.who}: send ${s.need} to ${s.to}`);
    }
    process.exitCode = 2;
    return;
  }

  if (shortfall.length) {
    console.warn('\n⚠️  Gas/collateral shortfall detected:');
    for (const s of shortfall) console.warn(`   ${s.who}: send ${s.need} to ${s.to}`);
    if (EXECUTE) {
      console.error('\nRefusing to broadcast with a shortfall. Fund the wallets above and re-run.');
      process.exitCode = 2;
      return;
    }
  }

  // ── intent ───────────────────────────────────────────────────────────────
  const deadline = Number(block.timestamp) + 1800;
  const intent = {
    poolId,
    standardPoolId: stdPoolId,
    zeroForOne: false, // USDC (currency1) -> WETH (currency0) = long
    amountSpecified: -margin,
    leverage: LEVERAGE,
    solver: solver.address,
    deadline,
    minAmountOut: 0n,
    nonce: BigInt(Date.now()),
  };
  const intentSig = await trader.signTypedData(
    { name: 'EswapRouter', version: '1', chainId: CHAIN_ID, verifyingContract: ROUTER },
    INTENT_TYPES,
    intent,
  );
  const swapParams = {
    key: HOOK_KEY,
    standardPoolKey: STD_KEY,
    zeroForOne: intent.zeroForOne,
    amountSpecified: intent.amountSpecified,
    leverage: LEVERAGE,
    solver: solver.address,
    hookData: coder.encode(['bool', 'uint8', 'address'], [true, LEVERAGE, trader.address]),
    deadline,
    minAmountOut: 0n,
  };
  const fillId = ethers.keccak256(coder.encode(['address', 'uint256'], [trader.address, intent.nonce]));
  plan.fillId = fillId;
  plan.deadline = deadline;

  // ── allowances ───────────────────────────────────────────────────────────
  // ethers caches eth_getTransactionCount per block, so two txs from the same
  // wallet inside the same second reuse the nonce ("nonce has already been used").
  // Bypass the cache and pin every nonce explicitly.
  const nextNonce = async (addr) => Number(await provider.send('eth_getTransactionCount', [addr, 'pending']));
  const needApprove = async (wallet) => (await usdc.allowance(wallet.address, ROUTER)) < margin * 2n;
  const traderNeedsApprove = await needApprove(trader);
  const solverNeedsApprove =
    solver.address.toLowerCase() === trader.address.toLowerCase() ? false : await needApprove(solver);
  plan.approvals = { trader: traderNeedsApprove, solver: solverNeedsApprove };

  // ── simulate ─────────────────────────────────────────────────────────────
  console.log('\n[1/4] swapWithIntent (eth_call)');
  const simRouter = router.connect(relayer);
  const callArgs = [swapParams, trader.address, intent, intentSig, { from: relayer.address }];
  const escrowShort = !(selfRelay && solverRegistered) && escrow < borrow;
  if (traderNeedsApprove || solverNeedsApprove || escrowShort) {
    // The margin/borrow legs are pulled by transferFrom, so an un-approved wallet
    // reverts before the interesting logic runs. Say so instead of surfacing a raw
    // ERC20 revert, and only report the simulation as pending.
    const who = [
      traderNeedsApprove && 'trader',
      solverNeedsApprove && 'solver',
      escrowShort && 'solver escrow',
    ]
      .filter(Boolean)
      .join(' + ');
    console.log(`  skipped: ${who} must be funded/approved first (the --execute path does this)`);
    plan.simulation = { ok: null, skipped: `approval/escrow required: ${who}` };
  } else {
    const quoted = await simRouter.swapWithIntent.staticCall(...callArgs);
    console.log(`  eth_call OK, raw return ${quoted}`);
    plan.simulation = { ok: true, raw: quoted };
  }

  if (!EXECUTE) {
    console.log('\npreflight only — nothing broadcast. Re-run with --execute to fill.');
    return;
  }

  // ── approvals ────────────────────────────────────────────────────────────
  console.log('\n[2/4] approvals');
  const steps = [];
  const approveIfNeeded = async (wallet, label, needed) => {
    if (!needed) {
      console.log(`  ${label} allowance ok`);
      return;
    }
    const tx = await usdc.connect(wallet).approve(ROUTER, ethers.MaxUint256, {
      gasLimit: 60_000,
      nonce: await nextNonce(wallet.address),
      ...FEE,
    });
    const rc = await tx.wait();
    console.log(`  ${label} approve ${tx.hash} status ${rc.status}`);
    steps.push({ step: `approve-${label}`, tx: tx.hash, status: rc.status, block: rc.blockNumber, gasUsed: rc.gasUsed.toString() });
  };
  await approveIfNeeded(trader, 'trader', traderNeedsApprove);
  await approveIfNeeded(solver, 'solver', solverNeedsApprove);

  // A relayer that is not the solver triggers `thirdPartyDraw`, so the borrow must
  // be fully bonded in escrow before the fill. Top it up from the solver's wallet.
  const needsEscrow = !(selfRelay && solverRegistered);
  if (needsEscrow) {
    const have = await router.erc20BorrowEscrow(solver.address, USDC);
    if (have < borrow) {
      const need = borrow - have;
      console.log(`  solver escrow short by ${usdc6(need)} USDC — depositing`);
      const tx = await router.connect(solver).depositBorrowEscrow(USDC, need, {
        gasLimit: 200_000,
        nonce: await nextNonce(solver.address),
        ...FEE,
      });
      const rc = await tx.wait();
      console.log(`  escrow deposit ${tx.hash} status ${rc.status}`);
      steps.push({ step: 'escrow-deposit', tx: tx.hash, status: rc.status, block: rc.blockNumber, gasUsed: rc.gasUsed.toString(), amount: need.toString() });
    } else {
      console.log(`  solver escrow covers the borrow (${usdc6(have)} USDC)`);
    }
  }

  if (plan.simulation.ok !== true) {
    console.log('  re-running eth_call now that approvals are in place');
    const quoted = await simRouter.swapWithIntent.staticCall(...callArgs);
    console.log(`  eth_call OK, raw return ${quoted}`);
    plan.simulation = { ok: true, raw: quoted, afterApprovals: true };
  }

  // ── open ─────────────────────────────────────────────────────────────────
  console.log('\n[3/4] swapWithIntent (broadcast)');
  const openTx = await simRouter.swapWithIntent(swapParams, trader.address, intent, intentSig, {
    gasLimit: 1_700_000,
    nonce: await nextNonce(relayer.address),
    ...FEE,
  });
  const openRc = await openTx.wait();
  const filled = await waitFor('filledIntents', () => router.filledIntents(fillId), (v) => v === true);
  const pos = await waitFor('position', () => hook.positions(poolId, trader.address), (v) => v[1] > 0n);
  console.log(`  tx ${openTx.hash} status ${openRc.status} gas ${openRc.gasUsed} block ${openRc.blockNumber}`);
  console.log(`  filledIntents[${fillId}] = ${filled}`);
  console.log(`  position collateral ${pos[1]} borrowed ${pos[2]} leverage ${Number(pos[3])} long ${pos[4]}`);
  steps.push({
    step: 'open',
    tx: openTx.hash,
    url: `https://basescan.org/tx/${openTx.hash}`,
    status: openRc.status,
    block: openRc.blockNumber,
    gasUsed: openRc.gasUsed.toString(),
    fillId,
    position: {
      trader: pos[0],
      collateral: pos[1].toString(),
      borrowed: pos[2].toString(),
      leverage: Number(pos[3]),
      isLong: pos[4],
    },
  });

  // ── close ────────────────────────────────────────────────────────────────
  console.log('\n[4/4] closePosition (broadcast)');
  const before = { traderUsdc: await usdc.balanceOf(trader.address), solverUsdc: await usdc.balanceOf(solver.address) };
  const closeTx = await router
    .connect(trader)
    .closePosition(HOOK, HOOK_KEY, trader.address, solver.address, 0n, {
      gasLimit: 800_000,
      nonce: await nextNonce(trader.address),
      ...FEE,
    });
  const closeRc = await closeTx.wait();
  const closed = await waitFor('position closed', () => hook.positions(poolId, trader.address), (v) => v[1] === 0n);
  const after = { traderUsdc: await usdc.balanceOf(trader.address), solverUsdc: await usdc.balanceOf(solver.address) };
  console.log(`  tx ${closeTx.hash} status ${closeRc.status} gas ${closeRc.gasUsed} block ${closeRc.blockNumber}`);
  console.log(`  position closed: collateral ${closed[1]}`);
  console.log(`  trader USDC ${usdc6(before.traderUsdc)} -> ${usdc6(after.traderUsdc)}`);
  steps.push({
    step: 'close',
    tx: closeTx.hash,
    url: `https://basescan.org/tx/${closeTx.hash}`,
    status: closeRc.status,
    block: closeRc.blockNumber,
    gasUsed: closeRc.gasUsed.toString(),
    positionAfter: { collateral: closed[1].toString(), borrowed: closed[2].toString() },
    traderUsdc: { before: usdc6(before.traderUsdc), after: usdc6(after.traderUsdc) },
  });

  plan.steps = steps;
  plan.finishedAt = new Date().toISOString();
  plan.result = 'filled-and-closed';

  // ── artifacts ────────────────────────────────────────────────────────────
  const proofDir = path.resolve(process.cwd(), 'scripts/v4/live/proofs');
  fs.mkdirSync(proofDir, { recursive: true });
  const proofFile = path.join(proofDir, `first-live-fill-${CHAIN_ID}-${Date.now()}.json`);
  plan.proofFile = path.relative(process.cwd(), proofFile);
  fs.writeFileSync(proofFile, JSON.stringify(plan, null, 2));
  console.log(`\nwrote ${path.relative(process.cwd(), proofFile)}`);

  if (APPEND) appendToMainnetProof(plan);

  // A live fill is only a proof if the position really opened AND closed.
  if (!filled || closed[1] !== 0n) {
    console.error('\nPROOF FAILED: position did not reach the expected state');
    process.exitCode = 1;
    return;
  }
  console.log('\nFIRST LIVE FILL: PASS');
}

// ─── MAINNET_PROOF.md block ─────────────────────────────────────────────────
const START = '<!-- LIVE_FILL_PROOF:START -->';
const END = '<!-- LIVE_FILL_PROOF:END -->';

function appendToMainnetProof(plan) {
  const file = path.resolve(process.cwd(), 'MAINNET_PROOF.md');
  if (!fs.existsSync(file)) {
    console.warn('MAINNET_PROOF.md not found, skipping the markdown record');
    return;
  }
  const open = plan.steps.find((s) => s.step === 'open');
  const close = plan.steps.find((s) => s.step === 'close');
  const block = [
    START,
    '### First live fill — Base mainnet',
    '',
    `Recorded ${plan.finishedAt}. Opened and closed one ${plan.leverage}x long on the live`,
    `WETH/USDC hook pool, relayed through the permissionless \`EswapRouter.swapWithIntent\`.`,
    '',
    '| Field | Value |',
    '| --- | --- |',
    `| Router | \`${plan.router}\` |`,
    `| Hook | \`${plan.hook}\` |`,
    `| Pool id | \`${plan.poolId}\` |`,
    `| Trader | \`${plan.wallets.trader}\` |`,
    `| Solver (relayer) | \`${plan.wallets.solver}\` |`,
    `| Margin | ${plan.marginUsdc} USDC |`,
    `| Borrow | ${plan.borrowUsdc} USDC |`,
    `| Notional | ${plan.notionalUsdc} USDC @ ${plan.leverage}x |`,
    `| Intent fill id | \`${plan.fillId}\` |`,
    `| Open tx | [\`${open.tx}\`](${open.url}) (block ${open.block}, gas ${open.gasUsed}) |`,
    `| Close tx | [\`${close.tx}\`](${close.url}) (block ${close.block}, gas ${close.gasUsed}) |`,
    `| Position after close | collateral ${close.positionAfter.collateral}, borrowed ${close.positionAfter.borrowed} |`,
    '',
    `Proof JSON: \`scripts/v4/live/proofs/${path.basename(plan.proofFile || '')}\``,
    END,
  ].join('\n');

  const text = fs.readFileSync(file, 'utf8');
  let next;
  if (text.includes(START) && text.includes(END)) {
    next = text.replace(new RegExp(`${START}[\\s\\S]*?${END}`), block);
  } else {
    next = `${text.replace(/\s*$/, '')}\n\n${block}\n`;
  }
  fs.writeFileSync(file, next);
  console.log('updated MAINNET_PROOF.md');
}

main().catch((e) => {
  console.error('\nFAILED:', e.shortMessage || e.message);
  if (e.data) console.error('revert data:', e.data);
  if (e.info?.error?.message) console.error('node:', e.info.error.message);
  process.exit(1);
});
