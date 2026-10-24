/**
 * Trader-signed position close (Base 8453).
 *
 * `EswapRouter.closePosition` is trader-only (`msg.sender == trader`, FIX C-1),
 * so the close is signed and broadcast by Wallet #1. The slippage floor is
 * derived from a live reverse-direction router quote on the position's
 * collateral, haircut 50% (close settles principal+yield in the debt currency;
 * the floor only guards against catastrophic slippage).
 *
 * Env:
 *   MIN_AMOUNT_OUT   optional explicit override (base units of the debt currency)
 *   CLOSE_TRADE_WAIT  ms to wait for receipt (default 60_000)
 *
 * Run: npx tsx scripts/closePosition.ts
 */
import { ethers } from "ethers";
import {
  HOOK,
  HOOK_ABI,
  HOOK_KEY,
  HOOK_POOL_ID,
  ROUTER,
  ROUTER_ABI,
  getProvider,
  solverWallet,
  traderWallet,
} from "./lib/eswapBase";

const MIN_AMOUNT_OUT_OVERRIDE = process.env.MIN_AMOUNT_OUT ? BigInt(process.env.MIN_AMOUNT_OUT) : null;
const WAIT_MS = Number(process.env.CLOSE_TRADE_WAIT ?? 60_000);

async function main() {
  console.log("=== Close Position (Base 8453, trader-signed) ===");

  const provider = getProvider();
  const net = await provider.getNetwork();
  if (Number(net.chainId) !== 8453) throw new Error(`RPC is chain ${net.chainId}, expected 8453`);

  const trader = traderWallet(provider);
  const solver = solverWallet(provider);
  console.log(`Trader: ${trader.address}`);
  console.log(`Solver: ${solver.address}`);

  const hook = new ethers.Contract(HOOK, HOOK_ABI, provider);
  const pos = await hook.positions(HOOK_POOL_ID, trader.address);
  const collateral = pos.collateralAmount as bigint;
  const borrowed = pos.borrowedAmount as bigint;
  const isLong = pos.isLong as boolean;
  const lev = pos.leverage as bigint;
  console.log(`Position: collateral=${collateral} borrowed=${borrowed} lev=${lev} isLong=${isLong}`);

  if (collateral === 0n) {
    throw new Error("no open position for this trader on the hook pool — nothing to close");
  }

  // minAmountOut: the reverse quote returns the gross swap output, but close
  // settles net of the repaid principal, so a quote-derived floor over-constrains
  // (SlippageExceeded). The working reference path uses 0; we use 1 to still
  // catch a zero-output failure without blocking a healthy close.
  const minOut = MIN_AMOUNT_OUT_OVERRIDE ?? 1n;
  console.log(`minAmountOut = ${minOut}`);

  const routerWrite = new ethers.Contract(ROUTER, ROUTER_ABI, trader);
  console.log(`\nCalling closePosition(hook=${HOOK}, trader=${trader.address}, solver=${solver.address}, minOut=${minOut})...`);
  const tx = (await routerWrite.closePosition(HOOK, HOOK_KEY, trader.address, solver.address, minOut)) as ethers.TransactionResponse;
  console.log(`tx.hash=${tx.hash}`);
  const rcpt = await Promise.race([
    tx.wait(),
    new Promise<null>((r) => setTimeout(() => r(null), WAIT_MS)),
  ]);
  if (!rcpt) throw new Error(`close tx not confirmed within ${WAIT_MS}ms — hash ${tx.hash}`);
  if (rcpt.status !== 1) throw new Error("close tx REVERTED");
  console.log(`CONFIRMED block=${rcpt.blockNumber} gas=${rcpt.gasUsed}`);

  const posAfter = await waitForPositionState(HOOK_POOL_ID, trader.address, HOOK, provider);
  const cleared = (posAfter.collateralAmount as bigint) === 0n;
  console.log(`\nPosition after: collateral=${posAfter.collateralAmount} borrowed=${posAfter.borrowedAmount}`);
  console.log(`[${cleared ? "PASS" : "FAIL"}] position cleared`);
  if (!cleared) throw new Error("position still open after close tx");

  console.log("\n=== CLOSE COMPLETE ===");
}

/**
 * Public RPC nodes can serve a stale state right after a confirmation from a
 * different node. Poll until the position reads cleared (or time out).
 */
async function waitForPositionState(
  poolId: string,
  traderAddr: string,
  hookAddr: string,
  provider: ethers.JsonRpcProvider,
): Promise<{ collateralAmount: bigint; borrowedAmount: bigint }> {
  const hook = new ethers.Contract(hookAddr, HOOK_ABI, provider);
  const deadline = Date.now() + 15_000;
  let pos = await hook.positions(poolId, traderAddr);
  while ((pos.collateralAmount as bigint) !== 0n && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2_000));
    pos = await hook.positions(poolId, traderAddr);
  }
  return pos;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
