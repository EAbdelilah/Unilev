"use client";

import React from "react";

export function LiveChart({ tokenKey }) {
    const chartToken = tokenKey || "ETH";

    return (
        <div className="glass-panel w-full overflow-hidden flex flex-col mt-6">
            <div className="p-4 border-b border-white/5 flex items-center justify-between bg-black/20">
                <h3 className="text-sm font-bold text-gray-300 uppercase tracking-wider">
                    {chartToken} Price Chart (Unichain)
                </h3>
                <span className="text-[10px] font-bold text-green-400 bg-green-500/10 border border-green-500/20 rounded px-2 py-1">
                    LIVE FEED
                </span>
            </div>
            <div className="w-full" style={{ height: "400px" }}>
                <iframe
                    src={`https://dexscreener.com/unichain?q=${chartToken}&embed=1&theme=dark&trades=0&info=0`}
                    style={{ width: "100%", height: "100%", border: "none" }}
                    title="DexScreener Live Chart"
                ></iframe>
            </div>
        </div>
    );
}
