/**
 * scripts/lib/venueConfig.ts
 * Env-driven configuration for the supply-side venue registry.
 * =================================================================
 * Every venue address / endpoint is OPT-IN. Nothing here is hard-coded to a
 * mainnet address, because a settlement proxy on the whitelist is invoked with
 * the FULL swap notional pre-approved: a wrong or stale address is a direct
 * fund-loss vector rather than a failed swap.
 *
 * A venue with no address configured resolves to `configured: false` with a
 * `missing` reason, and the registry refuses to route to it. Deploy scripts
 * mirror this by whitelisting only what is present and logging the rest as
 * PENDING, so a partial rollout fails loudly instead of silently no-op'ing.
 *
 * Env slots (all optional — see .env.example):
 *   COW_SETTLEMENT_ADDRESS / COW_API_URL
 *   UNISWAPX_REACTOR_ADDRESS / UNISWAPX_PERMIT2_ADDRESS / UNISWAPX_API_URL
 *   ACROSS_SPOKE_POOL_ADDRESS  / ACROSS_API_URL
 *   ONEINCH_FUSION_SETTLEMENT_ADDRESS / ONEINCH_FUSION_API_URL
 */
import type { Address } from "viem";
import type { DestinationSettlementModel } from "./protocols.js";
import type { SupplyVenue, SupplyVenueId, SupplyVenueInfo } from "./venues.js";

/** One venue's configured endpoints/addresses plus its wiring requirements. */
export interface VenueConfig {
    readonly id: SupplyVenueId;
    readonly label: string;
    readonly settlement?: Address;
    /** HTTP orderbook/quote endpoint, when the venue exposes one. */
    readonly apiUrl?: string;
    /** Extra contract addresses needed by the venue's direct-fill path. */
    readonly extraAddresses: Readonly<Record<string, Address>>;
    readonly onChainSettlement: boolean;
    readonly settlementModel: DestinationSettlementModel;
    readonly settler: "wired" | "missing";
    readonly docs: string;
}

function loadEnv(name: string): string | undefined {
    const value = process.env[name];
    return value === undefined || value.trim() === "" ? undefined : value.trim();
}

/** Validates an EVM address literal, returning undefined when absent/blank. */
function loadAddress(name: string): Address | undefined {
    const value = loadEnv(name);
    if (value === undefined) return undefined;
    if (!/^0x[0-9a-fA-F]{40}$/.test(value)) {
        throw new Error(`Invalid address in ${name}: ${value} (expected 0x + 40 hex chars)`);
    }
    return value as Address;
}

function loadUrl(name: string): string | undefined {
    const value = loadEnv(name);
    if (value === undefined) return undefined;
    try {
        return new URL(value).toString();
    } catch {
        throw new Error(`Invalid URL in ${name}: ${value}`);
    }
}

interface VenueSpec {
    readonly id: SupplyVenueId;
    readonly label: string;
    readonly settlementEnv?: string;
    readonly apiEnv?: string;
    readonly extraEnv?: Readonly<Record<string, string>>;
    readonly onChainSettlement: boolean;
    readonly docs: string;
    /**
     * How this venue's relayer actually lands the fill on-chain. This is NOT
     * uniform across venues and is the single most important fact about them:
     * only venues speaking `erc7683-fill` can be served by Eswap's existing
     * `EswapSettlement.fill(orderId, originData, fillerData)`.
     */
    readonly settlementModel: DestinationSettlementModel;
    /**
     * Whether a settler contract speaking `settlementModel` exists in this repo
     * and is wired by the deploy scripts.
     *   "wired"    - deployed + solver-whitelisted, fill can execute
     *   "missing"  - no settler for this model exists yet, venue cannot fill
     */
    readonly settler: "wired" | "missing";
}

export type { VenueSpec };

/**
 * Single source of truth for the supply side. Order here is the readiness
 * report order and the registry iteration order.
 */
export const VENUE_SPECS: readonly VenueSpec[] = [
    {
        id: "cow",
        label: "CoW Protocol",
        settlementEnv: "COW_SETTLEMENT_ADDRESS",
        apiEnv: "COW_API_URL",
        onChainSettlement: true,
        settlementModel: "erc7683-fill",
        settler: "wired",
        docs: "https://docs.cow.fi",
    },
    {
        id: "uniswapx",
        label: "UniswapX",
        settlementEnv: "UNISWAPX_SETTLEMENT_ADDRESS",
        apiEnv: "UNISWAPX_API_URL",
        extraEnv: {
            reactor: "UNISWAPX_REACTOR_ADDRESS",
            permit2: "UNISWAPX_PERMIT2_ADDRESS",
        },
        onChainSettlement: true,
        // Fills land via IReactor.execute(SignedOrder), not an ERC-7683 fill, so
        // EswapSettlement cannot serve this venue. On Unichain only Dutch_V3 and
        // Priority reactors are deployed; Dutch/Dutch_V2 map to the zero address.
        settlementModel: "reactor-execute",
        settler: "wired",
        docs: "https://docs.uniswap.org/contracts/uniswapx/overview",
    },
    {
        id: "across",
        label: "Across Relayers",
        settlementEnv: "ACROSS_SETTLEMENT_ADDRESS",
        apiEnv: "ACROSS_API_URL",
        extraEnv: { spokePool: "ACROSS_SPOKE_POOL_ADDRESS" },
        onChainSettlement: true,
        // Across's own ERC-7683 fill is v1/DEPRECATED. Eswap is the destination
        // settler the relayer calls after bridging the notional in, so the
        // generic EswapSettlement applies and the Sepolia deploy whitelists it.
        settlementModel: "erc7683-fill",
        settler: "wired",
        docs: "https://docs.across.to",
    },
    {
        id: "oneinchfusion",
        label: "1inch Fusion",
        settlementEnv: "ONEINCH_FUSION_SETTLEMENT_ADDRESS",
        apiEnv: "ONEINCH_FUSION_API_URL",
        onChainSettlement: true,
        // Fills land by withdrawing from a hashlock/timelock escrow
        // (withdraw(secret, immutables)), not an ERC-7683 fill.
        settlementModel: "lop-postinteraction",
        settler: "wired",
        docs: "https://docs.1inch.io/1inchswap-api/fusion",
    },
] as const;

/** Resolves one venue's config, collecting which required slots are missing. */
export function resolveVenueConfig(spec: VenueSpec): { config: VenueConfig; missing: string[] } {
    const missing: string[] = [];
    const settlement = spec.settlementEnv === undefined ? undefined : loadAddress(spec.settlementEnv);
    if (spec.settlementEnv !== undefined && settlement === undefined) {
        missing.push(spec.settlementEnv);
    }
    const apiUrl = spec.apiEnv === undefined ? undefined : loadUrl(spec.apiEnv);
    if (spec.apiEnv !== undefined && apiUrl === undefined) {
        missing.push(spec.apiEnv);
    }
    const extraAddresses: Record<string, Address> = {};
    for (const [key, envName] of Object.entries(spec.extraEnv ?? {})) {
        const addr = loadAddress(envName);
        if (addr === undefined) {
            missing.push(envName);
        } else {
            extraAddresses[key] = addr;
        }
    }
    return {
        config: {
            id: spec.id,
            label: spec.label,
            ...(settlement === undefined ? {} : { settlement }),
            ...(apiUrl === undefined ? {} : { apiUrl }),
            extraAddresses,
            onChainSettlement: spec.onChainSettlement,
            settlementModel: spec.settlementModel,
            settler: spec.settler,
            docs: spec.docs,
        },
        missing,
    };
}

/** Loads every venue's config. Never throws for absent slots; only malformed values. */
export function loadVenueConfigs(): Map<SupplyVenueId, VenueConfig> {
    const out = new Map<SupplyVenueId, VenueConfig>();
    for (const spec of VENUE_SPECS) {
        out.set(spec.id, resolveVenueConfig(spec).config);
    }
    return out;
}

/** Readiness view of a venue, used by the registry and the CLI report. */
export function describeVenue(spec: VenueSpec): SupplyVenueInfo {
    const { config, missing } = resolveVenueConfig(spec);
    return {
        id: config.id,
        label: config.label,
        ...(config.settlement === undefined ? {} : { settlement: config.settlement }),
        configured: missing.length === 0,
        missing,
        onChainSettlement: config.onChainSettlement,
        settlementModel: config.settlementModel,
        settler: config.settler,
        docs: config.docs,
    };
}

/** Readiness view of every registered venue, in registry order. */
export function describeAllVenues(): SupplyVenueInfo[] {
    return VENUE_SPECS.map(describeVenue);
}

/** True when a venue is routable given the current environment. */
export function isVenueConfigured(id: SupplyVenueId): boolean {
    const spec = VENUE_SPECS.find((s) => s.id === id);
    if (spec === undefined) return false;
    return describeVenue(spec).configured;
}

export type { SupplyVenue };
