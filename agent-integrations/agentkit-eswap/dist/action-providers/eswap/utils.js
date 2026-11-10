/**
 * Eswap math, encoding and formatting utilities.
 *
 * Decimal policy (explicit, per integration standard):
 *   USDC — 6 decimals, WETH — 18 decimals, WBTC — 8 decimals.
 * All raw on-chain amounts are handled as `bigint`; human amounts only exist
 * as strings at the service boundary (schemas) and in formatted output.
 */
import { encodeAbiParameters, encodeFunctionData, formatUnits, keccak256, parseUnits, } from "viem";
import { ESWAP_ROUTER_ABI } from "./abis.js";
import { CARRY_BENCHMARK_APR_BPS, CARRY_BENCHMARK_DAYS, PROTOCOL_FEE_BPS, resolveEswapDeployment, standardPoolKey, } from "./constants.js";
export class EswapInputError extends Error {
    constructor(message, options) {
        super(message, options);
        this.name = "EswapInputError";
    }
}
/** Parses a human-readable decimal amount (e.g. `"100.5"`) into raw units. */
export function parseRawAmount(amount, decimals) {
    const trimmed = amount.trim();
    if (!/^\d+(\.\d+)?$/.test(trimmed)) {
        throw new EswapInputError(`Invalid amount "${amount}": expected a positive decimal like "100.5"`);
    }
    let raw;
    try {
        raw = parseUnits(trimmed, decimals);
    }
    catch (cause) {
        throw new EswapInputError(`Invalid amount "${amount}" for ${decimals} decimals`, { cause });
    }
    if (raw === 0n) {
        throw new EswapInputError("Amount must be greater than zero");
    }
    return raw;
}
/** Formats raw units back into a trimmed human-readable decimal string. */
export function formatRawAmount(raw, decimals) {
    const formatted = formatUnits(raw, decimals);
    return formatted.includes(".")
        ? formatted.replace(/0+$/, "").replace(/\.$/, "")
        : formatted;
}
export function marginParts(marginRaw, leverage) {
    if (leverage < 1) {
        throw new EswapInputError(`Leverage must be >= 1, got ${leverage}`);
    }
    const notional = marginRaw * BigInt(leverage);
    return { notional, borrowed: notional - marginRaw };
}
/** Flat 0.10% protocol fee on the leveraged notional (raw USDC). */
export function protocolFeeRaw(notionalRaw) {
    return (notionalRaw * PROTOCOL_FEE_BPS) / 10000n;
}
/**
 * Estimated interest drag the SAME borrowed capital would incur over `days`
 * on a 12%-APR continuous-borrow venue (Aave/Perp style benchmark).
 * Eswap charges 0.00% daily carry, so this figure is what a trader SAVES per
 * hold period. Calendar-day estimate, raw USDC output; APR benchmark is a
 * configurable comparison constant, not an Eswap charge.
 */
export function carryDragBenchmarkRaw(borrowedRaw, days = CARRY_BENCHMARK_DAYS, aprBps = CARRY_BENCHMARK_APR_BPS) {
    return (borrowedRaw * aprBps * days) / (365n * 10000n);
}
/** Applies a slippage tolerance (bps) to an expected output amount. */
export function minAmountOutOf(expectedOutRaw, slippageToleranceBps) {
    if (!Number.isInteger(slippageToleranceBps) || slippageToleranceBps < 0 || slippageToleranceBps > 3_000) {
        throw new EswapInputError(`slippageToleranceBps must be an integer in [0, 3000], got ${String(slippageToleranceBps)}`);
    }
    return (expectedOutRaw * BigInt(10_000 - slippageToleranceBps)) / 10000n;
}
/** PoolId = keccak256(abi.encode(currency0, currency1, fee, tickSpacing, hooks)). */
export function poolIdOf(key) {
    return keccak256(encodeAbiParameters([{ type: "address" }, { type: "address" }, { type: "uint24" }, { type: "int24" }, { type: "address" }], [key[0], key[1], key[2], key[3], key[4]]));
}
/** viem tuple objects must map component names, not positional arrays. */
function poolKeyToComponents(key) {
    return { currency0: key[0], currency1: key[1], fee: key[2], tickSpacing: key[3], hooks: key[4] };
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
export function buildOpenMarginCalldata(deployment, args, deadlineSeconds, minAmountOutRaw, standardKeyOverride) {
    const key = [args.pair.base, args.pair.quote, args.pair.hookPoolFee, args.pair.hookPoolTickSpacing, deployment.hook];
    const standardKey = standardKeyOverride ?? standardPoolKey(args.pair);
    return encodeFunctionData({
        abi: ESWAP_ROUTER_ABI,
        functionName: "swapMultiPool",
        args: [
            {
                key: poolKeyToComponents(key),
                standardPoolKey: poolKeyToComponents(standardKey),
                zeroForOne: args.pair.longZeroForOne,
                amountSpecified: -(args.marginRaw),
                leverage: args.leverage,
                solver: args.trader,
                hookData: "0x",
                deadline: BigInt(Math.max(1, Math.floor(deadlineSeconds))),
                minAmountOut: minAmountOutRaw,
            },
        ],
    });
}
/** Encoded approve(spender, value) calldata. */
export function buildApproveCalldata(token, spender, value) {
    return encodeFunctionData({
        abi: [
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
        ],
        functionName: "approve",
        args: [spender, value],
    });
}
/** Encoded `depositBorrowEscrow(token, amount)` calldata (bonding the borrow leg from the agent's own funds). */
export function buildDepositBorrowEscrowCalldata(token, amountRaw) {
    return encodeFunctionData({
        abi: [
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
        ],
        functionName: "depositBorrowEscrow",
        args: [token, amountRaw],
    });
}
/** Default deep-fill key from the pair config (fallback when the hook read is unavailable). */
export function defaultStandardPoolKey(pair) {
    return standardPoolKey(pair);
}
/** Resolves the deployment honoring env overrides — one stop for both actions. */
export function resolveDeployment() {
    return resolveEswapDeployment();
}
/** BaseScan transaction link. */
export function txExplorerUrl(txHash) {
    return `https://basescan.org/tx/${txHash}`;
}
