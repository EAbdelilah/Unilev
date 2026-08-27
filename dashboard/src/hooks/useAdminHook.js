import { useState, useCallback } from "react"
import { ethers } from "ethers"
import { useAccount, useWalletClient } from "wagmi"
import EswapMarginHookABI from "../abis/EswapMarginHook.json"
import EswapTimelockABI from "../abis/EswapTimelock.json"
import ERC20ABI from "../abis/ERC20.json"

const V4_HOOK = process.env.NEXT_PUBLIC_V4_HOOK_ADDRESS || ""
const V4_TIMELOCK = process.env.NEXT_PUBLIC_V4_TIMELOCK_ADDRESS || ""
const RPC_URL = process.env.NEXT_PUBLIC_UNICHAIN_RPC_URL || process.env.NEXT_PUBLIC_RPC_URL

function getReadProvider() {
    if (RPC_URL) return new ethers.JsonRpcProvider(RPC_URL)
    if (typeof window !== "undefined" && window.ethereum) return new ethers.BrowserProvider(window.ethereum)
    return null
}

function hookContract(readOnly = true) {
    const provider = readOnly ? getReadProvider() : null
    return new ethers.Contract(V4_HOOK, EswapMarginHookABI.abi, provider)
}

function timelockContract(readOnly = true) {
    if (!V4_TIMELOCK) return null
    const provider = readOnly ? getReadProvider() : null
    return new ethers.Contract(V4_TIMELOCK, EswapTimelockABI.abi, provider)
}

export function useAdminHook() {
    const { address } = useAccount()
    const { data: walletClient } = useWalletClient()
    const [loading, setLoading] = useState(false)
    const [status, setStatus] = useState("")

    const getSigner = useCallback(async () => {
        if (!walletClient || typeof window === "undefined" || !window.ethereum) return null
        const provider = new ethers.BrowserProvider(window.ethereum)
        return await provider.getSigner()
    }, [walletClient])

    const hookRW = useCallback(async () => {
        const signer = await getSigner()
        if (!signer) throw new Error("Wallet not connected")
        return new ethers.Contract(V4_HOOK, EswapMarginHookABI.abi, signer)
    }, [getSigner])

    // ─── READ FUNCTIONS ────────────────────────────────────────────

    const readAll = useCallback(async () => {
        const h = hookContract(true)
        if (!h) return null
        try {
            const [
                owner,
                emergencyPaused,
                router,
                defaultMaxLeverage,
                minCollateralUsd,
                maxPriceSwingBps,
                maxSingleOIBps,
                maxTotalOIBps,
                oiCapTvlFloorUsd,
                bandConsumptionTriggerBps,
                liquidationThresholdBps,
                reserveFactor,
                requireTwapOracle,
                insuranceFundEth,
                totalCollateralEth,
                totalOpenInterestUsd,
                totalCollateralUSDRunning,
                liquidationRewardBps,
            ] = await Promise.all([
                h.owner(),
                h.emergencyPaused(),
                h.router(),
                h.defaultMaxLeverage(),
                h.minCollateralUsd(),
                h.maxPriceSwingBps(),
                h.maxSingleOIBps(),
                h.maxTotalOIBps(),
                h.oiCapTvlFloorUsd(),
                h.bandConsumptionTriggerBps(),
                h.liquidationThresholdBps(),
                h.reserveFactor(),
                h.requireTwapOracle(),
                h.insuranceFund(ethers.ZeroAddress),
                h.totalCollateral(ethers.ZeroAddress),
                h.totalOpenInterestUSD(),
                h.totalCollateralUSDRunning(),
                h.LIQUIDATION_REWARD_BPS(),
            ])

            return {
                owner,
                emergencyPaused,
                router,
                defaultMaxLeverage: defaultMaxLeverage.toString(),
                minCollateralUsd: minCollateralUsd.toString(),
                maxPriceSwingBps: maxPriceSwingBps.toString(),
                maxSingleOIBps: maxSingleOIBps.toString(),
                maxTotalOIBps: maxTotalOIBps.toString(),
                oiCapTvlFloorUsd: oiCapTvlFloorUsd.toString(),
                bandConsumptionTriggerBps: bandConsumptionTriggerBps.toString(),
                liquidationThresholdBps: liquidationThresholdBps.toString(),
                reserveFactor: reserveFactor.toString(),
                requireTwapOracle,
                insuranceFund: insuranceFundEth.toString(),
                totalCollateral: totalCollateralEth.toString(),
                totalOpenInterestUSD: totalOpenInterestUsd.toString(),
                totalCollateralUSDRunning: totalCollateralUSDRunning.toString(),
                liquidationRewardBps: liquidationRewardBps.toString(),
            }
        } catch (e) {
            console.error("Failed to read hook state:", e)
            return null
        }
    }, [])

    // ─── WRITE FUNCTIONS (each sends a tx via signer) ──────────────

    const exec = useCallback(async (label, fn) => {
        setLoading(true)
        setStatus(`Sending ${label}...`)
        try {
            const tx = await fn()
            setStatus(`${label} sent: ${tx.hash.slice(0, 10)}...`)
            await tx.wait()
            setStatus(`${label} confirmed!`)
            return true
        } catch (e) {
            console.error(e)
            const msg = e?.reason || e?.message || "Unknown error"
            setStatus(`${label} failed: ${msg.slice(0, 120)}`)
            return false
        } finally {
            setLoading(false)
        }
    }, [])

    const setEmergencyPause = useCallback(async (paused) => {
        const h = await hookRW()
        return exec("Emergency Pause", () => h.setEmergencyPause(paused))
    }, [hookRW, exec])

    const transferOwnership = useCallback(async (newOwner) => {
        const h = await hookRW()
        return exec("Transfer Ownership", () => h.transferOwnership(newOwner))
    }, [hookRW, exec])

    const setAuthorizedPool = useCallback(async (poolId, authorized) => {
        const h = await hookRW()
        return exec("Authorize Pool", () => h.setAuthorizedPool(poolId, authorized))
    }, [hookRW, exec])

    const setOpenInterestCaps = useCallback(async (maxSingleBps, maxTotalBps, tvlFloorUsd) => {
        const h = await hookRW()
        return exec("Set OI Caps", () => h.setOpenInterestCaps(maxSingleBps, maxTotalBps, tvlFloorUsd))
    }, [hookRW, exec])

    const setConfig = useCallback(async (params) => {
        const h = await hookRW()
        return exec("Set Config", () => h.setConfig(params))
    }, [hookRW, exec])

    const setBandConsumptionTriggerBps = useCallback(async (bps) => {
        const h = await hookRW()
        return exec("Set Band Trigger", () => h.setBandConsumptionTriggerBps(bps))
    }, [hookRW, exec])

    const setTokenDecimals = useCallback(async (token, decimals) => {
        const h = await hookRW()
        return exec("Set Token Decimals", () => h.setTokenDecimals(token, decimals))
    }, [hookRW, exec])

    const setBaseCurrency = useCallback(async (poolId, currency) => {
        const h = await hookRW()
        return exec("Set Base Currency", () => h.setBaseCurrency(poolId, currency))
    }, [hookRW, exec])

    const withdrawInsuranceFund = useCallback(async (currency, to, amount) => {
        const h = await hookRW()
        return exec("Withdraw Insurance", () => h.withdrawInsuranceFund(currency, to, amount))
    }, [hookRW, exec])

    const withdrawProtocolFee = useCallback(async (currency, amount) => {
        const h = await hookRW()
        return exec("Withdraw Protocol Fee", () => h.withdrawProtocolFee(currency, amount))
    }, [hookRW, exec])

    const sweepResidue = useCallback(async (currency, to, amount) => {
        const h = await hookRW()
        return exec("Sweep Residue", () => h.sweepResidue(currency, to, amount))
    }, [hookRW, exec])

    const setRouterAndMinCollateralUsd = useCallback(async (routerAddr, floor) => {
        const h = await hookRW()
        return exec("Set Router & Floor", () => h.setRouterAndMinCollateralUsd(routerAddr, floor))
    }, [hookRW, exec])

    const setAddressProtocolFee = useCallback(async (account, bps) => {
        const h = await hookRW()
        return exec("Set Address Fee", () => h.setAddressProtocolFee(account, bps))
    }, [hookRW, exec])

    const setOperator = useCallback(async (operator, approved) => {
        const h = await hookRW()
        return exec("Set Operator", () => h.setOperator(operator, approved))
    }, [hookRW, exec])

    const setStandardPoolKey = useCallback(async (poolId, poolKey) => {
        const h = await hookRW()
        return exec("Set Standard Pool Key", () => h.setStandardPoolKey(poolId, poolKey))
    }, [hookRW, exec])

    const rescueToken = useCallback(async (token, to, amount) => {
        const signer = await getSigner()
        if (!signer) throw new Error("Wallet not connected")
        const tokenContract = new ethers.Contract(token, ERC20ABI.abi, signer)
        return exec("Rescue Token", () => tokenContract.transfer(to, amount))
    }, [getSigner, exec])

    // ─── TIMELOCK FUNCTIONS ─────────────────────────────────────────

    const timelockEmergencyPause = useCallback(async (paused) => {
        const t = timelockContract(false)
        if (!t) throw new Error("No timelock configured")
        const signer = await getSigner()
        const contract = new ethers.Contract(V4_TIMELOCK, EswapTimelockABI.abi, signer)
        return exec("Timelock Emergency Pause", () => contract.emergencyPause(paused))
    }, [getSigner, exec])

    const timelockQueue = useCallback(async (target, data, eta) => {
        const signer = await getSigner()
        if (!signer) throw new Error("Wallet not connected")
        const contract = new ethers.Contract(V4_TIMELOCK, EswapTimelockABI.abi, signer)
        return exec("Queue Timelock", () => contract.queue(target, data, eta))
    }, [getSigner, exec])

    const timelockExecute = useCallback(async (target, data, eta) => {
        const signer = await getSigner()
        if (!signer) throw new Error("Wallet not connected")
        const contract = new ethers.Contract(V4_TIMELOCK, EswapTimelockABI.abi, signer)
        return exec("Execute Timelock", () => contract.execute(target, data, eta))
    }, [getSigner, exec])

    return {
        loading,
        status,
        setStatus,
        readAll,
        setEmergencyPause,
        transferOwnership,
        setAuthorizedPool,
        setOpenInterestCaps,
        setConfig,
        setBandConsumptionTriggerBps,
        setTokenDecimals,
        setBaseCurrency,
        withdrawInsuranceFund,
        withdrawProtocolFee,
        sweepResidue,
        setRouterAndMinCollateralUsd,
        setAddressProtocolFee,
        setOperator,
        setStandardPoolKey,
        rescueToken,
        timelockEmergencyPause,
        timelockQueue,
        timelockExecute,
    }
}
