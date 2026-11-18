import { ESWAP_CONTRACTS, LEVERAGE, getPairConfig, type SupportedPair } from "../constants.js";
import { encodeSwapMultiPool } from "../calldata.js";
import { EswapError } from "../errors.js";
import { buildSwapParams, parseCollateralUnits } from "../quote.js";
import type { TransactionCall } from "../types.js";

/** Recurring 5x margin opens. The keeper decides when; the caller supplies a fresh quote. */
export interface DcaPlan {
    id: string;
    pair: SupportedPair;
    collateralUsdc: string;
    /** Seconds between runs, e.g. 604800 for weekly. */
    frequencySeconds: number;
    /** First eligible execution time (unix seconds). */
    startAtUnix: number;
    /** Exactly one of these bounds is required. */
    occurrences?: number;
    endAtUnix?: number;
    solver: `0x${string}`;
    slippageBps?: number;
    deadlineSeconds?: number;
}

export interface ScheduledDcaOrder {
    planId: string;
    sequence: number;
    dueAtUnix: number;
    pair: SupportedPair;
    collateralUsdc: string;
    collateralUnits: string;
    leverage: number;
    solver: `0x${string}`;
}

export interface DcaOpenCallParams {
    scheduled: ScheduledDcaOrder;
    /** Fresh router/quoter output in base-token smallest units. */
    quoteOutputUnits: bigint;
    nowUnix?: number;
}

function assertPlan(plan: DcaPlan): void {
    if (!Number.isSafeInteger(plan.frequencySeconds) || plan.frequencySeconds <= 0) {
        throw new EswapError("INVALID_DCA_FREQUENCY", "frequencySeconds must be a positive integer");
    }
    if (!Number.isSafeInteger(plan.startAtUnix) || plan.startAtUnix < 0) {
        throw new EswapError("INVALID_DCA_START", "startAtUnix must be a non-negative integer");
    }
    if (plan.occurrences !== undefined && plan.endAtUnix !== undefined) {
        throw new EswapError("INVALID_DCA_BOUND", "set either occurrences or endAtUnix, not both");
    }
    if (plan.occurrences === undefined && plan.endAtUnix === undefined) {
        throw new EswapError("INVALID_DCA_BOUND", "set occurrences or endAtUnix");
    }
    if (
        plan.occurrences !== undefined &&
        (!Number.isSafeInteger(plan.occurrences) || plan.occurrences <= 0)
    ) {
        throw new EswapError("INVALID_DCA_OCCURRENCES", "occurrences must be a positive integer");
    }
    if (plan.endAtUnix !== undefined && plan.endAtUnix < plan.startAtUnix) {
        throw new EswapError("INVALID_DCA_END", "endAtUnix must be >= startAtUnix");
    }
    parseCollateralUnits(plan.collateralUsdc);
    if (plan.slippageBps !== undefined && (!Number.isInteger(plan.slippageBps) || plan.slippageBps < 0 || plan.slippageBps > 10_000)) {
        throw new EswapError("INVALID_SLIPPAGE", "slippageBps must be an integer in 0..10000");
    }
    getPairConfig(plan.pair);
}

/** Expand one plan into its full, deterministic schedule. */
export function generateDcaSchedule(plan: DcaPlan): ScheduledDcaOrder[] {
    assertPlan(plan);
    const collateralUnits = parseCollateralUnits(plan.collateralUsdc);
    const schedule: ScheduledDcaOrder[] = [];
    let sequence = 0;
    let dueAtUnix = plan.startAtUnix;

    while (true) {
        if (plan.endAtUnix !== undefined && dueAtUnix > plan.endAtUnix) break;
        if (plan.occurrences !== undefined && sequence >= plan.occurrences) break;
        schedule.push({
            planId: plan.id,
            sequence,
            dueAtUnix,
            pair: plan.pair,
            collateralUsdc: plan.collateralUsdc,
            collateralUnits: collateralUnits.toString(),
            leverage: LEVERAGE,
            solver: plan.solver,
        });
        sequence += 1;
        dueAtUnix += plan.frequencySeconds;
    }
    return schedule;
}

/** Keeper-side filter: due, not-yet-executed runs in chronological order. */
export function getDueDcaOrders(
    plan: DcaPlan,
    nowUnix: number,
    lastExecutedSequence: number,
): ScheduledDcaOrder[] {
    return generateDcaSchedule(plan)
        .filter((order) => order.dueAtUnix <= nowUnix && order.sequence > lastExecutedSequence)
        .sort((a, b) => a.dueAtUnix - b.dueAtUnix);
}

/** Build the exact router call for one DCA run from a fresh quote. */
export function buildDcaOpenCall(params: DcaOpenCallParams): TransactionCall {
    const { scheduled } = params;
    if (params.quoteOutputUnits <= 0n) {
        throw new EswapError("INVALID_QUOTE", "quoteOutputUnits must be positive");
    }
    getPairConfig(scheduled.pair);
    const nowUnix = params.nowUnix ?? Math.floor(Date.now() / 1000);
    const marginUnits = parseCollateralUnits(scheduled.collateralUsdc);
    const swap = buildSwapParams({
        pair: scheduled.pair,
        collateralUnits: marginUnits,
        quoteOutputUnits: params.quoteOutputUnits,
        slippageBps: 100,
        solver: scheduled.solver,
        deadline: BigInt(nowUnix + 900),
    });
    return {
        to: ESWAP_CONTRACTS.router,
        data: encodeSwapMultiPool(swap),
        value: 0n,
    };
}

/** JSON payload for a keeper queue that stores calls as strings. */
export function toDcaKeeperPayload(call: TransactionCall, scheduled: ScheduledDcaOrder) {
    return {
        planId: scheduled.planId,
        sequence: scheduled.sequence,
        dueAtUnix: scheduled.dueAtUnix,
        to: call.to,
        data: call.data,
        value: call.value.toString(),
    };
}

/** In-memory keeper helper: plans are stateless; the cursor is the caller's persisted sequence. */
export function createDcaMarginKeeper(plan: DcaPlan) {
    assertPlan(plan);
    const schedule = generateDcaSchedule(plan);
    return {
        schedule,
        due(nowUnix: number, lastExecutedSequence: number) {
            return schedule.filter(
                (order) => order.dueAtUnix <= nowUnix && order.sequence > lastExecutedSequence,
            );
        },
        buildCall(scheduled: ScheduledDcaOrder, quoteOutputUnits: bigint, nowUnix?: number) {
            return nowUnix === undefined
                ? buildDcaOpenCall({ scheduled, quoteOutputUnits })
                : buildDcaOpenCall({ scheduled, quoteOutputUnits, nowUnix });
        },
    };
}
