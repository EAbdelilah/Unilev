'use client';

import { useAccount, useConnect, useDisconnect, useSwitchChain } from 'wagmi';
import { polygon, unichain, unichainSepolia } from 'wagmi/chains';
import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

const SUPPORTED_CHAINS = [unichain, polygon, unichainSepolia];

// Custom metadata mapping for recognized wallets
const WALLET_META = {
    metaMask: {
        label: 'MetaMask',
        subtitle: 'Browser Extension · Primary Wallet',
        icon: '🦊',
        color: '#f97316',
        glow: 'rgba(249,115,22,0.35)',
        order: 1,
    },
    injected: {
        label: 'Browser Wallet',
        subtitle: 'Brave · Rabby · Frame · Extension',
        icon: '🌐',
        color: '#38bdf8',
        glow: 'rgba(56,189,248,0.25)',
        order: 2,
    },
    walletConnect: {
        label: 'WalletConnect',
        subtitle: '200+ mobile wallets via QR code',
        icon: '🔗',
        color: '#3b82f6',
        glow: 'rgba(59,130,246,0.30)',
        order: 3,
    },
    coinbaseWallet: {
        label: 'Coinbase Wallet',
        subtitle: 'Smart Wallet · Passkey / App',
        icon: '🔵',
        color: '#2563eb',
        glow: 'rgba(37,99,235,0.30)',
        order: 4,
    },
    safe: {
        label: 'Safe (Multi-sig)',
        subtitle: 'Gnosis Safe · DAO & Treasury',
        icon: '🔐',
        color: '#22c55e',
        glow: 'rgba(34,197,94,0.30)',
        order: 5,
    },
};

function getConnectorMeta(connector) {
    const id = (connector.id || '').toLowerCase();
    const name = (connector.name || '').toLowerCase();

    if (id.includes('metamask') || name.includes('metamask') || id === 'io.metamask') {
        return {
            ...WALLET_META.metaMask,
            label: 'MetaMask',
            iconUrl: connector.icon,
        };
    }
    if (id.includes('walletconnect')) {
        return {
            ...WALLET_META.walletConnect,
            iconUrl: connector.icon,
        };
    }
    if (id.includes('coinbase')) {
        return {
            ...WALLET_META.coinbaseWallet,
            iconUrl: connector.icon,
        };
    }
    if (id.includes('safe') || id.includes('gnosis')) {
        return {
            ...WALLET_META.safe,
            iconUrl: connector.icon,
        };
    }
    if (name.includes('brave')) {
        return {
            label: connector.name || 'Brave Wallet',
            subtitle: 'Brave Browser Native Wallet',
            icon: '🦁',
            color: '#fb923c',
            glow: 'rgba(251,146,60,0.25)',
            order: 2,
            iconUrl: connector.icon,
        };
    }
    if (name.includes('rabby')) {
        return {
            label: 'Rabby Wallet',
            subtitle: 'Game-ready Multi-chain Wallet',
            icon: '🐰',
            color: '#818cf8',
            glow: 'rgba(129,140,248,0.25)',
            order: 2,
            iconUrl: connector.icon,
        };
    }

    return {
        label: connector.name || 'Injected Wallet',
        subtitle: 'Browser Extension',
        icon: '💼',
        color: '#94a3b8',
        glow: 'rgba(148,163,184,0.20)',
        order: 3,
        iconUrl: connector.icon,
    };
}

function chainName(chainId) {
    if (chainId === unichain.id) return 'Unichain';
    if (chainId === polygon.id) return 'Polygon';
    if (chainId === unichainSepolia.id) return 'Unichain Sepolia';
    return 'Unknown';
}

function chainColor(chainId) {
    if (chainId === unichain.id) return '#67e8f9';
    if (chainId === polygon.id) return '#a78bfa';
    if (chainId === unichainSepolia.id) return '#6ee7b7';
    return '#94a3b8';
}

export function ConnectButton() {
    const { address, isConnected, chainId, connector: activeConnector } = useAccount();
    const { connectors, connect, isPending, error: connectError } = useConnect();
    const { disconnect } = useDisconnect();
    const { switchChain } = useSwitchChain();

    const [showModal, setShowModal] = useState(false);
    const [showChainMenu, setShowChainMenu] = useState(false);
    const [connectingId, setConnectingId] = useState(null);
    const [mounted, setMounted] = useState(false);
    const modalRef = useRef(null);
    const chainMenuRef = useRef(null);

    useEffect(() => {
        setMounted(true);
    }, []);

    const isCorrectNetwork = SUPPORTED_CHAINS.some(c => c.id === chainId);

    // Close on outside click
    useEffect(() => {
        function handleClick(e) {
            if (modalRef.current && !modalRef.current.contains(e.target)) setShowModal(false);
            if (chainMenuRef.current && !chainMenuRef.current.contains(e.target)) setShowChainMenu(false);
        }
        document.addEventListener('mousedown', handleClick);
        return () => document.removeEventListener('mousedown', handleClick);
    }, []);

    // Close modal once connected
    useEffect(() => {
        if (isConnected) {
            setShowModal(false);
            setConnectingId(null);
        }
    }, [isConnected]);

    const handleConnect = async (connector) => {
        setConnectingId(connector.id);
        try {
            await connect({ connector });
        } catch (e) {
            console.warn('Wallet connection canceled or failed', e);
        } finally {
            setConnectingId(null);
        }
    };

    // Filter out redundant generic 'injected' if specific named providers (MetaMask, Brave) exist
    const filteredConnectors = connectors.filter(c => {
        if (c.id === 'injected' && c.name === 'Injected') {
            const hasSpecificInjected = connectors.some(
                other => other.id !== 'injected' || other.name !== 'Injected'
            );
            return !hasSpecificInjected;
        }
        return true;
    });

    // Sort connectors: MetaMask first, then Injected/Brave, then WalletConnect, Coinbase, Safe
    const sortedConnectors = [...filteredConnectors].sort((a, b) => {
        const metaA = getConnectorMeta(a);
        const metaB = getConnectorMeta(b);
        return (metaA.order || 99) - (metaB.order || 99);
    });


    // ── Connected State ───────────────────────────────────────────
    if (isConnected) {
        const activeColor = chainColor(chainId);
        const activeMeta = activeConnector ? getConnectorMeta(activeConnector) : null;

        return (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', position: 'relative' }}>
                {/* Chain Switcher Dropdown */}
                <div ref={chainMenuRef} style={{ position: 'relative' }}>
                    <button
                        type="button"
                        onClick={() => setShowChainMenu(v => !v)}
                        style={{
                            display: 'flex', alignItems: 'center', gap: '0.45rem',
                            padding: '0.45rem 0.8rem',
                            border: `1px solid ${activeColor}44`,
                            borderRadius: '10px',
                            background: isCorrectNetwork ? `${activeColor}15` : 'rgba(239,68,68,0.15)',
                            color: isCorrectNetwork ? activeColor : '#fca5a5',
                            fontSize: '0.75rem', fontWeight: 700, cursor: 'pointer',
                            transition: 'all 0.2s',
                            letterSpacing: '0.03em',
                        }}
                    >
                        <span style={{
                            width: 7, height: 7, borderRadius: '50%',
                            background: isCorrectNetwork ? activeColor : '#ef4444',
                            boxShadow: `0 0 6px ${isCorrectNetwork ? activeColor : '#ef4444'}`,
                            flexShrink: 0,
                        }} />
                        {isCorrectNetwork ? chainName(chainId) : 'Wrong Network'}
                        <span style={{ opacity: 0.6, fontSize: '0.6rem' }}>▼</span>
                    </button>

                    {showChainMenu && (
                        <div style={{
                            position: 'absolute', top: 'calc(100% + 6px)', right: 0,
                            background: '#0f1318',
                            border: '1px solid rgba(255,255,255,0.12)',
                            borderRadius: '14px',
                            padding: '0.4rem',
                            zIndex: 1000,
                            minWidth: 190,
                            boxShadow: '0 16px 40px rgba(0,0,0,0.6)',
                        }}>
                            {SUPPORTED_CHAINS.map(c => (
                                <button
                                    key={c.id}
                                    type="button"
                                    onClick={() => { switchChain({ chainId: c.id }); setShowChainMenu(false); }}
                                    style={{
                                        width: '100%', display: 'flex', alignItems: 'center', gap: '0.5rem',
                                        padding: '0.6rem 0.75rem',
                                        border: 'none', borderRadius: '10px',
                                        background: chainId === c.id ? `${chainColor(c.id)}20` : 'transparent',
                                        color: chainId === c.id ? chainColor(c.id) : '#94a3b8',
                                        fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer',
                                        transition: 'background 0.15s',
                                        textAlign: 'left',
                                    }}
                                >
                                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: chainColor(c.id), flexShrink: 0 }} />
                                    {c.name}
                                    {chainId === c.id && <span style={{ marginLeft: 'auto', fontSize: '0.65rem', opacity: 0.8 }}>✓ Active</span>}
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                {/* Connected Address Pill */}
                <div style={{
                    display: 'flex', alignItems: 'center', gap: '0.45rem',
                    fontFamily: "'Fira Code', monospace",
                    fontSize: '0.78rem', fontWeight: 600,
                    background: 'rgba(255,255,255,0.06)',
                    border: '1px solid rgba(255,255,255,0.12)',
                    borderRadius: '10px',
                    padding: '0.45rem 0.8rem',
                    color: '#f1f5f9',
                }}>
                    <span style={{ fontSize: '0.9rem' }}>
                        {activeMeta?.icon || '🦊'}
                    </span>
                    {address?.slice(0, 6)}…{address?.slice(-4)}
                </div>

                {/* Disconnect Button */}
                <button
                    type="button"
                    onClick={() => disconnect()}
                    style={{
                        padding: '0.45rem 0.8rem',
                        borderRadius: '10px',
                        border: '1px solid rgba(239,68,68,0.25)',
                        background: 'rgba(239,68,68,0.10)',
                        color: '#fca5a5',
                        fontSize: '0.75rem', fontWeight: 700, cursor: 'pointer',
                        transition: 'all 0.2s', letterSpacing: '0.03em',
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(239,68,68,0.25)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'rgba(239,68,68,0.10)'}
                >
                    Disconnect
                </button>
            </div>
        );
    }

    // ── Disconnected State ─────────────────────────────────────────
    const modalContent = showModal && (
        <div
            style={{
                position: 'fixed',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                width: '100vw',
                height: '100vh',
                zIndex: 999999,
                background: 'rgba(0, 0, 0, 0.75)',
                backdropFilter: 'blur(10px)',
                WebkitBackdropFilter: 'blur(10px)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '1rem',
            }}
        >
            <div
                ref={modalRef}
                style={{
                    background: '#0e1219',
                    border: '1px solid rgba(255,255,255,0.12)',
                    borderRadius: '24px',
                    padding: '1.75rem',
                    width: '100%',
                    maxWidth: '420px',
                    maxHeight: '90vh',
                    overflowY: 'auto',
                    boxShadow: '0 25px 65px rgba(0,0,0,0.8), 0 0 0 1px rgba(255,255,255,0.06) inset',
                    animation: 'fade-in 0.2s ease',
                    position: 'relative',
                }}
            >
                {/* Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.25rem' }}>
                    <div>
                        <h3 style={{
                            fontWeight: 900,
                            fontSize: '1.25rem',
                            letterSpacing: '-0.01em',
                            background: 'linear-gradient(135deg, #f8fafc, #94a3b8)',
                            WebkitBackgroundClip: 'text',
                            WebkitTextFillColor: 'transparent',
                            marginBottom: '0.2rem'
                        }}>
                            Connect Wallet
                        </h3>
                        <p style={{ fontSize: '0.75rem', color: '#64748b' }}>
                            Select your wallet to trade on Eswap Protocol
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={() => setShowModal(false)}
                        style={{
                            width: 32,
                            height: 32,
                            borderRadius: '10px',
                            border: '1px solid rgba(255,255,255,0.1)',
                            background: 'rgba(255,255,255,0.04)',
                            color: '#94a3b8',
                            cursor: 'pointer',
                            fontSize: '0.9rem',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            flexShrink: 0,
                        }}
                    >
                        ✕
                    </button>
                </div>

                {/* Wallet Connector List */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
                    {sortedConnectors.map((connector) => {
                        const meta = getConnectorMeta(connector);
                        const isConnecting = connectingId === connector.id && isPending;

                        return (
                            <button
                                key={connector.id}
                                type="button"
                                onClick={() => handleConnect(connector)}
                                disabled={isConnecting}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '0.9rem',
                                    padding: '0.9rem 1.1rem',
                                    borderRadius: '16px',
                                    border: `1px solid ${isConnecting ? `${meta.color}66` : 'rgba(255,255,255,0.08)'}`,
                                    background: isConnecting
                                        ? `${meta.color}15`
                                        : meta.label === 'MetaMask'
                                        ? 'rgba(249,115,22,0.06)'
                                        : 'rgba(255,255,255,0.03)',
                                    cursor: isConnecting ? 'wait' : 'pointer',
                                    transition: 'all 0.18s cubic-bezier(0.4, 0, 0.2, 1)',
                                    textAlign: 'left',
                                    width: '100%',
                                }}
                                onMouseEnter={(e) => {
                                    if (!isConnecting) {
                                        e.currentTarget.style.background = `${meta.color}14`;
                                        e.currentTarget.style.borderColor = `${meta.color}55`;
                                        e.currentTarget.style.boxShadow = `0 0 20px ${meta.glow}`;
                                        e.currentTarget.style.transform = 'translateY(-1px)';
                                    }
                                }}
                                onMouseLeave={(e) => {
                                    if (!isConnecting) {
                                        e.currentTarget.style.background = meta.label === 'MetaMask'
                                            ? 'rgba(249,115,22,0.06)'
                                            : 'rgba(255,255,255,0.03)';
                                        e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)';
                                        e.currentTarget.style.boxShadow = 'none';
                                        e.currentTarget.style.transform = 'translateY(0)';
                                    }
                                }}
                            >
                                {/* Wallet Icon / Loader */}
                                <div
                                    style={{
                                        width: 44,
                                        height: 44,
                                        flexShrink: 0,
                                        borderRadius: '13px',
                                        background: `${meta.color}18`,
                                        border: `1px solid ${meta.color}35`,
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        fontSize: '1.4rem',
                                    }}
                                >
                                    {isConnecting ? (
                                        <span
                                            style={{
                                                width: 20,
                                                height: 20,
                                                border: `2px solid ${meta.color}44`,
                                                borderTopColor: meta.color,
                                                borderRadius: '50%',
                                                display: 'inline-block',
                                                animation: 'spin 0.7s linear infinite',
                                            }}
                                        />
                                    ) : meta.iconUrl ? (
                                        <img
                                            src={meta.iconUrl}
                                            alt={meta.label}
                                            style={{ width: 26, height: 26, borderRadius: '6px' }}
                                        />
                                    ) : (
                                        meta.icon
                                    )}
                                </div>

                                {/* Labels */}
                                <div style={{ flex: 1 }}>
                                    <div style={{
                                        fontWeight: 800,
                                        fontSize: '0.95rem',
                                        color: isConnecting ? meta.color : '#f1f5f9',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '0.4rem',
                                        marginBottom: '0.15rem'
                                    }}>
                                        {isConnecting ? 'Connecting…' : meta.label}
                                        {meta.label === 'MetaMask' && (
                                            <span style={{
                                                fontSize: '0.62rem',
                                                padding: '0.1rem 0.4rem',
                                                borderRadius: '6px',
                                                background: 'rgba(249,115,22,0.2)',
                                                color: '#fb923c',
                                                fontWeight: 700,
                                                textTransform: 'uppercase',
                                                letterSpacing: '0.05em',
                                            }}>
                                                Recommended
                                            </span>
                                        )}
                                    </div>
                                    <div style={{ fontSize: '0.72rem', color: '#64748b' }}>
                                        {meta.subtitle}
                                    </div>
                                </div>

                                {/* Right Arrow Indicator */}
                                {!isConnecting && (
                                    <span style={{ color: '#475569', fontSize: '1rem', flexShrink: 0, fontWeight: 'bold' }}>
                                        ›
                                    </span>
                                )}
                            </button>
                        );
                    })}
                </div>

                {/* Error Banner */}
                {connectError && (
                    <div
                        style={{
                            marginTop: '1rem',
                            padding: '0.75rem 1rem',
                            borderRadius: '12px',
                            background: 'rgba(239,68,68,0.1)',
                            border: '1px solid rgba(239,68,68,0.25)',
                            fontSize: '0.75rem',
                            color: '#fca5a5',
                            fontFamily: 'var(--font-mono)',
                            lineHeight: 1.5,
                        }}
                    >
                        ⚠ {connectError.shortMessage || connectError.message}
                    </div>
                )}

                {/* Security Footnote */}
                <p style={{ marginTop: '1.25rem', textAlign: 'center', fontSize: '0.68rem', color: '#475569', lineHeight: 1.5 }}>
                    Non-custodial & decentralized. Your private keys never leave your device.
                </p>
            </div>
        </div>
    );

    return (
        <>
            <button
                type="button"
                onClick={() => setShowModal(true)}
                className="primary-button animate-pulse-glow"
                style={{ padding: '0.55rem 1.2rem', fontSize: '0.85rem' }}
            >
                <span>⚡</span> Connect Wallet
            </button>

            {mounted && typeof document !== 'undefined' && createPortal(modalContent, document.body)}
        </>
    );
}
