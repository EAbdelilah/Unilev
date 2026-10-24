/**
 * Stage 2 — Autonomous Solver Bot (Wallet #2 / SOLVER_PRIVATE_KEY).
 *
 * Subscribes to the Intent Relay WebSocket feed (with HTTP poll fallback),
 * checks borrow-escrow coverage for each incoming LendingIntent, tops up
 * escrow when short, then simulates and broadcasts `EswapRouter.swapWithIntent`
 * on Base Mainnet — fronting the borrow leg from the bonded escrow.
 *
 * Env:
 *   SOLVER_PRIVATE_KEY   required — Wallet #2 signing key
 *   RELAY_WS_URL         default ws://localhost:8080/feed
 *   RELAY_HTTP_URL       default http://localhost:8080
 *   SOLVER_DRY_RUN       "1" to simulate-only (no broadcast); unset = live
 *   SOLVER_POLL_MS       poll interval for HTTP fallback (default 5000)
 *
 * Run: npx tsx bot/solverBot.ts
 */
import { ethers } from "ethers";
import WebSocket from "ws";
import {
  ROUTER,
  ROUTER_ABI,
  ERC20_ABI,
  USDC,
  WETH,
  marginToken,
  getProvider,
  solverWallet,
  buildSwapParams,
  toIntentStruct,
  formatRevert,
  RELAY_WS,
  RELAY_HTTP,
  type SignedIntent,
} from "../scripts/lib/eswapBase";

const DRY_RUN = process.env.SOLVER_DRY_RUN === "1";
const POLL_MS = Number(process.env.SOLVER_POLL_MS ?? 5_000);
/** Top up escrow toward this multiple of the borrow, capped at wallet balance. */
const ESCROW_HEADROOM = 2n;

const provider = getProvider();
const wallet = solverWallet(provider);
const solverAddress = wallet.address;

const routerRead = new ethers.Contract(ROUTER, ROUTER_ABI, provider);
const routerWrite = new ethers.Contract(ROUTER, ROUTER_ABI, wallet);
const erc20Read = (token: string) => new ethers.Contract(token, ERC20_ABI, provider);
const erc20Write = (token: string) => new ethers.Contract(token, ERC20_ABI, wallet);

/** Nonces we have already attempted (avoid re-processing on reconnect). */
const seen = new Set<string>();
/** Filled intents confirmed on-chain. */
const filled = new Set<string>();

function intentKey(s: SignedIntent): string {
  return `${s.trader.toLowerCase()}:${s.value.nonce}`;
}

async function main() {
  console.log("=== Eswap Autonomous Solver Bot (Base 8453) ===");
  console.log(`Solver wallet     : ${solverAddress}`);
  console.log(`Dry run           : ${DRY_RUN}`);
  console.log(`Relay WS          : ${RELAY_WS}`);
  console.log(`Relay HTTP        : ${RELAY_HTTP}`);

  const net = await provider.getNetwork();
  console.log(`RPC chainId       : ${net.chainId}`);
  if (Number(net.chainId) !== 8453) throw new Error(`RPC is chain ${net.chainId}, expected 8453`);

  const bal = await erc20Read(USDC).balanceOf(solverAddress);
  const escrow = await routerRead.erc20BorrowEscrow(solverAddress, USDC);
  const wethBal = await erc20Read(WETH).balanceOf(solverAddress);
  const wethEscrow = await routerRead.erc20BorrowEscrow(solverAddress, WETH);
  const ethBal = await provider.getBalance(solverAddress);
  console.log(`Solver USDC       : ${ethers.formatUnits(bal, 6)} (${bal} units)`);
  console.log(`USDC borrow escrow: ${ethers.formatUnits(escrow, 6)} (${escrow} units)`);
  console.log(`Solver WETH       : ${ethers.formatEther(wethBal)}`);
  console.log(`WETH borrow escrow: ${ethers.formatEther(wethEscrow)}`);
  console.log(`Solver ETH (gas)  : ${ethers.formatEther(ethBal)}`);

  // ── WebSocket subscription ────────────────────────────────────────────────
  let ws: WebSocket | null = null;
  try {
    ws = new WebSocket(RELAY_WS);
    ws.on("open", () => console.log("[bot] connected to relay feed"));
    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === "new_intent" && msg.intent) {
          void handleIntent(msg.intent as SignedIntent).catch((e) =>
            console.error(`[bot] handle error: ${(e as Error).message}`),
          );
        } else if (msg.type === "snapshot" && Array.isArray(msg.intents)) {
          for (const i of msg.intents as SignedIntent[]) {
            void handleIntent(i).catch(() => {});
          }
        }
      } catch (e) {
        console.error(`[bot] WS parse error: ${(e as Error).message}`);
      }
    });
    ws.on("close", () => {
      console.log("[bot] WS closed — falling back to HTTP polling");
      ws = null;
      startPolling();
    });
    ws.on("error", (e) => {
      console.error(`[bot] WS error: ${e.message} — falling back to HTTP polling`);
      ws = null;
      startPolling();
    });
  } catch {
    startPolling();
  }

  // Keep process alive.
  await new Promise(() => {});
}

function startPolling(): void {
  if ((globalThis as { __pollStarted?: boolean }).__pollStarted) return;
  (globalThis as { __pollStarted?: boolean }).__pollStarted = true;
  console.log(`[bot] polling ${RELAY_HTTP}/api/v1/intents every ${POLL_MS}ms`);
  setInterval(async () => {
    try {
      const res = await fetch(`${RELAY_HTTP}/api/v1/intents`);
      if (!res.ok) return;
      const body = (await res.json()) as { intents: SignedIntent[] };
      for (const i of body.intents ?? []) {
        void handleIntent(i).catch(() => {});
      }
    } catch {
      /* relay not up yet */
    }
  }, POLL_MS).unref?.();
}

// ─── Intent handling ─────────────────────────────────────────────────────────
async function handleIntent(intent: SignedIntent): Promise<void> {
  const key = intentKey(intent);
  if (seen.has(key) || filled.has(key)) return;
  seen.add(key);

  // Only fill intents signed for THIS solver.
  if (intent.solver.toLowerCase() !== solverAddress.toLowerCase()) {
    console.log(`[bot] skip ${key}: solver is ${intent.solver}, not us`);
    return;
  }

  // Skip already-consumed nonces on-chain (replay protection mirror).
  try {
    const fillId = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(["address", "uint256"], [intent.trader, BigInt(intent.value.nonce)]),
    );
    const already = await routerRead.filledIntents(fillId);
    if (already) {
      console.log(`[bot] skip ${key}: already filled on-chain`);
      filled.add(key);
      return;
    }
  } catch { /* continue — sim will catch it */ }

  console.log(`\n[bot] processing ${key}`);
  const margin = BigInt(intent.margin);
  const borrow = BigInt(intent.borrowAmount);
  const leverage = intent.leverage;
  console.log(`[bot]   margin=${margin} borrow=${borrow} lev=${leverage}x`);

  try {
    // 1. Escrow check + top-up (token depends on swap direction).
    await ensureEscrow(borrow, intent.value.zeroForOne);

    // 2. Build swapWithIntent calldata.
    const params = buildSwapParams(intent, solverAddress);
    const intentStruct = toIntentStruct(intent);
    const calldata = routerRead.interface.encodeFunctionData("swapWithIntent", [
      params,
      intent.trader,
      intentStruct,
      intent.signature,
    ]);

    // 3. Simulate via eth_call FROM the solver.
    let simOk = false;
    try {
      const ret = await provider.call({ from: solverAddress, to: ROUTER, data: calldata });
      console.log(`[bot]   sim OK -> ${ret.slice(0, 66)}...`);
      simOk = true;
    } catch (e) {
      console.log(`[bot]   sim REVERT: ${formatRevert(e, routerRead.interface)}`);
    }

    if (!simOk) {
      console.log(`[bot]   NOT broadcasting (simulation reverted)`);
      seen.delete(key); // allow retry if transient
      return;
    }

    if (DRY_RUN) {
      console.log(`[bot]   DRY_RUN=1 — skipping broadcast`);
      return;
    }

    // 4. Broadcast.
    console.log(`[bot]   broadcasting swapWithIntent...`);
    const tx = await routerWrite.swapWithIntent(params, intent.trader, intentStruct, intent.signature);
    console.log(`[bot]   tx.hash=${tx.hash}`);
    const rcpt = await tx.wait();
    if (rcpt?.status === 1) {
      console.log(`[bot]   CONFIRMED block=${rcpt.blockNumber} gas=${rcpt.gasUsed} origin=${rcpt.from}`);
      filled.add(key);
      // Notify the relay the intent is consumed.
      try {
        await fetch(`${RELAY_HTTP}/api/v1/intents/${intent.trader}/${intent.value.nonce}/consume`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ txHash: tx.hash }),
        });
      } catch { /* relay may be down; on-chain filledIntents is the source of truth */ }
    } else {
      console.log(`[bot]   tx REVERTED status=${rcpt?.status}`);
      seen.delete(key);
    }
  } catch (e) {
    console.error(`[bot]   error: ${(e as Error).message}`);
    seen.delete(key);
  }
}

async function ensureEscrow(requiredBorrow: bigint, zeroForOne: boolean): Promise<void> {
  // Borrow token = input token: WETH for shorts (zeroForOne), USDC for longs.
  const token = marginToken(zeroForOne);
  const decimals = zeroForOne ? 18 : 6;
  const read = erc20Read(token);

  const escrow = (await routerRead.erc20BorrowEscrow(solverAddress, token)) as bigint;
  if (escrow >= requiredBorrow) {
    console.log(`[bot]   escrow ${escrow} >= borrow ${requiredBorrow} — OK`);
    return;
  }

  // Target the headroom multiple, but never more than the wallet actually holds —
  // the on-chain requirement is only escrow >= borrow (partial coverage also
  // works: the router tops up from a direct transferFrom), so a capped deposit
  // is always better than reverting here.
  const bal = (await read.balanceOf(solverAddress)) as bigint;
  let need = requiredBorrow * ESCROW_HEADROOM > escrow
    ? requiredBorrow * ESCROW_HEADROOM - escrow
    : 0n;
  if (need > bal) need = bal;
  console.log(
    `[bot]   escrow ${escrow} < borrow ${requiredBorrow}; depositing ${need} (wallet ${bal}, target headroom x${ESCROW_HEADROOM})`,
  );
  if (need === 0n) {
    console.log(`[bot]   wallet empty — fill will top up from transferFrom or revert in sim`);
    return;
  }

  const allowance = (await read.allowance(solverAddress, ROUTER)) as bigint;
  if (allowance < need) {
    console.log(`[bot]   approving ${need} -> router`);
    const approveTx = await erc20Write(token).approve(ROUTER, need);
    await approveTx.wait();
  }

  const depTx = await routerWrite.depositBorrowEscrow(token, need);
  console.log(`[bot]   depositBorrowEscrow tx=${depTx.hash}`);
  await depTx.wait();
  const newEscrow = (await routerRead.erc20BorrowEscrow(solverAddress, token)) as bigint;
  console.log(`[bot]   escrow now ${newEscrow} (${ethers.formatUnits(newEscrow, decimals)})`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
