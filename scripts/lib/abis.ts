import { parseAbi } from "viem";

/** @dev Order struct components — mirrors CowOrder.Data field order (byte-exact). */
const orderComponents = [
    { name: "sellToken", type: "address" },
    { name: "buyToken", type: "address" },
    { name: "receiver", type: "address" },
    { name: "sellAmount", type: "uint256" },
    { name: "buyAmount", type: "uint256" },
    { name: "validTo", type: "uint32" },
    { name: "appData", type: "bytes32" },
    { name: "feeAmount", type: "uint256" },
    { name: "kind", type: "bytes32" },
    { name: "partiallyFillable", type: "bool" },
    { name: "sellTokenBalance", type: "bytes32" },
    { name: "buyTokenBalance", type: "bytes32" },
] as const;

/** @dev Mirrors src/v4/types/PoolKey.sol (Currency flattens to address). */
export const poolKeyComponents = [
    { name: "currency0", type: "address" },
    { name: "currency1", type: "address" },
    { name: "fee", type: "uint24" },
    { name: "tickSpacing", type: "int24" },
    { name: "hooks", type: "address" },
] as const;

/** @dev Mirrors EswapCoWSettlement.FillParams. */
export const fillParamsComponents = [
    { name: "leverage", type: "uint8" },
    { name: "solver", type: "address" },
    { name: "key", type: "tuple", components: poolKeyComponents },
    { name: "standardPoolKey", type: "tuple", components: poolKeyComponents },
] as const;

export const cowSettlementAbi = [
    {
        type: "function",
        name: "fillOrder",
        stateMutability: "nonpayable",
        inputs: [
            { name: "order", type: "tuple", components: orderComponents },
            { name: "scheme", type: "uint8" },
            { name: "signature", type: "bytes" },
            { name: "params", type: "tuple", components: fillParamsComponents },
        ],
        outputs: [{ name: "owner", type: "address" }],
    },
    {
        type: "function",
        name: "fillOrders",
        stateMutability: "nonpayable",
        inputs: [
            { name: "orders", type: "tuple[]", components: orderComponents },
            { name: "schemes", type: "uint8[]" },
            { name: "signatures", type: "bytes[]" },
            { name: "paramsList", type: "tuple[]", components: fillParamsComponents },
        ],
        outputs: [{ name: "count", type: "uint256" }],
    },
    {
        type: "function",
        name: "verify",
        stateMutability: "view",
        inputs: [
            { name: "order", type: "tuple", components: orderComponents },
            { name: "scheme", type: "uint8" },
            { name: "signature", type: "bytes" },
        ],
        outputs: [
            { name: "owner", type: "address" },
            { name: "orderDigest", type: "bytes32" },
            { name: "orderUid", type: "bytes" },
        ],
    },
] as const;

/** EswapMarginHook view surface used by the dashboard. */
/** EswapMarginHook view surface used by the dashboard. */
export const marginHookAbi = [
    {
        type: "function",
        name: "maxLeverageByPool",
        inputs: [
            {"name":"","type":"bytes32"},
        ],
        outputs: [
            {"name":"","type":"uint8"},
        ],
        stateMutability: "view",
    },
    {
        type: "function",
        name: "maxTotalOIBps",
        outputs: [
            {"name":"","type":"uint256"},
        ],
        stateMutability: "view",
    },
    {
        type: "function",
        name: "openInterestCapacity",
        outputs: [
            {"name":"capsActive","type":"bool"},
            {"name":"poolTvlUsd","type":"uint256"},
            {"name":"totalOiUsd","type":"uint256"},
            {"name":"maxSingleTradeUsd","type":"uint256"},
            {"name":"remainingOiUsd","type":"uint256"},
        ],
        stateMutability: "view",
    },
    {
        type: "function",
        name: "positions",
        inputs: [
            {"name":"","type":"bytes32"},
            {"name":"","type":"address"},
        ],
        outputs: [
            {"name":"trader","type":"address"},
            {"name":"collateralAmount","type":"uint256"},
            {"name":"borrowedAmount","type":"uint256"},
            {"name":"leverage","type":"uint8"},
            {"name":"isLong","type":"bool"},
            {"name":"liquidationSqrtPrice","type":"uint160"},
            {"name":"tickLower","type":"int24"},
            {"name":"tickUpper","type":"int24"},
            {"name":"liquidity","type":"uint128"},
        ],
        stateMutability: "view",
    },
    {
        type: "function",
        name: "quoteOpenFit",
        inputs: [
            {"name":"key","components":"poolKeyComponents","type":"tuple"},
            {"name":"trader","type":"address"},
            {"name":"inputCurrency","type":"address"},
            {"name":"leverage","type":"uint8"},
            {"name":"marginAmount","type":"uint256"},
            {"name":"borrowedAmount","type":"uint256"},
        ],
        outputs: [
            {"name":"fits","type":"bool"},
            {"name":"reason","type":"string"},
        ],
        stateMutability: "view",
    },
    {
        type: "function",
        name: "solverDebts",
        inputs: [
            {"name":"","type":"bytes32"},
            {"name":"","type":"address"},
            {"name":"","type":"address"},
        ],
        outputs: [
            {"name":"solver","type":"address"},
            {"name":"principal","type":"uint256"},
            {"name":"accumulatedYield","type":"uint256"},
        ],
        stateMutability: "view",
    },
    {
        type: "function",
        name: "totalOpenInterestUSD",
        outputs: [
            {"name":"","type":"uint256"},
        ],
        stateMutability: "view",
    },
] as const;

export const quoterAbi = [
    {
        type: "function",
        name: "quoteExactInputSingleWithLeverage",
        stateMutability: "view",
        inputs: [
            { name: "tokenIn", type: "address" },
            { name: "tokenOut", type: "address" },
            { name: "fee", type: "uint24" },
            { name: "leverage", type: "uint8" },
            { name: "amountIn", type: "int256" },
        ],
        outputs: [{ name: "amountOut", type: "int128" }],
    },
    {
        type: "function",
        name: "getPoolKey",
        stateMutability: "view",
        inputs: [
            { name: "tokenIn", type: "address" },
            { name: "tokenOut", type: "address" },
            { name: "fee", type: "uint24" },
        ],
        outputs: [
            { name: "hookPoolKey", type: "tuple", components: poolKeyComponents },
            { name: "standardPoolKey", type: "tuple", components: poolKeyComponents },
        ],
    },
    {
        type: "function",
        name: "registerPool",
        stateMutability: "nonpayable",
        inputs: [
            { name: "tokenIn", type: "address" },
            { name: "tokenOut", type: "address" },
            { name: "fee", type: "uint24" },
            { name: "key", type: "tuple", components: poolKeyComponents },
            { name: "standardPoolKey", type: "tuple", components: poolKeyComponents },
        ],
        outputs: [],
    },
] as const;

/** ERC-7683 destination settler (EswapSettlement.fill) + ERC-20 surface for the relayer. */
export const settlementAbi = parseAbi([
    "function fill(bytes32,bytes,bytes)",
    "function filledOrders(bytes32) view returns (bool)",
]);

export const erc20Abi = parseAbi([
    "function approve(address,uint256) returns (bool)",
    "function balanceOf(address) view returns (uint256)",
    "function allowance(address,address) view returns (uint256)",
]);

/**
 * ERC-7683 `CrossChainOrder` event as emitted by origin settlement contracts
 * (`originSettler`): `CrossChainOrder(uint64 error, bytes32 from, bytes32 to,
 * address originSettler, bytes originData, uint32 originChainId, uint32
 * destChainId, uint64 expiry, uint160 nonce)`.
 */
export const crossChainOrderEvent = {
    type: "event",
    name: "CrossChainOrder",
    inputs: [
        { name: "error", type: "uint64", indexed: false },
        { name: "from", type: "bytes32", indexed: false },
        { name: "to", type: "bytes32", indexed: false },
        { name: "originSettler", type: "address", indexed: true },
        { name: "originData", type: "bytes", indexed: false },
        { name: "originChainId", type: "uint32", indexed: false },
        { name: "destChainId", type: "uint32", indexed: false },
        { name: "expiry", type: "uint64", indexed: false },
        { name: "nonce", type: "uint160", indexed: false },
    ],
} as const;

/** EswapLeverageAdapter event used by the bridge for observability. */
export const leverageAdapterAbi = parseAbi([
    "event LeveragedSwapRouted(address indexed tokenIn,address indexed tokenOut,uint24 fee,uint8 leverage,uint256 amountIn,uint256 amountOut)",
    "function exactInputSingleWithLeverage(address,address,uint24,uint8,uint256,uint256,address) returns (uint256)",
]);