import { useCallback, useMemo } from "react"
import { ethers } from "ethers"
import { useAccount, useWalletClient } from "wagmi"
import EswapRouterABI from "../abis/EswapRouter.json"
import EswapMarginHookABI from "../abis/EswapMarginHook.json"
import PriceFeedABI from "../abis/PriceFeed.json"
import supportedTokensByChain from "../config/supported_tokens.json"
import { useReadProvider } from "./useReadProvider"
import { BASE_CHAIN_ID, isBaseChain } from "../utils/chains"

// Base is where the live V4 stack runs, so it is the fallback for reads that
// happen before a wallet is connected.
const FALLBACK_CHAIN = String(BASE_CHAIN_ID)
const POOL_FEE = 3000
const STANDARD_POOL_FEE = 500 // 0.05% — the deep no-hook standard (fill) pool the hook routes physical fills through; matches hook.setStandardPoolKey
const TICK_SPACING = 60
const STANDARD_TICK_SPACING = 10

function sortCurrencies(c0, c1) {
    return c0.toLowerCase() < c1.toLowerCase() ? [c0, c1] : [c1, c0]
}

const TOKEN_DECIMALS = { ETH: 18, WBTC: 8, WETH: 18, cbBTC: 8, USDC: 6 }

function poolIdFor(base, quote, hookAddress) {
    const [c0, c1] = sortCurrencies(base, quote)
    return ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
            ["address", "address", "uint24", "int24", "address"],
            [c0, c1, POOL_FEE, TICK_SPACING, hookAddress]
        )
    )
}

export function useV4Position() {
    const { address, chainId } = useAccount()
    const { data: walletClient } = useWalletClient()
    const readProvider = useReadProvider()

    const effectiveChainId = chainId || Number(FALLBACK_CHAIN)
    const chainKey = String(effectiveChainId)
    const isBase = isBaseChain(effectiveChainId)
    const tokens = useMemo(
        () => supportedTokensByChain[chainKey] || supportedTokensByChain[FALLBACK_CHAIN] || {},
        [chainKey]
    )
    const WETH_ADDR = tokens.WETH || "0x4200000000000000000000000000000000000006"
    const CBBTC_ADDR = tokens.cbBTC || "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf"
    const USDC_ADDR = tokens.USDC || "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
    const ETH_ADDR = tokens.ETH || "0x0000000000000000000000000000000000000000"
    const WBTC_ADDR = tokens.WBTC || "0x927B51f251480a681271180DA4de28D44EC4AfB8"

    const ADDRESSES = {
        V4_ROUTER: process.env.NEXT_PUBLIC_V4_ROUTER_ADDRESS || "",
        V4_HOOK: process.env.NEXT_PUBLIC_V4_HOOK_ADDRESS || "",
        V4_SOLVER: process.env.NEXT_PUBLIC_V4_SOLVER_ADDRESS || "",
        V4_PRICEFEED:
            process.env.NEXT_PUBLIC_V4_PRICEFEED_ADDRESS ||
            process.env.NEXT_PUBLIC_PRICEFEEDL1_ADDRESS ||
            "",
    }

    // Authorized hook pools (base token quoted in USDC). The base currency is
    // chain-specific:
    //   * Base (8453)    — WETH/USDC and cbBTC/USDC, both ERC-20 bases. cbBTC
    //                      sorts ABOVE USDC, so its long is zeroForOne=true.
    //   * Unichain (130) — native ETH/USDC, base = native ether (address 0x0),
    //                      the deepest pair there ($5.4M TVL via the 500/10
    //                      no-hook standard pool).
    // Keyed by the "trading asset" so the UI can name the pool.
    const V4_POOLS = useMemo(() => {
        const pools = []
        if (isBase) {
            if (WETH_ADDR) pools.push({ key: "WETH", base: WETH_ADDR, quote: USDC_ADDR })
            if (CBBTC_ADDR) pools.push({ key: "cbBTC", base: CBBTC_ADDR, quote: USDC_ADDR })
        } else if (ETH_ADDR) {
            pools.push({ key: "ETH", base: ETH_ADDR, quote: USDC_ADDR })
        }
        return pools
    }, [isBase, ETH_ADDR, WETH_ADDR, CBBTC_ADDR, USDC_ADDR])

    const SUPPORTED_TOKENS_LIST = useMemo(
        () => V4_POOLS.map((p) => ({ key: p.key, name: p.key, address: p.base })),
        [V4_POOLS]
    )

    function poolFor(key) {
        return V4_POOLS.find((p) => p.key === key) || V4_POOLS[0] || null
    }

    // Hook-enabled pool where leverage accounting (flash borrow + position
    // registration) and the physical swap both happen. Currencies are sorted
    // by address so the key matches the deployed/authorized pool exactly.
    function buildPoolKeyFor({ base, quote }, hookAddress) {
        const [currency0, currency1] = sortCurrencies(base, quote)
        return { currency0, currency1, fee: POOL_FEE, tickSpacing: TICK_SPACING, hooks: hookAddress }
    }

    // Standard (physical execution) pool: same currency ordering as the hook pool,
    // 0.05% fee tier on the deep no-hook standard (fill) pool (tickSpacing 10).
    function buildStandardPoolKeyFor({ base, quote }) {
        const [currency0, currency1] = sortCurrencies(base, quote)
        return { currency0, currency1, fee: STANDARD_POOL_FEE, tickSpacing: STANDARD_TICK_SPACING, hooks: ethers.ZeroAddress }
    }

    // Only a pool whose base is native ether (address 0x0) is funded through
    // msg.value. On Base the bases are WETH and cbBTC — ERC-20s the router pulls
    // via allowance — so sending value there would be both wrong and a
    // stuck-funds path, hence the explicit native check.
    function nativeValueOverride(isShort, pool, amount, leverage) {
        if (!isShort || !pool) return {}
        const isNativeBase = pool.base === ethers.ZeroAddress
        return isNativeBase ? { value: amount * BigInt(leverage) } : {}
    }

    const getSigner = useCallback(async () => {
        if (!walletClient || typeof window === "undefined" || !window.ethereum) return null
        return await new ethers.BrowserProvider(window.ethereum).getSigner()
    }, [walletClient])

    // Builds router.swap() params for `tradingKey` (WETH / cbBTC / ETH). Each
    // pool's base currency is the "trading asset" (set via registerTradingPair), so:
    //   LONG  → sell quote (USDC), buy base   → zeroForOne = baseIsCurrency0 ? false : true
    //   SHORT → sell base, buy quote          → zeroForOne = baseIsCurrency0 ? true  : false
    // The solver settles the borrowed leg (required for leverage > 1).
    const buildSwapParams = useCallback(
        (isShort, tradingKey, amount, leverage, hookAddress) => {
            const pool = poolFor(tradingKey)
            const key = buildPoolKeyFor(pool, hookAddress)
            const baseIsCurrency0 = pool.base.toLowerCase() === key.currency0.toLowerCase()
            const zeroForOne = isShort ? baseIsCurrency0 : !baseIsCurrency0
            const solver = ADDRESSES.V4_SOLVER || address
            const hookData = ethers.AbiCoder.defaultAbiCoder().encode(
                ["bool", "uint8", "address"],
                [true, leverage, address]
            )
            return { key, standardPoolKey: buildStandardPoolKeyFor(pool), zeroForOne, amountSpecified: -amount, leverage, solver, hookData }
        },
        [V4_POOLS, address, ADDRESSES.V4_SOLVER]
    )

    const openV4Position = useCallback(
        async (isShort, amount, leverage, tradingKey) => {
            if (!ADDRESSES.V4_ROUTER) throw new Error("V4 Router address not configured")
            const signer = await getSigner()
            if (!signer) throw new Error("Wallet not connected")

            const router = new ethers.Contract(ADDRESSES.V4_ROUTER, EswapRouterABI.abi, signer)
            const pool = poolFor(tradingKey)
            const params = buildSwapParams(isShort, tradingKey, amount, leverage, ADDRESSES.V4_HOOK)
            // Native-ETH short: the whole notional (margin × leverage) is funded
            // via msg.value. WETH shorts are ERC-20 pulls, so no override.
            const overrides = nativeValueOverride(isShort, pool, amount, leverage)
            return await router.swapMultiPool(params, overrides)
        },
        [getSigner, buildSwapParams, ADDRESSES.V4_ROUTER, ADDRESSES.V4_HOOK]
    )

    const simulateV4Position = useCallback(
        async (isShort, amount, leverage, tradingKey) => {
            const signer = await getSigner()
            if (!signer) throw new Error("Wallet not connected")
            const router = new ethers.Contract(ADDRESSES.V4_ROUTER, EswapRouterABI.abi, signer)
            const pool = poolFor(tradingKey)
            const params = buildSwapParams(isShort, tradingKey, amount, leverage, ADDRESSES.V4_HOOK)
            const overrides = nativeValueOverride(isShort, pool, amount, leverage)
            try {
                await router.swapMultiPool.staticCall(params, overrides)
                return { success: true }
            } catch (e) {
                return { success: false, error: e }
            }
        },
        [getSigner, buildSwapParams, ADDRESSES.V4_ROUTER, ADDRESSES.V4_HOOK]
    )

    const getAmountInUsd = useCallback(async (token, amount) => {
        if (!readProvider || !ADDRESSES.V4_PRICEFEED) return 0n
        const feed = new ethers.Contract(ADDRESSES.V4_PRICEFEED, PriceFeedABI.abi, readProvider)
        try {
            return await feed.getAmountInUsd(token, amount)
        } catch {
            return 0n
        }
    }, [readProvider, ADDRESSES.V4_PRICEFEED])

    // Human "USDC per base" price for display, straight from the Chainlink oracle
    // (18-decimal USD price per token) — works for every pool regardless of
    // currency ordering/decimals.
    async function computeUsdPerBase(hook, pool) {
        try {
            const twap = await hook.priceFeed().then(async (feedAddr) => {
                const feed = new ethers.Contract(feedAddr, PriceFeedABI.abi, readProvider)
                return feed.getTwapPrice(pool.base)
            })
            if (!twap || twap === 0n) return "0"
            return ethers.formatUnits(twap, 18)
        } catch {
            return "0"
        }
    }

    const getPositionsCount = useCallback(
        async (poolKey) => {
            if (!readProvider || !ADDRESSES.V4_HOOK || !address) return 0n
            const hook = new ethers.Contract(ADDRESSES.V4_HOOK, EswapMarginHookABI.abi, readProvider)
            const countPool = async (pool) => {
                try {
                    const poolId = poolIdFor(pool.base, pool.quote, ADDRESSES.V4_HOOK)
                    const pos = await hook.positions(poolId, address)
                    return pos.collateralAmount > 0n ? 1n : 0n
                } catch {
                    return 0n
                }
            }
            if (poolKey) {
                const pool = poolFor(poolKey)
                return pool ? countPool(pool) : 0n
            }
            let total = 0n
            for (const pool of V4_POOLS) total += await countPool(pool)
            return total
        },
        [readProvider, address, V4_POOLS, ADDRESSES.V4_HOOK]
    )

    const getPositionDetails = useCallback(
        async (id, userAddress, poolKey) => {
            const trader = userAddress || address
            if (!readProvider || !ADDRESSES.V4_HOOK || !trader) return null
            const hook = new ethers.Contract(ADDRESSES.V4_HOOK, EswapMarginHookABI.abi, readProvider)

            const readPool = async (pool) => {
                try {
                    const poolId = poolIdFor(pool.base, pool.quote, ADDRESSES.V4_HOOK)
                    const pos = await hook.positions(poolId, trader)
                    if (pos.collateralAmount === 0n) return null

                    // isLong is anchored to the pool's base currency, so a LONG
                    // holds base collateral (WETH/cbBTC) and a SHORT holds quote (USDC).
                    const collateralKey = pos.isLong ? pool.key : "USDC"
                    const collateralDecimals = TOKEN_DECIMALS[collateralKey] ?? 18
                    const currentPrice = await computeUsdPerBase(hook, pool)

                    return {
                        id: `V4-${pool.key}-${trader.slice(2, 6)}`,
                        owner: pos.trader,
                        collateral: pos.collateralAmount,
                        borrowed: pos.borrowedAmount,
                        leverage: pos.leverage.toString(),
                        isShort: !pos.isLong,
                        state: "ACTIVE",
                        size: ethers.formatUnits(pos.collateralAmount, collateralDecimals),
                        sizeUsd: "0.00",
                        pnl: "0",
                        pnlUsd: "0.00",
                        pnlIsPositive: true,
                        entryPrice: currentPrice,
                        currentPrice,
                        baseSymbol: pool.key,
                        quoteSymbol: "USDC",
                    }
                } catch {
                    return null
                }
            }

            if (poolKey) {
                const pool = poolFor(poolKey)
                return pool ? readPool(pool) : null
            }
            for (const pool of V4_POOLS) {
                const result = await readPool(pool)
                if (result) return result
            }
            return null
        },
        [readProvider, address, V4_POOLS, ADDRESSES.V4_HOOK]
    )

    const closePosition = useCallback(
        async (id) => {
            if (!id || !id.startsWith("V4-")) return null
            const parts = id.split("-")
            const poolKey = parts.length >= 3 ? parts[1] : "WETH"
            const pool = poolFor(poolKey)
            if (!pool) return null

            const signer = await getSigner()
            if (!signer) throw new Error("Wallet not connected")
            if (!ADDRESSES.V4_ROUTER) throw new Error("V4 Router address not configured")

            const router = new ethers.Contract(ADDRESSES.V4_ROUTER, EswapRouterABI.abi, signer)
            return await router.closePosition(
                ADDRESSES.V4_HOOK,
                buildPoolKeyFor(pool, ADDRESSES.V4_HOOK),
                address,
                ethers.ZeroAddress,
                0
            )
        },
        [getSigner, address, V4_POOLS, ADDRESSES.V4_ROUTER, ADDRESSES.V4_HOOK]
    )

    // Shariah-compliant (halal) shorts are fully handled by the standard
    // leveraged short path via the V4 margin hook (0% interest leverage).
    // "Arbun" mode is the same on-chain short — no separate option contract,
    // so halal/plain shorts route through the exact same openV4Position call.
    const openHalalShortOption = openV4Position
    const exerciseHalalShortOption = openV4Position
    const cancelHalalShortOption = openV4Position

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
        CBBTC_ADDR,
        USDC_ADDR,
        V4_POOLS,
        SUPPORTED_TOKENS_LIST,
    }
}