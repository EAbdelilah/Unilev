'use client';

import { useState } from 'react';
import { ConnectButton } from '@/components/ConnectButton';
import { ProtocolBalances } from '@/components/ProtocolBalances';
import { LiquidityPoolManager } from '@/components/LiquidityPoolManager';
import { SolverFunding } from '@/components/SolverFunding';
import { AdminToggle } from '@/components/AdminToggle';
import { useAdmin } from '@/contexts/AdminContext';
import Link from 'next/link';

export default function PoolsPage() {
    const [selectedPoolToken, setSelectedPoolToken] = useState('USDC');
    const { isAdmin } = useAdmin();

    return (
        <main className="min-h-screen p-6 text-white max-w-[1600px] mx-auto">
            {/* Header */}
            <header className="flex justify-between items-center mb-8 glass-panel p-4">
                <div className="flex items-center gap-3">
                    <Link href="/" className="hover:opacity-80 transition-opacity">
                        <div className="flex items-center gap-2">
                            <img src="/logo.png" alt="Eswap Logo" className="object-contain flex-shrink-0 rounded-full bg-white/5 border border-white/10 p-1" style={{ width: '40px', height: '40px' }} />
                        </div>
                    </Link>
                    <h1 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-purple-400 to-cyan-400 tracking-wider border-l border-white/20 pl-4 ml-1">
                        EARN (POOLS)
                    </h1>
                </div>
                <div className="flex items-center gap-4">
                    <AdminToggle />
                    {isAdmin && (
                        <Link href="/admin" className="text-xs bg-white/5 hover:bg-white/10 px-3 py-1.5 rounded border border-white/10 text-gray-400 hover:text-white transition-all uppercase tracking-widest font-bold">
                            Admin Panel
                        </Link>
                    )}
                    <Link href="/" className="text-sm text-gray-400 hover:text-white transition-colors">
                        ← Back to Trading
                    </Link>
                    <Link
                        href="/swap"
                        className="text-xs bg-purple-500/10 hover:bg-purple-500/20 px-3 py-1.5 rounded border border-purple-500/20 text-purple-400 transition-all uppercase tracking-widest font-bold"
                    >
                        Swap
                    </Link>
                    <ConnectButton />
                </div>
            </header>

            {/* Dashboard Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">

                {/* Left Column: Manage Liquidity + Fund Solver */}
                <div className="space-y-6 w-full">
                    <SolverFunding />
                    <LiquidityPoolManager
                        selectedTokenKey={selectedPoolToken}
                    />
                </div>

                {/* Right Column: Pool Stats */}
                <div className="lg:col-span-2 w-full">
                    <ProtocolBalances
                        selectedToken={selectedPoolToken}
                        onSelectToken={setSelectedPoolToken}
                    />
                </div>
            </div>

        </main>
    );
}
