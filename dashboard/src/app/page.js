
'use client';

import { ConnectButton } from '@/components/ConnectButton';
import { Balances } from '@/components/Balances';
import { TradeForm } from '@/components/TradeForm';
import { PositionsList } from '@/components/PositionsList';
import { AdminToggle } from '@/components/AdminToggle';
import { LiveChart } from '@/components/LiveChart';
import { useAdmin } from '@/contexts/AdminContext';
import Link from 'next/link';
import { useState } from 'react';

export default function Home() {
    const { isAdmin } = useAdmin();
    const [activeChartToken, setActiveChartToken] = useState("WBTC");

    return (
        <main className="min-h-screen p-6 text-white max-w-[1600px] mx-auto">
            {/* Header */}
            <header className="flex justify-between items-center mb-8 glass-panel p-4">
                <div className="flex items-center gap-3">
                    <img src="/logo.png" alt="Eswap Logo" className="object-contain flex-shrink-0 rounded-full bg-white/5 border border-white/10 p-1" style={{ width: '40px', height: '40px' }} />
                    <h1 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-purple-400 to-cyan-400 tracking-wider">
                        ESWAP
                    </h1>
                </div>

                <div className="flex items-center gap-4">
                    <AdminToggle />
                    {isAdmin && (
                        <Link
                            href="/admin"
                            className="text-xs bg-white/5 hover:bg-white/10 px-3 py-1.5 rounded border border-white/10 text-gray-400 hover:text-white transition-all uppercase tracking-widest font-bold"
                        >
                            Admin Panel
                        </Link>
                    )}
                    <Link
                        href="/swap"
                        className="text-xs bg-purple-500/10 hover:bg-purple-500/20 px-3 py-1.5 rounded border border-purple-500/20 text-purple-400 transition-all uppercase tracking-widest font-bold"
                    >
                        Swap
                    </Link>
                    <Link
                        href="/pools"
                        className="text-xs bg-green-500/10 hover:bg-green-500/20 px-3 py-1.5 rounded border border-green-500/20 text-green-400 transition-all uppercase tracking-widest font-bold"
                    >
                        Earn (Pools)
                    </Link>
                    <ConnectButton />
                </div>
            </header>

            {/* Dashboard Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">

                {/* Left Column (Main Focus): Chart & Positions */}
                <div className="lg:col-span-2 w-full space-y-6">
                    {/* Solver Integration Banner */}
                    <div className="glass-panel p-4 flex justify-between items-center bg-gradient-to-r from-purple-900/20 to-transparent border-l-4 border-l-purple-500">
                        <div>
                            <h3 className="text-sm font-bold text-purple-400 uppercase tracking-wider">Protocol Status: Solver-Ready</h3>
                            <p className="text-xs text-gray-400 mt-1">Unlimited TVL via V4 Flash Accounting. Discoverable by 1inch, UniswapX & CoW Swap.</p>
                        </div>
                        <div className="flex gap-2">
                            <span className="text-[10px] bg-green-500/20 text-green-400 px-2 py-1 rounded border border-green-500/20 font-bold">URC-2</span>
                            <span className="text-[10px] bg-green-500/20 text-green-400 px-2 py-1 rounded border border-green-500/20 font-bold">URC-3</span>
                            <span className="text-[10px] bg-green-500/20 text-green-400 px-2 py-1 rounded border border-green-500/20 font-bold">URC-4</span>
                        </div>
                    </div>

                    <LiveChart tokenKey={activeChartToken} />
                    <PositionsList />
                </div>

                {/* Right Column: Trade Execution & Balances */}
                <div className="space-y-6 w-full">
                    <TradeForm onTradingTokenChange={setActiveChartToken} />
                    <Balances />
                </div>
            </div>

        </main>
    );
}
