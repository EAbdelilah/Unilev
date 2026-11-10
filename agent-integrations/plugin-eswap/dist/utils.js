/**
 * Eswap math, encoding and formatting utils for the ElizaOS plugin.
 * Mirrors `@eswap/agentkit-action-provider` so both integrations behave
 * identically (duplicated intentionally to keep each package standalone).
 */
import { encodeAbiParameters, encodeFunctionData, formatUnits, keccak256, parseUnits, } from "viem";
import { ESWAP_ROUTER_ABI } from "./abis.js";
import { CARRY_BENCHMARK_APR_BPS, CARRY_BENCHMARK_DAYS, PROTOCOL_FEE_BPS, DEFAULT_TX_DEADLINE_SECONDS, hookPoolKey, standardPoolKey, } from "./constants.js";
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
/** 7-day carry drag a 12%-APR venue would charge on the borrowed leg (illustrative). */
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
function poolKeyToComponents(key) {
    return { currency0: key[0], currency1: key[1], fee: key[2], tickSpacing: key[3], hooks: key[4] };
}
/**
 * Builds `router.swapMultiPool(params)` calldata — identical parameter shape to
 * the agentkit provider (see its docstring for the full rationale).
 */
export function buildOpenMarginCalldata(deployment, args, slippageToleranceBps, minAmountOutRaw, standardKeyOverride) {
    const deadline = Math.floor(Date.now() / 1000) + DEFAULT_TX_DEADLINE_SECONDS;
    const key = hookPoolKey(args.pair, deployment.hook);
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
                deadline: BigInt(deadline),
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
/** Encoded `depositBorrowEscrow(token, amount)` calldata. */
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
/** BaseScan transaction link. */
export function txExplorerUrl(txHash) {
    return `https://basescan.org/tx/${txHash}`;
}
