import { useEffect, useState, useCallback } from "react"
import { useDeFi } from "../hooks/useDeFi"
import { useAccount } from "wagmi"
import clsx from "clsx"
import { formatContractError, isUserCancellation } from "../utils/formatContractError"
import { useAdmin } from "../contexts/AdminContext"
import { formatTokenAmount } from "../utils/format"

export function PositionsList() {
    const { isConnected, address } = useAccount()
    const { getPositionsCount, getPositionDetails, closePosition } = useDeFi()
    const { isAdmin } = useAdmin()

    const [activeTab, setActiveTab] = useState("my") // 'my' | 'global'
    const [positions, setPositions] = useState([])
    const [loading, setLoading] = useState(false)
    const [lastUpdated, setLastUpdated] = useState(null)

    // Force tab back to 'my' if admin mode is toggled off
    useEffect(() => {
        if (!isAdmin && activeTab === "global") {
            setActiveTab("my");
        }
    }, [isAdmin, activeTab]);

    const fetchPositions = useCallback(async () => {
        setLoading(true)
        try {
            const count = await getPositionsCount()

            const maxId = Number(count)

            // Fetch position details
            const promises = []
            for (let i = 1; i < maxId; i++) {
                promises.push(getPositionDetails(i, address))
            }

            const results = await Promise.all(promises)

            // Filter out nulls (burned/closed)
            const activePositions = results.filter((p) => p !== null && p.state !== "NONE")

            setPositions(activePositions)
            setLastUpdated(new Date())
        } catch (error) {
            console.error("Failed to fetch positions", error)
        } finally {
            setLoading(false)
        }
    }, [getPositionsCount, getPositionDetails, address])

    useEffect(() => {
        fetchPositions()
        const interval = setInterval(fetchPositions, 30000) // 30s refresh
        return () => clearInterval(interval)
    }, [address])

    const filteredPositions = positions.filter((p) => {
        if (activeTab === "global") return true
        if (activeTab === "my" && address) {
            return p.owner.toLowerCase() === address.toLowerCase()
        }
        return false
    })

    return (
        <div className="glass-panel p-6 w-full lg:col-span-2">
            <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-emerald-400">
                    Positions
                </h2>
                <div className="flex bg-black/40 rounded-lg p-1 border border-white/10">
                    <button
                        onClick={() => setActiveTab("my")}
                        className={clsx(
                            "px-4 py-1 rounded text-sm font-bold transition-all",
                            activeTab === "my"
                                ? "bg-white/10 text-white"
                                : "text-gray-500 hover:text-white"
                        )}
                    >
                        My Positions
                    </button>
                    {isAdmin && (
                        <button
                            onClick={() => setActiveTab("global")}
                            className={clsx(
                                "px-4 py-1 rounded text-sm font-bold transition-all",
                                activeTab === "global"
                                    ? "bg-white/10 text-white"
                                    : "text-gray-500 hover:text-white"
                            )}
                        >
                            Global
                        </button>
                    )}
                </div>
            </div>

            {/* List */}
            <div className="space-y-3 max-h-[500px] overflow-y-auto pr-2 custom-scrollbar">
                {loading && positions.length === 0 ? (
                    <div className="text-center py-10 text-gray-500 animate-pulse">
                        Loading positions...
                    </div>
                ) : (
                    filteredPositions.map((pos) => (
                        <PositionCard
                            key={pos.id}
                            position={pos}
                            isOwner={address && pos.owner.toLowerCase() === address.toLowerCase()}
                            onClose={() => closePosition(pos.id)}
                        />
                    ))
                )}

                {!loading && filteredPositions.length === 0 && (
                    <div className="text-center py-10 text-gray-500">
                        No active positions found.
                    </div>
                )}
            </div>

            {lastUpdated && (
                <div className="text-right text-xs text-gray-600 mt-2">
                    Last updated: {lastUpdated.toLocaleTimeString()}
                </div>
            )}
        </div>
    )
}

function PositionCard({ position, isOwner, onClose }) {
    const [closing, setClosing] = useState(false)

    const handleClose = async () => {
        if (!confirm(`Close Position ${position.id}?`)) return
        setClosing(true)
        try {
            const tx = await onClose()
            if (tx && tx.wait) {
                await tx.wait()
                alert("Position closed successfully!")
            }
        } catch (e) {
            console.error(e)
            if (isUserCancellation(e)) {
                alert("Transaction was canceled by user.")
            } else {
                const friendlyError = formatContractError(e)
                alert(`Failed to close position: ${friendlyError}`)
            }
        } finally {
            setClosing(false)
        }
    }

    return (
        <div className="p-4 rounded-xl bg-white/5 border border-white/5 hover:border-white/20 transition-all group">
            <div className="flex justify-between items-start">
                <div className="flex gap-3 items-center">
                    <div
                        className={clsx(
                            "w-2 h-12 rounded-full",
                            position.isShort
                                ? "bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.5)]"
                                : "bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.5)]"
                        )}
                    ></div>
                    <div>
                        <div className="flex items-center gap-2">
                            <span className="font-bold text-lg">#{position.id}</span>
                            <span
                                className={clsx(
                                    "text-xs px-2 py-0.5 rounded border",
                                    position.isShort
                                        ? "border-red-500/50 text-red-400 bg-red-500/10"
                                        : "border-green-500/50 text-green-400 bg-green-500/10"
                                )}
                            >
                                {position.isShort ? "SHORT" : "LONG"} {position.leverage}x
                            </span>
                        </div>
                        <div className="text-sm text-gray-400 mt-1">
                            {position.size} {position.baseSymbol}
                            <span className="text-xs text-gray-600 ml-1">
                                (~${position.sizeUsd})
                            </span>
                        </div>
                        {/* PnL Display */}
                        <div
                            className={clsx(
                                "text-sm mt-1 font-mono",
                                position.pnlIsPositive ? "text-green-400" : "text-red-400"
                            )}
                        >
                            {position.pnlIsPositive ? "+" : "-"}
                            {formatTokenAmount(position.pnl, position.isShort ? position.quoteSymbol : position.baseSymbol)} {position.isShort ? position.quoteSymbol : position.baseSymbol}
                            <span
                                className={clsx(
                                    "text-xs ml-1",
                                    position.pnlIsPositive ? "text-green-500" : "text-red-500"
                                )}
                            >
                                ({position.pnlIsPositive ? "+" : "-"}${position.pnlUsd})
                            </span>
                        </div>
                        {/* Price Info - Compact inline format */}
                        {(() => {
                            const current = parseFloat(position.currentPrice)
                            const entry = parseFloat(position.entryPrice)
                            const isProfitable = position.isShort
                                ? current < entry
                                : current > entry
                            return (
                                <div className="text-xs text-gray-500 mt-1">
                                    {position.baseSymbol}: {formatTokenAmount(position.currentPrice, position.quoteSymbol)}{" "}
                                    {position.quoteSymbol} | {position.isShort ? "BELOW" : "ABOVE"}{" "}
                                    {formatTokenAmount(position.entryPrice, position.quoteSymbol)} {position.quoteSymbol}{" "}
                                    {isProfitable ? "✅" : "⏳"}
                                </div>
                            )
                        })()}
                    </div>
                </div>

                <div className="flex flex-col items-end gap-2">
                    <div
                        className={clsx(
                            "px-2 py-1 rounded text-xs",
                            position.state === "LIQUIDATABLE"
                                ? "bg-red-900/50 text-red-200 border border-red-500"
                                : "bg-white/10 text-gray-300"
                        )}
                    >
                        {position.state}
                    </div>

                    <button
                        onClick={handleClose}
                        disabled={closing}
                        className="opacity-0 group-hover:opacity-100 transition-opacity bg-red-500/20 hover:bg-red-500/40 text-red-300 text-xs px-3 py-1 rounded border border-red-500/30"
                    >
                        {closing ? "..." : "Close"}
                    </button>
                </div>
            </div>
        </div>
    )
}
