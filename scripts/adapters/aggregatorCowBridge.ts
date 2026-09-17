/**
 * Aggregator → CoW Programmatic Order Bridge (Zero-Treasury Adapter)
 * =================================================================
 * Connects DEX-aggregator leveraged traffic (Enso/Odos/1inch hitting
 * `EswapLeverageAdapter.exactInputSingleWithLeverage()`) to EXTERNAL CoW
 * solvers, so the borrow leg is funded by solver capital instead of an
 * internal protocol `defaultSolver` — zero-treasury execution.
 *
 * When an aggregator initiates a leveraged order, the bridge:
 *   1. formats the incoming `LeverageIntent` as an EIP-1271 smart-contract
 *      CoW order (canonical CoW domain, KIND_SELL, erc20 balances),
 *   2. surfaces `EswapLeverageQuoter` as the reference quote for solvers,
 *   3. routes the order either to the CoW orderbook (external solvers) or,
 *      for synchronous fills, straight into `EswapCoWSettlement.fillOrder()`
 *      with the external solver paying margin + borrow.
 *
 * Usage:
 *   COW_API_URL=... BRIDGE_ROUTE=orderbook  npm run cow:bridge   # post orders
 *   BRIDGE_ROUTE=direct  npm run cow:bridge -- --watch            # direct fill
 */
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { keccak256 } from "viem";
import { createClients, loadNetworkConfig, type ChainClients, type NetworkConfig } from "../lib/config.js";
import { cowSettlementAbi, leverageAdapterAbi, quoterAbi } from "../lib/abis.js";
import {
    BALANCE_ERC20,
    CowScheme,
    KIND_SELL,
    RECEIVER_SAME_AS_OWNER,
    SIGNING_SCHEME_TO_ENUM,
    type CowOrderData,
    type FillParams,
    type LeverageIntent,
    type PoolKey,
} from "../lib/types.js";

const DEFAULT_APP_DATA = keccak256(new TextEncoder().encode("eswap-cow-bridge"));

export type BridgeRoute = "orderbook" | "direct";

export class AggregatorCowBridge {
    private readonly cfg: NetworkConfig;
    private readonly clients: ChainClients;
    private readonly route: BridgeRoute;
    private readonly cowApiUrl?: string;

    constructor() {
        this.cfg = loadNetworkConfig();
        const privateKey = process.env.BRIDGE_PRIVATE_KEY ?? process.env.SOLVER_PRIVATE_KEY;
        if (!privateKey) throw new Error("Missing BRIDGE_PRIVATE_KEY (or SOLVER_PRIVATE_KEY)");
        this.clients = createClients(this.cfg, privateKey);
        const route = process.env.BRIDGE_ROUTE ?? "orderbook";
        if (route !== "orderbook" && route !== "direct") {
            throw new Error(`BRIDGE_ROUTE must be "orderbook" or "direct", got ${route}`);
        }
        this.route = route;
        this.cowApiUrl = process.env.COW_API_URL;
        if (this.route === "orderbook" && this.cowApiUrl === undefined) {
            throw new Error("BRIDGE_ROUTE=orderbook requires COW_API_URL");
        }
    }

    /**
     * Formats an incoming aggregator intent as an EIP-712/EIP-1271 CoW order.
     * `receiver = address(0)` (proceeds to the order signer), so the position
     * is credited to the recovered order owner exactly like a native CoW order.
     */
    buildCowOrder(intent: LeverageIntent, nowSec: number = Math.floor(Date.now() / 1000)): CowOrderData {
        if (intent.amountIn <= 0n) throw new Error("intent.amountIn must be positive");
        if (intent.leverage < 1 || intent.leverage > 20) {
            throw new Error(`intent.leverage out of range: ${intent.leverage}`);
        }
        const validTo = nowSec + (intent.validToOffsetSec ?? 3600);
        if (validTo > 0xffffffff) throw new Error("validTo overflows uint32");
        return {
            sellToken: intent.tokenIn,
            buyToken: intent.tokenOut,
            receiver: RECEIVER_SAME_AS_OWNER,
            sellAmount: intent.amountIn,
            buyAmount: intent.minAmountOut,
            validTo,
            appData: intent.appData ?? DEFAULT_APP_DATA,
            feeAmount: 0n,
            kind: KIND_SELL,
            partiallyFillable: false,
            sellTokenBalance: BALANCE_ERC20,
            buyTokenBalance: BALANCE_ERC20,
        };
    }

    /** Surfaced price reference: quoter estimate for the leveraged leg. */
    async quoteReference(intent: LeverageIntent): Promise<bigint> {
        const amountOut = (await this.clients.publicClient.readContract({
            address: this.cfg.quoter,
            abi: quoterAbi,
            functionName: "quoteExactInputSingleWithLeverage",
            args: [intent.tokenIn, intent.tokenOut, intent.fee, intent.leverage, intent.amountIn],
        })) as bigint;
        if (amountOut < intent.minAmountOut) {
            throw new Error(`quoter reference ${amountOut} below intent.minAmountOut ${intent.minAmountOut}`);
        }
        return amountOut;
    }

    /** Resolves the quoter-registered hook + deep standard pools for a pair. */
    async poolKeysFor(
        tokenIn: `0x${string}`,
        tokenOut: `0x${string}`,
        fee: number,
    ): Promise<{ hookPoolKey: PoolKey; standardPoolKey: PoolKey }> {
        const [hookPoolKey, standardPoolKey] = await this.clients.publicClient.readContract({
            address: this.cfg.quoter,
            abi: quoterAbi,
            functionName: "getPoolKey",
            args: [tokenIn, tokenOut, fee],
        });
        if (hookPoolKey.hooks === "0x0000000000000000000000000000000000000000") {
            throw new Error(`pool not registered on quoter for ${tokenIn}/${tokenOut}/${fee}`);
        }
        return { hookPoolKey, standardPoolKey };
    }

    /**
     * Routes the order to external CoW solvers via the orderbook API. `owner`
     * is the EIP-1271 smart-contract wallet (or EOA) endorsing the order; the
     * signature is emitted exactly as received from the wallet.
     */
    async submitToCowApi(order: CowOrderData, intent: LeverageIntent): Promise<string> {
        if (!this.cowApiUrl) throw new Error("COW_API_URL not configured");
        const payload = {
            sellToken: order.sellToken,
            buyToken: order.buyToken,
            receiver: order.receiver,
            sellAmount: String(order.sellAmount),
            buyAmount: String(order.buyAmount),
            validTo: order.validTo,
            appData: order.appData,
            feeAmount: "0",
            kind: "sell",
            partiallyFillable: false,
            sellTokenBalance: "erc20",
            buyTokenBalance: "erc20",
            signingScheme: intent.signingScheme,
            signature: intent.signature,
            from: intent.owner,
        };
        const res = await fetch(`${this.cowApiUrl}/api/v1/orders`, {
            method: "POST",
            headers: { "content-type": "application/json", accept: "application/json" },
            body: JSON.stringify(payload),
        });
        const text = await res.text();
        if (!res.ok) {
            throw new Error(`CoW API rejected order (${res.status}): ${text}`);
        }
        return text === "" ? String(res.status) : text;
    }

    /**
     * Synchronous fill: calls `EswapCoWSettlement.fillOrder()` directly with
     * the EXTERNAL solver funding margin + borrow (the router's solver-funded
     * unlock pulls the full notional from `params.solver`). The provided
     * signature must have been produced by `intent.owner`.
     */
    async directFill(order: CowOrderData, intent: LeverageIntent): Promise<`0x${string}`> {
        const scheme = SIGNING_SCHEME_TO_ENUM[intent.signingScheme];
        if (scheme === undefined) throw new Error(`unsupported signingScheme: ${intent.signingScheme}`);
        const { hookPoolKey, standardPoolKey } = await this.poolKeysFor(intent.tokenIn, intent.tokenOut, intent.fee);
        let signature = intent.signature;
        if (scheme === CowScheme.Eip1271) {
            // recoverEip1271Signer expects abi.encodePacked(owner, innerSignature).
            signature = (intent.owner + intent.signature.slice(2)) as `0x${string}`;
        }
        const params: FillParams = {
            leverage: intent.leverage,
            solver: this.clients.account.address,
            key: hookPoolKey,
            standardPoolKey,
        };
        const hash = await this.clients.walletClient.writeContract({
            address: this.cfg.settlement,
            abi: cowSettlementAbi,
            functionName: "fillOrder",
            args: [order, scheme, signature, params],
            account: this.clients.account,
        });
        const receipt = await this.clients.publicClient.waitForTransactionReceipt({ hash });
        if (receipt.status !== "success") throw new Error(`fillOrder reverted: ${hash}`);
        return hash;
    }

    /**
     * Full pipeline for an incoming aggregator intent: build the order, verify
     * against the quoter, then route (orderbook or direct).
     */
    async handleLeverageIntent(intent: LeverageIntent): Promise<{ route: BridgeRoute; order: CowOrderData; reference: bigint; tx?: `0x${string}` }> {
        const order = this.buildCowOrder(intent);
        const reference = await this.quoteReference(intent);
        if (this.route === "direct") {
            const tx = await this.directFill(order, intent);
            return { route: this.route, order, reference, tx };
        }
        const apiResponse = await this.submitToCowApi(order, intent);
        console.log(`[cow-bridge] order submitted, api=${apiResponse}`);
        return { route: this.route, order, reference };
    }

    /**
     * Observability: watches `LeveragedSwapRouted` on the EswapLeverageAdapter
     * and forwards each routed trade to `onLeveragedSwap` (perf/audit trail for
     * intents that were filled through the internal defaultSolver or aggregator
     * proxies — they are structurally zero-treasury as well).
     */
    async watchLeveragedSwaps(onLeveragedSwap: (trade: { tokenIn: `0x${string}`; tokenOut: `0x${string}`; fee: number; leverage: number; amountIn: bigint; amountOut: bigint }) => void): Promise<() => void> {
        return this.clients.publicClient.watchEvent({
            address: this.cfg.adapter,
            event: leverageAdapterAbi[0],
            onLogs: (logs) => {
                for (const log of logs) {
                    if (!log.args.tokenIn || !log.args.tokenOut) continue;
                    onLeveragedSwap({
                        tokenIn: log.args.tokenIn,
                        tokenOut: log.args.tokenOut,
                        fee: log.args.fee ?? 0,
                        leverage: log.args.leverage ?? 0,
                        amountIn: log.args.amountIn ?? 0n,
                        amountOut: log.args.amountOut ?? 0n,
                    });
                }
            },
            onError: (err) => console.error(`[cow-bridge] watch error: ${err}`),
        });
    }

    /** Standalone watcher mode: logs `LeveragedSwapRouted` for the audit trail. */
    async run(): Promise<void> {
        const unsubscribe = await this.watchLeveragedSwaps((trade) => {
            console.log(
                `[cow-bridge] LeveragedSwapRouted in=${trade.tokenIn} out=${trade.tokenOut} ` +
                    `fee=${trade.fee} lev=${trade.leverage} amountIn=${trade.amountIn} amountOut=${trade.amountOut}`,
            );
        });
        const onExit = (): void => {
            unsubscribe();
            process.exit(0);
        };
        process.on("SIGINT", onExit);
        process.on("SIGTERM", onExit);
        console.log("[cow-bridge] watching LeveragedSwapRouted on adapter; Ctrl-C to stop");
        for (;;) {
            await new Promise<void>((resolvePromise) => setTimeout(resolvePromise, 60_000));
        }
    }
}

async function main(): Promise<void> {
    const bridge = new AggregatorCowBridge();
    if (process.argv.includes("--watch")) {
        await bridge.run();
        return;
    }
    console.error("[cow-bridge] no mode selected. Use --watch or drive handleLeverageIntent from your aggregator router.");
    process.exitCode = 2;
}

const isEntry = process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isEntry) {
    main().catch((err: unknown) => {
        console.error(`[cow-bridge] fatal: ${err instanceof Error ? err.message : String(err)}`);
        process.exitCode = 1;
    });
}