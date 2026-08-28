
'use client';

import { ConnectButton } from '@/components/ConnectButton';
import { Balances } from '@/components/Balances';
import { TradeForm } from '@/components/TradeForm';
import { PositionsList } from '@/components/PositionsList';
import { AdminToggle } from '@/components/AdminToggle';
import { LiveChart } from '@/components/LiveChart';
import { useAdmin } from '@/contexts/AdminContext';
import { useAccount } from 'wagmi';
import Link from 'next/link';
import { useState } from 'react';

export default function Home() {
    const { isAdmin } = useAdmin();
    const { chainId } = useAccount();
    const [activeChartToken, setActiveChartToken] = useState("WETH");

    return (
        <main style={{ minHeight: '100vh', padding: '1.5rem', maxWidth: '1600px', margin: '0 auto' }}>

            {/* ── Header ─────────────────────────────────────────────── */}
            <header style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '1.75rem',
                padding: '0.75rem 1.25rem',
                background: 'rgba(255,255,255,0.04)',
                backdropFilter: 'blur(20px)',
                WebkitBackdropFilter: 'blur(20px)',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: '16px',
                boxShadow: '0 1px 0 rgba(255,255,255,0.06) inset, 0 8px 32px rgba(0,0,0,0.4)',
            }}>
                {/* Brand */}
                <div className="flex items-center gap-3">
                    <div style={{
                        width: 36, height: 36,
                        borderRadius: '10px',
                        background: 'linear-gradient(135deg, #7c3aed, #06b6d4)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        boxShadow: '0 0 16px rgba(124,58,237,0.4)',
                        flexShrink: 0,
                    }}>
                        <img src="/logo.png" alt="Eswap" style={{ width: 28, height: 28, borderRadius: 7, objectFit: 'contain' }} />
                    </div>
                    <div>
                        <div style={{
                            fontWeight: 900,
                            fontSize: '1.15rem',
                            letterSpacing: '-0.01em',
                            background: 'linear-gradient(135deg, #a78bfa, #67e8f9)',
                            WebkitBackgroundClip: 'text',
                            WebkitTextFillColor: 'transparent',
                            backgroundClip: 'text',
                        }}>
                            ESWAP
                        </div>
                        <div style={{ fontSize: '0.62rem', color: 'var(--text-muted)', letterSpacing: '0.12em', textTransform: 'uppercase', marginTop: '-1px' }}>
                            0% Interest Margin
                        </div>
                    </div>
                </div>

                {/* Nav + Connect */}
                <div className="flex items-center gap-3">
                    <AdminToggle />

                    {isAdmin && (
                        <Link href="/admin" className="nav-link" style={{
                            color: 'var(--text-muted)',
                            borderColor: 'rgba(255,255,255,0.08)',
                        }}>
                            ⚙ Admin
                        </Link>
                    )}

                    <Link href="/swap" className="nav-link" style={{
                        color: 'var(--purple-light)',
                        borderColor: 'rgba(124,58,237,0.25)',
                        background: 'rgba(124,58,237,0.08)',
                    }}>
                        ⇄ Swap
                    </Link>

                    <Link href="/pools" className="nav-link hide-mobile" style={{
                        color: 'var(--green-light)',
                        borderColor: 'rgba(16,185,129,0.25)',
                        background: 'rgba(16,185,129,0.08)',
                    }}>
                        💧 Earn
                    </Link>

                    <Link href="/adapter" className="nav-link hide-mobile" style={{
                        color: 'var(--cyan-light)',
                        borderColor: 'rgba(6,182,212,0.25)',
                        background: 'rgba(6,182,212,0.08)',
                    }}>
                        ⚡ Adapter
                    </Link>

                    <Link href="/settlement" className="nav-link hide-mobile" style={{
                        color: '#6ee7b7',
                        borderColor: 'rgba(16,185,129,0.25)',
                        background: 'rgba(16,185,129,0.06)',
                    }}>
                        ✓ Settle
                    </Link>

                    <ConnectButton />
                </div>
            </header>

            {/* ── Protocol Stats Bar ─────────────────────────────────── */}
            <div style={{
                display: 'flex',
                gap: '1rem',
                marginBottom: '1.5rem',
                padding: '0.65rem 1.25rem',
                background: 'rgba(0,0,0,0.25)',
                border: '1px solid rgba(255,255,255,0.06)',
                borderRadius: '12px',
                overflowX: 'auto',
            }}>
                {[
                    { label: 'Interest Rate', value: '0%', color: 'var(--green-light)', glow: 'rgba(16,185,129,0.3)' },
                    { label: 'Protocol', value: 'Uniswap V4', color: 'var(--purple-light)', glow: '' },
                    { label: 'Network', value: 'Unichain', color: 'var(--cyan-light)', glow: '' },
                    { label: 'Max Leverage', value: '5×', color: 'var(--amber-light)', glow: '' },
                    { label: 'Oracle', value: 'Chainlink', color: '#94a3b8', glow: '' },
                ].map((s, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0 }}>
                        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                            {s.label}
                        </span>
                        <span style={{
                            fontSize: '0.75rem',
                            fontWeight: 700,
                            color: s.color,
                            textShadow: s.glow ? `0 0 12px ${s.glow}` : 'none',
                        }}>
                            {s.value}
                        </span>
                        {i < 4 && <span style={{ color: 'rgba(255,255,255,0.1)', marginLeft: '0.5rem' }}>│</span>}
                    </div>
                ))}
            </div>

            {/* ── Dashboard Grid ─────────────────────────────────────── */}
            <div className="grid lg:grid-cols-3 gap-6" style={{ alignItems: 'start' }}>

                {/* Left column: Chart + Positions */}
                <div className="lg:col-span-2 w-full" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                    <LiveChart
                        tokenKey={activeChartToken}
                        chainId={chainId}
                        onTokenChange={setActiveChartToken}
                    />
                    <PositionsList />
                </div>

                {/* Right column: Trade form + Balances */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', width: '100%' }}>
                    <TradeForm onTradingTokenChange={setActiveChartToken} />
                    <Balances />
                </div>
            </div>

            {/* ── Footer ────────────────────────────────────────────── */}
            <footer style={{
                marginTop: '2.5rem',
                padding: '1rem',
                textAlign: 'center',
                fontSize: '0.7rem',
                color: 'var(--text-muted)',
                letterSpacing: '0.04em',
                borderTop: '1px solid rgba(255,255,255,0.05)',
            }}>
                Eswap Protocol · Uniswap V4 · Powered by Chainlink · 0% Interest Margin Trading
            </footer>
        </main>
    );
}
