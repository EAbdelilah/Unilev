/**
 * javascript/v4/realApis/demandVenues.js
 * Demand-side venue registry (aggregators) for Unichain (chain 130).
 * =================================================================
 *   [ DEMAND: AGGREGATORS ]  Enso · Odos · Bungee · Jumper · 1inch
 *               |
 *               v
 *   [ Eswap Protocol (Unichain) ]   router.setAllowedAggregator(proxy, true)
 *               |
 *               v
 *   [ SUPPLY: SOLVER NETWORKS ]  CoW · UniswapX · Across · 1inch Fusion
 *
 * The on-chain aggregator path is VENUE-AGNOSTIC: `EswapRouter` executes opaque
 * `callData` on an owner-whitelisted `exchangeProxy` via
 * `swapMultiPoolForAggregator`, measuring real output and reverting below
 * `minAmountOut`. So adding an aggregator here is purely a question of a
 * verified proxy address plus the `setAllowedAggregator` call — there is no
 * per-venue contract to write.
 *
 * SECURITY: whitelisting a proxy grants it a call carrying the FULL swap
 * notional (margin + borrow) pre-approved. A wrong or stale proxy address is
 * therefore a direct fund-loss vector. Every address below is loaded from env /
 * config and left `null` until verified. `deployAggregators.js` skips unset
 * venues and reports them as PENDING rather than failing or guessing.
 */
const CHAIN_ID = 130;

/** env var holding the verified proxy address for each demand venue. */
const DEMAND_VENUE_ENV = {
    enso: "AGG_ENSO_PROXY_ADDRESS",
    odos: "AGG_ODOS_PROXY_ADDRESS",
    bungee: "AGG_BUNGEE_PROXY_ADDRESS",
    jumper: "AGG_JUMPER_PROXY_ADDRESS",
    oneinch: "AGG_ONEINCH_ROUTER_ADDRESS",
};

/** label, off-chain quote API, and the integration style of each aggregator. */
const DEMAND_VENUES = [
    { id: "enso", label: "Enso", api: "https://api.enso.finance/api/v1/shortcuts/quote", style: "proxy" },
    { id: "odos", label: "Odos", api: "https://api.odos.xyz/api/v2/quote", style: "proxy+resolver" },
    { id: "bungee", label: "Bungee", api: "https://public-backend.socket.tech/v3/swap/quote", style: "proxy" },
    { id: "jumper", label: "Jumper (Li.Fi)", api: "https://li.quest/v1/quote", style: "proxy" },
    { id: "oneinch", label: "1inch Router", api: "https://api.1inch.dev/swap/v6.0/130/quote", style: "proxy" },
];

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

/** Reads a proxy address from env; null when absent. Throws when malformed. */
function proxyAddressOf(id) {
    const envName = DEMAND_VENUE_ENV[id];
    if (envName === undefined) throw new Error(`unknown demand venue: ${id}`);
    const raw = process.env[envName];
    if (raw === undefined || String(raw).trim() === "") return null;
    const value = String(raw).trim();
    if (!ADDRESS_RE.test(value)) {
        throw new Error(`Invalid address in ${envName}: ${value} (expected 0x + 40 hex chars)`);
    }
    return value;
}

/** Readiness view of every demand venue. Never throws for absent slots. */
function describeDemandVenues(env = process.env) {
    const previous = process.env;
    if (env !== process.env) process.env = env;
    try {
        return DEMAND_VENUES.map((venue) => {
            const proxy = proxyAddressOf(venue.id);
            return {
                ...venue,
                chainId: CHAIN_ID,
                proxy,
                configured: proxy !== null,
                missing: proxy === null ? [DEMAND_VENUE_ENV[venue.id]] : [],
            };
        });
    } finally {
        if (env !== process.env) process.env = previous;
    }
}

/** Only the venues that have a verified proxy, ready for setAllowedAggregator. */
function configuredAggregators(env = process.env) {
    return describeDemandVenues(env).filter((v) => v.configured);
}

module.exports = {
    CHAIN_ID,
    DEMAND_VENUES,
    DEMAND_VENUE_ENV,
    proxyAddressOf,
    describeDemandVenues,
    configuredAggregators,
};
