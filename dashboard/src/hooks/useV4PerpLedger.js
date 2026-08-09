import { useCallback, useMemo } from "react"
import { ethers } from "ethers"
import { useAccount, useWalletClient } from "wagmi"
import PerpLedgerABI from "../abis/PerpLedger.json"
import PriceFeedABI from "../abis/PriceFeed.json"
import ERC20ABI from "../abis/ERC20.json"
import { useReadProvider } from "./useReadProvider"
import { isUnichainChain } from "../utils/chains"

const DECIMALS_18 = 18n

export function useV4PerpLedger() {
    const { address, chainId } = useAccount()
    const { data: walletClient } = useWalletClient()
    const readProvider = useReadProvider()

    const LEDGER = process.env.NEXT_PUBLIC_V4_PERP_LEDGER_ADDRESS || ""
    const PRICEFEED =
        process.env.NEXT_PUBLIC_V4_PRICEFEED_ADDRESS ||
        process.env.NEXT_PUBLIC_PRICEFEEDL1_ADDRESS ||
        ""

    const isUnichain = isUnichainChain(chainId)
    const configured = Boolean(LEDGER)

    const getSigner = useCallback(async () => {
        if (!walletClient || typeof window === "undefined" || !window.ethereum) return null
        return await new ethers.BrowserProvider(window.ethereum).getSigner()
    }, [walletClient])

    const ledgerContract = useCallback(
        (signerOrProvider) => {
            if (!LEDGER) return null
            return new ethers.Contract(LEDGER, PerpLedgerABI.abi, signerOrProvider || readProvider)
        },
        [LEDGER, readProvider]
    )

    // Mirrors the contract's _pnlAt: signed PnL in USD (18-dec) at `price`.
    const computePnlUsd = useCallback((pos, price) => {
        if (!pos || !pos.active) return 0n
        const entry = BigInt(pos.entryPrice)
        const size = BigInt(pos.size)
        let delta = 0n
        if (pos.isLong) {
            delta = price > entry ? price - entry : -(entry - price)
        } else {
            delta = entry > price ? entry - price : -(price - entry)
        }
        return (delta * size) / DECIMALS_18
    }, [])

    const getMarginTokenInfo = useCallback(async () => {
        if (!readProvider || !LEDGER) return null
        try {
            const ledger = ledgerContract()
            const marginToken = await ledger.marginToken()
            const erc20 = new ethers.Contract(marginToken, ERC20ABI.abi, readProvider)
            const [symbol, decimals] = await Promise.all([erc20.symbol(), erc20.decimals()])
            return { address: marginToken, symbol, decimals: Number(decimals) }
        } catch {
            return null
        }
    }, [readProvider, LEDGER, ledgerContract])

    const getLedgerConfig = useCallback(async () => {
        if (!readProvider || !LEDGER) return null
        try {
            const ledger = ledgerContract()
            const marginToken = await ledger.marginToken()
            const baseToken = await ledger.baseToken()
            const twapFeed = await ledger.twapFeed()
            const [
                maxLeverage,
                maintenanceMarginBps,
                liquidationFeeBps,
                insuranceFeeBps,
                minInitialMarginUsd,
                minPositionUsd,
                maxOracleAge,
                paused,
                insuranceUsd,
                oiCapUsd,
                totalOpenNotionalUsd,
                marginTokenBalance,
            ] = await Promise.all([
                ledger.maxLeverage(),
                ledger.maintenanceMarginBps(),
                ledger.liquidationFeeBps(),
                ledger.insuranceFeeBps(),
                ledger.minInitialMarginUsd(),
                ledger.minPositionUsd(),
                ledger.maxOracleAge(),
                ledger.paused(),
                ledger.insuranceUsd(),
                ledger.oiCapUsd(),
                ledger.totalOpenNotionalUsd(),
                ledger.marginTokenBalance(),
            ])

            let whitelisted = false
            if (address) {
                try {
                    whitelisted = await ledger.whitelist(address)
                } catch {
                    whitelisted = false
                }
            }

            return {
                marginToken,
                baseToken,
                twapFeed,
                maxLeverage: BigInt(maxLeverage),
                maintenanceMarginBps: BigInt(maintenanceMarginBps),
                liquidationFeeBps: BigInt(liquidationFeeBps),
                insuranceFeeBps: BigInt(insuranceFeeBps),
                minInitialMarginUsd: BigInt(minInitialMarginUsd),
                minPositionUsd: BigInt(minPositionUsd),
                maxOracleAge: BigInt(maxOracleAge),
                paused: Boolean(paused),
                insuranceUsd: BigInt(insuranceUsd),
                oiCapUsd: BigInt(oiCapUsd),
                totalOpenNotionalUsd: BigInt(totalOpenNotionalUsd),
                marginTokenBalance: BigInt(marginTokenBalance),
                whitelisted,
            }
        } catch (error) {
            console.error("Error fetching ledger config:", error)
            return null
        }
    }, [readProvider, LEDGER, ledgerContract, address])

    const getTwapPrice = useCallback(
        async (token) => {
            if (!readProvider || !PRICEFEED) return null
            try {
                const feed = new ethers.Contract(PRICEFEED, PriceFeedABI.abi, readProvider)
                const [price, updatedAt] = await Promise.all([
                    feed.getTwapPrice(token),
                    feed.getTwapPriceUpdatedAt(token),
                ])
                return { price: BigInt(price), updatedAt: Number(updatedAt) }
            } catch {
                return null
            }
        },
        [readProvider, PRICEFEED]
    )

    const getPosition = useCallback(async () => {
        if (!readProvider || !LEDGER || !address) return null
        try {
            const ledger = ledgerContract()
            const pos = await ledger.positions(address)
            if (!pos.active) return null

            const marginToken = await ledger.marginToken()
            const baseToken = await ledger.baseToken()
            const [twap, liquidatable, maintenanceMarginBps] = await Promise.all([
                getTwapPrice(baseToken),
                ledger.isLiquidatable(address),
                ledger.maintenanceMarginBps(),
            ])
            const currentPrice = twap ? twap.price : 0n
            const pnlUsd = computePnlUsd(pos, currentPrice)
            const equityUsd = BigInt(pos.marginUsd) + pnlUsd
            const maintenanceUsd = (BigInt(pos.notionalUsd) * BigInt(maintenanceMarginBps)) / 10000n

            return {
                active: true,
                isLong: Boolean(pos.isLong),
                size: BigInt(pos.size),
                entryPrice: BigInt(pos.entryPrice),
                marginUsd: BigInt(pos.marginUsd),
                notionalUsd: BigInt(pos.notionalUsd),
                lastUpdate: Number(pos.lastUpdate),
                currentPriceUsd: currentPrice,
                pnlUsd,
                equityUsd,
                maintenanceUsd,
                liquidatable: Boolean(liquidatable),
                leverage: BigInt(pos.notionalUsd) > 0n
                    ? BigInt(pos.notionalUsd) / BigInt(pos.marginUsd)
                    : 0n,
                marginToken,
                baseToken,
            }
        } catch (error) {
            console.error("Error fetching ledger position:", error)
            return null
        }
    }, [readProvider, LEDGER, address, ledgerContract, getTwapPrice, computePnlUsd])

    const getAllowance = useCallback(
        async (token, owner, spender) => {
            if (!readProvider || !token || !owner || !spender) return 0n
            try {
                const erc20 = new ethers.Contract(token, ERC20ABI.abi, readProvider)
                return await erc20.allowance(owner, spender)
            } catch {
                return 0n
            }
        },
        [readProvider]
    )

    const approve = useCallback(
        async (token, amount = ethers.MaxUint256) => {
            const signer = await getSigner()
            if (!signer) throw new Error("Wallet not connected")
            const erc20 = new ethers.Contract(token, ERC20ABI.abi, signer)
            return await erc20.approve(LEDGER, amount)
        },
        [getSigner, LEDGER]
    )

    const openPosition = useCallback(
        async (isLong, leverage, marginTokens) => {
            if (!LEDGER) throw new Error("Perp Ledger address not configured")
            const signer = await getSigner()
            if (!signer) throw new Error("Wallet not connected")
            const ledger = ledgerContract(signer)
            return await ledger.open(isLong, leverage, marginTokens)
        },
        [LEDGER, getSigner, ledgerContract]
    )

    const settlePosition = useCallback(async () => {
        if (!LEDGER) throw new Error("Perp Ledger address not configured")
        const signer = await getSigner()
        if (!signer) throw new Error("Wallet not connected")
        const ledger = ledgerContract(signer)
        return await ledger.settle(0, ethers.MaxUint256)
    }, [LEDGER, getSigner, ledgerContract])

    const liquidatePosition = useCallback(
        async (trader, minLiquidatorTokens = 0) => {
            if (!LEDGER) throw new Error("Perp Ledger address not configured")
            const signer = await getSigner()
            if (!signer) throw new Error("Wallet not connected")
            const ledger = ledgerContract(signer)
            return await ledger.liquidate(trader, minLiquidatorTokens)
        },
        [LEDGER, getSigner, ledgerContract]
    )

    const depositInsurance = useCallback(
        async (marginTokens) => {
            if (!LEDGER) throw new Error("Perp Ledger address not configured")
            const signer = await getSigner()
            if (!signer) throw new Error("Wallet not connected")
            const ledger = ledgerContract(signer)
            return await ledger.depositInsurance(marginTokens)
        },
        [LEDGER, getSigner, ledgerContract]
    )

    const withdrawInsuranceSurplus = useCallback(async () => {
        if (!LEDGER) throw new Error("Perp Ledger address not configured")
        const signer = await getSigner()
        if (!signer) throw new Error("Wallet not connected")
        const ledger = ledgerContract(signer)
        return await ledger.withdrawInsuranceSurplus()
    }, [LEDGER, getSigner, ledgerContract])

    return useMemo(
        () => ({
            LEDGER,
            PRICEFEED,
            readProvider,
            configured,
            isUnichain,
            getMarginTokenInfo,
            getLedgerConfig,
            getTwapPrice,
            getPosition,
            getAllowance,
            approve,
            openPosition,
            settlePosition,
            liquidatePosition,
            depositInsurance,
            withdrawInsuranceSurplus,
        }),
        [
            LEDGER,
            PRICEFEED,
            readProvider,
            configured,
            isUnichain,
            getMarginTokenInfo,
            getLedgerConfig,
            getTwapPrice,
            getPosition,
            getAllowance,
            approve,
            openPosition,
            settlePosition,
            liquidatePosition,
            depositInsurance,
            withdrawInsuranceSurplus,
        ]
    )
}
