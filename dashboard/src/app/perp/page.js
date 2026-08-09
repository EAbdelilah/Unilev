'use client';

import { ConnectButton } from '@/components/ConnectButton';
import { AdminToggle } from '@/components/AdminToggle';
import { PerpLedgerPanel } from '@/components/PerpLedgerPanel';
import { useAdmin } from '@/contexts/AdminContext';
import Link from 'next/link';

export default function PerpPage() {
    const { isAdmin } = useAdmin();

    return (
        <main className="min-h-screen p-6 text-white max-w-[1600px] mx-auto">
            <header className="flex justify-between items-center mb-8 glass-panel p-4">
                <div className="flex items-center gap-3">
                    <Link href="/" className="hover:opacity-80 transition-opacity">
                        <img src="/logo.png" alt="Eswap Logo" className="object-contain flex-shrink-0 rounded-full bg-white/5 border border-white/10 p-1" style={{ width: '40px', height: '40px' }} />
                    </Link>
                    <h1 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-cyan-400 to-blue-400 tracking-wider border-l border-white/20 pl-4 ml-1">
                        PERP LEDGER
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
                    <Link href="/" className="text-sm text-gray-400 hover:text-white transition-colors">
                        ← Back to Trading
                    </Link>
                    <ConnectButton />
                </div>
            </header>

            <div className="max-w-5xl mx-auto">
                <PerpLedgerPanel />
            </div>
        </main>
    );
}
