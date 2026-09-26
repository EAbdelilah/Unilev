/**
 * scripts/lib/protocols.ts
 * Verified on-chain endpoints for the supply-side solver networks, resolved
 * from the OFFICIAL SDK deployment maps at runtime.
 * =================================================================
 * Why this module exists: an earlier revision of the venue layer hardcoded
 * guessed proxy/router addresses and invented REST request shapes. Both were
 * wrong. The corrections, verified against the real SDKs and protocol docs:
 *
 *  Across      `GET https://app.across.to/api/swap/approval` returns a PREBUILT
 *              `swapTx`. There is NO order-create endpoint, NO order id in the
 *              response, and NO client-settable fill deadline. Requires an
 *              API key + integratorId. The ERC-7683 `fill(bytes32,bytes,bytes)`
 *              on SpokePool is v1 and DEPRECATED, so Eswap's own
 *              `EswapSettlement.fill` is the destination settler instead.
 *
 *  UniswapX    Order creation is `POST https://trade-api.gateway.uniswap.org/v1/order`
 *              with `{signature, quote, routing}` — the signed permit IS the
 *              request. Deadline/exclusivity are NOT client-set; they come from
 *              the quote and are bound into the EIP-712 permit.
 *              Settlement is `IReactor.execute(SignedOrder)` — NOT ERC-7683.
 *              NOTE: on Unichain only Dutch_V3 / Priority / Hybrid are
 *              deployed; Dutch and Dutch_V2 map to the zero address.
 *
 *  1inch       Fusion+ is `POST https://api.1inch.com/fusion-plus/v1.2/submit`
 *              with `{order, signature, quoteId, extension, srcChainId, secretHashes}`
 *              and returns NO body/order id — the order hash is computed locally
 *              and status is polled. Classic (single-chain) Fusion is
 *              `POST {url}/v2.0/{network}/order/submit` with
 *              `{order, signature, quoteId, extension}`.
 *              Settlement is a hashlock/timelock ESCROW (`withdraw(secret, immutables)`),
 *              NOT ERC-7683.
 *
 * Addresses are read from the SDKs' own maps (`REACTOR_ADDRESS_MAPPING`,
 * `ESCROW_FACTORY`, ...) rather than hardcoded, so a protocol redeploy surfaces
 * as a changed value instead of silently targeting a dead contract.
 */
import { createRequire } from "node:module";
import type { Address } from "viem";
import { UNICHAIN_CHAIN_ID } from "./types.js";

/**
 * Both SDKs are loaded through `createRequire` (their CommonJS builds) rather
 * than `import`. `@uniswap/uniswapx-sdk`'s ESM build is published with an
 * extensionless directory import (`dist/esm/src/constants`), which Node's ESM
 * resolver rejects outright (ERR_UNSUPPORTED_DIR_IMPORT). The CJS build is
 * intact, so we bind to it explicitly rather than patching node_modules.
 */
const requireSdk = createRequire(import.meta.url);
const { NetworkEnum, ESCROW_DST_IMPLEMENTATION, ESCROW_FACTORY, ESCROW_SRC_IMPLEMENTATION, TRUE_ERC20 } =
    requireSdk("@1inch/cross-chain-sdk") as typeof import("@1inch/cross-chain-sdk");
const { PERMIT2_MAPPING, REACTOR_ADDRESS_MAPPING, UNISWAPX_ORDER_QUOTER_MAPPING } =
    requireSdk("@uniswap/uniswapx-sdk") as typeof import("@uniswap/uniswapx-sdk");

const ZERO = "0x0000000000000000000000000000000000000000";

/** UniswapX order types, as keyed by the SDK's reactor map. */
export type UniswapXOrderType = "Dutch" | "Dutch_V2" | "Dutch_V3" | "Priority" | "Relay";

/** Unwraps the SDK's `EvmAddress`/`Address` wrappers down to a plain hex string. */
function unwrap(value: unknown): string | undefined {
    if (value === undefined || value === null) return undefined;
    if (typeof value === "string") return value;
    const inner = (value as { inner?: { val?: unknown } }).inner;
    if (inner !== undefined && inner !== null && typeof inner.val === "string") return inner.val;
    const val = (value as { val?: unknown }).val;
    if (typeof val === "string") return val;
    return undefined;
}

function asAddress(value: string | undefined): Address | undefined {
    if (value === undefined || value === ZERO) return undefined;
    return value as Address;
}

export interface UniswapXDeployment {
    /** Reactors that actually have code on this chain. Zero address => absent. */
    readonly reactors: Readonly<Partial<Record<UniswapXOrderType, Address>>>;
    /** Order types live on this chain (a zero-address reactor is NOT usable). */
    readonly supportedOrderTypes: readonly UniswapXOrderType[];
    readonly permit2?: Address;
    readonly orderQuoter?: Address;
}

export function uniswapXDeployment(chainId: number = UNICHAIN_CHAIN_ID): UniswapXDeployment {
    const map = (REACTOR_ADDRESS_MAPPING as Record<string, Record<string, string>> | undefined)?.[chainId] ?? {};
    const reactors: Partial<Record<UniswapXOrderType, Address>> = {};
    const supportedOrderTypes: UniswapXOrderType[] = [];
    for (const [key, value] of Object.entries(map)) {
        const addr = asAddress(value as string | undefined);
        if (addr === undefined) continue;
        reactors[key as UniswapXOrderType] = addr;
        supportedOrderTypes.push(key as UniswapXOrderType);
    }
    return {
        reactors,
        supportedOrderTypes,
        ...(asAddress((PERMIT2_MAPPING as Record<string, string> | undefined)?.[chainId]) === undefined
            ? {}
            : { permit2: asAddress((PERMIT2_MAPPING as Record<string, string> | undefined)?.[chainId]) }),
        ...(asAddress((UNISWAPX_ORDER_QUOTER_MAPPING as Record<string, string> | undefined)?.[chainId]) === undefined
            ? {}
            : { orderQuoter: asAddress((UNISWAPX_ORDER_QUOTER_MAPPING as Record<string, string> | undefined)?.[chainId]) }),
    };
}

export interface FusionDeployment {
    readonly escrowFactory?: Address;
    readonly escrowSrcImplementation?: Address;
    readonly escrowDstImplementation?: Address;
    readonly trueErc20?: Address;
    /** True when the SDK recognises the chain in its NetworkEnum. */
    readonly supported: boolean;
    /** The SDK's name for the chain (e.g. "UNICHAIN"), when recognised. */
    readonly networkName?: string;
}

export function fusionDeployment(chainId: number = UNICHAIN_CHAIN_ID): FusionDeployment {
    const pick = (m: unknown) => asAddress(unwrap((m as Record<string, unknown> | undefined)?.[chainId]));
    // NetworkEnum is a bidirectional enum: the numeric key maps to a name
    // string (NetworkEnum[130] === "UNICHAIN"), so probe the KEY, not the value.
    const networkName = (NetworkEnum as unknown as Record<string, string | number>)[chainId];
    const name = typeof networkName === "string" ? networkName : undefined;
    return {
        ...(pick(ESCROW_FACTORY) === undefined ? {} : { escrowFactory: pick(ESCROW_FACTORY) }),
        ...(pick(ESCROW_SRC_IMPLEMENTATION) === undefined
            ? {}
            : { escrowSrcImplementation: pick(ESCROW_SRC_IMPLEMENTATION) }),
        ...(pick(ESCROW_DST_IMPLEMENTATION) === undefined
            ? {}
            : { escrowDstImplementation: pick(ESCROW_DST_IMPLEMENTATION) }),
        ...(pick(TRUE_ERC20) === undefined ? {} : { trueErc20: pick(TRUE_ERC20) }),
        supported: name !== undefined,
        ...(name === undefined ? {} : { networkName: name }),
    };
}

/** Across has no order-create endpoint; these are the documented REST paths. */
export const ACROSS_REST = {
    base: "https://app.across.to/api",
    /** Quote + prebuilt swapTx calldata. GET. Requires Bearer key + integratorId. */
    quote: "/swap/approval",
    tokens: "/swap/tokens",
    sources: "/swap/sources",
    chains: "/swap/chains",
    limits: "/limits",
} as const;

export const UNISWAPX_REST = {
    /** Read-only order book. */
    read: "https://api.uniswap.org/v2",
    /** Order creation. Gasless; the signed permit is the request body. */
    submit: "https://trade-api.gateway.uniswap.org/v1/order",
    quote: "/v1/quote",
} as const;

export const ONEINCH_FUSION_REST = {
    /** Cross-chain (Fusion+). Returns no body; poll order status by hash. */
    crossChain: "https://api.1inch.com/fusion-plus",
    submit: "/v1.2/submit",
    status: "/v1.2/order/status",
} as const;

/**
 * A single structural fact that decides whether Eswap can settle a venue with
 * its existing `EswapSettlement.fill(orderId, originData, fillerData)`.
 *
 * Only Across fits, and only because Eswap is the DESTINATION settler the
 * relayer calls (not because it implements Across's deprecated 7683 path).
 * UniswapX needs `IReactor.execute`, 1inch needs escrow `withdraw`.
 */
export type DestinationSettlementModel = "erc7683-fill" | "reactor-execute" | "escrow-withdraw" | "lop-postinteraction";

export const SETTLEMENT_MODEL: Readonly<Record<"cow" | "uniswapx" | "across" | "oneinchfusion", DestinationSettlementModel>> = {
    cow: "erc7683-fill",
    across: "erc7683-fill",
    uniswapx: "reactor-execute",
    // EswapOneInchFusionSettlement fills genuine 1inch Limit Order Protocol
    // orders via fillOrderArgs and settles in IPostInteraction.postInteraction.
    // That is CLASSIC Fusion. Fusion+ (cross-chain) instead withdraws from a
    // hashlock/timelock escrow, which is a different model and is NOT
    // implemented — flip this to "escrow-withdraw" only if that settler is built.
    oneinchfusion: "lop-postinteraction",
} as const;
