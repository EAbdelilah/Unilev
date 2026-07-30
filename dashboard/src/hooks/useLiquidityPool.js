import { useCallback } from "react"
import { ethers } from "ethers"
import { useAccount, useWalletClient } from "wagmi"
import MarketABI from "../abis/Market.json"
import LiquidityPoolABI from "../abis/LiquidityPool.json"
import supportedTokensByChain from "../config/supported_tokens.json"

const FALLBACK_CHAIN = "1301"
const MARKET_ADDR = process.env.NEXT_PUBLIC_MARKET_ADDRESS || ""

export function useLiquidityPool() {
    const { address, chainId } = useAccount()
    const { data: walletClient } = useWalletClient()
    const chainKey = String(chainId || FALLBACK_CHAIN)
    const tokens = supportedTokensByChain[chainKey] || supportedTokensByChain[FALLBACK_CHAIN] || {}

    const getSigner = useCallback(async () => {
        if (!walletClient || typeof window === "undefined" || !window.ethereum) return null
        return await new ethers.BrowserProvider(window.ethereum).getSigner()
    }, [walletClient])

    const depositToPool = useCallback(async (tokenKey, amount) => {
        const signer = await getSigner()
        if (!signer) throw new Error("Wallet not connected")
        const tokenAddr = tokens[tokenKey]
        if (!tokenAddr) throw new Error("Unknown token: " + tokenKey)
        const market = new ethers.Contract(MARKET_ADDR, MarketABI.abi, signer)
        const poolAddr = await market.getTokenToLiquidityPools(tokenAddr)
        const pool = new ethers.Contract(poolAddr, LiquidityPoolABI.abi, signer)
        return await pool.deposit(amount, address)
    }, [getSigner, address, chainId])

    const redeemFromPool = useCallback(async (tokenKey, shares) => {
        const signer = await getSigner()
        if (!signer) throw new Error("Wallet not connected")
        const tokenAddr = tokens[tokenKey]
        if (!tokenAddr) throw new Error("Unknown token: " + tokenKey)
        const market = new ethers.Contract(MARKET_ADDR, MarketABI.abi, signer)
        const poolAddr = await market.getTokenToLiquidityPools(tokenAddr)
        const pool = new ethers.Contract(poolAddr, LiquidityPoolABI.abi, signer)
        return await pool.redeem(shares, address, address)
    }, [getSigner, address, chainId])

    return { depositToPool, redeemFromPool }
}
