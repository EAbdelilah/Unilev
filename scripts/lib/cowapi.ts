/**
 * CoW Protocol REST orderbook client — normalized view of `/api/v1/orders`
 * used by the solver bot and the aggregator bridge.
 */
import { type CowScheme } from "./types.js";

/**
 * The orderbook's raw JSON representation of an order. Amounts are decimal
 * strings, `kind`/`*Balance` are human-readable markers ("sell", "erc20"),
 * `signingScheme` follows the CoW API taxonomy ("eip712" | "ethsign" |
 * "eip1271" | "presign").
 */
export interface CowApiOrder {
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
    signingScheme: string;
    signature: string;
    owner: string;
    orderUid: string;
    creationDate: string;
}

/** Maps CoW API balance markers to the on-chain bytes32 constants (or passes them through). */
export function balanceMarker(marker: string, erc20Marker: `0x${string}`): `0x${string}` {
    if (marker === "erc20") return erc20Marker;
    if (marker.startsWith("0x")) return marker as `0x${string}`;
    return marker as `0x${string}`;
}

/**
 * Parses a `/api/v1/orders` payload. Accepts either a bare array or an object
 * whose `orders` field holds the array (defensive against API shape drift).
 */
export function cowOrders(raw: unknown): CowApiOrder[] {
    const maybeArray = Array.isArray(raw) ? (raw as unknown[]) : ((raw as { orders?: unknown })?.orders as unknown[]);
    if (!Array.isArray(maybeArray)) {
        throw new Error("cowOrders: expected an array or { orders: [...] } payload");
    }
    return maybeArray.map((entry) => normalizeCowOrder(entry));
}

/** CoW scheme string → protocol enum index, or undefined when unrecognized. */
export function schemeToEnum(signingScheme: string, schemes: Record<string, CowScheme>): CowScheme | undefined {
    return schemes[signingScheme.toLowerCase()];
}

function normalizeCowOrder(entry: unknown): CowApiOrder {
    const o = entry as Record<string, unknown>;
    const required: CowApiOrder = {
        sellToken: String(o.sellToken ?? ""),
        buyToken: String(o.buyToken ?? ""),
        receiver: String(o.receiver ?? "0x0000000000000000000000000000000000000000"),
        sellAmount: String(o.sellAmount ?? "0"),
        buyAmount: String(o.buyAmount ?? "0"),
        validTo: Number(o.validTo ?? 0),
        appData: String(o.appData ?? "0x"),
        feeAmount: String(o.feeAmount ?? "0"),
        kind: String(o.kind ?? ""),
        partiallyFillable: Boolean(o.partiallyFillable ?? false),
        sellTokenBalance: String(o.sellTokenBalance ?? "erc20"),
        buyTokenBalance: String(o.buyTokenBalance ?? "erc20"),
        signingScheme: String(o.signingScheme ?? ""),
        signature: String(o.signature ?? "0x"),
        owner: String(o.owner ?? ""),
        orderUid: String(o.orderUid ?? ""),
        creationDate: String(o.creationDate ?? ""),
    };
    if (!required.sellToken || !required.buyToken || !required.orderUid) {
        throw new Error("cowOrders: order missing required fields (sellToken/buyToken/orderUid)");
    }
    return required;
}