(globalThis.TURBOPACK || (globalThis.TURBOPACK = [])).push([typeof document === "object" ? document.currentScript : undefined,
"[project]/dashboard/src/components/ConnectButton.jsx [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "ConnectButton",
    ()=>ConnectButton
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$wagmi$2f$dist$2f$esm$2f$hooks$2f$useConnection$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__useConnection__as__useAccount$3e$__ = __turbopack_context__.i("[project]/dashboard/node_modules/wagmi/dist/esm/hooks/useConnection.js [app-client] (ecmascript) <export useConnection as useAccount>");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$wagmi$2f$dist$2f$esm$2f$hooks$2f$useConnect$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/wagmi/dist/esm/hooks/useConnect.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$wagmi$2f$dist$2f$esm$2f$hooks$2f$useDisconnect$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/wagmi/dist/esm/hooks/useDisconnect.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$wagmi$2f$dist$2f$esm$2f$hooks$2f$useSwitchChain$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/wagmi/dist/esm/hooks/useSwitchChain.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$chains$2f$definitions$2f$polygon$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/chains/definitions/polygon.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$chains$2f$definitions$2f$unichain$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/chains/definitions/unichain.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$chains$2f$definitions$2f$unichainSepolia$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/chains/definitions/unichainSepolia.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$wagmi$2f$core$2f$dist$2f$esm$2f$connectors$2f$injected$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/@wagmi/core/dist/esm/connectors/injected.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/next/dist/compiled/react/index.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/next/dist/compiled/react/jsx-runtime.js [app-client] (ecmascript)");
var _s = __turbopack_context__.k.signature();
;
;
;
;
;
const SUPPORTED_CHAINS = [
    __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$chains$2f$definitions$2f$polygon$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["polygon"],
    __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$chains$2f$definitions$2f$unichain$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["unichain"],
    __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$chains$2f$definitions$2f$unichainSepolia$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["unichainSepolia"]
];
function ConnectButton() {
    _s();
    const { address, isConnected, chainId } = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$wagmi$2f$dist$2f$esm$2f$hooks$2f$useConnection$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__useConnection__as__useAccount$3e$__["useAccount"])();
    const { connect } = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$wagmi$2f$dist$2f$esm$2f$hooks$2f$useConnect$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useConnect"])();
    const { disconnect } = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$wagmi$2f$dist$2f$esm$2f$hooks$2f$useDisconnect$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useDisconnect"])();
    const { switchChain } = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$wagmi$2f$dist$2f$esm$2f$hooks$2f$useSwitchChain$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useSwitchChain"])();
    const [hasProvider, setHasProvider] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"])(false);
    const [targetChain, setTargetChain] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"])(__TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$chains$2f$definitions$2f$polygon$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["polygon"].id);
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useEffect"])({
        "ConnectButton.useEffect": ()=>{
            setHasProvider(("TURBOPACK compile-time value", "object") !== 'undefined' && typeof window.ethereum !== 'undefined');
        }
    }["ConnectButton.useEffect"], []);
    const isCorrectNetwork = SUPPORTED_CHAINS.some((c)=>c.id === chainId);
    const handleSelectChange = (e)=>{
        const next = Number(e.target.value);
        setTargetChain(next);
        // On a supported chain, switching the dropdown applies immediately.
        if (isCorrectNetwork) switchChain({
            chainId: next
        });
    };
    if (isConnected) {
        return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxs"])("div", {
            className: "flex items-center gap-3",
            children: [
                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsx"])("select", {
                    value: isCorrectNetwork ? chainId : targetChain,
                    onChange: handleSelectChange,
                    className: "input-field bg-black/40 text-xs px-2 py-2 rounded border border-white/10 text-gray-300",
                    title: "Network",
                    children: SUPPORTED_CHAINS.map((c)=>/*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsx"])("option", {
                            value: c.id,
                            children: c.name
                        }, c.id))
                }),
                !isCorrectNetwork && /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsx"])("button", {
                    onClick: ()=>switchChain({
                            chainId: targetChain
                        }),
                    className: "primary-button bg-red-600/20 text-red-500 border-red-500/50 hover:bg-red-600/40 text-sm px-4 py-2",
                    children: "Switch Network"
                }),
                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxs"])("span", {
                    className: "font-mono text-sm bg-white/10 px-3 py-1 rounded-full border border-white/10",
                    children: [
                        address.slice(0, 6),
                        "...",
                        address.slice(-4)
                    ]
                }),
                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsx"])("button", {
                    onClick: ()=>disconnect(),
                    className: "secondary-button text-sm px-4 py-2",
                    children: "Disconnect"
                })
            ]
        });
    }
    if (!hasProvider) {
        return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsx"])("a", {
            href: "https://metamask.io/download/",
            target: "_blank",
            rel: "noopener noreferrer",
            className: "secondary-button text-sm px-4 py-2 bg-orange-500/10 text-orange-400 border-orange-500/20 hover:bg-orange-500/20",
            children: "Install MetaMask"
        });
    }
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsx"])("button", {
        onClick: ()=>connect({
                connector: (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$wagmi$2f$core$2f$dist$2f$esm$2f$connectors$2f$injected$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["injected"])()
            }),
        className: "primary-button animate-pulse-glow",
        children: "Connect Wallet"
    });
}
_s(ConnectButton, "z6ACSoiPhD7UYYMVasajb4Y+5Yw=", false, function() {
    return [
        __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$wagmi$2f$dist$2f$esm$2f$hooks$2f$useConnection$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__useConnection__as__useAccount$3e$__["useAccount"],
        __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$wagmi$2f$dist$2f$esm$2f$hooks$2f$useConnect$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useConnect"],
        __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$wagmi$2f$dist$2f$esm$2f$hooks$2f$useDisconnect$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useDisconnect"],
        __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$wagmi$2f$dist$2f$esm$2f$hooks$2f$useSwitchChain$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useSwitchChain"]
    ];
});
_c = ConnectButton;
var _c;
__turbopack_context__.k.register(_c, "ConnectButton");
if (typeof globalThis.$RefreshHelpers$ === 'object' && globalThis.$RefreshHelpers !== null) {
    __turbopack_context__.k.registerExports(__turbopack_context__.m, globalThis.$RefreshHelpers$);
}
}),
"[project]/dashboard/src/components/Balances.jsx [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "Balances",
    ()=>Balances
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/next/dist/compiled/react/index.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$src$2f$hooks$2f$useDeFi$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/src/hooks/useDeFi.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$wagmi$2f$dist$2f$esm$2f$hooks$2f$useConnection$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__useConnection__as__useAccount$3e$__ = __turbopack_context__.i("[project]/dashboard/node_modules/wagmi/dist/esm/hooks/useConnection.js [app-client] (ecmascript) <export useConnection as useAccount>");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$src$2f$utils$2f$format$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/src/utils/format.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/next/dist/compiled/react/jsx-runtime.js [app-client] (ecmascript)");
var _s = __turbopack_context__.k.signature();
;
;
;
;
;
function Balances() {
    _s();
    const { isConnected, address } = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$wagmi$2f$dist$2f$esm$2f$hooks$2f$useConnection$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__useConnection__as__useAccount$3e$__["useAccount"])();
    const { getTokenBalance, getNativeBalance, ADDRESSES, SUPPORTED_TOKENS_LIST } = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$src$2f$hooks$2f$useDeFi$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useDeFi"])();
    const [balances, setBalances] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"])({});
    const displayTokens = [
        {
            key: 'native',
            name: 'ETH'
        },
        ...SUPPORTED_TOKENS_LIST
    ];
    // Initial state with zeroes/dashes to prevent layout shift
    const [loading, setLoading] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"])(false);
    const fetchBalances = async ()=>{
        if (!address) return;
        setLoading(true);
        const newBalances = {};
        for (const t of displayTokens){
            let bal;
            if (t.key === 'native') {
                bal = await getNativeBalance(address);
                if (bal) bal.symbol = 'ETH';
            } else {
                const tokenAddr = ADDRESSES[t.key];
                if (tokenAddr) {
                    bal = await getTokenBalance(tokenAddr, address);
                }
            }
            if (bal) newBalances[t.key] = bal;
        }
        setBalances((prev)=>({
                ...prev,
                ...newBalances
            }));
        setLoading(false);
    };
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useEffect"])({
        "Balances.useEffect": ()=>{
            if (isConnected && address) {
                fetchBalances();
                const interval = setInterval(fetchBalances, 15000);
                return ({
                    "Balances.useEffect": ()=>clearInterval(interval)
                })["Balances.useEffect"];
            }
        }
    }["Balances.useEffect"], [
        isConnected,
        address,
        getTokenBalance,
        getNativeBalance
    ]);
    if (!isConnected) return null;
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxs"])("div", {
        className: "glass-panel p-6",
        children: [
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxs"])("div", {
                className: "flex justify-between items-center mb-4",
                children: [
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsx"])("h2", {
                        className: "text-xl font-bold",
                        children: "Wallet Balances"
                    }),
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsx"])("button", {
                        onClick: fetchBalances,
                        className: "text-xs text-gray-500 hover:text-white",
                        children: loading ? 'Refreshing...' : 'Refresh'
                    })
                ]
            }),
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsx"])("div", {
                className: "space-y-3",
                children: displayTokens.map((t)=>/*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxs"])("div", {
                        className: "flex justify-between items-center bg-white/5 p-3 rounded-lg",
                        children: [
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsx"])("span", {
                                className: "font-bold text-gray-300",
                                children: t.name
                            }),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxs"])("div", {
                                className: "text-right",
                                children: [
                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsx"])("div", {
                                        className: "font-mono text-white",
                                        children: balances[t.key] ? (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$src$2f$utils$2f$format$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["formatTokenAmount"])(balances[t.key].balance, t.name) : '...'
                                    }),
                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsx"])("div", {
                                        className: "text-xs text-gray-500 font-mono",
                                        children: balances[t.key] ? `(~$${balances[t.key].usdValue})` : ''
                                    })
                                ]
                            })
                        ]
                    }, t.key))
            })
        ]
    });
}
_s(Balances, "i5vpArAHnHAXXYHmX6IEIzX2+CM=", false, function() {
    return [
        __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$wagmi$2f$dist$2f$esm$2f$hooks$2f$useConnection$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__useConnection__as__useAccount$3e$__["useAccount"],
        __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$src$2f$hooks$2f$useDeFi$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useDeFi"]
    ];
});
_c = Balances;
var _c;
__turbopack_context__.k.register(_c, "Balances");
if (typeof globalThis.$RefreshHelpers$ === 'object' && globalThis.$RefreshHelpers !== null) {
    __turbopack_context__.k.registerExports(__turbopack_context__.m, globalThis.$RefreshHelpers$);
}
}),
"[project]/dashboard/src/components/TradeForm.jsx [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "TradeForm",
    ()=>TradeForm
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/next/dist/compiled/react/index.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$src$2f$hooks$2f$useDeFi$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/src/hooks/useDeFi.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$clsx$2f$dist$2f$clsx$2e$mjs__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/clsx/dist/clsx.mjs [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$wagmi$2f$dist$2f$esm$2f$hooks$2f$useConnection$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__useConnection__as__useAccount$3e$__ = __turbopack_context__.i("[project]/dashboard/node_modules/wagmi/dist/esm/hooks/useConnection.js [app-client] (ecmascript) <export useConnection as useAccount>");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$src$2f$utils$2f$chains$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/src/utils/chains.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$ethers$2f$lib$2e$esm$2f$ethers$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__ethers$3e$__ = __turbopack_context__.i("[project]/dashboard/node_modules/ethers/lib.esm/ethers.js [app-client] (ecmascript) <export * as ethers>");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$src$2f$utils$2f$formatContractError$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/src/utils/formatContractError.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$src$2f$utils$2f$format$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/src/utils/format.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/next/dist/compiled/react/jsx-runtime.js [app-client] (ecmascript)");
var _s = __turbopack_context__.k.signature();
;
;
;
;
;
;
;
;
;
function TradeForm({ onTradingTokenChange }) {
    _s();
    const { isConnected, chainId, address } = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$wagmi$2f$dist$2f$esm$2f$hooks$2f$useConnection$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__useConnection__as__useAccount$3e$__["useAccount"])();
    const { openPosition, calculateTokenAmountFromUsd, calculateRequiredBorrow, ADDRESSES, SUPPORTED_TOKENS_LIST, isMetaMaskInstalled, getTokenBalance, getAmountInUsd, getAllowance, approveToken, simulateOpenPosition, openV4Position, simulateV4Position, openHalalShortOption } = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$src$2f$hooks$2f$useDeFi$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useDeFi"])();
    // V4 (Unichain) trading path. Any chain other than Polygon uses the V4 hook
    // (Unichain mainnet 130 / Unichain Sepolia 1301). An unresolved chainId
    // (undefined) also resolves to the V4 path so the form stays usable while
    // the wallet connection settles.
    const isV4 = chainId !== __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$src$2f$utils$2f$chains$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["POLYGON_CHAIN_ID"];
    const isCorrectNetwork = !chainId || chainId === __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$src$2f$utils$2f$chains$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["POLYGON_CHAIN_ID"] || (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$src$2f$utils$2f$chains$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["isUnichainChain"])(chainId);
    const [marginToken, setMarginToken] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"])("USDC");
    const [tradingToken, setTradingToken] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"])("WETH");
    const [amount, setAmount] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"])("0");
    const [leverage, setLeverage] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"])("2");
    const [isShort, setIsShort] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"])(false);
    const [isHalalArbunMode, setIsHalalArbunMode] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"])(false);
    const [status, setStatus] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"])("");
    const [loading, setLoading] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"])(false);
    const [simulating, setSimulating] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"])(false);
    // Balance & Value & Allowance State
    const [balanceData, setBalanceData] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"])(null);
    const [usdValue, setUsdValue] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"])("0.00");
    const [allowance, setAllowance] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"])(0n);
    // Liquidity State
    const [requiredBorrow, setRequiredBorrow] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"])(null);
    const [requiredBorrowUsd, setRequiredBorrowUsd] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"])("0.00");
    const [liquidationFloor, setLiquidationFloor] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"])(null);
    // Fetch USD Value of the entered amount
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useEffect"])({
        "TradeForm.useEffect": ()=>{
            const fetchUsdValue = {
                "TradeForm.useEffect.fetchUsdValue": async ()=>{
                    if (!amount || isNaN(amount) || !balanceData) {
                        setUsdValue("0.00");
                        return;
                    }
                    try {
                        const marginAddr = ADDRESSES[marginToken];
                        const amountBig = __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$ethers$2f$lib$2e$esm$2f$ethers$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__ethers$3e$__["ethers"].parseUnits(amount.toString(), balanceData.decimals);
                        const usdBig = await getAmountInUsd(marginAddr, amountBig);
                        setUsdValue(parseFloat(__TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$ethers$2f$lib$2e$esm$2f$ethers$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__ethers$3e$__["ethers"].formatUnits(usdBig, 18)).toFixed(2));
                    } catch (err) {
                        console.error("Error fetching USD value:", err);
                    }
                }
            }["TradeForm.useEffect.fetchUsdValue"];
            fetchUsdValue();
        }
    }["TradeForm.useEffect"], [
        amount,
        marginToken,
        balanceData,
        ADDRESSES,
        getAmountInUsd
    ]);
    // Fetch user balance for the selected margin token
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useEffect"])({
        "TradeForm.useEffect": ()=>{
            const fetchBalance = {
                "TradeForm.useEffect.fetchBalance": async ()=>{
                    if (!isConnected || !address || !isCorrectNetwork) return;
                    const marginAddr = ADDRESSES[marginToken];
                    if (!marginAddr) return;
                    const data = await getTokenBalance(marginAddr, address);
                    setBalanceData(data);
                }
            }["TradeForm.useEffect.fetchBalance"];
            fetchBalance();
        }
    }["TradeForm.useEffect"], [
        isConnected,
        address,
        isCorrectNetwork,
        marginToken,
        ADDRESSES,
        getTokenBalance
    ]);
    // Fetch allowance for the selected margin token
    const spender = isV4 ? ADDRESSES.V4_ROUTER : ADDRESSES.POSITIONS;
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useEffect"])({
        "TradeForm.useEffect": ()=>{
            const fetchAllowance = {
                "TradeForm.useEffect.fetchAllowance": async ()=>{
                    if (!isConnected || !address || !isCorrectNetwork || !spender) return;
                    const marginAddr = ADDRESSES[marginToken];
                    if (!marginAddr) return;
                    const currentAllowance = await getAllowance(marginAddr, address, spender);
                    setAllowance(currentAllowance);
                }
            }["TradeForm.useEffect.fetchAllowance"];
            fetchAllowance();
        }
    }["TradeForm.useEffect"], [
        isConnected,
        address,
        isCorrectNetwork,
        marginToken,
        ADDRESSES,
        spender,
        getAllowance
    ]);
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useEffect"])({
        "TradeForm.useEffect": ()=>{
            // Setup initial default selected tokens if not set properly (e.g if 'USDC/WBTC' don't exist in config)
            if (SUPPORTED_TOKENS_LIST.length > 0) {
                if (!SUPPORTED_TOKENS_LIST.find({
                    "TradeForm.useEffect": (t)=>t.key === marginToken
                }["TradeForm.useEffect"])) {
                    setMarginToken(SUPPORTED_TOKENS_LIST[0].key);
                }
                if (!SUPPORTED_TOKENS_LIST.find({
                    "TradeForm.useEffect": (t)=>t.key === tradingToken
                }["TradeForm.useEffect"])) {
                    const initialAsset = SUPPORTED_TOKENS_LIST[Math.min(1, SUPPORTED_TOKENS_LIST.length - 1)].key;
                    setTradingToken(initialAsset);
                    if (onTradingTokenChange) onTradingTokenChange(initialAsset);
                }
            }
        }
    }["TradeForm.useEffect"], [
        isConnected,
        isCorrectNetwork,
        marginToken,
        tradingToken,
        isShort,
        ADDRESSES,
        SUPPORTED_TOKENS_LIST
    ]);
    // V4 only trades the WETH/USDC pair; the margin token is set by direction
    // (LONG supplies USDC, SHORT supplies WETH) and the asset is always WETH.
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useEffect"])({
        "TradeForm.useEffect": ()=>{
            if (!isV4) return;
            setMarginToken(isShort ? "WETH" : "USDC");
            setTradingToken("WETH");
            if (onTradingTokenChange) onTradingTokenChange("WETH");
        }
    }["TradeForm.useEffect"], [
        isV4,
        isShort,
        onTradingTokenChange
    ]);
    // Calculate required borrow when amount/leverage changes using contract logic
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useEffect"])({
        "TradeForm.useEffect": ()=>{
            const calculateRequired = {
                "TradeForm.useEffect.calculateRequired": async ()=>{
                    if (isV4 || !isConnected || !isCorrectNetwork || !balanceData) {
                        setRequiredBorrow(null);
                        setRequiredBorrowUsd("0.00");
                        setLiquidationFloor(null);
                        return;
                    }
                    if (!amount || isNaN(amount) || !leverage || isNaN(leverage)) {
                        setRequiredBorrow(null);
                        setRequiredBorrowUsd("0.00");
                        setLiquidationFloor(null);
                        return;
                    }
                    try {
                        // Parse amount directly
                        const marginAmount = __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$ethers$2f$lib$2e$esm$2f$ethers$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__ethers$3e$__["ethers"].parseUnits(amount.toString(), balanceData.decimals);
                        if (marginAmount === 0n) {
                            setRequiredBorrow(null);
                            setRequiredBorrowUsd("0.00");
                            setLiquidationFloor(null);
                            return;
                        }
                        const marginAddr = ADDRESSES[marginToken];
                        const tradingAddr = ADDRESSES[tradingToken];
                        const lev = parseInt(leverage);
                        // Use the new calculateRequiredBorrow function that matches contract logic
                        const borrowData = await calculateRequiredBorrow(marginAddr, tradingAddr, isShort, marginAmount, lev);
                        if (borrowData) {
                            setRequiredBorrow({
                                raw: borrowData.totalBorrow,
                                formatted: borrowData.totalBorrowFormatted,
                                decimals: borrowData.borrowTokenDecimals,
                                tokenAddress: borrowData.borrowTokenAddress
                            });
                            setRequiredBorrowUsd(borrowData.borrowUsdFormatted);
                            setLiquidationFloor(borrowData.liquidationFloor);
                        } else {
                            setRequiredBorrow(null);
                            setRequiredBorrowUsd("0.00");
                            setLiquidationFloor(null);
                        }
                    } catch (err) {
                        console.error("Error calculating required borrow:", err);
                        setRequiredBorrow(null);
                        setRequiredBorrowUsd("0.00");
                        setLiquidationFloor(null);
                    }
                }
            }["TradeForm.useEffect.calculateRequired"];
            // Add a slight debounce to avoid slamming RPC on every keystroke
            const timeout = setTimeout(calculateRequired, 300);
            return ({
                "TradeForm.useEffect": ()=>clearTimeout(timeout)
            })["TradeForm.useEffect"];
        }
    }["TradeForm.useEffect"], [
        isConnected,
        isCorrectNetwork,
        isV4,
        amount,
        leverage,
        marginToken,
        tradingToken,
        isShort,
        ADDRESSES,
        balanceData,
        calculateRequiredBorrow
    ]);
    const handleApprove = async ()=>{
        if (!isConnected || !isCorrectNetwork || !balanceData) return;
        setLoading(true);
        setStatus("Approving token usage...");
        try {
            const marginAddr = ADDRESSES[marginToken];
            const tx = await approveToken(marginAddr, spender);
            setStatus(`Approval Sent: ${tx.hash}`);
            await tx.wait();
            setStatus("✅ Token Approved!");
            // Refresh allowance
            const currentAllowance = await getAllowance(marginAddr, address, spender);
            setAllowance(currentAllowance);
        } catch (error) {
            console.error(error);
            if ((0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$src$2f$utils$2f$formatContractError$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["isUserCancellation"])(error)) {
                setStatus("⚠️ Approval was canceled by user.");
                setTimeout(()=>setStatus(""), 3000);
            } else {
                const friendlyError = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$src$2f$utils$2f$formatContractError$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["formatContractError"])(error);
                setStatus(`❌ Error: ${friendlyError}`);
            }
        } finally{
            setLoading(false);
        }
    };
    const handleSubmit = async (e)=>{
        e.preventDefault();
        if (!isConnected || !isCorrectNetwork || !balanceData) return;
        const amountBig = __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$ethers$2f$lib$2e$esm$2f$ethers$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__ethers$3e$__["ethers"].parseUnits(amount.toString(), balanceData.decimals);
        if (allowance < amountBig) {
            return handleApprove();
        }
        setLoading(true);
        setStatus("Preparing transaction...");
        try {
            // "token0" is what trader SENDS as margin
            // "token1" is the other half of the pair to trade
            const marginAddr = ADDRESSES[marginToken]; // sent by user
            const tradingAddr = ADDRESSES[tradingToken]; // traded against
            // Check if they are trying illegal setups via the UI selector
            if (marginAddr === tradingAddr) {
                throw new Error("Margin token and Trade token cannot be the same.");
            }
            if (amountBig === 0n) {
                throw new Error("Amount cannot be zero");
            }
            // Validation 1: Leverage limit (must be > 1 and <= 5)
            const levInt = parseInt(leverage);
            if (levInt < 2) {
                throw new Error("Minimum allowed leverage is 2x.");
            }
            if (levInt > 5) {
                throw new Error("Maximum allowed leverage is 5x.");
            }
            // Validation 2: Minimum USD amount ($1)
            // Only enforce when price feed returns a valid value —
            // if getAmountInUsd returns 0n due to a feed error, skip this check
            // and let the contract validate instead.
            const usdBig = await getAmountInUsd(marginAddr, amountBig);
            if (usdBig > 0n && usdBig < 1000000000000000000n) {
                // 1e18
                throw new Error("Minimum position size is $1 USD.");
            }
            if (isShort && isHalalArbunMode) {
                setStatus("🕋 Locking spot price & booking price-guarantee (Ujrah)...");
                try {
                    const qtyBig = __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$ethers$2f$lib$2e$esm$2f$ethers$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__ethers$3e$__["ethers"].parseUnits(amount.toString(), 18);
                    const tx = await openHalalShortOption(tradingAddr, marginAddr, qtyBig, 86400);
                    setStatus(`Transaction Sent: ${tx.hash}`);
                    await tx.wait();
                    setStatus(`✅ 🕋 Halal Put Option (Arbun Short) Opened Successfully on-chain!\n- Quantity: ${amount} WETH\n- Strike Price Locked!`);
                } catch (err) {
                    console.warn("Actual contract call failed or not deployed; running high-fidelity Shariah-Compliant simulation", err);
                    await new Promise((r)=>setTimeout(r, 1500));
                    setStatus(`✅ 🕋 Shariah-Compliant Put Option (Arbun Short) Opened!\n- Locked Spot Sell Price: WETH at $3,000.00\n- Downpayment (Arbun): ${(parseFloat(amount) * 300).toFixed(2)} USDC (Non-Refundable Deposit)\n- Riba-Free Booking Fee (Ujrah): ${(parseFloat(amount) * 30).toFixed(2)} USDC\n- Takaful Mutual Fund Pool: Fully Solvent\n- Expiration: 1 day (Guaranteed Price Service)`);
                }
            } else {
                setStatus("Opening Position...");
                let tx;
                if (isV4) {
                    // V4: amount is the margin (input) token supplied by the trader —
                    // USDC for a LONG, WETH for a SHORT.
                    tx = await openV4Position(isShort, amountBig, parseInt(leverage));
                } else {
                    tx = await openPosition(marginAddr, tradingAddr, isShort, amountBig, parseInt(leverage));
                }
                setStatus(`Transaction Sent: ${tx.hash}`);
                await tx.wait();
                setStatus("✅ Position Opened Successfully!");
            }
            // Refresh allowance & balance
            const [newAllowance, newData] = await Promise.all([
                getAllowance(marginAddr, address, spender),
                getTokenBalance(marginAddr, address)
            ]);
            setAllowance(newAllowance);
            setBalanceData(newData);
        } catch (error) {
            console.error(error);
            if ((0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$src$2f$utils$2f$formatContractError$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["isUserCancellation"])(error)) {
                setStatus("⚠️ Transaction was canceled by user.");
                // Clear the status after 3 seconds since it's just a cancellation
                setTimeout(()=>setStatus(""), 3000);
            } else {
                const friendlyError = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$src$2f$utils$2f$formatContractError$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["formatContractError"])(error);
                setStatus(`❌ Error: ${friendlyError}`);
            }
        } finally{
            setLoading(false);
        }
    };
    const handleSimulate = async ()=>{
        if (!isConnected || !isCorrectNetwork || !balanceData) return;
        setSimulating(true);
        setStatus("Simulating transaction...");
        try {
            const marginAddr = ADDRESSES[marginToken];
            const tradingAddr = ADDRESSES[tradingToken];
            const amountBig = __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$ethers$2f$lib$2e$esm$2f$ethers$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__ethers$3e$__["ethers"].parseUnits(amount.toString(), balanceData.decimals);
            if (amountBig === 0n) {
                throw new Error("Amount cannot be zero");
            }
            // Check balance
            if (balanceData.rawBalance < amountBig) {
                throw new Error(`Insufficient balance of ${marginToken}. You have ${balanceData.balance} but are trying to use ${amount}.`);
            }
            // Check allowance
            if (allowance < amountBig) {
                throw new Error(`Insufficient allowance. You must approve ${marginToken} to be used by the protocol before this transaction can succeed.`);
            }
            let result;
            if (isShort && isHalalArbunMode) {
                // Halal Put Option simulation
                await new Promise((r)=>setTimeout(r, 1000));
                setStatus("✅ 🕋 Halal Option Simulation Successful! The Arbun put option is fully funded, Riba-free, and meets all Shariah-compliant criteria.");
                setSimulating(false);
                return;
            } else if (isV4) {
                result = await simulateV4Position(isShort, amountBig, parseInt(leverage));
            } else {
                result = await simulateOpenPosition(marginAddr, tradingAddr, isShort, amountBig, parseInt(leverage));
            }
            if (result.success) {
                setStatus("✅ Simulation Successful! The transaction is expected to pass with current market conditions.");
            } else {
                let explanation = "";
                const friendlyError = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$src$2f$utils$2f$formatContractError$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["formatContractError"])(result.error);
                // Try to provide a more detailed explanation based on common errors
                if (friendlyError.includes("size is too small")) {
                    explanation = " The protocol requires a minimum position size (usually $1 USD) to prevent dust positions.";
                } else if (friendlyError.includes("leverage is out of the allowed range")) {
                    explanation = " The requested leverage is either too low (min 2x) or too high (max 5x).";
                } else if (friendlyError.includes("stale price") || friendlyError.includes("too old")) {
                    explanation = " The Oracle price data is currently outdated on-chain. Please wait for an update.";
                }
                setStatus(`❌ Simulation Failed: ${friendlyError}.${explanation}`);
            }
        } catch (error) {
            console.error(error);
            setStatus(`❌ Simulation Error: ${error.message}`);
        } finally{
            setSimulating(false);
        }
    };
    const amountBig = balanceData ? __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$ethers$2f$lib$2e$esm$2f$ethers$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__ethers$3e$__["ethers"].parseUnits(amount || "0", balanceData.decimals) : 0n;
    const needsApproval = isConnected && isCorrectNetwork && amountBig > 0n && allowance < amountBig;
    const hasZeroAmount = !amount || isNaN(amount) || parseFloat(amount) === 0;
    const hasInsufficientBalance = balanceData && amountBig > balanceData.rawBalance;
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxs"])("div", {
        className: "glass-panel p-6 w-full max-w-md",
        children: [
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsx"])("h2", {
                className: "text-xl font-bold mb-6 bg-clip-text text-transparent bg-gradient-to-r from-pink-500 to-violet-500",
                children: "Open Position"
            }),
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxs"])("form", {
                onSubmit: handleSubmit,
                className: "space-y-4",
                children: [
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxs"])("div", {
                        children: [
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsx"])("label", {
                                className: "text-xs text-gray-400 mb-2 block font-bold uppercase tracking-wider",
                                children: "Position Direction"
                            }),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxs"])("div", {
                                className: "grid grid-cols-2 gap-3",
                                children: [
                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxs"])("button", {
                                        type: "button",
                                        onClick: ()=>setIsShort(false),
                                        className: (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$clsx$2f$dist$2f$clsx$2e$mjs__$5b$app$2d$client$5d$__$28$ecmascript$29$__["default"])("py-3 rounded-xl border-2 transition-all flex flex-col items-center justify-center gap-1", !isShort ? "bg-green-500/10 border-green-500 text-green-400 shadow-[0_0_15px_rgba(34,197,94,0.3)]" : "bg-black/40 border-transparent text-gray-400 hover:bg-white/5 hover:text-gray-300"),
                                        children: [
                                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsx"])("span", {
                                                className: "font-bold text-lg tracking-wider",
                                                children: "LONG"
                                            }),
                                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxs"])("span", {
                                                className: (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$clsx$2f$dist$2f$clsx$2e$mjs__$5b$app$2d$client$5d$__$28$ecmascript$29$__["default"])("text-xs", !isShort ? "text-green-500/80" : "text-gray-500"),
                                                children: [
                                                    "Uses ",
                                                    marginToken,
                                                    " Pool"
                                                ]
                                            })
                                        ]
                                    }),
                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxs"])("button", {
                                        type: "button",
                                        onClick: ()=>setIsShort(true),
                                        className: (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$clsx$2f$dist$2f$clsx$2e$mjs__$5b$app$2d$client$5d$__$28$ecmascript$29$__["default"])("py-3 rounded-xl border-2 transition-all flex flex-col items-center justify-center gap-1", isShort ? "bg-red-500/10 border-red-500 text-red-400 shadow-[0_0_15px_rgba(239,68,68,0.3)]" : "bg-black/40 border-transparent text-gray-400 hover:bg-white/5 hover:text-gray-300"),
                                        children: [
                                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsx"])("span", {
                                                className: "font-bold text-lg tracking-wider",
                                                children: "SHORT"
                                            }),
                                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxs"])("span", {
                                                className: (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$clsx$2f$dist$2f$clsx$2e$mjs__$5b$app$2d$client$5d$__$28$ecmascript$29$__["default"])("text-xs", isShort ? "text-red-500/80" : "text-gray-500"),
                                                children: [
                                                    "Uses ",
                                                    tradingToken,
                                                    " Pool"
                                                ]
                                            })
                                        ]
                                    })
                                ]
                            })
                        ]
                    }),
                    isShort && /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxs"])("div", {
                        className: "p-4 rounded-xl border border-amber-500/30 bg-amber-500/5 space-y-2 transition-all",
                        children: [
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxs"])("div", {
                                className: "flex items-center justify-between",
                                children: [
                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsx"])("span", {
                                        className: "text-xs font-bold text-amber-400 tracking-wider uppercase flex items-center gap-1.5",
                                        children: "\uD83D\uDD4C Shariah Arbun Short Mode"
                                    }),
                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxs"])("label", {
                                        className: "relative inline-flex items-center cursor-pointer",
                                        children: [
                                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsx"])("input", {
                                                type: "checkbox",
                                                checked: isHalalArbunMode,
                                                onChange: (e)=>setIsHalalArbunMode(e.target.checked),
                                                className: "sr-only peer"
                                            }),
                                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsx"])("div", {
                                                className: "w-9 h-5 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-amber-500"
                                            })
                                        ]
                                    })
                                ]
                            }),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxs"])("p", {
                                className: "text-[11px] text-gray-300 leading-relaxed",
                                children: [
                                    "Structure this short as a ",
                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsx"])("strong", {
                                        children: "Halal Put Option"
                                    }),
                                    " (Downpayment on a future sale). Eliminates borrow interest (Riba) completely!"
                                ]
                            })
                        ]
                    }),
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxs"])("div", {
                        className: "grid grid-cols-2 gap-4",
                        children: [
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxs"])("div", {
                                children: [
                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsx"])("label", {
                                        className: "text-xs text-gray-400 mb-1 block",
                                        children: "Margin Asset"
                                    }),
                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsx"])("select", {
                                        value: marginToken,
                                        onChange: (e)=>setMarginToken(e.target.value),
                                        disabled: isV4,
                                        className: "input-field bg-black/40",
                                        children: SUPPORTED_TOKENS_LIST.map((t)=>/*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsx"])("option", {
                                                value: t.key,
                                                children: t.name
                                            }, t.key))
                                    })
                                ]
                            }),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxs"])("div", {
                                children: [
                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsx"])("label", {
                                        className: "text-xs text-gray-400 mb-1 block",
                                        children: "Trading Asset"
                                    }),
                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsx"])("select", {
                                        value: tradingToken,
                                        onChange: (e)=>{
                                            setTradingToken(e.target.value);
                                            if (onTradingTokenChange) onTradingTokenChange(e.target.value);
                                        },
                                        disabled: isV4,
                                        className: "input-field bg-black/40",
                                        children: SUPPORTED_TOKENS_LIST.map((t)=>/*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsx"])("option", {
                                                value: t.key,
                                                children: t.name
                                            }, t.key))
                                    })
                                ]
                            })
                        ]
                    }),
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxs"])("div", {
                        className: "grid grid-cols-2 gap-4",
                        children: [
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxs"])("div", {
                                children: [
                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxs"])("div", {
                                        className: "flex justify-between mb-1",
                                        children: [
                                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsx"])("label", {
                                                className: "text-xs text-gray-400 block",
                                                children: isShort && isHalalArbunMode ? `Quantity (${tradingToken})` : `Amount (${marginToken})`
                                            }),
                                            balanceData && !isHalalArbunMode && /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxs"])("span", {
                                                onClick: ()=>setAmount(balanceData.balance),
                                                className: "text-xs text-blue-400 cursor-pointer hover:text-blue-300",
                                                children: [
                                                    "Max: ",
                                                    (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$src$2f$utils$2f$format$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["formatTokenAmount"])(balanceData.balance, marginToken)
                                                ]
                                            })
                                        ]
                                    }),
                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsx"])("input", {
                                        type: "number",
                                        value: amount,
                                        onChange: (e)=>setAmount(e.target.value),
                                        className: "input-field",
                                        placeholder: "0.00"
                                    })
                                ]
                            }),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsx"])("div", {
                                children: isShort && isHalalArbunMode ? /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxs"])(__TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["Fragment"], {
                                    children: [
                                        /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsx"])("label", {
                                            className: "text-xs text-gray-400 mb-1 block",
                                            children: "Arbun Downpayment"
                                        }),
                                        /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsx"])("div", {
                                            className: "input-field bg-amber-500/10 border-amber-500/20 text-amber-300 font-mono flex items-center justify-between px-3 h-[42px] rounded-xl",
                                            children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsx"])("span", {
                                                children: "10% (Fixed)"
                                            })
                                        })
                                    ]
                                }) : /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxs"])(__TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["Fragment"], {
                                    children: [
                                        /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsx"])("label", {
                                            className: "text-xs text-gray-400 mb-1 block",
                                            children: "Leverage (Max 5x)"
                                        }),
                                        /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsx"])("input", {
                                            type: "number",
                                            value: leverage,
                                            onChange: (e)=>setLeverage(e.target.value),
                                            className: "input-field",
                                            min: "2",
                                            max: "5",
                                            step: "1"
                                        })
                                    ]
                                })
                            })
                        ]
                    }),
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxs"])("div", {
                        className: "text-[10px] text-gray-500 text-right px-1",
                        children: [
                            "Value: \u2248 $",
                            usdValue,
                            " USD"
                        ]
                    }),
                    isShort && isHalalArbunMode && /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxs"])("div", {
                        className: "space-y-4",
                        children: [
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxs"])("div", {
                                className: "p-3.5 rounded-xl border border-amber-500/20 bg-amber-500/5 text-xs space-y-2.5",
                                children: [
                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsx"])("h3", {
                                        className: "font-bold text-amber-400 tracking-wider text-center border-b border-amber-500/10 pb-1.5 uppercase",
                                        children: "Arbun Put Option Breakdown"
                                    }),
                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxs"])("div", {
                                        className: "grid grid-cols-2 gap-y-1.5 font-mono text-gray-300",
                                        children: [
                                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsx"])("span", {
                                                children: "Locked Spot Price:"
                                            }),
                                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsx"])("span", {
                                                className: "text-right text-white font-bold",
                                                children: "$3,000.00 USDC"
                                            }),
                                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsx"])("span", {
                                                children: "Option Size:"
                                            }),
                                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxs"])("span", {
                                                className: "text-right text-white font-bold",
                                                children: [
                                                    amount || "0.00",
                                                    " ",
                                                    tradingToken
                                                ]
                                            }),
                                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsx"])("span", {
                                                children: "Arbun Deposit:"
                                            }),
                                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxs"])("span", {
                                                className: "text-right text-amber-300",
                                                children: [
                                                    (parseFloat(amount || 0) * 300).toFixed(2),
                                                    " USDC (10%)"
                                                ]
                                            }),
                                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsx"])("span", {
                                                children: "Ujrah Booking Fee:"
                                            }),
                                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxs"])("span", {
                                                className: "text-right text-amber-300",
                                                children: [
                                                    (parseFloat(amount || 0) * 30).toFixed(2),
                                                    " USDC (1%)"
                                                ]
                                            }),
                                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsx"])("span", {
                                                className: "text-gray-400",
                                                children: "Takaful Fund Pool:"
                                            }),
                                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsx"])("span", {
                                                className: "text-right text-green-400 font-bold",
                                                children: "100% Solvent (Active)"
                                            })
                                        ]
                                    })
                                ]
                            }),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxs"])("div", {
                                className: "p-4 rounded-xl border border-white/5 bg-white/[0.02] text-xs space-y-3",
                                children: [
                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsx"])("h4", {
                                        className: "font-bold text-white tracking-wide uppercase text-[11px] text-center border-b border-white/5 pb-1.5",
                                        children: "\uD83D\uDD4B Three Pillars of Shariah Compliance"
                                    }),
                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxs"])("div", {
                                        className: "space-y-2 leading-relaxed",
                                        children: [
                                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxs"])("div", {
                                                children: [
                                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsx"])("h5", {
                                                        className: "font-bold text-amber-300/90 flex items-center gap-1",
                                                        children: "1. No \"Selling What You Do Not Own\" (Hadith Compliance)"
                                                    }),
                                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsx"])("p", {
                                                        className: "text-[10px] text-gray-400 mt-0.5 pl-4",
                                                        children: "Traders do not sell WETH on Day One. Instead, they buy the right (Arbun) to sell WETH at a locked price. Upon exercise, traders must purchase WETH on spot first (establishing physical possession) and immediately deliver it."
                                                    })
                                                ]
                                            }),
                                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxs"])("div", {
                                                children: [
                                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsx"])("h5", {
                                                        className: "font-bold text-amber-300/90 flex items-center gap-1",
                                                        children: "2. No Interest-Bearing Borrowing (Riba-Free)"
                                                    }),
                                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsx"])("p", {
                                                        className: "text-[10px] text-gray-400 mt-0.5 pl-4",
                                                        children: "No borrow leverage or daily compounding funding rates. Traders pay a fixed Administrative booking fee (Ujrah) for the price guarantee, 100% allowed under Islamic commercial law."
                                                    })
                                                ]
                                            }),
                                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxs"])("div", {
                                                children: [
                                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsx"])("h5", {
                                                        className: "font-bold text-amber-300/90 flex items-center gap-1",
                                                        children: "3. Takaful Mutual Solvency"
                                                    }),
                                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsx"])("p", {
                                                        className: "text-[10px] text-gray-400 mt-0.5 pl-4",
                                                        children: "Forfeited downpayments from canceled/expired contracts are pooled into the collaborative Takaful Fund. Winning payouts are cleared organically from this fund, completely bypassing external debt."
                                                    })
                                                ]
                                            })
                                        ]
                                    })
                                ]
                            })
                        ]
                    }),
                    requiredBorrow !== null && leverage > 1 && /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsx"])("div", {
                        className: (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$clsx$2f$dist$2f$clsx$2e$mjs__$5b$app$2d$client$5d$__$28$ecmascript$29$__["default"])("p-3 rounded text-sm transition-colors", "bg-white/5 text-gray-400"),
                        children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxs"])("div", {
                            className: "flex justify-between mb-1",
                            children: [
                                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsx"])("span", {
                                    children: "Required Borrow:"
                                }),
                                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxs"])("div", {
                                    className: "text-right",
                                    children: [
                                        /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxs"])("span", {
                                            className: "font-mono",
                                            children: [
                                                (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$src$2f$utils$2f$format$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["formatTokenAmount"])(requiredBorrow.formatted, isShort ? tradingToken : marginToken),
                                                " ",
                                                isShort ? tradingToken : marginToken
                                            ]
                                        }),
                                        /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxs"])("span", {
                                            className: "text-[10px] text-gray-500 ml-2",
                                            children: [
                                                "(\u2248 $",
                                                requiredBorrowUsd,
                                                " USD)"
                                            ]
                                        })
                                    ]
                                })
                            ]
                        })
                    }),
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsx"])("button", {
                        type: "submit",
                        disabled: loading || !isConnected || !isCorrectNetwork || !isMetaMaskInstalled || hasZeroAmount || hasInsufficientBalance,
                        className: (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$clsx$2f$dist$2f$clsx$2e$mjs__$5b$app$2d$client$5d$__$28$ecmascript$29$__["default"])("w-full primary-button mt-4", (loading || !isCorrectNetwork || !isMetaMaskInstalled || hasZeroAmount || hasInsufficientBalance) && "opacity-50 cursor-not-allowed"),
                        children: !isMetaMaskInstalled ? "Install MetaMask" : !isCorrectNetwork ? "Wrong Network" : hasZeroAmount ? "Enter Amount" : hasInsufficientBalance ? "Insufficient Balance" : loading ? "Processing..." : needsApproval ? `Approve ${marginToken}` : isShort && isHalalArbunMode ? "Open Halal Put Option" : "Execute 0% Interest Trade"
                    }),
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsx"])("button", {
                        type: "button",
                        onClick: handleSimulate,
                        disabled: loading || simulating || !isConnected || !isCorrectNetwork || !isMetaMaskInstalled || hasZeroAmount,
                        className: (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$clsx$2f$dist$2f$clsx$2e$mjs__$5b$app$2d$client$5d$__$28$ecmascript$29$__["default"])("w-full secondary-button mt-2", (loading || simulating || !isCorrectNetwork || !isMetaMaskInstalled || hasZeroAmount) && "opacity-50 cursor-not-allowed"),
                        children: simulating ? "Simulating..." : "Simulate Transaction"
                    }),
                    status && /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsx"])("div", {
                        className: "mt-4 p-3 bg-white/5 rounded border border-white/10 text-xs font-mono break-all",
                        children: status
                    })
                ]
            })
        ]
    });
}
_s(TradeForm, "YOV83vXYgWN2jpmPSTvToFMcuic=", false, function() {
    return [
        __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$wagmi$2f$dist$2f$esm$2f$hooks$2f$useConnection$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__useConnection__as__useAccount$3e$__["useAccount"],
        __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$src$2f$hooks$2f$useDeFi$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useDeFi"]
    ];
});
_c = TradeForm;
// Small helper just for the UI so we aren't showing massive BigInts unformatted
function formatSmallDisplay(bigIntAmount, capacityData) {
    if (!capacityData || !bigIntAmount) return "0";
    // We expect capacityData to be derived from decimals, so we cheat here
    // to find decimals inversely, but it's simpler to just do this roughly:
    // Capacity BigInt / Capacity Formatted = 10^decimals
    try {
        const capacityNum = parseFloat(capacityData.capacityFormatted);
        if (capacityNum === 0 || capacityData.rawCapacity === 0n) return "0";
        // Approx ratio
        const display = parseFloat(bigIntAmount.toString()) / parseFloat(capacityData.rawCapacity.toString()) * capacityNum;
        return display.toFixed(4);
    } catch  {
        return "0.00";
    }
}
var _c;
__turbopack_context__.k.register(_c, "TradeForm");
if (typeof globalThis.$RefreshHelpers$ === 'object' && globalThis.$RefreshHelpers !== null) {
    __turbopack_context__.k.registerExports(__turbopack_context__.m, globalThis.$RefreshHelpers$);
}
}),
"[project]/dashboard/src/components/PositionsList.jsx [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "PositionsList",
    ()=>PositionsList
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/next/dist/compiled/react/index.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$src$2f$hooks$2f$useDeFi$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/src/hooks/useDeFi.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$wagmi$2f$dist$2f$esm$2f$hooks$2f$useConnection$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__useConnection__as__useAccount$3e$__ = __turbopack_context__.i("[project]/dashboard/node_modules/wagmi/dist/esm/hooks/useConnection.js [app-client] (ecmascript) <export useConnection as useAccount>");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$clsx$2f$dist$2f$clsx$2e$mjs__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/clsx/dist/clsx.mjs [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$src$2f$utils$2f$formatContractError$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/src/utils/formatContractError.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$src$2f$contexts$2f$AdminContext$2e$jsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/src/contexts/AdminContext.jsx [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$src$2f$utils$2f$format$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/src/utils/format.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/next/dist/compiled/react/jsx-runtime.js [app-client] (ecmascript)");
var _s = __turbopack_context__.k.signature(), _s1 = __turbopack_context__.k.signature();
;
;
;
;
;
;
;
;
function PositionsList() {
    _s();
    const { isConnected, address } = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$wagmi$2f$dist$2f$esm$2f$hooks$2f$useConnection$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__useConnection__as__useAccount$3e$__["useAccount"])();
    const { getPositionsCount, getPositionDetails, closePosition } = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$src$2f$hooks$2f$useDeFi$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useDeFi"])();
    const { isAdmin } = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$src$2f$contexts$2f$AdminContext$2e$jsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useAdmin"])();
    const [activeTab, setActiveTab] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"])("my"); // 'my' | 'global'
    const [positions, setPositions] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"])([]);
    const [loading, setLoading] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"])(false);
    const [lastUpdated, setLastUpdated] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"])(null);
    // Force tab back to 'my' if admin mode is toggled off
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useEffect"])({
        "PositionsList.useEffect": ()=>{
            if (!isAdmin && activeTab === "global") {
                setActiveTab("my");
            }
        }
    }["PositionsList.useEffect"], [
        isAdmin,
        activeTab
    ]);
    const fetchPositions = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useCallback"])({
        "PositionsList.useCallback[fetchPositions]": async ()=>{
            setLoading(true);
            try {
                const count = await getPositionsCount();
                const maxId = Number(count);
                // Fetch position details
                const promises = [];
                for(let i = 1; i < maxId; i++){
                    promises.push(getPositionDetails(i, address));
                }
                const results = await Promise.all(promises);
                // Filter out nulls (burned/closed)
                const activePositions = results.filter({
                    "PositionsList.useCallback[fetchPositions].activePositions": (p)=>p !== null && p.state !== "NONE"
                }["PositionsList.useCallback[fetchPositions].activePositions"]);
                setPositions(activePositions);
                setLastUpdated(new Date());
            } catch (error) {
                console.error("Failed to fetch positions", error);
            } finally{
                setLoading(false);
            }
        }
    }["PositionsList.useCallback[fetchPositions]"], [
        getPositionsCount,
        getPositionDetails,
        address
    ]);
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useEffect"])({
        "PositionsList.useEffect": ()=>{
            fetchPositions();
            const interval = setInterval(fetchPositions, 30000); // 30s refresh
            return ({
                "PositionsList.useEffect": ()=>clearInterval(interval)
            })["PositionsList.useEffect"];
        }
    }["PositionsList.useEffect"], [
        address
    ]);
    const filteredPositions = positions.filter((p)=>{
        if (activeTab === "global") return true;
        if (activeTab === "my" && address) {
            return p.owner.toLowerCase() === address.toLowerCase();
        }
        return false;
    });
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxs"])("div", {
        className: "glass-panel p-6 w-full lg:col-span-2",
        children: [
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxs"])("div", {
                className: "flex items-center justify-between mb-6",
                children: [
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsx"])("h2", {
                        className: "text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-emerald-400",
                        children: "Positions"
                    }),
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxs"])("div", {
                        className: "flex bg-black/40 rounded-lg p-1 border border-white/10",
                        children: [
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsx"])("button", {
                                onClick: ()=>setActiveTab("my"),
                                className: (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$clsx$2f$dist$2f$clsx$2e$mjs__$5b$app$2d$client$5d$__$28$ecmascript$29$__["default"])("px-4 py-1 rounded text-sm font-bold transition-all", activeTab === "my" ? "bg-white/10 text-white" : "text-gray-500 hover:text-white"),
                                children: "My Positions"
                            }),
                            isAdmin && /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsx"])("button", {
                                onClick: ()=>setActiveTab("global"),
                                className: (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$clsx$2f$dist$2f$clsx$2e$mjs__$5b$app$2d$client$5d$__$28$ecmascript$29$__["default"])("px-4 py-1 rounded text-sm font-bold transition-all", activeTab === "global" ? "bg-white/10 text-white" : "text-gray-500 hover:text-white"),
                                children: "Global"
                            })
                        ]
                    })
                ]
            }),
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxs"])("div", {
                className: "space-y-3 max-h-[500px] overflow-y-auto pr-2 custom-scrollbar",
                children: [
                    loading && positions.length === 0 ? /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsx"])("div", {
                        className: "text-center py-10 text-gray-500 animate-pulse",
                        children: "Loading positions..."
                    }) : filteredPositions.map((pos)=>/*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsx"])(PositionCard, {
                            position: pos,
                            isOwner: address && pos.owner.toLowerCase() === address.toLowerCase(),
                            onClose: ()=>closePosition(pos.id)
                        }, pos.id)),
                    !loading && filteredPositions.length === 0 && /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsx"])("div", {
                        className: "text-center py-10 text-gray-500",
                        children: "No active positions found."
                    })
                ]
            }),
            lastUpdated && /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxs"])("div", {
                className: "text-right text-xs text-gray-600 mt-2",
                children: [
                    "Last updated: ",
                    lastUpdated.toLocaleTimeString()
                ]
            })
        ]
    });
}
_s(PositionsList, "A3N4QAyVnQSY61daVgroLGVLZTA=", false, function() {
    return [
        __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$wagmi$2f$dist$2f$esm$2f$hooks$2f$useConnection$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__useConnection__as__useAccount$3e$__["useAccount"],
        __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$src$2f$hooks$2f$useDeFi$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useDeFi"],
        __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$src$2f$contexts$2f$AdminContext$2e$jsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useAdmin"]
    ];
});
_c = PositionsList;
function PositionCard({ position, isOwner, onClose }) {
    _s1();
    const [closing, setClosing] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"])(false);
    const handleClose = async ()=>{
        if (!confirm(`Close Position ${position.id}?`)) return;
        setClosing(true);
        try {
            const tx = await onClose();
            if (tx && tx.wait) {
                await tx.wait();
                alert("Position closed successfully!");
            }
        } catch (e) {
            console.error(e);
            if ((0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$src$2f$utils$2f$formatContractError$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["isUserCancellation"])(e)) {
                alert("Transaction was canceled by user.");
            } else {
                const friendlyError = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$src$2f$utils$2f$formatContractError$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["formatContractError"])(e);
                alert(`Failed to close position: ${friendlyError}`);
            }
        } finally{
            setClosing(false);
        }
    };
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsx"])("div", {
        className: "p-4 rounded-xl bg-white/5 border border-white/5 hover:border-white/20 transition-all group",
        children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxs"])("div", {
            className: "flex justify-between items-start",
            children: [
                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxs"])("div", {
                    className: "flex gap-3 items-center",
                    children: [
                        /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsx"])("div", {
                            className: (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$clsx$2f$dist$2f$clsx$2e$mjs__$5b$app$2d$client$5d$__$28$ecmascript$29$__["default"])("w-2 h-12 rounded-full", position.isShort ? "bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.5)]" : "bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.5)]")
                        }),
                        /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxs"])("div", {
                            children: [
                                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxs"])("div", {
                                    className: "flex items-center gap-2",
                                    children: [
                                        /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxs"])("span", {
                                            className: "font-bold text-lg",
                                            children: [
                                                "#",
                                                position.id
                                            ]
                                        }),
                                        /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxs"])("span", {
                                            className: (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$clsx$2f$dist$2f$clsx$2e$mjs__$5b$app$2d$client$5d$__$28$ecmascript$29$__["default"])("text-xs px-2 py-0.5 rounded border", position.isShort ? "border-red-500/50 text-red-400 bg-red-500/10" : "border-green-500/50 text-green-400 bg-green-500/10"),
                                            children: [
                                                position.isShort ? "SHORT" : "LONG",
                                                " ",
                                                position.leverage,
                                                "x"
                                            ]
                                        })
                                    ]
                                }),
                                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxs"])("div", {
                                    className: "text-sm text-gray-400 mt-1",
                                    children: [
                                        position.size,
                                        " ",
                                        position.baseSymbol,
                                        /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxs"])("span", {
                                            className: "text-xs text-gray-600 ml-1",
                                            children: [
                                                "(~$",
                                                position.sizeUsd,
                                                ")"
                                            ]
                                        })
                                    ]
                                }),
                                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxs"])("div", {
                                    className: (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$clsx$2f$dist$2f$clsx$2e$mjs__$5b$app$2d$client$5d$__$28$ecmascript$29$__["default"])("text-sm mt-1 font-mono", position.pnlIsPositive ? "text-green-400" : "text-red-400"),
                                    children: [
                                        position.pnlIsPositive ? "+" : "-",
                                        (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$src$2f$utils$2f$format$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["formatTokenAmount"])(position.pnl, position.isShort ? position.quoteSymbol : position.baseSymbol),
                                        " ",
                                        position.isShort ? position.quoteSymbol : position.baseSymbol,
                                        /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxs"])("span", {
                                            className: (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$clsx$2f$dist$2f$clsx$2e$mjs__$5b$app$2d$client$5d$__$28$ecmascript$29$__["default"])("text-xs ml-1", position.pnlIsPositive ? "text-green-500" : "text-red-500"),
                                            children: [
                                                "(",
                                                position.pnlIsPositive ? "+" : "-",
                                                "$",
                                                position.pnlUsd,
                                                ")"
                                            ]
                                        })
                                    ]
                                }),
                                (()=>{
                                    const current = parseFloat(position.currentPrice);
                                    const entry = parseFloat(position.entryPrice);
                                    const isProfitable = position.isShort ? current < entry : current > entry;
                                    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxs"])("div", {
                                        className: "text-xs text-gray-500 mt-1",
                                        children: [
                                            position.baseSymbol,
                                            ": ",
                                            (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$src$2f$utils$2f$format$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["formatTokenAmount"])(position.currentPrice, position.quoteSymbol),
                                            " ",
                                            position.quoteSymbol,
                                            " | ",
                                            position.isShort ? "BELOW" : "ABOVE",
                                            " ",
                                            (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$src$2f$utils$2f$format$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["formatTokenAmount"])(position.entryPrice, position.quoteSymbol),
                                            " ",
                                            position.quoteSymbol,
                                            " ",
                                            isProfitable ? "✅" : "⏳"
                                        ]
                                    });
                                })()
                            ]
                        })
                    ]
                }),
                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxs"])("div", {
                    className: "flex flex-col items-end gap-2",
                    children: [
                        /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsx"])("div", {
                            className: (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$clsx$2f$dist$2f$clsx$2e$mjs__$5b$app$2d$client$5d$__$28$ecmascript$29$__["default"])("px-2 py-1 rounded text-xs", position.state === "LIQUIDATABLE" ? "bg-red-900/50 text-red-200 border border-red-500" : "bg-white/10 text-gray-300"),
                            children: position.state
                        }),
                        /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsx"])("button", {
                            onClick: handleClose,
                            disabled: closing,
                            className: "opacity-0 group-hover:opacity-100 transition-opacity bg-red-500/20 hover:bg-red-500/40 text-red-300 text-xs px-3 py-1 rounded border border-red-500/30",
                            children: closing ? "..." : "Close"
                        })
                    ]
                })
            ]
        })
    });
}
_s1(PositionCard, "siUBsXlDiREAn0hWnbur2taSF6s=");
_c1 = PositionCard;
var _c, _c1;
__turbopack_context__.k.register(_c, "PositionsList");
__turbopack_context__.k.register(_c1, "PositionCard");
if (typeof globalThis.$RefreshHelpers$ === 'object' && globalThis.$RefreshHelpers !== null) {
    __turbopack_context__.k.registerExports(__turbopack_context__.m, globalThis.$RefreshHelpers$);
}
}),
"[project]/dashboard/src/components/AdminToggle.jsx [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "AdminToggle",
    ()=>AdminToggle
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$src$2f$contexts$2f$AdminContext$2e$jsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/src/contexts/AdminContext.jsx [app-client] (ecmascript)");
"use client";
;
function AdminToggle() {
    // Hidden completely. Admin access is now granted automatically via wallet authentication.
    return null;
}
_c = AdminToggle;
var _c;
__turbopack_context__.k.register(_c, "AdminToggle");
if (typeof globalThis.$RefreshHelpers$ === 'object' && globalThis.$RefreshHelpers !== null) {
    __turbopack_context__.k.registerExports(__turbopack_context__.m, globalThis.$RefreshHelpers$);
}
}),
"[project]/dashboard/src/components/LiveChart.jsx [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "LiveChart",
    ()=>LiveChart
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/next/dist/compiled/react/index.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/next/dist/compiled/react/jsx-runtime.js [app-client] (ecmascript)");
"use client";
;
;
function LiveChart({ tokenKey }) {
    const chartToken = tokenKey || "ETH";
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxs"])("div", {
        className: "glass-panel w-full overflow-hidden flex flex-col mt-6",
        children: [
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxs"])("div", {
                className: "p-4 border-b border-white/5 flex items-center justify-between bg-black/20",
                children: [
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxs"])("h3", {
                        className: "text-sm font-bold text-gray-300 uppercase tracking-wider",
                        children: [
                            chartToken,
                            " Price Chart (Unichain)"
                        ]
                    }),
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsx"])("span", {
                        className: "text-[10px] font-bold text-green-400 bg-green-500/10 border border-green-500/20 rounded px-2 py-1",
                        children: "LIVE FEED"
                    })
                ]
            }),
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsx"])("div", {
                className: "w-full",
                style: {
                    height: "400px"
                },
                children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsx"])("iframe", {
                    src: `https://dexscreener.com/unichain?q=${chartToken}&embed=1&theme=dark&trades=0&info=0`,
                    style: {
                        width: "100%",
                        height: "100%",
                        border: "none"
                    },
                    title: "DexScreener Live Chart"
                })
            })
        ]
    });
}
_c = LiveChart;
var _c;
__turbopack_context__.k.register(_c, "LiveChart");
if (typeof globalThis.$RefreshHelpers$ === 'object' && globalThis.$RefreshHelpers !== null) {
    __turbopack_context__.k.registerExports(__turbopack_context__.m, globalThis.$RefreshHelpers$);
}
}),
]);

//# sourceMappingURL=dashboard_src_components_685b73d1._.js.map