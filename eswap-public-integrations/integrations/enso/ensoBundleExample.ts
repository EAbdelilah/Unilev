// SPDX-License-Identifier: MIT
/**
 * Enso Finance one-click bundle for Eswap fixed-5x margin on Base (8453).
 *
 * Install: npm i @ensofinance/sdk viem
 * Run:     ENSO_API_KEY=... ENSO_FROM_ADDRESS=0x... npx tsx ensoBundleExample.ts
 *
 * NOTE: no Enso shortcut registration/listings is claimed here. This builds
 * the exact ordered actions an Enso-integrating app submits. `delegate`
 * routing is required so ERC-20 approvals and router calls execute from the
 * trader's own account; with `router` strategy the position would be credited
 * to the Enso executor. Do not use `router` for Eswap opens.
 */
import type { Address, Hex } from "viem";
import {
    BASE_CHAIN_ID,
    ESWAP_ROUTER,
    SWAP_MULTI_POOL_SELECTOR,
    USDC,
    simulateMarginQuote,
    swapParamsTuple,
    type EswapPair,
    type MarginQuote,
} from "../../src/solvers/simulateMarginQuote.js";

const APPROVE_ABI =
    "function approve(address spender, uint256 amount) external returns (bool)";
const ESCROW_ABI = "function depositBorrowEscrow(address token, uint256 amount) external";
const SWAP_ABI =
    "function swapMultiPool((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) key," +
    "(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) standardPoolKey," +
    "bool zeroForOne,int256 amountSpecified,uint8 leverage,address solver,bytes hookData," +
    "uint256 deadline,uint256 minAmountOut) external payable returns (bytes)";

/** Structural subset of `EnsoClient` used here; the SDK is an optional peer dep. */
export interface EnsoBundleParams {
    chainId: number;
    fromAddress: Address;
    receiver: Address;
    routingStrategy: "delegate";
}

export interface EnsoClientLike {
    getBundleData(
        params: EnsoBundleParams,
        actions: readonly unknown[],
    ): Promise<{ tx: unknown; preTransactions?: unknown[] }>;
}

export interface EnsoEswapBundleArgs {
    pair: EswapPair;
    collateralUsdc: string;
    /** Cached 18-decimal USD price from the app's own feed (no RPC in the quoter). */
    priceUsd18: bigint;
    fromAddress: Address;
    /** Solver address that bonds the 4x borrow leg. */
    solver: Address;
    slippageBps?: number;
}

export interface EnsoEswapBundleResult {
    quote: MarginQuote;
    tx: { to: Address; data: Hex; value?: bigint };
    preTransactions: unknown[];
    actions: unknown[];
}

/** Build the SDK bundle payload. Returns signer-ready tx + pre-transactions. */
export async function buildEswapEnsoBundle(
    client: EnsoClientLike,
    args: EnsoEswapBundleArgs,
): Promise<EnsoEswapBundleResult> {
    const quote = simulateMarginQuote({
        pair: args.pair,
        collateralUsdc: args.collateralUsdc,
        priceUsd18: args.priceUsd18,
        recipient: args.fromAddress,
        solver: args.solver,
        slippageBps: args.slippageBps ?? 100,
    });

    if (quote.selector !== SWAP_MULTI_POOL_SELECTOR) {
        throw new Error(`unexpected terminal selector ${quote.selector}`);
    }

    const actions = [
        {
            protocol: "erc20",
            action: "approve",
            args: {
                token: USDC,
                spender: ESWAP_ROUTER,
                amount: quote.collateralUsdcUnits.toString(),
            },
        },
        {
            protocol: "enso",
            action: "call",
            args: {
                address: ESWAP_ROUTER,
                method: "depositBorrowEscrow",
                abi: ESCROW_ABI,
                args: [USDC, quote.borrowUsdcUnits.toString()],
            },
        },
        {
            protocol: "enso",
            action: "call",
            args: {
                address: ESWAP_ROUTER,
                method: "swapMultiPool",
                abi: SWAP_ABI,
                args: [swapParamsTuple(quote.swapParams)],
            },
        },
    ];

    const bundle = await client.getBundleData(
        {
            chainId: BASE_CHAIN_ID,
            fromAddress: args.fromAddress,
            receiver: args.fromAddress,
            routingStrategy: "delegate",
        },
        actions,
    );

    return {
        quote,
        tx: bundle.tx as EnsoEswapBundleResult["tx"],
        preTransactions: bundle.preTransactions ?? [],
        actions,
    };
}

async function main(): Promise<void> {
    const apiKey = process.env.ENSO_API_KEY;
    const from = process.env.ENSO_FROM_ADDRESS as Address | undefined;
    const solver = (process.env.ESWAP_SOLVER ?? from) as Address | undefined;
    if (!apiKey || !from || !solver) {
        throw new Error("set ENSO_API_KEY, ENSO_FROM_ADDRESS and ESWAP_SOLVER");
    }

    // @ts-ignore -- optional peer dependency; install it only if you use this CLI example.
    const { EnsoClient } = await import("@ensofinance/sdk");
    const client = new EnsoClient({ apiKey }) as EnsoClientLike;
    const result = await buildEswapEnsoBundle(client, {
        pair: "WETH/USDC",
        collateralUsdc: "5",
        // Example only: replace with a fresh cached Chainlink / market-data price.
        priceUsd18: 2_350n * 10n ** 18n,
        fromAddress: from,
        solver,
    });

    console.log("terminal selector:", result.quote.selector);
    console.log("bundle tx:", result.tx);
    console.log("pre-transactions:", result.preTransactions);
    console.log("approve ABI:", APPROVE_ABI);
}

if (process.argv[1]?.endsWith("ensoBundleExample.ts")) {
    main().catch((error) => {
        console.error(error);
        process.exitCode = 1;
    });
}
