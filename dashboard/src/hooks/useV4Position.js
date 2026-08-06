import { useCallback, useMemo } from "react"
import { ethers } from "ethers"
import { useAccount, useWalletClient } from "wagmi"
import EswapRouterABI from "../abis/EswapRouter.json"
import EswapMarginHookABI from "../abis/EswapMarginHook.json"
import PriceFeedABI from "../abis/PriceFeed.json"
import ArbunPutOptionABI from "../abis/ArbunPutOption.json"
import supportedTokensByChain from "../config/supported_tokens.json"
import { useReadProvider } from "./useReadProvider"

const FALLBACK_CHAIN = "1301"
const POOL_FEE = 3000
const STANDARD_POOL_FEE = 0
const TICK_SPACING = 60

function sortCurrencies(c0, c1) {
    return c0.toLowerCase() < c1.toLowerCase() ? [c0, c1] : [c1, c0]
}

export function useV4Position() {
    const { address, chainId } = useAccount()
    const { data: walletClient } = useWalletClient()
    const readProvider = useReadProvider()

    const chainKey = String(chainId || FALLBACK_CHAIN)
    const tokens = useMemo(
        () => supportedTokensByChain[chainKey] || supportedTokensByChain[FALLBACK_CHAIN] || {},
        [chainKey]
    )
    const WETH_ADDR = tokens.WETH || "0x4200000000000000000000000000000000000006"
    const USDC_ADDR = tokens.USDC || "0x078D782b760474a361dDA0AF3839290b0EF57AD6"

    const ADDRESSES = {
        V4_ROUTER: process.env.NEXT_PUBLIC_V4_ROUTER_ADDRESS || "",
        V4_HOOK: process.env.NEXT_PUBLIC_V4_HOOK_ADDRESS || "",
        V4_PRICEFEED:
            process.env.NEXT_PUBLIC_V4_PRICEFEED_ADDRESS ||
            process.env.NEXT_PUBLIC_PRICEFEEDL1_ADDRESS ||
            "",
        V4_ARBUN_PUT_OPTION:
            process.env.NEXT_PUBLIC_V4_ARBUN_PUT_OPTION_ADDRESS ||
            "0x4830000000000000000000000000000000000010",
    }

    const SUPPORTED_TOKENS_LIST = useMemo(() => {
        const list = []
        if (WETH_ADDR) list.push({ key: "WETH", name: "WETH", address: WETH_ADDR })
        if (USDC_ADDR) list.push({ key: "USDC", name: "USDC", address: USDC_ADDR })
        return list
    }, [WETH_ADDR, USDC_ADDR])

    function buildPoolKey(hookAddress) {
        const [currency0, currency1] = sortCurrencies(WETH_ADDR, USDC_ADDR)
        return {
            currency0,
            currency1,
            fee: POOL_FEE,
            tickSpacing: TICK_SPACING,
            hooks: hookAddress,
        }
    }

    // Standard (physical execution) pool: same currency ordering as the hook pool,
    // $0 fees, no hook. The router executes the leveraged physical swap here.
    function buildStandardPoolKey() {
        const [currency0, currency1] = sortCurrencies(WETH_ADDR, USDC_ADDR)
        return {
            currency0,
            currency1,
            fee: STANDARD_POOL_FEE,
            tickSpacing: TICK_SPACING,
            hooks: ethers.ZeroAddress,
        }
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

    // Builds the router.swap() params. WETH is the pool's base token (set via
    // hook.setBaseCurrency), so a LONG buys WETH and a SHORT sells WETH:
    //   LONG  → zeroForOne = !wethIsCurrency0   (Unichain: sell USDC, buy WETH)
    //   SHORT → zeroForOne =  wethIsCurrency0   (Unichain: sell WETH, buy USDC)
    const buildSwapParams = useCallback(
        (isShort, amount, leverage, hookAddress) => {
            const key = buildPoolKey(hookAddress)
            const wethIsCurrency0 = WETH_ADDR.toLowerCase() === key.currency0.toLowerCase()
            const zeroForOne = isShort ? wethIsCurrency0 : !wethIsCurrency0
            const hookData = ethers.AbiCoder.defaultAbiCoder().encode(
                ["bool", "uint8", "address"],
                [true, leverage, address]
            )
            return { key, standardPoolKey: buildStandardPoolKey(), zeroForOne, amountSpecified: -amount, leverage, hookData }
        },
        [WETH_ADDR, address, buildStandardPoolKey]
    )

    const openV4Position = useCallback(
        async (isShort, amount, leverage) => {
            if (!ADDRESSES.V4_ROUTER) throw new Error("V4 Router address not configured")
            const signer = await getSigner()
            if (!signer) throw new Error("Wallet not connected")

            const router = new ethers.Contract(ADDRESSES.V4_ROUTER, EswapRouterABI.abi, signer)
            const params = buildSwapParams(isShort, amount, leverage, ADDRESSES.V4_HOOK)
            return await router.swap(params)
        },
        [getSigner, buildSwapParams]
    )

    const simulateV4Position = useCallback(
        async (isShort, amount, leverage) => {
            const signer = await getSigner()
            if (!signer) throw new Error("Wallet not connected")
            const router = new ethers.Contract(ADDRESSES.V4_ROUTER, EswapRouterABI.abi, signer)
            const params = buildSwapParams(isShort, amount, leverage, ADDRESSES.V4_HOOK)
            try {
                await router.swap.staticCall(params)
                return { success: true }
            } catch (e) {
                return { success: false, error: e }
            }
        },
        [getSigner, buildSwapParams]
    )

    const getAmountInUsd = useCallback(async (token, amount) => {
        if (!readProvider || !ADDRESSES.V4_PRICEFEED) return 0n
        const feed = new ethers.Contract(ADDRESSES.V4_PRICEFEED, PriceFeedABI.abi, readProvider)
        try {
            return await feed.getAmountInUsd(token, amount)
        } catch {
            return 0n
        }
    }, [readProvider])

    // Human "USDC per WETH" price from the hook's last recorded sqrtPriceX96.
    async function computeUsdcPerWeth(hook, poolId) {
        try {
            const sqrt = await hook.lastOraclePrice(poolId)
            if (!sqrt || sqrt === 0n) return "0"
            const raw = (sqrt * sqrt) / (1n << 192n)
            if (raw === 0n) return "0"
            const scaled = (BigInt(10) ** 30n) / raw
            return ethers.formatUnits(scaled, 18)
        } catch {
            return "0"
        }
    }

    const getPositionsCount = useCallback(async () => {
        if (!readProvider || !ADDRESSES.V4_HOOK || !address) return 0n
        const hook = new ethers.Contract(ADDRESSES.V4_HOOK, EswapMarginHookABI.abi, readProvider)
        try {
            const poolId = computePoolId(ADDRESSES.V4_HOOK)
            const pos = await hook.positions(poolId, address)
            return pos.collateralAmount > 0n ? 1n : 0n
        } catch {
            return 0n
        }
    }, [readProvider, address])

    const getPositionDetails = useCallback(async (id, userAddress) => {
        const trader = userAddress || address
        if (!readProvider || !ADDRESSES.V4_HOOK || !trader) return null
        const hook = new ethers.Contract(ADDRESSES.V4_HOOK, EswapMarginHookABI.abi, readProvider)
        try {
            const poolId = computePoolId(ADDRESSES.V4_HOOK)
            const pos = await hook.positions(poolId, trader)
            if (pos.collateralAmount === 0n) return null

            // isLong is anchored to the pool's base token (WETH via setBaseCurrency),
            // so a LONG holds WETH collateral and a SHORT holds USDC.
            const isLong = pos.isLong
            const collateralSymbol = isLong ? "WETH" : "USDC"
            const collateralDecimals = collateralSymbol === "USDC" ? 6 : 18
            const quoteSymbol = collateralSymbol === "WETH" ? "USDC" : "WETH"
            const currentPrice = await computeUsdcPerWeth(hook, poolId)

            return {
                id: "V4-" + trader.slice(2, 6),
                owner: pos.trader,
                collateral: pos.collateralAmount,
                borrowed: pos.borrowedAmount,
                leverage: pos.leverage.toString(),
                isShort: !isLong,
                state: "ACTIVE",
                size: ethers.formatUnits(pos.collateralAmount, collateralDecimals),
                sizeUsd: "0.00",
                pnl: "0",
                pnlUsd: "0.00",
                pnlIsPositive: true,
                entryPrice: currentPrice,
                currentPrice,
                baseSymbol: collateralSymbol,
                quoteSymbol,
            }
        } catch {
            return null
        }
    }, [readProvider, address])

    const closePosition = useCallback(
        async (id) => {
            if (!id || !id.startsWith("V4-")) return null
            const signer = await getSigner()
            if (!signer) throw new Error("Wallet not connected")
            if (!ADDRESSES.V4_ROUTER) throw new Error("V4 Router address not configured")

            const router = new ethers.Contract(ADDRESSES.V4_ROUTER, EswapRouterABI.abi, signer)
            return await router.closePosition(
                ADDRESSES.V4_HOOK,
                buildPoolKey(ADDRESSES.V4_HOOK),
                address,
                ethers.ZeroAddress,
                0
            )
        },
        [getSigner, address]
    )

    const openHalalShortOption = useCallback(
        async (underlyingToken, collateralToken, quantity, duration) => {
            const signer = await getSigner()
            if (!signer) throw new Error("Wallet not connected")
            const addr = ADDRESSES.V4_ARBUN_PUT_OPTION
            const contract = new ethers.Contract(addr, ArbunPutOptionABI.abi, signer)
            return await contract.openHalalShort(underlyingToken, collateralToken, quantity, duration)
        },
        [getSigner, ADDRESSES.V4_ARBUN_PUT_OPTION]
    )

    const exerciseHalalShortOption = useCallback(
        async (optionId) => {
            const signer = await getSigner()
            if (!signer) throw new Error("Wallet not connected")
            const addr = ADDRESSES.V4_ARBUN_PUT_OPTION
            const contract = new ethers.Contract(addr, ArbunPutOptionABI.abi, signer)
            return await contract.exerciseHalalShort(optionId)
        },
        [getSigner, ADDRESSES.V4_ARBUN_PUT_OPTION]
    )

    const cancelHalalShortOption = useCallback(
        async (optionId) => {
            const signer = await getSigner()
            if (!signer) throw new Error("Wallet not connected")
            const addr = ADDRESSES.V4_ARBUN_PUT_OPTION
            const contract = new ethers.Contract(addr, ArbunPutOptionABI.abi, signer)
            return await contract.cancelHalalShort(optionId)
        },
        [getSigner, ADDRESSES.V4_ARBUN_PUT_OPTION]
    )

    return {
        openV4Position,
        simulateV4Position,
        getAmountInUsd,
        getPositionsCount,
        getPositionDetails,
        closePosition,
        openHalalShortOption,
        exerciseHalalShortOption,
        cancelHalalShortOption,
        ADDRESSES,
        tokens,
        WETH_ADDR,
        USDC_ADDR,
        SUPPORTED_TOKENS_LIST,
    }
}
