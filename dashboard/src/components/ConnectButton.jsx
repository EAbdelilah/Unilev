
import { useAccount, useConnect, useDisconnect, useSwitchChain } from 'wagmi';
import { polygon, unichain, unichainSepolia } from 'wagmi/chains';
import { injected } from 'wagmi/connectors';
import { useState, useEffect } from 'react';

const SUPPORTED_CHAINS = [polygon, unichain, unichainSepolia];

export function ConnectButton() {
    const { address, isConnected, chainId } = useAccount();
    const { connect } = useConnect();
    const { disconnect } = useDisconnect();
    const { switchChain } = useSwitchChain();
    const [hasProvider, setHasProvider] = useState(false);
    const [targetChain, setTargetChain] = useState(polygon.id);

    useEffect(() => {
        setHasProvider(typeof window !== 'undefined' && typeof window.ethereum !== 'undefined');
    }, []);

    const isCorrectNetwork = SUPPORTED_CHAINS.some((c) => c.id === chainId);

    const handleSelectChange = (e) => {
        const next = Number(e.target.value);
        setTargetChain(next);
        // On a supported chain, switching the dropdown applies immediately.
        if (isCorrectNetwork) switchChain({ chainId: next });
    };

    if (isConnected) {
        return (
            <div className="flex items-center gap-3">
                <select
                    value={isCorrectNetwork ? chainId : targetChain}
                    onChange={handleSelectChange}
                    className="input-field bg-black/40 text-xs px-2 py-2 rounded border border-white/10 text-gray-300"
                    title="Network"
                >
                    {SUPPORTED_CHAINS.map((c) => (
                        <option key={c.id} value={c.id}>
                            {c.name}
                        </option>
                    ))}
                </select>
                {!isCorrectNetwork && (
                    <button
                        onClick={() => switchChain({ chainId: targetChain })}
                        className="primary-button bg-red-600/20 text-red-500 border-red-500/50 hover:bg-red-600/40 text-sm px-4 py-2"
                    >
                        Switch Network
                    </button>
                )}
                <span className="font-mono text-sm bg-white/10 px-3 py-1 rounded-full border border-white/10">
                    {address.slice(0, 6)}...{address.slice(-4)}
                </span>
                <button
                    onClick={() => disconnect()}
                    className="secondary-button text-sm px-4 py-2"
                >
                    Disconnect
                </button>
            </div>
        );
    }

    if (!hasProvider) {
        return (
            <a
                href="https://metamask.io/download/"
                target="_blank"
                rel="noopener noreferrer"
                className="secondary-button text-sm px-4 py-2 bg-orange-500/10 text-orange-400 border-orange-500/20 hover:bg-orange-500/20"
            >
                Install MetaMask
            </a>
        );
    }

    return (
        <button
            onClick={() => connect({ connector: injected() })}
            className="primary-button animate-pulse-glow"
        >
            Connect Wallet
        </button>
    );
}
