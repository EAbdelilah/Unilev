import { useMemo } from "react"
import { ethers } from "ethers"

export function useReadProvider() {
    return useMemo(() => {
        const rpcUrl = process.env.NEXT_PUBLIC_UNICHAIN_RPC_URL || process.env.NEXT_PUBLIC_RPC_URL
        if (!rpcUrl) return null
        return new ethers.JsonRpcProvider(rpcUrl)
    }, [])
}
