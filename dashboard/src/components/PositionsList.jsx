import { useEffect, useState, useCallback } from "react"
import { useDeFi } from "../hooks/useDeFi"
import { useAccount } from "wagmi"
import clsx from "clsx"
import { formatContractError, isUserCancellation } from "../utils/formatContractError"
import { useAdmin } from "../contexts/AdminContext"
import { formatTokenAmount } from "../utils/format"

export function PositionsList() {
    const { isConnected, address } = useAccount()
    const { getPositionsCount, getPositionDetails, closePosition, isV4, SUPPORTED_TOKENS_LIST } = useDeFi()
    const { isAdmin } = useAdmin()

    const [activeTab, setActiveTab] = useState("my") // 'my' | 'global'
    const [positions, setPositions] = useState([])
    const [loading, setLoading] = useState(false)
    const [lastUpdated, setLastUpdated] = useState(null)

    useEffect(() => {
        if (!isAdmin && activeTab === "global") setActiveTab("my")
    }, [isAdmin, activeTab])

    const fetchPositions = useCallback(async () => {
        setLoading(true)
        try {
            let results = []
            if (isV4) {
                const pools = SUPPORTED_TOKENS_LIST.filter((t) => t.key !== "USDC")
                const perPool = await Promise.all(
                    pools.map(async (p) => {
                        const count = Number(await getPositionsCount(p.key))
                        const ids = Array.from({ length: count }, (_, i) => i + 1)
                        const details = await Promise.all(ids.map((i) => getPositionDetails(i, address, p.key)))
                        return details
                    })
                )
                results = perPool.flat()
            } else {
                const count = await getPositionsCount()
                const maxId = Number(count)
                const promises = []
                for (let i = 1; i < maxId; i++) promises.push(getPositionDetails(i, address))
                results = await Promise.all(promises)
            }
            const activePositions = results.filter((p) => p !== null && p.state !== "NONE")
            setPositions(activePositions)
            setLastUpdated(new Date())
        } catch (error) {
            console.error("Failed to fetch positions", error)
        } finally {
            setLoading(false)
        }
    }, [getPositionsCount, getPositionDetails, address, isV4, SUPPORTED_TOKENS_LIST])

    useEffect(() => {
        fetchPositions()
        const interval = setInterval(fetchPositions, 30000)
        return () => clearInterval(interval)
    }, [address])

    const filteredPositions = positions.filter((p) => {
        if (activeTab === "global") return true
        if (activeTab === "my" && address) return p.owner.toLowerCase() === address.toLowerCase()
        return false
    })

    return (
        <div className="glass-panel p-6 w-full">
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <h2 className="section-heading text-gradient-green-cyan">
                        Positions
                    </h2>
                    {positions.length > 0 && (
                        <span className="stat-pill neon-badge-cyan">
                            {filteredPositions.length} Active
                        </span>
                    )}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    {/* Refresh */}
                    <button
                        onClick={fetchPositions}
                        style={{
                            background: 'none',
                            border: '1px solid rgba(255,255,255,0.08)',
                            borderRadius: '8px',
                            color: loading ? 'var(--cyan-light)' : 'var(--text-muted)',
                            cursor: 'pointer',
                            padding: '0.3rem 0.7rem',
                            fontSize: '0.75rem',
                            transition: 'all 0.2s',
                            display: 'flex', alignItems: 'center', gap: '0.35rem',
                        }}
                        title="Refresh positions"
                    >
                        <span style={{ display: 'inline-block', ...(loading ? { animation: 'spin 0.8s linear infinite' } : {}) }}>↻</span>
                        {loading ? 'Loading…' : 'Refresh'}
                    </button>

                    {/* Tab bar */}
                    <div className="tab-bar">
                        <button
                            onClick={() => setActiveTab("my")}
                            className={clsx("tab-btn", activeTab === "my" && "active")}
                        >
                            My
                        </button>
                        {isAdmin && (
                            <button
                                onClick={() => setActiveTab("global")}
                                className={clsx("tab-btn", activeTab === "global" && "active")}
                            >
                                Global
                            </button>
                        )}
                    </div>
                </div>
            </div>

            {/* Skeleton loader */}
            {loading && positions.length === 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    {[1, 2, 3].map((i) => (
                        <div key={i} className="animate-shimmer" style={{
                            height: 80, borderRadius: 'var(--r-lg)',
                            border: '1px solid rgba(255,255,255,0.05)',
                        }} />
                    ))}
                </div>
            )}

            {/* Position list */}
            {(!loading || positions.length > 0) && (
                <div
                    className="custom-scrollbar"
                    style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', maxHeight: 500, overflowY: 'auto', paddingRight: '0.25rem' }}
                >
                    {filteredPositions.map((pos) => (
                        <PositionCard
                            key={pos.id}
                            position={pos}
                            isOwner={address && pos.owner.toLowerCase() === address.toLowerCase()}
                            onClose={() => closePosition(pos.id)}
                        />
                    ))}

                    {!loading && filteredPositions.length === 0 && (
                        <div style={{
                            textAlign: 'center',
                            padding: '3rem 1rem',
                            color: 'var(--text-muted)',
                        }}>
                            <div style={{ fontSize: '2rem', marginBottom: '0.5rem', opacity: 0.4 }}>◎</div>
                            <div style={{ fontSize: '0.875rem' }}>No active positions found.</div>
                            <div style={{ fontSize: '0.75rem', marginTop: '0.25rem', color: 'var(--text-dim)' }}>
                                Open a position on the right to get started.
                            </div>
                        </div>
                    )}
                </div>
            )}

            {lastUpdated && (
                <div style={{ textAlign: 'right', fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: '0.75rem' }}>
                    Updated {lastUpdated.toLocaleTimeString()}
                </div>
            )}
        </div>
    )
}

function PositionCard({ position, isOwner, onClose }) {
    const [closing, setClosing] = useState(false)
    const [hovered, setHovered] = useState(false)

    const handleClose = async () => {
        if (!confirm(`Close position?`)) return
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
                alert("Transaction was canceled.")
            } else {
                alert(`Failed to close: ${formatContractError(e)}`)
            }
        } finally {
            setClosing(false)
        }
    }

    const current = parseFloat(position.currentPrice)
    const entry   = parseFloat(position.entryPrice)
    const isProfitable = position.isShort ? current < entry : current > entry

    return (
        <div
            className={clsx("position-card", position.isShort ? "short-card" : "long-card")}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
        >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                {/* Left: direction + details */}
                <div style={{ display: 'flex', gap: '0.875rem', alignItems: 'flex-start', paddingLeft: '0.5rem' }}>
                    <div>
                        {/* Title row */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.3rem' }}>
                            <span className={clsx("stat-pill", position.isShort ? "neon-badge-red" : "neon-badge-green")}>
                                {position.isShort ? "↓ SHORT" : "↑ LONG"} {position.leverage}×
                            </span>
                            <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem', fontFamily: 'var(--font-mono)' }}>
                                {position.baseSymbol}/{position.quoteSymbol}
                            </span>
                        </div>

                        {/* Size */}
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '0.2rem' }}>
                            Size:{' '}
                            <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
                                {position.size} {position.baseSymbol}
                            </span>
                            <span style={{ color: 'var(--text-muted)', fontSize: '0.7rem', marginLeft: '0.4rem' }}>
                                (~${position.sizeUsd})
                            </span>
                        </div>

                        {/* P&L */}
                        <div style={{
                            fontSize: '0.875rem',
                            fontFamily: 'var(--font-mono)',
                            fontWeight: 700,
                            color: position.pnlIsPositive ? 'var(--green-light)' : 'var(--red-light)',
                            display: 'flex', alignItems: 'center', gap: '0.35rem',
                        }}>
                            <span style={{
                                fontSize: '0.7rem',
                                padding: '0.1rem 0.3rem',
                                borderRadius: '4px',
                                background: position.pnlIsPositive ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)',
                            }}>
                                {position.pnlIsPositive ? '▲ +' : '▼ -'}
                                {formatTokenAmount(position.pnl, position.isShort ? position.quoteSymbol : position.baseSymbol)}{' '}
                                {position.isShort ? position.quoteSymbol : position.baseSymbol}
                            </span>
                            <span style={{
                                fontSize: '0.7rem',
                                color: position.pnlIsPositive ? 'var(--green)' : 'var(--red)',
                            }}>
                                ({position.pnlIsPositive ? '+' : '-'}${position.pnlUsd})
                            </span>
                        </div>

                        {/* Price line */}
                        <div style={{ marginTop: '0.35rem', fontSize: '0.7rem', color: 'var(--text-muted)', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                            <span>Current: <span style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>{formatTokenAmount(position.currentPrice, position.quoteSymbol)} {position.quoteSymbol}</span></span>
                            <span style={{ color: 'rgba(255,255,255,0.1)' }}>|</span>
                            <span>Entry: <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>{formatTokenAmount(position.entryPrice, position.quoteSymbol)}</span></span>
                            <span>{isProfitable ? '✅' : '⏳'}</span>
                        </div>
                    </div>
                </div>

                {/* Right: state + close btn */}
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.5rem' }}>
                    <span className={clsx(
                        "stat-pill",
                        position.state === "LIQUIDATABLE" ? "neon-badge-red" : "neon-badge-cyan"
                    )}>
                        {position.state === "LIQUIDATABLE" ? "⚠ LIQD" : position.state}
                    </span>

                    {isOwner && (
                        <button
                            onClick={handleClose}
                            disabled={closing}
                            style={{
                                opacity: hovered ? 1 : 0,
                                transition: 'opacity 0.2s, background 0.2s',
                                background: closing ? 'rgba(239,68,68,0.3)' : 'rgba(239,68,68,0.15)',
                                border: '1px solid rgba(239,68,68,0.4)',
                                borderRadius: '8px',
                                color: 'var(--red-light)',
                                fontSize: '0.75rem',
                                fontWeight: 700,
                                padding: '0.3rem 0.75rem',
                                cursor: closing ? 'not-allowed' : 'pointer',
                                letterSpacing: '0.04em',
                            }}
                        >
                            {closing ? '…' : 'Close'}
                        </button>
                    )}
                </div>
            </div>
        </div>
    )
}
