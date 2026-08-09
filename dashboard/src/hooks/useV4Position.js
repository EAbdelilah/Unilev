import { useCallback, useMemo } from "react"
import { ethers } from "ethers"
import { useAccount, useWalletClient } from "wagmi"
import EswapRouterABI from "../abis/EswapRouter.json"
import EswapMarginHookABI from "../abis/EswapMarginHook.json"
import PriceFeedABI from "../abis/PriceFeed.json"
import PerpLedgerABI from "../abis/PerpLedger.json"
import ERC20ABI from "../abis/ERC20.json"
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
        V4_PERP_LEDGER: process.env.NEXT_PUBLIC_V4_PERP_LEDGER_ADDRESS || "",
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

    const getHookPosition = useCallback(
        async (userAddress) => {
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
        },
        [readProvider, address]
    )

    const getLedgerPosition = useCallback(
        async (userAddress) => {
            const trader = userAddress || address
            if (!readProvider || !ADDRESSES.V4_PERP_LEDGER || !trader) return null
            const ledger = new ethers.Contract(
                ADDRESSES.V4_PERP_LEDGER,
                PerpLedgerABI.abi,
                readProvider
            )
            try {
                const pos = await ledger.positions(trader)
                if (!pos.active) return null

                const [baseToken, marginToken] = await Promise.all([
                    ledger.baseToken(),
                    ledger.marginToken(),
                ])
                const priceFeed = new ethers.Contract(
                    ADDRESSES.V4_PRICEFEED,
                    PriceFeedABI.abi,
                    readProvider
                )

                let currentPrice = 0n
                let liquidatable = false
                try {
                    const [twap, liq] = await Promise.all([
                        priceFeed.getTwapPrice(baseToken),
                        ledger.isLiquidatable(trader),
                    ])
                    currentPrice = BigInt(twap || 0n)
                    liquidatable = Boolean(liq)
                } catch {
                    // TWAP feed or liquidity check unavailable — show position without price
                }

                const entry = BigInt(pos.entryPrice)
                const size = BigInt(pos.size)
                let delta = 0n
                if (pos.isLong) {
                    delta = currentPrice > entry ? currentPrice - entry : -(entry - currentPrice)
                } else {
                    delta = entry > currentPrice ? entry - currentPrice : -(currentPrice - entry)
                }
                const pnlUsd = (delta * size) / 10n ** 18n
                const pnlIsPositive = pnlUsd >= 0n
                const absPnlUsd = pnlIsPositive ? pnlUsd : -pnlUsd

                // Token-denominated PnL for the shared card (pnlUsd / currentPrice)
                const pnlTokens =
                    currentPrice > 0n ? ethers.formatUnits(absPnlUsd / currentPrice, 18) : "0"

                let baseSymbol = "BASE"
                let quoteSymbol = "USD"
                try {
                    const baseErc20 = new ethers.Contract(baseToken, ERC20ABI.abi, readProvider)
                    const marginErc20 = new ethers.Contract(marginToken, ERC20ABI.abi, readProvider)
                    const [bSym, qSym] = await Promise.all([
                        baseErc20.symbol(),
                        marginErc20.symbol(),
                    ])
                    baseSymbol = bSym
                    quoteSymbol = qSym
                } catch {
                    // Symbols unavailable — fall back to placeholders
                }

                const leverage =
                    BigInt(pos.marginUsd) > 0n
                        ? (BigInt(pos.notionalUsd) / BigInt(pos.marginUsd)).toString()
                        : "1"

                return {
                    id: "LEDGER-" + trader.slice(2, 6),
                    owner: trader,
                    state: liquidatable ? "LIQUIDATABLE" : "ACTIVE",
                    isShort: !pos.isLong,
                    leverage,
                    size: ethers.formatUnits(pos.size, 18),
                    sizeUsd: parseFloat(ethers.formatUnits(pos.notionalUsd, 18)).toFixed(2),
                    pnl: pnlTokens,
                    pnlUsd: parseFloat(ethers.formatUnits(absPnlUsd, 18)).toFixed(2),
                    pnlIsPositive,
                    entryPrice: ethers.formatUnits(pos.entryPrice, 18),
                    currentPrice: ethers.formatUnits(currentPrice, 18),
                    baseSymbol,
                    quoteSymbol,
                    marginUsd: ethers.formatUnits(pos.marginUsd, 18),
                    notionalUsd: ethers.formatUnits(pos.notionalUsd, 18),
                    liquidatable,
                }
            } catch {
                return null
            }
        },
        [readProvider, address]
    )

    const getPositionsCount = useCallback(async () => {
        if (!readProvider || !address) return 0n
        const [hookPos, ledgerPos] = await Promise.all([
            getHookPosition(address),
            getLedgerPosition(address),
        ])
        const combined = (hookPos ? 1 : 0) + (ledgerPos ? 1 : 0)
        // PositionsList iterates `i < maxId`, so return combined + 1 to cover both
        // position sources (each id beyond combined simply resolves to null).
        return combined > 0 ? BigInt(combined + 1) : 0n
    }, [readProvider, address, getHookPosition, getLedgerPosition])

    const getPositionDetails = useCallback(
        async (id, userAddress) => {
            const trader = userAddress || address
            if (!readProvider || !trader) return null

            const ledgerPos = await getLedgerPosition(trader)
            if (String(id) === "2") return ledgerPos

            const hookPos = await getHookPosition(trader)
            return hookPos || ledgerPos
        },
        [readProvider, address, getHookPosition, getLedgerPosition]
    )

    const closePosition = useCallback(
        async (id) => {
            if (typeof id === "string" && id.startsWith("LEDGER-")) {
                const signer = await getSigner()
                if (!signer) throw new Error("Wallet not connected")
                if (!ADDRESSES.V4_PERP_LEDGER) throw new Error("Perp Ledger address not configured")
                const ledger = new ethers.Contract(
                    ADDRESSES.V4_PERP_LEDGER,
                    PerpLedgerABI.abi,
                    signer
                )
                return await ledger.settle(0, ethers.MaxUint256)
            }
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

    return {
        openV4Position,
        simulateV4Position,
        getAmountInUsd,
        getPositionsCount,
        getPositionDetails,
        closePosition,
        ADDRESSES,
        tokens,
        WETH_ADDR,
        USDC_ADDR,
        SUPPORTED_TOKENS_LIST,
    }
}
