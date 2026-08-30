'use client';

import { useState, useEffect, useCallback } from 'react';
import { ConnectButton } from '@/components/ConnectButton';
import { useAdmin } from '@/contexts/AdminContext';
import { useAdminHook } from '@/hooks/useAdminHook';
import { ethers } from 'ethers';
import Link from 'next/link';

function StatusBanner({ status }) {
    if (!status) return null;
    const isError = status.includes('failed') || status.includes('Error');
    return (
        <div className={`fixed top-4 right-4 z-50 max-w-md p-4 rounded-lg text-sm font-mono shadow-lg ${
            isError ? 'bg-red-900/90 border border-red-500/50 text-red-200' :
            status.includes('confirmed') ? 'bg-green-900/90 border border-green-500/50 text-green-200' :
            'bg-purple-900/90 border border-purple-500/50 text-purple-200'
        }`}>
            {status}
        </div>
    );
}

function Section({ title, icon, children, danger = false }) {
    return (
        <div className={`glass-panel p-6 ${danger ? 'border-red-500/30' : ''}`}>
            <h3 className={`text-lg font-bold mb-4 flex items-center gap-2 ${danger ? 'text-red-400' : 'text-gray-200'}`}>
                <span className="text-xl">{icon}</span> {title}
            </h3>
            {children}
        </div>
    );
}

function Field({ label, value, onChange, type = "text", placeholder, disabled, hint }) {
    return (
        <div>
            <label className="block text-xs text-gray-500 mb-1 uppercase tracking-wide">{label}</label>
            <input
                type={type}
                value={value || ''}
                onChange={onChange}
                placeholder={placeholder}
                disabled={disabled}
                className="input-field font-mono text-sm"
            />
            {hint && <p className="text-xs text-gray-600 mt-1">{hint}</p>}
        </div>
    );
}

function ActionButton({ onClick, label, loading, disabled, danger }) {
    return (
        <button
            onClick={onClick}
            disabled={loading || disabled}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
                danger
                    ? 'bg-red-600 hover:bg-red-500 text-white border border-red-500/30'
                    : 'primary-button bg-purple-600 hover:bg-purple-500 border-purple-500/20'
            } disabled:opacity-40 disabled:cursor-not-allowed`}
        >
            {loading ? '...' : label}
        </button>
    );
}

export default function AdminPage() {
    const { isAdmin } = useAdmin();
    const admin = useAdminHook();

    const [state, setState] = useState(null);
    const [loading, setLoading] = useState(true);

    // Editable form state
    const [form, setForm] = useState({
        newOwner: '',
        poolId: '',
        poolIdAuth: true,
        maxSingleOIBps: '',
        maxTotalOIBps: '',
        oiCapTvlFloorUsd: '',
        bandTriggerBps: '',
        routerAddr: '',
        minFloor: '',
        defaultMaxLev: '',
        feeBps: '',
        maxLeverage: '',
        tokenDecimalsAddr: '',
        tokenDecimalsVal: '',
        withdrawCurrency: '',
        withdrawTo: '',
        withdrawAmount: '',
        sweepCurrency: '',
        sweepTo: '',
        sweepAmount: '',
        perAddrFeeAddr: '',
        perAddrFeeBps: '',
        operatorAddr: '',
        operatorApproved: true,
        rescueTokenAddr: '',
        rescueTo: '',
        rescueAmount: '',
        standardPoolId: '',
        standardPoolFee: '',
        timelockTarget: '',
        timelockData: '',
        timelockEta: '',
    });

    const refresh = useCallback(async () => {
        setLoading(true);
        const data = await admin.readAll();
        if (data) {
            setState(data);
            setForm(f => ({
                ...f,
                maxSingleOIBps: data.maxSingleOIBps,
                maxTotalOIBps: data.maxTotalOIBps,
                oiCapTvlFloorUsd: data.oiCapTvlFloorUsd,
                bandTriggerBps: data.bandConsumptionTriggerBps,
                routerAddr: data.router,
                minFloor: data.minCollateralUsd,
                defaultMaxLev: data.defaultMaxLeverage,
                feeBps: data.reserveFactor,
                maxLeverage: data.defaultMaxLeverage,
            }));
        }
        setLoading(false);
    }, [admin.readAll]);

    useEffect(() => { refresh(); }, [refresh]);

    if (!isAdmin) {
        return (
            <main className="min-h-screen p-6 text-white max-w-[1600px] mx-auto flex flex-col items-center justify-center">
                <h1 className="text-3xl font-bold text-red-500 mb-4">Access Denied</h1>
                <p className="text-gray-400 mb-8">Connect an admin wallet to access this page.</p>
                <Link href="/" className="primary-button">Return Home</Link>
            </main>
        );
    }

    const fmt = (n) => {
        try { return ethers.formatEther(n); } catch { return n?.toString() || '0'; }
    };

    return (
        <main className="min-h-screen p-6 text-white max-w-[1600px] mx-auto">
            <StatusBanner status={admin.status} />

            {/* Header */}
            <header className="flex justify-between items-center mb-8 glass-panel p-4">
                <div className="flex items-center gap-3">
                    <Link href="/" className="hover:opacity-80 transition-opacity">
                        <img src="/logo.png" alt="Eswap" className="rounded-full bg-white/5 border border-white/10 p-1" style={{ width: '40px', height: '40px' }} />
                    </Link>
                    <h1 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-red-400 to-orange-400 tracking-wider border-l border-white/20 pl-4 ml-1">
                        PROTOCOL ADMIN
                    </h1>
                </div>
                <div className="flex items-center gap-4">
                    <button onClick={refresh} className="text-xs text-gray-500 hover:text-white transition-colors">
                        Refresh All
                    </button>
                    <Link href="/" className="text-sm text-gray-400 hover:text-white transition-colors">
                        ← Trading
                    </Link>
                    <ConnectButton />
                </div>
            </header>

            {/* Protocol Overview */}
            {state && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
                    {[
                        { label: 'Owner', value: `${state.owner.slice(0, 6)}...${state.owner.slice(-4)}` },
                        { label: 'Emergency Paused', value: state.emergencyPaused ? 'YES' : 'NO', warn: state.emergencyPaused },
                        { label: 'Total OI (USD)', value: `$${Number(state.totalOpenInterestUSD).toLocaleString()}` },
                        { label: 'Total Collateral (USD)', value: `$${Number(state.totalCollateralUSDRunning).toLocaleString()}` },
                    ].map((item) => (
                        <div key={item.label} className="glass-panel p-4">
                            <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">{item.label}</div>
                            <div className={`text-lg font-bold ${item.warn ? 'text-red-400' : 'text-gray-200'}`}>{item.value}</div>
                        </div>
                    ))}
                </div>
            )}

            {/* Main Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

                {/* EMERGENCY CONTROLS */}
                <Section title="Emergency Controls" icon="🚨" danger>
                    <div className="space-y-4">
                        <div className="flex items-center justify-between p-3 bg-black/30 rounded-lg">
                            <div>
                                <span className="text-sm text-gray-300">Protocol Status: </span>
                                <span className={`font-bold ${state?.emergencyPaused ? 'text-red-400' : 'text-green-400'}`}>
                                    {state?.emergencyPaused ? 'PAUSED' : 'ACTIVE'}
                                </span>
                            </div>
                            <div className="flex gap-2">
                                <ActionButton
                                    onClick={() => admin.setEmergencyPause(true)}
                                    label="PAUSE"
                                    loading={admin.loading}
                                    danger
                                />
                                <ActionButton
                                    onClick={() => admin.setEmergencyPause(false)}
                                    label="UNPAUSE"
                                    loading={admin.loading}
                                />
                            </div>
                        </div>
                        {state?.emergencyPaused && (
                            <p className="text-xs text-red-400/70">
                                When paused, new margin positions are blocked. Existing positions, closes, and liquidations still work.
                            </p>
                        )}
                    </div>
                </Section>

                {/* OWNERSHIP */}
                <Section title="Ownership" icon="🔑">
                    <div className="space-y-4">
                        <div className="p-3 bg-black/30 rounded-lg">
                            <span className="text-xs text-gray-500">Current Owner: </span>
                            <span className="font-mono text-sm text-gray-300">{state?.owner || '...'}</span>
                        </div>
                        <div className="flex gap-2">
                            <Field
                                label="New Owner Address"
                                value={form.newOwner}
                                onChange={(e) => setForm({ ...form, newOwner: e.target.value })}
                                placeholder="0x..."
                            />
                            <div className="flex items-end">
                                <ActionButton
                                    onClick={() => admin.transferOwnership(form.newOwner)}
                                    label="Transfer"
                                    loading={admin.loading}
                                    disabled={!form.newOwner || !ethers.isAddress(form.newOwner)}
                                    danger
                                />
                            </div>
                        </div>
                        <p className="text-xs text-gray-600">Ownership transfer is one-way. The new owner will have full admin access.</p>
                    </div>
                </Section>

                {/* OPEN INTEREST CAPS */}
                <Section title="Open Interest Caps" icon="📊">
                    <div className="space-y-4">
                        <div className="grid grid-cols-3 gap-3">
                            <Field label="Max Single (bps)" value={form.maxSingleOIBps} onChange={(e) => setForm({ ...form, maxSingleOIBps: e.target.value })} />
                            <Field label="Max Total (bps)" value={form.maxTotalOIBps} onChange={(e) => setForm({ ...form, maxTotalOIBps: e.target.value })} />
                            <Field label="TVL Floor (USD)" value={form.oiCapTvlFloorUsd} onChange={(e) => setForm({ ...form, oiCapTvlFloorUsd: e.target.value })} />
                        </div>
                        <ActionButton
                            onClick={() => admin.setOpenInterestCaps(form.maxSingleOIBps, form.maxTotalOIBps, form.oiCapTvlFloorUsd)}
                            label="Update OI Caps"
                            loading={admin.loading}
                        />
                    </div>
                </Section>

                {/* TWAP / BAND TRIGGER */}
                <Section title="TWAP Circuit Breaker" icon="⚡">
                    <div className="space-y-4">
                        <Field
                            label="Band Consumption Trigger (bps)"
                            value={form.bandTriggerBps}
                            onChange={(e) => setForm({ ...form, bandTriggerBps: e.target.value })}
                            hint="Max price movement before TWAP breaker halts trading"
                        />
                        <ActionButton
                            onClick={() => admin.setBandConsumptionTriggerBps(form.bandTriggerBps)}
                            label="Update Trigger"
                            loading={admin.loading}
                        />
                    </div>
                </Section>

                {/* ROUTER & FLOOR */}
                <Section title="Router & Min Collateral" icon="🔧">
                    <div className="space-y-4">
                        <Field label="Router Address" value={form.routerAddr} onChange={(e) => setForm({ ...form, routerAddr: e.target.value })} />
                        <Field
                            label="Min Collateral Floor (USD)"
                            value={form.minFloor}
                            onChange={(e) => setForm({ ...form, minFloor: e.target.value })}
                            hint="Minimum USD value for position collateral"
                        />
                        <ActionButton
                            onClick={() => admin.setRouterAndMinCollateralUsd(form.routerAddr, form.minFloor)}
                            label="Update Router & Floor"
                            loading={admin.loading}
                            disabled={!ethers.isAddress(form.routerAddr)}
                        />
                    </div>
                </Section>

                {/* CONFIG */}
                <Section title="Protocol Config" icon="⚙️">
                    <div className="space-y-4">
                        <div className="grid grid-cols-2 gap-3">
                            <Field label="Reserve Factor (bps)" value={form.feeBps} onChange={(e) => setForm({ ...form, feeBps: e.target.value })} hint="Protocol fee on borrow yield" />
                            <Field label="Max Leverage" value={form.maxLeverage} onChange={(e) => setForm({ ...form, maxLeverage: e.target.value })} hint="Default max leverage for new pools" />
                        </div>
                        <ActionButton
                            onClick={() => admin.setConfig({
                                defaultMaxLeverage: parseInt(form.maxLeverage) || 5,
                                reserveFactor: parseInt(form.feeBps) || 1000,
                            })}
                            label="Update Config"
                            loading={admin.loading}
                        />
                    </div>
                </Section>

                {/* POOL AUTHORIZATION */}
                <Section title="Pool Authorization" icon="🏊">
                    <div className="space-y-4">
                        <Field
                            label="Pool ID (bytes32 hex)"
                            value={form.poolId}
                            onChange={(e) => setForm({ ...form, poolId: e.target.value })}
                            placeholder="0x..."
                        />
                        <div className="flex items-center gap-4">
                            <label className="flex items-center gap-2 text-sm text-gray-300">
                                <input type="radio" checked={form.poolIdAuth} onChange={() => setForm({ ...form, poolIdAuth: true })} className="accent-purple-500" />
                                Authorize
                            </label>
                            <label className="flex items-center gap-2 text-sm text-gray-300">
                                <input type="radio" checked={!form.poolIdAuth} onChange={() => setForm({ ...form, poolIdAuth: false })} className="accent-red-500" />
                                Deauthorize
                            </label>
                            <ActionButton
                                onClick={() => admin.setAuthorizedPool(form.poolId, form.poolIdAuth)}
                                label={form.poolIdAuth ? 'Authorize' : 'Deauthorize'}
                                loading={admin.loading}
                                disabled={!form.poolId || form.poolId.length < 66}
                                danger={!form.poolIdAuth}
                            />
                        </div>
                        <p className="text-xs text-gray-600">Authorize/deauthorize a hook pool. Deauthorized pools block new positions.</p>
                    </div>
                </Section>

                {/* TOKEN DECIMALS */}
                <Section title="Token Decimals" icon="🔢">
                    <div className="space-y-4">
                        <div className="grid grid-cols-2 gap-3">
                            <Field label="Token Address" value={form.tokenDecimalsAddr} onChange={(e) => setForm({ ...form, tokenDecimalsAddr: e.target.value })} placeholder="0x..." />
                            <Field label="Decimals" value={form.tokenDecimalsVal} onChange={(e) => setForm({ ...form, tokenDecimalsVal: e.target.value })} placeholder="18" />
                        </div>
                        <ActionButton
                            onClick={() => admin.setTokenDecimals(form.tokenDecimalsAddr, parseInt(form.tokenDecimalsVal))}
                            label="Set Decimals"
                            loading={admin.loading}
                            disabled={!ethers.isAddress(form.tokenDecimalsAddr) || !form.tokenDecimalsVal}
                        />
                    </div>
                </Section>

                {/* WITHDRAW INSURANCE */}
                <Section title="Withdraw Insurance Fund" icon="🏦" danger>
                    <div className="space-y-4">
                        <div className="grid grid-cols-3 gap-3">
                            <Field label="Currency (address)" value={form.withdrawCurrency} onChange={(e) => setForm({ ...form, withdrawCurrency: e.target.value })} placeholder="0x..." />
                            <Field label="To (address)" value={form.withdrawTo} onChange={(e) => setForm({ ...form, withdrawTo: e.target.value })} placeholder="0x..." />
                            <Field label="Amount (wei)" value={form.withdrawAmount} onChange={(e) => setForm({ ...form, withdrawAmount: e.target.value })} />
                        </div>
                        <ActionButton
                            onClick={() => admin.withdrawInsuranceFund(form.withdrawCurrency, form.withdrawTo, form.withdrawAmount)}
                            label="Withdraw from Insurance"
                            loading={admin.loading}
                            disabled={!form.withdrawCurrency || !form.withdrawTo || !form.withdrawAmount}
                            danger
                        />
                    </div>
                </Section>

                {/* WITHDRAW PROTOCOL FEES */}
                <Section title="Withdraw Protocol Fees" icon="💰" danger>
                    <div className="space-y-4">
                        <div className="grid grid-cols-2 gap-3">
                            <Field label="Currency (address)" value={form.sweepCurrency} onChange={(e) => setForm({ ...form, sweepCurrency: e.target.value })} placeholder="0x..." />
                            <Field label="Amount (wei)" value={form.sweepAmount} onChange={(e) => setForm({ ...form, sweepAmount: e.target.value })} />
                        </div>
                        <ActionButton
                            onClick={() => admin.withdrawProtocolFee(form.sweepCurrency, form.sweepAmount)}
                            label="Withdraw Protocol Fees"
                            loading={admin.loading}
                            disabled={!form.sweepCurrency || !form.sweepAmount}
                            danger
                        />
                    </div>
                </Section>

                {/* SWEEP RESIDUE */}
                <Section title="Sweep Stranded Residue" icon="🧹">
                    <div className="space-y-4">
                        <div className="grid grid-cols-3 gap-3">
                            <Field label="Currency" value={form.sweepCurrency} onChange={(e) => setForm({ ...form, sweepCurrency: e.target.value })} placeholder="0x..." />
                            <Field label="To" value={form.sweepTo} onChange={(e) => setForm({ ...form, sweepTo: e.target.value })} placeholder="0x..." />
                            <Field label="Amount (wei)" value={form.sweepAmount} onChange={(e) => setForm({ ...form, sweepAmount: e.target.value })} />
                        </div>
                        <ActionButton
                            onClick={() => admin.sweepResidue(form.sweepCurrency, form.sweepTo, form.sweepAmount)}
                            label="Sweep Residue"
                            loading={admin.loading}
                            disabled={!form.sweepCurrency || !form.sweepTo || !form.sweepAmount}
                        />
                        <p className="text-xs text-gray-600">Sweeps stranded residue above the obligation floor (totalCollateral + insurance + fees).</p>
                    </div>
                </Section>

                {/* PER-ADDRESS FEE */}
                <Section title="Per-Address Protocol Fee" icon="🏷️">
                    <div className="space-y-4">
                        <div className="grid grid-cols-2 gap-3">
                            <Field label="Address" value={form.perAddrFeeAddr} onChange={(e) => setForm({ ...form, perAddrFeeAddr: e.target.value })} placeholder="0x..." />
                            <Field label="Fee (bps)" value={form.perAddrFeeBps} onChange={(e) => setForm({ ...form, perAddrFeeBps: e.target.value })} />
                        </div>
                        <ActionButton
                            onClick={() => admin.setAddressProtocolFee(form.perAddrFeeAddr, form.perAddrFeeBps)}
                            label="Set Per-Address Fee"
                            loading={admin.loading}
                            disabled={!ethers.isAddress(form.perAddrFeeAddr)}
                        />
                    </div>
                </Section>

                {/* OPERATOR MANAGEMENT */}
                <Section title="Operator Management" icon="👤">
                    <div className="space-y-4">
                        <Field label="Operator Address" value={form.operatorAddr} onChange={(e) => setForm({ ...form, operatorAddr: e.target.value })} placeholder="0x..." />
                        <div className="flex items-center gap-4">
                            <label className="flex items-center gap-2 text-sm text-gray-300">
                                <input type="radio" checked={form.operatorApproved} onChange={() => setForm({ ...form, operatorApproved: true })} className="accent-purple-500" />
                                Approve
                            </label>
                            <label className="flex items-center gap-2 text-sm text-gray-300">
                                <input type="radio" checked={!form.operatorApproved} onChange={() => setForm({ ...form, operatorApproved: false })} className="accent-red-500" />
                                Revoke
                            </label>
                            <ActionButton
                                onClick={() => admin.setOperator(form.operatorAddr, form.operatorApproved)}
                                label={form.operatorApproved ? 'Approve Operator' : 'Revoke Operator'}
                                loading={admin.loading}
                                disabled={!ethers.isAddress(form.operatorAddr)}
                            />
                        </div>
                        <p className="text-xs text-gray-600">Operators can act on behalf of users (e.g., liquidation keepers, solver bots).</p>
                    </div>
                </Section>

                {/* STANDARD POOL KEY */}
                <Section title="Standard Pool Key" icon="🔗">
                    <div className="space-y-4">
                        <Field
                            label="Hook Pool ID (bytes32 hex)"
                            value={form.standardPoolId}
                            onChange={(e) => setForm({ ...form, standardPoolId: e.target.value })}
                            placeholder="0x..."
                        />
                        <Field
                            label="Standard Pool Fee"
                            value={form.standardPoolFee}
                            onChange={(e) => setForm({ ...form, standardPoolFee: e.target.value })}
                            placeholder="500"
                            hint="Fee tier for the standard pool (e.g., 500 = 0.05%)"
                        />
                        <p className="text-xs text-gray-600">
                            Maps a hook pool to its standard pool for multi-pool execution. Fee tier, tickSpacing, and currencies are inherited from the hook pool.
                        </p>
                    </div>
                </Section>

                {/* RESCUE TOKEN */}
                <Section title="Rescue Stuck Tokens" icon="🆘">
                    <div className="space-y-4">
                        <div className="grid grid-cols-3 gap-3">
                            <Field label="Token Address" value={form.rescueTokenAddr} onChange={(e) => setForm({ ...form, rescueTokenAddr: e.target.value })} placeholder="0x..." />
                            <Field label="To" value={form.rescueTo} onChange={(e) => setForm({ ...form, rescueTo: e.target.value })} placeholder="0x..." />
                            <Field label="Amount (wei)" value={form.rescueAmount} onChange={(e) => setForm({ ...form, rescueAmount: e.target.value })} />
                        </div>
                        <ActionButton
                            onClick={() => admin.rescueToken(form.rescueTokenAddr, form.rescueTo, form.rescueAmount)}
                            label="Rescue Tokens"
                            loading={admin.loading}
                            disabled={!form.rescueTokenAddr || !form.rescueTo || !form.rescueAmount}
                        />
                    </div>
                </Section>

                {/* TIMELOCK */}
                <Section title="Timelock Admin" icon="⏰">
                    <div className="space-y-4">
                        <div className="p-3 bg-black/30 rounded-lg">
                            <span className="text-xs text-gray-500">Timelock: </span>
                            <span className="font-mono text-sm text-gray-300">{process.env.NEXT_PUBLIC_V4_TIMELOCK_ADDRESS || 'Not configured'}</span>
                        </div>
                        <Field
                            label="Target Contract"
                            value={form.timelockTarget}
                            onChange={(e) => setForm({ ...form, timelockTarget: e.target.value })}
                            placeholder="0x... (usually the hook)"
                        />
                        <div className="grid grid-cols-2 gap-3">
                            <Field
                                label="Calldata (hex)"
                                value={form.timelockData}
                                onChange={(e) => setForm({ ...form, timelockData: e.target.value })}
                                placeholder="0x..."
                            />
                            <Field
                                label="ETA (unix timestamp)"
                                value={form.timelockEta}
                                onChange={(e) => setForm({ ...form, timelockEta: e.target.value })}
                                placeholder="1735689600"
                            />
                        </div>
                        <div className="flex gap-2">
                            <ActionButton
                                onClick={() => admin.timelockQueue(form.timelockTarget, form.timelockData, form.timelockEta)}
                                label="Queue"
                                loading={admin.loading}
                            />
                            <ActionButton
                                onClick={() => admin.timelockExecute(form.timelockTarget, form.timelockData, form.timelockEta)}
                                label="Execute"
                                loading={admin.loading}
                            />
                        </div>
                        <p className="text-xs text-gray-600">
                            Queue time-gated admin operations. Min delay: 1 hour. Emergency pause bypasses timelock.
                        </p>
                    </div>
                </Section>

            </div>

            {/* Protocol State (read-only) */}
            {state && (
                <div className="mt-8 glass-panel p-6">
                    <h3 className="text-lg font-bold text-gray-200 mb-4">Protocol Read-Only State</h3>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                        {[
                            ['Router', `${state.router?.slice(0, 8)}...`],
                            ['Insurance Fund', fmt(state.insuranceFund)],
                            ['Total Collateral', fmt(state.totalCollateral)],
                            ['Total OI (USD)', `$${Number(state.totalOpenInterestUSD).toLocaleString()}`],
                            ['Collateral USD Running', `$${Number(state.totalCollateralUSDRunning).toLocaleString()}`],
                            ['Default Max Leverage', state.defaultMaxLeverage],
                            ['Min Collateral USD', `$${state.minCollateralUsd}`],
                            ['Liquidation Reward', `${state.liquidationRewardBps} bps`],
                            ['Liquidation Threshold', `${state.liquidationThresholdBps} bps`],
                            ['Reserve Factor', `${state.reserveFactor} bps`],
                            ['Max Price Swing', `${state.maxPriceSwingBps} bps`],
                            ['Band Trigger', `${state.bandConsumptionTriggerBps} bps`],
                            ['Max Single OI', `${state.maxSingleOIBps} bps`],
                            ['Max Total OI', `${state.maxTotalOIBps} bps`],
                            ['OI Cap TVL Floor', `$${state.oiCapTvlFloorUsd}`],
                            ['Require TWAP Oracle', state.requireTwapOracle ? 'Yes' : 'No'],
                        ].map(([label, value]) => (
                            <div key={label} className="p-3 bg-black/30 rounded-lg">
                                <div className="text-xs text-gray-500 uppercase">{label}</div>
                                <div className="font-mono text-gray-300 mt-1">{value}</div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {loading && (
                <div className="fixed bottom-4 left-4 z-50 p-3 bg-purple-900/80 rounded-lg text-sm text-purple-200 border border-purple-500/30">
                    Loading protocol state...
                </div>
            )}
        </main>
    );
}
