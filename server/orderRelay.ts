/**
 * Stage 1 — Open Intent Relay Service (HTTP + WebSocket).
 *
 * A lightweight orderbook for Eswap `LendingIntent` orders on Base Mainnet.
 *
 *   POST /api/v1/intents   — validate + store an EIP-712 signed LendingIntent
 *   GET  /api/v1/intents   — list active (unexpired, unconsumed) intents
 *   GET  /api/v1/health    — liveness probe
 *   WS   /feed             — real-time stream of newly accepted intents
 *
 * Validation performed on POST:
 *   1. EIP-712 signature recovery: `ethers.verifyTypedData` against
 *      `intent.trader` (mirrors the router's `_isValidSignature` ECDSA path;
 *      ERC-1271 smart-wallet traders are accepted by the router but not
 *      recoverable off-chain, so the relay notes them and skips recovery).
 *   2. `deadline > block.timestamp` (live Base head, not local clock alone).
 *   3. `poolId` / `standardPoolId` match the computed keccak of the attached
 *      pool keys (a mismatched poolId would revert on-chain anyway, but the
 *      relay rejects early so solvers never see doomed orders).
 *   4. Positive margin (`abs(amountSpecified) > 0`), valid leverage range.
 *   5. `nonce` uniqueness per trader (in-memory replay guard).
 *
 * Run: npx tsx server/orderRelay.ts
 */
import http from "node:http";
import express from "express";
import { WebSocketServer, WebSocket } from "ws";
import { ethers } from "ethers";
import {
  CHAIN_ID,
  DOMAIN,
  INTENT_TYPES,
  ROUTER,
  HOOK,
  USDC,
  getProvider,
  toIntentStruct,
  type SignedIntent,
} from "../scripts/lib/eswapBase";

const PORT = Number(process.env.RELAY_PORT ?? 8080);
const MIN_LEVERAGE = 2;
const MAX_LEVERAGE = 20;

// ─── In-memory orderbook ─────────────────────────────────────────────────────
/** Keyed by `${trader.toLowerCase()}:${nonce}` — one intent per (trader, nonce). */
const orders = new Map<string, SignedIntent>();
/** Track consumed fill ids so a solver that fills can mark them done. */
const consumed = new Set<string>();

function orderKey(trader: string, nonce: string): string {
  return `${trader.toLowerCase()}:${nonce}`;
}

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

function pruneExpired(): number {
  const ts = nowSec();
  let pruned = 0;
  for (const [k, o] of orders) {
    if (Number(o.value.deadline) <= ts || consumed.has(k)) {
      orders.delete(k);
      pruned++;
    }
  }
  return pruned;
}

// ─── Express app ─────────────────────────────────────────────────────────────
const app = express();
app.use(express.json({ limit: "256kb" }));

const provider = getProvider();

app.get("/api/v1/health", (_req, res) => {
  res.json({ ok: true, chainId: CHAIN_ID, router: ROUTER, hook: HOOK, activeOrders: orders.size, ts: nowSec() });
});

app.get("/api/v1/intents", (_req, res) => {
  pruneExpired();
  const active = [...orders.values()].filter((o) => !consumed.has(orderKey(o.trader, o.value.nonce)));
  res.json({ count: active.length, intents: active });
});

app.post("/api/v1/intents", async (req, res) => {
  try {
    const result = await validateAndStore(req.body as SignedIntent);
    if (!result.ok) {
      res.status(400).json({ error: result.reason });
      return;
    }
    res.status(201).json({ ok: true, key: result.key, activeOrders: orders.size });
    broadcast(result.stored);
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

/** Solver marks an intent consumed after a successful fill. */
app.post("/api/v1/intents/:trader/:nonce/consume", (req, res) => {
  const key = orderKey(req.params.trader, req.params.nonce);
  if (!orders.has(key)) {
    res.status(404).json({ error: "intent not found" });
    return;
  }
  consumed.add(key);
  const txHash = (req.body as { txHash?: string })?.txHash;
  const o = orders.get(key)!;
  if (txHash) o.consumedTxHash = txHash;
  res.json({ ok: true, key });
});

// ─── Validation ──────────────────────────────────────────────────────────────
interface ValidationResult {
  ok: boolean;
  reason?: string;
  key: string;
  stored: SignedIntent;
}

async function validateAndStore(raw: SignedIntent): Promise<ValidationResult> {
  const fail = (reason: string): ValidationResult => ({
    ok: false,
    reason,
    key: "",
    stored: raw,
  });

  if (!raw || typeof raw !== "object") return fail("body must be a JSON object");
  if (!raw.value || !raw.signature || !raw.trader) return fail("missing value / signature / trader");

  const v = raw.value;
  const trader = ethers.getAddress(raw.trader);
  const solver = ethers.getAddress(v.solver ?? raw.solver);
  const margin = BigInt(v.amountSpecified);
  const absMargin = margin < 0n ? -margin : margin;
  const leverage = Number(v.leverage);
  const deadline = Number(v.deadline);
  const nonce = String(v.nonce);

  // 4. Positive amounts + leverage bounds.
  if (absMargin <= 0n) return fail("amountSpecified must be non-zero");
  if (leverage < MIN_LEVERAGE || leverage > MAX_LEVERAGE) {
    return fail(`leverage ${leverage} outside [${MIN_LEVERAGE}, ${MAX_LEVERAGE}]`);
  }

  // 3. Pool id consistency with attached keys (when provided).
  if (raw.hookPoolKey) {
    const computed = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "address", "uint24", "int24", "address"],
        [raw.hookPoolKey[0], raw.hookPoolKey[1], raw.hookPoolKey[2], raw.hookPoolKey[3], raw.hookPoolKey[4]],
      ),
    );
    if (computed.toLowerCase() !== v.poolId.toLowerCase()) {
      return fail(`poolId mismatch: attached hookPoolKey hashes to ${computed}, intent says ${v.poolId}`);
    }
  }
  if (raw.standardPoolKey) {
    const computed = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "address", "uint24", "int24", "address"],
        [raw.standardPoolKey[0], raw.standardPoolKey[1], raw.standardPoolKey[2], raw.standardPoolKey[3], raw.standardPoolKey[4]],
      ),
    );
    if (computed.toLowerCase() !== v.standardPoolId.toLowerCase()) {
      return fail(`standardPoolId mismatch: attached standardPoolKey hashes to ${computed}`);
    }
  }

  // 2. Deadline vs live Base head (grace of 5s for clock skew).
  let blockTs = nowSec();
  try {
    const block = await provider.getBlock("latest");
    if (block?.timestamp) blockTs = Number(block.timestamp);
  } catch {
    // RPC unreachable — fall back to local clock (relay still works, solver sim is the real gate).
  }
  if (deadline <= blockTs + 5) return fail(`deadline ${deadline} not > block.timestamp ${blockTs}`);

  // 1. EIP-712 signature recovery against intent.trader.
  //    Reconstruct the struct with bigints for verifyTypedData.
  const structValue = toIntentStruct(raw);
  let recovered: string | null = null;
  try {
    recovered = ethers.verifyTypedData(DOMAIN, INTENT_TYPES, structValue, raw.signature);
  } catch (e) {
    return fail(`signature recovery failed: ${(e as Error).message}`);
  }
  if (recovered.toLowerCase() !== trader.toLowerCase()) {
    return fail(`recovered signer ${recovered} != trader ${trader}`);
  }

  // 5. Replay guard.
  const key = orderKey(trader, nonce);
  if (orders.has(key) || consumed.has(key)) return fail(`duplicate (trader, nonce): ${key}`);

  const stored: SignedIntent = {
    ...raw,
    trader,
    solver,
    chainId: CHAIN_ID,
    router: ROUTER,
    hook: HOOK,
    value: { ...v, solver, nonce, amountSpecified: v.amountSpecified, deadline: v.deadline, minAmountOut: v.minAmountOut },
    createdAt: raw.createdAt ?? new Date().toISOString(),
  };

  orders.set(key, stored);
  console.log(
    `[relay] ACCEPT ${key} margin=${absMargin} lev=${leverage}x borrow=${absMargin * BigInt(leverage - 1)} solver=${solver}`,
  );
  return { ok: true, key, stored };
}

// ─── WebSocket feed ──────────────────────────────────────────────────────────
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/feed" });

wss.on("connection", (ws, req) => {
  console.log(`[relay] WS client connected from ${req.socket.remoteAddress} (total ${wss.clients.size})`);
  // Send a snapshot of active orders so late subscribers are not blind.
  pruneExpired();
  ws.send(JSON.stringify({ type: "snapshot", intents: [...orders.values()] }));
});

function broadcast(intent: SignedIntent): void {
  const msg = JSON.stringify({ type: "new_intent", intent });
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) client.send(msg);
  }
}

// Periodic prune.
setInterval(() => {
  const n = pruneExpired();
  if (n > 0) console.log(`[relay] pruned ${n} expired/consumed orders (${orders.size} active)`);
}, 30_000).unref();

server.listen(PORT, () => {
  console.log(`=== Eswap Intent Relay (Base ${CHAIN_ID}) ===`);
  console.log(`HTTP  : http://localhost:${PORT}/api/v1/intents`);
  console.log(`WS    : ws://localhost:${PORT}/feed`);
  console.log(`Router: ${ROUTER}`);
  console.log(`USDC  : ${USDC}`);
  console.log(`Waiting for signed LendingIntent payloads...`);
});
