/**
 * scripts/venues/uniswapXVenue.ts
 * Supply venue: UniswapX.
 * =================================================================
 * Corrected against the UniswapX docs and `@uniswap/uniswapx-sdk`:
 *
 *  - Order creation is `POST https://trade-api.gateway.uniswap.org/v1/order`
 *    with `{signature, quote, routing}`. The request IS the signed EIP-712
 *    permit; the previous revision invented an `/api/v1/orders` REST create
 *    with a plain JSON body, which does not exist.
 *  - `POST /v1/quote` must be called first; the returned quote is embedded in
 *    the permit and its `quoteId` is echoed in `routing`.
 *  - Deadline and exclusivity are NOT client-set. They come from the quote and
 *    are bound into the permit, so a client that tries to override them produces
 *    an invalid signature.
 *  - Settlement is `IReactor.execute(SignedOrder)` — NOT an ERC-7683 fill. This
 *    venue therefore CANNOT be served by `EswapSettlement.fill`; see
 *    `SETTLEMENT_MODEL` in scripts/lib/protocols.ts. It extends Erc7683Venue
 *    only to reuse pool resolution and originData encoding, and its
 *    `directFill` is disabled accordingly.
 *
 * On Unichain only Dutch_V3 and Priority reactors are deployed; Dutch and
 * Dutch_V2 map to the zero address (verified via REACTOR_ADDRESS_MAPPING).
 */
import { Erc7683Venue } from "./erc7683Venue.js";
import type { VenueDeps } from "../lib/venues.js";
import type { VenueConfig } from "../lib/venueConfig.js";
import { describeVenue, VENUE_SPECS } from "../lib/venueConfig.js";
import { UNISWAPX_REST, uniswapXDeployment } from "../lib/protocols.js";
import { UNICHAIN_CHAIN_ID, type LeverageIntent } from "../lib/types.js";
import type { Hex } from "viem";

export class UniswapXVenue extends Erc7683Venue {
    private static readonly SPEC = (() => {
        const spec = VENUE_SPECS.find((s) => s.id === "uniswapx");
        if (spec === undefined) throw new Error("uniswapx spec missing from VENUE_SPECS");
        return spec;
    })();

    override readonly info = describeVenue(UniswapXVenue.SPEC);

    constructor(deps: VenueDeps, cfg: VenueConfig) {
        super(deps, cfg, UniswapXVenue.SPEC);
    }

    /** Order types actually deployed on the destination chain. */
    supportedOrderTypes(): readonly string[] {
        return uniswapXDeployment(UNICHAIN_CHAIN_ID).supportedOrderTypes;
    }

    /**
     * The `quote` half of the submit body. Obtained from
     * `POST {UNISWAPX_REST.quote}` and embedded verbatim in the permit — it is
     * NOT constructed here, because the quote's amounts, deadline and
     * exclusivity are what the signer signs over.
     */
    protected buildRequest(intent: LeverageIntent): Record<string, unknown> {
        const reactor = this.cfg.extraAddresses.reactor;
        if (reactor === undefined) {
            throw new Error("[uniswapx] UNISWAPX_REACTOR_ADDRESS not configured");
        }
        return {
            reactor,
            tokenIn: intent.tokenIn,
            tokenOut: intent.tokenOut,
            amount: intent.amountIn.toString(),
            minAmountOut: intent.minAmountOut.toString(),
            recipient: intent.owner,
        };
    }

    /**
     * Posts `{signature, quote, routing}`. The permit signature is produced by
     * the SDK's order builder and supplied on the order; we never synthesise
     * one, and we never add deadline/exclusivity fields because those are bound
     * into the permit by the quote.
     */
    override async submitToOrderbook(
        order: Parameters<Erc7683Venue["submitToOrderbook"]>[0],
        intent: LeverageIntent,
    ): Promise<string> {
        const request = this.buildRequest(intent);
        const signature = order.payload.request.signature;
        const quote = order.payload.request.quote;
        if (typeof signature !== "string" || !signature.startsWith("0x")) {
            throw new Error("[uniswapx] order carries no EIP-712 permit signature; refusing to submit");
        }
        if (typeof quote !== "object" || quote === null) {
            throw new Error("[uniswapx] order carries no quote; run the quote step before submitting");
        }
        void request;
        const res = await fetch(UNISWAPX_REST.submit, {
            method: "POST",
            headers: { "content-type": "application/json", accept: "application/json" },
            body: JSON.stringify({
                signature,
                quote,
                routing: { reactor: this.cfg.extraAddresses.reactor, chainId: UNICHAIN_CHAIN_ID },
            }),
        });
        const text = await res.text();
        if (!res.ok) {
            throw new Error(`UniswapX order submission rejected (${res.status}): ${text}`);
        }
        const assigned = this.parseOrderId(text);
        if (assigned !== undefined) {
            (order as { orderId?: Hex }).orderId = assigned;
        }
        return text;
    }

    /**
     * UniswapX settles by `IReactor.execute(SignedOrder)`, so the generic
     * ERC-7683 settler cannot execute this venue's fill. Refuse loudly instead
     * of encoding an order the settler would reject.
     */
    override async directFill(): Promise<Hex> {
        throw new Error(
            "[uniswapx] direct fill via EswapSettlement.fill is not possible: UniswapX settles " +
                "through IReactor.execute(SignedOrder) (reactor-execute model). A dedicated settler " +
                "contract is required — see scripts/lib/protocols.ts SETTLEMENT_MODEL.",
        );
    }

    protected orderbookPath(): string {
        return "/v1/order";
    }
}
