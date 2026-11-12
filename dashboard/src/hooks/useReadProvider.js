import { useMemo } from "react"
import { ethers } from "ethers"
import { useAccount } from "wagmi"
import { rpcUrlForChain } from "../utils/rpc"

/**
 * Read-only provider for the wallet's chain. Falls back to Base (where the live
 * V4 stack runs) when no wallet is connected, so pre-connection reads hit the
 * chain the app actually trades on instead of a stale hardcoded RPC.
 */
export function useReadProvider() {
    const { chainId } = useAccount()
    return useMemo(() => {
        const rpcUrl = rpcUrlForChain(chainId)
        if (!rpcUrl) return null
        return new ethers.JsonRpcProvider(rpcUrl)
    }, [chainId])
}
