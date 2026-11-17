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
