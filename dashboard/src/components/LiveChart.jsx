"use client";

import React, { useState } from "react";
import clsx from "clsx";

const UNICHAIN_ID = 130;
const UNICHAIN_SEPOLIA_ID = 1301;
const POLYGON_ID = 137;

// Canonical DexScreener pair pages (deepest liquidity, fetched live from the
// DexScreener API) per network. Fractional/native Unichain v4 pool ids are
// 66-hex and fully supported by DexScreener.
const PAIR_CONFIG = {
    WETH: {
        label: "WETH/USDC",
        [UNICHAIN_ID]: "0x8927058918e3CFf6F55EfE45A58db1be1F069E49",
        [UNICHAIN_SEPOLIA_ID]: "0x8927058918e3CFf6F55EfE45A58db1be1F069E49",
        [POLYGON_ID]: "0x853Ee4b2A13f8a742d64C8F088bE7bA2131f670d",
    },
    WBTC: {
        label: "WBTC/USDC",
        [UNICHAIN_ID]: "0xbd0f3a7cf4cf5f48ebe850474c8c0012fa5fe893ab811a8b8743a52b83aa8939",
        [UNICHAIN_SEPOLIA_ID]: "0xbd0f3a7cf4cf5f48ebe850474c8c0012fa5fe893ab811a8b8743a52b83aa8939",
        [POLYGON_ID]: "0xeEF1A9507B3D505f0062f2be9453981255b503c8",
    },
};

function networkFor(chainId) {
    if (chainId === POLYGON_ID) return "polygon";
    return "unichain";
}

function pairFor(tokenKey, chainId) {
    const cfg = PAIR_CONFIG[tokenKey] || {
        label: `${tokenKey}/USDC`,
        [UNICHAIN_ID]: "",
        [UNICHAIN_SEPOLIA_ID]: "",
        [POLYGON_ID]: "",
    };
    const pairAddress = cfg[chainId] || cfg[UNICHAIN_ID];
    return { label: cfg.label, pairAddress };
}

export function LiveChart({ tokenKey = "WETH", chainId, onTokenChange }) {
    const network = networkFor(chainId);
    const { label, pairAddress } = pairFor(tokenKey, chainId);
    const [loaded, setLoaded] = useState(false);

    const params = new URLSearchParams({
        embed: "1",
        theme: "dark",
        chartTheme: "dark",
        chartType: "usd",
        interval: "15",
        trades: "0",
        info: "0",
        chartLeftToolbar: "0",
    });

    const embedSrc = `https://dexscreener.com/${network}/${pairAddress}?${params}`;
    const openUrl = `https://dexscreener.com/${network}/${pairAddress}`;

    return (
        <div className="glass-panel w-full overflow-hidden flex flex-col mt-6">
            <div className="p-4 border-b border-white/5 flex items-center justify-between bg-black/20">
                <h3 className="text-sm font-bold text-gray-300 uppercase tracking-wider">
                    {label} Price Chart ({network})
                </h3>
                <div className="flex items-center gap-2">
                    <a
                        href={openUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[10px] text-gray-400 hover:text-white underline underline-offset-2"
                    >
                        Open ↗
                    </a>
                    <span className="text-[10px] font-bold text-green-400 bg-green-500/10 border border-green-500/20 rounded px-2 py-1">
                        LIVE FEED
                    </span>
                </div>
            </div>

            {onTokenChange && (
                <div className="flex gap-2 px-4 py-2 border-b border-white/5 bg-black/10">
                    {Object.keys(PAIR_CONFIG).map((key) => (
                        <button
                            key={key}
                            type="button"
                            onClick={() => onTokenChange(key)}
                            className={clsx(
                                "text-xs font-bold px-3 py-1.5 rounded border transition-all uppercase tracking-wider",
                                tokenKey === key
                                    ? "bg-cyan-500/10 border-cyan-500/40 text-cyan-400"
                                    : "bg-black/40 border-white/10 text-gray-400 hover:text-white hover:border-white/25"
                            )}
                        >
                            {PAIR_CONFIG[key].label}
                        </button>
                    ))}
                </div>
            )}

            <div className="relative w-full" style={{ height: "440px" }}>
                {!loaded && (
                    <div className="absolute inset-0 z-0 grid place-items-center bg-[#0b0e14]">
                        <div className="flex flex-col items-center gap-2">
                            <div className="w-6 h-6 border-2 border-cyan-500/30 border-t-cyan-400 rounded-full animate-spin"></div>
                            <span className="text-[11px] text-gray-500 font-mono">
                                Loading {label} chart…
                            </span>
                            <a
                                href={openUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-[11px] text-cyan-400 hover:underline underline-offset-2"
                            >
                                Open chart on DexScreener ↗
                            </a>
                        </div>
                    </div>
                )}
                <iframe
                    src={embedSrc}
                    onLoad={() => setLoaded(true)}
                    style={{ width: "100%", height: "100%", border: "none", position: "relative", zIndex: 1 }}
                    title="DexScreener Live Chart"
                ></iframe>
            </div>
        </div>
    );
}