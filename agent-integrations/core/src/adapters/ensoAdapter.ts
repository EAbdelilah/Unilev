import type { Address, Hex } from "viem";
import {
    BASE_CHAIN_ID,
    ESWAP_CONTRACTS,
    LEVERAGE,
    USDC,
    getPairConfig,
    type SupportedPair,
} from "../constants.js";
import {
    encodeApprove,
    encodeDepositBorrowEscrow,
    encodeSwapMultiPool,
} from "../calldata.js";
import { EswapError } from "../errors.js";
import { buildSwapParams, parseCollateralUnits } from "../quote.js";
import type { SwapParams } from "../types.js";

/** Enso executes a shortcut as an ordered call chain in one transaction. */
export interface EnsoCall {
    to: Address;
    data: Hex;
    value?: bigint;
    label?: string;
}

export interface EnsoShortcutDescriptor {
    name: string;
    description: string;
    chainId: number;
    connector: "eswap";
    /** Selector Enso routes on (the terminal Eswap call). */
    selector: Hex;
    target: Address;
    calls: EnsoCall[];
    /** Honest value estimate used by Enso for ranking; 0..10_000 bps. */
    valueBps: number;
    gasReserve: bigint;
    tokens: Address[];
}

export interface BuildEnsoShortcutParams {
    pair: SupportedPair;
    collateralUsdc: string;
    /** User intent must be Eswap's fixed 5x. Omitted means 5x. */
    leverage?: number;
    /** Gross base-token output from a fresh router/quoter read. */
    quoteOutputUnits: bigint;
    /** Solver that bonds the 4x borrow leg. */
    solver: Address;
    slippageBps?: number;
    deadlineSeconds?: number;
    /** Current USDC allowance to the router; omit to include an approval call. */
    allowanceUnits?: bigint;
    /** Current solver escrow; omit to include a depositBorrowEscrow call. */
    escrowedUnits?: bigint;
    skipApproval?: boolean;
    skipEscrow?: boolean;
    valueBps?: number;
    gasReserve?: bigint;
    nowSeconds?: () => number;
}

const ENSO_ROUTE_ENDPOINT = "https://api.enso.finance/api/v1/shortcuts/route";
const DEFAULT_DEADLINE_SECONDS = 900; // 15 minutes, matching UniDex/dex integration norms
const DEFAULT_GAS_RESERVE = 900_000n;

function assertIntent(p: BuildEnsoShortcutParams): void {
    const requested = p.leverage ?? LEVERAGE;
    if (requested !== LEVERAGE) {
        throw new EswapError("UNSUPPORTED_LEVERAGE", "Enso shortcuts support Eswap's fixed 5x only", {
            leverage: requested,
        });
    }
    if (p.quoteOutputUnits <= 0n) {
        throw new EswapError("INVALID_QUOTE", "quoteOutputUnits must be positive");
    }
    if (p.valueBps !== undefined && (!Number.isFinite(p.valueBps) || p.valueBps < 0 || p.valueBps > 10_000)) {
        throw new EswapError("INVALID_VALUE_BPS", "valueBps must be between 0 and 10000", {
            valueBps: p.valueBps,
        });
    }
    if (p.gasReserve !== undefined && p.gasReserve <= 0n) {
        throw new EswapError("INVALID_GAS_RESERVE", "gasReserve must be positive");
    }
}

/** Build the exact `SwapParams` this shortcut will submit to the router. */
export function buildEnsoSwapParams(
    p: BuildEnsoShortcutParams,
    nowSeconds: () => number = p.nowSeconds ?? (() => Math.floor(Date.now() / 1000)),
): SwapParams {
    assertIntent(p);
    const collateralUnits = parseCollateralUnits(p.collateralUsdc);
    return buildSwapParams({
        pair: p.pair,
        collateralUnits,
        quoteOutputUnits: p.quoteOutputUnits,
        slippageBps: p.slippageBps ?? 100,
        solver: p.solver,
        deadline: BigInt(nowSeconds() + (p.deadlineSeconds ?? DEFAULT_DEADLINE_SECONDS)),
    });
}

/**
 * Enso descriptor for a single-transaction 5x open. The borrow leg is never
 * approved from the trader: the router pulls it from the solver's escrow.
 */
export function buildEnsoShortcut(p: BuildEnsoShortcutParams): EnsoShortcutDescriptor {
    const config = getPairConfig(p.pair);
    const params = buildEnsoSwapParams(p);
    const collateralUnits = parseCollateralUnits(p.collateralUsdc);
    const calls: EnsoCall[] = [];

    if (!p.skipApproval && (p.allowanceUnits ?? 0n) < collateralUnits) {
        calls.push({
            to: USDC.address,
            data: encodeApprove(USDC.address, ESWAP_CONTRACTS.router, collateralUnits),
            label: "approve USDC margin to EswapRouter",
        });
    }

    const borrowUnits = collateralUnits * BigInt(LEVERAGE - 1);
    if (!p.skipEscrow && (p.escrowedUnits ?? 0n) < borrowUnits) {
        calls.push({
            to: ESWAP_CONTRACTS.router,
            data: encodeDepositBorrowEscrow(USDC.address, borrowUnits - (p.escrowedUnits ?? 0n)),
            label: "bond 4x borrow leg in EswapRouter escrow",
        });
    }

    const data = encodeSwapMultiPool(params);
    calls.push({
        to: ESWAP_CONTRACTS.router,
        data,
        label: "swapMultiPool: atomic 5x open",
    });

    return {
        name: `eswap-5x-${p.pair.replace("/", "-")}`,
        description:
            `Atomic 5x ${p.pair} margin open on Eswap (Uniswap v4, Base ${BASE_CHAIN_ID}). ` +
            `0.00% borrow interest vs Aave/Morpho; no 5-step flashloan loop. ` +
            `JIT solver bonds the 4x borrow leg and receives senior repayment + LP yield.`,
        chainId: BASE_CHAIN_ID,
        connector: "eswap",
        selector: data.slice(0, 10) as Hex,
        target: ESWAP_CONTRACTS.router,
        calls,
        valueBps: p.valueBps ?? 30,
        gasReserve: p.gasReserve ?? DEFAULT_GAS_RESERVE,
        tokens: [USDC.address, config.base.address],
    };
}

function jsonCall(call: EnsoCall): Record<string, unknown> {
    return {
        to: call.to,
        data: call.data,
        value: call.value === undefined ? undefined : call.value.toString(),
        label: call.label,
    };
}

/** JSON-safe POST body for `POST /api/v1/shortcuts/route`. */
export function buildEnsoRouteRequest(p: BuildEnsoShortcutParams): {
    endpoint: string;
    method: "POST";
    headers: Record<string, string>;
    body: Record<string, unknown>;
} {
    const descriptor = buildEnsoShortcut(p);
    const params = buildEnsoSwapParams(p);
    return {
        endpoint: ENSO_ROUTE_ENDPOINT,
        method: "POST",
        headers: { "content-type": "application/json" },
        body: {
            chainId: descriptor.chainId,
            connector: descriptor.connector,
            target: descriptor.target,
            selector: descriptor.selector,
            fromToken: USDC.address,
            toToken: getPairConfig(p.pair).base.address,
            amountIn: parseCollateralUnits(p.collateralUsdc).toString(),
            minAmountOut: params.minAmountOut.toString(),
            deadline: params.deadline.toString(),
            leverage: LEVERAGE,
            calls: descriptor.calls.map(jsonCall),
            valueBps: descriptor.valueBps,
            gasReserve: descriptor.gasReserve.toString(),
            tokens: descriptor.tokens,
            description: descriptor.description,
        },
    };
}

/** Shape the descriptor for projects that consume `@ensofinance/sdk`. */
export function toEnsoSdkShortcut(d: EnsoShortcutDescriptor): Record<string, unknown> {
    return {
        name: d.name,
        description: d.description,
        chainId: d.chainId,
        connector: d.connector,
        selector: d.selector,
        target: d.target,
        calls: d.calls.map(jsonCall),
        valueBps: d.valueBps,
        gasReserve: d.gasReserve.toString(),
        tokens: d.tokens,
    };
}

export const ENSO_SHORTCUT_ENDPOINT = ENSO_ROUTE_ENDPOINT;
