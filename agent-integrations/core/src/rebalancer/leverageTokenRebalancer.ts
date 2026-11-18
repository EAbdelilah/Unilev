import type { Address } from "viem";
import {
    BENCHMARK_APR_BPS,
    ESWAP_CONTRACTS,
    LEVERAGE,
    USDC,
    getPairConfig,
    type SupportedPair,
} from "../constants.js";
import {
    encodeApprove,
    encodeClosePosition,
    encodeDepositBorrowEscrow,
    encodeRebalancePosition,
    encodeSwapMultiPool,
} from "../calldata.js";
import { EswapError } from "../errors.js";
import { buildSwapParams, carryInterestUnits } from "../quote.js";
import type { TransactionCall } from "../types.js";

/** 2x / 3x / 5x leverage-token targets. Eswap itself is always fixed 5x. */
export type LeverageTarget = 2 | 3 | 5;

export interface LeverageTokenRebalanceInput {
    pair: SupportedPair;
    targetLeverage: LeverageTarget;
    /** Current NAV/equity of the token, USDC 6dp. */
    navEquityUnits: bigint;
    /** Collateral currently deployed in the Eswap position, USDC 6dp. */
    currentCollateralUnits?: bigint;
    /** Issuer contract/Safe; it is the trader and must sign/execute the close. */
    issuer: Address;
    /** JIT solver funding the new 4x borrow leg. */
    solver: Address;
    /** Solver recorded on the existing position when closing. */
    currentPositionSolver?: Address;
    /** Fresh router/quoter output for the target collateral, base-token smallest units. */
    quoteOutputUnits: bigint;
    slippageBps?: number;
    minAmountOut?: bigint;
    deadline?: bigint;
    /** Caller is also the solver and wants the escrow top-up in the same bundle. */
    includeEscrowFunding?: boolean;
    benchmarkBorrowAprBps?: number;
}

export interface LeverageTokenMath {
    targetLeverage: LeverageTarget;
    /** Eswap router's fixed leverage; always 5. */
    executionLeverage: number;
    navEquityUnits: string;
    /** Fraction of NAV allocated as Eswap collateral: L/5. */
    targetCollateralUnits: string;
    /** 4 * collateral: debt actually carried inside the Eswap position. */
    targetEswapDebtUnits: string;
    /** 5 * collateral: gross base-token market exposure. */
    targetExposureUnits: string;
    /** 1 - L/5 of NAV held as cash buffer for L < 5. */
    targetCashUnits: string;
    /** Conventional debt for an Lx token, (L-1) * NAV. */
    conventionalDebtEquivalentUnits: string;
    eSwapDebtToEquityBps: number;
    effectiveMarketExposureBps: number;
    currentCollateralUnits: string;
    /** Positive = grow, negative = shrink, zero = band refresh only. */
    collateralDeltaUnits: string;
    shouldClose: boolean;
    shouldOpen: boolean;
    annualCarrySavedUsdc: string;
}

export interface RebalanceMathInput {
    targetLeverage: LeverageTarget;
    navEquityUnits: bigint;
    currentCollateralUnits?: bigint;
    benchmarkBorrowAprBps?: number;
}

export interface LeverageTokenRebalancePlan {
    math: LeverageTokenMath;
    /** Ordered calls for the issuer's multicall/Safe; Eswap calls are individual txs. */
    calls: TransactionCall[];
    notes: string[];
}

function assertTarget(target: LeverageTarget): void {
    if (target !== 2 && target !== 3 && target !== 5) {
        throw new EswapError("INVALID_LEVERAGE_TARGET", "leverage token target must be 2, 3, or 5", {
            target,
        });
    }
}

/**
 * Target collateral = NAV * L / 5, leaving NAV * (1 - L/5) in cash.
 *
 * Because the router only offers 5x, an Lx token's Eswap sub-position carries
 * debt 4L/5 of NAV while its gross market exposure is exactly L * NAV. The
 * extra cash buffer absorbs the difference between that margin debt and the
 * conventional (L-1)*NAV debt of a native-L venue. Borrow interest is 0 in
 * every case.
 */
export function calculateLeverageTokenMath(input: RebalanceMathInput): LeverageTokenMath {
    assertTarget(input.targetLeverage);
    if (input.navEquityUnits <= 0n) {
        throw new EswapError("INVALID_NAV", "navEquityUnits must be positive USDC 6dp");
    }
    const current = input.currentCollateralUnits ?? 0n;
    if (current < 0n) {
        throw new EswapError("INVALID_COLLATERAL", "currentCollateralUnits cannot be negative");
    }

    const L = BigInt(input.targetLeverage);
    const five = BigInt(LEVERAGE);
    const nav = input.navEquityUnits;
    const targetCollateral = (nav * L) / five;
    if (targetCollateral <= 0n) {
        throw new EswapError("NAV_TOO_SMALL", "NAV is too small for the target collateral quantum");
    }
    const targetDebt = targetCollateral * BigInt(LEVERAGE - 1);
    const targetExposure = targetCollateral * five;
    const cash = nav - targetCollateral;
    const conventionalDebt = (nav * (L - 1n)) / 1n;
    const benchmarkInterest = carryInterestUnits(
        conventionalDebt,
        input.benchmarkBorrowAprBps ?? BENCHMARK_APR_BPS,
        365,
    );

    return {
        targetLeverage: input.targetLeverage,
        executionLeverage: LEVERAGE,
        navEquityUnits: nav.toString(),
        targetCollateralUnits: targetCollateral.toString(),
        targetEswapDebtUnits: targetDebt.toString(),
        targetExposureUnits: targetExposure.toString(),
        targetCashUnits: cash.toString(),
        conventionalDebtEquivalentUnits: conventionalDebt.toString(),
        eSwapDebtToEquityBps: Number((targetDebt * 10_000n) / nav),
        effectiveMarketExposureBps: Number((targetExposure * 10_000n) / nav),
        currentCollateralUnits: current.toString(),
        collateralDeltaUnits: (targetCollateral - current).toString(),
        shouldClose: current > 0n && current !== targetCollateral,
        shouldOpen: current !== targetCollateral,
        annualCarrySavedUsdc: benchmarkInterest.toString(),
    };
}

/**
 * Build the rebalance bundle. There is no partial close on Eswap: a size change
 * closes the existing position and reopens at the target collateral. The issuer
 * contract/Safe must be the trader for `closePosition`.
 */
export function buildLeverageTokenRebalance(
    input: LeverageTokenRebalanceInput,
): LeverageTokenRebalancePlan {
    const config = getPairConfig(input.pair);
    const math = calculateLeverageTokenMath(input);
    const targetCollateral = BigInt(math.targetCollateralUnits);
    const current = BigInt(math.currentCollateralUnits);

    if (input.quoteOutputUnits <= 0n) {
        throw new EswapError("INVALID_QUOTE", "quoteOutputUnits must be positive");
    }

    const calls: TransactionCall[] = [];
    const notes: string[] = [];

    if (math.shouldClose) {
        calls.push({
            to: ESWAP_CONTRACTS.router,
            data: encodeClosePosition({
                hook: ESWAP_CONTRACTS.hook,
                key: config.hookPoolKey,
                trader: input.issuer,
                solver: input.currentPositionSolver ?? input.solver,
                minAmountOut: input.minAmountOut ?? 0n,
            }),
            value: 0n,
        });
        notes.push("closePosition is trader-only: issuer must be msg.sender");
    }

    if (input.includeEscrowFunding && math.shouldOpen) {
        calls.push({
            to: ESWAP_CONTRACTS.router,
            data: encodeDepositBorrowEscrow(USDC.address, targetCollateral * BigInt(LEVERAGE - 1)),
            value: 0n,
        });
        notes.push("solver escrow top-up included; omit when the solver pre-funded via its own keeper");
    }

    if (math.shouldOpen) {
        calls.push({
            to: USDC.address,
            data: encodeApprove(USDC.address, ESWAP_CONTRACTS.router, targetCollateral),
            value: 0n,
        });
        const params = buildSwapParams({
            pair: input.pair,
            collateralUnits: targetCollateral,
            quoteOutputUnits: input.quoteOutputUnits,
            slippageBps: input.slippageBps ?? 100,
            solver: input.solver,
            deadline:
                input.deadline ??
                BigInt(Math.floor(Date.now() / 1000) + 900),
        });
        calls.push({
            to: ESWAP_CONTRACTS.router,
            data: encodeSwapMultiPool(params),
            value: 0n,
        });
        notes.push("swapMultiPool opens the target 5x sub-position in one atomic router call");
    } else {
        calls.push({
            to: ESWAP_CONTRACTS.router,
            data: encodeRebalancePosition({
                hook: ESWAP_CONTRACTS.hook,
                key: config.hookPoolKey,
                trader: input.issuer,
            }),
            value: 0n,
        });
        notes.push("size already on target; only the JIT collateral band is refreshed");
    }

    notes.push(
        `target ${input.targetLeverage}x: ${math.targetCollateralUnits} USDC margin, ` +
            `${math.targetCashUnits} USDC cash buffer, 0.00% borrow interest`,
    );

    return { math, calls, notes };
}

export function createLeverageTokenRebalancer(defaults: Partial<LeverageTokenRebalanceInput> = {}) {
    return {
        math(input: RebalanceMathInput) {
            return calculateLeverageTokenMath({ ...defaults, ...input } as RebalanceMathInput);
        },
        plan(input: LeverageTokenRebalanceInput) {
            return buildLeverageTokenRebalance({ ...defaults, ...input } as LeverageTokenRebalanceInput);
        },
    };
}

export type { LeverageTarget as TargetLeverage };
