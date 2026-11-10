/**
 * Eswap math, encoding and formatting utils for the ElizaOS plugin.
 * Mirrors `@eswap/agentkit-action-provider` so both integrations behave
 * identically (duplicated intentionally to keep each package standalone).
 */
import { type Address, type Hex } from "viem";
import { type EswapDeployment, type EswapPairConfig, type PoolKeyTuple } from "./constants.js";
export interface MarginArgs {
    readonly pair: EswapPairConfig;
    readonly leverage: number;
    /** Raw USDC margin (6 decimals). */
    readonly marginRaw: bigint;
    readonly trader: Address;
}
export declare class EswapInputError extends Error {
    constructor(message: string, options?: {
        cause?: unknown;
    });
}
/** Parses a human-readable decimal amount (e.g. `"100.5"`) into raw units. */
export declare function parseRawAmount(amount: string, decimals: number): bigint;
/** Formats raw units back into a trimmed human-readable decimal string. */
export declare function formatRawAmount(raw: bigint, decimals: number): string;
export interface MarginParts {
    readonly notional: bigint;
    readonly borrowed: bigint;
}
export declare function marginParts(marginRaw: bigint, leverage: number): MarginParts;
/** Flat 0.10% protocol fee on the leveraged notional (raw USDC). */
export declare function protocolFeeRaw(notionalRaw: bigint): bigint;
/** 7-day carry drag a 12%-APR venue would charge on the borrowed leg (illustrative). */
export declare function carryDragBenchmarkRaw(borrowedRaw: bigint, days?: bigint, aprBps?: bigint): bigint;
/** Applies a slippage tolerance (bps) to an expected output amount. */
export declare function minAmountOutOf(expectedOutRaw: bigint, slippageToleranceBps: number): bigint;
/** PoolId = keccak256(abi.encode(currency0, currency1, fee, tickSpacing, hooks)). */
export declare function poolIdOf(key: PoolKeyTuple): Hex;
/**
 * Builds `router.swapMultiPool(params)` calldata — identical parameter shape to
 * the agentkit provider (see its docstring for the full rationale).
 */
export declare function buildOpenMarginCalldata(deployment: EswapDeployment, args: MarginArgs, slippageToleranceBps: number, minAmountOutRaw: bigint, standardKeyOverride?: PoolKeyTuple): Hex;
/** Encoded approve(spender, value) calldata. */
export declare function buildApproveCalldata(token: Address, spender: Address, value: bigint): Hex;
/** Encoded `depositBorrowEscrow(token, amount)` calldata. */
export declare function buildDepositBorrowEscrowCalldata(token: Address, amountRaw: bigint): Hex;
/** BaseScan transaction link. */
export declare function txExplorerUrl(txHash: string): string;
//# sourceMappingURL=utils.d.ts.map