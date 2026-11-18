import type { Address } from "viem";
import {
    BASE_CHAIN_ID,
    ESWAP_CONTRACTS,
    LEVERAGE,
    USDC,
    getPairConfig,
    type PoolKey,
    type SupportedPair,
} from "../constants.js";
import { encodeSwapMultiPool } from "../calldata.js";
import { EswapError } from "../errors.js";
import { applyProtocolFee, buildSwapParams, parseCollateralUnits } from "../quote.js";
import type { TransactionCall } from "../types.js";

/** UniDex integrates Eswap as a meta-aggregator venue descriptor. */
export const UNIDEX_DEADLINE_SECONDS = 900; // 15 minutes
const MAX_PARTNER_FEE_BPS = 1_000;

export interface UniDexPoolDescriptor {
    hookPoolKey: PoolKey;
    standardPoolKey: PoolKey;
    fee: number;
    tickSpacing: number;
    hooks: Address;
    role: "accounting" | "fill";
}

export interface UniDexFee {
    bps: number;
    recipient: Address;
    token: Address;
    /** Base-token units retained by the meta-aggregator wrapper. */
    amountUnits: string;
}

export interface UniDexRoute {
    chainId: number;
    venue: "eswap-v4";
    pair: SupportedPair;
    tokenIn: Address;
    tokenOut: Address;
    tokenOutDecimals: number;
    amountIn: string;
    expectedOutputUnits: string;
    protocolFeeUnits: string;
    partnerFee: UniDexFee;
    minAmountOut: string;
    slippageBps: number;
    leverage: number;
    deadline: string;
    deadlineSeconds: number;
    pools: UniDexPoolDescriptor[];
    call: TransactionCall;
}

export interface BuildUniDexRouteParams {
    pair: SupportedPair;
    collateralUsdc: string;
    quoteOutputUnits: bigint;
    solver: Address;
    slippageBps?: number;
    deadlineSeconds?: number;
    partnerFeeBps?: number;
    feeRecipient: Address;
    nowSeconds?: () => number;
}

function assertFeeBps(bps: number): void {
    if (!Number.isInteger(bps) || bps < 0 || bps > MAX_PARTNER_FEE_BPS) {
        throw new EswapError("INVALID_PARTNER_FEE", "partnerFeeBps must be an integer in [0, 1000]", {
            bps,
        });
    }
}

export function buildUniDexPoolDescriptors(pair: SupportedPair): UniDexPoolDescriptor[] {
    const config = getPairConfig(pair);
    return [
        {
            hookPoolKey: config.hookPoolKey,
            standardPoolKey: config.standardPoolKey,
            fee: config.hookPoolKey.fee,
            tickSpacing: config.hookPoolKey.tickSpacing,
            hooks: config.hookPoolKey.hooks,
            role: "accounting",
        },
        {
            hookPoolKey: config.hookPoolKey,
            standardPoolKey: config.standardPoolKey,
            fee: config.standardPoolKey.fee,
            tickSpacing: config.standardPoolKey.tickSpacing,
            hooks: config.standardPoolKey.hooks,
            role: "fill",
        },
    ];
}

export function buildUniDexRoute(p: BuildUniDexRouteParams): UniDexRoute {
    const config = getPairConfig(p.pair);
    const partnerFeeBps = p.partnerFeeBps ?? 0;
    assertFeeBps(partnerFeeBps);
    if (p.quoteOutputUnits <= 0n) {
        throw new EswapError("INVALID_QUOTE", "quoteOutputUnits must be positive");
    }

    const collateralUnits = parseCollateralUnits(p.collateralUsdc);
    const deadlineSeconds = p.deadlineSeconds ?? UNIDEX_DEADLINE_SECONDS;
    const deadline = BigInt(
        (p.nowSeconds ?? (() => Math.floor(Date.now() / 1000)))() + deadlineSeconds,
    );
    const params = buildSwapParams({
        pair: p.pair,
        collateralUnits,
        quoteOutputUnits: p.quoteOutputUnits,
        slippageBps: p.slippageBps ?? 100,
        solver: p.solver,
        deadline,
    });

    const { protocolFeeUnits } = applyProtocolFee(p.quoteOutputUnits);
    const partnerFeeUnits = (p.quoteOutputUnits * BigInt(partnerFeeBps)) / 10_000n;
    const afterFees = p.quoteOutputUnits - partnerFeeUnits;
    const minAmountOut = (afterFees * BigInt(10_000 - (p.slippageBps ?? 100))) / 10_000n;

    // The conservative floor above is what UniDex reports to its own users;
    // the router still enforces its own quote-derived floor in SwapParams.
    const call: TransactionCall = {
        to: ESWAP_CONTRACTS.router,
        data: encodeSwapMultiPool({ ...params, minAmountOut }),
        value: 0n,
    };

    return {
        chainId: BASE_CHAIN_ID,
        venue: "eswap-v4",
        pair: p.pair,
        tokenIn: USDC.address,
        tokenOut: config.base.address,
        tokenOutDecimals: config.base.decimals,
        amountIn: collateralUnits.toString(),
        expectedOutputUnits: p.quoteOutputUnits.toString(),
        protocolFeeUnits: protocolFeeUnits.toString(),
        partnerFee: {
            bps: partnerFeeBps,
            recipient: p.feeRecipient,
            token: config.base.address,
            amountUnits: partnerFeeUnits.toString(),
        },
        minAmountOut: minAmountOut.toString(),
        slippageBps: p.slippageBps ?? 100,
        leverage: LEVERAGE,
        deadline: deadline.toString(),
        deadlineSeconds,
        pools: buildUniDexPoolDescriptors(p.pair),
        call,
    };
}

/** JSON body for a UniDex meta-aggregator `routes/register` style endpoint. */
export function buildUniDexApiPayload(route: UniDexRoute): Record<string, unknown> {
    return {
        chainId: route.chainId,
        venue: route.venue,
        pair: route.pair,
        tokenIn: route.tokenIn,
        tokenOut: route.tokenOut,
        amountIn: route.amountIn,
        minAmountOut: route.minAmountOut,
        deadline: route.deadline,
        leverage: route.leverage,
        slippageBps: route.slippageBps,
        partnerFee: route.partnerFee,
        pools: route.pools,
        call: {
            to: route.call.to,
            data: route.call.data,
            value: route.call.value.toString(),
        },
    };
}
