/**
 * Minimal ABIs mirrored from the Eswap v4 stack
 * (`src/v4/EswapRouter.sol`, `src/v4/EswapMarginHook.sol` in the protocol
 * monorepo). kept intentionally small: only the surfaces agents need.
 */
import type { Abi } from "viem";

/** (currency0, currency1, fee, tickSpacing, hooks) */
const POOL_KEY_COMPONENTS = [
  { name: "currency0", type: "address" },
  { name: "currency1", type: "address" },
  { name: "fee", type: "uint24" },
  { name: "tickSpacing", type: "int24" },
  { name: "hooks", type: "address" },
] as const;

/** Bytecode-shaped ERC20 surface (safe on USDC proxy + native-origin WETH/WBTC). */
export const ERC20_ABI = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "allowance",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "approve",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "value", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
] as const satisfies Abi;

/** EswapRouter (Base mainnet) — trader-facing margin surfaces. */
export const ESWAP_ROUTER_ABI = [
  {
    name: "quoteExactInput",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "key", type: "tuple", components: POOL_KEY_COMPONENTS },
      { name: "zeroForOne", type: "bool" },
      { name: "amountSpecified", type: "int128" },
      { name: "leverage", type: "uint8" },
    ],
    outputs: [{ name: "amountOut", type: "int128" }],
  },
  {
    name: "swapMultiPool",
    type: "function",
    stateMutability: "payable",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "key", type: "tuple", components: POOL_KEY_COMPONENTS },
          { name: "standardPoolKey", type: "tuple", components: POOL_KEY_COMPONENTS },
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
    outputs: [{ type: "bytes" }],
  },
  {
    name: "erc20BorrowEscrow",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "solver", type: "address" },
      { name: "token", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "depositBorrowEscrow",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
] as const satisfies Abi;

/** EswapMarginHook (Base mainnet) — read-only preview surfaces. */
export const ESWAP_HOOK_ABI = [
  {
    name: "quoteOpenFit",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "key", type: "tuple", components: POOL_KEY_COMPONENTS },
      { name: "trader", type: "address" },
      { name: "inputCurrency", type: "address" },
      { name: "leverage", type: "uint8" },
      { name: "marginAmount", type: "uint256" },
      { name: "borrowedAmount", type: "uint256" },
    ],
    outputs: [
      { name: "fits", type: "bool" },
      { name: "reason", type: "string" },
    ],
  },
  {
    name: "openInterestCapacity",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "capsActive", type: "bool" },
      { name: "poolTvlUsd", type: "uint256" },
      { name: "totalOiUsd", type: "uint256" },
      { name: "maxSingleTradeUsd", type: "uint256" },
      { name: "remainingOiUsd", type: "uint256" },
    ],
  },
  {
    name: "standardPoolKeys",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "poolId", type: "bytes32" }],
    outputs: [
      { name: "currency0", type: "address" },
      { name: "currency1", type: "address" },
      { name: "fee", type: "uint24" },
      { name: "tickSpacing", type: "int24" },
      { name: "hooks", type: "address" },
    ],
  },
] as const satisfies Abi;
