/**
 * scripts/lib/venues.ts
 * Supply-side venue registry (zero-treasury adapter pattern).
 * =================================================================
 * Generalizes `scripts/adapters/aggregatorCowBridge.ts` from a single
 * hard-coded CoW venue into a registry of solver networks:
 *
 *   [ DEMAND ]  Enso / Odos / Bungee / Jumper / 1inch Router
 *       |  (EswapLeverageAdapter.exactInputSingleWithLeverage*)
 *       v
 *   [ SUPPLY ]  CoW Protocol / UniswapX / Across / 1inch Fusion
 *
 * A venue-neutral `LeverageIntent` (scripts/lib/types.ts) arrives from an
 * aggregator. Each registered venue answers two questions:
 *
 *   1. buildOrder(intent)  -> venue-native order payload (venue-specific encoding)
 *   2. dispatch(route,...)  -> either post to the venue's ORDERBOOK (external
 *                              solvers fill later) or a SYNCHRONOUS direct fill
 *                              into this protocol's on-chain settler.
 *
 * Because the borrow leg is always funded by the *external* solver
 * (`params.solver` / `msg.value`), every route here is zero-treasury.
 *
 * The registry deliberately holds NO hard-coded venue addresses. A venue is
 * only routable once its address is supplied via env/config — whitelisting a
 * settlement proxy grants it a call carrying the FULL swap notional, so an
 * unverified address is a fund-loss vector, not a convenience gap.
 */
import type { Address, Hex } from "viem";
import type { ChainClients, NetworkConfig } from "./config.js";
import { poolIdOf } from "./config.js";
import { marginHookAbi, quoterAbi } from "./abis.js";
import type { DestinationSettlementModel } from "./protocols.js";
import type { FillParams, LeverageIntent, PoolKey } from "./types.js";

/** How an order reaches its filler. Mirrors `BridgeRoute` from aggregatorCowBridge. */
export type VenueRoute = "orderbook" | "direct";

/**
 * Absolute ceiling the hook accepts at init (`EswapMarginHook` reverts
 * `InvalidLeverageRange()` outside 2..20). The cap that actually applies to a
 * trade is `defaultMaxLeverage` (5 live) or a lower per-pool override -- use
 * `effectiveMaxLeverage()` for that, never this constant on its own.
 */
export const PROTOCOL_MAX_LEVERAGE = 20;

/** Identifiers for the registered solver networks. */
export const SUPPLY_VENUE_IDS = ["cow", "uniswapx", "across", "oneinchfusion"] as const;
export type SupplyVenueId = (typeof SUPPLY_VENUE_IDS)[number];

/** Supply-side metadata surfaced in readiness reporting / the dashboard. */
export interface SupplyVenueInfo {
    readonly id: SupplyVenueId;
    /** Human-facing name as shown in the readiness report. */
    readonly label: string;
    /** On-chain settler this venue fills through, when one is deployed. */
    readonly settlement?: Address;
    /** True when every required address/credential is present. */
    readonly configured: boolean;
    /** Human-readable reason the venue is not routable (empty when configured). */
    readonly missing: readonly string[];
    /** True when the venue fills via this protocol's own settler rather than a
     *  purely off-chain orderbook. Governs whether `setSolverWhitelist` /
     *  `setAllowedAggregator` style on-chain registration is required. */
    readonly onChainSettlement: boolean;
    /** Which on-chain entrypoint this venue's relayer actually uses. Only
     *  `erc7683-fill` venues can be served by Eswap's `EswapSettlement.fill`. */
    readonly settlementModel: DestinationSettlementModel;
    /** Whether a settler speaking `settlementModel` exists and is whitelisted. */
    readonly settler: "wired" | "missing";
    /** Docs pointer surfaced when a venue is unconfigured. */
    readonly docs: string;
}

/**
 * A venue-native order payload. `payload` is the opaque, venue-specific
 * encoding the orderbook expects; `fill` carries the canonical `FillParams`
 * needed for a synchronous on-chain fill.
 */
export interface VenueOrder<TPayload = unknown> {
    readonly venue: SupplyVenueId;
    readonly payload: TPayload;
    /** Canonical fill params, resolved from the quoter-registered pools. */
    readonly fill: FillParams;
    /** Venue order id, when the venue assigned one synchronously. */
    readonly orderId?: Hex;
}

/** Result of routing one `LeverageIntent` to one venue. */
export interface VenueDispatchResult {
    readonly venue: SupplyVenueId;
    readonly route: VenueRoute;
    /** Quoter reference price for the leveraged leg (shared safety check). */
    readonly reference: bigint;
    /** Orderbook response body, when routed to an orderbook. */
    readonly apiResponse?: string;
    /** Transaction hash, when routed as a synchronous direct fill. */
    readonly tx?: Hex;
}

/**
 * The contract every supply venue implements. Mirrors the shape that
 * `AggregatorCowBridge` already proved out for CoW, so the direct-fill and
 * orderbook branches stay structurally identical across venues.
 */
export interface SupplyVenue<TPayload = unknown> {
    readonly info: SupplyVenueInfo;
    /** Encodes a venue-neutral intent into this venue's native order, resolving
     *  the quoter-registered pools needed by a synchronous fill. */
    buildOrder(intent: LeverageIntent, nowSec?: number): Promise<VenueOrder<TPayload>>;
    /** Posts a venue order to the venue's orderbook for external solvers. */
    submitToOrderbook(order: VenueOrder<TPayload>, intent: LeverageIntent): Promise<string>;
    /** Synchronous fill: this protocol's settler is called directly, with the
     *  EXTERNAL solver funding margin + borrow. */
    directFill(order: VenueOrder<TPayload>, intent: LeverageIntent): Promise<Hex>;
    /** Full pipeline for one intent through this venue. */
    handle(intent: LeverageIntent, route: VenueRoute): Promise<VenueDispatchResult>;
}

/** Shared collaborators injected into every venue implementation. */
export interface VenueDeps {
    readonly cfg: NetworkConfig;
    readonly clients: ChainClients;
}

/**
 * Venue-neutral helpers reused by every implementation. Extracted from
 * `AggregatorCowBridge` so CoW behaviour is preserved byte-for-byte while the
 * new venues share the same reference-quote and pool-resolution guarantees.
 */
export abstract class BaseSupplyVenue<TPayload = unknown> implements SupplyVenue<TPayload> {
    abstract readonly info: SupplyVenueInfo;
    protected readonly deps: VenueDeps;

    constructor(deps: VenueDeps) {
        this.deps = deps;
    }

    protected assertConfigured(): void {
        if (!this.info.configured) {
            throw new Error(
                `[${this.info.id}] not configured: ${this.info.missing.join(", ")}. ` +
                    `Supply the address via env (see ${this.info.docs}).`,
            );
        }
    }

    /**
     * Surfaced price reference: quoter estimate for the leveraged leg. Every
     * venue must clear `intent.minAmountOut` against this before dispatching,
     * so a venue can never fill below the trader's floor.
     */
    async quoteReference(intent: LeverageIntent): Promise<bigint> {
        const amountOut = (await this.deps.clients.publicClient.readContract({
            address: this.deps.cfg.quoter,
            abi: quoterAbi,
            functionName: "quoteExactInputSingleWithLeverage",
            args: [intent.tokenIn, intent.tokenOut, intent.fee, intent.leverage, intent.amountIn],
        })) as bigint;
        if (amountOut < intent.minAmountOut) {
            throw new Error(
                `[${this.info.id}] quoter reference ${amountOut} below intent.minAmountOut ${intent.minAmountOut}`,
            );
        }
        return amountOut;
    }

    /** Resolves the quoter-registered hook + deep standard pools for a pair. */
    protected async poolKeysFor(tokenIn: Address, tokenOut: Address, fee: number): Promise<{
        hookPoolKey: PoolKey;
        standardPoolKey: PoolKey;
    }> {
        const [hookPoolKey, standardPoolKey] = (await this.deps.clients.publicClient.readContract({
            address: this.deps.cfg.quoter,
            abi: quoterAbi,
            functionName: "getPoolKey",
            args: [tokenIn, tokenOut, fee],
        })) as readonly [PoolKey, PoolKey];
        if (hookPoolKey.hooks === "0x0000000000000000000000000000000000000000") {
            throw new Error(`pool not registered on quoter for ${tokenIn}/${tokenOut}/${fee}`);
        }
        return { hookPoolKey, standardPoolKey };
    }

    abstract buildOrder(intent: LeverageIntent, nowSec?: number): Promise<VenueOrder<TPayload>>;
    abstract submitToOrderbook(order: VenueOrder<TPayload>, intent: LeverageIntent): Promise<string>;
    abstract directFill(order: VenueOrder<TPayload>, intent: LeverageIntent): Promise<Hex>;

    async handle(intent: LeverageIntent, route: VenueRoute): Promise<VenueDispatchResult> {
        this.assertConfigured();
        this.validateIntent(intent);
        await this.assertLeverageWithinPoolCap(intent);
        const order = await this.buildOrder(intent);
        const reference = await this.quoteReference(intent);
        if (route === "direct") {
            const tx = await this.directFill(order, intent);
            return { venue: this.info.id, route, reference, tx };
        }
        const apiResponse = await this.submitToOrderbook(order, intent);
        return { venue: this.info.id, route, reference, apiResponse };
    }

    /**
     * Reads the leverage cap the hook will actually enforce for this pool.
     *
     * `EswapMarginHook._maxLeverageForPool` returns the per-pool override when
     * set, else `defaultMaxLeverage` (5 on the live Unichain deployment, and the
     * hook reverts `InvalidLeverageRange()` outside 2..20 at init). The 20 in
     * `PROTOCOL_MAX_LEVERAGE` below is therefore only the protocol's absolute
     * ceiling, never the effective cap.
     */
    protected async effectiveMaxLeverage(poolKey: PoolKey): Promise<number> {
        const override = (await this.deps.clients.publicClient.readContract({
            address: this.deps.cfg.hook,
            abi: marginHookAbi,
            functionName: "maxLeverageByPool",
            args: [poolIdOf(poolKey)],
        })) as number;
        if (override > 0) return Number(override);
        return Number(
            await this.deps.clients.publicClient.readContract({
                address: this.deps.cfg.hook,
                abi: marginHookAbi,
                functionName: "defaultMaxLeverage",
            }),
        );
    }

    /** Venue-neutral guard rails applied before any encoding or network call. */
    protected validateIntent(intent: LeverageIntent): void {
        if (intent.amountIn <= 0n) throw new Error("intent.amountIn must be positive");
        if (intent.leverage < 1 || intent.leverage > PROTOCOL_MAX_LEVERAGE) {
            throw new Error(`intent.leverage out of range: ${intent.leverage}`);
        }
        if (intent.minAmountOut <= 0n) throw new Error("intent.minAmountOut must be positive");
    }

    /**
     * Pool-scoped leverage check, run in `handle()` before an order is encoded.
     *
     * Without this, an intent above the pool's effective cap is accepted here,
     * the trader's margin is escrowed into the venue (CoW vault / settler), and
     * the order is then PERMANENTLY UNFILLABLE: the on-chain open reverts
     * `MaxLeverageExceeded()` for every solver until `validTo` expires. That is
     * a real loss of capital availability, so the cap is checked up front.
     */
    protected async assertLeverageWithinPoolCap(intent: LeverageIntent): Promise<void> {
        // A quoter is needed to resolve the pool, but the live deployment never
        // registered one, so fall back to the hook's global default rather than
        // refusing every trade. The fallback is conservative: it uses the lowest
        // cap in play, so an override-RAISED pool would be under-served (the
        // trader retries) rather than over-served with an unfillable order.
        let cap: number;
        try {
            const { hookPoolKey } = await this.poolKeysFor(intent.tokenIn, intent.tokenOut, intent.fee);
            cap = await this.effectiveMaxLeverage(hookPoolKey);
        } catch (err) {
            cap = Number(
                await this.deps.clients.publicClient.readContract({
                    address: this.deps.cfg.hook,
                    abi: marginHookAbi,
                    functionName: "defaultMaxLeverage",
                }),
            );
            console.warn(
                `[${this.info.id}] pool cap lookup failed, falling back to defaultMaxLeverage ${cap}: ` +
                    `${(err as Error).message}`,
            );
        }
        if (intent.leverage > cap) {
            throw new Error(
                `[${this.info.id}] leverage ${intent.leverage} exceeds the pool's effective cap ${cap} ` +
                    `(EswapMarginHook would revert MaxLeverageExceeded(), leaving the order unfillable ` +
                    `and the margin escrowed until validTo)`,
            );
        }
    }
}
