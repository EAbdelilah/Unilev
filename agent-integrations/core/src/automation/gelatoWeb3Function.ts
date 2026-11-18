import type { Address, Hex } from "viem";
import {
    ESWAP_CONTRACTS,
    TRIGGER_ORDER_DOMAIN,
    getPairConfig,
    type SupportedPair,
} from "../constants.js";
import { POOL_MANAGER_ABI, PRICE_FEED_ABI } from "../abis.js";
import {
    encodeArmTriggerOrder,
    encodeClosePosition,
    encodeExecuteTriggerOrder,
    encodeLiquidate,
    poolIdOf,
} from "../calldata.js";
import { EswapError } from "../errors.js";
import type { TriggerOrder } from "../types.js";

/** Gelato/Chainlink keepers only need a market price plus optional position state. */
export type TriggerDirection = "above" | "below";
export type TriggerKind = "takeProfit" | "stopLoss";
export type TriggerExecutionMode = "triggerOrder" | "closePosition" | "liquidate";

export interface GelatoUserArgs {
    pair: SupportedPair;
    trader: Address;
    /** Required for the trader-controlled `closePosition` fallback only. */
    solver?: Address;
    triggerKind: TriggerKind;
    /** 18-decimal price of token0 divided by token1, per EswapRouterExt. */
    triggerPrice18: bigint | string;
    minAmountOut: bigint | string;
    /** Optional override; otherwise derived from pair + triggerKind. */
    aboveOrBelow?: boolean;
    executionMode?: TriggerExecutionMode;
    closeDeadline?: bigint | string;
    nonce?: bigint | string;
    executorTipBps?: number;
}

export interface GelatoSecrets {
    /** Only used off-chain when signing the EIP-712 arm order; never logged. */
    privateKey?: string;
}

export interface GelatoContext {
    /** Gelato passes the task creator; captured for audit only. */
    user?: Address;
}

export interface GelatoResult {
    canExec: boolean;
    /** `0x` when `canExec` is false. */
    callData: string;
    reason: string;
}

export interface GelatoKeeperDeps {
    /** Chainlink/PriceFeed is authoritative; slot0 may be used as an observation. */
    getMarketPrice18(pair: SupportedPair): Promise<bigint>;
    /** Optional on-chain existence check before returning executable calldata. */
    getPosition?: (args: { poolId: Hex; trader: Address }) => Promise<{ exists: boolean }>;
    /** Optional check that the trader's signed trigger order is still armed. */
    isTriggerArmed?: (args: { poolId: Hex; trader: Address }) => Promise<boolean>;
    nowSeconds?: () => number;
}

export const TRIGGER_ORDER_EIP712_TYPES = {
    TriggerOrder: [
        { name: "poolId", type: "bytes32" },
        { name: "triggerPrice18", type: "uint256" },
        { name: "aboveOrBelow", type: "bool" },
        { name: "minAmountOut", type: "uint256" },
        { name: "closeDeadline", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "executorTipBps", type: "uint8" },
    ],
} as const;

function toBigInt(value: bigint | string | number, label: string): bigint {
    if (typeof value === "bigint") return value;
    if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
    if (typeof value === "string" && /^\d+$/.test(value.trim())) return BigInt(value.trim());
    throw new EswapError("INVALID_UINT", `${label} must be a non-negative integer`, { value });
}

/** RouterExt price is USD(token0)/USD(token1): WETH falls on SL, cbBTC rises. */
export function defaultTriggerDirection(pair: SupportedPair, kind: TriggerKind): TriggerDirection {
    const config = getPairConfig(pair);
    const token0IsBase =
        config.hookPoolKey.currency0.toLowerCase() === config.base.address.toLowerCase();
    if (kind === "takeProfit") return token0IsBase ? "above" : "below";
    return token0IsBase ? "below" : "above";
}

export function marketCrossed(
    marketPrice18: bigint,
    triggerPrice18: bigint,
    direction: TriggerDirection,
): boolean {
    // Matches EswapRouterExt: true => market >= trigger; false => market < trigger.
    return direction === "above"
        ? marketPrice18 >= triggerPrice18
        : marketPrice18 < triggerPrice18;
}

export function buildTriggerOrder(args: {
    pair: SupportedPair;
    triggerPrice18: bigint | string;
    aboveOrBelow: boolean;
    minAmountOut: bigint | string;
    closeDeadline: bigint | string;
    nonce: bigint | string;
    executorTipBps?: number;
}): TriggerOrder {
    const tip = args.executorTipBps ?? 0;
    if (!Number.isInteger(tip) || tip < 0 || tip > 1000) {
        throw new EswapError("INVALID_EXECUTOR_TIP", "executorTipBps must be 0..1000", {
            executorTipBps: tip,
        });
    }
    return {
        poolId: poolIdOf(getPairConfig(args.pair).hookPoolKey),
        triggerPrice18: toBigInt(args.triggerPrice18, "triggerPrice18"),
        aboveOrBelow: args.aboveOrBelow,
        minAmountOut: toBigInt(args.minAmountOut, "minAmountOut"),
        closeDeadline: toBigInt(args.closeDeadline, "closeDeadline"),
        nonce: toBigInt(args.nonce, "nonce"),
        executorTipBps: tip,
    };
}

/** Exact EIP-712 payload for `account.signTypedData(...)`. */
export function buildTriggerOrderTypedData(args: {
    pair: SupportedPair;
    triggerPrice18: bigint | string;
    aboveOrBelow: boolean;
    minAmountOut: bigint | string;
    closeDeadline: bigint | string;
    nonce: bigint | string;
    executorTipBps?: number;
}) {
    const order = buildTriggerOrder(args);
    return {
        domain: TRIGGER_ORDER_DOMAIN,
        types: TRIGGER_ORDER_EIP712_TYPES,
        primaryType: "TriggerOrder" as const,
        message: order,
    };
}

export function buildArmTriggerOrderCall(args: {
    pair: SupportedPair;
    triggerPrice18: bigint | string;
    aboveOrBelow: boolean;
    minAmountOut: bigint | string;
    closeDeadline: bigint | string;
    nonce: bigint | string;
    executorTipBps?: number;
    signature: Hex;
}) {
    const config = getPairConfig(args.pair);
    return {
        to: ESWAP_CONTRACTS.routerExt,
        data: encodeArmTriggerOrder({
            key: config.hookPoolKey,
            order: buildTriggerOrder(args),
            signature: args.signature,
        }),
        value: 0n,
    };
}

/** Chainlink-anchored market price used by on-chain trigger evaluation. */
export function priceFeedMarketPrice18(
    usdToken0: bigint,
    usdToken1: bigint,
): bigint {
    if (usdToken0 <= 0n || usdToken1 <= 0n) {
        throw new EswapError("TRIGGER_PRICE_UNAVAILABLE", "both token USD prices must be positive");
    }
    return (usdToken0 * 10n ** 18n) / usdToken1;
}

/** Pure slot0 observer. On-chain execution still uses PriceFeed, not this value. */
export function sqrtPriceX96ToPrice18(
    sqrtPriceX96: bigint,
    token0Decimals: number,
    token1Decimals: number,
): bigint {
    if (sqrtPriceX96 <= 0n) {
        throw new EswapError("INVALID_SQRT_PRICE", "sqrtPriceX96 must be positive");
    }
    const rawScaled = (sqrtPriceX96 * sqrtPriceX96 * 10n ** 18n) >> 192n;
    const decimalDelta = token0Decimals - token1Decimals;
    if (decimalDelta >= 0) return rawScaled * 10n ** BigInt(decimalDelta);
    return rawScaled / 10n ** BigInt(-decimalDelta);
}

interface ReadContractLike {
    readContract: (args: {
        address: Address;
        abi: readonly unknown[];
        functionName: string;
        args?: readonly unknown[];
    }) => Promise<unknown>;
}

function slot0SqrtPrice(result: unknown): bigint {
    if (Array.isArray(result) && result.length > 0) return BigInt(result[0] as string | bigint);
    if (result && typeof result === "object" && "sqrtPriceX96" in result) {
        return BigInt((result as { sqrtPriceX96: string | bigint }).sqrtPriceX96);
    }
    throw new EswapError("INVALID_SLOT0", "PoolManager.slot0 returned an unexpected shape");
}

/** Optional keeper adapters: wire either PriceFeed reads or slot0 observations. */
export function createPriceFeedMarketPriceReader(client: ReadContractLike) {
    return async (pair: SupportedPair): Promise<bigint> => {
        const config = getPairConfig(pair);
        const token0IsBase =
            config.hookPoolKey.currency0.toLowerCase() === config.base.address.toLowerCase();
        const oneToken0 = 10n ** BigInt(token0IsBase ? config.base.decimals : config.quote.decimals);
        const oneToken1 = 10n ** BigInt(token0IsBase ? config.quote.decimals : config.base.decimals);
        const [usd0, usd1] = await Promise.all([
            client.readContract({
                address: ESWAP_CONTRACTS.priceFeed,
                abi: PRICE_FEED_ABI,
                functionName: "getAmountInUsd",
                args: [config.hookPoolKey.currency0, oneToken0],
            }) as Promise<bigint>,
            client.readContract({
                address: ESWAP_CONTRACTS.priceFeed,
                abi: PRICE_FEED_ABI,
                functionName: "getAmountInUsd",
                args: [config.hookPoolKey.currency1, oneToken1],
            }) as Promise<bigint>,
        ]);
        return priceFeedMarketPrice18(usd0, usd1);
    };
}

export function createSlot0MarketPriceReader(client: ReadContractLike) {
    return async (pair: SupportedPair): Promise<bigint> => {
        const config = getPairConfig(pair);
        const result = await client.readContract({
            address: ESWAP_CONTRACTS.poolManager,
            abi: POOL_MANAGER_ABI,
            functionName: "slot0",
            args: [poolIdOf(config.hookPoolKey)],
        });
        const token0Decimals =
            config.hookPoolKey.currency0.toLowerCase() === config.base.address.toLowerCase()
                ? config.base.decimals
                : config.quote.decimals;
        const token1Decimals =
            config.hookPoolKey.currency1.toLowerCase() === config.base.address.toLowerCase()
                ? config.base.decimals
                : config.quote.decimals;
        return sqrtPriceX96ToPrice18(slot0SqrtPrice(result), token0Decimals, token1Decimals);
    };
}

/** Pure trigger evaluation — deterministic and RPC-free for unit tests. */
export function evaluateGelatoTrigger(
    args: GelatoUserArgs,
    marketPrice18: bigint,
    nowUnix: number,
): { crossed: boolean; reason: string } {
    const trigger = toBigInt(args.triggerPrice18, "triggerPrice18");
    const direction: TriggerDirection =
        args.aboveOrBelow === undefined
            ? defaultTriggerDirection(args.pair, args.triggerKind)
            : args.aboveOrBelow
              ? "above"
              : "below";

    const deadline = args.closeDeadline === undefined ? 0n : toBigInt(args.closeDeadline, "closeDeadline");
    if (deadline !== 0n && deadline <= BigInt(nowUnix)) {
        return { crossed: false, reason: `trigger deadline expired at ${deadline.toString()}` };
    }
    if (!marketCrossed(marketPrice18, trigger, direction)) {
        return {
            crossed: false,
            reason: `market ${marketPrice18.toString()} has not crossed ${trigger.toString()} (${direction})`,
        };
    }
    return {
        crossed: true,
        reason: `market ${marketPrice18.toString()} crossed ${trigger.toString()} (${direction})`,
    };
}

function executionCallData(
    args: GelatoUserArgs,
    deps: GelatoKeeperDeps,
    poolId: Hex,
): { canExec: boolean; callData: string; reason: string } {
    const config = getPairConfig(args.pair);
    const mode = args.executionMode ?? "triggerOrder";
    const minAmountOut = toBigInt(args.minAmountOut, "minAmountOut");

    if (mode === "triggerOrder") {
        return {
            canExec: true,
            callData: encodeExecuteTriggerOrder({
                hook: ESWAP_CONTRACTS.hook,
                key: config.hookPoolKey,
                trader: args.trader,
            }),
            reason: `permissionless executeTriggerOrder for pool ${poolId}`,
        };
    }
    if (mode === "liquidate") {
        return {
            canExec: true,
            callData: encodeLiquidate({
                hook: ESWAP_CONTRACTS.hook,
                key: config.hookPoolKey,
                trader: args.trader,
                minAmountOut,
            }),
            reason: `permissionless liquidate for pool ${poolId}`,
        };
    }
    if (!args.solver) {
        return {
            canExec: false,
            callData: "0x",
            reason: "closePosition fallback requires a trader-controlled sender and solver",
        };
    }
    return {
        canExec: true,
        callData: encodeClosePosition({
            hook: ESWAP_CONTRACTS.hook,
            key: config.hookPoolKey,
            trader: args.trader,
            solver: args.solver,
            minAmountOut,
        }),
        reason: `trader-only closePosition fallback for pool ${poolId}`,
    };
}

/** Gelato Web3 Function entry point. */
export function createGelatoWeb3Function(deps: GelatoKeeperDeps) {
    const now = deps.nowSeconds ?? (() => Math.floor(Date.now() / 1000));
    return {
        onRun: async (
            userArgs: GelatoUserArgs,
            _secrets?: GelatoSecrets,
            _context?: GelatoContext,
        ): Promise<GelatoResult> => {
            try {
                const config = getPairConfig(userArgs.pair);
                const poolId = poolIdOf(config.hookPoolKey);
                if (deps.getPosition) {
                    const position = await deps.getPosition({ poolId, trader: userArgs.trader });
                    if (!position.exists) {
                        return { canExec: false, callData: "0x", reason: "no open position" };
                    }
                }
                if ((userArgs.executionMode ?? "triggerOrder") === "triggerOrder" && deps.isTriggerArmed) {
                    const armed = await deps.isTriggerArmed({ poolId, trader: userArgs.trader });
                    if (!armed) {
                        return { canExec: false, callData: "0x", reason: "no armed trigger order" };
                    }
                }

                const marketPrice18 = await deps.getMarketPrice18(userArgs.pair);
                const evaluation = evaluateGelatoTrigger(userArgs, marketPrice18, now());
                if (!evaluation.crossed) {
                    return { canExec: false, callData: "0x", reason: evaluation.reason };
                }
                return executionCallData(userArgs, deps, poolId);
            } catch (error) {
                const reason = error instanceof Error ? error.message : String(error);
                return { canExec: false, callData: "0x", reason: `keeper evaluation failed: ${reason}` };
            }
        },
    };
}
