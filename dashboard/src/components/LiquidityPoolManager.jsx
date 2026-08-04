
import { useState, useEffect } from 'react';
import { useDeFi } from '../hooks/useDeFi';
import { useAccount } from 'wagmi';
import { POLYGON_CHAIN_ID } from '../utils/chains';
import clsx from 'clsx';
import { ethers } from 'ethers';
import { formatContractError, isUserCancellation } from '../utils/formatContractError';
import { formatTokenAmount } from '../utils/format';

export function LiquidityPoolManager({ selectedTokenKey = 'USDC' }) {
    const { isConnected, address, chainId } = useAccount();
    const { getProtocolBalances, depositToPool, redeemFromPool, ADDRESSES, isMetaMaskInstalled, getTokenBalance } = useDeFi();

    const isCorrectNetwork = chainId === POLYGON_CHAIN_ID;

    // Tab state (Internal logic for tabs removed, using prop)
    const [action, setAction] = useState('deposit'); // 'deposit' | 'redeem'

    // Data state
    const [poolData, setPoolData] = useState(null);
    const [walletBalance, setWalletBalance] = useState('0.0');
    const [loadingData, setLoadingData] = useState(false);

    // Form state
    const [amount, setAmount] = useState('0');
    const [txStatus, setTxStatus] = useState('');
    const [processing, setProcessing] = useState(false);

    const fetchPoolData = async () => {
        setLoadingData(true);
        const res = await getProtocolBalances();
        if (res && res.poolBalances) {
            setPoolData(res.poolBalances);
        }

        // Also fetch wallet balance for selectedTokenKey
        if (address) {
            const tokenAddr = ADDRESSES[selectedTokenKey];
            if (tokenAddr) {
                const balData = await getTokenBalance(tokenAddr, address);
                if (balData) {
                    setWalletBalance(balData.balance);
                }
            }
        }
        setLoadingData(false);
    };

    useEffect(() => {
        if (isConnected) fetchPoolData();
    }, [isConnected, selectedTokenKey]);

    const currentPool = poolData?.[selectedTokenKey];
    const userShares = currentPool?.userShares || '0.0';
    const userAssets = currentPool?.userAssets || '0.0';

    const handleAction = async (e) => {
        e.preventDefault();
        if (!amount || parseFloat(amount) <= 0 || !isCorrectNetwork) return;
        setProcessing(true);
        setTxStatus('Initiating transaction...');

        try {
            let tx;
            // Quick Decimal Hack (Ideally fetch from contract)
            let decimals = 18;
            if (selectedTokenKey === 'USDC') decimals = 6;
            if (selectedTokenKey === 'WBTC') decimals = 8;

            const amountBig = ethers.parseUnits(amount, decimals);

            if (action === 'deposit') {
                tx = await depositToPool(selectedTokenKey, amountBig);
            } else {
                tx = await redeemFromPool(selectedTokenKey, amountBig);
            }

            setTxStatus(`Tx Sent: ${tx.hash}`);
            await tx.wait();
            setTxStatus('✅ Success!');
            setAmount('0');
            fetchPoolData();

        } catch (error) {
            console.error(error);
            if (isUserCancellation(error)) {
                setTxStatus('⚠️ Transaction was canceled by user.');
                setTimeout(() => setTxStatus(''), 3000);
            } else {
                const friendlyError = formatContractError(error);
                setTxStatus(`❌ Error: ${friendlyError}`);
            }
        } finally {
            setProcessing(false);
        }
    };

    return (
        <div className="glass-panel p-6 w-full h-full flex flex-col">
            <h2 className="text-sm font-bold text-gray-400 uppercase tracking-widest mb-4">
                Liquidity Manager
            </h2>

            {/* Selected Token Info */}
            <div className="mb-6 bg-white/5 border border-white/5 p-4 rounded-xl">
                <div className="flex justify-between items-start mb-2">
                    <span className="text-xl font-bold text-white">{selectedTokenKey} Pool</span>
                    <button onClick={fetchPoolData} className="text-xs text-gray-500 hover:text-white">Refresh</button>
                </div>
                <div className="flex justify-between items-end">
                    <div>
                        <div className="text-sm text-gray-400">Your Assets</div>
                        <div className="text-2xl font-mono text-green-400">{formatTokenAmount(userAssets, selectedTokenKey)}</div>
                    </div>
                    <div className="text-right">
                        <div className="text-sm text-gray-400">Your Shares</div>
                        <div className="font-mono text-gray-300">{formatTokenAmount(userShares, selectedTokenKey)}</div>
                    </div>
                </div>
            </div>

            {/* Action Toggle (Segmented Control) */}
            <div className="flex bg-black/40 p-1 rounded-lg mb-6">
                <button
                    onClick={() => setAction('deposit')}
                    className={clsx(
                        "flex-1 py-2 rounded-md font-bold text-sm transition-all",
                        action === 'deposit' ? "bg-green-600 text-white shadow-lg" : "text-gray-400 hover:text-white"
                    )}
                >
                    Deposit
                </button>
                <button
                    onClick={() => setAction('redeem')}
                    className={clsx(
                        "flex-1 py-2 rounded-md font-bold text-sm transition-all",
                        action === 'redeem' ? "bg-blue-600 text-white shadow-lg" : "text-gray-400 hover:text-white"
                    )}
                >
                    Redeem
                </button>
            </div>

            {/* Form */}
            <form onSubmit={handleAction} className="space-y-4 flex-1">
                <div>
                    <div className="flex justify-between mb-2">
                        <label className="text-xs text-gray-400 uppercase tracking-wide">
                            {action === 'deposit' ? 'Amount to Deposit' : 'Shares to Redeem'}
                        </label>
                        {action === 'redeem' ? (
                            <span
                                onClick={() => setAmount(userShares)}
                                className="text-xs text-blue-400 cursor-pointer hover:text-blue-300"
                            >
                                Max: {formatTokenAmount(userShares, selectedTokenKey)}
                            </span>
                        ) : (
                            <span
                                onClick={() => setAmount(walletBalance)}
                                className="text-xs text-blue-400 cursor-pointer hover:text-blue-300"
                            >
                                Max: {formatTokenAmount(walletBalance, selectedTokenKey)}
                            </span>
                        )}
                    </div>

                    <div className="relative">
                        <input
                            type="number"
                            value={amount}
                            onChange={(e) => setAmount(e.target.value)}
                            className="input-field font-mono w-full text-lg"
                            placeholder="0.00"
                            step="0.000001"
                        />
                        <span className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 font-bold">
                            {selectedTokenKey}
                        </span>
                    </div>
                </div>

                <button
                    type="submit"
                    disabled={processing || !isConnected || !isCorrectNetwork || !isMetaMaskInstalled}
                    className={clsx(
                        "w-full primary-button py-4 text-base font-bold tracking-wide mt-4",
                        (processing || !isCorrectNetwork || !isMetaMaskInstalled) && "opacity-50 cursor-not-allowed"
                    )}
                >
                    {!isMetaMaskInstalled
                        ? 'Install MetaMask'
                        : !isCorrectNetwork
                            ? 'Wrong Network'
                            : processing
                                ? 'Processing...'
                                : (action === 'deposit' ? `DEPOSIT ${selectedTokenKey}` : 'REDEEM SHARES')
                    }
                </button>

                {txStatus && (
                    <div className="p-3 bg-white/5 rounded border border-white/10 text-xs font-mono break-all text-gray-300 mt-4">
                        {txStatus}
                    </div>
                )}
            </form>
        </div>
    );
}
