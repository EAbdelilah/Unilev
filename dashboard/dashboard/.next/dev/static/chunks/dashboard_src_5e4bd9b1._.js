(globalThis.TURBOPACK || (globalThis.TURBOPACK = [])).push([typeof document === "object" ? document.currentScript : undefined,
"[project]/dashboard/src/config/supported_tokens.json (json)", ((__turbopack_context__) => {

__turbopack_context__.v({"137":{"WBTC":"0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6","WETH":"0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619","USDC":"0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359","DAI":"0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063","WPOL":"0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270","wrapper":"0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270"},"130":{"WBTC":"0x927B51f251480a681271180DA4de28D44EC4AfB8","WETH":"0x4200000000000000000000000000000000000006","USDC":"0x078D782b760474a361dDA0AF3839290b0EF57AD6"},"1301":{"WBTC":"0x0555e30da8f98308edb960aa94c0db47230d2b9c","WETH":"0x4200000000000000000000000000000000000006","USDC":"0x31d0220469e10c4e71834a79b1f276d740d3768f"}});}),
"[project]/dashboard/src/hooks/useReadProvider.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "useReadProvider",
    ()=>useReadProvider
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$build$2f$polyfills$2f$process$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = /*#__PURE__*/ __turbopack_context__.i("[project]/dashboard/node_modules/next/dist/build/polyfills/process.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/next/dist/compiled/react/index.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$ethers$2f$lib$2e$esm$2f$ethers$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__ethers$3e$__ = __turbopack_context__.i("[project]/dashboard/node_modules/ethers/lib.esm/ethers.js [app-client] (ecmascript) <export * as ethers>");
var _s = __turbopack_context__.k.signature();
;
;
function useReadProvider() {
    _s();
    return (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useMemo"])({
        "useReadProvider.useMemo": ()=>{
            const rpcUrl = ("TURBOPACK compile-time value", "https://unichain-mainnet.g.alchemy.com/v2/MShMmpJbY-27CEbyan4Ac") || ("TURBOPACK compile-time value", "https://polygon-mainnet.g.alchemy.com/v2/MShMmpJbY-27CEbyan4Ac");
            if ("TURBOPACK compile-time falsy", 0) //TURBOPACK unreachable
            ;
            return new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$ethers$2f$lib$2e$esm$2f$ethers$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__ethers$3e$__["ethers"].JsonRpcProvider(rpcUrl);
        }
    }["useReadProvider.useMemo"], []);
}
_s(useReadProvider, "nwk+m61qLgjDVUp4IGV/072DDN4=");
if (typeof globalThis.$RefreshHelpers$ === 'object' && globalThis.$RefreshHelpers !== null) {
    __turbopack_context__.k.registerExports(__turbopack_context__.m, globalThis.$RefreshHelpers$);
}
}),
"[project]/dashboard/src/hooks/useV4Position.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "useV4Position",
    ()=>useV4Position
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$build$2f$polyfills$2f$process$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = /*#__PURE__*/ __turbopack_context__.i("[project]/dashboard/node_modules/next/dist/build/polyfills/process.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/next/dist/compiled/react/index.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$ethers$2f$lib$2e$esm$2f$ethers$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__ethers$3e$__ = __turbopack_context__.i("[project]/dashboard/node_modules/ethers/lib.esm/ethers.js [app-client] (ecmascript) <export * as ethers>");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$wagmi$2f$dist$2f$esm$2f$hooks$2f$useConnection$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__useConnection__as__useAccount$3e$__ = __turbopack_context__.i("[project]/dashboard/node_modules/wagmi/dist/esm/hooks/useConnection.js [app-client] (ecmascript) <export useConnection as useAccount>");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$wagmi$2f$dist$2f$esm$2f$hooks$2f$useWalletClient$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/wagmi/dist/esm/hooks/useWalletClient.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$src$2f$abis$2f$EswapRouter$2e$json__$28$json$29$__ = __turbopack_context__.i("[project]/dashboard/src/abis/EswapRouter.json (json)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$src$2f$abis$2f$EswapMarginHook$2e$json__$28$json$29$__ = __turbopack_context__.i("[project]/dashboard/src/abis/EswapMarginHook.json (json)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$src$2f$abis$2f$PriceFeed$2e$json__$28$json$29$__ = __turbopack_context__.i("[project]/dashboard/src/abis/PriceFeed.json (json)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$src$2f$config$2f$supported_tokens$2e$json__$28$json$29$__ = __turbopack_context__.i("[project]/dashboard/src/config/supported_tokens.json (json)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$src$2f$hooks$2f$useReadProvider$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/src/hooks/useReadProvider.js [app-client] (ecmascript)");
var _s = __turbopack_context__.k.signature();
;
;
;
;
;
;
;
;
const FALLBACK_CHAIN = "1301";
const POOL_FEE = 3000;
const STANDARD_POOL_FEE = 500; // 0.05% — deepest standard (no-hook) pool for the pair on Unichain
const TICK_SPACING = 60;
function sortCurrencies(c0, c1) {
    return c0.toLowerCase() < c1.toLowerCase() ? [
        c0,
        c1
    ] : [
        c1,
        c0
    ];
}
const TOKEN_DECIMALS = {
    WBTC: 8,
    WETH: 18,
    USDC: 6
};
function poolIdFor(base, quote, hookAddress) {
    const [c0, c1] = sortCurrencies(base, quote);
    return __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$ethers$2f$lib$2e$esm$2f$ethers$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__ethers$3e$__["ethers"].keccak256(__TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$ethers$2f$lib$2e$esm$2f$ethers$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__ethers$3e$__["ethers"].AbiCoder.defaultAbiCoder().encode([
        "address",
        "address",
        "uint24",
        "int24",
        "address"
    ], [
        c0,
        c1,
        POOL_FEE,
        TICK_SPACING,
        hookAddress
    ]));
}
function useV4Position() {
    _s();
    const { address, chainId } = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$wagmi$2f$dist$2f$esm$2f$hooks$2f$useConnection$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__useConnection__as__useAccount$3e$__["useAccount"])();
    const { data: walletClient } = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$wagmi$2f$dist$2f$esm$2f$hooks$2f$useWalletClient$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useWalletClient"])();
    const readProvider = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$src$2f$hooks$2f$useReadProvider$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useReadProvider"])();
    const chainKey = String(chainId || FALLBACK_CHAIN);
    const tokens = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useMemo"])({
        "useV4Position.useMemo[tokens]": ()=>__TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$src$2f$config$2f$supported_tokens$2e$json__$28$json$29$__["default"][chainKey] || __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$src$2f$config$2f$supported_tokens$2e$json__$28$json$29$__["default"][FALLBACK_CHAIN] || {}
    }["useV4Position.useMemo[tokens]"], [
        chainKey
    ]);
    const WETH_ADDR = tokens.WETH || "0x4200000000000000000000000000000000000006";
    const USDC_ADDR = tokens.USDC || "0x078D782b760474a361dDA0AF3839290b0EF57AD6";
    const WBTC_ADDR = tokens.WBTC || "0x927B51f251480a681271180DA4de28D44EC4AfB8";
    const ADDRESSES = {
        V4_ROUTER: ("TURBOPACK compile-time value", "0x1ED2F145C44F2E28174c7799773Bc27eC9147661") || "",
        V4_HOOK: ("TURBOPACK compile-time value", "0xF710C66b9351348D9421F95C0103042F80A050C8") || "",
        V4_SOLVER: ("TURBOPACK compile-time value", "0x518634753C61342298c3E04326056b3Ce596a566") || "",
        V4_PRICEFEED: ("TURBOPACK compile-time value", "0xD2e8b474d6faB4d879Fe4621192B018B35B79488") || ("TURBOPACK compile-time value", "0x015c3722683b54fff1491a92bfd9c72ca3c84cc4") || ""
    };
    // Authorized hook pools (base token quoted in USDC). Each pool is keyed by the
    // "trading asset": WETH → USDC/WETH pool, WBTC → WBTC/USDC pool.
    const V4_POOLS = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useMemo"])({
        "useV4Position.useMemo[V4_POOLS]": ()=>{
            const pools = [];
            if ("TURBOPACK compile-time truthy", 1) pools.push({
                key: "WETH",
                base: WETH_ADDR,
                quote: USDC_ADDR
            });
            if ("TURBOPACK compile-time truthy", 1) pools.push({
                key: "WBTC",
                base: WBTC_ADDR,
                quote: USDC_ADDR
            });
            return pools;
        }
    }["useV4Position.useMemo[V4_POOLS]"], [
        WETH_ADDR,
        WBTC_ADDR,
        USDC_ADDR
    ]);
    const SUPPORTED_TOKENS_LIST = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useMemo"])({
        "useV4Position.useMemo[SUPPORTED_TOKENS_LIST]": ()=>V4_POOLS.map({
                "useV4Position.useMemo[SUPPORTED_TOKENS_LIST]": (p)=>({
                        key: p.key,
                        name: p.key,
                        address: p.base
                    })
            }["useV4Position.useMemo[SUPPORTED_TOKENS_LIST]"])
    }["useV4Position.useMemo[SUPPORTED_TOKENS_LIST]"], [
        V4_POOLS
    ]);
    function poolFor(key) {
        return V4_POOLS.find((p)=>p.key === key) || V4_POOLS[0] || null;
    }
    // Hook-enabled pool where leverage accounting (flash borrow + position
    // registration) and the physical swap both happen. Currencies are sorted
    // by address so the key matches the deployed/authorized pool exactly.
    function buildPoolKeyFor({ base, quote }, hookAddress) {
        const [currency0, currency1] = sortCurrencies(base, quote);
        return {
            currency0,
            currency1,
            fee: POOL_FEE,
            tickSpacing: TICK_SPACING,
            hooks: hookAddress
        };
    }
    // Standard (physical execution) pool: same currency ordering as the hook pool,
    // $0 fee tier is not used on-chain — 0.05% standard pool for the pair, no hook.
    function buildStandardPoolKeyFor({ base, quote }) {
        const [currency0, currency1] = sortCurrencies(base, quote);
        return {
            currency0,
            currency1,
            fee: STANDARD_POOL_FEE,
            tickSpacing: TICK_SPACING,
            hooks: __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$ethers$2f$lib$2e$esm$2f$ethers$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__ethers$3e$__["ethers"].ZeroAddress
        };
    }
    const getSigner = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useCallback"])({
        "useV4Position.useCallback[getSigner]": async ()=>{
            if (!walletClient || ("TURBOPACK compile-time value", "object") === "undefined" || !window.ethereum) return null;
            return await new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$ethers$2f$lib$2e$esm$2f$ethers$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__ethers$3e$__["ethers"].BrowserProvider(window.ethereum).getSigner();
        }
    }["useV4Position.useCallback[getSigner]"], [
        walletClient
    ]);
    // Builds router.swap() params for `tradingKey` (WETH or WBTC). Each pool's
    // base currency is the "trading asset" (set via hook.setBaseCurrency), so:
    //   LONG  → sell quote (USDC), buy base   → zeroForOne = baseIsCurrency0 ? false : true
    //   SHORT → sell base, buy quote          → zeroForOne = baseIsCurrency0 ? true  : false
    // The solver settles the borrowed leg (required for leverage > 1).
    const buildSwapParams = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useCallback"])({
        "useV4Position.useCallback[buildSwapParams]": (isShort, tradingKey, amount, leverage, hookAddress)=>{
            const pool = poolFor(tradingKey);
            const key = buildPoolKeyFor(pool, hookAddress);
            const baseIsCurrency0 = pool.base.toLowerCase() === key.currency0.toLowerCase();
            const zeroForOne = isShort ? baseIsCurrency0 : !baseIsCurrency0;
            const solver = ADDRESSES.V4_SOLVER || address;
            const hookData = __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$ethers$2f$lib$2e$esm$2f$ethers$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__ethers$3e$__["ethers"].AbiCoder.defaultAbiCoder().encode([
                "bool",
                "uint8",
                "address"
            ], [
                true,
                leverage,
                address
            ]);
            return {
                key,
                standardPoolKey: buildStandardPoolKeyFor(pool),
                zeroForOne,
                amountSpecified: -amount,
                leverage,
                solver,
                hookData
            };
        }
    }["useV4Position.useCallback[buildSwapParams]"], [
        V4_POOLS,
        address,
        ADDRESSES.V4_SOLVER
    ]);
    const openV4Position = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useCallback"])({
        "useV4Position.useCallback[openV4Position]": async (isShort, amount, leverage, tradingKey = "WETH")=>{
            if (!ADDRESSES.V4_ROUTER) throw new Error("V4 Router address not configured");
            const signer = await getSigner();
            if (!signer) throw new Error("Wallet not connected");
            const router = new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$ethers$2f$lib$2e$esm$2f$ethers$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__ethers$3e$__["ethers"].Contract(ADDRESSES.V4_ROUTER, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$src$2f$abis$2f$EswapRouter$2e$json__$28$json$29$__["default"].abi, signer);
            const params = buildSwapParams(isShort, tradingKey, amount, leverage, ADDRESSES.V4_HOOK);
            return await router.swap(params);
        }
    }["useV4Position.useCallback[openV4Position]"], [
        getSigner,
        buildSwapParams,
        ADDRESSES.V4_ROUTER,
        ADDRESSES.V4_HOOK
    ]);
    const simulateV4Position = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useCallback"])({
        "useV4Position.useCallback[simulateV4Position]": async (isShort, amount, leverage, tradingKey = "WETH")=>{
            const signer = await getSigner();
            if (!signer) throw new Error("Wallet not connected");
            const router = new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$ethers$2f$lib$2e$esm$2f$ethers$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__ethers$3e$__["ethers"].Contract(ADDRESSES.V4_ROUTER, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$src$2f$abis$2f$EswapRouter$2e$json__$28$json$29$__["default"].abi, signer);
            const params = buildSwapParams(isShort, tradingKey, amount, leverage, ADDRESSES.V4_HOOK);
            try {
                await router.swap.staticCall(params);
                return {
                    success: true
                };
            } catch (e) {
                return {
                    success: false,
                    error: e
                };
            }
        }
    }["useV4Position.useCallback[simulateV4Position]"], [
        getSigner,
        buildSwapParams,
        ADDRESSES.V4_ROUTER,
        ADDRESSES.V4_HOOK
    ]);
    const getAmountInUsd = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useCallback"])({
        "useV4Position.useCallback[getAmountInUsd]": async (token, amount)=>{
            if (!readProvider || !ADDRESSES.V4_PRICEFEED) return 0n;
            const feed = new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$ethers$2f$lib$2e$esm$2f$ethers$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__ethers$3e$__["ethers"].Contract(ADDRESSES.V4_PRICEFEED, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$src$2f$abis$2f$PriceFeed$2e$json__$28$json$29$__["default"].abi, readProvider);
            try {
                return await feed.getAmountInUsd(token, amount);
            } catch  {
                return 0n;
            }
        }
    }["useV4Position.useCallback[getAmountInUsd]"], [
        readProvider,
        ADDRESSES.V4_PRICEFEED
    ]);
    // Human "USDC per base" price for display, straight from the Chainlink oracle
    // (18-decimal USD price per token) — works for every pool regardless of
    // currency ordering/decimals.
    async function computeUsdPerBase(hook, pool) {
        try {
            const twap = await hook.priceFeed().then(async (feedAddr)=>{
                const feed = new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$ethers$2f$lib$2e$esm$2f$ethers$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__ethers$3e$__["ethers"].Contract(feedAddr, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$src$2f$abis$2f$PriceFeed$2e$json__$28$json$29$__["default"].abi, readProvider);
                return feed.getTwapPrice(pool.base);
            });
            if (!twap || twap === 0n) return "0";
            return __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$ethers$2f$lib$2e$esm$2f$ethers$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__ethers$3e$__["ethers"].formatUnits(twap, 18);
        } catch  {
            return "0";
        }
    }
    const getPositionsCount = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useCallback"])({
        "useV4Position.useCallback[getPositionsCount]": async (poolKey)=>{
            if (!readProvider || !ADDRESSES.V4_HOOK || !address) return 0n;
            const hook = new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$ethers$2f$lib$2e$esm$2f$ethers$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__ethers$3e$__["ethers"].Contract(ADDRESSES.V4_HOOK, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$src$2f$abis$2f$EswapMarginHook$2e$json__$28$json$29$__["default"].abi, readProvider);
            const countPool = {
                "useV4Position.useCallback[getPositionsCount].countPool": async (pool)=>{
                    try {
                        const poolId = poolIdFor(pool.base, pool.quote, ADDRESSES.V4_HOOK);
                        const pos = await hook.positions(poolId, address);
                        return pos.collateralAmount > 0n ? 1n : 0n;
                    } catch  {
                        return 0n;
                    }
                }
            }["useV4Position.useCallback[getPositionsCount].countPool"];
            if (poolKey) {
                const pool = poolFor(poolKey);
                return pool ? countPool(pool) : 0n;
            }
            let total = 0n;
            for (const pool of V4_POOLS)total += await countPool(pool);
            return total;
        }
    }["useV4Position.useCallback[getPositionsCount]"], [
        readProvider,
        address,
        V4_POOLS,
        ADDRESSES.V4_HOOK
    ]);
    const getPositionDetails = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useCallback"])({
        "useV4Position.useCallback[getPositionDetails]": async (id, userAddress, poolKey)=>{
            const trader = userAddress || address;
            if (!readProvider || !ADDRESSES.V4_HOOK || !trader) return null;
            const hook = new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$ethers$2f$lib$2e$esm$2f$ethers$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__ethers$3e$__["ethers"].Contract(ADDRESSES.V4_HOOK, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$src$2f$abis$2f$EswapMarginHook$2e$json__$28$json$29$__["default"].abi, readProvider);
            const readPool = {
                "useV4Position.useCallback[getPositionDetails].readPool": async (pool)=>{
                    try {
                        const poolId = poolIdFor(pool.base, pool.quote, ADDRESSES.V4_HOOK);
                        const pos = await hook.positions(poolId, trader);
                        if (pos.collateralAmount === 0n) return null;
                        // isLong is anchored to the pool's base currency, so a LONG
                        // holds base collateral (WETH/WBTC) and a SHORT holds quote (USDC).
                        const collateralKey = pos.isLong ? pool.key : "USDC";
                        const collateralDecimals = TOKEN_DECIMALS[collateralKey] ?? 18;
                        const currentPrice = await computeUsdPerBase(hook, pool);
                        return {
                            id: `V4-${pool.key}-${trader.slice(2, 6)}`,
                            owner: pos.trader,
                            collateral: pos.collateralAmount,
                            borrowed: pos.borrowedAmount,
                            leverage: pos.leverage.toString(),
                            isShort: !pos.isLong,
                            state: "ACTIVE",
                            size: __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$ethers$2f$lib$2e$esm$2f$ethers$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__ethers$3e$__["ethers"].formatUnits(pos.collateralAmount, collateralDecimals),
                            sizeUsd: "0.00",
                            pnl: "0",
                            pnlUsd: "0.00",
                            pnlIsPositive: true,
                            entryPrice: currentPrice,
                            currentPrice,
                            baseSymbol: pool.key,
                            quoteSymbol: "USDC"
                        };
                    } catch  {
                        return null;
                    }
                }
            }["useV4Position.useCallback[getPositionDetails].readPool"];
            if (poolKey) {
                const pool = poolFor(poolKey);
                return pool ? readPool(pool) : null;
            }
            for (const pool of V4_POOLS){
                const result = await readPool(pool);
                if (result) return result;
            }
            return null;
        }
    }["useV4Position.useCallback[getPositionDetails]"], [
        readProvider,
        address,
        V4_POOLS,
        ADDRESSES.V4_HOOK
    ]);
    const closePosition = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useCallback"])({
        "useV4Position.useCallback[closePosition]": async (id)=>{
            if (!id || !id.startsWith("V4-")) return null;
            const parts = id.split("-");
            const poolKey = parts.length >= 3 ? parts[1] : "WETH";
            const pool = poolFor(poolKey);
            if (!pool) return null;
            const signer = await getSigner();
            if (!signer) throw new Error("Wallet not connected");
            if (!ADDRESSES.V4_ROUTER) throw new Error("V4 Router address not configured");
            const router = new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$ethers$2f$lib$2e$esm$2f$ethers$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__ethers$3e$__["ethers"].Contract(ADDRESSES.V4_ROUTER, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$src$2f$abis$2f$EswapRouter$2e$json__$28$json$29$__["default"].abi, signer);
            return await router.closePosition(ADDRESSES.V4_HOOK, buildPoolKeyFor(pool, ADDRESSES.V4_HOOK), address, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$ethers$2f$lib$2e$esm$2f$ethers$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__ethers$3e$__["ethers"].ZeroAddress, 0);
        }
    }["useV4Position.useCallback[closePosition]"], [
        getSigner,
        address,
        V4_POOLS,
        ADDRESSES.V4_ROUTER,
        ADDRESSES.V4_HOOK
    ]);
    return {
        openV4Position,
        simulateV4Position,
        getAmountInUsd,
        getPositionsCount,
        getPositionDetails,
        closePosition,
        ADDRESSES,
        tokens,
        WETH_ADDR,
        USDC_ADDR,
        V4_POOLS,
        SUPPORTED_TOKENS_LIST
    };
}
_s(useV4Position, "yJ25CflVZh3TR+8Wj9oYInJjFiM=", false, function() {
    return [
        __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$wagmi$2f$dist$2f$esm$2f$hooks$2f$useConnection$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__useConnection__as__useAccount$3e$__["useAccount"],
        __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$wagmi$2f$dist$2f$esm$2f$hooks$2f$useWalletClient$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useWalletClient"],
        __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$src$2f$hooks$2f$useReadProvider$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useReadProvider"]
    ];
});
if (typeof globalThis.$RefreshHelpers$ === 'object' && globalThis.$RefreshHelpers !== null) {
    __turbopack_context__.k.registerExports(__turbopack_context__.m, globalThis.$RefreshHelpers$);
}
}),
"[project]/dashboard/src/hooks/useDeFi.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "POLYGON_TOKENS_LIST",
    ()=>POLYGON_TOKENS_LIST,
    "useDeFi",
    ()=>useDeFi
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$build$2f$polyfills$2f$process$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = /*#__PURE__*/ __turbopack_context__.i("[project]/dashboard/node_modules/next/dist/build/polyfills/process.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/next/dist/compiled/react/index.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$ethers$2f$lib$2e$esm$2f$ethers$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__ethers$3e$__ = __turbopack_context__.i("[project]/dashboard/node_modules/ethers/lib.esm/ethers.js [app-client] (ecmascript) <export * as ethers>");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$wagmi$2f$dist$2f$esm$2f$hooks$2f$useConnection$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__useConnection__as__useAccount$3e$__ = __turbopack_context__.i("[project]/dashboard/node_modules/wagmi/dist/esm/hooks/useConnection.js [app-client] (ecmascript) <export useConnection as useAccount>");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$wagmi$2f$dist$2f$esm$2f$hooks$2f$useWalletClient$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/wagmi/dist/esm/hooks/useWalletClient.js [app-client] (ecmascript)");
// Import ABIs
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$src$2f$abis$2f$ERC20$2e$json__$28$json$29$__ = __turbopack_context__.i("[project]/dashboard/src/abis/ERC20.json (json)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$src$2f$abis$2f$Market$2e$json__$28$json$29$__ = __turbopack_context__.i("[project]/dashboard/src/abis/Market.json (json)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$src$2f$abis$2f$Positions$2e$json__$28$json$29$__ = __turbopack_context__.i("[project]/dashboard/src/abis/Positions.json (json)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$src$2f$abis$2f$PriceFeedL1$2e$json__$28$json$29$__ = __turbopack_context__.i("[project]/dashboard/src/abis/PriceFeedL1.json (json)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$src$2f$abis$2f$LiquidityPool$2e$json__$28$json$29$__ = __turbopack_context__.i("[project]/dashboard/src/abis/LiquidityPool.json (json)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$src$2f$abis$2f$FeeManager$2e$json__$28$json$29$__ = __turbopack_context__.i("[project]/dashboard/src/abis/FeeManager.json (json)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$src$2f$config$2f$supported_tokens$2e$json__$28$json$29$__ = __turbopack_context__.i("[project]/dashboard/src/config/supported_tokens.json (json)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$src$2f$hooks$2f$useV4Position$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/src/hooks/useV4Position.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$src$2f$utils$2f$chains$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/src/utils/chains.js [app-client] (ecmascript)");
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
;
;
;
;
// Polygon (V3) token list — used by V3-only protocol views (pools/admin) and
// the module-level default. The runtime SUPPORTED_TOKENS_LIST (returned by the
// hook) is chain-aware and picks the network's token set.
const polygonTokens = __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$src$2f$config$2f$supported_tokens$2e$json__$28$json$29$__["default"]["137"] || {};
const POLYGON_TOKENS_LIST = Object.entries(polygonTokens).filter(([key])=>key !== "wrapper").map(_c = ([key, address])=>({
        key,
        name: key,
        address
    }));
_c1 = POLYGON_TOKENS_LIST;
// Static contract addresses from environment (network-independent registry).
const ENV_ADDRESSES = {
    PRICEFEEDL1: ("TURBOPACK compile-time value", "0x015c3722683b54fff1491a92bfd9c72ca3c84cc4"),
    POSITIONS: ("TURBOPACK compile-time value", "0x5b226ae5158de86f1e616875dbab886870b9aad9"),
    MARKET: ("TURBOPACK compile-time value", "0x907cda8c588c9c859a6fb4f105593a64599741cb"),
    POOL_FACTORY: ("TURBOPACK compile-time value", "0x7afef9fe18e08cad3e1c4f5b090bd1bdb26f9dc9"),
    FEEMANAGER_ADDRESS: ("TURBOPACK compile-time value", "0xb581d265e43b2a8d872f3113651ed627bdbd952d"),
    WRAPPER: ("TURBOPACK compile-time value", "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270"),
    V4_ROUTER: ("TURBOPACK compile-time value", "0x1ED2F145C44F2E28174c7799773Bc27eC9147661") || "",
    V4_HOOK: ("TURBOPACK compile-time value", "0xF710C66b9351348D9421F95C0103042F80A050C8") || "",
    V4_SOLVER: ("TURBOPACK compile-time value", "0x518634753C61342298c3E04326056b3Ce596a566") || "",
    V4_PRICEFEED: ("TURBOPACK compile-time value", "0xD2e8b474d6faB4d879Fe4621192B018B35B79488") || ("TURBOPACK compile-time value", "0x015c3722683b54fff1491a92bfd9c72ca3c84cc4") || ""
};
function useDeFi() {
    _s();
    const { address, isConnected, chainId } = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$wagmi$2f$dist$2f$esm$2f$hooks$2f$useConnection$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__useConnection__as__useAccount$3e$__["useAccount"])();
    const { data: walletClient } = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$wagmi$2f$dist$2f$esm$2f$hooks$2f$useWalletClient$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useWalletClient"])();
    const v4 = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$src$2f$hooks$2f$useV4Position$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useV4Position"])();
    const isPolygon = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$src$2f$utils$2f$chains$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["isPolygonChain"])(chainId);
    const isV4 = !isPolygon;
    const chainKey = String(chainId || "1301");
    const chainTokens = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useMemo"])({
        "useDeFi.useMemo[chainTokens]": ()=>{
            if (isPolygon) return polygonTokens;
            return __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$src$2f$config$2f$supported_tokens$2e$json__$28$json$29$__["default"][chainKey] || __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$src$2f$config$2f$supported_tokens$2e$json__$28$json$29$__["default"]["1301"] || {};
        }
    }["useDeFi.useMemo[chainTokens]"], [
        isPolygon,
        chainKey
    ]);
    const ADDRESSES = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useMemo"])({
        "useDeFi.useMemo[ADDRESSES]": ()=>({
                ...chainTokens,
                ...ENV_ADDRESSES
            })
    }["useDeFi.useMemo[ADDRESSES]"], [
        chainTokens
    ]);
    const SUPPORTED_TOKENS_LIST = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useMemo"])({
        "useDeFi.useMemo[SUPPORTED_TOKENS_LIST]": ()=>Object.entries(chainTokens).filter({
                "useDeFi.useMemo[SUPPORTED_TOKENS_LIST]": ([key])=>key !== "wrapper"
            }["useDeFi.useMemo[SUPPORTED_TOKENS_LIST]"]).map({
                "useDeFi.useMemo[SUPPORTED_TOKENS_LIST]": ([key, address])=>({
                        key,
                        name: key,
                        address
                    })
            }["useDeFi.useMemo[SUPPORTED_TOKENS_LIST]"])
    }["useDeFi.useMemo[SUPPORTED_TOKENS_LIST]"], [
        chainTokens
    ]);
    // Providers
    const [readProvider, setReadProvider] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"])(null);
    const [isMetaMaskInstalled, setIsMetaMaskInstalled] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"])(false);
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useEffect"])({
        "useDeFi.useEffect": ()=>{
            const initProvider = {
                "useDeFi.useEffect.initProvider": async ()=>{
                    const hasMetaMask = ("TURBOPACK compile-time value", "object") !== "undefined" && !!window.ethereum;
                    setIsMetaMaskInstalled(hasMetaMask);
                    const rpc = !isPolygon ? ("TURBOPACK compile-time value", "https://unichain-mainnet.g.alchemy.com/v2/MShMmpJbY-27CEbyan4Ac") || ("TURBOPACK compile-time value", "https://polygon-mainnet.g.alchemy.com/v2/MShMmpJbY-27CEbyan4Ac") : ("TURBOPACK compile-time value", "https://polygon-mainnet.g.alchemy.com/v2/MShMmpJbY-27CEbyan4Ac");
                    // Priority: chain-appropriate RPC_URL if configured
                    if (rpc) {
                        const provider = new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$ethers$2f$lib$2e$esm$2f$ethers$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__ethers$3e$__["ethers"].JsonRpcProvider(rpc);
                        setReadProvider(provider);
                    } else if (hasMetaMask) {
                        const provider = new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$ethers$2f$lib$2e$esm$2f$ethers$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__ethers$3e$__["ethers"].BrowserProvider(window.ethereum);
                        setReadProvider(provider);
                    } else if (isPolygon) {
                        const provider = new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$ethers$2f$lib$2e$esm$2f$ethers$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__ethers$3e$__["ethers"].JsonRpcProvider("https://polygon.drpc.org");
                        setReadProvider(provider);
                    }
                }
            }["useDeFi.useEffect.initProvider"];
            initProvider();
        }
    }["useDeFi.useEffect"], [
        isPolygon
    ]);
    const getSigner = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useCallback"])({
        "useDeFi.useCallback[getSigner]": async ()=>{
            if (!walletClient || ("TURBOPACK compile-time value", "object") === "undefined" || !window.ethereum) return null;
            const provider = new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$ethers$2f$lib$2e$esm$2f$ethers$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__ethers$3e$__["ethers"].BrowserProvider(window.ethereum);
            return await provider.getSigner();
        }
    }["useDeFi.useCallback[getSigner]"], [
        walletClient
    ]);
    // --- Logic from utils.js adapted for React ---
    const getTokenBalance = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useCallback"])({
        "useDeFi.useCallback[getTokenBalance]": async (tokenAddress, userAddress)=>{
            if (!readProvider || !tokenAddress || !userAddress) return null;
            try {
                const contract = new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$ethers$2f$lib$2e$esm$2f$ethers$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__ethers$3e$__["ethers"].Contract(tokenAddress, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$src$2f$abis$2f$ERC20$2e$json__$28$json$29$__["default"].abi, readProvider);
                const [symbol, decimals, balance] = await Promise.all([
                    contract.symbol(),
                    contract.decimals(),
                    contract.balanceOf(userAddress)
                ]);
                const formattedBalance = __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$ethers$2f$lib$2e$esm$2f$ethers$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__ethers$3e$__["ethers"].formatUnits(balance, decimals);
                // Calculate USD Value — wrapped separately so balances still load
                // even when a token has no registered Chainlink price feed
                let usdValue = "N/A";
                try {
                    const priceFeedAddress = isPolygon ? ADDRESSES.PRICEFEEDL1 : ADDRESSES.V4_PRICEFEED || ADDRESSES.PRICEFEEDL1;
                    const priceFeed = new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$ethers$2f$lib$2e$esm$2f$ethers$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__ethers$3e$__["ethers"].Contract(priceFeedAddress, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$src$2f$abis$2f$PriceFeedL1$2e$json__$28$json$29$__["default"].abi, readProvider);
                    const usdValueBigInt = await priceFeed.getAmountInUsd(tokenAddress, balance);
                    usdValue = parseFloat(__TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$ethers$2f$lib$2e$esm$2f$ethers$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__ethers$3e$__["ethers"].formatUnits(usdValueBigInt, isPolygon ? 18 : decimals)).toFixed(2);
                } catch  {
                // Price feed not available for this token — show balance without USD value
                }
                return {
                    symbol,
                    decimals,
                    balance: formattedBalance,
                    usdValue,
                    rawBalance: balance
                };
            } catch (error) {
                console.error("Error fetching token balance:", error);
                return null;
            }
        }
    }["useDeFi.useCallback[getTokenBalance]"], [
        readProvider,
        isPolygon,
        ADDRESSES
    ]);
    const getNativeBalance = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useCallback"])({
        "useDeFi.useCallback[getNativeBalance]": async (userAddress)=>{
            if (!readProvider || !userAddress) return null;
            try {
                const balance = await readProvider.getBalance(userAddress);
                // On Unichain the native asset is ETH, valued via the WETH USD feed.
                if (!isPolygon) {
                    let usdValue = "N/A";
                    try {
                        const priceFeedAddress = ADDRESSES.V4_PRICEFEED || ADDRESSES.PRICEFEEDL1;
                        const priceFeed = new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$ethers$2f$lib$2e$esm$2f$ethers$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__ethers$3e$__["ethers"].Contract(priceFeedAddress, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$src$2f$abis$2f$PriceFeedL1$2e$json__$28$json$29$__["default"].abi, readProvider);
                        const usdBig = await priceFeed.getAmountInUsd(ADDRESSES.WETH, balance);
                        usdValue = parseFloat(__TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$ethers$2f$lib$2e$esm$2f$ethers$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__ethers$3e$__["ethers"].formatUnits(usdBig, 18)).toFixed(2);
                    } catch  {
                    // No feed configured yet — show balance without USD value
                    }
                    return {
                        symbol: "ETH",
                        decimals: 18,
                        balance: __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$ethers$2f$lib$2e$esm$2f$ethers$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__ethers$3e$__["ethers"].formatEther(balance),
                        usdValue,
                        rawBalance: balance
                    };
                }
                // On Polygon, the native token is POL (formerly MATIC)
                // MATIC/USD Price Feed on Polygon Mainnet: 0xAB594600376Ec9fD91F8e885dADF0CE036862dE0
                const maticUsdAggregator = new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$ethers$2f$lib$2e$esm$2f$ethers$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__ethers$3e$__["ethers"].Contract("0xAB594600376Ec9fD91F8e885dADF0CE036862dE0", [
                    "function latestRoundData() external view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
                    "function decimals() external view returns (uint8)"
                ], readProvider);
                const [roundData, decimals] = await Promise.all([
                    maticUsdAggregator.latestRoundData(),
                    maticUsdAggregator.decimals()
                ]);
                const price = Number(roundData.answer) / 10 ** Number(decimals);
                const formattedBalance = parseFloat(__TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$ethers$2f$lib$2e$esm$2f$ethers$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__ethers$3e$__["ethers"].formatEther(balance));
                const usdValue = (formattedBalance * price).toFixed(2);
                return {
                    symbol: "POL",
                    decimals: 18,
                    balance: formattedBalance.toString(),
                    usdValue,
                    rawBalance: balance
                };
            } catch (error) {
                console.error("Error fetching native balance:", error);
                return null;
            }
        }
    }["useDeFi.useCallback[getNativeBalance]"], [
        readProvider,
        isPolygon,
        ADDRESSES
    ]);
    const calculateTokenAmountFromUsd = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useCallback"])({
        "useDeFi.useCallback[calculateTokenAmountFromUsd]": async (tokenAddress, usdAmount)=>{
            if (!readProvider) return 0n;
            try {
                const contract = new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$ethers$2f$lib$2e$esm$2f$ethers$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__ethers$3e$__["ethers"].Contract(tokenAddress, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$src$2f$abis$2f$ERC20$2e$json__$28$json$29$__["default"].abi, readProvider);
                const priceFeed = new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$ethers$2f$lib$2e$esm$2f$ethers$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__ethers$3e$__["ethers"].Contract(ADDRESSES.PRICEFEEDL1, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$src$2f$abis$2f$PriceFeedL1$2e$json__$28$json$29$__["default"].abi, readProvider);
                const decimals = await contract.decimals();
                const priceInUsd = await priceFeed.getTokenLatestPriceInUsd(tokenAddress);
                const targetUsdValue = __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$ethers$2f$lib$2e$esm$2f$ethers$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__ethers$3e$__["ethers"].parseUnits(usdAmount.toString(), 18);
                // Formula: (TargetUSD * 10^Decimals) / PriceUSD
                return targetUsdValue * 10n ** BigInt(decimals) / priceInUsd;
            } catch (error) {
                console.error("Error calculating token amount:", error);
                return 0n;
            }
        }
    }["useDeFi.useCallback[calculateTokenAmountFromUsd]"], [
        readProvider
    ]);
    const getAmountInUsd = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useCallback"])({
        "useDeFi.useCallback[getAmountInUsd]": async (tokenAddress, amount)=>{
            if (!readProvider) return 0n;
            try {
                const priceFeedAddress = isPolygon ? ADDRESSES.PRICEFEEDL1 : ADDRESSES.V4_PRICEFEED || ADDRESSES.PRICEFEEDL1;
                if (!priceFeedAddress) return 0n;
                const priceFeed = new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$ethers$2f$lib$2e$esm$2f$ethers$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__ethers$3e$__["ethers"].Contract(priceFeedAddress, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$src$2f$abis$2f$PriceFeedL1$2e$json__$28$json$29$__["default"].abi, readProvider);
                return await priceFeed.getAmountInUsd(tokenAddress, amount);
            } catch (error) {
                console.warn(`getAmountInUsd failed for token=${tokenAddress} amount=${amount}:`, error.shortMessage || error.message);
                return 0n;
            }
        }
    }["useDeFi.useCallback[getAmountInUsd]"], [
        readProvider,
        isPolygon,
        ADDRESSES
    ]);
    const getAllowance = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useCallback"])({
        "useDeFi.useCallback[getAllowance]": async (tokenAddress, owner, spender)=>{
            if (!readProvider || !tokenAddress || !owner || !spender) return 0n;
            try {
                const contract = new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$ethers$2f$lib$2e$esm$2f$ethers$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__ethers$3e$__["ethers"].Contract(tokenAddress, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$src$2f$abis$2f$ERC20$2e$json__$28$json$29$__["default"].abi, readProvider);
                return await contract.allowance(owner, spender);
            } catch (error) {
                console.error("Error fetching allowance:", error);
                return 0n;
            }
        }
    }["useDeFi.useCallback[getAllowance]"], [
        readProvider
    ]);
    const approveToken = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useCallback"])({
        "useDeFi.useCallback[approveToken]": async (tokenAddress, spender, amount = __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$ethers$2f$lib$2e$esm$2f$ethers$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__ethers$3e$__["ethers"].MaxUint256)=>{
            const signer = await getSigner();
            if (!signer) throw new Error("Wallet not connected");
            const contract = new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$ethers$2f$lib$2e$esm$2f$ethers$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__ethers$3e$__["ethers"].Contract(tokenAddress, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$src$2f$abis$2f$ERC20$2e$json__$28$json$29$__["default"].abi, signer);
            return await contract.approve(spender, amount);
        }
    }["useDeFi.useCallback[approveToken]"], [
        getSigner
    ]);
    const sendTokens = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useCallback"])({
        "useDeFi.useCallback[sendTokens]": async (tokenAddress, to, amount)=>{
            const signer = await getSigner();
            if (!signer) throw new Error("Wallet not connected");
            const contract = new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$ethers$2f$lib$2e$esm$2f$ethers$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__ethers$3e$__["ethers"].Contract(tokenAddress, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$src$2f$abis$2f$ERC20$2e$json__$28$json$29$__["default"].abi, signer);
            return await contract.transfer(to, amount);
        }
    }["useDeFi.useCallback[sendTokens]"], [
        getSigner
    ]);
    const simulateOpenPosition = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useCallback"])({
        "useDeFi.useCallback[simulateOpenPosition]": async (token0, token1, isShort, amount, leverage)=>{
            const signer = await getSigner();
            if (!signer) throw new Error("Wallet not connected");
            // Validate leverage before simulation
            if (leverage < 2) {
                return {
                    success: false,
                    error: {
                        message: "Positions__LEVERAGE_NOT_IN_RANGE",
                        reason: "Leverage must be at least 2x"
                    }
                };
            }
            const marketContract = new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$ethers$2f$lib$2e$esm$2f$ethers$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__ethers$3e$__["ethers"].Contract(ADDRESSES.MARKET, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$src$2f$abis$2f$Market$2e$json__$28$json$29$__["default"].abi, signer);
            try {
                if (isShort) {
                    await marketContract.openShortPosition.staticCall(token0, token1, 3000, // fee
                    leverage, amount, 0, // limitPrice
                    0, // stopLossPrice
                    {
                        gasLimit: 5000000
                    });
                } else {
                    await marketContract.openLongPosition.staticCall(token0, token1, 3000, // fee
                    leverage, amount, 0, // limitPrice
                    0, // stopLossPrice
                    {
                        gasLimit: 5000000
                    });
                }
                return {
                    success: true
                };
            } catch (error) {
                return {
                    success: false,
                    error
                };
            }
        }
    }["useDeFi.useCallback[simulateOpenPosition]"], [
        getSigner
    ]);
    const openPosition = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useCallback"])({
        "useDeFi.useCallback[openPosition]": async (token0, token1, isShort, amount, leverage)=>{
            const signer = await getSigner();
            if (!signer) throw new Error("Wallet not connected");
            // Validate leverage before sending transaction
            if (leverage < 2) {
                throw new Error("Leverage must be at least 2x (contract requires leverage > 1)");
            }
            // Re-create instances with the correct signer
            const marketContract = new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$ethers$2f$lib$2e$esm$2f$ethers$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__ethers$3e$__["ethers"].Contract(ADDRESSES.MARKET, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$src$2f$abis$2f$Market$2e$json__$28$json$29$__["default"].abi, signer);
            // First simulate to catch any revert errors before sending
            let simulationSuccess = false;
            try {
                if (isShort) {
                    await marketContract.openShortPosition.staticCall(token0, token1, 3000, // fee
                    leverage, amount, 0, // limitPrice
                    0, // stopLossPrice
                    {
                        gasLimit: 5000000
                    });
                } else {
                    await marketContract.openLongPosition.staticCall(token0, token1, 3000, // fee
                    leverage, amount, 0, // limitPrice
                    0, // stopLossPrice
                    {
                        gasLimit: 5000000
                    });
                }
                simulationSuccess = true;
            } catch (simError) {
                console.error("Simulation failed:", simError);
                // Re-throw the simulation error so the UI can handle it
                throw simError;
            }
            // Only proceed if simulation passed
            if (!simulationSuccess) {
                throw new Error("Transaction simulation failed");
            }
            // Open Position
            let tx;
            if (isShort) {
                tx = await marketContract.openShortPosition(token0, token1, 3000, // fee
                leverage, amount, 0, // limitPrice
                0, // stopLossPrice
                {
                    gasLimit: 5000000
                });
            } else {
                tx = await marketContract.openLongPosition(token0, token1, 3000, // fee
                leverage, amount, 0, // limitPrice
                0, // stopLossPrice
                {
                    gasLimit: 5000000
                });
            }
            return tx;
        }
    }["useDeFi.useCallback[openPosition]"], [
        getSigner
    ]);
    const closePosition = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useCallback"])({
        "useDeFi.useCallback[closePosition]": async (posId, poolKey)=>{
            if (!isPolygon) {
                return v4.closePosition(posId, poolKey);
            }
            const signer = await getSigner();
            if (!signer) throw new Error("Wallet not connected");
            const marketContract = new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$ethers$2f$lib$2e$esm$2f$ethers$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__ethers$3e$__["ethers"].Contract(ADDRESSES.MARKET, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$src$2f$abis$2f$Market$2e$json__$28$json$29$__["default"].abi, signer);
            const tx = await marketContract.closePosition(posId, {
                gasLimit: 2000000
            });
            return tx;
        }
    }["useDeFi.useCallback[closePosition]"], [
        isPolygon,
        v4,
        getSigner,
        ADDRESSES
    ]);
    const getPositionDetails = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useCallback"])({
        "useDeFi.useCallback[getPositionDetails]": async (posId, userAddress, poolKey)=>{
            if (!isPolygon) {
                return v4.getPositionDetails(posId, userAddress, poolKey);
            }
            if (!readProvider || !ADDRESSES.POSITIONS || ADDRESSES.POSITIONS === __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$ethers$2f$lib$2e$esm$2f$ethers$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__ethers$3e$__["ethers"].ZeroAddress) return null;
            try {
                // Verify code exists at address to avoid BAD_DATA errors on wrong networks
                const code = await readProvider.getCode(ADDRESSES.POSITIONS);
                if (code === "0x") return null;
                const market = new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$ethers$2f$lib$2e$esm$2f$ethers$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__ethers$3e$__["ethers"].Contract(ADDRESSES.MARKET, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$src$2f$abis$2f$Market$2e$json__$28$json$29$__["default"].abi, readProvider);
                const priceFeed = new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$ethers$2f$lib$2e$esm$2f$ethers$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__ethers$3e$__["ethers"].Contract(ADDRESSES.PRICEFEEDL1, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$src$2f$abis$2f$PriceFeedL1$2e$json__$28$json$29$__["default"].abi, readProvider);
                const positions = new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$ethers$2f$lib$2e$esm$2f$ethers$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__ethers$3e$__["ethers"].Contract(ADDRESSES.POSITIONS, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$src$2f$abis$2f$Positions$2e$json__$28$json$29$__["default"].abi, readProvider);
                // Check ownership/existence
                // positions.ownerOf might revert if burned
                let owner;
                try {
                    owner = await positions.ownerOf(posId);
                } catch  {
                    return null; // Position closed/burned
                }
                const params = await market.getPositionParams(posId);
                // params: baseToken, quoteToken, positionSize, timestamp, isShort, leverage, liquidationFloor (ignored), limitPrice, stopLossPrice, currentPnL, collateralLeft
                const [baseToken, quoteToken, positionSize, , isShort, leverage, , , , currentPnL, collateralLeft] = params;
                const baseContract = new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$ethers$2f$lib$2e$esm$2f$ethers$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__ethers$3e$__["ethers"].Contract(baseToken, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$src$2f$abis$2f$ERC20$2e$json__$28$json$29$__["default"].abi, readProvider);
                const quoteContract = new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$ethers$2f$lib$2e$esm$2f$ethers$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__ethers$3e$__["ethers"].Contract(quoteToken, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$src$2f$abis$2f$ERC20$2e$json__$28$json$29$__["default"].abi, readProvider);
                const [baseSymbol, baseDecimals, quoteSymbol, quoteDecimals] = await Promise.all([
                    baseContract.symbol(),
                    baseContract.decimals(),
                    quoteContract.symbol(),
                    quoteContract.decimals()
                ]);
                // Get initialPrice from Positions contract
                const posParams = await positions.openPositions(posId);
                const initialPrice = posParams.initialPrice;
                // Determine the correct token and decimals for size/PnL
                // For Long, size is positionSize (in baseToken).
                // For Short, size is totalBorrow (in baseToken).
                const displaySize = isShort ? posParams.totalBorrow : positionSize;
                const targetToken = baseToken;
                const targetDecimals = baseDecimals;
                const usdValueBigInt = await priceFeed.getAmountInUsd(targetToken, displaySize);
                const usdValue = parseFloat(__TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$ethers$2f$lib$2e$esm$2f$ethers$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__ethers$3e$__["ethers"].formatUnits(usdValueBigInt, 18)).toFixed(2);
                // Calculate PnL
                const pnlIsPositive = currentPnL >= 0n;
                const absPnL = pnlIsPositive ? currentPnL : -currentPnL;
                const targetPnlToken = isShort ? quoteToken : baseToken;
                const targetPnlDecimals = isShort ? quoteDecimals : baseDecimals;
                const formattedPnl = __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$ethers$2f$lib$2e$esm$2f$ethers$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__ethers$3e$__["ethers"].formatUnits(absPnL, targetPnlDecimals);
                const pnlUsdBigInt = await priceFeed.getAmountInUsd(targetPnlToken, absPnL);
                const pnlUsd = parseFloat(__TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$ethers$2f$lib$2e$esm$2f$ethers$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__ethers$3e$__["ethers"].formatUnits(pnlUsdBigInt, 18)).toFixed(2);
                // Get current price
                let currentPrice = 0n;
                try {
                    currentPrice = await priceFeed.getPairLatestPrice(baseToken, quoteToken);
                } catch (e) {
                // Price feed might not exist for this pair
                }
                // Format prices with quote token decimals
                const formattedCurrentPrice = __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$ethers$2f$lib$2e$esm$2f$ethers$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__ethers$3e$__["ethers"].formatUnits(currentPrice, quoteDecimals);
                const formattedEntryPrice = __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$ethers$2f$lib$2e$esm$2f$ethers$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__ethers$3e$__["ethers"].formatUnits(initialPrice, quoteDecimals);
                const stateInt = await positions.getPositionState(posId);
                const states = [
                    "NONE",
                    "TAKE_PROFIT",
                    "ACTIVE",
                    "STOP_LOSS",
                    "LIQUIDATABLE",
                    "BAD_DEBT",
                    "EXPIRED"
                ];
                const state = states[Number(stateInt)] || "UNKNOWN";
                return {
                    id: posId.toString(),
                    owner,
                    state,
                    isShort,
                    leverage: leverage.toString(),
                    baseToken,
                    quoteToken,
                    baseSymbol,
                    quoteSymbol,
                    size: __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$ethers$2f$lib$2e$esm$2f$ethers$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__ethers$3e$__["ethers"].formatUnits(displaySize, targetDecimals),
                    sizeUsd: usdValue,
                    pnl: formattedPnl,
                    pnlUsd: pnlUsd,
                    pnlIsPositive,
                    collateralLeft: __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$ethers$2f$lib$2e$esm$2f$ethers$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__ethers$3e$__["ethers"].formatUnits(collateralLeft < 0n ? -collateralLeft : collateralLeft, targetDecimals),
                    entryPrice: formattedEntryPrice,
                    currentPrice: formattedCurrentPrice
                };
            } catch (error) {
                console.error(`Error fetching pos ${posId}:`, error);
                return null;
            }
        }
    }["useDeFi.useCallback[getPositionDetails]"], [
        isPolygon,
        v4,
        readProvider,
        ADDRESSES
    ]);
    /**
   * Calculate position opening parameters using Market contract
   * @param {string} price - Current price from oracle
   * @param {number} leverage - Leverage multiplier (2-5)
   * @param {bigint} baseCollateralAmount - Collateral amount after fees (in base token decimals)
   * @param {boolean} isShort - True for short position
   * @param {string} baseToken - Base token address
   * @param {string} quoteToken - Quote token address
   * @returns {Promise<{liquidationFloor: string, totalBorrow: string, borrowToken: string, liquidityPoolToken: string}|null>}
   */ const calculatePositionOpening = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useCallback"])({
        "useDeFi.useCallback[calculatePositionOpening]": async (price, leverage, baseCollateralAmount, isShort, baseToken, quoteToken)=>{
            if (!readProvider || !ADDRESSES.MARKET || ADDRESSES.MARKET === __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$ethers$2f$lib$2e$esm$2f$ethers$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__ethers$3e$__["ethers"].ZeroAddress) return null;
            try {
                // Verify code exists at address
                const code = await readProvider.getCode(ADDRESSES.MARKET);
                if (code === "0x") return null;
                const market = new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$ethers$2f$lib$2e$esm$2f$ethers$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__ethers$3e$__["ethers"].Contract(ADDRESSES.MARKET, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$src$2f$abis$2f$Market$2e$json__$28$json$29$__["default"].abi, readProvider);
                // Call the calculatePositionOpening method
                const result = await market.calculatePositionOpening(price, leverage, baseCollateralAmount, isShort, baseToken, quoteToken);
                // Destructure the result tuple
                const [liquidationFloor, totalBorrow, borrowToken, liquidityPoolToken] = result;
                return {
                    liquidationFloor: liquidationFloor.toString(),
                    totalBorrow: totalBorrow.toString(),
                    borrowToken,
                    liquidityPoolToken
                };
            } catch (error) {
                console.error("Error calculating position opening:", error);
                return null;
            }
        }
    }["useDeFi.useCallback[calculatePositionOpening]"], [
        readProvider
    ]);
    const getPositionsCount = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useCallback"])({
        "useDeFi.useCallback[getPositionsCount]": async (poolKey)=>{
            if (!isPolygon) {
                return v4.getPositionsCount(poolKey);
            }
            if (!readProvider || !ADDRESSES.POSITIONS || ADDRESSES.POSITIONS === __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$ethers$2f$lib$2e$esm$2f$ethers$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__ethers$3e$__["ethers"].ZeroAddress) return 0n;
            try {
                // Verify code exists at address to avoid BAD_DATA errors on wrong networks
                const code = await readProvider.getCode(ADDRESSES.POSITIONS);
                if (code === "0x") {
                    console.warn("Positions contract not found on this network");
                    return 0n;
                }
                const positions = new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$ethers$2f$lib$2e$esm$2f$ethers$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__ethers$3e$__["ethers"].Contract(ADDRESSES.POSITIONS, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$src$2f$abis$2f$Positions$2e$json__$28$json$29$__["default"].abi, readProvider);
                return await positions.posId();
            } catch (error) {
                console.error("Error fetching positions count:", error);
                return 0n;
            }
        }
    }["useDeFi.useCallback[getPositionsCount]"], [
        isPolygon,
        v4,
        readProvider,
        ADDRESSES
    ]);
    // Calculate required borrow amount using the Market contract's calculatePositionOpening method
    const calculateRequiredBorrow = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useCallback"])({
        "useDeFi.useCallback[calculateRequiredBorrow]": async (marginTokenAddress, tradingTokenAddress, isShort, marginAmount, leverage)=>{
            if (!readProvider || !marginTokenAddress || !tradingTokenAddress || !marginAmount || leverage < 2) {
                return null;
            }
            try {
                const priceFeed = new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$ethers$2f$lib$2e$esm$2f$ethers$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__ethers$3e$__["ethers"].Contract(ADDRESSES.PRICEFEEDL1, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$src$2f$abis$2f$PriceFeedL1$2e$json__$28$json$29$__["default"].abi, readProvider);
                const feeManager = new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$ethers$2f$lib$2e$esm$2f$ethers$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__ethers$3e$__["ethers"].Contract(ADDRESSES.FEEMANAGER_ADDRESS, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$src$2f$abis$2f$FeeManager$2e$json__$28$json$29$__["default"].abi, readProvider);
                // Get token decimals
                const marginContract = new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$ethers$2f$lib$2e$esm$2f$ethers$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__ethers$3e$__["ethers"].Contract(marginTokenAddress, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$src$2f$abis$2f$ERC20$2e$json__$28$json$29$__["default"].abi, readProvider);
                const tradingContract = new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$ethers$2f$lib$2e$esm$2f$ethers$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__ethers$3e$__["ethers"].Contract(tradingTokenAddress, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$src$2f$abis$2f$ERC20$2e$json__$28$json$29$__["default"].abi, readProvider);
                const [marginDecimals, tradingDecimals] = await Promise.all([
                    marginContract.decimals(),
                    tradingContract.decimals()
                ]);
                // Determine base and quote tokens based on price stability
                const marginPriceUsd = await priceFeed.getTokenLatestPriceInUsd(marginTokenAddress);
                const isMarginStable = marginPriceUsd >= 9n * 10n ** 17n && marginPriceUsd <= 11n * 10n ** 17n;
                const baseToken = isMarginStable ? tradingTokenAddress : marginTokenAddress;
                const quoteToken = isMarginStable ? marginTokenAddress : tradingTokenAddress;
                const baseDecimals = isMarginStable ? tradingDecimals : marginDecimals;
                const quoteDecimals = isMarginStable ? marginDecimals : tradingDecimals;
                const baseDecimalsPow = 10n ** BigInt(baseDecimals);
                const quoteDecimalsPow = 10n ** BigInt(quoteDecimals);
                // Get the pair price (base/quote)
                const price = await priceFeed.getPairLatestPrice(baseToken, quoteToken);
                // Estimate baseCollateralAmount by applying fees and potential swap
                // This mirrors the logic in Positions._openPosition
                const collateralToken = isShort ? quoteToken : baseToken;
                let baseCollateralAmount = marginAmount;
                // Deduct fees if user is connected
                if (address) {
                    const [treasureFee, liquidationRewardRate] = await feeManager.getFees(address);
                    const liquidationReward = marginAmount * BigInt(liquidationRewardRate) / 10000n;
                    baseCollateralAmount = baseCollateralAmount - liquidationReward;
                    const treasureAmount = baseCollateralAmount * BigInt(treasureFee) / 10000n;
                    baseCollateralAmount = baseCollateralAmount - treasureAmount;
                }
                // If margin token is not the collateral token, estimate swap output
                if (marginTokenAddress.toLowerCase() !== collateralToken.toLowerCase()) {
                    const priceToCollateral = await priceFeed.getPairLatestPrice(marginTokenAddress, collateralToken);
                    const divisor = isShort ? baseDecimalsPow : quoteDecimalsPow;
                    const estimatedOut = baseCollateralAmount * priceToCollateral / divisor;
                    baseCollateralAmount = estimatedOut;
                }
                // Call Market contract's calculatePositionOpening method with the estimated collateral
                const market = new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$ethers$2f$lib$2e$esm$2f$ethers$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__ethers$3e$__["ethers"].Contract(ADDRESSES.MARKET, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$src$2f$abis$2f$Market$2e$json__$28$json$29$__["default"].abi, readProvider);
                const result = await market.calculatePositionOpening(price, leverage, baseCollateralAmount, isShort, baseToken, quoteToken);
                const [liquidationFloor, totalBorrow, borrowToken, liquidityPoolToken] = result;
                // Get decimals for borrow token
                const isBorrowBase = borrowToken.toLowerCase() === baseToken.toLowerCase();
                const borrowTokenDecimals = isBorrowBase ? baseDecimals : marginDecimals;
                // Calculate USD value of the borrow
                const borrowUsdValue = await priceFeed.getAmountInUsd(borrowToken, totalBorrow);
                return {
                    totalBorrow,
                    borrowTokenAddress: borrowToken,
                    borrowTokenDecimals,
                    totalBorrowFormatted: __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$ethers$2f$lib$2e$esm$2f$ethers$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__ethers$3e$__["ethers"].formatUnits(totalBorrow, borrowTokenDecimals),
                    borrowUsdValue,
                    borrowUsdFormatted: parseFloat(__TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$ethers$2f$lib$2e$esm$2f$ethers$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__ethers$3e$__["ethers"].formatUnits(borrowUsdValue, 18)).toFixed(2),
                    liquidationFloor: liquidationFloor,
                    price,
                    isBaseMargin: !isMarginStable
                };
            } catch (error) {
                console.error("Error calculating required borrow:", error);
                return null;
            }
        }
    }["useDeFi.useCallback[calculateRequiredBorrow]"], [
        readProvider,
        address
    ]);
    // --- Pool & Protocol Logic ---
    const getProtocolBalances = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useCallback"])({
        "useDeFi.useCallback[getProtocolBalances]": async ()=>{
            if (!readProvider) return null;
            try {
                const priceFeed = new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$ethers$2f$lib$2e$esm$2f$ethers$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__ethers$3e$__["ethers"].Contract(ADDRESSES.PRICEFEEDL1, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$src$2f$abis$2f$PriceFeedL1$2e$json__$28$json$29$__["default"].abi, readProvider);
                const market = new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$ethers$2f$lib$2e$esm$2f$ethers$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__ethers$3e$__["ethers"].Contract(ADDRESSES.MARKET, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$src$2f$abis$2f$Market$2e$json__$28$json$29$__["default"].abi, readProvider);
                const positionsBalances = {};
                const poolBalances = {};
                for (const token of POLYGON_TOKENS_LIST){
                    if (!token.address) continue;
                    try {
                        const tokenContract = new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$ethers$2f$lib$2e$esm$2f$ethers$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__ethers$3e$__["ethers"].Contract(token.address, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$src$2f$abis$2f$ERC20$2e$json__$28$json$29$__["default"].abi, readProvider);
                        // 1. POSITIONS Contract Balance
                        const posBal = await tokenContract.balanceOf(ADDRESSES.POSITIONS);
                        const posDecimals = await tokenContract.decimals();
                        // USD price call — may fail if token has no Chainlink feed
                        let posUsdValue = "N/A";
                        try {
                            const posUsdBig = await priceFeed.getAmountInUsd(token.address, posBal);
                            posUsdValue = parseFloat(__TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$ethers$2f$lib$2e$esm$2f$ethers$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__ethers$3e$__["ethers"].formatUnits(posUsdBig, 18)).toFixed(2);
                        } catch  {
                        // Price feed not registered for this token
                        }
                        positionsBalances[token.key] = {
                            balance: __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$ethers$2f$lib$2e$esm$2f$ethers$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__ethers$3e$__["ethers"].formatUnits(posBal, posDecimals),
                            usdValue: posUsdValue
                        };
                        // 2. Liquidity Pool Info
                        let poolAddress;
                        try {
                            poolAddress = await market.getTokenToLiquidityPools(token.address);
                        } catch  {
                        // Token may not have a pool registered
                        }
                        if (poolAddress && poolAddress !== __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$ethers$2f$lib$2e$esm$2f$ethers$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__ethers$3e$__["ethers"].ZeroAddress) {
                            const poolContract = new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$ethers$2f$lib$2e$esm$2f$ethers$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__ethers$3e$__["ethers"].Contract(poolAddress, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$src$2f$abis$2f$LiquidityPool$2e$json__$28$json$29$__["default"].abi, readProvider);
                            const rawTotalAsset = await poolContract.rawTotalAsset();
                            let totalAssetsUsd = "N/A";
                            try {
                                const totalAssetsUsdBig = await priceFeed.getAmountInUsd(token.address, rawTotalAsset);
                                totalAssetsUsd = parseFloat(__TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$ethers$2f$lib$2e$esm$2f$ethers$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__ethers$3e$__["ethers"].formatUnits(totalAssetsUsdBig, 18)).toFixed(2);
                            } catch  {
                            // Price feed not registered for this token
                            }
                            // User Shares (if connected)
                            let userShares = 0n;
                            let userAssets = 0n;
                            if (address) {
                                userShares = await poolContract.balanceOf(address);
                                if (userShares > 0n) {
                                    userAssets = await poolContract.convertToAssets(userShares);
                                }
                            }
                            poolBalances[token.key] = {
                                address: poolAddress,
                                totalAssets: __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$ethers$2f$lib$2e$esm$2f$ethers$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__ethers$3e$__["ethers"].formatUnits(rawTotalAsset, posDecimals),
                                totalAssetsUsd,
                                userShares: __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$ethers$2f$lib$2e$esm$2f$ethers$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__ethers$3e$__["ethers"].formatUnits(userShares, posDecimals),
                                userAssets: __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$ethers$2f$lib$2e$esm$2f$ethers$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__ethers$3e$__["ethers"].formatUnits(userAssets, posDecimals)
                            };
                        }
                    } catch (tokenError) {
                        // Skip tokens that fail entirely (e.g. contract not deployed)
                        console.warn(`Skipping token ${token.key}:`, tokenError.message);
                    }
                }
                return {
                    positionsBalances,
                    poolBalances
                };
            } catch (error) {
                console.error("Error fetching protocol balances:", error);
                return null;
            }
        }
    }["useDeFi.useCallback[getProtocolBalances]"], [
        readProvider,
        address
    ]);
    const depositToPool = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useCallback"])({
        "useDeFi.useCallback[depositToPool]": async (tokenKey, amount)=>{
            const signer = await getSigner();
            if (!signer) throw new Error("Wallet not connected");
            const tokenAddress = ADDRESSES[tokenKey];
            if (!tokenAddress) throw new Error("Invalid Token");
            // Get Pool Address
            const market = new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$ethers$2f$lib$2e$esm$2f$ethers$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__ethers$3e$__["ethers"].Contract(ADDRESSES.MARKET, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$src$2f$abis$2f$Market$2e$json__$28$json$29$__["default"].abi, readProvider);
            const poolAddress = await market.getTokenToLiquidityPools(tokenAddress);
            if (!poolAddress || poolAddress === __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$ethers$2f$lib$2e$esm$2f$ethers$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__ethers$3e$__["ethers"].ZeroAddress) throw new Error("Pool not found");
            const tokenContract = new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$ethers$2f$lib$2e$esm$2f$ethers$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__ethers$3e$__["ethers"].Contract(tokenAddress, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$src$2f$abis$2f$ERC20$2e$json__$28$json$29$__["default"].abi, signer);
            const poolContract = new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$ethers$2f$lib$2e$esm$2f$ethers$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__ethers$3e$__["ethers"].Contract(poolAddress, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$src$2f$abis$2f$LiquidityPool$2e$json__$28$json$29$__["default"].abi, signer);
            // Approve
            const allowance = await tokenContract.allowance(address, poolAddress);
            if (allowance < amount) {
                const txApprove = await tokenContract.approve(poolAddress, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$ethers$2f$lib$2e$esm$2f$ethers$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__ethers$3e$__["ethers"].MaxUint256);
                await txApprove.wait();
            }
            // Deposit
            const tx = await poolContract.deposit(amount, address);
            return tx;
        }
    }["useDeFi.useCallback[depositToPool]"], [
        address,
        getSigner,
        readProvider
    ]);
    const redeemFromPool = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useCallback"])({
        "useDeFi.useCallback[redeemFromPool]": async (tokenKey, shares)=>{
            const signer = await getSigner();
            if (!signer) throw new Error("Wallet not connected");
            const tokenAddress = ADDRESSES[tokenKey];
            const market = new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$ethers$2f$lib$2e$esm$2f$ethers$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__ethers$3e$__["ethers"].Contract(ADDRESSES.MARKET, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$src$2f$abis$2f$Market$2e$json__$28$json$29$__["default"].abi, readProvider);
            const poolAddress = await market.getTokenToLiquidityPools(tokenAddress);
            const poolContract = new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$ethers$2f$lib$2e$esm$2f$ethers$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__ethers$3e$__["ethers"].Contract(poolAddress, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$src$2f$abis$2f$LiquidityPool$2e$json__$28$json$29$__["default"].abi, signer);
            // redeem(shares, receiver, owner)
            const tx = await poolContract.redeem(shares, address, address);
            return tx;
        }
    }["useDeFi.useCallback[redeemFromPool]"], [
        address,
        getSigner,
        readProvider
    ]);
    // --- Fee Manager Logic ---
    const getFeeDefaults = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useCallback"])({
        "useDeFi.useCallback[getFeeDefaults]": async ()=>{
            if (!readProvider) return null;
            try {
                const feeManager = new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$ethers$2f$lib$2e$esm$2f$ethers$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__ethers$3e$__["ethers"].Contract(ADDRESSES.FEEMANAGER_ADDRESS, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$src$2f$abis$2f$FeeManager$2e$json__$28$json$29$__["default"].abi, readProvider);
                const [treasureFee, liquidationReward] = await Promise.all([
                    feeManager.defaultTreasureFee(),
                    feeManager.defaultLiquidationReward()
                ]);
                return {
                    treasureFee: treasureFee.toString(),
                    liquidationReward: liquidationReward.toString()
                };
            } catch (error) {
                console.error("Error fetching fee defaults:", error);
                return null;
            }
        }
    }["useDeFi.useCallback[getFeeDefaults]"], [
        readProvider
    ]);
    const updateFeeDefaults = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useCallback"])({
        "useDeFi.useCallback[updateFeeDefaults]": async (treasureFee, liquidationReward)=>{
            const signer = await getSigner();
            if (!signer) throw new Error("Wallet not connected");
            const feeManager = new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$ethers$2f$lib$2e$esm$2f$ethers$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__ethers$3e$__["ethers"].Contract(ADDRESSES.FEEMANAGER_ADDRESS, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$src$2f$abis$2f$FeeManager$2e$json__$28$json$29$__["default"].abi, signer);
            const tx = await feeManager.setDefaultFees(treasureFee, liquidationReward);
            return tx;
        }
    }["useDeFi.useCallback[updateFeeDefaults]"], [
        getSigner
    ]);
    return {
        ADDRESSES,
        readProvider,
        getTokenBalance,
        getAmountInUsd,
        calculateTokenAmountFromUsd,
        calculateRequiredBorrow,
        calculatePositionOpening,
        openPosition,
        simulateOpenPosition,
        openV4Position: v4.openV4Position,
        simulateV4Position: v4.simulateV4Position,
        openHalalShortOption: v4.openHalalShortOption,
        exerciseHalalShortOption: v4.exerciseHalalShortOption,
        cancelHalalShortOption: v4.cancelHalalShortOption,
        closePosition,
        getPositionDetails,
        getPositionsCount,
        getProtocolBalances,
        depositToPool,
        redeemFromPool,
        getFeeDefaults,
        updateFeeDefaults,
        getNativeBalance,
        getAllowance,
        approveToken,
        sendTokens,
        ADDRESSES,
        SUPPORTED_TOKENS_LIST,
        isMetaMaskInstalled,
        isPolygon,
        isV4,
        chainId
    };
}
_s(useDeFi, "wtHt5RGxis67oGp0wVTEk/ovXCA=", false, function() {
    return [
        __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$wagmi$2f$dist$2f$esm$2f$hooks$2f$useConnection$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__useConnection__as__useAccount$3e$__["useAccount"],
        __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$wagmi$2f$dist$2f$esm$2f$hooks$2f$useWalletClient$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useWalletClient"],
        __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$src$2f$hooks$2f$useV4Position$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useV4Position"]
    ];
});
var _c, _c1;
__turbopack_context__.k.register(_c, 'POLYGON_TOKENS_LIST$Object.entries(polygonTokens).filter(([key]) => key !== "wrapper").map');
__turbopack_context__.k.register(_c1, "POLYGON_TOKENS_LIST");
if (typeof globalThis.$RefreshHelpers$ === 'object' && globalThis.$RefreshHelpers !== null) {
    __turbopack_context__.k.registerExports(__turbopack_context__.m, globalThis.$RefreshHelpers$);
}
}),
"[project]/dashboard/src/utils/chains.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "POLYGON_CHAIN_ID",
    ()=>POLYGON_CHAIN_ID,
    "SUPPORTED_CHAIN_IDS",
    ()=>SUPPORTED_CHAIN_IDS,
    "UNICHAIN_CHAIN_ID",
    ()=>UNICHAIN_CHAIN_ID,
    "UNICHAIN_SEPOLIA_CHAIN_ID",
    ()=>UNICHAIN_SEPOLIA_CHAIN_ID,
    "isPolygonChain",
    ()=>isPolygonChain,
    "isUnichainChain",
    ()=>isUnichainChain
]);
const POLYGON_CHAIN_ID = 137;
const UNICHAIN_CHAIN_ID = 130;
const UNICHAIN_SEPOLIA_CHAIN_ID = 1301;
const SUPPORTED_CHAIN_IDS = [
    POLYGON_CHAIN_ID,
    UNICHAIN_CHAIN_ID,
    UNICHAIN_SEPOLIA_CHAIN_ID
];
function isPolygonChain(chainId) {
    return chainId === POLYGON_CHAIN_ID;
}
function isUnichainChain(chainId) {
    return chainId === UNICHAIN_CHAIN_ID || chainId === UNICHAIN_SEPOLIA_CHAIN_ID;
}
if (typeof globalThis.$RefreshHelpers$ === 'object' && globalThis.$RefreshHelpers !== null) {
    __turbopack_context__.k.registerExports(__turbopack_context__.m, globalThis.$RefreshHelpers$);
}
}),
"[project]/dashboard/src/utils/format.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

/**
 * Formats a token balance or amount string dynamically based on the token's symbol
 * and size of the balance, ensuring tiny balances are visible rather than rounded to 0.
 * 
 * @param {string|number} value The raw number or string representation of the balance.
 * @param {string} symbol The token symbol (e.g. 'WBTC', 'USDC', 'WETH', 'POL').
 * @returns {string} The formatted balance string.
 */ __turbopack_context__.s([
    "formatTokenAmount",
    ()=>formatTokenAmount
]);
function formatTokenAmount(value, symbol = "") {
    if (value === undefined || value === null || value === "") return "...";
    const num = parseFloat(value);
    if (isNaN(num)) return "0.0";
    if (num === 0) return "0.0";
    const sym = symbol.toUpperCase();
    let decimals = 4; // default decimal places for formatting
    if (sym === "WBTC") {
        decimals = 8;
    } else if (sym === "WETH" || sym === "ETH") {
        decimals = 6;
    } else if (sym === "USDC" || sym === "DAI") {
        decimals = 2;
    } else if (sym === "WPOL" || sym === "POL") {
        decimals = 4;
    }
    // If the number is non-zero and smaller than 1, calculate needed decimals
    // to display at least 2 significant digits (capped at 8 decimals)
    if (num > 0 && num < 1) {
        let temp = num;
        let leadingZeroes = 0;
        while(temp < 1 && leadingZeroes < 8){
            temp *= 10;
            leadingZeroes++;
        }
        // Show at least 2 significant digits after leading zeroes
        const requiredDecimals = leadingZeroes + 1;
        decimals = Math.max(decimals, Math.min(requiredDecimals, 8));
    }
    let formatted = num.toFixed(decimals);
    // Trim trailing zeroes after the decimal point, but keep at least 2 decimals
    // (e.g., "1.230000" -> "1.23", "1.200000" -> "1.20")
    if (formatted.includes(".")) {
        while(formatted.endsWith("0") && formatted.split(".")[1].length > 2){
            formatted = formatted.slice(0, -1);
        }
    }
    return formatted;
}
if (typeof globalThis.$RefreshHelpers$ === 'object' && globalThis.$RefreshHelpers !== null) {
    __turbopack_context__.k.registerExports(__turbopack_context__.m, globalThis.$RefreshHelpers$);
}
}),
"[project]/dashboard/src/utils/formatContractError.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "formatContractError",
    ()=>formatContractError,
    "isUserCancellation",
    ()=>isUserCancellation
]);
function isUserCancellation(error) {
    if (!error) return false;
    // Handle nested error structure from some providers (e.g., MetaMask via ethers)
    const nestedError = error.info?.error;
    const errorCode = error.code || nestedError?.code;
    const errorMsg = (error.message || error.reason || nestedError?.message || error.toString()).toLowerCase();
    return errorCode === 'ACTION_REJECTED' || errorCode === 4001 || errorMsg.includes("user rejected action") || errorMsg.includes("user denied transaction signature") || errorMsg.includes("rejected by user") || errorMsg.includes("ethers-user-denied") || errorMsg.includes("user denied");
}
function formatContractError(error) {
    if (!error) return "Unknown Error";
    if (isUserCancellation(error)) {
        return "Operation was canceled by the user.";
    }
    const errorMsg = error.message || error.reason || error.toString();
    // Map of custom error names (from ABI) or text to readable messages
    const errorMap = {
        "LiquidityPool__NOT_ENOUGH_LIQUIDITY": "Not enough liquidity in the pool for this operation.",
        "PriceFeedL1__TOKEN_NOT_SUPPORTED": "This token is not supported by the price feed.",
        "PriceFeedL1__STALE_PRICE": "The price feed data is currently stale.",
        "PriceFeedL1__PRICE_TOO_OLD": "The price data is too old.",
        "PriceFeedL1__INVALID_PRICE": "The price feed returned an invalid price.",
        "PriceFeedL1__ANSWER_IN_ROUND_INVALID": "The price feed answer in round is invalid.",
        "LiquidityPoolFactory__POOL_ALREADY_EXIST": "A liquidity pool for this token already exists.",
        "LiquidityPoolFactory__POSITIONS_ALREADY_DEFINED": "Positions contract is already defined.",
        "Positions__POSITION_NOT_OPEN": "This position is not open.",
        "Positions__POSITION_NOT_LIQUIDABLE_YET": "This position cannot be liquidated yet.",
        "Positions__POSITION_NOT_OWNED": "You do not own this position.",
        "Positions__POOL_NOT_OFFICIAL": "The specified Uniswap V3 pool is not supported.",
        "Positions__TOKEN_NOT_SUPPORTED": "This token is not supported by the protocol.",
        "Positions__TOKEN_NOT_SUPPORTED_ON_MARGIN": "This token is not supported for margin trading.",
        "Positions__NO_PRICE_FEED": "No price feed available for the given token pair.",
        "Positions__LEVERAGE_NOT_IN_RANGE": "The specified leverage is out of the allowed range (min: 2x, max: 5x).",
        "Positions__AMOUNT_TO_SMALL": "The position size is too small; it must meet the minimum USD requirement.",
        "Positions__LIMIT_ORDER_PRICE_NOT_CONCISTENT": "Limit order price is inconsistent with the market.",
        "Positions__STOP_LOSS_ORDER_PRICE_NOT_CONCISTENT": "Stop loss price is inconsistent with the market.",
        "Positions__NOT_LIQUIDABLE": "This position is not eligible for liquidation.",
        "Positions__WAIT_FOR_LIMIT_ORDER_TO_COMPLET": "A limit order is already pending for this position.",
        "Positions__TOKEN_RECEIVED_NOT_CONCISTENT": "Inconsistent token amount received from swap.",
        "User denied transaction signature": "Transaction was cancelled by the user.",
        "insufficient funds for gas": "Insufficient native token balance to pay for gas.",
        "ERC20: transfer amount exceeds balance": "Insufficient token balance.",
        "ERC20: transfer amount exceeds allowance": "Insufficient token allowance." // Generic ERC20
    };
    // check if the error is a known custom error
    if (error.data && error.data.message) {
        for (const [key, msg] of Object.entries(errorMap)){
            if (error.data.message.includes(key)) {
                return msg;
            }
        }
    }
    // check if it's stringyfied in the message or reason
    for (const [key, msg] of Object.entries(errorMap)){
        if (errorMsg.includes(key)) {
            return msg;
        }
    }
    // Attempt to extract the custom error name if it's formatted like `ErrorName(...)`
    const customErrorMatch = errorMsg.match(/([a-zA-Z0-9_]+)\(/);
    if (customErrorMatch && customErrorMatch[1]) {
        const name = customErrorMatch[1];
        if (errorMap[name]) return errorMap[name];
        // If not in map, try to make the name readable
        // e.g. "LiquidityPool__NOT_ENOUGH_LIQUIDITY" -> "Not Enough Liquidity"
        const readableName = name.split('__').pop().split('_').map((word)=>word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(' ');
        return `Protocol Error: ${readableName}`;
    }
    // If it's a generic revert, ethers sometimes puts it in `reason`
    if (error.reason) {
        return error.reason;
    }
    if (error.code === 'CALL_EXCEPTION' && !error.reason && !error.data) {
        return "Transaction execution reverted. This commonly occurs if there's insufficient liquidity or if the token pair does not have an active Uniswap pool for the entered configuration.";
    }
    // Fallback: take the first line or a short snippet
    const shortErr = errorMsg.split('\n')[0];
    if (shortErr.length > 100) {
        return shortErr.substring(0, 100) + '...';
    }
    return shortErr;
}
if (typeof globalThis.$RefreshHelpers$ === 'object' && globalThis.$RefreshHelpers !== null) {
    __turbopack_context__.k.registerExports(__turbopack_context__.m, globalThis.$RefreshHelpers$);
}
}),
"[project]/dashboard/src/app/page.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "default",
    ()=>Home
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$src$2f$components$2f$ConnectButton$2e$jsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/src/components/ConnectButton.jsx [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$src$2f$components$2f$Balances$2e$jsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/src/components/Balances.jsx [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$src$2f$components$2f$TradeForm$2e$jsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/src/components/TradeForm.jsx [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$src$2f$components$2f$PositionsList$2e$jsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/src/components/PositionsList.jsx [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$src$2f$components$2f$AdminToggle$2e$jsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/src/components/AdminToggle.jsx [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$src$2f$components$2f$LiveChart$2e$jsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/src/components/LiveChart.jsx [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$src$2f$contexts$2f$AdminContext$2e$jsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/src/contexts/AdminContext.jsx [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$wagmi$2f$dist$2f$esm$2f$hooks$2f$useConnection$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__useConnection__as__useAccount$3e$__ = __turbopack_context__.i("[project]/dashboard/node_modules/wagmi/dist/esm/hooks/useConnection.js [app-client] (ecmascript) <export useConnection as useAccount>");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$client$2f$app$2d$dir$2f$link$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/next/dist/client/app-dir/link.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/next/dist/compiled/react/index.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/next/dist/compiled/react/jsx-runtime.js [app-client] (ecmascript)");
var _s = __turbopack_context__.k.signature();
'use client';
;
;
;
;
;
;
;
;
;
;
;
function Home() {
    _s();
    const { isAdmin } = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$src$2f$contexts$2f$AdminContext$2e$jsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useAdmin"])();
    const { chainId } = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$wagmi$2f$dist$2f$esm$2f$hooks$2f$useConnection$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__useConnection__as__useAccount$3e$__["useAccount"])();
    const [activeChartToken, setActiveChartToken] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"])("WETH");
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxs"])("main", {
        className: "min-h-screen p-6 text-white max-w-[1600px] mx-auto",
        children: [
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxs"])("header", {
                className: "flex justify-between items-center mb-8 glass-panel p-4",
                children: [
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxs"])("div", {
                        className: "flex items-center gap-3",
                        children: [
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsx"])("img", {
                                src: "/logo.png",
                                alt: "Eswap Logo",
                                className: "object-contain flex-shrink-0 rounded-full bg-white/5 border border-white/10 p-1",
                                style: {
                                    width: '40px',
                                    height: '40px'
                                }
                            }),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsx"])("h1", {
                                className: "text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-purple-400 to-cyan-400 tracking-wider",
                                children: "ESWAP"
                            })
                        ]
                    }),
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxs"])("div", {
                        className: "flex items-center gap-4",
                        children: [
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsx"])(__TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$src$2f$components$2f$AdminToggle$2e$jsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["AdminToggle"], {}),
                            isAdmin && /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsx"])(__TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$client$2f$app$2d$dir$2f$link$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["default"], {
                                href: "/admin",
                                className: "text-xs bg-white/5 hover:bg-white/10 px-3 py-1.5 rounded border border-white/10 text-gray-400 hover:text-white transition-all uppercase tracking-widest font-bold",
                                children: "Admin Panel"
                            }),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsx"])(__TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$client$2f$app$2d$dir$2f$link$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["default"], {
                                href: "/swap",
                                className: "text-xs bg-purple-500/10 hover:bg-purple-500/20 px-3 py-1.5 rounded border border-purple-500/20 text-purple-400 transition-all uppercase tracking-widest font-bold",
                                children: "Swap"
                            }),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsx"])(__TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$client$2f$app$2d$dir$2f$link$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["default"], {
                                href: "/pools",
                                className: "text-xs bg-green-500/10 hover:bg-green-500/20 px-3 py-1.5 rounded border border-green-500/20 text-green-400 transition-all uppercase tracking-widest font-bold",
                                children: "Earn (Pools)"
                            }),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsx"])(__TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$client$2f$app$2d$dir$2f$link$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["default"], {
                                href: "/adapter",
                                className: "text-xs bg-cyan-500/10 hover:bg-cyan-500/20 px-3 py-1.5 rounded border border-cyan-500/20 text-cyan-400 transition-all uppercase tracking-widest font-bold",
                                children: "Adapter"
                            }),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsx"])(__TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$client$2f$app$2d$dir$2f$link$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["default"], {
                                href: "/settlement",
                                className: "text-xs bg-emerald-500/10 hover:bg-emerald-500/20 px-3 py-1.5 rounded border border-emerald-500/20 text-emerald-400 transition-all uppercase tracking-widest font-bold",
                                children: "Settlement"
                            }),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsx"])(__TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$src$2f$components$2f$ConnectButton$2e$jsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["ConnectButton"], {})
                        ]
                    })
                ]
            }),
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxs"])("div", {
                className: "grid grid-cols-1 lg:grid-cols-3 gap-6 items-start",
                children: [
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxs"])("div", {
                        className: "lg:col-span-2 w-full space-y-6",
                        children: [
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsx"])(__TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$src$2f$components$2f$LiveChart$2e$jsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["LiveChart"], {
                                tokenKey: activeChartToken,
                                chainId: chainId,
                                onTokenChange: setActiveChartToken
                            }),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsx"])(__TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$src$2f$components$2f$PositionsList$2e$jsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["PositionsList"], {})
                        ]
                    }),
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxs"])("div", {
                        className: "space-y-6 w-full",
                        children: [
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsx"])(__TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$src$2f$components$2f$TradeForm$2e$jsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["TradeForm"], {
                                onTradingTokenChange: setActiveChartToken
                            }),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsx"])(__TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$src$2f$components$2f$Balances$2e$jsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["Balances"], {})
                        ]
                    })
                ]
            })
        ]
    });
}
_s(Home, "zzDZDq76e/BgAu8N9/26WVmenVc=", false, function() {
    return [
        __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$src$2f$contexts$2f$AdminContext$2e$jsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useAdmin"],
        __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$wagmi$2f$dist$2f$esm$2f$hooks$2f$useConnection$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__useConnection__as__useAccount$3e$__["useAccount"]
    ];
});
_c = Home;
var _c;
__turbopack_context__.k.register(_c, "Home");
if (typeof globalThis.$RefreshHelpers$ === 'object' && globalThis.$RefreshHelpers !== null) {
    __turbopack_context__.k.registerExports(__turbopack_context__.m, globalThis.$RefreshHelpers$);
}
}),
]);

//# sourceMappingURL=dashboard_src_5e4bd9b1._.js.map