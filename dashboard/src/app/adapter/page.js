'use client';

import { useState, useEffect, useCallback } from 'react';
import { ConnectButton } from '@/components/ConnectButton';
import { useAccount } from 'wagmi';
import { ethers } from 'ethers';
import EswapLeverageAdapterABI from '@/abis/EswapLeverageAdapter.json';
import EswapLeverageQuoterABI from '@/abis/EswapLeverageQuoter.json';
import Link from 'next/link';

const ADAPTER = process.env.NEXT_PUBLIC_V4_ADAPTER_ADDRESS || '';
const QUOTER = process.env.NEXT_PUBLIC_V4_QUOTER_ADDRESS || '';
const RPC_URL = process.env.NEXT_PUBLIC_UNICHAIN_RPC_URL || process.env.NEXT_PUBLIC_RPC_URL;

function getProvider() {
    if (RPC_URL) return new ethers.JsonRpcProvider(RPC_URL);
    if (typeof window !== 'undefined' && window.ethereum) return new ethers.BrowserProvider(window.ethereum);
    return null;
}

export default function AdapterPage() {
    const { address, isConnected } = useAccount();
    const [quoteResult, setQuoteResult] = useState(null);
    const [loadingQuote, setLoadingQuote] = useState(false);
    const [status, setStatus] = useState('');
    const [quoteForm, setQuoteForm] = useState({
        inputToken: '',
        outputToken: '',
        amount: '',
        leverage: '5',
    });

    const handleQuote = useCallback(async () => {
        if (!QUOTER || !quoteForm.inputToken || !quoteForm.outputToken || !quoteForm.amount) return;
        setLoadingQuote(true);
        setStatus('Fetching quote...');
        try {
            const provider = getProvider();
            const quoter = new ethers.Contract(QUOTER, EswapLeverageQuoterABI.abi, provider);
            const result = await quoter.quoteExactInputSingleWithLeverage(
                quoteForm.inputToken,
                quoteForm.outputToken,
                quoteForm.amount,
                parseInt(quoteForm.leverage),
            );
            setQuoteResult({
                amountOut: ethers.formatUnits(result.amountOut, 18),
                borrowAmount: ethers.formatUnits(result.borrowAmount, 18),
                fee: ethers.formatUnits(result.fee, 18),
            });
            setStatus('Quote received!');
        } catch (e) {
            setStatus(`Error: ${e?.reason || e?.message || 'Unknown'}`);
        } finally {
            setLoadingQuote(false);
        }
    }, [quoteForm]);

    return (
        <main className="min-h-screen p-6 text-white max-w-[1200px] mx-auto">
            {/* Header */}
            <header className="flex justify-between items-center mb-8 glass-panel p-4">
                <div className="flex items-center gap-3">
                    <Link href="/" className="hover:opacity-80 transition-opacity">
                        <img src="/logo.png" alt="Eswap" className="rounded-full bg-white/5 border border-white/10 p-1" style={{ width: '40px', height: '40px' }} />
                    </Link>
                    <h1 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-cyan-400 to-blue-400 tracking-wider border-l border-white/20 pl-4 ml-1">
                        AGGREGATOR ADAPTER
                    </h1>
                </div>
                <div className="flex items-center gap-4">
                    <Link href="/" className="text-sm text-gray-400 hover:text-white">← Home</Link>
                    <ConnectButton />
                </div>
            </header>

            {/* Info Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
                <div className="glass-panel p-6">
                    <h2 className="text-lg font-bold text-cyan-400 mb-3">Adapter Contract</h2>
                    <p className="text-sm text-gray-400 mb-3">
                        Integration adapter for ODOS and Enso Finance aggregators. Translates
                        standard swap calls into leveraged position opens via the EswapRouter.
                    </p>
                    <div className="p-3 bg-black/30 rounded-lg">
                        <span className="text-xs text-gray-500">Address: </span>
                        <span className="font-mono text-sm text-gray-300">{ADAPTER || 'Not deployed'}</span>
                    </div>
                </div>
                <div className="glass-panel p-6">
                    <h2 className="text-lg font-bold text-cyan-400 mb-3">Quoter Contract</h2>
                    <p className="text-sm text-gray-400 mb-3">
                        View-only quoter for leveraged position previews. Returns expected output,
                        borrow amount, and fees without executing a swap.
                    </p>
                    <div className="p-3 bg-black/30 rounded-lg">
                        <span className="text-xs text-gray-500">Address: </span>
                        <span className="font-mono text-sm text-gray-300">{QUOTER || 'Not deployed'}</span>
                    </div>
                </div>
            </div>

            {/* Integration Guide */}
            <div className="glass-panel p-6 mb-8">
                <h2 className="text-lg font-bold text-gray-200 mb-4">Integration Guide</h2>
                <div className="space-y-4 text-sm text-gray-400">
                    <div>
                        <h3 className="text-gray-300 font-semibold mb-1">1. Standard Aggregator Flow (Socket/Li.Fi)</h3>
                        <p>Call <code className="text-cyan-400">router.swapMultiPoolFor(params, recipient)</code> directly.
                           The solver provides borrow capital. No adapter needed.</p>
                    </div>
                    <div>
                        <h3 className="text-gray-300 font-semibold mb-1">2. ODOS/Enso Flow (via Adapter)</h3>
                        <p>Call <code className="text-cyan-400">adapter.exactInputSingleWithLeverage(...)</code> with input/output tokens,
                           amount, leverage, and slippage. The adapter translates to router calls.</p>
                    </div>
                    <div>
                        <h3 className="text-gray-300 font-semibold mb-1">3. CoW Swap / UniswapX (ERC-7683)</h3>
                        <p>Call <code className="text-cyan-400">router.initiate(order, signature, solverData)</code> on origin chain.
                           Solver fills on destination via <code className="text-cyan-400">settlement.fill(orderId, originData, fillerData)</code>.</p>
                    </div>
                </div>
            </div>

            {/* Quoter */}
            <div className="glass-panel p-6">
                <h2 className="text-lg font-bold text-gray-200 mb-4">Leverage Quoter</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <label className="block text-xs text-gray-500 mb-1 uppercase tracking-wide">Input Token</label>
                        <input
                            className="input-field font-mono text-sm"
                            placeholder="0x... (e.g. USDC)"
                            value={quoteForm.inputToken}
                            onChange={(e) => setQuoteForm({ ...quoteForm, inputToken: e.target.value })}
                        />
                    </div>
                    <div>
                        <label className="block text-xs text-gray-500 mb-1 uppercase tracking-wide">Output Token</label>
                        <input
                            className="input-field font-mono text-sm"
                            placeholder="0x... (e.g. WETH)"
                            value={quoteForm.outputToken}
                            onChange={(e) => setQuoteForm({ ...quoteForm, outputToken: e.target.value })}
                        />
                    </div>
                    <div>
                        <label className="block text-xs text-gray-500 mb-1 uppercase tracking-wide">Amount (wei)</label>
                        <input
                            className="input-field font-mono text-sm"
                            placeholder="1000000"
                            value={quoteForm.amount}
                            onChange={(e) => setQuoteForm({ ...quoteForm, amount: e.target.value })}
                        />
                    </div>
                    <div>
                        <label className="block text-xs text-gray-500 mb-1 uppercase tracking-wide">Leverage</label>
                        <select
                            className="input-field font-mono text-sm"
                            value={quoteForm.leverage}
                            onChange={(e) => setQuoteForm({ ...quoteForm, leverage: e.target.value })}
                        >
                            <option value="2">2x</option>
                            <option value="3">3x</option>
                            <option value="4">4x</option>
                            <option value="5">5x</option>
                        </select>
                    </div>
                </div>
                <button
                    onClick={handleQuote}
                    disabled={loadingQuote}
                    className="primary-button mt-4 px-6 py-2 text-sm"
                >
                    {loadingQuote ? 'Quoting...' : 'Get Quote'}
                </button>

                {quoteResult && (
                    <div className="mt-4 grid grid-cols-3 gap-4">
                        <div className="p-3 bg-black/30 rounded-lg">
                            <div className="text-xs text-gray-500">Amount Out</div>
                            <div className="font-mono text-sm text-cyan-400">{quoteResult.amountOut}</div>
                        </div>
                        <div className="p-3 bg-black/30 rounded-lg">
                            <div className="text-xs text-gray-500">Borrow Amount</div>
                            <div className="font-mono text-sm text-gray-300">{quoteResult.borrowAmount}</div>
                        </div>
                        <div className="p-3 bg-black/30 rounded-lg">
                            <div className="text-xs text-gray-500">Fee</div>
                            <div className="font-mono text-sm text-orange-400">{quoteResult.fee}</div>
                        </div>
                    </div>
                )}

                {status && (
                    <div className="mt-4 p-3 bg-black/30 rounded text-xs font-mono text-gray-400">{status}</div>
                )}
            </div>
        </main>
    );
}
