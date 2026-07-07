"use client";

import React from "react";
import { useDeFi } from "../hooks/useDeFi";

export function LiveChart({ tokenKey }) {
    const { ADDRESSES } = useDeFi();
    
    // Map tokens to their deepest Uniswap V3 Pair on Polygon for DexScreener
    const pairMap = {
        "WBTC": "0x50eaEDB835021E4A108B7290636d62E9765cc6d7", // WBTC/WETH
        "WETH": "0xA4D8c89f0c20efbe54cBa9e7e7a7E509056228D9", // WETH/USDC
        "USDC": "0xA4D8c89f0c20efbe54cBa9e7e7a7E509056228D9", // USDC/WETH
        "DAI":  "0xe023d2Bd6a787b4D31494770FC9bAdC5726fCaae", // DAI/USDC
        "WPOL": "0xB6e57ed85c4c9dbfEF2a68711e9d6f36c56e0FcB"  // WPOL/USDC
    };
    
    const pairAddress = tokenKey && pairMap[tokenKey] ? pairMap[tokenKey] : pairMap["WBTC"];
        
    return (
        <div className="glass-panel w-full overflow-hidden flex flex-col mt-6 relative">
            <div className="p-4 border-b border-white/5 flex items-center justify-between bg-black/20 z-10">
                <h3 className="text-sm font-bold text-gray-300 uppercase tracking-wider">
                    {tokenKey || "WBTC"} Price Chart (Uniswap Polygon)
                </h3>
                <div className="text-[10px] text-green-400 font-mono flex items-center gap-1">
                    <div className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse"></div>
                    LIVE FEED
                </div>
            </div>
            <div className="w-full relative" style={{ height: "400px" }}>
                {/* Fallback Background while iframe loads */}
                <div className="absolute inset-0 bg-black/40 flex flex-col items-center justify-center pointer-events-none">
                    <div className="text-gray-600 text-xs animate-pulse">Syncing Liquidity Data...</div>
                </div>
                <iframe 
                    src={`https://dexscreener.com/polygon/${pairAddress}?embed=1&theme=dark&trades=0&info=0`}
                    className="w-full h-full border-none relative z-10"
                    title="DexScreener Live Chart"
                    loading="lazy"
                ></iframe>
            </div>
        </div>
    );
}
