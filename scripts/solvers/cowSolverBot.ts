/**
 * Off-Chain CoW Solver Execution Bot
 * ===================================
 * Listens on Unichain block headers + the CoW orderbook API for signed
 * `CowOrder.Data` payloads targeting `EswapCoWSettlement.sol`, dry-runs
 * `quoteOpenFit()`, verifies the leveraged quote clears `order.buyAmount`, and
 * settles batches via `fillOrders()`. The solver address funds the margin AND
 * the borrow leg through `EswapRouter.swapMultiPoolForSolverFunded()` — the
 * protocol treasury never supplies borrow capital (zero-treasury execution).
 *
 * Usage:
 *   SOLVER_PRIVATE_KEY=0x... UNICHAIN_RPC_URL=... COW_API_URL=https://api.cow.fi/xdai/v2 \
 *     npm run cow:bot            # live loop
 *   ... --dry-run                # pre-checks + quotes only, no tx
 *
 * Env:
 *   UNICHAIN_RPC_URL     (required)
 *   V4_HOOK_ADDRESS, V4_ROUTER_ADDRESS, V4_SETTLEMENT_ADDRESS,
 *   V4_QUOTER_ADDRESS, V4_ADAPTER_ADDRESS, V4_PRICEFEED_ADDRESS  (required)
 *   COW_API_URL          (required for orderbook polling)
 *   SOLVER_PRIVATE_KEY   (required)
 *   SOLVER_LEVERAGE      (default 3)
 *   SOLVER_PROFIT_BPS    (default 0; min markup over order.buyAmount)
 *   POLL_INTERVAL_MS     (default 8000)
 *   COW_GPv2_SETTLEMENT / V4_WETH / V4_USDC (optional overrides)
 */
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
    createClients,
    loadNetworkConfig,
    type ChainClients,
    type NetworkConfig,
} from "../lib/config.js";
import { checkOpenFit, quoteLeveragedOutput } from "../lib/engine.js";
import { balanceMarker, cowOrders, type CowApiOrder } from "../lib/cowapi.js";
import { cowSettlementAbi, quoterAbi } from "../lib/abis.js";
import {
    BALANCE_ERC20,
    CowScheme,
    KIND_BUY,
    KIND_SELL,
    SIGNING_SCHEME_TO_ENUM,
    type CowOrderData,
    type FillParams,
    type PoolKey,
} from "../lib/types.js";

interface Candidate {
    order: CowOrderData;
    scheme: CowScheme;
    signature: `0x${string}`;
    owner: `0x${string}`;
    uid: string;
}

export class CowSolverBot {
    private readonly cfg: NetworkConfig;
    private readonly clients: ChainClients;
    private readonly cowApiUrl: string;
    private readonly leverage: number;
    private readonly profitBps: number;
    private readonly pollMs: number;
    private readonly dryRun: boolean;

    private readonly seen = new Set<string>();
    private processing = false;

    constructor() {
        this.cfg = loadNetworkConfig();
        const privateKey = process.env.SOLVER_PRIVATE_KEY;
        if (!privateKey) throw new Error("Missing SOLVER_PRIVATE_KEY");
        this.clients = createClients(this.cfg, privateKey);
        const cowApiUrl = process.env.COW_API_URL;
        if (!cowApiUrl) throw new Error("Missing COW_API_URL (CoW orderbook endpoint)");
        this.cowApiUrl = cowApiUrl;
        this.leverage = Number(process.env.SOLVER_LEVERAGE ?? "3");
        this.profitBps = Number(process.env.SOLVER_PROFIT_BPS ?? "0");
        this.pollMs = Number(process.env.POLL_INTERVAL_MS ?? "8000");
        this.dryRun = process.argv.includes("--dry-run");

        if (this.leverage < 1 || this.leverage > 20) {
            throw new Error(`SOLVER_LEVERAGE out of the [1,20] protocol range: ${this.leverage}`);
        }
    }

    async run(): Promise<void> {
        const { publicClient, account } = this.clients;
        this.log(`solver=${account.address} leverage=${this.leverage} dryRun=${this.dryRun}`);
        this.log(`hook=${this.cfg.hook} settlement=${this.cfg.settlement} quoter=${this.cfg.quoter}`);

        // Block-header listener: heartbeats the scan cadence and re-checks
        // pending active orders against the freshest on-chain capacity state.
        publicClient.watchBlocks({
            blockTag: "latest",
            onBlock: (block) => {
                if (block.number !== null) this.log(`block=${block.number}`);
                void this.pollCowApi().catch((err: unknown) => this.error("pollCowApi", err));
            },
            onError: (err) => this.error("watchBlocks", err),
        });

        // Keep the process alive (watchBlocks polls internally; this guards
        // environments where the transport's poll interval is disabled).
        setInterval(() => void 0, 30_000);
    }

    private async pollCowApi(): Promise<void> {
        if (this.processing) return;
        this.processing = true;
        try {
            const url = `${this.cowApiUrl}/api/v1/orders?limit=100&offset=0`;
            const res = await fetch(url, { headers: { accept: "application/json" } });
            if (!res.ok) {
                throw new Error(`CoW API ${res.status}: ${await res.text()}`);
            }
            const raw = (await res.json()) as unknown;
            const orders = cowOrders(raw);
            const candidates = orders
                .filter((o) => this.isTargetOrder(o))
                .map((o) => this.toCandidate(o))
                .filter((c): c is Candidate => c !== null && !this.seen.has(c.uid));
            if (candidates.length > 0) await this.processCandidates(candidates);
        } finally {
            this.processing = false;
        }
    }

    private isTargetOrder(o: CowApiOrder): boolean {
        const scheme = SIGNING_SCHEME_TO_ENUM[o.signingScheme.toLowerCase()];
        if (scheme === undefined) return false;
        if (o.kind !== "sell") return false;
        if (o.partiallyFillable) return false;
        if (BigInt(o.feeAmount) !== 0n) return false;
        if (o.validTo < Math.floor(Date.now() / 1000)) return false;
        return true;
    }

    private toCandidate(o: CowApiOrder): Candidate | null {
        const scheme = SIGNING_SCHEME_TO_ENUM[o.signingScheme.toLowerCase()];
        if (scheme === undefined) return null;
        const order: CowOrderData = {
            sellToken: o.sellToken as `0x${string}`,
            buyToken: o.buyToken as `0x${string}`,
            receiver: o.receiver as `0x${string}`,
            sellAmount: BigInt(o.sellAmount),
            buyAmount: BigInt(o.buyAmount),
            validTo: Number(o.validTo),
            appData: o.appData as `0x${string}`,
            feeAmount: BigInt(o.feeAmount),
            kind: o.kind === "buy" ? KIND_BUY : KIND_SELL,
            partiallyFillable: o.partiallyFillable,
            sellTokenBalance: balanceMarker(o.sellTokenBalance, BALANCE_ERC20),
            buyTokenBalance: balanceMarker(o.buyTokenBalance, BALANCE_ERC20),
        };
        return {
            order,
            scheme,
            signature: o.signature as `0x${string}`,
            owner: o.owner as `0x${string}`,
            uid: o.orderUid,
        };
    }

    private async processCandidates(candidates: Candidate[]): Promise<void> {
        this.log(`processing=${candidates.length} candidate orders`);
        const fills: Array<{
            order: CowOrderData;
            scheme: CowScheme;
            signature: `0x${string}`;
            params: FillParams;
        }> = [];

        for (const c of candidates) {
            try {
                if (await this.preCheck(c)) fills.push(await this.review(c));
            } catch (err) {
                this.error(`candidate ${c.uid}`, err);
            }
            this.seen.add(c.uid);
        }

        if (fills.length === 0) {
            this.log("no fillable orders in this scan");
            return;
        }
        this.log(`fillable=${fills.length}`);

        if (this.dryRun) {
            for (const f of fills) {
                this.log(
                    `DRY-RUN fill sell=${f.order.sellToken} buy=${f.order.buyToken} ` +
                        `margin=${f.order.sellAmount} lev=${f.params.leverage} solver=${f.params.solver}`,
                );
            }
            return;
        }

        const { walletClient, account } = this.clients;
        this.log("submitting fillOrders batch…");
        const hash = await walletClient.writeContract({
            address: this.cfg.settlement,
            abi: cowSettlementAbi,
            functionName: "fillOrders",
            args: [
                fills.map((f) => f.order),
                fills.map((f) => f.scheme),
                fills.map((f) => f.signature),
                fills.map((f) => f.params),
            ],
            account,
        });
        this.log(`fillOrders tx=${hash}`);
        const receipt = await this.clients.publicClient.waitForTransactionReceipt({ hash });
        this.log(`settled status=${receipt.status} block=${receipt.blockNumber} gas=${receipt.gasUsed}`);
    }

    /** Pre-Check: quoteOpenFit() leverage/duplicate/capacity gate off-chain. */
    private async preCheck(c: Candidate): Promise<boolean> {
        const margin = c.order.sellAmount;
        const borrowed = margin * BigInt(this.leverage - 1);
        const { fits, reason } = await checkOpenFit(
            this.clients.publicClient,
            this.cfg.hook,
            await this.hookPoolKey(c),
            c.owner,
            c.order.sellToken,
            this.leverage,
            margin,
            borrowed,
        );
        if (!fits) {
            this.log(`pre-check reject ${c.uid}: ${reason}`);
            return false;
        }
        return true;
    }

    /** Resolves the quoter-registered hook+standard pool keys for a token pair. */
    private async poolKeysFor(
        sellToken: `0x${string}`,
        buyToken: `0x${string}`,
    ): Promise<{ hookPoolKey: PoolKey; standardPoolKey: PoolKey; fee: number }> {
        const feeTiers = String(process.env.SOLVER_FEE_TIERS ?? "3000")
            .split(",")
            .map((s) => Number(s.trim()))
            .filter((n) => n > 0);
        for (const fee of feeTiers) {
            const [hookPoolKey, standardPoolKey] = await this.clients.publicClient.readContract({
                address: this.cfg.quoter,
                abi: quoterAbi,
                functionName: "getPoolKey",
                args: [sellToken, buyToken, fee],
            });
            if (hookPoolKey.hooks !== "0x0000000000000000000000000000000000000000") {
                return { hookPoolKey, standardPoolKey, fee };
            }
        }
        throw new Error(`no quoter-registered pool for ${sellToken}/${buyToken} in SOLVER_FEE_TIERS`);
    }

    private async review(c: Candidate): Promise<{
        order: CowOrderData;
        scheme: CowScheme;
        signature: `0x${string}`;
        params: FillParams;
    }> {
        const { hookPoolKey, standardPoolKey, fee } = await this.poolKeysFor(c.order.sellToken, c.order.buyToken);
        const amountOut = await quoteLeveragedOutput(
            this.clients.publicClient,
            this.cfg.quoter,
            c.order.sellToken,
            c.order.buyToken,
            fee,
            this.leverage,
            c.order.sellAmount,
        );
        const floor = (c.order.buyAmount * BigInt(10000 + this.profitBps)) / 10000n;
        if (amountOut < floor) {
            throw new Error(
                `quote ${amountOut} below order floor ${floor} (+${this.profitBps}bps) for ${c.uid}`,
            );
        }
        const params: FillParams = {
            leverage: this.leverage,
            solver: this.clients.account.address,
            key: hookPoolKey,
            standardPoolKey,
        };
        return { order: c.order, scheme: c.scheme, signature: c.signature, params };
    }

    private async hookPoolKey(c: Candidate): Promise<PoolKey> {
        const { hookPoolKey } = await this.poolKeysFor(c.order.sellToken, c.order.buyToken);
        return hookPoolKey;
    }

    private log(message: string): void {
        console.log(`[cow-solver] ${new Date().toISOString()} ${message}`);
    }

    private error(scope: string, err: unknown): void {
        console.error(`[cow-solver] ${new Date().toISOString()} ${scope}: ${err instanceof Error ? err.message : String(err)}`);
    }
}

async function main(): Promise<void> {
    const bot = new CowSolverBot();
    await bot.run();
}

const isEntry =
    process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isEntry) {
    main().catch((err: unknown) => {
        console.error(`[cow-solver] fatal: ${err instanceof Error ? err.message : String(err)}`);
        process.exitCode = 1;
    });
}