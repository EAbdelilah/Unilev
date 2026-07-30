import { useCallback } from "react"
import { ethers } from "ethers"
import { useAccount, useWalletClient } from "wagmi"
import EswapRouterABI from "../abis/EswapRouter.json"
import EswapMarginHookABI from "../abis/EswapMarginHook.json"
import PriceFeedL1ABI from "../abis/PriceFeedL1.json"
import supportedTokensByChain from "../config/supported_tokens.json"
import { useReadProvider } from "./useReadProvider"

const FALLBACK_CHAIN = "1301"
const POOL_FEE = 3000
const TICK_SPACING = 60

function sortCurrencies(c0, c1) {
    return c0.toLowerCase() < c1.toLowerCase() ? [c0, c1] : [c1, c0]
}

export function useV4Position() {
    const { address, chainId } = useAccount()
    const { data: walletClient } = useWalletClient()
    const readProvider = useReadProvider()

    const chainKey = String(chainId || FALLBACK_CHAIN)
    const tokens = supportedTokensByChain[chainKey] || supportedTokensByChain[FALLBACK_CHAIN] || {}
    const WETH_ADDR = tokens.WETH || "0x4200000000000000000000000000000000000006"
    const USDC_ADDR = tokens.USDC || "0x078D782b760474a361dDA0AF3839290b0EF57AD6"

    const ADDRESSES = {
        V4_ROUTER: process.env.NEXT_PUBLIC_V4_ROUTER_ADDRESS || "",
        V4_HOOK: process.env.NEXT_PUBLIC_V4_HOOK_ADDRESS || "",
        PRICEFEEDL1: process.env.NEXT_PUBLIC_PRICEFEEDL1_ADDRESS || "",
    }

    function buildPoolKey(hookAddress) {
        const [currency0, currency1] = sortCurrencies(WETH_ADDR, USDC_ADDR)
        return { currency0, currency1, fee: POOL_FEE, tickSpacing: TICK_SPACING, hooks: hookAddress }
    }

    function computePoolId(hookAddress) {
        const [c0, c1] = sortCurrencies(WETH_ADDR, USDC_ADDR)
        return ethers.keccak256(
            ethers.AbiCoder.defaultAbiCoder().encode(
                ["address", "address", "uint24", "int24", "address"],
                [c0, c1, POOL_FEE, TICK_SPACING, hookAddress]
            )
        )
    }

    const getSigner = useCallback(async () => {
        if (!walletClient || typeof window === "undefined" || !window.ethereum) return null
        return await new ethers.BrowserProvider(window.ethereum).getSigner()
    }, [walletClient])

    const openV4Position = useCallback(async (currency0, currency1, isShort, amount, leverage, slippageBps = 50, deadlineMinutes = 20) => {
        if (!ADDRESSES.V4_ROUTER) throw new Error("V4 Router address not configured")
        const signer = await getSigner()
        if (!signer) throw new Error("Wallet not connected")

        const router = new ethers.Contract(ADDRESSES.V4_ROUTER, EswapRouterABI.abi, signer)
        const key = buildPoolKey(ADDRESSES.V4_HOOK)

        const hookData = ethers.AbiCoder.defaultAbiCoder().encode(
            ["bool", "uint8", "address"], [true, leverage, address]
        )

        const zeroForOne = !isShort
        let amountOutMin = BigInt(0)
        if (readProvider && ADDRESSES.PRICEFEEDL1) {
            try {
                const feed = new ethers.Contract(ADDRESSES.PRICEFEEDL1, PriceFeedL1ABI.abi, readProvider)
                const collateralToken = zeroForOne ? currency0 : currency1
                const outputToken = zeroForOne ? currency1 : currency0
                const collateralUsd = await feed.getAmountInUsd(collateralToken, BigInt(amount))
                if (collateralUsd > 0n) {
                    const oneUnit = BigInt(10) ** BigInt(18)
                    const outputUsdPerUnit = await feed.getAmountInUsd(outputToken, oneUnit)
                    if (outputUsdPerUnit > 0n) {
                        const expectedOutput = (collateralUsd * oneUnit) / outputUsdPerUnit
                        amountOutMin = expectedOutput * BigInt(10000 - slippageBps) / BigInt(10000)
                    }
                }
            } catch {}
        }

        const deadline = Math.floor(Date.now() / 1000) + deadlineMinutes * 60

        return await router.swap({
            key, zeroForOne,
            amountSpecified: -BigInt(amount),
            leverage: leverage,
            trader: address,
            amountOutMin, deadline, hookData
        })
    }, [getSigner, address, readProvider, chainId])

    const getAmountInUsd = useCallback(async (token, amount) => {
        if (!readProvider || !ADDRESSES.PRICEFEEDL1) return 0n
        const feed = new ethers.Contract(ADDRESSES.PRICEFEEDL1, PriceFeedL1ABI.abi, readProvider)
        try { return await feed.getAmountInUsd(token, amount) } catch { return 0n }
    }, [readProvider])

    const getPositionsCount = useCallback(async () => {
        if (!readProvider || !ADDRESSES.V4_HOOK || !address) return 0n
        const hook = new ethers.Contract(ADDRESSES.V4_HOOK, EswapMarginHookABI.abi, readProvider)
        try {
            const pos = await hook.positions(computePoolId(ADDRESSES.V4_HOOK), address)
            return pos.collateralAmount > 0n ? 1n : 0n
        } catch { return 0n }
    }, [readProvider, address])

    const getPositionDetails = useCallback(async (id, userAddress) => {
        if (!readProvider || !ADDRESSES.V4_HOOK || !userAddress) return null
        const hook = new ethers.Contract(ADDRESSES.V4_HOOK, EswapMarginHookABI.abi, readProvider)
        try {
            const poolId = computePoolId(ADDRESSES.V4_HOOK)
            const pos = await hook.positions(poolId, userAddress)
            if (pos.collateralAmount === 0n) return null

            const isLong = pos.isLong
            const [c0, c1] = sortCurrencies(WETH_ADDR, USDC_ADDR)
            const collateralAddr = isLong ? c0 : c1
            const tokenNameMap = { [WETH_ADDR.toLowerCase()]: "WETH", [USDC_ADDR.toLowerCase()]: "USDC" }
            const collateralSymbol = tokenNameMap[collateralAddr.toLowerCase()] || "UNKNOWN"
            const collateralDecimals = collateralSymbol === "USDC" ? 6 : 18

            return {
                id: "V4-" + userAddress.slice(2, 6),
                owner: pos.trader, collateral: pos.collateralAmount, borrowed: pos.borrowedAmount,
                leverage: pos.leverage.toString(), isShort: !pos.isLong, state: "ACTIVE",
                size: ethers.formatUnits(pos.collateralAmount, collateralDecimals),
                sizeUsd: "0.00", pnl: "0", pnlUsd: "0.00", pnlIsPositive: true,
                entryPrice: "0", currentPrice: "0", baseSymbol: collateralSymbol, quoteSymbol: "USDC"
            }
        } catch { return null }
    }, [readProvider, chainId])

    const closePosition = useCallback(async (id) => {
        const signer = await getSigner()
        if (!signer) throw new Error("Wallet not connected")

        if (!id.startsWith("V4-")) return null
        if (!ADDRESSES.V4_ROUTER) throw new Error("V4 Router address not configured")

        const router = new ethers.Contract(ADDRESSES.V4_ROUTER, EswapRouterABI.abi, signer)
        return await router.closePosition(ADDRESSES.V4_HOOK, buildPoolKey(ADDRESSES.V4_HOOK), address, 0)
    }, [getSigner, address, chainId])

    return { openV4Position, getAmountInUsd, getPositionsCount, getPositionDetails, closePosition: closePosition }
}
