import { useState, useEffect, useCallback } from 'react';
import { useDeFi } from '../hooks/useDeFi';
import { useAccount } from 'wagmi';
import { isUnichainChain } from '../utils/chains';
import clsx from 'clsx';
import { ethers } from 'ethers';
import { formatContractError, isUserCancellation } from '../utils/formatContractError';
import { formatTokenAmount } from '../utils/format';

const FUND_TOKENS = ['USDC', 'WETH'];

export function SolverFunding() {
    const { isConnected, address, chainId } = useAccount();
    const { ADDRESSES, getTokenBalance, sendTokens, isMetaMaskInstalled } = useDeFi();

    const solver = ADDRESSES.V4_SOLVER;
    const isCorrectNetwork = isUnichainChain(chainId);

    const [token, setToken] = useState('USDC');
    const [amount, setAmount] = useState('0');
    const [status, setStatus] = useState('');
    const [processing, setProcessing] = useState(false);
    const [solverBalances, setSolverBalances] = useState(null);
    const [walletData, setWalletData] = useState(null);

    const refresh = useCallback(async () => {
        if (!isConnected || !solver || !address) return;
        const [usdc, weth, wallet] = await Promise.all([
            getTokenBalance(ADDRESSES.USDC, solver),
            getTokenBalance(ADDRESSES.WETH, solver),
            getTokenBalance(ADDRESSES[token], address),
        ]);
        setSolverBalances({ USDC: usdc, WETH: weth });
        setWalletData(wallet);
    }, [isConnected, solver, address, ADDRESSES, token, getTokenBalance]);

    useEffect(() => {
        refresh();
    }, [refresh]);

    const decimals = walletData?.decimals ?? (token === 'USDC' ? 6 : 18);
    const amountBig = ethers.parseUnits(amount || '0', decimals);
    const hasZeroAmount = !amount || isNaN(amount) || parseFloat(amount) <= 0;
    const hasInsufficientBalance = walletData && amountBig > walletData.rawBalance;

    const handleFund = async (e) => {
        e.preventDefault();
        if (!isConnected || !isCorrectNetwork || !solver || hasZeroAmount) return;
        if (walletData && amountBig > walletData.rawBalance) {
            setStatus('❌ Error: Insufficient balance');
            return;
        }

        setProcessing(true);
        setStatus('Sending to solver...');
        try {
            const tx = await sendTokens(ADDRESSES[token], solver, amountBig);
            setStatus(`Tx Sent: ${tx.hash}`);
            await tx.wait();
            setStatus('✅ Solver funded successfully!');
            setAmount('0');
            refresh();
        } catch (error) {
            console.error(error);
            if (isUserCancellation(error)) {
                setStatus('⚠️ Transaction was canceled by user.');
                setTimeout(() => setStatus(''), 3000);
            } else {
                const friendlyError = formatContractError(error);
                setStatus(`❌ Error: ${friendlyError}`);
            }
        } finally {
            setProcessing(false);
        }
    };

    const enabled =
        isConnected && isCorrectNetwork && !!solver && !processing;

    return (
        <div className="glass-panel p-6 w-full">
            <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-bold text-gray-400 uppercase tracking-widest">
                    Fund the Solver
                </h2>
                <span className="text-[10px] font-bold text-purple-400 bg-purple-500/10 border border-purple-500/20 rounded px-2 py-1 uppercase tracking-wider">
                    Unichain V4
                </span>
            </div>

            <div className="mb-4 bg-black/20 border border-white/5 p-3 rounded-lg">
                <div className="text-[11px] text-gray-500 mb-1">
                    Solver backs the borrowed leg of leveraged positions (approves
                    &amp; funds the router on your behalf).
                </div>
                {solver ? (
                    <a
                        href={`https://unichain.blockscout.com/address/${solver}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-cyan-400 font-mono break-all hover:underline underline-offset-2"
                    >
                        {solver}
                    </a>
                ) : (
                    <span className="text-xs text-amber-400">
                        No V4_SOLVER address configured
                    </span>
                )}
            </div>

            <div className="mb-5 bg-white/5 border border-white/5 p-4 rounded-xl">
                <div className="text-sm text-gray-400 mb-2">Solver Balances</div>
                <div className="grid grid-cols-2 gap-4">
                    {FUND_TOKENS.map((t) => (
                        <div key={t}>
                            <div className="text-xs text-gray-500">{t}</div>
                            <div className="text-lg font-mono text-green-400">
                                {solverBalances?.[t]
                                    ? formatTokenAmount(solverBalances[t].balance, t)
                                    : '...'}
                            </div>
                            <div className="text-[10px] text-gray-500">
                                ≈ ${solverBalances?.[t]?.usdValue ?? '...'}
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            <form onSubmit={handleFund} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label className="text-xs text-gray-400 block mb-2">
                            Asset
                        </label>
                        <select
                            value={token}
                            onChange={(e) => setToken(e.target.value)}
                            disabled={!enabled}
                            className="input-field bg-black/40"
                        >
                            {FUND_TOKENS.map((t) => (
                                <option key={t} value={t}>
                                    {t}
                                </option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label className="text-xs text-gray-400 block mb-2">
                            Amount
                        </label>
                        <div className="relative">
                            <input
                                type="number"
                                value={amount}
                                onChange={(e) => setAmount(e.target.value)}
                                disabled={!enabled}
                                className="input-field font-mono w-full"
                                placeholder="0.00"
                                step="0.000001"
                                min="0"
                            />
                            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 font-bold text-sm">
                                {token}
                            </span>
                        </div>
                    </div>
                </div>

                {walletData && (
                    <div className="flex justify-between text-[11px] text-gray-500">
                        <span>Wallet balance</span>
                        <span
                            onClick={() => {
                                if (walletData.balance) setAmount(walletData.balance);
                            }}
                            className="text-blue-400 cursor-pointer hover:text-blue-300"
                        >
                            Max: {formatTokenAmount(walletData.balance, token)}
                        </span>
                    </div>
                )}

                <button
                    type="submit"
                    disabled={!enabled || hasZeroAmount || hasInsufficientBalance}
                    className={clsx(
                        'w-full primary-button py-4 text-base font-bold tracking-wide',
                        (!enabled || hasZeroAmount || hasInsufficientBalance) &&
                            'opacity-50 cursor-not-allowed'
                    )}
                >
                    {!solver
                        ? 'Solver Not Configured'
                        : !isMetaMaskInstalled
                        ? 'Install MetaMask'
                        : !isCorrectNetwork
                        ? 'Connect to Unichain'
                        : !isConnected
                        ? 'Connect Wallet'
                        : processing
                        ? 'Processing...'
                        : `FUND SOLVER ${token}`}
                </button>

                {status && (
                    <div className="p-3 bg-white/5 rounded border border-white/10 text-xs font-mono break-all text-gray-300">
                        {status}
                    </div>
                )}
            </form>
        </div>
    );
}