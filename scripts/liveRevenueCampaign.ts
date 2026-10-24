/**
 * Stage 5b — Live Revenue Campaign (Base 8453).
 *
 * Executes 5 sequential $0.05-margin leveraged trades (5x => $0.20 borrow)
 * through the full intent -> relay -> solver pipeline. Each trade cycles:
 *
 *   open (intent + fill) -> fee assert -> close (trader-signed) -> escrow reseed
 *
 * The cycle is required because `registerMarginOpen` reverts with
 * `PositionAlreadyOpen` while a position exists, and because close repayments
 * land in the wallets (not escrow), so the borrow leg must be re-bonded before
 * the next open. Margins are balance-aware: round-trip fees erode ~0.15%, so
 * each trade sizes margin = min(CAMPAIGN_MARGIN_CAP, current USDC balance) and
 * the campaign aborts if the balance decays below CAMPAIGN_MIN_MARGIN. Both
 * thresholds are env-overridable for reduced-size live runs.
 *
 * Per-trade fee verification (the fee is charged once, on open):
 *   ΔprotocolFees(WETH) == boughtWeth * protocolFeeFor(trader) / 10000
 *   using integer arithmetic identical to the Solidity expression.
 *
 * Treasury sweep (owner action, end of campaign):
 *   `withdrawProtocolFee(WETH, fees)` and verify the treasury's WETH ERC-20
 *   balance grew by the swept amount.
 *
 * FINDING (live Base hook, 2026-10-20): the sweep reverted with `Panic(17)`/
 *   `Panic(0x11)` for WETH regardless of amount. Root cause was on-chain: the
 *   hook burned its entire ERC-6909 claim balance on close (including the fee
 *   share), so `heldReserve(WETH)` floored to 0 and the withdraw path's
 *   `manager.burn(this, claimId, amount)` underflowed in the PoolManager.
 *   FIXED: `_burnableClaims(currency) = balanceOf(hook, claimId) − protocolFees`
 *   now reserves the fee share, so `heldReserve` floors to `protocolFees` after
 *   a full cycle and the sweep succeeds. Verified live on the redeployed hook.
 *
 * Run: npx tsx scripts/liveRevenueCampaign.ts
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
  ownerWallet,
  solverWallet,
  toIntentStruct,
  traderWallet,
  type SignedIntent,
} from "./lib/eswapBase";

const TRADE_COUNT = Number(process.env.CAMPAIGN_TRADES ?? 5);
const MARGIN_CAP = BigInt(process.env.CAMPAIGN_MARGIN_CAP ?? 50_000); // $0.05 USDC (6 dp)
const MIN_MARGIN = BigInt(process.env.CAMPAIGN_MIN_MARGIN ?? 40_000); // abort if erosion takes us below this
const LEVERAGE = 5;
const RELAY_WAIT_MS = Number(process.env.CAMPAIGN_RELAY_WAIT_MS ?? 15_000);
const POLL_INTERVAL_MS = 2_000;

const MARGIN_OPENED_TOPIC = ethers.id("MultiPoolMarginOpened(bytes32,address,uint8,uint256,uint256)");

/** Poll the trader's USDC balance until it reaches `min` (or time out). */
async function waitForUsdcAtLeast(
  provider: ethers.JsonRpcProvider,
  traderAddr: string,
  min: bigint,
): Promise<void> {
  const usdc = new ethers.Contract(USDC, ERC20_ABI, provider);
  const deadline = Date.now() + 20_000;
  let bal = (await usdc.balanceOf(traderAddr)) as bigint;
  while (bal < min && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2_000));
    bal = (await usdc.balanceOf(traderAddr)) as bigint;
  }
  console.log(`  trader USDC after close: ${bal}`);
}

interface TradeRecord {
  index: number;
  margin: bigint;
  borrow: bigint;
  boughtWeth: bigint;
  expectedFee: bigint;
  feeDelta: bigint;
  openTx: string;
  closeTx: string;
  gasUsed: bigint;
}

async function main() {
  console.log("=== Stage 5b: Live Revenue Campaign (Base 8453) ===");
  console.log(`Trades: ${TRADE_COUNT}  Leverage: ${LEVERAGE}x  Margin cap: $${ethers.formatUnits(MARGIN_CAP, 6)}/trade (min $${ethers.formatUnits(MIN_MARGIN, 6)})`);

  const provider = getProvider();
  const net = await provider.getNetwork();
  if (Number(net.chainId) !== 8453) throw new Error(`RPC is chain ${net.chainId}, expected 8453`);
  console.log(`RPC chainId: ${net.chainId}  block = ${await provider.getBlockNumber()}`);

  const trader = traderWallet(provider);
  const solver = solverWallet(provider);
  console.log(`Trader (W#1): ${trader.address}`);
  console.log(`Solver (W#2): ${solver.address}`);

  const usdc = new ethers.Contract(USDC, ERC20_ABI, provider);
  const hook = new ethers.Contract(HOOK, HOOK_ABI, provider);
  const routerRead = new ethers.Contract(ROUTER, ROUTER_ABI, provider);

  const feeBps = (await hook.protocolFeeFor(trader.address)) as bigint;
  console.log(`protocolFeeFor(trader): ${feeBps} bps`);

  // A leftover open position (e.g. from a failed canary) blocks every open.
  await closeIfOpen(trader, solver, provider, hook);

  // ─── Execute trades ───────────────────────────────────────────────────────
  const records: TradeRecord[] = [];
  for (let i = 0; i < TRADE_COUNT; i++) {
    const bal = (await usdc.balanceOf(trader.address)) as bigint;
    const margin = bal < MARGIN_CAP ? bal : MARGIN_CAP;
    if (margin < MIN_MARGIN) {
      console.log(`\n[STOP] trade ${i + 1}: trader USDC ${bal} < min margin ${MIN_MARGIN} — campaign complete`);
      break;
    }
    const borrow = margin * BigInt(LEVERAGE - 1);
    console.log(`\n--- Trade ${i + 1}/${TRADE_COUNT}: margin=${margin} ($${ethers.formatUnits(margin, 6)}) lev=${LEVERAGE}x borrow=${borrow} ---`);

    // 1. Bond the borrow leg (close repays to the wallet, not escrow).
    await ensureSolverEscrow(solver, borrow, false, provider);

    // 2. Open.
    const open = await executeTrade(i, margin, trader, solver, provider, routerRead, usdc);
    if (!open) {
      console.log(`[FAIL] trade ${i + 1} open did not complete — aborting campaign.`);
      break;
    }

    // 3. Per-trade fee assert (fee is charged once, on open).
    const feeDelta = ((await hook.protocolFees(WETH)) as bigint) - open.feesBefore;
    const feeOk = feeDelta === open.expectedFee;
    console.log(`  fee Δ=${feeDelta} expected=${open.expectedFee} [${feeOk ? "PASS" : "FAIL"}]`);
    if (!feeOk) throw new Error(`trade ${i + 1}: protocol fee mismatch Δ=${feeDelta} expected=${open.expectedFee}`);

    // 4. Close (trader-signed) — returns margin+payout USDC to the trader and
    //    principal+yield to the solver, recycling capital for the next cycle.
    const closeTx = await closePositionTx(trader, solver, provider);
    if (!closeTx) throw new Error(`trade ${i + 1}: close failed`);
    // The next iteration reads the trader balance; wait for the close to be
    // reflected so a stale read never ends the campaign prematurely.
    await waitForUsdcAtLeast(provider, trader.address, MIN_MARGIN);

    records.push({
      index: i,
      margin,
      borrow,
      boughtWeth: open.boughtWeth,
      expectedFee: open.expectedFee,
      feeDelta,
      openTx: open.txHash,
      closeTx,
      gasUsed: open.gasUsed,
    });
    console.log(`  trade ${i + 1} complete: open=${open.txHash.slice(0, 18)}.. close=${closeTx.slice(0, 18)}..`);
  }

  if (records.length === 0) throw new Error("no trades completed — campaign FAILED");

  // ─── Campaign-wide fee summary ────────────────────────────────────────────
  const totalBought = records.reduce((a, r) => a + r.boughtWeth, 0n);
  const totalFees = records.reduce((a, r) => a + r.feeDelta, 0n);
  console.log("\n--- Campaign Fee Summary ---");
  console.log(`Trades          : ${records.length}/${TRADE_COUNT}`);
  console.log(`Σ bought WETH   : ${totalBought} wei`);
  console.log(`Σ protocol fees : ${totalFees} WETH wei (${feeBps} bps)`);

  // ─── Treasury sweep (owner action) ────────────────────────────────────────
  await treasurySweep(provider, hook);

  // ─── Summary ──────────────────────────────────────────────────────────────
  console.log("\n=== CAMPAIGN SUMMARY ===");
  for (const r of records) {
    console.log(
      `  #${r.index + 1} margin=$${ethers.formatUnits(r.margin, 6)} bought=${r.boughtWeth} fee=${r.feeDelta} gas=${r.gasUsed} open=${r.openTx.slice(0, 18)}.. close=${r.closeTx.slice(0, 18)}..`,
    );
  }
  console.log(`Protocol fees accrued (this campaign): ${totalFees} WETH wei`);
}

// ─── Escrow reseed ───────────────────────────────────────────────────────────
async function ensureSolverEscrow(
  solver: ethers.Wallet,
  borrow: bigint,
  zeroForOne: boolean,
  provider: ethers.JsonRpcProvider,
): Promise<void> {
  const token = zeroForOne ? WETH : USDC;
  const erc20 = new ethers.Contract(token, ERC20_ABI, provider);
  const routerRead = new ethers.Contract(ROUTER, ROUTER_ABI, provider);
  const escrow = (await routerRead.erc20BorrowEscrow(solver.address, token)) as bigint;
  if (escrow >= borrow) {
    console.log(`  escrow ${escrow} >= borrow ${borrow} — OK`);
    return;
  }
  const bal = (await erc20.balanceOf(solver.address)) as bigint;
  let need = borrow - escrow;
  if (need > bal) need = bal;
  if (need === 0n) {
    console.log(`  [WARN] solver wallet empty and escrow ${escrow} < borrow ${borrow} — fill may revert`);
    return;
  }
  const allow = (await erc20.allowance(solver.address, ROUTER)) as bigint;
  if (allow < need) {
    const approveTx = await new ethers.Contract(token, ERC20_ABI, solver).approve(ROUTER, need);
    await approveTx.wait();
  }
  const depTx = await new ethers.Contract(ROUTER, ROUTER_ABI, solver).depositBorrowEscrow(token, need);
  await depTx.wait();
  // Public RPC can lag; wait until the escrow read reflects the deposit so the
  // immediately-following fill simulation never sees a stale (pre-deposit) value.
  const expected = escrow + need;
  let after = (await routerRead.erc20BorrowEscrow(solver.address, token)) as bigint;
  const deadline = Date.now() + 20_000;
  while (after < expected && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2_000));
    after = (await routerRead.erc20BorrowEscrow(solver.address, token)) as bigint;
  }
  console.log(`  escrow topped up: ${escrow} -> ${after} (deposited ${need})`);
}

// ─── Single open ─────────────────────────────────────────────────────────────
async function executeTrade(
  index: number,
  margin: bigint,
  trader: ethers.Wallet,
  solver: ethers.Wallet,
  provider: ethers.JsonRpcProvider,
  routerRead: ethers.Contract,
  usdc: ethers.Contract,
): Promise<{ boughtWeth: bigint; expectedFee: bigint; feesBefore: bigint; txHash: string; gasUsed: bigint } | null> {
  const hook = new ethers.Contract(HOOK, HOOK_ABI, provider);
  const feesBefore = (await hook.protocolFees(WETH)) as bigint;

  const allow = (await usdc.allowance(trader.address, ROUTER)) as bigint;
  if (allow < margin) {
    console.log(`  approving ${margin} USDC -> router...`);
    const tx = await new ethers.Contract(USDC, ERC20_ABI, trader).approve(ROUTER, margin);
    await tx.wait();
  }

  const intent = await buildAndSignIntent(
    trader,
    { trader: trader.address, solver: solver.address, margin, leverage: LEVERAGE },
    provider,
  );

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
  let txHash: string | null = null;
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
  if (!txHash) return null;

  const rcpt = await provider.getTransactionReceipt(txHash);
  if (!rcpt || rcpt.status !== 1) {
    console.log(`  fill tx reverted or missing`);
    return null;
  }

  let boughtWeth = 0n;
  for (const log of rcpt.logs) {
    if (log.topics[0] === MARGIN_OPENED_TOPIC && log.address.toLowerCase() === HOOK.toLowerCase()) {
      const parsed = ethers.AbiCoder.defaultAbiCoder().decode(["uint8", "uint256", "uint256"], log.data);
      boughtWeth = parsed[2] as bigint;
      console.log(`  MultiPoolMarginOpened: leverage=${parsed[0]} margin=${parsed[1]} bought=${boughtWeth}`);
      break;
    }
  }
  if (boughtWeth === 0n) {
    console.log(`  [WARN] MultiPoolMarginOpened event not found — fee assert will fail`);
  }

  const actualFeeBps = (await hook.protocolFeeFor(trader.address)) as bigint;
  const expectedFee = (boughtWeth * actualFeeBps) / 10000n;

  // The open must have produced a live position. Public RPC serves stale state
  // right after a confirmation, so poll until the position appears.
  const hookRead = new ethers.Contract(HOOK, HOOK_ABI, provider);
  let collateral = 0n;
  const posDeadline = Date.now() + 20_000;
  while (collateral === 0n && Date.now() < posDeadline) {
    const pos = await hookRead.positions(HOOK_POOL_ID, trader.address);
    collateral = pos.collateralAmount as bigint;
    if (collateral === 0n) await new Promise((r) => setTimeout(r, 2_000));
  }
  if (collateral === 0n) {
    console.log(`  [FAIL] position not recorded after fill`);
    return null;
  }

  return { boughtWeth, expectedFee, feesBefore, txHash, gasUsed: rcpt.gasUsed };
}

// ─── Close helpers ───────────────────────────────────────────────────────────
async function closeIfOpen(
  trader: ethers.Wallet,
  solver: ethers.Wallet,
  provider: ethers.JsonRpcProvider,
  hook: ethers.Contract,
): Promise<void> {
  const pos = await hook.positions(HOOK_POOL_ID, trader.address);
  const collateral = pos.collateralAmount as bigint;
  if (collateral === 0n) {
    console.log(`\nNo leftover position — ready.`);
    return;
  }
  console.log(`\nLeftover position open (collateral=${collateral}) — closing before campaign...`);
  const tx = await closePositionTx(trader, solver, provider);
  if (!tx) throw new Error("failed to close leftover position");
  console.log(`  closed: ${tx}`);
}

/**
 * Trader-signed close. The reverse quote returns the GROSS swap output, but
 * close settles NET of the repaid principal, so a quote-derived floor
 * over-constrains and reverts with SlippageExceeded. Use a minimal floor (1)
 * that still catches a zero-output failure — matches the fork suite's
 * permissive close floor.
 */
async function closePositionTx(
  trader: ethers.Wallet,
  solver: ethers.Wallet,
  provider: ethers.JsonRpcProvider,
): Promise<string | null> {
  const hook = new ethers.Contract(HOOK, HOOK_ABI, provider);
  // Wait for the position to be visible on the node we broadcast through;
  // closing against a node that hasn't yet indexed the open reverts with
  // NoActivePosition.
  let collateral = 0n;
  const seenDeadline = Date.now() + 20_000;
  while (collateral === 0n && Date.now() < seenDeadline) {
    const pos = await hook.positions(HOOK_POOL_ID, trader.address);
    collateral = pos.collateralAmount as bigint;
    if (collateral === 0n) await new Promise((r) => setTimeout(r, 2_000));
  }
  if (collateral === 0n) {
    console.log(`  no position to close`);
    return null;
  }

  const minOut = 1n;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const routerWrite = new ethers.Contract(ROUTER, ROUTER_ABI, trader);
      const tx = (await routerWrite.closePosition(HOOK, HOOK_KEY, trader.address, solver.address, minOut)) as ethers.TransactionResponse;
      console.log(`  closePosition tx=${tx.hash}`);
      const rcpt = await tx.wait();
      if (rcpt?.status !== 1) {
        console.log(`  close REVERTED (attempt ${attempt + 1})`);
        await new Promise((r) => setTimeout(r, 3_000));
        continue;
      }
      console.log(`  close CONFIRMED block=${rcpt.blockNumber} gas=${rcpt.gasUsed}`);
      return tx.hash;
    } catch (e) {
      console.log(`  closePosition failed (attempt ${attempt + 1}): ${formatRevert(e)}`);
      await new Promise((r) => setTimeout(r, 3_000));
    }
  }
  return null;
}

// ─── Self-fill ───────────────────────────────────────────────────────────────
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
  } catch (e) {
    console.log(`  sim REVERT: ${formatRevert(e, routerRead.interface)}`);
    return null;
  }

  const routerWrite = new ethers.Contract(ROUTER, ROUTER_ABI, solver);
  // Broadcast can hit a lagging node that still serves pre-deposit escrow state;
  // retry once if the tx reverts on-chain despite a passing simulation.
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
      console.log(`  CONFIRMED block=${rcpt.blockNumber} gas=${rcpt.gasUsed}`);
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

// ─── Treasury sweep ──────────────────────────────────────────────────────────
async function treasurySweep(provider: ethers.JsonRpcProvider, hook: ethers.Contract): Promise<void> {
  console.log("\n--- Treasury Sweep (Owner Action) ---");
  const owner = ownerWallet(provider);
  console.log(`Owner wallet: ${owner.address}`);

  const hookOwner = (await hook.owner()) as string;
  console.log(`hook.owner(): ${hookOwner}`);
  if (hookOwner.toLowerCase() !== owner.address.toLowerCase()) {
    console.log(`[WARN] PRIVATE_KEY != hook.owner() — withdrawProtocolFee will revert. Skipping sweep.`);
    return;
  }

  const treasury = (await hook.treasury()) as string;
  console.log(`hook.treasury(): ${treasury}`);
  if (treasury === ethers.ZeroAddress) {
    console.log(`treasury unset — skipping sweep (setConfig not attempted; live hook already has a treasury).`);
    return;
  }

  const feesAvailable = (await hook.protocolFees(WETH)) as bigint;
  if (feesAvailable === 0n) {
    console.log(`No protocol fees accrued — nothing to sweep.`);
    return;
  }

  // The treasury is a plain address receiving an ERC-20 WETH transfer, so the
  // receipt must be measured on the WETH token balance — NOT native ETH.
  const weth = new ethers.Contract(WETH, ERC20_ABI, provider);
  const treasuryBefore = (await weth.balanceOf(treasury)) as bigint;
  console.log(`\nWithdrawing ${feesAvailable} WETH wei to treasury ${treasury}...`);
  try {
    const hookWrite = new ethers.Contract(HOOK, HOOK_ABI, owner);
    const tx = await hookWrite.withdrawProtocolFee(WETH, feesAvailable);
    console.log(`  withdrawProtocolFee tx=${tx.hash}`);
    const rcpt = await tx.wait();
    if (rcpt?.status !== 1) throw new Error("withdrawProtocolFee reverted");
    console.log(`  CONFIRMED block=${rcpt.blockNumber} gas=${rcpt.gasUsed}`);

    // Public RPCs can serve a pre-tx (stale) state right after wait(), so poll
    // the treasury balance until the credit is visible before comparing.
    let treasuryAfter = (await weth.balanceOf(treasury)) as bigint;
    {
      const deadline = Date.now() + 20_000;
      while (treasuryAfter === treasuryBefore && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 2_000));
        treasuryAfter = (await weth.balanceOf(treasury)) as bigint;
      }
    }
    const received = treasuryAfter - treasuryBefore;
    const sweepOk = received === feesAvailable;
    console.log(`  treasury WETH before: ${treasuryBefore}`);
    console.log(`  treasury WETH after : ${treasuryAfter}`);
    console.log(`  received            : ${received}`);
    console.log(`  [${sweepOk ? "PASS" : "FAIL"}] treasury received exactly the swept fees`);
  } catch (e) {
    console.log(`  withdrawProtocolFee failed: ${formatRevert(e)}`);
  }

  const feesRemaining = (await hook.protocolFees(WETH)) as bigint;
  console.log(`protocolFees(WETH) after sweep: ${feesRemaining}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
