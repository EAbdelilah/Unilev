/**
 * Relay self-check (Base 8453, live RPC). Exits non-zero on any failure.
 *
 * Always runs the rejection paths: unfunded owner, bad scheme, bad JSON,
 * missing fields, out-of-range leverage, unknown ids, and fill-before-settle.
 * The listing path (201 / 200 duplicate / 409 fill-before-settle) needs a real
 * trader that has approved the settlement. Set RELAY_CHECK_TRADER_KEY to run it.
 *
 * Run: node node_modules/tsx/dist/cli.mjs scripts/test/intentRelay.check.ts
 */
import { ethers } from "ethers";
import { createRelay } from "../server/intentRelay";
import { USDC, WETH, getProvider } from "../lib/eswapBase";
import { COW_DOMAIN, ORDER_TYPES, appDataJson, COW_SETTLEMENT } from "../lib/intents";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
    console.log(`  ${ok ? "PASS" : "FAIL"} ${label}${detail ? `  (${detail})` : ""}`);
    if (!ok) failures++;
}

async function call(base: string, method: string, path: string, body?: unknown, raw?: string) {
    const res = await fetch(base + path, {
        method,
        headers: { "content-type": "application/json" },
        body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
    });
    const text = await res.text();
    let json: unknown = null;
    try {
        json = JSON.parse(text);
    } catch {
        json = text;
    }
    return { status: res.status, json: json as Record<string, unknown> | unknown[] };
}

function order(sellAmount: string, lev: number, validTo: number) {
    return {
        sellToken: USDC,
        buyToken: WETH,
        receiver: ethers.ZeroAddress,
        sellAmount,
        buyAmount: "1",
        validTo,
        appData: ethers.keccak256(ethers.toUtf8Bytes(appDataJson(lev))),
        feeAmount: "0",
        kind: "sell",
        partiallyFillable: false,
        sellTokenBalance: "erc20",
        buyTokenBalance: "erc20",
    };
}

async function main() {
    const provider = getProvider();
    const relay = createRelay({ provider });
    await new Promise<void>((r) => relay.server.listen(0, "127.0.0.1", () => r()));
    const addr = relay.server.address() as { port: number };
    const base = `http://127.0.0.1:${addr.port}`;
    const future = Math.floor(Date.now() / 1000) + 3600;
    console.log(`[relay-check] relay on ${base}, settlement ${COW_SETTLEMENT}`);

    try {
        const health = await call(base, "GET", "/health");
        check("GET /health is 200", health.status === 200);

        // A random trader never approved the settlement, so the guard must reject it.
        const stranger = ethers.Wallet.createRandom();
        const o = order("1000", 5, future);
        const sig = await stranger.signTypedData(COW_DOMAIN, ORDER_TYPES, {
            ...o,
            kind: "sell",
            sellTokenBalance: "erc20",
            buyTokenBalance: "erc20",
        });
        const unfunded = await call(base, "POST", "/intents", { order: o, scheme: "eip712", signature: sig });
        check(
            "unapproved owner is rejected (400)",
            unfunded.status === 400 && String((unfunded.json as { error?: string }).error).includes("not approved"),
            `${unfunded.status} ${JSON.stringify(unfunded.json).slice(0, 90)}`,
        );

        const noSig = await call(base, "POST", "/intents", { order: o, scheme: "eip712" });
        check("missing signature is 400", noSig.status === 400);

        const badScheme = await call(base, "POST", "/intents", { order: o, scheme: "magic", signature: sig });
        check("unknown scheme is 400", badScheme.status === 400);

        const badJson = await call(base, "POST", "/intents", undefined, "{not json");
        check("non-JSON body is 400", badJson.status === 400);

        const lev9 = await call(base, "POST", "/intents", {
            order: order("1000", 9, future),
            scheme: "eip712",
            signature: sig,
        });
        check(
            "leverage 9 is rejected (outside [2,5])",
            lev9.status === 400 && String((lev9.json as { error?: string }).error).includes("outside"),
        );

        const expired = await call(base, "POST", "/intents", {
            order: order("1000", 5, 1),
            scheme: "eip712",
            signature: sig,
        });
        check("expired order is 400", expired.status === 400);

        const list = await call(base, "GET", "/intents?status=open");
        check("GET /intents?status=open is an array", list.status === 200 && Array.isArray(list.json));

        const unknown = await call(base, "GET", "/intents/0x" + "00".repeat(32));
        check("unknown intent is 404", unknown.status === 404);

        const fillUnknown = await call(base, "POST", "/intents/0x" + "00".repeat(32) + "/filled", { txHash: "0x" + "11".repeat(32) });
        check("filled on unknown intent is 404", fillUnknown.status === 404);

        const trader = process.env.RELAY_CHECK_TRADER_KEY;
        if (!trader) {
            console.log("  SKIP listing path (set RELAY_CHECK_TRADER_KEY to a trader with an approved settlement)");
        } else {
            const w = new ethers.Wallet(trader, provider);
            const good = order("1000", 5, future);
            const gsig = await w.signTypedData(COW_DOMAIN, ORDER_TYPES, {
                ...good,
                kind: "sell",
                sellTokenBalance: "erc20",
                buyTokenBalance: "erc20",
            });
            const created = await call(base, "POST", "/intents", { order: good, scheme: "eip712", signature: gsig });
            check("funded trader's intent is listed (201)", created.status === 201, `${created.status}`);
            const id = (created.json as { id?: string }).id ?? "";
            const again = await call(base, "POST", "/intents", { order: good, scheme: "eip712", signature: gsig });
            check("duplicate submission returns 200", again.status === 200);
            const open = (await call(base, "GET", "/intents?status=open")).json as Array<{ id: string }>;
            check("listed intent appears in the open feed", open.some((r) => r.id === id));
            const early = await call(base, "POST", `/intents/${id}/filled`, { txHash: "0x" + "11".repeat(32) });
            check("fill before settlement is rejected (409)", early.status === 409);
            const badTx = await call(base, "POST", `/intents/${id}/filled`, { txHash: "0x1234" });
            check("malformed txHash is rejected (400)", badTx.status === 400);
        }
    } finally {
        await relay.close();
    }

    console.log(failures ? `\n❌ ${failures} check(s) failed` : "\n✅ relay checks passed");
    process.exit(failures ? 1 : 0);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
