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
        // Across is a bridge, so origin and destination can never be the same
        // chain: a 130->130 quote is rejected with "No bridge routes found for
        // 130 -> 130". Collateral sits on the user's origin chain and is bridged
        // in; the destination leg opens margin+borrow on Unichain. Same-chain
        // flows belong to the demand-side venues, not here.
        const originChainId = intent.originChainId;
        const destinationChainId = UNICHAIN_CHAIN_ID;
        if (originChainId === destinationChainId) {
            throw new Error(
                `[across] origin and destination are both ${destinationChainId}; ` +
                    `Across cannot bridge a chain to itself, use a demand-side venue instead`,
            );
        }
        return {
            tradeType: "exactInput",
            amount: intent.amountIn.toString(),
            inputToken: intent.tokenIn,
            outputToken: intent.tokenOut,
            originChainId,
            destinationChainId,
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
        // Verified live on Unichain (Ethereum USDC -> Unichain WETH, 5 USDC):
        // `swapTx` is an OBJECT { ecosystem, simulationSuccess, chainId, to,
        // data, gas } whose `data` is the hex calldata, NOT a hex string, and
        // there is no top-level `orderId` or `estimatedProfit` -- the amounts
        // live under expectedOutputAmount / minOutputAmount. The quote is
        // therefore orderbook-routed, and the relayer supplies its own order id.
        const parsed = JSON.parse(text) as {
            swapTx?: { to?: string; data?: string; value?: string };
            expectedOutputAmount?: string;
            minOutputAmount?: string;
            id?: string;
        };
        const swapTx = parsed.swapTx;
        if (typeof swapTx !== "object" || typeof swapTx.data !== "string" || !swapTx.data.startsWith("0x")) {
            throw new Error(`Across quote response missing prebuilt swapTx.data: ${text.slice(0, 200)}`);
        }
        if (typeof swapTx.to !== "string" || !swapTx.to.startsWith("0x")) {
            throw new Error(`Across quote response missing swapTx.to: ${text.slice(0, 200)}`);
        }
        return text;
    }

    protected orderbookPath(): string {
        return ACROSS_REST.quote;
    }
}
