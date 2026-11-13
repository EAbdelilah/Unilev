/**
 * Lightweight intent relay for Eswap solvers (Base 8453).
 * =======================================================
 *
 * Traders publish signed CoW-style leverage orders here, and solvers poll for
 * the ones they can fill. The relay is an intake and a board, not a custodian:
 * it never holds funds and never submits transactions. Every intent is checked
 * on chain before it is listed (scripts/lib/intents.ts `checkIntent`).
 *
 * Endpoints
 *   POST /intents                  submit {order, scheme, signature}. 201 new, 200 duplicate.
 *   GET  /intents?status=open      open, unexpired, unfilled intents (solver feed).
 *   GET  /intents/:id              one intent. :id is the order UID hash.
 *   POST /intents/:id/filled       {txHash?}. Accepted only if filledOrders(id) is true on chain.
 *   GET  /health
 *
 * Trust model
 *   * Listing: the signature, owner, unfilled status, pair, and leverage
 *     commitment are verified on chain. A bad intent is rejected with 400.
 *   * Settlement: "filled" is accepted only when the settlement's `filledOrders`
 *     is true, so no one can mark an intent filled without it happening on chain.
 *   * The relay does not store private keys and does not sign anything.
 *
 * Run
 *   npx tsx scripts/server/intentRelay.ts          (PORT, default 8787)
 * Env
 *   PORT, BASE_RPC_URL, RELAY_MAX_INTENTS (default 2000), RELAY_MAX_BODY (default 32768)
 */
import http from "node:http";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { ethers } from "ethers";
import { getProvider } from "../lib/eswapBase";
import { COW_SETTLEMENT, RawOrder, SCHEMES, Scheme, SETTLEMENT_ABI, checkIntent } from "../lib/intents";

type Status = "open" | "filled" | "expired";
interface Stored {
    id: string;
    owner: string;
    leverage: number;
    order: RawOrder;
    scheme: Scheme;
    signature: string;
    status: Status;
    createdAt: number;
    expiresAt: number;
    filledAt: number | null;
    txHash: string | null;
}

const TX_HASH = /^0x[0-9a-fA-F]{64}$/;

export function createRelay(opts: { provider?: ethers.Provider; maxIntents?: number; maxBody?: number } = {}) {
    const provider = opts.provider ?? getProvider();
    const maxIntents = opts.maxIntents ?? Number(process.env.RELAY_MAX_INTENTS ?? 2000);
    const maxBody = opts.maxBody ?? Number(process.env.RELAY_MAX_BODY ?? 32768);
    const store = new Map<string, Stored>();
    const settlement = new ethers.Contract(COW_SETTLEMENT, SETTLEMENT_ABI, provider) as unknown as {
        filledOrders(uidHash: string): Promise<boolean>;
    };

    const nowSec = () => Math.floor(Date.now() / 1000);

    /** Marks open intents expired or filled-on-chain. Run on a timer. */
    async function sweep(): Promise<void> {
        for (const rec of store.values()) {
            if (rec.status !== "open") continue;
            if (rec.expiresAt <= nowSec()) {
                rec.status = "expired";
                continue;
            }
            try {
                if (await settlement.filledOrders(rec.id)) {
                    rec.status = "filled";
                    rec.filledAt = nowSec();
                }
            } catch {
                // RPC hiccup: leave the record open and try again next sweep.
            }
        }
    }

    function publicView(r: Stored) {
        return {
            id: r.id,
            owner: r.owner,
            leverage: r.leverage,
            status: r.status,
            order: r.order,
            scheme: r.scheme,
            signature: r.signature,
            createdAt: r.createdAt,
            expiresAt: r.expiresAt,
            filledAt: r.filledAt,
            txHash: r.txHash,
        };
    }

    function send(res: http.ServerResponse, code: number, body: unknown): void {
        res.writeHead(code, {
            "content-type": "application/json",
            "access-control-allow-origin": "*",
            "access-control-allow-methods": "GET, POST, OPTIONS",
            "access-control-allow-headers": "content-type",
        });
        res.end(JSON.stringify(body));
    }

    async function readBody(req: http.IncomingMessage): Promise<unknown> {
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const chunk of req) {
            size += (chunk as Buffer).length;
            if (size > maxBody) throw Object.assign(new Error("body too large"), { status: 413 });
            chunks.push(chunk as Buffer);
        }
        try {
            return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
        } catch {
            throw Object.assign(new Error("body is not valid JSON"), { status: 400 });
        }
    }

    async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        const url = new URL(req.url ?? "/", "http://relay.local");
        const parts = url.pathname.split("/").filter(Boolean);

        if (req.method === "OPTIONS") return send(res, 204, {});
        if (req.method === "GET" && url.pathname === "/health") {
            return send(res, 200, { ok: true, intents: store.size });
        }

        if (parts[0] !== "intents") return send(res, 404, { error: "not found" });

        if (req.method === "POST" && parts.length === 1) {
            if (store.size >= maxIntents) {
                await sweep();
                if (store.size >= maxIntents) return send(res, 503, { error: "intent book full" });
            }
            const body = (await readBody(req)) as { order?: RawOrder; scheme?: string; signature?: string };
            if (!body.order || !body.signature || !body.scheme) {
                return send(res, 400, { error: "need order, scheme and signature" });
            }
            if (!(SCHEMES as readonly string[]).includes(body.scheme)) {
                return send(res, 400, { error: `unknown scheme ${body.scheme}` });
            }
            const scheme = body.scheme as Scheme;
            let checked: Awaited<ReturnType<typeof checkIntent>>;
            try {
                checked = await checkIntent({ order: body.order, scheme, signature: body.signature }, provider);
            } catch (e) {
                // Our validation rules and contract reverts (a malformed signature) are 400.
                // Transport failures mean the chain was unreachable, so 502.
                const err = e as Error & { code?: string };
                const rpcFailure = ["NETWORK_ERROR", "SERVER_ERROR", "TIMEOUT"].includes(String(err.code));
                return send(res, rpcFailure ? 502 : 400, { error: err.message });
            }
            // The id is the on-chain key `filledOrders` uses, so settlement can be checked by id.
            const id = checked.uidHash;
            const existing = store.get(id);
            if (existing) return send(res, 200, publicView(existing));
            const rec: Stored = {
                id,
                owner: checked.owner,
                leverage: checked.leverage,
                order: body.order,
                scheme,
                signature: body.signature,
                status: "open",
                createdAt: nowSec(),
                expiresAt: Number(body.order.validTo),
                filledAt: null,
                txHash: null,
            };
            store.set(id, rec);
            return send(res, 201, publicView(rec));
        }

        if (req.method === "GET" && parts.length === 1) {
            const status = url.searchParams.get("status");
            const now = nowSec();
            const list = [...store.values()]
                .filter((r) => (status ? r.status === status : true))
                .filter((r) => r.status !== "open" || r.expiresAt > now)
                .slice(0, 500)
                .map(publicView);
            return send(res, 200, list);
        }

        if (req.method === "GET" && parts.length === 2) {
            const rec = store.get(parts[1] ?? "");
            return rec ? send(res, 200, publicView(rec)) : send(res, 404, { error: "unknown intent" });
        }

        if (req.method === "POST" && parts.length === 3 && parts[2] === "filled") {
            const rec = store.get(parts[1] ?? "");
            if (!rec) return send(res, 404, { error: "unknown intent" });
            const body = (await readBody(req)) as { txHash?: string };
            if (body.txHash !== undefined && !TX_HASH.test(body.txHash)) {
                return send(res, 400, { error: "txHash must be a 32-byte hex string" });
            }
            if (!(await settlement.filledOrders(rec.id))) {
                return send(res, 409, { error: "not filled on chain yet" });
            }
            rec.status = "filled";
            rec.filledAt = rec.filledAt ?? nowSec();
            rec.txHash = body.txHash ?? rec.txHash;
            return send(res, 200, publicView(rec));
        }

        return send(res, 404, { error: "not found" });
    }

    const server = http.createServer((req, res) => {
        handle(req, res).catch((e: unknown) => {
            const err = e as { status?: number; message?: string };
            send(res, err.status ?? 500, { error: err.message ?? "internal error" });
        });
    });
    const timer = setInterval(() => void sweep(), 30_000);
    timer.unref();
    return { server, store, sweep, close: () => new Promise<void>((r) => { clearInterval(timer); server.close(() => r()); }) };
}

const isEntry = process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isEntry) {
    const port = Number(process.env.PORT ?? 8787);
    const relay = createRelay();
    relay.server.listen(port, "127.0.0.1", () => {
        console.log(`[intent-relay] listening on http://127.0.0.1:${port} (settlement ${COW_SETTLEMENT})`);
    });
}
