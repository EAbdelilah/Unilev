import type { Address } from "viem";
import {
    BENCHMARK_APR_BPS,
    ESWAP_CONTRACTS,
    LEVERAGE,
    PROTOCOL_FEE_BPS,
    USDC,
    getPairConfig,
    type SupportedPair,
} from "../constants.js";
import { encodeSwapMultiPool } from "../calldata.js";
import { EswapError } from "../errors.js";
import { applyProtocolFee, buildSwapParams, carryInterestUnits, parseCollateralUnits } from "../quote.js";
import type { TransactionCall } from "../types.js";

/** Contango-style normalized cPerp quote. No money-market position is created. */
export interface ContangoNormalizedQuote {
    protocol: "eswap";
    venue: "uniswap-v4-hook";
    moneyMarket: "none";
    pair: SupportedPair;
    side: "long";
    leverage: number;
    tokenIn: Address;
    tokenOut: Address;
    tokenOutDecimals: number;
    collateralUsdcUnits: string;
    borrowUsdcUnits: string;
    notionalUsdcUnits: string;
    grossOutputUnits: string;
    protocolFeeUnits: string;
    netOutputUnits: string;
    benchmarkBorrowAprBps: number;
    eswapBorrowAprBps: 0;
    /** Benchmark interest saved on the 4x borrow leg, USDC 6dp. */
    dailyBorrowInterestSavedUsdc: string;
    annualBorrowInterestSavedUsdc: string;
    minAmountOut: string;
    deadline: string;
    deadlineSeconds: number;
    call: TransactionCall;
}

export interface BuildContangoQuoteParams {
    pair: SupportedPair;
    collateralUsdc: string;
    quoteOutputUnits: bigint;
    solver: Address;
    /** Live Aave/Morpho Base borrow APR in bps. Defaults to the 12% benchmark. */
    benchmarkBorrowAprBps?: number;
    slippageBps?: number;
    deadlineSeconds?: number;
    nowSeconds?: () => number;
    /** Precomputed absolute deadline; wins over `nowSeconds + deadlineSeconds`. */
    deadline?: bigint;
}

/** Inject any on-chain Aave/Morpho rate reader here; no stale rate is hardcoded. */
export interface ContangoRateProvider {
    getBorrowAprBps(): Promise<number>;
}

function assertRate(aprBps: number): void {
    if (!Number.isFinite(aprBps) || aprBps < 0 || aprBps > 100_000) {
        throw new EswapError("INVALID_BORROW_APR", "benchmark borrow APR must be 0..100000 bps", {
            aprBps,
        });
    }
}

/** Router calldata Contango can drop into its money-market routing standard. */
export function buildContangoRouterCall(p: BuildContangoQuoteParams): TransactionCall {
    const config = getPairConfig(p.pair);
    if (p.quoteOutputUnits <= 0n) {
        throw new EswapError("INVALID_QUOTE", "quoteOutputUnits must be positive");
    }
    const params = buildSwapParams({
        pair: p.pair,
        collateralUnits: parseCollateralUnits(p.collateralUsdc),
        quoteOutputUnits: p.quoteOutputUnits,
        slippageBps: p.slippageBps ?? 100,
        solver: p.solver,
        deadline:
            p.deadline ??
            BigInt(
                (p.nowSeconds ?? (() => Math.floor(Date.now() / 1000)))() +
                    (p.deadlineSeconds ?? 900),
            ),
    });
    return { to: ESWAP_CONTRACTS.router, data: encodeSwapMultiPool(params), value: 0n };
}

export function buildContangoQuote(p: BuildContangoQuoteParams): ContangoNormalizedQuote {
    const config = getPairConfig(p.pair);
    const aprBps = p.benchmarkBorrowAprBps ?? BENCHMARK_APR_BPS;
    assertRate(aprBps);

    const collateralUnits = parseCollateralUnits(p.collateralUsdc);
    const borrowUnits = collateralUnits * BigInt(LEVERAGE - 1);
    const notionalUnits = collateralUnits * BigInt(LEVERAGE);
    const { protocolFeeUnits, netUnits } = applyProtocolFee(p.quoteOutputUnits, PROTOCOL_FEE_BPS);
    const deadlineSeconds = p.deadlineSeconds ?? 900;
    const deadline =
        p.deadline ??
        BigInt((p.nowSeconds ?? (() => Math.floor(Date.now() / 1000)))() + deadlineSeconds);
    const call = buildContangoRouterCall({ ...p, deadline });

    return {
        protocol: "eswap",
        venue: "uniswap-v4-hook",
        moneyMarket: "none",
        pair: p.pair,
        side: "long",
        leverage: LEVERAGE,
        tokenIn: USDC.address,
        tokenOut: config.base.address,
        tokenOutDecimals: config.base.decimals,
        collateralUsdcUnits: collateralUnits.toString(),
        borrowUsdcUnits: borrowUnits.toString(),
        notionalUsdcUnits: notionalUnits.toString(),
        grossOutputUnits: p.quoteOutputUnits.toString(),
        protocolFeeUnits: protocolFeeUnits.toString(),
        netOutputUnits: netUnits.toString(),
        benchmarkBorrowAprBps: aprBps,
        eswapBorrowAprBps: 0,
        dailyBorrowInterestSavedUsdc: carryInterestUnits(borrowUnits, aprBps, 1).toString(),
        annualBorrowInterestSavedUsdc: carryInterestUnits(borrowUnits, aprBps, 365).toString(),
        minAmountOut: ((p.quoteOutputUnits * BigInt(10_000 - (p.slippageBps ?? 100))) / 10_000n).toString(),
        deadline: deadline.toString(),
        deadlineSeconds,
        call,
    };
}

/** Adapter object for Contango routers that resolve a live benchmark APR. */
export function createContangoAdapter(rateProvider?: ContangoRateProvider) {
    return {
        async quote(p: Omit<BuildContangoQuoteParams, "benchmarkBorrowAprBps">) {
            const aprBps = rateProvider
                ? await rateProvider.getBorrowAprBps()
                : BENCHMARK_APR_BPS;
            return buildContangoQuote({ ...p, benchmarkBorrowAprBps: aprBps });
        },
        quoteWithBenchmark: buildContangoQuote,
        routerCall: buildContangoRouterCall,
    };
}
