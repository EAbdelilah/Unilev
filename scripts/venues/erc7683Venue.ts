/**
 * scripts/venues/erc7683Venue.ts
 * Shared base for supply venues that fill through this protocol's generic
 * ERC-7683 destination settler (`EswapSettlement.fill(orderId, originData,
 * fillerData)`).
 * =================================================================
 * UniswapX and Across both resolve cross-chain intents and settle them on the
 * destination chain by calling the SAME `EswapSettlement.fill` entrypoint.
 * They differ only in:
 *
 *   - how the origin order is created (venue-specific encoding), and
 *   - which contract must be whitelisted as the filler on the destination.
 *
 * `originData` is the exact tuple `EswapSettlement.fill` decodes:
 *   (key, standardPoolKey, zeroForOne, amountSpecified, leverage, solver,
 *    hookData, minAmountOut)   — see SwapParamsData in scripts/lib/types.ts.
 */
import type { Hex } from "viem";
import { encodeAbiParameters } from "viem";
import { settlementAbi } from "../lib/abis.js";
import { poolKeyComponents } from "../lib/abis.js";
import type { VenueConfig } from "../lib/venueConfig.js";
import { describeVenue, VENUE_SPECS, type VenueSpec } from "../lib/venueConfig.js";
import {
    BaseSupplyVenue,
    type VenueDeps,
    type VenueOrder,
    type SupplyVenueId,
} from "../lib/venues.js";
import { UNICHAIN_CHAIN_ID, type LeverageIntent, type SwapParamsData } from "../lib/types.js";

/** Venue-native order, plus the ERC-7683 `originData` the settler expects. */
export interface Erc7683Order {
    /** Venue-specific request body posted to the orderbook. */
    readonly request: Record<string, unknown>;
    /** The canonical `originData` tuple handed to `EswapSettlement.fill`. */
    readonly originData: SwapParamsData;
}

/**
 * ABI-encodes `SwapParamsData` into the `originData` blob
 * `EswapSettlement.fill(orderId, originData, fillerData)` decodes:
 *   (PoolKey key, PoolKey standardPoolKey, bool zeroForOne,
 *    int256 amountSpecified, uint8 leverage, address solver,
 *    bytes hookData, uint256 minAmountOut)
 */
export function encodeOriginData(data: SwapParamsData): Hex {
    return encodeAbiParameters(
        [
            { type: "tuple", components: poolKeyComponents },
            { type: "tuple", components: poolKeyComponents },
            { type: "bool" },
            { type: "int256" },
            { type: "uint8" },
            { type: "address" },
            { type: "bytes" },
            { type: "uint256" },
        ],
        [
            data.key,
            data.standardPoolKey,
            data.zeroForOne,
            data.amountSpecified,
            data.leverage,
            data.solver,
            data.hookData,
            data.minAmountOut,
        ],
    );
}

/**
 * Resolves the swap direction from a registered pool's currency ordering.
 *
 * PoolKey enforces `currency0 < currency1` by numeric address, so whether
 * `tokenIn` is currency0 depends on the pair — it is NOT always true. Getting
 * this backwards swaps margin and collateral legs, so an unrecognised pair is a
 * hard error rather than a default.
 */
export function deriveDirection(
    currency0: string,
    currency1: string,
    tokenIn: string,
    tokenOut: string,
    venueId: string,
): boolean {
    const c0 = currency0.toLowerCase();
    const c1 = currency1.toLowerCase();
    const tin = tokenIn.toLowerCase();
    const tout = tokenOut.toLowerCase();
    if (tin === c0 && tout === c1) return true;
    if (tin === c1 && tout === c0) return false;
    throw new Error(
        `[${venueId}] (${tokenIn} -> ${tokenOut}) matches neither orientation of registered pool (${currency0}, ${currency1})`,
    );
}

export abstract class Erc7683Venue extends BaseSupplyVenue<Erc7683Order> {
    protected readonly cfg: VenueConfig;
    protected readonly spec: VenueSpec;

    constructor(deps: VenueDeps, cfg: VenueConfig, spec: VenueSpec) {
        super(deps);
        this.cfg = cfg;
        this.spec = spec;
    }

    protected get settlementAddress() {
        const settlement = this.cfg.settlement;
        if (settlement === undefined) {
            throw new Error(`[${this.info.id}] settlement address not configured`);
        }
        return settlement;
    }

    /**
     * Encodes the ERC-7683 `originData` the destination settler decodes.
     *
     * `zeroForOne` is DERIVED from the quoter-registered pool's currency
     * ordering rather than assumed. PoolKey requires currency0 < currency1
     * numerically, so `tokenIn` is currency0 only about half the time; assuming
     * `true` silently reversed every short (WETH-in) leg and made the reverse
     * direction unreachable. An unrecognised pair is rejected instead.
     */
    protected async buildOriginData(intent: LeverageIntent): Promise<SwapParamsData> {
        const { hookPoolKey, standardPoolKey } = await this.poolKeysFor(intent.tokenIn, intent.tokenOut, intent.fee);
        return {
            key: hookPoolKey,
            standardPoolKey,
            zeroForOne: deriveDirection(hookPoolKey.currency0, hookPoolKey.currency1, intent.tokenIn, intent.tokenOut, this.info.id),
            amountSpecified: intent.amountIn,
            leverage: intent.leverage,
            solver: this.deps.clients.account.address,
            hookData: "0x",
            minAmountOut: intent.minAmountOut,
        };
    }

    async buildOrder(intent: LeverageIntent): Promise<VenueOrder<Erc7683Order>> {
        return {
            venue: this.info.id,
            payload: {
                request: this.buildRequest(intent),
                originData: await this.buildOriginData(intent),
            },
            fill: await this.resolveFill(intent),
        };
    }

    private async resolveFill(intent: LeverageIntent) {
        const { hookPoolKey, standardPoolKey } = await this.poolKeysFor(intent.tokenIn, intent.tokenOut, intent.fee);
        return {
            leverage: intent.leverage,
            solver: this.deps.clients.account.address,
            key: hookPoolKey,
            standardPoolKey,
        };
    }

    /** Venue-specific origin-order request body. Implemented per venue. */
    protected abstract buildRequest(intent: LeverageIntent): Record<string, unknown>;

    /** Venue-specific POST target path. Implemented per venue. */
    protected abstract orderbookPath(): string;

    async submitToOrderbook(order: VenueOrder<Erc7683Order>, intent: LeverageIntent): Promise<string> {
        if (this.cfg.apiUrl === undefined) throw new Error(`[${this.info.id}] API URL not configured`);
        const res = await fetch(`${this.cfg.apiUrl.replace(/\/$/, "")}${this.orderbookPath()}`, {
            method: "POST",
            headers: { "content-type": "application/json", accept: "application/json" },
            body: JSON.stringify({
                ...order.payload.request,
                // The destination settler + chain the filler must deliver to.
                settlement: this.settlementAddress,
                destinationChainId: UNICHAIN_CHAIN_ID,
                fillDeadlineSec: Math.floor(Date.now() / 1000) + (intent.validToOffsetSec ?? 3600),
            }),
        });
        const text = await res.text();
        if (!res.ok) {
            throw new Error(`${this.info.label} orderbook rejected order (${res.status}): ${text}`);
        }
        // Record the venue-assigned id on the order so a later directFill is
        // actually reachable. Venues that return no id (1inch Fusion+ answers
        // with an empty body by design) simply leave it unset, and the order
        // stays orderbook-routed.
        const assigned = this.parseOrderId(text);
        if (assigned !== undefined) {
            (order as { orderId?: Hex }).orderId = assigned;
        }
        return text === "" ? String(res.status) : text;
    }

    /**
     * Extracts the venue-assigned order id from an orderbook response body.
     * Venues disagree on the field name, so the known keys are tried in order
     * and anything unrecognised yields undefined (order stays orderbook-routed)
     * rather than a guessed value.
     */
    protected parseOrderId(body: string): Hex | undefined {
        if (body === "") return undefined;
        let parsed: unknown;
        try {
            parsed = JSON.parse(body);
        } catch {
            return undefined;
        }
        if (typeof parsed !== "object" || parsed === null) return undefined;
        const rec = parsed as Record<string, unknown>;
        for (const field of ["orderId", "order_id", "id", "orderHash", "hash"]) {
            const value = rec[field];
            if (typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value)) return value as Hex;
        }
        return undefined;
    }

    /**
     * Synchronous fill through the generic ERC-7683 settler.
     *
     * The venue assigns `orderId`; it is NOT derivable from the intent, so this
     * path is only reachable once the caller has actually obtained one (see
     * `submitToOrderbook` / the relayer). Previously `buildOrder` never produced
     * an orderId, so a freshly built order could never take this branch and the
     * route silently fell back to the orderbook.
     *
     * `fillerData` is the venue resolver's on-chain proof and is REQUIRED. A
     * previous revision defaulted it to `0x`, which would have let a caller
     * submit a fill with no resolver proof at all; failing closed is the only
     * safe behaviour because the settler pulls the full leveraged notional.
     */
    async directFill(order: VenueOrder<Erc7683Order>, intent: LeverageIntent): Promise<Hex> {
        if (order.orderId === undefined) {
            throw new Error(
                `[${this.info.id}] direct fill requires a venue-assigned orderId; ` +
                    `this order has none, so it can only be routed to the orderbook`,
            );
        }
        const fillerData = this.decodeFillerData(order);
        void intent;
        const hash = await this.deps.clients.walletClient.writeContract({
            address: this.settlementAddress,
            abi: settlementAbi,
            functionName: "fill",
            args: [order.orderId, encodeOriginData(order.payload.originData), fillerData],
            account: this.deps.clients.account,
        });
        const receipt = await this.deps.clients.publicClient.waitForTransactionReceipt({ hash });
        if (receipt.status !== "success") throw new Error(`${this.info.label} fill reverted: ${hash}`);
        return hash;
    }

    /**
     * Venue resolver proof carried alongside the order.
     *
     * Fails closed: an absent or non-hex proof is an error, never `0x`. The
     * destination settler moves the FULL leveraged notional, so a missing
     * resolver proof must abort the fill rather than submit an unproven one.
     */
    protected decodeFillerData(order: VenueOrder<Erc7683Order>): Hex {
        const raw = order.payload.request.fillerData;
        if (typeof raw !== "string" || !raw.startsWith("0x")) {
            throw new Error(
                `[${this.info.id}] order carries no resolver proof (fillerData); refusing to fill without it`,
            );
        }
        if (raw.length <= 2) {
            throw new Error(`[${this.info.id}] resolver proof (fillerData) is empty; refusing to fill`);
        }
        return raw as Hex;
    }

    protected static describe(specId: SupplyVenueId): VenueSpec {
        const spec = VENUE_SPECS.find((s) => s.id === specId);
        if (spec === undefined) throw new Error(`${specId} spec missing from VENUE_SPECS`);
        return spec;
    }

    protected static infoFor(spec: VenueSpec) {
        return describeVenue(spec);
    }
}
