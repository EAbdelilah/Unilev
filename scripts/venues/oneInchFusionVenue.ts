/**
 * scripts/venues/oneInchFusionVenue.ts
 * Supply venue: 1inch Fusion / Fusion+.
 * =================================================================
 * Corrected against the 1inch Fusion API docs and `@1inch/cross-chain-sdk`:
 *
 *  - Classic (single-chain) Fusion submits to
 *    `POST {url}/v2.0/{network}/order/submit` with
 *    `{order, signature, quoteId, extension}`. The previous revision invented
 *    `/fusion/orders` with a flat `{srcToken, dstToken, ...}` body; neither the
 *    path nor the shape exists.
 *  - Cross-chain Fusion+ submits to `POST https://api.1inch.com/fusion-plus/v1.2/submit`
 *    with `{order, signature, quoteId, extension, srcChainId, secretHashes}`
 *    and returns an EMPTY BODY. There is no order id in the response: the order
 *    hash is computed locally and status is polled.
 *  - Because the response carries no order id, this venue can never take the
 *    `directFill` branch.
 *  - Settlement is a hashlock/timelock ESCROW (`withdraw(secret, immutables)`),
 *    NOT an ERC-7683 fill, so `EswapSettlement.fill` cannot execute it. See
 *    `SETTLEMENT_MODEL` in scripts/lib/protocols.ts.
 *
 * Addresses are env-driven (ONEINCH_FUSION_SETTLEMENT_ADDRESS,
 * ONEINCH_FUSION_API_URL). Nothing is hard-coded.
 */
import { Erc7683Venue } from "./erc7683Venue.js";
import type { VenueDeps } from "../lib/venues.js";
import type { VenueConfig } from "../lib/venueConfig.js";
import { describeVenue, VENUE_SPECS } from "../lib/venueConfig.js";
import { ONEINCH_FUSION_REST, fusionDeployment } from "../lib/protocols.js";
import { UNICHAIN_CHAIN_ID, type LeverageIntent } from "../lib/types.js";
import type { Hex } from "viem";

export const ONEINCH_AUTH_KEY_ENV = "ONEINCH_AUTH_KEY";

export class OneInchFusionVenue extends Erc7683Venue {
    private static readonly SPEC = (() => {
        const spec = VENUE_SPECS.find((s) => s.id === "oneinchfusion");
        if (spec === undefined) throw new Error("oneinchfusion spec missing from VENUE_SPECS");
        return spec;
    })();

    override readonly info = describeVenue(OneInchFusionVenue.SPEC);

    constructor(deps: VenueDeps, cfg: VenueConfig) {
        super(deps, cfg, OneInchFusionVenue.SPEC);
    }

    /**
     * The Fusion order is built and signed by `@1inch/cross-chain-sdk`
     * (`LimitOrderContract` / escrow order). We assemble only the submission
     * envelope; the `order`, `quoteId` and `extension` must come from the SDK's
     * quote+build step because the auction parameters are what the signer and
     * the escrow hashlock commit to.
     */
    protected buildRequest(intent: LeverageIntent): Record<string, unknown> {
        return {
            srcChainId: UNICHAIN_CHAIN_ID,
            srcToken: intent.tokenIn,
            dstToken: intent.tokenOut,
            amount: intent.amountIn.toString(),
            minReturn: intent.minAmountOut.toString(),
            from: intent.owner,
        };
    }

    override async submitToOrderbook(
        order: Parameters<Erc7683Venue["submitToOrderbook"]>[0],
        intent: LeverageIntent,
    ): Promise<string> {
        const base = this.cfg.apiUrl;
        if (base === undefined) throw new Error("[oneinchfusion] ONEINCH_FUSION_API_URL not configured");
        const authKey = process.env[ONEINCH_AUTH_KEY_ENV];
        if (authKey === undefined || authKey === "") {
            throw new Error(`[oneinchfusion] ${ONEINCH_AUTH_KEY_ENV} not set (required by the Fusion API)`);
        }
        const envelope = order.payload.request;
        for (const field of ["order", "quoteId", "extension", "signature"] as const) {
            if (envelope[field] === undefined) {
                throw new Error(
                    `[oneinchfusion] submission envelope missing "${field}"; build and sign the order ` +
                        `with @1inch/cross-chain-sdk before submitting`,
                );
            }
        }
        const res = await fetch(
            `${base.replace(/\/$/, "")}${ONEINCH_FUSION_REST.crossChain.replace("https://api.1inch.com", "")}${ONEINCH_FUSION_REST.submit}`,
            {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    accept: "application/json",
                    Authorization: `Bearer ${authKey}`,
                },
                body: JSON.stringify({
                    order: envelope.order,
                    signature: envelope.signature,
                    quoteId: envelope.quoteId,
                    extension: envelope.extension,
                    srcChainId: envelope.srcChainId,
                    secretHashes: envelope.secretHashes ?? [],
                }),
            },
        );
        const text = await res.text();
        if (!res.ok) {
            throw new Error(`1inch Fusion submission rejected (${res.status}): ${text}`);
        }
        void intent;
        // Fusion+ answers 200 with an EMPTY body and no order id. The order
        // therefore stays orderbook-routed and must be polled by its locally
        // computed hash.
        if (text === "") {
            return `submitted (no order id in response; poll ${ONEINCH_FUSION_REST.status})`;
        }
        const assigned = this.parseOrderId(text);
        if (assigned !== undefined) {
            (order as { orderId?: Hex }).orderId = assigned;
        }
        return text;
    }

    /**
     * 1inch settles by withdrawing from a hashlock/timelock escrow, so the
     * generic ERC-7683 settler cannot execute this venue's fill. Refuse loudly
     * rather than encoding an order the settler would reject.
     */
    override async directFill(): Promise<Hex> {
        throw new Error(
            "[oneinchfusion] direct fill via EswapSettlement.fill is not possible: Fusion settles by " +
                "escrow withdraw(secret, immutables) (escrow-withdraw model). A dedicated settler " +
                "contract is required — see scripts/lib/protocols.ts SETTLEMENT_MODEL.",
        );
    }

    /** Escrow addresses the SDK reports for the destination chain. */
    escrowAddresses(): ReturnType<typeof fusionDeployment> {
        return fusionDeployment(UNICHAIN_CHAIN_ID);
    }

    protected orderbookPath(): string {
        return ONEINCH_FUSION_REST.submit;
    }
}
