/**
 * External solver bot for Eswap leveraged opens on Base mainnet (chain 8453).
 * ===========================================================================
 *
 * What it does
 *   1. Reads signed trader intents from a feed (INTENT_FEED_URL), a file
 *      (--orders <path>), or a generated demo set (--demo).
 *   2. Checks each intent on chain: the signature recovers an owner under the
 *      real CoW GPv2 domain, the UID is unfilled, and the order's appData
 *      commits to a leverage between 2 and SOLVER_MAX_LEVERAGE.
 *   3. Simulates `EswapCoWSettlement.fillOrder` FROM the solver address
 *      (eth_call). Nothing is sent in --dry-run.
 *   4. Without --dry-run, sends `fillOrder` for each intent that simulates.
 *
 * Zero-treasury model
 *   The borrow leg (sellAmount * (leverage - 1)) is pulled from the solver's
 *   own escrow in EswapRouter (`depositBorrowEscrow`). The protocol never
 *   funds it. The bot reports the escrow shortfall for every intent, so the
 *   operator can see exactly how much the solver must bond before a fill can
 *   clear. A fill that is not bonded reverts.
 *
 *   The solver cannot choose leverage. The trader's signed appData fixes it,
 *   and the settlement rejects any mismatch (AUDIT CRIT-05).
 *
 * Usage
 *   npx tsx scripts/solvers/cowSolverBot.ts --demo --dry-run
 *   npx tsx scripts/solvers/cowSolverBot.ts --orders intents.json --dry-run
 *   SOLVER_PRIVATE_KEY=0x... INTENT_FEED_URL=https://... npx tsx scripts/solvers/cowSolverBot.ts
 *
 * Env
 *   SOLVER_PRIVATE_KEY     required unless --dry-run with SOLVER_ADDRESS set
 *   SOLVER_ADDRESS         solver to simulate as in --dry-run (defaults to the key's address)
 *   BASE_RPC_URL           default https://mainnet.base.org
 *   V4_COW_SETTLEMENT_ADDRESS, V4_ROUTER_ADDRESS, V4_HOOK_ADDRESS
 *                          default to the live stack (MAINNET_PROOF.md §19)
 *   INTENT_FEED_URL        JSON array of intents (see Intent below)
 *   POLL_INTERVAL_MS       default 15000 (live loop only)
 *   SOLVER_MAX_LEVERAGE    default 5 (the hook's default cap)
 *
 * Intent
 *   { "order": { sellToken, buyToken, receiver, sellAmount, buyAmount, validTo,
 *                appData, feeAmount, kind, partiallyFillable,
 *                sellTokenBalance, buyTokenBalance },
 *     "scheme": "eip712" | "ethsign" | "eip1271" | "presign",
 *     "signature": "0x..." }
 *   `kind` and the balance fields are the strings "sell" / "erc20"; the
 *   receiver is 0x0 for "same as owner". Only the USDC/WETH pair is supported.
 */
import fs from "node:fs";
import { ethers } from "ethers";
import {
    CHAIN_ID,
    HOOK,
    HOOK_KEY,
    ROUTER,
    STD_KEY,
    USDC,
    WETH,
    getProvider,
} from "../lib/eswapBase";

const COW_SETTLEMENT = ethers.getAddress(
    process.env.V4_COW_SETTLEMENT_ADDRESS ?? "0x7341859C0D7e039118b3f85F341583EBCDB8c960",
);
// The canonical CoW GPv2Settlement on Base. Signatures are bound to it.
const GPV2_SETTLEMENT = "0x9008D19f58AAbD9eD0D60971565AA8510560ab41";
const MAX_LEVERAGE = Number(process.env.SOLVER_MAX_LEVERAGE ?? "5");
const SCHEMES = ["eip712", "ethsign", "eip1271", "presign"] as const;

const KEY_TUPLE = "(address,address,uint24,int24,address)";
const SETTLEMENT_ABI = [
    `function fillOrder((address sellToken,address buyToken,address receiver,uint256 sellAmount,uint256 buyAmount,uint32 validTo,bytes32 appData,uint256 feeAmount,bytes32 kind,bool partiallyFillable,bytes32 sellTokenBalance,bytes32 buyTokenBalance) order, uint8 scheme, bytes signature, (uint8 leverage,address solver,${KEY_TUPLE} key,${KEY_TUPLE} standardPoolKey) params) returns (address owner)`,
    "function verify((address sellToken,address buyToken,address receiver,uint256 sellAmount,uint256 buyAmount,uint32 validTo,bytes32 appData,uint256 feeAmount,bytes32 kind,bool partiallyFillable,bytes32 sellTokenBalance,bytes32 buyTokenBalance) order, uint8 scheme, bytes signature) view returns (address owner, bytes32 orderDigest, bytes orderUid)",
    "function filledOrders(bytes32) view returns (bool)",
];
const ROUTER_ABI = ["function erc20BorrowEscrow(address,address) view returns (uint256)"];

// EIP-712 type of the CoW order. Matches src/v4/cow/CowOrder.sol TYPE_HASH.
const ORDER_TYPES = {
    Order: [
        { name: "sellToken", type: "address" },
        { name: "buyToken", type: "address" },
        { name: "receiver", type: "address" },
        { name: "sellAmount", type: "uint256" },
        { name: "buyAmount", type: "uint256" },
        { name: "validTo", type: "uint32" },
        { name: "appData", type: "bytes32" },
        { name: "feeAmount", type: "uint256" },
        { name: "kind", type: "string" },
        { name: "partiallyFillable", type: "bool" },
        { name: "sellTokenBalance", type: "string" },
        { name: "buyTokenBalance", type: "string" },
    ],
};
const COW_DOMAIN = { name: "Gnosis Protocol", version: "v2", chainId: CHAIN_ID, verifyingContract: GPV2_SETTLEMENT };

type RawOrder = {
    sellToken: string;
    buyToken: string;
    receiver: string;
    sellAmount: string;
    buyAmount: string;
    validTo: number;
    appData: string;
    feeAmount: string;
    kind: string;
    partiallyFillable: boolean;
    sellTokenBalance: string;
    buyTokenBalance: string;
};
type Intent = { order: RawOrder; scheme: (typeof SCHEMES)[number]; signature: string };

type Tx = { hash: string; wait(): Promise<{ status: number | null; blockNumber: number } | null> };
type Settlement = {
    verify(order: unknown, scheme: number, signature: string): Promise<[string, string, string]>;
    filledOrders(uidHash: string): Promise<boolean>;
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

/** Turns a raw intent into the contract struct, enforcing the pair and flags. */
function toOrder(o: RawOrder) {
    const sell = ethers.getAddress(o.sellToken);
    const buy = ethers.getAddress(o.buyToken);
    const pair = new Set([USDC, WETH]);
    if (!pair.has(sell) || !pair.has(buy) || sell === buy) throw new Error("pair is not USDC/WETH");
    if (o.kind !== "sell") throw new Error("only sell orders");
    if (o.partiallyFillable) throw new Error("partially fillable not supported");
    if (BigInt(o.feeAmount) !== 0n) throw new Error("fee must be zero");
    if (o.sellTokenBalance !== "erc20" || o.buyTokenBalance !== "erc20") throw new Error("erc20 balances only");
    if (o.validTo < Math.floor(Date.now() / 1000)) throw new Error("order expired");
    return {
        sellToken: sell,
        buyToken: buy,
        receiver: ethers.getAddress(o.receiver),
        sellAmount: BigInt(o.sellAmount),
        buyAmount: BigInt(o.buyAmount),
        validTo: Number(o.validTo),
        appData: o.appData,
        feeAmount: 0n,
        kind: ethers.id("sell"),
        partiallyFillable: false,
        sellTokenBalance: ethers.id("erc20"),
        buyTokenBalance: ethers.id("erc20"),
    };
}

/** The canonical fullAppData document for a leverage (matches appDataJson). */
function appDataJson(lev: number): string {
    return `{"version":1,"appCode":"eswap","metadata":{"eswapLeverage":"${lev}"}}`;
}

/** Recovers the leverage a signed appData commits to, or null if none. */
function leverageFromAppData(appData: string): number | null {
    for (let lev = 1; lev <= 20; lev++) {
        if (ethers.keccak256(ethers.toUtf8Bytes(appDataJson(lev))) === appData.toLowerCase()) return lev;
    }
    return null;
}

/** Builds a signed demo intent under the real CoW domain, for --demo. */
async function demoIntent(): Promise<Intent> {
    const trader = ethers.Wallet.createRandom();
    const order: RawOrder = {
        sellToken: USDC,
        buyToken: WETH,
        receiver: ethers.ZeroAddress,
        sellAmount: "1000000000", // $1,000 USDC
        buyAmount: "500000000000000000", // 0.5 WETH slippage floor
        validTo: Math.floor(Date.now() / 1000) + 3600,
        appData: ethers.keccak256(ethers.toUtf8Bytes(appDataJson(5))),
        feeAmount: "0",
        kind: "sell",
        partiallyFillable: false,
        sellTokenBalance: "erc20",
        buyTokenBalance: "erc20",
    };
    const value = { ...toOrder(order), kind: "sell", sellTokenBalance: "erc20", buyTokenBalance: "erc20" };
    const signature = await trader.signTypedData(COW_DOMAIN, ORDER_TYPES, value);
    return { order, scheme: "eip712", signature };
}

async function loadIntents(argv: string[]): Promise<Intent[]> {
    const ix = argv.indexOf("--orders");
    if (argv.includes("--demo")) return [await demoIntent()];
    const file = ix >= 0 ? argv[ix + 1] : undefined;
    if (file) return JSON.parse(fs.readFileSync(file, "utf8")) as Intent[];
    const url = process.env.INTENT_FEED_URL;
    if (!url) throw new Error("no intent source: use --demo, --orders <file>, or INTENT_FEED_URL");
    const res = await fetch(url, { headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`intent feed ${res.status}`);
    return (await res.json()) as Intent[];
}

async function assess(
    intent: Intent,
    idx: number,
    provider: ethers.JsonRpcProvider,
    solver: string,
): Promise<{ verdict: Verdict; params?: unknown; order?: unknown; scheme?: number; signature?: string }> {
    const settlement = new ethers.Contract(COW_SETTLEMENT, SETTLEMENT_ABI, provider) as unknown as Settlement;
    const router = new ethers.Contract(ROUTER, ROUTER_ABI, provider) as unknown as Router;
    const base: Verdict = {
        id: `#${idx}`,
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
        const order = toOrder(intent.order);
        const lev = leverageFromAppData(order.appData);
        if (lev === null) throw new Error("appData commits to no leverage");
        if (lev < 2 || lev > MAX_LEVERAGE) throw new Error(`leverage ${lev} outside [2, ${MAX_LEVERAGE}]`);
        base.leverage = lev;

        const scheme = SCHEMES.indexOf(intent.scheme);
        if (scheme < 0) throw new Error(`unknown scheme ${intent.scheme}`);
        const [owner, , uid] = await settlement.verify(order, scheme, intent.signature);
        base.owner = owner;
        const uidHash = ethers.keccak256(uid);
        if (await settlement.filledOrders(uidHash)) throw new Error("already filled");

        // Borrow leg: sellAmount * (lev - 1), in the sell token (the borrowed side).
        const borrowAmount = order.sellAmount * BigInt(lev - 1);
        base.borrowToken = order.sellToken === USDC ? "USDC" : "WETH";
        base.borrowAmount = borrowAmount;
        base.escrow = await router.erc20BorrowEscrow(solver, order.sellToken);
        base.escrowShortfall = borrowAmount > base.escrow ? borrowAmount - base.escrow : 0n;

        const params = { leverage: lev, solver, key: HOOK_KEY, standardPoolKey: STD_KEY };
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
    const borrow = ethers.formatUnits(v.borrowAmount, dec);
    const escrow = ethers.formatUnits(v.escrow, dec);
    return [
        `${v.id.padEnd(4)} ${v.status.padEnd(12)} lev=${v.leverage || "-"}`,
        `owner=${v.owner}`,
        `borrow=${borrow} ${v.borrowToken} escrow=${escrow}`,
        v.detail ? `(${v.detail})` : "",
    ].join("  ");
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

    console.log(`[cow-solver] chain=${CHAIN_ID} solver=${solver} settlement=${COW_SETTLEMENT} hook=${HOOK}`);
    console.log(`[cow-solver] router=${ROUTER} mode=${dryRun ? "DRY-RUN (no transactions)" : "LIVE"}`);

    const pass = async () => {
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
        }
    };

    if (dryRun || argv.includes("--once")) {
        await pass();
        return;
    }
    const interval = Number(process.env.POLL_INTERVAL_MS ?? "15000");
    for (;;) {
        await pass().catch((e: unknown) => console.error(`[cow-solver] scan failed: ${e instanceof Error ? e.message : e}`));
        await new Promise((r) => setTimeout(r, interval));
    }
}

main().catch((e: unknown) => {
    console.error(`[cow-solver] fatal: ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
});
