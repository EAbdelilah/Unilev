"use client";

import React, { useState } from "react";

const UNICHAIN_ID = 130;
const UNICHAIN_SEPOLIA_ID = 1301;
const POLYGON_ID = 137;

const PAIR_CONFIG = {
    WETH: {
        label: "ETH/USDC",
        symbol: "ETH",
        emoji: "⟠",
        color: "#a5b4fc",
        [UNICHAIN_ID]: "0x8927058918e3CFf6F55EfE45A58db1be1F069E49",
        [UNICHAIN_SEPOLIA_ID]: "0x8927058918e3CFf6F55EfE45A58db1be1F069E49",
        [POLYGON_ID]: "0x853Ee4b2A13f8a742d64C8F088bE7bA2131f670d",
    },
    WBTC: {
        label: "BTC/USDC",
        symbol: "BTC",
        emoji: "₿",
        color: "#fde68a",
        [UNICHAIN_ID]: "0xbd0f3a7cf4cf5f48ebe850474c8c0012fa5fe893ab811a8b8743a52b83aa8939",
        [UNICHAIN_SEPOLIA_ID]: "0xbd0f3a7cf4cf5f48ebe850474c8c0012fa5fe893ab811a8b8743a52b83aa8939",
        [POLYGON_ID]: "0xeEF1A9507B3D505f0062f2be9453981255b503c8",
    },
};

function networkFor(chainId) {
    return chainId === POLYGON_ID ? "polygon" : "unichain";
}

function pairFor(tokenKey, chainId) {
    const cfg = PAIR_CONFIG[tokenKey] || PAIR_CONFIG["WETH"];
    const pairAddress = cfg[chainId] || cfg[UNICHAIN_ID];
    return { label: cfg.label, symbol: cfg.symbol, emoji: cfg.emoji, color: cfg.color, pairAddress };
}

export function LiveChart({ tokenKey = "WETH", chainId, onTokenChange }) {
    const network = networkFor(chainId);
    const { label, symbol, emoji, color, pairAddress } = pairFor(tokenKey, chainId);
    const [loaded, setLoaded] = useState(false);

    const params = new URLSearchParams({
        embed: "1",
        theme: "dark",
        chartTheme: "dark",
        chartType: "usd",
        interval: "15",
        trades: "0",
        info: "0",
        chartLeftToolbar: "0",
    });

    const embedSrc = `https://dexscreener.com/${network}/${pairAddress}?${params}`;
    const openUrl  = `https://dexscreener.com/${network}/${pairAddress}`;

    return (
        <div className="glass-panel w-full" style={{ overflow: 'hidden' }}>
            {/* Chart header */}
            <div style={{
                padding: '0.875rem 1.25rem',
                borderBottom: '1px solid rgba(255,255,255,0.06)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                background: 'rgba(0,0,0,0.2)',
            }}>
                {/* Pair label */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <div style={{
                        width: 32, height: 32, borderRadius: '8px',
                        background: 'rgba(255,255,255,0.06)',
                        border: '1px solid rgba(255,255,255,0.1)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: '1rem', color,
                    }}>
                        {emoji}
                    </div>
                    <div>
                        <div style={{ fontWeight: 800, fontSize: '0.95rem', color: 'var(--text-primary)', letterSpacing: '-0.01em' }}>
                            {label}
                        </div>
                        <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                            {network} · 15m
                        </div>
                    </div>
                </div>

                {/* Controls */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    {/* Live badge */}
                    <div style={{
                        display: 'flex', alignItems: 'center', gap: '0.35rem',
                        background: 'rgba(16,185,129,0.1)',
                        border: '1px solid rgba(16,185,129,0.25)',
                        borderRadius: '9999px',
                        padding: '0.25rem 0.65rem',
                        fontSize: '0.65rem', fontWeight: 700, color: 'var(--green-light)',
                        letterSpacing: '0.08em', textTransform: 'uppercase',
                    }}>
                        <span className="animate-live" style={{
                            width: 6, height: 6, borderRadius: '50%',
                            background: 'var(--green)',
                            boxShadow: '0 0 6px var(--green)',
                            display: 'inline-block',
                        }} />
                        Live
                    </div>

                    <a
                        href={openUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                            fontSize: '0.7rem', color: 'var(--text-muted)',
                            textDecoration: 'none',
                            background: 'rgba(255,255,255,0.05)',
                            border: '1px solid rgba(255,255,255,0.08)',
                            borderRadius: '6px',
                            padding: '0.25rem 0.6rem',
                            transition: 'all 0.18s',
                        }}
                    >
                        ↗ DexScreener
                    </a>
                </div>
            </div>

            {/* Token selector tabs */}
            {onTokenChange && (
                <div style={{
                    display: 'flex',
                    gap: '0.5rem',
                    padding: '0.6rem 1.25rem',
                    borderBottom: '1px solid rgba(255,255,255,0.05)',
                    background: 'rgba(0,0,0,0.12)',
                }}>
                    {Object.keys(PAIR_CONFIG).map((key) => {
                        const cfg = PAIR_CONFIG[key];
                        const isActive = tokenKey === key;
                        return (
                            <button
                                key={key}
                                type="button"
                                onClick={() => onTokenChange(key)}
                                style={{
                                    display: 'flex', alignItems: 'center', gap: '0.35rem',
                                    padding: '0.35rem 0.85rem',
                                    borderRadius: '8px',
                                    border: `1px solid ${isActive ? `${cfg.color}55` : 'rgba(255,255,255,0.08)'}`,
                                    background: isActive ? `${cfg.color}15` : 'transparent',
                                    color: isActive ? cfg.color : 'var(--text-muted)',
                                    fontSize: '0.78rem',
                                    fontWeight: 700,
                                    cursor: 'pointer',
                                    transition: 'all 0.18s',
                                    textTransform: 'uppercase',
                                    letterSpacing: '0.05em',
                                }}
                            >
                                <span>{cfg.emoji}</span>
                                {cfg.label}
                            </button>
                        );
                    })}
                </div>
            )}

            {/* Chart iframe */}
            <div style={{ position: 'relative', width: '100%', height: 420 }}>
                {!loaded && (
                    <div style={{
                        position: 'absolute', inset: 0, zIndex: 0,
                        display: 'grid', placeItems: 'center',
                        background: '#0b0e14',
                    }}>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.75rem' }}>
                            <div style={{
                                width: 28, height: 28,
                                border: '2px solid rgba(6,182,212,0.2)',
                                borderTopColor: 'var(--cyan)',
                                borderRadius: '50%',
                                animation: 'spin 0.8s linear infinite',
                            }} />
                            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                                Loading {label} chart…
                            </span>
                            <a
                                href={openUrl} target="_blank" rel="noopener noreferrer"
                                style={{ fontSize: '0.72rem', color: 'var(--cyan-light)', textDecoration: 'none' }}
                            >
                                Open on DexScreener ↗
                            </a>
                        </div>
                    </div>
                )}
                <iframe
                    src={embedSrc}
                    onLoad={() => setLoaded(true)}
                    style={{ width: '100%', height: '100%', border: 'none', position: 'relative', zIndex: 1 }}
                    title={`${label} Price Chart`}
                />
            </div>
        </div>
    );
}