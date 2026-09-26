/**
 * scripts/venues/acrossVenue.ts
 * Supply venue: Across Relayers.
 * =================================================================
 * Corrected against the Across Swap API (docs.across.to/introduction/swap-api):
 *
 *  - There is NO order-create endpoint. `GET /swap/approval` is a QUOTE that
 *    returns a PREBUILT `swapTx` (the origin-chain deposit calldata) plus
 *    estimated fill profit. The previous revision POSTed to an invented
 *    `/api/relay` with an invented `exclusiveFiller` field; neither exists.
 *  - The quote is parameterised by `tradeType` ("minOutput" | "exactInput"),
 *    `amount`, `inputToken`, `outputToken`, `originChainId`,
 *    `destinationChainId`, `depositor`.
 *  - There is NO client-settable fill deadline, and NO order id in the response.
 *  - Auth is `Authorization: Bearer <API_KEY>` plus a 2-byte `integratorId`.
 *
 * Because the response carries no order id, this venue can never take the
 * `directFill` branch; it is orderbook/relay driven, and the relayer calls
 * `EswapSettlement.fill` on the destination with its own order id.
 *
 * Addresses are env-driven (ACROSS_SETTLEMENT_ADDRESS,
 * ACROSS_SPOKE_POOL_ADDRESS, ACROSS_API_URL). Nothing is hard-coded.
 */
import { Erc7683Venue } from "./erc7683Venue.js";
import type { VenueDeps } from "../lib/venues.js";
import type { VenueConfig } from "../lib/venueConfig.js";
import { describeVenue, VENUE_SPECS } from "../lib/venueConfig.js";
import { ACROSS_REST } from "../lib/protocols.js";
import { UNICHAIN_CHAIN_ID, type LeverageIntent } from "../lib/types.js";

/** Env slots Across's Swap API requires beyond the venue config. */
export const ACROSS_API_KEY_ENV = "ACROSS_API_KEY";
export const ACROSS_INTEGRATOR_ID_ENV = "ACROSS_INTEGRATOR_ID";

export class AcrossVenue extends Erc7683Venue {
    private static readonly SPEC = (() => {
        const spec = VENUE_SPECS.find((s) => s.id === "across");
        if (spec === undefined) throw new Error("across spec missing from VENUE_SPECS");
        return spec;
    })();

    override readonly info = describeVenue(AcrossVenue.SPEC);

    constructor(deps: VenueDeps, cfg: VenueConfig) {
        super(deps, cfg, AcrossVenue.SPEC);
    }

    protected buildRequest(intent: LeverageIntent): Record<string, unknown> {
        if (this.cfg.extraAddresses.spokePool === undefined) {
            throw new Error("[across] ACROSS_SPOKE_POOL_ADDRESS not configured");
        }
        // Exact-input across the full leveraged notional: the origin leg is
        // bridged in, and the destination settler opens margin+borrow.
        return {
            tradeType: "exactInput",
            amount: intent.amountIn.toString(),
            inputToken: intent.tokenIn,
            outputToken: intent.tokenOut,
            originChainId: UNICHAIN_CHAIN_ID,
            destinationChainId: UNICHAIN_CHAIN_ID,
            depositor: intent.owner,
        };
    }

    /**
     * Across quotes over GET, not POST, and the query string is the request.
     * The deprecated `/api/relay` POST path used previously does not exist.
     */
    override async submitToOrderbook(
        order: Parameters<Erc7683Venue["submitToOrderbook"]>[0],
        intent: LeverageIntent,
    ): Promise<string> {
        const base = this.cfg.apiUrl;
        if (base === undefined) throw new Error("[across] ACROSS_API_URL not configured");
        const apiKey = process.env[ACROSS_API_KEY_ENV];
        const integratorId = process.env[ACROSS_INTEGRATOR_ID_ENV];
        if (apiKey === undefined || apiKey === "") {
            throw new Error(`[across] ${ACROSS_API_KEY_ENV} not set (required by the Swap API)`);
        }
        if (integratorId === undefined || integratorId === "") {
            throw new Error(`[across] ${ACROSS_INTEGRATOR_ID_ENV} not set (2-byte integrator id)`);
        }
        const request = this.buildRequest(intent);
        const url = new URL(`${base.replace(/\/$/, "")}${ACROSS_REST.quote}`);
        for (const [key, value] of Object.entries(request)) {
            url.searchParams.set(key, String(value));
        }
        const res = await fetch(url, {
            method: "GET",
            headers: {
                accept: "application/json",
                Authorization: `Bearer ${apiKey}`,
                "X-Inintegrator-Id": integratorId,
            },
        });
        const text = await res.text();
        if (!res.ok) {
            throw new Error(`Across quote rejected (${res.status}): ${text}`);
        }
        // Documented response fields: swapTx (prebuilt origin deposit calldata),
        // estimatedProfit, and a quoted output amount. There is NO orderId, so
        // the order deliberately stays orderbook-routed.
        const parsed = JSON.parse(text) as { swapTx?: unknown };
        if (typeof parsed.swapTx !== "string" || !parsed.swapTx.startsWith("0x")) {
            throw new Error(`Across quote response missing prebuilt swapTx: ${text.slice(0, 200)}`);
        }
        return text;
    }

    protected orderbookPath(): string {
        return ACROSS_REST.quote;
    }
}
