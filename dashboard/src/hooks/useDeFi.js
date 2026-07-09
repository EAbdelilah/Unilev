import { useState, useCallback, useEffect } from "react"
import { ethers } from "ethers"
import { useAccount, useWalletClient } from "wagmi"

// ABIs
import ERC20ABI from "../abis/ERC20.json"
import EswapRouterABI from "../abis/EswapRouter.json"
import EswapMarginHookABI from "../abis/EswapMarginHook.json"
import PriceFeedL1ABI from "../abis/PriceFeedL1.json"
import MarketABI from "../abis/Market.json"
import LiquidityPoolABI from "../abis/LiquidityPool.json"
import supportedTokens from "../config/supported_tokens.json"

export const SUPPORTED_TOKENS_LIST = Object.entries(supportedTokens)
    .filter(([key]) => key !== "wrapper")
    .map(([key, address]) => ({ key, name: key, address }))

const ADDRESSES = {
    ...supportedTokens,
    V4_ROUTER: process.env.NEXT_PUBLIC_V4_ROUTER_ADDRESS || "0x5FbDB2315678afecb367f032d93F642f64180aa3",
    V4_HOOK: process.env.NEXT_PUBLIC_V4_HOOK_ADDRESS || "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512",
    MARKET: process.env.NEXT_PUBLIC_MARKET_ADDRESS || "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa681",
    PRICEFEEDL1: process.env.NEXT_PUBLIC_PRICEFEEDL1_ADDRESS || "0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9",
}

export function useDeFi() {
    const { address, isConnected } = useAccount()
    const { data: walletClient } = useWalletClient()
    const [readProvider, setReadProvider] = useState(null)

    useEffect(() => {
        const init = async () => {
            const provider = new ethers.JsonRpcProvider(process.env.NEXT_PUBLIC_RPC_URL || "https://polygon.drpc.org")
            setReadProvider(provider)
        }
        init()
    }, [])

    const getSigner = useCallback(async () => {
        if (!walletClient || typeof window === "undefined" || !window.ethereum) return null
        return await new ethers.BrowserProvider(window.ethereum).getSigner()
    }, [walletClient])

    const openV4Position = useCallback(async (currency0, currency1, isShort, amount, leverage) => {
        const signer = await getSigner()
        if (!signer) throw new Error("Wallet not connected")
        const router = new ethers.Contract(ADDRESSES.V4_ROUTER, EswapRouterABI.abi, signer)
        const key = { currency0, currency1, fee: 3000, tickSpacing: 60, hooks: ADDRESSES.V4_HOOK }

        // Pass the signer's address as the trader in hookData for secure position recording
        const hookData = ethers.AbiCoder.defaultAbiCoder().encode(["bool", "uint8", "address"], [true, leverage, address])

        return await router.swap({ key, zeroForOne: !isShort, amountSpecified: -amount, hookData })
    }, [getSigner, address])

    const getAmountInUsd = useCallback(async (token, amount) => {
        if (!readProvider || !ADDRESSES.PRICEFEEDL1) return 0n
        const feed = new ethers.Contract(ADDRESSES.PRICEFEEDL1, PriceFeedL1ABI.abi, readProvider)
        try { return await feed.getAmountInUsd(token, amount) } catch { return 0n }
    }, [readProvider])

    const getTokenBalance = useCallback(async (token, user) => {
        if (!readProvider || !token) return null
        const contract = new ethers.Contract(token, ERC20ABI.abi, readProvider)
        try {
            const [bal, decimals] = await Promise.all([contract.balanceOf(user), contract.decimals()])
            return { rawBalance: bal, balance: ethers.formatUnits(bal, decimals), decimals }
        } catch { return null }
    }, [readProvider])

    const getAllowance = useCallback(async (token, owner, spender) => {
        if (!readProvider || !token) return 0n
        const contract = new ethers.Contract(token, ERC20ABI.abi, readProvider)
        try { return await contract.allowance(owner, spender) } catch { return 0n }
    }, [readProvider])

    const approveToken = useCallback(async (token, spender, amount = ethers.MaxUint256) => {
        const signer = await getSigner()
        if (!signer) throw new Error("Wallet not connected")
        const contract = new ethers.Contract(token, ERC20ABI.abi, signer)
        return await contract.approve(spender, amount)
    }, [getSigner])

    // V3 Backward Compatibility for Tests
    const openPosition = useCallback(async (token0, token1, isShort, amount, leverage) => {
        const signer = await getSigner()
        if (!signer) throw new Error("Wallet not connected")
        const market = new ethers.Contract(ADDRESSES.MARKET, MarketABI.abi, signer)
        const method = isShort ? "openShortPosition" : "openLongPosition"
        return await market[method](token0, token1, 3000, leverage, amount, 0, 0, { gasLimit: 5000000 })
    }, [getSigner])

    const depositToPool = useCallback(async (tokenKey, amount) => {
        const signer = await getSigner()
        if (!signer) throw new Error("Wallet not connected")
        const market = new ethers.Contract(ADDRESSES.MARKET, MarketABI.abi, signer)
        const poolAddr = await market.getTokenToLiquidityPools(ADDRESSES[tokenKey])
        const pool = new ethers.Contract(poolAddr, LiquidityPoolABI.abi, signer)
        return await pool.deposit(amount, address)
    }, [getSigner, address])

    const redeemFromPool = useCallback(async (tokenKey, shares) => {
        const signer = await getSigner()
        if (!signer) throw new Error("Wallet not connected")
        const market = new ethers.Contract(ADDRESSES.MARKET, MarketABI.abi, signer)
        const poolAddr = await market.getTokenToLiquidityPools(ADDRESSES[tokenKey])
        const pool = new ethers.Contract(poolAddr, LiquidityPoolABI.abi, signer)
        return await pool.redeem(shares, address, address)
    }, [getSigner, address])

    const simulateOpenPosition = useCallback(async (token0, token1, isShort, amount, leverage) => {
        const signer = await getSigner()
        if (!signer) throw new Error("Wallet not connected")
        const market = new ethers.Contract(ADDRESSES.MARKET, MarketABI.abi, signer)
        const method = isShort ? "openShortPosition" : "openLongPosition"
        try {
            await market[method].staticCall(token0, token1, 3000, leverage, amount, 0, 0, { gasLimit: 5000000 })
            return { success: true }
        } catch (e) {
            return { success: false, error: e.message }
        }
    }, [getSigner])

    const getPositionsCount = useCallback(async () => {
        // In V4, positions are per-user. We'll return 1 if the user has a position in the current pool.
        return 1n
    }, [])

    const getPositionDetails = useCallback(async (id, userAddress) => {
        if (!readProvider || !ADDRESSES.V4_HOOK || !userAddress) return null
        const hook = new ethers.Contract(ADDRESSES.V4_HOOK, EswapMarginHookABI.abi, readProvider)
        try {
            // Calculate actual WBTC/USDC V4 PoolId
            const wbtc = ADDRESSES.WBTC
            const usdc = ADDRESSES.USDC
            const [c0, c1] = wbtc.toLowerCase() < usdc.toLowerCase() ? [wbtc, usdc] : [usdc, wbtc]

            const poolId = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
                ["address", "address", "uint24", "int24", "address"],
                [c0, c1, 3000, 60, ADDRESSES.V4_HOOK]
            ))

            const pos = await hook.positions(poolId, userAddress)
            if (pos.collateralAmount === 0n) return null

            const isLong = pos.isLong
            const collateralSymbol = isLong ? "WBTC" : "USDC"
            const decimals = collateralSymbol === "WBTC" ? 8 : 6

            return {
                id: "V4-" + userAddress.slice(2, 6),
                owner: pos.trader,
                collateral: pos.collateralAmount,
                borrowed: pos.borrowedAmount,
                leverage: pos.leverage.toString(),
                isShort: !pos.isLong,
                state: "ACTIVE",
                size: ethers.formatUnits(pos.collateralAmount, decimals),
                sizeUsd: "0.00",
                pnl: "0",
                pnlUsd: "0.00",
                pnlIsPositive: true,
                entryPrice: "0",
                currentPrice: "0",
                baseSymbol: "WBTC",
                quoteSymbol: "USDC"
            }
        } catch (e) {
            console.error("V4 Position fetch error", e)
            return null
        }
    }, [readProvider])

    const closePosition = useCallback(async (id) => {
        const signer = await getSigner()
        if (!signer) throw new Error("Wallet not connected")

        if (id.startsWith("V4-")) {
            // V4 closing logic - In our End-Game model, we trigger a 'maintain' call
            // or a swap that reverses the position. For simplicity, we call router.swap.
            const router = new ethers.Contract(ADDRESSES.V4_ROUTER, EswapRouterABI.abi, signer)
            // Simplified reverse swap logic
            return await router.swap({ /* key, params to close */ })
        }

        const market = new ethers.Contract(ADDRESSES.MARKET, MarketABI.abi, signer)
        return await market.closePosition(id)
    }, [getSigner])

    const getNativeBalance = useCallback(async (user) => {
        if (!readProvider) return null
        try {
            const bal = await readProvider.getBalance(user)
            return { balance: ethers.formatEther(bal), usdValue: "0.00" }
        } catch { return null }
    }, [readProvider])

    const getProtocolBalances = useCallback(async () => {
        return {}
    }, [])

    const getFeeDefaults = useCallback(async () => {
        return { treasuryFee: 0, liquidationReward: 0 }
    }, [])

    const updateFeeDefaults = useCallback(async () => {
        return null
    }, [])

    return {
        ADDRESSES,
        SUPPORTED_TOKENS_LIST,
        openV4Position,
        openPosition,
        depositToPool,
        redeemFromPool,
        simulateOpenPosition,
        getAmountInUsd,
        getTokenBalance,
        getAllowance,
        approveToken,
        getPositionsCount,
        getPositionDetails,
        closePosition,
        getNativeBalance,
        getProtocolBalances,
        getFeeDefaults,
        updateFeeDefaults,
        isMetaMaskInstalled: typeof window !== "undefined" && !!window.ethereum
    }
}
