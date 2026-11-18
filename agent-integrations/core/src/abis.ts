/** Minimal ABIs used by the viem execution core (no generated artifacts needed). */

export const POOL_KEY_COMPONENTS = [
    { name: "currency0", type: "address" },
    { name: "currency1", type: "address" },
    { name: "fee", type: "uint24" },
    { name: "tickSpacing", type: "int24" },
    { name: "hooks", type: "address" },
] as const;

export const ERC20_ABI = [
    {
        type: "function",
        name: "allowance",
        stateMutability: "view",
        inputs: [
            { name: "owner", type: "address" },
            { name: "spender", type: "address" },
        ],
        outputs: [{ name: "", type: "uint256" }],
    },
    {
        type: "function",
        name: "approve",
        stateMutability: "nonpayable",
        inputs: [
            { name: "spender", type: "address" },
            { name: "amount", type: "uint256" },
        ],
        outputs: [{ name: "", type: "bool" }],
    },
    {
        type: "function",
        name: "balanceOf",
        stateMutability: "view",
        inputs: [{ name: "account", type: "address" }],
        outputs: [{ name: "", type: "uint256" }],
    },
    {
        type: "function",
        name: "decimals",
        stateMutability: "view",
        inputs: [],
        outputs: [{ name: "", type: "uint8" }],
    },
] as const;

export const ROUTER_ABI = [
    {
        type: "function",
        name: "quoteExactInput",
        stateMutability: "view",
        inputs: [
            { name: "key", type: "tuple", components: [...POOL_KEY_COMPONENTS] },
            { name: "zeroForOne", type: "bool" },
            { name: "amountSpecified", type: "int128" },
            { name: "leverage", type: "uint8" },
        ],
        outputs: [{ name: "amountOut", type: "int128" }],
    },
    {
        type: "function",
        name: "swapMultiPool",
        stateMutability: "payable",
        inputs: [
            {
                name: "params",
                type: "tuple",
                components: [
                    { name: "key", type: "tuple", components: [...POOL_KEY_COMPONENTS] },
                    { name: "standardPoolKey", type: "tuple", components: [...POOL_KEY_COMPONENTS] },
                    { name: "zeroForOne", type: "bool" },
                    { name: "amountSpecified", type: "int256" },
                    { name: "leverage", type: "uint8" },
                    { name: "solver", type: "address" },
                    { name: "hookData", type: "bytes" },
                    { name: "deadline", type: "uint256" },
                    { name: "minAmountOut", type: "uint256" },
                ],
            },
        ],
        outputs: [{ name: "", type: "bytes" }],
    },
    {
        type: "function",
        name: "depositBorrowEscrow",
        stateMutability: "nonpayable",
        inputs: [
            { name: "token", type: "address" },
            { name: "amount", type: "uint256" },
        ],
        outputs: [],
    },
    {
        type: "function",
        name: "erc20BorrowEscrow",
        stateMutability: "view",
        inputs: [
            { name: "solver", type: "address" },
            { name: "token", type: "address" },
        ],
        outputs: [{ name: "", type: "uint256" }],
    },
    {
        type: "function",
        name: "rebalance",
        stateMutability: "nonpayable",
        inputs: [
            { name: "hook", type: "address" },
            { name: "key", type: "tuple", components: [...POOL_KEY_COMPONENTS] },
            { name: "trader", type: "address" },
        ],
        outputs: [],
    },
    {
        type: "function",
        name: "closePosition",
        stateMutability: "nonpayable",
        inputs: [
            { name: "hook", type: "address" },
            { name: "key", type: "tuple", components: [...POOL_KEY_COMPONENTS] },
            { name: "trader", type: "address" },
            { name: "solver", type: "address" },
            { name: "minAmountOut", type: "uint256" },
        ],
        outputs: [],
    },
    {
        type: "function",
        name: "liquidate",
        stateMutability: "nonpayable",
        inputs: [
            { name: "hook", type: "address" },
            { name: "key", type: "tuple", components: [...POOL_KEY_COMPONENTS] },
            { name: "trader", type: "address" },
            { name: "minAmountOut", type: "uint256" },
        ],
        outputs: [],
    },
] as const;

export const QUOTER_ABI = [
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
] as const;

export const HOOK_ABI = [
    {
        type: "function",
        name: "reserveFactor",
        stateMutability: "view",
        inputs: [],
        outputs: [{ name: "", type: "uint256" }],
    },
    {
        type: "function",
        name: "treasury",
        stateMutability: "view",
        inputs: [],
        outputs: [{ name: "", type: "address" }],
    },
    {
        type: "function",
        name: "protocolFees",
        stateMutability: "view",
        inputs: [{ name: "", type: "address" }],
        outputs: [{ name: "", type: "uint256" }],
    },
] as const;

/** Minimal Uniswap v4 PoolManager read surface for slot0 price observation. */
export const POOL_MANAGER_ABI = [
    {
        type: "function",
        name: "slot0",
        stateMutability: "view",
        inputs: [{ name: "id", type: "bytes32" }],
        outputs: [
            { name: "sqrtPriceX96", type: "uint160" },
            { name: "tick", type: "int24" },
            { name: "protocolFee", type: "uint24" },
            { name: "lpFee", type: "uint24" },
        ],
    },
] as const;

/** Read surface used by Gelato/Chainlink keepers to check position existence. */
export const HOOK_POSITIONS_ABI = [
    {
        type: "function",
        name: "positions",
        stateMutability: "view",
        inputs: [
            { name: "poolId", type: "bytes32" },
            { name: "trader", type: "address" },
        ],
        outputs: [
            { name: "trader_", type: "address" },
            { name: "collateralAmount", type: "uint256" },
            { name: "borrowedAmount", type: "uint256" },
            { name: "leverage", type: "uint8" },
            { name: "isLong", type: "bool" },
            { name: "liquidationSqrtPrice", type: "uint160" },
            { name: "tickLower", type: "int24" },
            { name: "tickUpper", type: "int24" },
            { name: "liquidity", type: "uint128" },
        ],
    },
] as const;

/** Chainlink-anchored 18-decimal USD price surface used by trigger orders. */
export const PRICE_FEED_ABI = [
    {
        type: "function",
        name: "getAmountInUsd",
        stateMutability: "view",
        inputs: [
            { name: "token", type: "address" },
            { name: "amount", type: "uint256" },
        ],
        outputs: [{ name: "", type: "uint256" }],
    },
    {
        type: "function",
        name: "getTwapPrice",
        stateMutability: "view",
        inputs: [{ name: "token", type: "address" }],
        outputs: [{ name: "", type: "uint256" }],
    },
] as const;

/** EIP-712 signed conditional-close surface on EswapRouterExt. */
export const TRIGGER_ORDER_COMPONENTS = [
    { name: "poolId", type: "bytes32" },
    { name: "triggerPrice18", type: "uint256" },
    { name: "aboveOrBelow", type: "bool" },
    { name: "minAmountOut", type: "uint256" },
    { name: "closeDeadline", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "executorTipBps", type: "uint8" },
] as const;

export const ROUTER_EXT_ABI = [
    {
        type: "function",
        name: "armTriggerOrder",
        stateMutability: "nonpayable",
        inputs: [
            { name: "key", type: "tuple", components: [...POOL_KEY_COMPONENTS] },
            {
                name: "order",
                type: "tuple",
                components: [...TRIGGER_ORDER_COMPONENTS],
            },
            { name: "signature", type: "bytes" },
        ],
        outputs: [],
    },
    {
        type: "function",
        name: "executeTriggerOrder",
        stateMutability: "nonpayable",
        inputs: [
            { name: "hook", type: "address" },
            { name: "key", type: "tuple", components: [...POOL_KEY_COMPONENTS] },
            { name: "trader", type: "address" },
        ],
        outputs: [],
    },
    {
        type: "function",
        name: "cancelTriggerOrder",
        stateMutability: "nonpayable",
        inputs: [
            { name: "trader", type: "address" },
            { name: "key", type: "tuple", components: [...POOL_KEY_COMPONENTS] },
        ],
        outputs: [],
    },
    {
        type: "function",
        name: "armedTriggerOrders",
        stateMutability: "view",
        inputs: [
            { name: "", type: "address" },
            { name: "", type: "bytes32" },
        ],
        outputs: [
            { name: "poolId", type: "bytes32" },
            { name: "triggerPrice18", type: "uint256" },
            { name: "aboveOrBelow", type: "bool" },
            { name: "minAmountOut", type: "uint256" },
            { name: "closeDeadline", type: "uint256" },
            { name: "nonce", type: "uint256" },
            { name: "executorTipBps", type: "uint8" },
        ],
    },
    {
        type: "function",
        name: "executedTriggerOrders",
        stateMutability: "view",
        inputs: [{ name: "", type: "bytes32" }],
        outputs: [{ name: "", type: "bool" }],
    },
] as const;

/** ERC-7683 destination settler. `originData` is ABI-encoded SwapParams. */
export const SETTLEMENT_ABI = [
    {
        type: "function",
        name: "fill",
        stateMutability: "payable",
        inputs: [
            { name: "orderId", type: "bytes32" },
            { name: "originData", type: "bytes" },
            { name: "fillerData", type: "bytes" },
        ],
        outputs: [],
    },
    {
        type: "function",
        name: "filledOrders",
        stateMutability: "view",
        inputs: [{ name: "", type: "bytes32" }],
        outputs: [{ name: "", type: "bool" }],
    },
] as const;
