/**
 * Eswap math, encoding and formatting utilities.
 *
 * Decimal policy (explicit, per integration standard):
 *   USDC — 6 decimals, WETH — 18 decimals, WBTC — 8 decimals.
 * All raw on-chain amounts are handled as `bigint`; human amounts only exist
 * as strings at the service boundary (schemas) and in formatted output.
 */
import { type Address, type Hex } from "viem";
import { type EswapDeployment, type EswapPairConfig, type PoolKeyTuple } from "./constants.js";
import type { OpenSpotMarginArgs } from "./schemas.js";
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
    /** Full leveraged notional = margin × leverage. */
    readonly notional: bigint;
    /** Borrow leg funded by the solver/escrow = notional − margin. */
    readonly borrowed: bigint;
}
export declare function marginParts(marginRaw: bigint, leverage: number): MarginParts;
/** Flat 0.10% protocol fee on the leveraged notional (raw USDC). */
export declare function protocolFeeRaw(notionalRaw: bigint): bigint;
/**
 * Estimated interest drag the SAME borrowed capital would incur over `days`
 * on a 12%-APR continuous-borrow venue (Aave/Perp style benchmark).
 * Eswap charges 0.00% daily carry, so this figure is what a trader SAVES per
 * hold period. Calendar-day estimate, raw USDC output; APR benchmark is a
 * configurable comparison constant, not an Eswap charge.
 */
export declare function carryDragBenchmarkRaw(borrowedRaw: bigint, days?: bigint, aprBps?: bigint): bigint;
/** Applies a slippage tolerance (bps) to an expected output amount. */
export declare function minAmountOutOf(expectedOutRaw: bigint, slippageToleranceBps: number): bigint;
/** PoolId = keccak256(abi.encode(currency0, currency1, fee, tickSpacing, hooks)). */
export declare function poolIdOf(key: PoolKeyTuple): Hex;
export interface OpenMarginArgsResolved {
    readonly pair: EswapPairConfig;
    readonly leverage: number;
    /** Raw USDC margin (6 decimals). */
    readonly marginRaw: bigint;
    readonly slippageToleranceBps: number;
    readonly trader: Address;
}
/**
 * Builds `router.swapMultiPool(params)` calldata reusing the exact parameter
 * arrangement proven by the live Base open scripts:
 *
 *   key             = hook (margin/accounting) pool: fee 3000, tickSpacing 60
 *   standardPoolKey = deep-fill execution venue (default 500 / 10, no hooks)
 *   zeroForOne      = false for both pairs (USDC=currency1 -> base=currency0)
 *   amountSpecified = -margin (negative exact-input; the hook's beforeSwap
 *                     flash-expands it to margin × leverage via EIP-1153
 *                     transient storage)
 *   solver          = trader itself (self-bonded: margin + borrow escrow are
 *                     both owned by the SAME EOA, no solver allowlist needed)
 *   hookData        = "0x" (router injects defaults: abi.encode(true, leverage, trader))
 *   deadline        = now + seconds (matches router DEFAULT_DEADLINE_SLACK usage)
 *   minAmountOut    = quote × (1 − slippageBps/1e4) — on-chain slippage guard
 */
export declare function buildOpenMarginCalldata(deployment: Pick<EswapDeployment, "hook" | "router">, args: OpenMarginArgsResolved, deadlineSeconds: number, minAmountOutRaw: bigint, standardKeyOverride?: PoolKeyTuple): Hex;
/** Encoded approve(spender, value) calldata. */
export declare function buildApproveCalldata(token: Address, spender: Address, value: bigint): Hex;
/** Encoded `depositBorrowEscrow(token, amount)` calldata (bonding the borrow leg from the agent's own funds). */
export declare function buildDepositBorrowEscrowCalldata(token: Address, amountRaw: bigint): Hex;
/** Default deep-fill key from the pair config (fallback when the hook read is unavailable). */
export declare function defaultStandardPoolKey(pair: EswapPairConfig): PoolKeyTuple;
/** Resolves the deployment honoring env overrides — one stop for both actions. */
export declare function resolveDeployment(): EswapDeployment;
/** BaseScan transaction link. */
export declare function txExplorerUrl(txHash: string): string;
/** Type re-export so actions can annotate args without importing a private schema module. */
export type { OpenSpotMarginArgs };
//# sourceMappingURL=utils.d.ts.map