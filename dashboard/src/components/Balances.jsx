import { useState, useEffect } from 'react';
import { useDeFi } from '../hooks/useDeFi';
import { useAccount } from 'wagmi';
import { formatTokenAmount } from '../utils/format';

// Token icon colours
const TOKEN_COLORS = {
    ETH:  { bg: 'rgba(98,126,234,0.18)', border: 'rgba(98,126,234,0.35)', text: '#a5b4fc', emoji: '⟠' },
    WETH: { bg: 'rgba(98,126,234,0.18)', border: 'rgba(98,126,234,0.35)', text: '#a5b4fc', emoji: '⟠' },
    USDC: { bg: 'rgba(6,182,212,0.15)',  border: 'rgba(6,182,212,0.30)',  text: 'var(--cyan-light)', emoji: '◎' },
    WBTC: { bg: 'rgba(245,158,11,0.15)', border: 'rgba(245,158,11,0.30)', text: 'var(--amber-light)', emoji: '₿' },
};
function tokenStyle(name) {
    return TOKEN_COLORS[name] || { bg: 'rgba(255,255,255,0.05)', border: 'rgba(255,255,255,0.1)', text: 'var(--text-secondary)', emoji: '◉' };
}

export function Balances() {
    const { isConnected, address } = useAccount();
    const { getTokenBalance, getNativeBalance, ADDRESSES, SUPPORTED_TOKENS_LIST } = useDeFi();
    const [balances, setBalances] = useState({});
    const [loading, setLoading] = useState(false);

    const displayTokens = [{ key: 'native', name: 'ETH' }, ...SUPPORTED_TOKENS_LIST];

    const fetchBalances = async () => {
        if (!address) return;
        setLoading(true);
        const newBalances = {};
        for (const t of displayTokens) {
            let bal;
            if (t.key === 'native') {
                bal = await getNativeBalance(address);
                if (bal) bal.symbol = 'ETH';
            } else {
                const tokenAddr = ADDRESSES[t.key];
                if (tokenAddr) bal = await getTokenBalance(tokenAddr, address);
            }
            if (bal) newBalances[t.key] = bal;
        }
        setBalances(prev => ({ ...prev, ...newBalances }));
        setLoading(false);
    };

    useEffect(() => {
        if (isConnected && address) {
            fetchBalances();
            const interval = setInterval(fetchBalances, 15000);
            return () => clearInterval(interval);
        }
    }, [isConnected, address]);

    if (!isConnected) return null;

    return (
        <div className="glass-panel p-6">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <h2 className="section-heading" style={{
                    background: 'linear-gradient(135deg, var(--purple-light), var(--cyan-light))',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                    backgroundClip: 'text',
                }}>
                    Wallet
                </h2>
                <button
                    onClick={fetchBalances}
                    style={{
                        background: 'none',
                        border: '1px solid rgba(255,255,255,0.08)',
                        borderRadius: '8px',
                        color: loading ? 'var(--cyan-light)' : 'var(--text-muted)',
                        cursor: 'pointer',
                        padding: '0.3rem 0.65rem',
                        fontSize: '0.72rem',
                        transition: 'all 0.2s',
                        display: 'flex', alignItems: 'center', gap: '0.3rem',
                    }}
                >
                    <span style={{ display: 'inline-block', ...(loading ? { animation: 'spin 0.8s linear infinite' } : {}) }}>↻</span>
                    {loading ? 'Loading…' : 'Refresh'}
                </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {displayTokens.map(t => {
                    const ts = tokenStyle(t.name);
                    const bal = balances[t.key];
                    return (
                        <div key={t.key} className="balance-row">
                            {/* Token icon + name */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                                <div style={{
                                    width: 32, height: 32,
                                    borderRadius: '8px',
                                    background: ts.bg,
                                    border: `1px solid ${ts.border}`,
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    fontSize: '0.95rem',
                                    flexShrink: 0,
                                }}>
                                    {ts.emoji}
                                </div>
                                <span style={{ fontWeight: 700, fontSize: '0.875rem', color: ts.text }}>
                                    {t.name}
                                </span>
                            </div>

                            {/* Balance */}
                            <div style={{ textAlign: 'right' }}>
                                <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                                    {bal ? formatTokenAmount(bal.balance, t.name) : (
                                        <span style={{ display: 'inline-block', width: 60, height: 14, borderRadius: 4 }} className="animate-shimmer" />
                                    )}
                                </div>
                                {bal?.usdValue && (
                                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginTop: '1px' }}>
                                        ~${bal.usdValue}
                                    </div>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
