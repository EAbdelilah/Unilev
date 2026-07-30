import { useCallback } from "react"
import { ethers } from "ethers"
import { useWalletClient } from "wagmi"
import MarketABI from "../abis/Market.json"

const MARKET_ADDR = process.env.NEXT_PUBLIC_MARKET_ADDRESS || ""

export function useV3Position() {
    const { data: walletClient } = useWalletClient()

    const getSigner = useCallback(async () => {
        if (!walletClient || typeof window === "undefined" || !window.ethereum) return null
        return await new ethers.BrowserProvider(window.ethereum).getSigner()
    }, [walletClient])

    const openPosition = useCallback(async (token0, token1, isShort, amount, leverage) => {
        const signer = await getSigner()
        if (!signer) throw new Error("Wallet not connected")
        const market = new ethers.Contract(MARKET_ADDR, MarketABI.abi, signer)
        const method = isShort ? "openShortPosition" : "openLongPosition"
        return await market[method](token0, token1, 3000, leverage, amount, 0, 0, { gasLimit: 5000000 })
    }, [getSigner])

    const simulateOpenPosition = useCallback(async (token0, token1, isShort, amount, leverage) => {
        const signer = await getSigner()
        if (!signer) throw new Error("Wallet not connected")
        const market = new ethers.Contract(MARKET_ADDR, MarketABI.abi, signer)
        const method = isShort ? "openShortPosition" : "openLongPosition"
        try {
            await market[method].staticCall(token0, token1, 3000, leverage, amount, 0, 0, { gasLimit: 5000000 })
            return { success: true }
        } catch (e) {
            return { success: false, error: e.message }
        }
    }, [getSigner])

    const closePosition = useCallback(async (id) => {
        if (typeof id === "string" && id.startsWith("V4-")) return null
        const signer = await getSigner()
        if (!signer) throw new Error("Wallet not connected")
        const market = new ethers.Contract(MARKET_ADDR, MarketABI.abi, signer)
        return await market.closePosition(id)
    }, [getSigner])

    return { openPosition, simulateOpenPosition, closePosition }
}
