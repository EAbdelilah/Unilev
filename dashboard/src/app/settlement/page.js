'use client';

import { ConnectButton } from '@/components/ConnectButton';
import { useAdmin } from '@/contexts/AdminContext';
import Link from 'next/link';

const SETTLEMENT = process.env.NEXT_PUBLIC_V4_SETTLEMENT_ADDRESS || '';

export default function SettlementPage() {
    const { isAdmin } = useAdmin();

    return (
        <main className="min-h-screen p-6 text-white max-w-[1200px] mx-auto">
            <header className="flex justify-between items-center mb-8 glass-panel p-4">
                <div className="flex items-center gap-3">
                    <Link href="/" className="hover:opacity-80 transition-opacity">
                        <img src="/logo.png" alt="Eswap" className="rounded-full bg-white/5 border border-white/10 p-1" style={{ width: '40px', height: '40px' }} />
                    </Link>
                    <h1 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-green-400 to-emerald-400 tracking-wider border-l border-white/20 pl-4 ml-1">
                        CROSS-CHAIN SETTLEMENT
                    </h1>
                </div>
                <div className="flex items-center gap-4">
                    <Link href="/" className="text-sm text-gray-400 hover:text-white">← Home</Link>
                    <ConnectButton />
                </div>
            </header>

            {/* Info */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
                <div className="glass-panel p-6">
                    <h2 className="text-lg font-bold text-green-400 mb-3">ERC-7683 Destination Settler</h2>
                    <p className="text-sm text-gray-400 mb-3">
                        Enables cross-chain leveraged position opens via the ERC-7683 cross-chain intents standard.
                        Solvers bridge tokens to the destination chain and call <code className="text-green-400">fill()</code> to open positions.
                    </p>
                    <div className="p-3 bg-black/30 rounded-lg">
                        <span className="text-xs text-gray-500">Address: </span>
                        <span className="font-mono text-sm text-gray-300">{SETTLEMENT || 'Not deployed'}</span>
                    </div>
                </div>
                <div className="glass-panel p-6">
                    <h2 className="text-lg font-bold text-green-400 mb-3">How It Works</h2>
                    <div className="space-y-3 text-sm text-gray-400">
                        <div className="flex gap-3">
                            <span className="text-green-400 font-bold">1.</span>
                            <span>User signs a cross-chain order on the origin chain</span>
                        </div>
                        <div className="flex gap-3">
                            <span className="text-green-400 font-bold">2.</span>
                            <span>Solver bridges margin + borrow tokens to the destination chain</span>
                        </div>
                        <div className="flex gap-3">
                            <span className="text-green-400 font-bold">3.</span>
                            <span>Solver calls <code className="text-green-400">settlement.fill()</code> with the order data</span>
                        </div>
                        <div className="flex gap-3">
                            <span className="text-green-400 font-bold">4.</span>
                            <span>Settlement pulls tokens, opens leveraged position via the router</span>
                        </div>
                    </div>
                </div>
            </div>

            {/* Flow Diagram */}
            <div className="glass-panel p-6 mb-8">
                <h2 className="text-lg font-bold text-gray-200 mb-4">Settlement Flow</h2>
                <div className="font-mono text-sm text-gray-400 space-y-2 p-4 bg-black/30 rounded-lg">
                    <div><span className="text-green-400">Origin Chain:</span> User → signs CrossChainOrder</div>
                    <div><span className="text-green-400">Solver:</span> evaluates order via resolver contract</div>
                    <div><span className="text-green-400">Bridge:</span> Solver bridges margin + borrow to destination</div>
                    <div><span className="text-green-400">Destination:</span> Solver → settlement.fill(orderId, originData, fillerData)</div>
                    <div className="pl-4"><span className="text-gray-500">├─ safeTransferFrom(solver → settlement, notional)</span></div>
                    <div className="pl-4"><span className="text-gray-500">├─ forceApprove(settlement → router, notional)</span></div>
                    <div className="pl-4"><span className="text-gray-500">└─ router.swapMultiPoolFor(params, settlement)</span></div>
                    <div className="pl-8"><span className="text-gray-500">├─ router pulls margin from settlement</span></div>
                    <div className="pl-8"><span className="text-gray-500">├─ router pulls borrow from settlement</span></div>
                    <div className="pl-8"><span className="text-gray-500">└─ position registered under settlement</span></div>
                    <div><span className="text-orange-400">Event:</span> PositionFilled(orderId, recipient, token, margin)</div>
                </div>
            </div>

            {/* Contracts */}
            <div className="glass-panel p-6">
                <h2 className="text-lg font-bold text-gray-200 mb-4">Deployed Contracts</h2>
                <div className="space-y-3">
                    {[
                        ['Settlement', SETTLEMENT],
                        ['Router', process.env.NEXT_PUBLIC_V4_ROUTER_ADDRESS],
                        ['Hook', process.env.NEXT_PUBLIC_V4_HOOK_ADDRESS],
                    ].map(([label, addr]) => (
                        <div key={label} className="flex items-center justify-between p-3 bg-black/30 rounded-lg">
                            <span className="text-sm text-gray-400">{label}</span>
                            <span className="font-mono text-sm text-gray-300">
                                {addr ? `${addr.slice(0, 10)}...${addr.slice(-8)}` : 'Not configured'}
                            </span>
                        </div>
                    ))}
                </div>
            </div>
        </main>
    );
}
