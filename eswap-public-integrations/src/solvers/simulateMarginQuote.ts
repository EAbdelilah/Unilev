// SPDX-License-Identifier: MIT
/**
 * Deterministic, RPC-free quote + calldata builder for Eswap's fixed-5x Base
 * margin venue. No chain calls: pass a cached 18-decimal USD price from your
 * own market data feed and this module returns router-ready calldata.
 */
import {
    encodeAbiParameters,
    encodeFunctionData,
    parseUnits,
    type Abi,
    type Address,
    type Hex,
} from "viem";

export type EswapPair = "WETH/USDC" | "cbBTC/USDC";

export const BASE_CHAIN_ID = 8453;
export const ESWAP_HOOK: Address = "0x7b3F232BB5a0346fADb8B92B31B3e7bC60bD90c8";
export const ESWAP_ROUTER: Address = "0x5b226aE5158de86f1E616875dBab886870B9aAd9";
export const POOL_MANAGER: Address = "0x498581fF718922c3f8e6A244956aF099B2652b2b";
export const USDC: Address = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
export const WETH: Address = "0x4200000000000000000000000000000000000006";
export const CBBTC: Address = "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf";

export const LEVERAGE = 5;
export const LEVERAGE_BPS = 50_000;
export const PROTOCOL_FEE_BPS = 10; // 0.10%, charged on the bought leg
export const FUNDING_RATE_BPS = 0; // zero carry, ranked #1 by perp aggregators
export const ZERO_ADDRESS: Address = "0x0000000000000000000000000000000000000000";
export const SWAP_MULTI_POOL_SELECTOR = "0x33046e31";

type PoolKey = {
    currency0: Address;
    currency1: Address;
    fee: number;
    tickSpacing: number;
    hooks: Address;
};

type SwapParams = {
    key: PoolKey;
    standardPoolKey: PoolKey;
    zeroForOne: boolean;
    amountSpecified: bigint;
    leverage: number;
    solver: Address;
    hookData: Hex;
    deadline: bigint;
    minAmountOut: bigint;
};

const POOL_KEY_COMPONENTS = [
    { name: "currency0", type: "address" },
    { name: "currency1", type: "address" },
    { name: "fee", type: "uint24" },
    { name: "tickSpacing", type: "int24" },
    { name: "hooks", type: "address" },
] as const;

const SWAP_MULTI_POOL_ABI = [
    {
        type: "function",
        name: "swapMultiPool",
        stateMutability: "payable",
        inputs: [
            {
                name: "params",
                type: "tuple",
                components: [
                    { name: "key", type: "tuple", components: [...POOL_KEY_COMPONENTS] },
                    { name: "standardPoolKey", type: "tuple", components: [...POOL_KEY_COMPONENTS] },
                    { name: "zeroForOne", type: "bool" },
                    { name: "amountSpecified", type: "int256" },
                    { name: "leverage", type: "uint8" },
                    { name: "solver", type: "address" },
                    { name: "hookData", type: "bytes" },
                    { name: "deadline", type: "uint256" },
                    { name: "minAmountOut", type: "uint256" },
                ],
            },
        ],
        outputs: [{ name: "", type: "bytes" }],
    },
] as const satisfies Abi;

const ERC20_ABI = [
    {
        type: "function",
        name: "approve",
        stateMutability: "nonpayable",
        inputs: [
            { name: "spender", type: "address" },
            { name: "amount", type: "uint256" },
        ],
        outputs: [{ name: "", type: "bool" }],
    },
    {
        type: "function",
        name: "depositBorrowEscrow",
        stateMutability: "nonpayable",
        inputs: [
            { name: "token", type: "address" },
            { name: "amount", type: "uint256" },
        ],
        outputs: [],
    },
] as const satisfies Abi;

export interface PairConfig {
    pair: EswapPair;
    base: Address;
    decimals: number;
    hookPoolKey: PoolKey;
    standardPoolKey: PoolKey;
    /** USDC-in long is zeroForOne=false for WETH (currency0) and true for cbBTC. */
    zeroForOneUsdcIn: boolean;
}

export const PAIRS: Record<EswapPair, PairConfig> = {
    "WETH/USDC": {
        pair: "WETH/USDC",
        base: WETH,
        decimals: 18,
        hookPoolKey: {
            currency0: WETH,
            currency1: USDC,
            fee: 3000,
            tickSpacing: 60,
            hooks: ESWAP_HOOK,
        },
        standardPoolKey: {
            currency0: WETH,
            currency1: USDC,
            fee: 500,
            tickSpacing: 10,
            hooks: ZERO_ADDRESS,
        },
        zeroForOneUsdcIn: false,
    },
    "cbBTC/USDC": {
        pair: "cbBTC/USDC",
        base: CBBTC,
        decimals: 8,
        hookPoolKey: {
            currency0: USDC,
            currency1: CBBTC,
            fee: 3000,
            tickSpacing: 60,
            hooks: ESWAP_HOOK,
        },
        standardPoolKey: {
            currency0: USDC,
            currency1: CBBTC,
            fee: 500,
            tickSpacing: 10,
            hooks: ZERO_ADDRESS,
        },
        zeroForOneUsdcIn: true,
    },
};

export interface SimulateMarginQuoteArgs {
    pair: EswapPair;
    /** USDC decimal string, max 6dp. */
    collateralUsdc: string;
    /** Cached 18-decimal USD price of the base token from your own feed. */
    priceUsd18: bigint;
    /** Recipient encoded in hookData; must equal router msg.sender at execution. */
    recipient: Address;
    /** Solver that bonds the 4x borrow leg (or the adapter self-bond address). */
    solver: Address;
    slippageBps?: number;
    deadlineSeconds?: bigint;
    nowSeconds?: () => number;
}

export interface MarginQuote {
    pair: EswapPair;
    collateralUsdcUnits: bigint;
    borrowUsdcUnits: bigint;
    notionalUsdcUnits: bigint;
    /** Gross base-token output from the 5x notional in base smallest units. */
    grossTokenOut: bigint;
    /** Gross output minus the 10 bps protocol fee, in base smallest units. */
    netTokenOut: bigint;
    /** Fee in base smallest units (the actual on-chain charged currency). */
    protocolFeeTokenUnits: bigint;
    /** USDC-equivalent fee: notional * 10 bps. */
    protocolFeeUsdc: bigint;
    fundingRateBps: 0;
    zeroForOne: boolean;
    minAmountOut: bigint;
    deadline: bigint;
    swapParams: SwapParams;
    calldata: {
        swapMultiPool: Hex;
        approveMargin: Hex;
        depositBorrowEscrow: Hex;
    };
    selector: Hex;
}

/** Strict 6-decimal USDC parser: no scientific notation, no extra precision. */
export function parseCollateralUnits(value: string): bigint {
    if (typeof value !== "string" || !/^\d+(?:\.\d{1,6})?$/.test(value.trim())) {
        throw new Error("collateralUsdc must be a positive decimal string with at most 6 decimals");
    }
    const units = parseUnits(value.trim(), 6);
    if (units <= 0n) throw new Error("collateralUsdc must be greater than zero");
    return units;
}

function poolKeyTuple(key: PoolKey) {
    return [key.currency0, key.currency1, key.fee, key.tickSpacing, key.hooks] as const;
}

export function swapParamsTuple(p: SwapParams) {
    return [
        poolKeyTuple(p.key),
        poolKeyTuple(p.standardPoolKey),
        p.zeroForOne,
        p.amountSpecified,
        p.leverage,
        p.solver,
        p.hookData,
        p.deadline,
        p.minAmountOut,
    ] as const;
}

/**
 * Pure quote. For WETH, raw price = priceUsd18 / 1e30 (USDC raw per WETH raw),
 * so baseOut = notionalUsdcRaw * 1e30 / priceUsd18.
 * For cbBTC, raw price = 1e20 / priceUsd18 (cbBTC raw per USDC raw),
 * so baseOut = notionalUsdcRaw * priceUsd18 / 1e20.
 */
export function simulateMarginQuote(args: SimulateMarginQuoteArgs): MarginQuote {
    const config = PAIRS[args.pair];
    if (!config) throw new Error(`Unsupported pair: ${args.pair}`);
    if (args.priceUsd18 <= 0n) throw new Error("priceUsd18 must be positive");
    const slippage = args.slippageBps ?? 100;
    if (!Number.isInteger(slippage) || slippage < 0 || slippage > 10_000) {
        throw new Error("slippageBps must be an integer between 0 and 10000");
    }

    const collateral = parseCollateralUnits(args.collateralUsdc);
    const borrow = collateral * BigInt(LEVERAGE - 1);
    const notional = collateral * BigInt(LEVERAGE);

    const grossTokenOut = config.pair === "WETH/USDC"
        ? (notional * 10n ** 30n) / args.priceUsd18
        : (notional * args.priceUsd18) / 10n ** 20n;
    if (grossTokenOut <= 0n) throw new Error("computed quote output is zero");

    const protocolFeeTokenUnits = (grossTokenOut * BigInt(PROTOCOL_FEE_BPS)) / 10_000n;
    const netTokenOut = grossTokenOut - protocolFeeTokenUnits;
    const protocolFeeUsdc = (notional * BigInt(PROTOCOL_FEE_BPS)) / 10_000n;
    const minAmountOut = (grossTokenOut * BigInt(10_000 - slippage)) / 10_000n;
    const deadline = args.deadlineSeconds ?? BigInt((args.nowSeconds ?? (() => Math.floor(Date.now() / 1000)))() + 900);

    const hookData = encodeAbiParameters(
        [
            { name: "isMargin", type: "bool" },
            { name: "leverage", type: "uint8" },
            { name: "trader", type: "address" },
        ],
        [true, 5, args.recipient],
    );

    const params: SwapParams = {
        key: config.hookPoolKey,
        standardPoolKey: config.standardPoolKey,
        zeroForOne: config.zeroForOneUsdcIn,
        amountSpecified: -collateral,
        leverage: 5,
        solver: args.solver,
        hookData,
        deadline,
        minAmountOut,
    };

    // viem encodes named tuple components as objects; `params` is already the
    // canonical SwapParams shape.
    const swapMultiPool = encodeFunctionData({
        abi: SWAP_MULTI_POOL_ABI,
        functionName: "swapMultiPool",
        args: [params],
    });
    const selector = swapMultiPool.slice(0, 10) as Hex;
    if (selector !== SWAP_MULTI_POOL_SELECTOR) {
        throw new Error(`selector mismatch: expected ${SWAP_MULTI_POOL_SELECTOR}, got ${selector}`);
    }

    return {
        pair: config.pair,
        collateralUsdcUnits: collateral,
        borrowUsdcUnits: borrow,
        notionalUsdcUnits: notional,
        grossTokenOut,
        netTokenOut,
        protocolFeeTokenUnits,
        protocolFeeUsdc,
        fundingRateBps: 0,
        zeroForOne: params.zeroForOne,
        minAmountOut,
        deadline,
        swapParams: params,
        calldata: {
            swapMultiPool,
            approveMargin: encodeFunctionData({
                abi: ERC20_ABI,
                functionName: "approve",
                args: [ESWAP_ROUTER, collateral],
            }),
            depositBorrowEscrow: encodeFunctionData({
                abi: ERC20_ABI,
                functionName: "depositBorrowEscrow",
                args: [USDC, borrow],
            }),
        },
        selector,
    };
}

export default simulateMarginQuote;
