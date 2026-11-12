import {
    BASE_CHAIN_ID,
    POLYGON_CHAIN_ID,
    UNICHAIN_CHAIN_ID,
    UNICHAIN_SEPOLIA_CHAIN_ID,
} from "./chains"

// Public, unkeyed endpoints. `javascript/update-dashboard.js` writes these
// `NEXT_PUBLIC_*` values, but each has a working default so a missing env var
// degrades to a public RPC instead of a null provider.
const PUBLIC_RPC = {
    [BASE_CHAIN_ID]: "https://mainnet.base.org",
    [POLYGON_CHAIN_ID]: "https://polygon-rpc.com",
    [UNICHAIN_CHAIN_ID]: "https://mainnet.unichain.org",
    [UNICHAIN_SEPOLIA_CHAIN_ID]: "https://sepolia.unichain.org",
}

/**
 * Resolves the RPC endpoint for `chainId`, falling back to Base (the chain the
 * live V4 stack runs on) when the chain is unknown or the wallet is not yet
 * connected.
 *
 * Reads `process.env` with static member expressions on purpose: Next.js only
 * inlines `NEXT_PUBLIC_*` values it can see literally at build time, so a
 * dynamic `process.env[name]` lookup would be `undefined` in the browser.
 */
export function rpcUrlForChain(chainId) {
    const id = Number(chainId) || BASE_CHAIN_ID
    switch (id) {
        case BASE_CHAIN_ID:
            return process.env.NEXT_PUBLIC_BASE_RPC_URL || PUBLIC_RPC[BASE_CHAIN_ID]
        case POLYGON_CHAIN_ID:
            return process.env.NEXT_PUBLIC_RPC_URL || PUBLIC_RPC[POLYGON_CHAIN_ID]
        case UNICHAIN_CHAIN_ID:
            return process.env.NEXT_PUBLIC_UNICHAIN_RPC_URL || PUBLIC_RPC[UNICHAIN_CHAIN_ID]
        case UNICHAIN_SEPOLIA_CHAIN_ID:
            return (
                process.env.NEXT_PUBLIC_UNICHAIN_SEPOLIA_RPC_URL ||
                PUBLIC_RPC[UNICHAIN_SEPOLIA_CHAIN_ID]
            )
        default:
            return process.env.NEXT_PUBLIC_BASE_RPC_URL || PUBLIC_RPC[BASE_CHAIN_ID]
    }
}
