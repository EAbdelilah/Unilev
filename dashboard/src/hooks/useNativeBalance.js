import { useCallback } from "react"
import { ethers } from "ethers"
import { useReadProvider } from "./useReadProvider"

export function useNativeBalance() {
    const readProvider = useReadProvider()

    const getNativeBalance = useCallback(async (user) => {
        if (!readProvider) return null
        try {
            const bal = await readProvider.getBalance(user)
            return { balance: ethers.formatEther(bal), usdValue: "0.00" }
        } catch { return null }
    }, [readProvider])

    return { getNativeBalance }
}
