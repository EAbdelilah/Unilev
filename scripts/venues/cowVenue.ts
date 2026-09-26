/**
 * scripts/venues/cowVenue.ts
 * Supply venue: CoW Protocol (GPv2 settlement + orderbook).
 * =================================================================
 * Extracted from `scripts/adapters/aggregatorCowBridge.ts` so the registry can
 * treat CoW as one venue among four. Behaviour is preserved exactly:
 *
 *   - the order encoding is the byte-exact canonical CoW `KIND_SELL` /
 *     `BALANCE_ERC20` / `RECEIVER_SAME_AS_OWNER` payload from
 *     `src/v4/cow/CowOrder.sol`, and
 *   - the direct path calls `EswapCoWSettlement.fillOrder` with the EIP-1271
 *     signature packed as `abi.encodePacked(owner, innerSignature)`.
 *
 * The borrow leg is funded by the external CoW solver, so this route is
 * zero-treasury.
 */
import { keccak256 } from "viem";
import { cowSettlementAbi } from "../lib/abis.js";
import type { VenueConfig } from "../lib/venueConfig.js";
import { describeVenue, VENUE_SPECS } from "../lib/venueConfig.js";
import {
    BaseSupplyVenue,
    type VenueDeps,
    type VenueOrder,
} from "../lib/venues.js";
import {
    BALANCE_ERC20,
    CowScheme,
    KIND_SELL,
    RECEIVER_SAME_AS_OWNER,
    SIGNING_SCHEME_TO_ENUM,
    type CowOrderData,
    type FillParams,
    type LeverageIntent,
} from "../lib/types.js";

/** appData hash identifying Eswap orders on the CoW orderbook. */
export const DEFAULT_APP_DATA = keccak256(new TextEncoder().encode("eswap-cow-bridge"));

function cowSpec() {
    const spec = VENUE_SPECS.find((s) => s.id === "cow");
    if (spec === undefined) throw new Error("cow spec missing from VENUE_SPECS");
    return spec;
}

export class CowVenue extends BaseSupplyVenue<CowOrderData> {
    override readonly info = describeVenue(cowSpec());

    private readonly cfg: VenueConfig;

    constructor(deps: VenueDeps, cfg: VenueConfig) {
        super(deps);
        this.cfg = cfg;
    }

    /**
     * Formats an incoming aggregator intent as an EIP-712/EIP-1271 CoW order.
     * `receiver = address(0)` (proceeds to the order signer), so the position is
     * credited to the recovered order owner exactly like a native CoW order.
     */
    async buildOrder(
        intent: LeverageIntent,
        nowSec: number = Math.floor(Date.now() / 1000),
    ): Promise<VenueOrder<CowOrderData>> {
        const validTo = nowSec + (intent.validToOffsetSec ?? 3600);
        if (validTo > 0xffffffff) throw new Error("validTo overflows uint32");
        return {
            venue: this.info.id,
            payload: {
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
            },
            fill: await this.resolveFill(intent),
        };
    }

    /** Canonical fill params, resolved from the quoter-registered pools. */
    private async resolveFill(intent: LeverageIntent): Promise<FillParams> {
        const { hookPoolKey, standardPoolKey } = await this.poolKeysFor(intent.tokenIn, intent.tokenOut, intent.fee);
        return {
            leverage: intent.leverage,
            solver: this.deps.clients.account.address,
            key: hookPoolKey,
            standardPoolKey,
        };
    }

    /** Routes the order to external CoW solvers via the orderbook API. */
    async submitToOrderbook(order: VenueOrder<CowOrderData>, intent: LeverageIntent): Promise<string> {
        if (this.cfg.apiUrl === undefined) throw new Error("[cow] COW_API_URL not configured");
        const { sellToken, buyToken, receiver, sellAmount, buyAmount, validTo, appData } = order.payload;
        const payload = {
            sellToken,
            buyToken,
            receiver,
            sellAmount: String(sellAmount),
            buyAmount: String(buyAmount),
            validTo,
            appData,
            feeAmount: "0",
            kind: "sell",
            partiallyFillable: false,
            sellTokenBalance: "erc20",
            buyTokenBalance: "erc20",
            signingScheme: intent.signingScheme,
            signature: intent.signature,
            from: intent.owner,
        };
        const res = await fetch(`${this.cfg.apiUrl.replace(/\/$/, "")}/api/v1/orders`, {
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
     * Synchronous fill: calls `EswapCoWSettlement.fillOrder` directly with the
     * EXTERNAL solver funding margin + borrow. The router's solver-funded unlock
     * pulls the full notional from `params.solver`.
     */
    async directFill(order: VenueOrder<CowOrderData>, intent: LeverageIntent): Promise<`0x${string}`> {
        const settlement = this.cfg.settlement;
        if (settlement === undefined) throw new Error("[cow] COW_SETTLEMENT_ADDRESS not configured");
        const scheme = SIGNING_SCHEME_TO_ENUM[intent.signingScheme];
        if (scheme === undefined) throw new Error(`unsupported signingScheme: ${intent.signingScheme}`);
        let signature = intent.signature;
        if (scheme === CowScheme.Eip1271) {
            // recoverEip1271Signer expects abi.encodePacked(owner, innerSignature).
            signature = (intent.owner + intent.signature.slice(2)) as `0x${string}`;
        }
        const hash = await this.deps.clients.walletClient.writeContract({
            address: settlement,
            abi: cowSettlementAbi,
            functionName: "fillOrder",
            args: [order.payload, scheme, signature, order.fill],
            account: this.deps.clients.account,
        });
        const receipt = await this.deps.clients.publicClient.waitForTransactionReceipt({ hash });
        if (receipt.status !== "success") throw new Error(`fillOrder reverted: ${hash}`);
        return hash;
    }
}
