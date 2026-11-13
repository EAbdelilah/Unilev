/**
 * External solver bot for Eswap leveraged opens on Base mainnet (chain 8453).
 * ===========================================================================
 *
 * What it does
 *   1. Reads signed trader intents from the intent relay (INTENT_FEED_URL,
 *      default http://127.0.0.1:8787/intents?status=open), a file (--orders),
 *      or a generated demo set (--demo).
 *   2. Checks each intent on chain (scripts/lib/intents.ts `checkIntent`): the
 *      signature recovers an owner under the real CoW GPv2 domain, the UID is
 *      unfilled, and the appData commits to a leverage in [2, SOLVER_MAX_LEVERAGE].
 *   3. Simulates `EswapCoWSettlement.fillOrder` FROM the solver (eth_call).
 *      Nothing is sent in --dry-run.
 *   4. Without --dry-run, sends `fillOrder` for each intent that simulates, and
 *      reports the fill back to the relay (POST /intents/:id/filled).
 *
 * Zero-treasury model
 *   The borrow leg (sellAmount * (leverage - 1)) is drawn from the solver's own
 *   escrow in EswapRouter (`depositBorrowEscrow`). The protocol never funds it.
 *   The bot reports the escrow shortfall for every intent, so the operator can
 *   see exactly how much the solver must bond. An unbonded fill reverts.
 *
 *   The solver cannot choose leverage. The trader's signed appData fixes it, and
 *   the settlement rejects any mismatch (AUDIT CRIT-05).
 *
 * Usage
 *   npx tsx scripts/solvers/cowSolverBot.ts --demo --dry-run
 *   npx tsx scripts/solvers/cowSolverBot.ts --orders intents.json --dry-run
 *   SOLVER_PRIVATE_KEY=0x... npx tsx scripts/solvers/cowSolverBot.ts          (polls the relay)
 *
 * Env
 *   SOLVER_PRIVATE_KEY     required for live mode
 *   SOLVER_ADDRESS         solver to simulate as in --dry-run (defaults to the key's address)
 *   BASE_RPC_URL           default https://mainnet.base.org
 *   INTENT_FEED_URL        default http://127.0.0.1:8787/intents?status=open
 *   POLL_INTERVAL_MS       default 15000 (live loop)
 *   SOLVER_MAX_LEVERAGE    default 5 (the hook's default cap)
 */
import fs from "node:fs";
import { ethers } from "ethers";
import { CHAIN_ID, HOOK, HOOK_KEY, ROUTER, STD_KEY, USDC, WETH, getProvider } from "../lib/eswapBase";
import {
    COW_SETTLEMENT,
    FeedIntent,
    Intent,
    SETTLEMENT_ABI,
    checkIntent,
    demoIntent,
} from "../lib/intents";

const DEFAULT_FEED = "http://127.0.0.1:8787/intents?status=open";
const ROUTER_ABI = ["function erc20BorrowEscrow(address,address) view returns (uint256)"];

type Tx = { hash: string; wait(): Promise<{ status: number | null; blockNumber: number } | null> };
type Settlement = {
    fillOrder: {
        (order: unknown, scheme: number, signature: string, params: unknown): Promise<Tx>;
        staticCall(order: unknown, scheme: number, signature: string, params: unknown, overrides: object): Promise<unknown>;
    };
};
type Router = { erc20BorrowEscrow(solver: string, token: string): Promise<bigint> };

interface Verdict {
    id: string;
    owner: string;
    leverage: number;
    borrowToken: string;
    borrowAmount: bigint;
    escrow: bigint;
    escrowShortfall: bigint;
    status: "fillable" | "needs-escrow" | "rejected" | "sim-revert";
    detail: string;
}

async function loadIntents(argv: string[]): Promise<FeedIntent[]> {
    if (argv.includes("--demo")) return [await demoIntent()];
    const ix = argv.indexOf("--orders");
    const file = ix >= 0 ? argv[ix + 1] : undefined;
    if (file) return JSON.parse(fs.readFileSync(file, "utf8")) as FeedIntent[];
    const url = process.env.INTENT_FEED_URL ?? DEFAULT_FEED;
    const res = await fetch(url, { headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`intent feed ${res.status} from ${url}`);
    const body = (await res.json()) as FeedIntent[] | { intents: FeedIntent[] };
    return Array.isArray(body) ? body : body.intents;
}

async function assess(
    intent: FeedIntent,
    idx: number,
    provider: ethers.JsonRpcProvider,
    solver: string,
): Promise<{ verdict: Verdict; params?: unknown; order?: unknown; scheme?: number; signature?: string }> {
    const settlement = new ethers.Contract(COW_SETTLEMENT, SETTLEMENT_ABI, provider) as unknown as Settlement;
    const router = new ethers.Contract(ROUTER, ROUTER_ABI, provider) as unknown as Router;
    const base: Verdict = {
        id: intent.id ?? `#${idx}`,
        owner: "-",
        leverage: 0,
        borrowToken: "-",
        borrowAmount: 0n,
        escrow: 0n,
        escrowShortfall: 0n,
        status: "rejected",
        detail: "",
    };
    try {
        const checked = await checkIntent(intent, provider);
        base.owner = checked.owner;
        base.leverage = checked.leverage;
        const { order } = checked;
        const scheme = ["eip712", "ethsign", "eip1271", "presign"].indexOf(intent.scheme);

        // Borrow leg: sellAmount * (lev - 1), in the sell token (the borrowed side).
        const borrowAmount = order.sellAmount * BigInt(checked.leverage - 1);
        base.borrowToken = order.sellToken === USDC ? "USDC" : "WETH";
        base.borrowAmount = borrowAmount;
        base.escrow = await router.erc20BorrowEscrow(solver, order.sellToken);
        base.escrowShortfall = borrowAmount > base.escrow ? borrowAmount - base.escrow : 0n;

        const params = { leverage: checked.leverage, solver, key: HOOK_KEY, standardPoolKey: STD_KEY };
        try {
            await settlement.fillOrder.staticCall(order, scheme, intent.signature, params, { from: solver });
        } catch (e) {
            const reason = e instanceof Error ? (e as Error & { shortMessage?: string }).shortMessage ?? e.message : String(e);
            if (base.escrowShortfall > 0n) {
                base.status = "needs-escrow";
                base.detail = `bond ${ethers.formatUnits(base.escrowShortfall, order.sellToken === USDC ? 6 : 18)} ${base.borrowToken} first`;
            } else {
                base.status = "sim-revert";
                base.detail = reason.slice(0, 160);
            }
            return { verdict: base };
        }
        base.status = "fillable";
        base.detail = "simulates from solver";
        return { verdict: base, params, order, scheme, signature: intent.signature };
    } catch (e) {
        base.detail = e instanceof Error ? e.message : String(e);
        return { verdict: base };
    }
}

function fmt(v: Verdict): string {
    const dec = v.borrowToken === "USDC" ? 6 : 18;
    return [
        `${v.id.slice(0, 14).padEnd(14)} ${v.status.padEnd(12)} lev=${v.leverage || "-"}`,
        `owner=${v.owner}`,
        `borrow=${ethers.formatUnits(v.borrowAmount, dec)} ${v.borrowToken} escrow=${ethers.formatUnits(v.escrow, dec)}`,
        v.detail ? `(${v.detail})` : "",
    ].join("  ");
}

/** Reports a settled fill to the relay that issued the intent. Best effort. */
async function reportFilled(intentId: string, feedUrl: string, txHash: string): Promise<void> {
    const url = `${new URL(feedUrl).origin}/intents/${intentId}/filled`;
    const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ txHash }),
    });
    if (!res.ok) console.error(`[cow-solver] relay report failed ${res.status}: ${await res.text()}`);
}

async function main(): Promise<void> {
    const argv = process.argv.slice(2);
    const dryRun = argv.includes("--dry-run") || argv.includes("--demo");
    const provider = getProvider();
    const net = await provider.getNetwork();
    if (Number(net.chainId) !== CHAIN_ID) throw new Error(`RPC is chain ${net.chainId}, expected ${CHAIN_ID}`);

    const wallet = process.env.SOLVER_PRIVATE_KEY ? new ethers.Wallet(process.env.SOLVER_PRIVATE_KEY, provider) : null;
    const solver = wallet ? wallet.address : ethers.getAddress(process.env.SOLVER_ADDRESS ?? "");
    if (!solver || solver === ethers.ZeroAddress) throw new Error("set SOLVER_PRIVATE_KEY or SOLVER_ADDRESS");
    if (!wallet && !dryRun) throw new Error("live mode needs SOLVER_PRIVATE_KEY");

    const feedUrl = process.env.INTENT_FEED_URL ?? DEFAULT_FEED;
    console.log(`[cow-solver] chain=${CHAIN_ID} solver=${solver} settlement=${COW_SETTLEMENT} hook=${HOOK}`);
    console.log(`[cow-solver] router=${ROUTER} feed=${feedUrl} mode=${dryRun ? "DRY-RUN (no transactions)" : "LIVE"}`);

    const scan = async () => {
        const intents = await loadIntents(argv);
        console.log(`[cow-solver] ${intents.length} intent(s)`);
        const results = [];
        for (const [i, intent] of intents.entries()) results.push(await assess(intent, i, provider, solver));
        results.forEach((r) => console.log(fmt(r.verdict)));
        if (dryRun) return;
        if (!wallet) throw new Error("live mode needs SOLVER_PRIVATE_KEY");
        const settlement = new ethers.Contract(COW_SETTLEMENT, SETTLEMENT_ABI, wallet) as unknown as Settlement;
        for (const r of results) {
            if (r.verdict.status !== "fillable" || r.scheme === undefined || !r.signature) continue;
            const tx = await settlement.fillOrder(r.order, r.scheme, r.signature, r.params);
            console.log(`[cow-solver] ${r.verdict.id} fillOrder tx=${tx.hash}`);
            const rc = await tx.wait();
            console.log(`[cow-solver] ${r.verdict.id} status=${rc?.status} block=${rc?.blockNumber}`);
            if (rc?.status === 1 && r.verdict.id.startsWith("0x")) await reportFilled(r.verdict.id, feedUrl, tx.hash);
        }
    };

    if (dryRun || argv.includes("--once")) {
        await scan();
        return;
    }
    const interval = Number(process.env.POLL_INTERVAL_MS ?? "15000");
    for (;;) {
        await scan().catch((e: unknown) => console.error(`[cow-solver] scan failed: ${e instanceof Error ? e.message : e}`));
        await new Promise((r) => setTimeout(r, interval));
    }
}

main().catch((e: unknown) => {
    console.error(`[cow-solver] fatal: ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
});
