import { formatUnits, parseUnits } from "viem";
import {
    BASE_CHAIN_ID,
    BENCHMARK_APR_BPS,
    ESWAP_CONTRACTS,
    LEVERAGE,
    PROTOCOL_FEE_BPS,
    getPairConfig,
    type SupportedPair,
} from "./constants.js";
import { EswapError } from "./errors.js";
import type { CarrySavings, EswapQuote, SwapParamsJson, SwapParams } from "./types.js";

/** Strict 6-decimal USDC parsing. Rejects scientific notation and extra precision. */
export function parseCollateralUnits(collateralUsdc: string): bigint {
    if (typeof collateralUsdc !== "string" || !/^\d+(?:\.\d{1,6})?$/.test(collateralUsdc.trim())) {
        throw new EswapError("INVALID_COLLATERAL", "collateralUsdc must be a positive decimal string with at most 6 decimals", {
            collateralUsdc,
        });
    }
    const units = parseUnits(collateralUsdc.trim(), 6);
    if (units <= 0n) {
        throw new EswapError("INVALID_COLLATERAL", "collateralUsdc must be greater than zero", { collateralUsdc });
    }
    return units;
}

/** 10 bps reserve on the bought (base-token) leg, matching the hook's accounting. */
export function applyProtocolFee(grossUnits: bigint, feeBps: number = PROTOCOL_FEE_BPS): {
    protocolFeeUnits: bigint;
    netUnits: bigint;
} {
    if (grossUnits < 0n) throw new EswapError("INVALID_QUOTE", "Quote output cannot be negative");
    const protocolFeeUnits = (grossUnits * BigInt(feeBps)) / 10_000n;
    return { protocolFeeUnits, netUnits: grossUnits - protocolFeeUnits };
}

/** Simple-interest carry cost on the borrowed (leverage - 1) leg. */
export function carryInterestUnits(
    borrowUnits: bigint,
    aprBps: number = BENCHMARK_APR_BPS,
    days: number,
): bigint {
    return (borrowUnits * BigInt(aprBps) * BigInt(days)) / (10_000n * 365n);
}

export function buildCarrySavings(
    borrowUnits: bigint,
    days: number,
    aprBps: number = BENCHMARK_APR_BPS,
): CarrySavings {
    const benchmark = carryInterestUnits(borrowUnits, aprBps, days);
    return {
        days,
        benchmarkAprPercent: aprBps / 100,
        benchmarkInterestUsdc: formatUnits(benchmark, 6),
        eswapInterestUsdc: "0",
        savedUsdc: formatUnits(benchmark, 6),
    };
}

export interface RawQuote {
    /** Gross base-token output in base-token smallest units. */
    outputUnits: bigint;
    source: "router" | "quoter";
}

/**
 * Assemble the public quote object from a read-only on-chain quote.
 * Pure function: no RPC calls, so decimal scaling can be unit tested in isolation.
 */
export function assembleQuote(
    pair: SupportedPair,
    collateralUsdc: string,
    raw: RawQuote,
    protocolFeeBps: number = PROTOCOL_FEE_BPS,
): EswapQuote {
    const config = getPairConfig(pair);
    const collateralUnits = parseCollateralUnits(collateralUsdc);
    const { protocolFeeUnits, netUnits } = applyProtocolFee(raw.outputUnits, protocolFeeBps);
    const borrowUnits = collateralUnits * BigInt(LEVERAGE - 1);
    const notionalUnits = collateralUnits * BigInt(LEVERAGE);

    // zeroForOne=false: USDC (currency1) is the input, base token (currency0) is the output.
    const zeroForOne = config.hookPoolKey.currency0 === config.base.address ? false : true;

    // Price estimate: USDC per whole base token, 6dp. The on-chain quote output is
    // for the 5x notional, so divide that notional by the gross base output.
    const priceScaled =
        raw.outputUnits > 0n
            ? (notionalUnits * 10n ** BigInt(config.base.decimals)) / raw.outputUnits
            : 0n;

    const feeUsdcApprox =
        raw.outputUnits > 0n ? (protocolFeeUnits * notionalUnits) / raw.outputUnits : 0n;

    return {
        pair,
        side: "long",
        leverage: LEVERAGE,
        collateralUsdc: collateralUnits.toString(),
        collateralUsdcUnits: collateralUnits.toString(),
        borrowUsdc: formatUnits(borrowUnits, 6),
        notionalUsdc: formatUnits(notionalUnits, 6),
        tokenOut: formatUnits(raw.outputUnits, config.base.decimals),
        tokenOutSymbol: config.base.symbol as "WETH" | "cbBTC",
        tokenOutDecimals: config.base.decimals,
        grossTokenOut: formatUnits(raw.outputUnits, config.base.decimals),
        protocolFeeTokenOut: formatUnits(protocolFeeUnits, config.base.decimals),
        netTokenOut: formatUnits(netUnits, config.base.decimals),
        protocolFeeBps,
        protocolFeeUsdcApprox: formatUnits(feeUsdcApprox, 6),
        quoteSource: raw.source,
        estimatedPriceUsdcPerToken: formatUnits(priceScaled, 6),
        zeroForOne,
        savings: {
            days7: buildCarrySavings(borrowUnits, 7),
            days30: buildCarrySavings(borrowUnits, 30),
        },
        contracts: {
            chainId: BASE_CHAIN_ID,
            hook: ESWAP_CONTRACTS.hook,
            router: ESWAP_CONTRACTS.router,
            poolManager: ESWAP_CONTRACTS.poolManager,
            hookPoolKey: config.hookPoolKey,
            standardPoolKey: config.standardPoolKey,
        },
    };
}

/** Build the router SwapParams (bigint form) for a collateral-in / base-out long. */
export function buildSwapParams(args: {
    pair: SupportedPair;
    collateralUnits: bigint;
    quoteOutputUnits: bigint;
    slippageBps: number;
    solver: `0x${string}`;
    deadline: bigint;
}): SwapParams {
    const config = getPairConfig(args.pair);
    if (!Number.isInteger(args.slippageBps) || args.slippageBps < 0 || args.slippageBps > 10_000) {
        throw new EswapError("INVALID_SLIPPAGE", "slippageBps must be an integer between 0 and 10000", {
            slippageBps: args.slippageBps,
        });
    }
    const minAmountOut = (args.quoteOutputUnits * BigInt(10_000 - args.slippageBps)) / 10_000n;
    const zeroForOne = config.hookPoolKey.currency0 !== config.base.address;
    return {
        key: config.hookPoolKey,
        standardPoolKey: config.standardPoolKey,
        zeroForOne,
        amountSpecified: -args.collateralUnits,
        leverage: LEVERAGE,
        solver: args.solver,
        hookData: "0x",
        deadline: args.deadline,
        minAmountOut,
    };
}

/** JSON-safe rendering for tool results / logs (bigint -> decimal string). */
export function toSwapParamsJson(params: SwapParams): SwapParamsJson {
    return {
        key: params.key,
        standardPoolKey: params.standardPoolKey,
        zeroForOne: params.zeroForOne,
        amountSpecified: params.amountSpecified.toString(),
        leverage: params.leverage,
        solver: params.solver,
        hookData: params.hookData,
        deadline: params.deadline.toString(),
        minAmountOut: params.minAmountOut.toString(),
    };
}
