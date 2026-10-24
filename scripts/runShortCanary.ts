/**
 * Short-Position Canary (Base 8453).
 *
 * Opens a leveraged SHORT on the WETH/USDC hook pool via the full intent ->
 * relay -> solver pipeline, asserting the direction-specific mechanics:
 *
 *   - Direction: zeroForOne=true (WETH in -> USDC out). The hook records
 *     isLong=false, collateral in USDC, debt in WETH.
 *   - Margin (WETH, trader) and borrow (WETH, solver escrow) are split from
 *     the solver's WETH: margin = solverWeth / leverage, borrow = margin * (leverage - 1).
 *   - Fees accrue in protocolFees(USDC) (the bought currency for a short).
 *   - Close repays the solver in WETH and returns the remainder to the trader
 *     in WETH.
 *
 * Prerequisite: both wallets funded with gas ETH (run scripts/fundGas.ts if
 * needed) and the solver holding the WETH test capital (~$0.25).
 *
 * Run: npx tsx scripts/runShortCanary.ts
 */
import { ethers } from "ethers";
import {
  ERC20_ABI,
  HOOK,
  HOOK_ABI,
  HOOK_KEY,
  HOOK_POOL_ID,
  RELAY_HTTP,
  ROUTER,
  ROUTER_ABI,
  USDC,
  WETH,
  buildAndSignIntent,
  buildSwapParams,
  formatRevert,
  getProvider,
  solverWallet,
  toIntentStruct,
  traderWallet,
  type SignedIntent,
} from "./lib/eswapBase";

const LEVERAGE = 5;
const MAX_GAS = BigInt(process.env.SHORT_MAX_GAS ?? 1_400_000);
/** Each wallet must hold at least this much ETH before the test starts. */
const MIN_GAS_WEI = 5_000_000_000_000n; // 5e12 wei = 0.000005 ETH
const RELAY_WAIT_MS = Number(process.env.SHORT_RELAY_WAIT_MS ?? 15_000);
const POLL_INTERVAL_MS = 2_000;

const MARGIN_OPENED_TOPIC = ethers.id("MultiPoolMarginOpened(bytes32,address,uint8,uint256,uint256)");

async function main() {
  console.log("=== Short-Position Canary (Base 8453) ===");
  console.log(`Leverage: ${LEVERAGE}x  Direction: zeroForOne=true (WETH in -> USDC out)`);

  const provider = getProvider();
  const net = await provider.getNetwork();
  if (Number(net.chainId) !== 8453) throw new Error(`RPC is chain ${net.chainId}, expected 8453`);
  console.log(`RPC chainId: ${net.chainId}  block = ${await provider.getBlockNumber()}`);

  const trader = traderWallet(provider);
  const solver = solverWallet(provider);
  console.log(`Trader (W#1): ${trader.address}`);
  console.log(`Solver (W#2): ${solver.address}`);

  const usdc = new ethers.Contract(USDC, ERC20_ABI, provider);
  const weth = new ethers.Contract(WETH, ERC20_ABI, provider);
  const hook = new ethers.Contract(HOOK, HOOK_ABI, provider);
  const routerRead = new ethers.Contract(ROUTER, ROUTER_ABI, provider);

  // ─── Preflight ────────────────────────────────────────────────────────────
  const traderEth = await provider.getBalance(trader.address);
  const solverEth = await provider.getBalance(solver.address);
  const traderWeth = (await weth.balanceOf(trader.address)) as bigint;
  const solverWeth = (await weth.balanceOf(solver.address)) as bigint;
  console.log(`\nTrader ETH=${ethers.formatEther(traderEth)} WETH=${ethers.formatEther(traderWeth)}`);
  console.log(`Solver ETH=${ethers.formatEther(solverEth)} WETH=${ethers.formatEther(solverWeth)}`);

  if (traderEth < MIN_GAS_WEI || solverEth < MIN_GAS_WEI) {
    throw new Error(
      `insufficient gas ETH (need >= ${MIN_GAS_WEI} wei each). Run: npx tsx scripts/fundGas.ts`,
    );
  }

  const pos = await hook.positions(HOOK_POOL_ID, trader.address);
  if ((pos.collateralAmount as bigint) > 0n) {
    throw new Error("trader already has an open position on the hook pool — close it first (scripts/closePosition.ts)");
  }

  // ─── WETH split: margin on trader, borrow remainder on solver ────────────
  // Resume-safe: if the trader already holds WETH (from a prior aborted split)
  // and escrow is empty, use the existing balances instead of re-splitting.
  const wethSolver = new ethers.Contract(WETH, ERC20_ABI, solver);
  const escrowPre = (await routerRead.erc20BorrowEscrow(solver.address, WETH)) as bigint;
  let margin: bigint;
  const traderHas = traderWeth;
  if (traderHas > 0n && escrowPre === 0n && solverWeth > 0n) {
    margin = traderHas;
    console.log(`\nResuming existing split: trader already holds margin ${margin} WETH`);
  } else {
    margin = solverWeth / BigInt(LEVERAGE);
    if (margin === 0n) {
      throw new Error(`solver WETH balance ${solverWeth} is too small to split — fund ${solver.address} with WETH`);
    }
    console.log(`\n--- splitting WETH: solver -> trader ${margin} ---`);
    const sendTx = (await wethSolver.transfer(trader.address, margin)) as ethers.TransactionResponse;
    console.log(`  WETH.transfer tx=${sendTx.hash}`);
    await sendTx.wait();
  }
  const borrow = margin * BigInt(LEVERAGE - 1);
  console.log(`Split: margin=${margin} WETH (~$${(( Number(ethers.formatEther(margin)) ) * 2400).toFixed(2)}) borrow=${borrow} WETH`);

  // 2. Solver bonds the borrow leg into escrow (the full remainder).
  // Public RPC can serve pre-transfer state; poll until the debit is reflected.
  let escrowAmount = (await weth.balanceOf(solver.address)) as bigint;
  {
    const deadline = Date.now() + 20_000;
    while (escrowAmount >= solverWeth && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 2_000));
      escrowAmount = (await weth.balanceOf(solver.address)) as bigint;
    }
  }
  console.log(`\n--- bonding WETH escrow: ${escrowAmount} ---`);
  if (escrowAmount < borrow) {
    throw new Error(`escrow amount ${escrowAmount} < borrow ${borrow} after split — solver underfunded`);
  }
  const solverAllow = (await weth.allowance(solver.address, ROUTER)) as bigint;
  if (solverAllow < escrowAmount) {
    const approveTx = (await wethSolver.approve(ROUTER, ethers.MaxUint256)) as ethers.TransactionResponse;
    await approveTx.wait();
  }
  const routerSolver = new ethers.Contract(ROUTER, ROUTER_ABI, solver);
  const depTx = (await routerSolver.depositBorrowEscrow(WETH, escrowAmount)) as ethers.TransactionResponse;
  console.log(`  depositBorrowEscrow tx=${depTx.hash}`);
  await depTx.wait();
  const escrowNow = (await routerRead.erc20BorrowEscrow(solver.address, WETH)) as bigint;
  console.log(`  escrow now: ${escrowNow}`);

  // 3. Trader approves the WETH margin.
  const traderAllow = (await weth.allowance(trader.address, ROUTER)) as bigint;
  if (traderAllow < margin) {
    console.log(`\n--- trader approving ${margin} WETH -> router ---`);
    const wethTrader = new ethers.Contract(WETH, ERC20_ABI, trader);
    const approveTx = (await wethTrader.approve(ROUTER, ethers.MaxUint256)) as ethers.TransactionResponse;
    await approveTx.wait();
  }

  // 4. Sign the short intent (zeroForOne=true).
  console.log(`\n--- signing short EIP-712 LendingIntent ---`);
  const intent = await buildAndSignIntent(
    trader,
    { trader: trader.address, solver: solver.address, margin, leverage: LEVERAGE, zeroForOne: true },
    provider,
  );
  console.log(`  zeroForOne    : ${intent.value.zeroForOne}`);
  console.log(`  amountSpecified: ${intent.value.amountSpecified}`);
  console.log(`  minAmountOut  : ${intent.value.minAmountOut}`);
  console.log(`  nonce         : ${intent.value.nonce}`);

  // 5. Post to relay, wait for bot, self-fill.
  let txHash: string | null = null;
  try {
    const res = await fetch(`${RELAY_HTTP}/api/v1/intents`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(intent),
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) {
      console.log(`  intent posted to relay`);
    } else {
      console.log(`  relay rejected (${res.status}) — will self-fill`);
    }
  } catch {
    console.log(`  relay unreachable — will self-fill`);
  }

  const fillId = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(["address", "uint256"], [trader.address, BigInt(intent.value.nonce)]),
  );
  const feesUsdcBefore = (await hook.protocolFees(USDC)) as bigint;
  const waitDeadline = Date.now() + RELAY_WAIT_MS;
  while (Date.now() < waitDeadline) {
    const already = (await routerRead.filledIntents(fillId)) as boolean;
    if (already) {
      txHash = await findRecentFillTx(trader.address);
      break;
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  if (!txHash) {
    txHash = await selfFill(trader, solver, intent, provider);
  }
  if (!txHash) throw new Error("no fill transaction — short canary FAILED");
  console.log(`\nFill tx: ${txHash}`);

  // ─── Assertions ───────────────────────────────────────────────────────────
  console.log("\n--- on-chain verification ---");
  const rcpt = await provider.getTransactionReceipt(txHash);
  if (!rcpt || rcpt.status !== 1) throw new Error("fill tx reverted");

  // Public RPC serves stale state right after a confirmation; poll until the
  // position is visible before asserting.
  let posAfter = await hook.positions(HOOK_POOL_ID, trader.address);
  {
    const deadline = Date.now() + 20_000;
    while ((posAfter.collateralAmount as bigint) === 0n && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 2_000));
      posAfter = await hook.positions(HOOK_POOL_ID, trader.address);
    }
  }
  const collateral = posAfter.collateralAmount as bigint;
  const debt = await hook.solverDebts(HOOK_POOL_ID, trader.address, solver.address);
  const principal = debt.principal as bigint;
  const isLong = posAfter.isLong as boolean;

  assert("position recorded (collateral > 0)", collateral > 0n, `collateral=${collateral} (USDC units)`);
  assert("isLong == false (short)", isLong === false, `isLong=${isLong}`);
  assert(`solverDebts.principal == borrow (${borrow})`, principal === borrow, `principal=${principal} (WETH wei)`);
  assert("tx.origin == solver", rcpt.from.toLowerCase() === solver.address.toLowerCase(), `from=${rcpt.from}`);
  assert(`gasUsed < ${MAX_GAS}`, rcpt.gasUsed < MAX_GAS, `gas=${rcpt.gasUsed}`);

  // Fee assertion: shorts accrue in protocolFees(USDC).
  let boughtUsdc = 0n;
  for (const log of rcpt.logs) {
    if (log.topics[0] === MARGIN_OPENED_TOPIC && log.address.toLowerCase() === HOOK.toLowerCase()) {
      const parsed = ethers.AbiCoder.defaultAbiCoder().decode(["uint8", "uint256", "uint256"], log.data);
      boughtUsdc = parsed[2] as bigint;
      console.log(`  MultiPoolMarginOpened: leverage=${parsed[0]} margin=${parsed[1]} bought=${boughtUsdc} (USDC)`);
      break;
    }
  }
  const feeBps = (await hook.protocolFeeFor(trader.address)) as bigint;
  const expectedFee = (boughtUsdc * feeBps) / 10000n;
  const feesUsdcAfter = (await hook.protocolFees(USDC)) as bigint;
  const feeDelta = feesUsdcAfter - feesUsdcBefore;
  assert(
    `protocolFees(USDC) delta == bought * ${feeBps}bps / 10000`,
    boughtUsdc > 0n && feeDelta === expectedFee,
    `Δ=${feeDelta} expected=${expectedFee}`,
  );

  // ─── Close (trader-signed) ────────────────────────────────────────────────
  console.log("\n--- closing short (trader-signed) ---");
  const traderWethBefore = (await weth.balanceOf(trader.address)) as bigint;
  const solverWethBefore = (await weth.balanceOf(solver.address)) as bigint;

  // Minimal floor: the reverse quote is gross but close settles net of the
  // repaid principal, so a quote-derived floor over-constrains (SlippageExceeded).
  const minOut = 1n;
  const routerWrite = new ethers.Contract(ROUTER, ROUTER_ABI, trader);
  let closeTx: ethers.TransactionResponse | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const tx = (await routerWrite.closePosition(
        HOOK,
        HOOK_KEY,
        trader.address,
        solver.address,
        minOut,
      )) as ethers.TransactionResponse;
      console.log(`  closePosition tx=${tx.hash}`);
      const rcpt = await tx.wait();
      if (rcpt?.status !== 1) {
        console.log(`  close REVERTED (attempt ${attempt + 1})`);
        await new Promise((r) => setTimeout(r, 3_000));
        continue;
      }
      console.log(`  close CONFIRMED block=${rcpt.blockNumber} gas=${rcpt.gasUsed}`);
      closeTx = tx;
      break;
    } catch (e) {
      console.log(`  close failed (attempt ${attempt + 1}): ${formatRevert(e)}`);
      await new Promise((r) => setTimeout(r, 3_000));
    }
  }
  if (!closeTx) throw new Error("close tx REVERTED");

  const posClosed = await waitForCleared(hook, trader.address);
  assert("position cleared", (posClosed.collateralAmount as bigint) === 0n, `collateral=${posClosed.collateralAmount}`);
  const debtAfter = await hook.solverDebts(HOOK_POOL_ID, trader.address, solver.address);
  assert(
    "solver debt cleared",
    (debtAfter.principal as bigint) === 0n,
    `principal=${debtAfter.principal}`,
  );

  const traderWethAfter = (await weth.balanceOf(trader.address)) as bigint;
  const solverWethAfter = (await weth.balanceOf(solver.address)) as bigint;
  console.log(`  trader WETH: ${traderWethBefore} -> ${traderWethAfter} (Δ=${traderWethAfter - traderWethBefore})`);
  console.log(`  solver WETH: ${solverWethBefore} -> ${solverWethAfter} (Δ=${solverWethAfter - solverWethBefore})`);
  assert("trader received WETH payout", traderWethAfter > traderWethBefore, `Δ=${traderWethAfter - traderWethBefore}`);
  assert("solver repaid in WETH", solverWethAfter > solverWethBefore, `Δ=${solverWethAfter - solverWethBefore}`);

  console.log("\n=== SHORT CANARY PASSED: all assertions hold ===");
  console.log(`  Open: ${txHash}`);
  console.log(`  Close: ${closeTx.hash}`);
  console.log(`  Protocol fees accrued in USDC: ${feeDelta} wei (${ethers.formatUnits(feeDelta, 6)} USDC)`);
  console.log(`  [NOTE] USDC-protocol-fee sweep is a separate owner action (hook.withdrawProtocolFee(USDC, amount)).`);
}

function assert(label: string, ok: boolean, detail: string): void {
  console.log(`  [${ok ? "PASS" : "FAIL"}] ${label}: ${detail}`);
  if (!ok) throw new Error(`FAIL: ${label}`);
}

/** Public RPC nodes can serve stale state right after a confirmation; poll until cleared. */
async function waitForCleared(hook: ethers.Contract, traderAddr: string): Promise<{ collateralAmount: bigint }> {
  const deadline = Date.now() + 15_000;
  let pos = await hook.positions(HOOK_POOL_ID, traderAddr);
  while ((pos.collateralAmount as bigint) !== 0n && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2_000));
    pos = await hook.positions(HOOK_POOL_ID, traderAddr);
  }
  return pos;
}

async function selfFill(
  trader: ethers.Wallet,
  solver: ethers.Wallet,
  intent: SignedIntent,
  provider: ethers.JsonRpcProvider,
): Promise<string | null> {
  const routerRead = new ethers.Contract(ROUTER, ROUTER_ABI, provider);
  const params = buildSwapParams(intent, solver.address);
  const intentStruct = toIntentStruct(intent);
  const calldata = routerRead.interface.encodeFunctionData("swapWithIntent", [
    params,
    intent.trader,
    intentStruct,
    intent.signature,
  ]);
  try {
    await provider.call({ from: solver.address, to: ROUTER, data: calldata });
    console.log(`  sim OK`);
  } catch (e) {
    console.log(`  sim REVERT: ${formatRevert(e, routerRead.interface)}`);
    return null;
  }
  const routerWrite = new ethers.Contract(ROUTER, ROUTER_ABI, solver);
  // Broadcast can hit a lagging node; retry once if the tx reverts on-chain.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const tx = await routerWrite.swapWithIntent(params, intent.trader, intentStruct, intent.signature);
      console.log(`  self-fill tx=${tx.hash}`);
      const rcpt = await tx.wait();
      if (rcpt?.status !== 1) {
        console.log(`  fill REVERTED on-chain (attempt ${attempt + 1})`);
        await new Promise((r) => setTimeout(r, 3_000));
        continue;
      }
      console.log(`  CONFIRMED block=${rcpt.blockNumber} gas=${rcpt.gasUsed} origin=${rcpt.from}`);
      return tx.hash;
    } catch (e) {
      console.log(`  fill broadcast error (attempt ${attempt + 1}): ${formatRevert(e, routerRead.interface)}`);
      await new Promise((r) => setTimeout(r, 3_000));
    }
  }
  return null;
}

async function findRecentFillTx(traderAddr: string): Promise<string | null> {
  const provider = getProvider();
  const latest = await provider.getBlockNumber();
  const from = Math.max(0, latest - 2000);
  const traderTopic = ethers.zeroPadValue(traderAddr, 32);
  const poolTopic = ethers.zeroPadValue(HOOK_POOL_ID, 32);
  try {
    const logs = await provider.getLogs({
      address: HOOK,
      topics: [MARGIN_OPENED_TOPIC, poolTopic, traderTopic],
      fromBlock: from,
      toBlock: latest,
    });
    if (logs.length === 0) return null;
    return logs[logs.length - 1].transactionHash;
  } catch {
    return null;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
