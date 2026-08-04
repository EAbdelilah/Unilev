export const POLYGON_CHAIN_ID = 137
export const UNICHAIN_CHAIN_ID = 130
export const UNICHAIN_SEPOLIA_CHAIN_ID = 1301

export const SUPPORTED_CHAIN_IDS = [
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
