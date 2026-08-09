import { useState, useEffect, useCallback } from "react"
import { ethers } from "ethers"
import { useAccount } from "wagmi"
import clsx from "clsx"
import { useV4PerpLedger } from "../hooks/useV4PerpLedger"
import ERC20ABI from "../abis/ERC20.json"
import { formatContractError, isUserCancellation } from "../utils/formatContractError"
import { formatTokenAmount } from "../utils/format"
import { isUnichainChain, POLYGON_CHAIN_ID } from "../utils/chains"

const USD = (big) => formatTokenAmount(ethers.formatUnits(BigInt(big), 18), "USDC")

export function PerpLedgerPanel() {
    const { isConnected, address, chainId } = useAccount()
    const ledger = useV4PerpLedger()

    const isUnichain = isUnichainChain(chainId)
    const [config, setConfig] = useState(null)
    const [marginInfo, setMarginInfo] = useState(null)
    const [baseTwap, setBaseTwap] = useState(null)
    const [marginTwap, setMarginTwap] = useState(null)
    const [position, setPosition] = useState(null)
    const [allowance, setAllowance] = useState(0n)
    const [balance, setBalance] = useState(0n)

    const [isLong, setIsLong] = useState(true)
    const [leverage, setLeverage] = useState(2)
    const [amount, setAmount] = useState("")
    const [status, setStatus] = useState("")
    const [loading, setLoading] = useState(false)
    const [depositAmount, setDepositAmount] = useState("")

    const refresh = useCallback(async () => {
        if (!ledger.configured || !ledger.isUnichain || !ledger.LEDGER || !ledger.readProvider)
            return
        try {
            const cfg = await ledger.getLedgerConfig()
            setConfig(cfg)
            if (!cfg) return
            const [mi, baseTwap, marginTwap, pos] = await Promise.all([
                ledger.getMarginTokenInfo(),
                ledger.getTwapPrice(cfg.baseToken),
                ledger.getTwapPrice(cfg.marginToken),
                ledger.getPosition(),
            ])
            setMarginInfo(mi)
            setBaseTwap(baseTwap)
            setMarginTwap(marginTwap)
            setPosition(pos)

            if (mi && address) {
                const erc20 = new ethers.Contract(mi.address, ERC20ABI.abi, ledger.readProvider)
                const [bal, allowance] = await Promise.all([
                    erc20.balanceOf(address),
                    ledger.getAllowance(mi.address, address, ledger.LEDGER),
                ])
                setBalance(bal)
                setAllowance(allowance)
            }
        } catch (error) {
            console.error("Perp ledger refresh failed:", error)
        }
    }, [ledger, address])

    useEffect(() => {
        refresh()
        const interval = setInterval(refresh, 15000)
        return () => clearInterval(interval)
    }, [refresh])

    const decimals = marginInfo ? marginInfo.decimals : 6
    const amountBig =
        marginInfo && amount && !isNaN(amount)
            ? ethers.parseUnits(amount.toString(), decimals)
            : 0n
    const marginPrice = marginTwap ? marginTwap.price : 1n
    const amountUsdBig = amountBig ? (amountBig * marginPrice) / 10n ** BigInt(decimals) : 0n
    const notionalUsdBig = amountUsdBig * BigInt(leverage || 0)
    const insuranceFeeUsdBig = config && notionalUsdBig
        ? (notionalUsdBig * config.insuranceFeeBps) / 10000n
        : 0n
    const insuranceFeeTokens = insuranceFeeUsdBig
        ? (insuranceFeeUsdBig * 10n ** BigInt(decimals)) / marginPrice
        : 0n
    const totalNeeded = amountBig + insuranceFeeTokens
    const needsApproval = isConnected && totalNeeded > 0n && allowance < totalNeeded

    const canOpen =
        isConnected &&
        ledger.configured &&
        isUnichain &&
        config &&
        !config.paused &&
        config.whitelisted &&
        amountUsdBig > 0n &&
        amountUsdBig >= config.minInitialMarginUsd &&
        config.totalOpenNotionalUsd + notionalUsdBig <= config.oiCapUsd

    const handleApprove = async () => {
        if (!marginInfo) return
        setLoading(true)
        setStatus("Approving USDC for the Perp Ledger...")
        try {
            const tx = await ledger.approve(marginInfo.address)
            setStatus(`Approval Sent: ${tx.hash}`)
            await tx.wait()
            const next = await ledger.getAllowance(marginInfo.address, address, ledger.LEDGER)
            setAllowance(next)
            setStatus("Approved! You can now open a position.")
        } catch (error) {
            console.error(error)
            setStatus(
                isUserCancellation(error)
                    ? "Approval was canceled by user."
                    : `Error: ${formatContractError(error)}`
            )
        } finally {
            setLoading(false)
        }
    }

    const handleOpen = async () => {
        if (!marginInfo) return
        setLoading(true)
        setStatus("Opening synthetic position...")
        try {
            if (needsApproval) {
                setStatus("Approving USDC for the Perp Ledger...")
                const appTx = await ledger.approve(marginInfo.address)
                await appTx.wait()
                const next = await ledger.getAllowance(marginInfo.address, address, ledger.LEDGER)
                setAllowance(next)
                setStatus("Opening synthetic position...")
            }
            const tx = await ledger.openPosition(isLong, leverage, amountBig)
            setStatus(`Transaction Sent: ${tx.hash}`)
            await tx.wait()
            setStatus("Position opened successfully!")
            setAmount("")
            await refresh()
        } catch (error) {
            console.error(error)
            setStatus(
                isUserCancellation(error)
                    ? "Transaction was canceled by user."
                    : `Error: ${formatContractError(error)}`
            )
        } finally {
            setLoading(false)
        }
    }

    const handleSettle = async () => {
        setLoading(true)
        setStatus("Settling position at TWAP...")
        try {
            const tx = await ledger.settlePosition()
            setStatus(`Transaction Sent: ${tx.hash}`)
            await tx.wait()
            setStatus("Position settled. P&L returned to your wallet.")
            await refresh()
        } catch (error) {
            console.error(error)
            setStatus(
                isUserCancellation(error)
                    ? "Transaction was canceled by user."
                    : `Error: ${formatContractError(error)}`
            )
        } finally {
            setLoading(false)
        }
    }

    const handleLiquidate = async () => {
        setLoading(true)
        setStatus("Liquidating position...")
        try {
            const tx = await ledger.liquidatePosition(address)
            setStatus(`Transaction Sent: ${tx.hash}`)
            await tx.wait()
            setStatus("Position liquidated. Reward paid to liquidator.")
            await refresh()
        } catch (error) {
            console.error(error)
            setStatus(
                isUserCancellation(error)
                    ? "Transaction was canceled by user."
                    : `Error: ${formatContractError(error)}`
            )
        } finally {
            setLoading(false)
        }
    }

    const handleDepositInsurance = async () => {
        if (!marginInfo || !depositAmount || isNaN(depositAmount)) return
        setLoading(true)
        setStatus("Depositing insurance...")
        try {
            const raw = ethers.parseUnits(depositAmount.toString(), decimals)
            if (allowance < raw) {
                const appTx = await ledger.approve(marginInfo.address)
                await appTx.wait()
            }
            const tx = await ledger.depositInsurance(raw)
            setStatus(`Transaction Sent: ${tx.hash}`)
            await tx.wait()
            setStatus("Insurance deposit successful!")
            setDepositAmount("")
            await refresh()
        } catch (error) {
            console.error(error)
            setStatus(
                isUserCancellation(error)
                    ? "Transaction was canceled by user."
                    : `Error: ${formatContractError(error)}`
            )
        } finally {
            setLoading(false)
        }
    }

    const priceAge = baseTwap
        ? Math.max(0, Math.floor(Date.now() / 1000 - baseTwap.updatedAt))
        : null
    const priceStale =
        config && priceAge !== null && priceAge > Number(config.maxOracleAge)
    const oiPct =
        config && config.oiCapUsd > 0n
            ? Math.min(100, (Number(config.totalOpenNotionalUsd) / Number(config.oiCapUsd)) * 100)
            : 0
    const healthPct =
        position && position.notionalUsd > 0n
            ? Math.max(0, Math.min(100, (Number(position.equityUsd) / Number(position.notionalUsd)) * 100))
            : 0

    return (
        <div className="glass-panel p-6 w-full">
            <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-cyan-400 to-blue-400">
                    Perp Ledger
                </h2>
                <div className="flex items-center gap-2">
                    {config?.paused && (
                        <span className="text-xs px-2 py-0.5 rounded border border-red-500/50 text-red-400 bg-red-500/10">
                            PAUSED
                        </span>
                    )}
                    {isUnichain ? (
                        <span className="text-xs px-2 py-0.5 rounded border border-green-500/50 text-green-400 bg-green-500/10">
                            {chainId === 130 ? "Unichain" : "Unichain Sepolia"}
                        </span>
                    ) : (
                        <span className="text-xs px-2 py-0.5 rounded border border-yellow-500/50 text-yellow-400 bg-yellow-500/10">
                            {chainId === POLYGON_CHAIN_ID ? "Polygon (V3)" : "Unsupported Network"}
                        </span>
                    )}
                </div>
            </div>

            {!ledger.configured && (
                <div className="p-4 rounded-xl bg-yellow-500/10 border border-yellow-500/30 text-yellow-200 text-sm">
                    Perp Ledger is not configured yet. Set{" "}
                    <code className="text-yellow-300">NEXT_PUBLIC_V4_PERP_LEDGER_ADDRESS</code> in{" "}
                    <code className="text-yellow-300">.env</code> and run{" "}
                    <code className="text-yellow-300">node javascript/update-dashboard.js</code>.
                </div>
            )}

            {ledger.configured && !isUnichain && (
                <div className="p-4 rounded-xl bg-white/5 border border-white/10 text-gray-300 text-sm">
                    Synthetic perpetuals run on Unichain. Switch your wallet to Unichain (chain
                    130) or Unichain Sepolia (1301) to trade.
                </div>
            )}

            {ledger.configured && isUnichain && (
                <>
                    {/* Price + OI strip */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                        <div className="p-4 rounded-xl bg-white/5 border border-white/10">
                            <div className="text-xs text-gray-400 uppercase tracking-wider">
                                TWAP Price
                            </div>
                            <div className="text-xl font-bold font-mono mt-1">
                                {baseTwap ? `$${USD(baseTwap.price)}` : "—"}
                            </div>
                            {priceAge !== null && (
                                <div
                                    className={clsx(
                                        "text-[10px] mt-1",
                                        priceStale ? "text-red-400" : "text-gray-500"
                                    )}
                                >
                                    updated {priceAge}s ago {priceStale ? "(STALE)" : ""}
                                </div>
                            )}
                        </div>
                        <div className="p-4 rounded-xl bg-white/5 border border-white/10">
                            <div className="text-xs text-gray-400 uppercase tracking-wider">
                                Open Interest
                            </div>
                            <div className="text-xl font-bold font-mono mt-1">
                                ${USD(config?.totalOpenNotionalUsd || 0n)}
                            </div>
                            <div className="mt-2 h-1.5 bg-black/40 rounded-full overflow-hidden">
                                <div
                                    className="h-full bg-gradient-to-r from-cyan-500 to-blue-500 rounded-full"
                                    style={{ width: `${oiPct}%` }}
                                />
                            </div>
                            <div className="text-[10px] text-gray-500 mt-1">
                                {oiPct.toFixed(1)}% of ${USD(config?.oiCapUsd || 0n)} cap
                            </div>
                        </div>
                        <div className="p-4 rounded-xl bg-white/5 border border-white/10">
                            <div className="text-xs text-gray-400 uppercase tracking-wider">
                                Insurance Pool
                            </div>
                            <div className="text-xl font-bold font-mono mt-1 text-amber-300">
                                ${USD(config?.insuranceUsd || 0n)}
                            </div>
                            <div className="text-[10px] text-gray-500 mt-1">
                                backed by{" "}
                                {marginInfo
                                    ? `${formatTokenAmount(
                                          ethers.formatUnits(config?.marginTokenBalance || 0n, marginInfo.decimals),
                                          marginInfo.symbol
                                      )} ${marginInfo.symbol}`
                                    : "—"}{" "}
                                in contract
                            </div>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        {/* Open form */}
                        <div className="p-4 rounded-xl bg-white/5 border border-white/10">
                            <h3 className="text-sm font-bold uppercase tracking-wider text-gray-300 mb-4">
                                Open Synthetic Position
                            </h3>

                            <div className="grid grid-cols-2 gap-3 mb-4">
                                <button
                                    type="button"
                                    onClick={() => setIsLong(true)}
                                    className={clsx(
                                        "py-2.5 rounded-lg border-2 transition-all font-bold",
                                        isLong
                                            ? "bg-green-500/10 border-green-500 text-green-400"
                                            : "bg-black/40 border-transparent text-gray-400"
                                    )}
                                >
                                    LONG
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setIsLong(false)}
                                    className={clsx(
                                        "py-2.5 rounded-lg border-2 transition-all font-bold",
                                        !isLong
                                            ? "bg-red-500/10 border-red-500 text-red-400"
                                            : "bg-black/40 border-transparent text-gray-400"
                                    )}
                                >
                                    SHORT
                                </button>
                            </div>

                            <div className="grid grid-cols-2 gap-4 mb-4">
                                <div>
                                    <label className="text-xs text-gray-400 mb-1 block">
                                        Leverage (max {config ? Number(config.maxLeverage) : "5"}x)
                                    </label>
                                    <input
                                        type="number"
                                        min="1"
                                        max={config ? Number(config.maxLeverage) : 5}
                                        step="1"
                                        value={leverage}
                                        onChange={(e) => setLeverage(Number(e.target.value))}
                                        className="input-field"
                                    />
                                </div>
                                <div>
                                    <label className="text-xs text-gray-400 mb-1 block">
                                        Margin ({marginInfo?.symbol || "USDC"})
                                    </label>
                                    <input
                                        type="number"
                                        min="0"
                                        value={amount}
                                        onChange={(e) => setAmount(e.target.value)}
                                        className="input-field"
                                        placeholder="0.00"
                                    />
                                </div>
                            </div>

                            <div className="space-y-1.5 text-xs text-gray-500 mb-4">
                                <div className="flex justify-between">
                                    <span>Margin value</span>
                                    <span className="font-mono">${USD(amountUsdBig)}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span>Notional (size)</span>
                                    <span className="font-mono">${USD(notionalUsdBig)}</span>
                                </div>
                                {config && (
                                    <div className="flex justify-between">
                                        <span>
                                            Insurance fee ({(Number(config.insuranceFeeBps) / 100).toFixed(2)}%)
                                        </span>
                                        <span className="font-mono">${USD(insuranceFeeUsdBig)}</span>
                                    </div>
                                )}
                            </div>

                            <div className="flex items-center gap-2 mb-4">
                                <button
                                    type="button"
                                    onClick={handleApprove}
                                    disabled={loading || !isConnected}
                                    className={clsx(
                                        "flex-1 secondary-button",
                                        (loading || !isConnected) && "opacity-50 cursor-not-allowed"
                                    )}
                                >
                                    Approve {marginInfo?.symbol || "USDC"}
                                </button>
                                <button
                                    type="button"
                                    onClick={handleOpen}
                                    disabled={loading || !canOpen}
                                    className={clsx(
                                        "flex-1 primary-button",
                                        (loading || !canOpen) && "opacity-50 cursor-not-allowed"
                                    )}
                                >
                                    {loading
                                        ? "Processing..."
                                        : needsApproval
                                        ? "Approve & Open"
                                        : "Open 0% Trade"}
                                </button>
                            </div>

                            {config && !config.whitelisted && (
                                <div className="text-xs text-red-400">
                                    Wallet is not whitelisted. Contact the protocol owner.
                                </div>
                            )}
                            {config &&
                                config.whitelisted &&
                                amountUsdBig > 0n &&
                                amountUsdBig < config.minInitialMarginUsd && (
                                    <div className="text-xs text-yellow-400">
                                        Minimum margin is ${USD(config.minInitialMarginUsd)}.
                                    </div>
                                )}
                            {config &&
                                config.whitelisted &&
                                notionalUsdBig > 0n &&
                                config.totalOpenNotionalUsd + notionalUsdBig > config.oiCapUsd && (
                                    <div className="text-xs text-yellow-400">
                                        This size exceeds the remaining OI cap.
                                    </div>
                                )}
                            {isConnected && marginInfo && (
                                <div className="text-[10px] text-gray-500">
                                    Balance:{" "}
                                    {formatTokenAmount(ethers.formatUnits(balance, decimals), marginInfo.symbol)}{" "}
                                    {marginInfo.symbol}
                                </div>
                            )}
                        </div>

                        {/* Position */}
                        <div className="p-4 rounded-xl bg-white/5 border border-white/10">
                            <h3 className="text-sm font-bold uppercase tracking-wider text-gray-300 mb-4">
                                My Position
                            </h3>
                            {!position ? (
                                <div className="text-center py-12 text-gray-500">
                                    No open synthetic position.
                                </div>
                            ) : (
                                <div className="space-y-3 text-sm">
                                    <div className="flex items-center gap-2">
                                        <span
                                            className={clsx(
                                                "text-xs px-2 py-0.5 rounded border font-bold",
                                                position.isLong
                                                    ? "border-green-500/50 text-green-400 bg-green-500/10"
                                                    : "border-red-500/50 text-red-400 bg-red-500/10"
                                            )}
                                        >
                                            {position.isLong ? "LONG" : "SHORT"} {Number(position.leverage)}x
                                        </span>
                                        {position.liquidatable && (
                                            <span className="text-xs px-2 py-0.5 rounded border border-red-500/60 text-red-300 bg-red-900/40 animate-pulse">
                                                LIQUIDATABLE
                                            </span>
                                        )}
                                    </div>
                                    <div className="grid grid-cols-2 gap-2 text-xs">
                                        <div className="text-gray-400">Size (WETH)</div>
                                        <div className="text-right font-mono">
                                            {formatTokenAmount(ethers.formatUnits(position.size, 18), "WETH")}
                                        </div>
                                        <div className="text-gray-400">Notional</div>
                                        <div className="text-right font-mono">${USD(position.notionalUsd)}</div>
                                        <div className="text-gray-400">Margin</div>
                                        <div className="text-right font-mono">${USD(position.marginUsd)}</div>
                                        <div className="text-gray-400">Entry TWAP</div>
                                        <div className="text-right font-mono">${USD(position.entryPrice)}</div>
                                        <div className="text-gray-400">Current TWAP</div>
                                        <div className="text-right font-mono">${USD(position.currentPriceUsd)}</div>
                                        <div className="text-gray-400">Est. PnL</div>
                                        <div
                                            className={clsx(
                                                "text-right font-mono",
                                                position.pnlUsd >= 0n ? "text-green-400" : "text-red-400"
                                            )}
                                        >
                                            {position.pnlUsd >= 0n ? "+" : "-"}$
                                            {USD(position.pnlUsd < 0n ? -position.pnlUsd : position.pnlUsd)}
                                        </div>
                                        <div className="text-gray-400">Equity</div>
                                        <div className="text-right font-mono">${USD(position.equityUsd)}</div>
                                        <div className="text-gray-400">Liquidation</div>
                                        <div className="text-right font-mono">${USD(position.maintenanceUsd)}</div>
                                    </div>
                                    <div>
                                        <div className="flex justify-between text-[10px] text-gray-500 mb-1">
                                            <span>Equity / Notional health</span>
                                            <span>{healthPct.toFixed(0)}%</span>
                                        </div>
                                        <div className="h-1.5 bg-black/40 rounded-full overflow-hidden">
                                            <div
                                                className={clsx(
                                                    "h-full rounded-full",
                                                    position.liquidatable
                                                        ? "bg-red-500"
                                                        : "bg-gradient-to-r from-amber-500 to-green-500"
                                                )}
                                                style={{ width: `${healthPct}%` }}
                                            />
                                        </div>
                                    </div>
                                    <div className="flex gap-2">
                                        <button
                                            type="button"
                                            onClick={handleSettle}
                                            disabled={loading}
                                            className="flex-1 primary-button disabled:opacity-50"
                                        >
                                            Settle
                                        </button>
                                        <button
                                            type="button"
                                            onClick={handleLiquidate}
                                            disabled={loading || !position.liquidatable}
                                            className={clsx(
                                                "flex-1 secondary-button",
                                                (loading || !position.liquidatable) &&
                                                    "opacity-50 cursor-not-allowed"
                                            )}
                                        >
                                            {position.liquidatable ? "Liquidate (keeper)" : "Not Liquidatable"}
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Insurance + risk */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
                        <div className="p-4 rounded-xl bg-white/5 border border-white/10">
                            <h3 className="text-sm font-bold uppercase tracking-wider text-gray-300 mb-4">
                                Fund Insurance Pool
                            </h3>
                            <div className="flex gap-2">
                                <input
                                    type="number"
                                    min="0"
                                    value={depositAmount}
                                    onChange={(e) => setDepositAmount(e.target.value)}
                                    className="input-field flex-1"
                                    placeholder={`Amount in ${marginInfo?.symbol || "USDC"}`}
                                />
                                <button
                                    type="button"
                                    onClick={handleDepositInsurance}
                                    disabled={loading || !isConnected || !depositAmount}
                                    className="secondary-button disabled:opacity-50"
                                >
                                    Deposit
                                </button>
                            </div>
                            <div className="text-[10px] text-gray-500 mt-2">
                                Anyone may deposit; the pool backs winners&apos; payouts and absorbs
                                socialized losses. Surplus withdrawals are owner-only.
                            </div>
                        </div>

                        <div className="p-4 rounded-xl bg-white/5 border border-white/10">
                            <h3 className="text-sm font-bold uppercase tracking-wider text-gray-300 mb-3">
                                Risk Parameters
                            </h3>
                            <div className="grid grid-cols-2 gap-2 text-xs">
                                {config && (
                                    <>
                                        <div className="text-gray-400">Max leverage</div>
                                        <div className="text-right font-mono">
                                            {Number(config.maxLeverage)}x
                                        </div>
                                        <div className="text-gray-400">Maintenance margin</div>
                                        <div className="text-right font-mono">
                                            {(Number(config.maintenanceMarginBps) / 100).toFixed(1)}%
                                        </div>
                                        <div className="text-gray-400">Liquidation fee</div>
                                        <div className="text-right font-mono">
                                            {(Number(config.liquidationFeeBps) / 100).toFixed(1)}%
                                        </div>
                                        <div className="text-gray-400">Insurance fee (open)</div>
                                        <div className="text-right font-mono">
                                            {(Number(config.insuranceFeeBps) / 100).toFixed(2)}%
                                        </div>
                                        <div className="text-gray-400">Min initial margin</div>
                                        <div className="text-right font-mono">
                                            ${USD(config.minInitialMarginUsd)}
                                        </div>
                                        <div className="text-gray-400">Max oracle age</div>
                                        <div className="text-right font-mono">
                                            {Number(config.maxOracleAge)}s
                                        </div>
                                        <div className="text-gray-400">Whitelisted</div>
                                        <div
                                            className={clsx(
                                                "text-right font-mono",
                                                config.whitelisted ? "text-green-400" : "text-red-400"
                                            )}
                                        >
                                            {config.whitelisted ? "Yes" : "No"}
                                        </div>
                                    </>
                                )}
                            </div>
                        </div>
                    </div>

                    {status && (
                        <div className="mt-4 p-3 bg-white/5 rounded border border-white/10 text-xs font-mono break-all">
                            {status}
                        </div>
                    )}
                </>
            )}
        </div>
    )
}
