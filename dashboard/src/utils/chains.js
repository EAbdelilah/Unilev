export const POLYGON_CHAIN_ID = 137
export const UNICHAIN_CHAIN_ID = 130
export const UNICHAIN_SEPOLIA_CHAIN_ID = 1301
export const BASE_CHAIN_ID = 8453

// Base first: it is where the live V4 stack is deployed, so it is the default
// network the app targets before a wallet is connected.
export const SUPPORTED_CHAIN_IDS = [
    BASE_CHAIN_ID,
    POLYGON_CHAIN_ID,
    UNICHAIN_CHAIN_ID,
    UNICHAIN_SEPOLIA_CHAIN_ID,
]

export function isPolygonChain(chainId) {
    return chainId === POLYGON_CHAIN_ID
}

export function isUnichainChain(chainId) {
    return chainId === UNICHAIN_CHAIN_ID || chainId === UNICHAIN_SEPOLIA_CHAIN_ID
}

export function isBaseChain(chainId) {
    return chainId === BASE_CHAIN_ID
}

// Base is the live V4 deployment, so it is also the label shown before a
// wallet reports its chain.
export function chainName(chainId) {
    if (isPolygonChain(chainId)) return "Polygon"
    if (chainId === UNICHAIN_CHAIN_ID) return "Unichain"
    if (chainId === UNICHAIN_SEPOLIA_CHAIN_ID) return "Unichain Sepolia"
    return "Base"
}
