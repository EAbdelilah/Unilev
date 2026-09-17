import type { Address, PublicClient } from "viem";
import { marginHookAbi, quoterAbi } from "./abis.js";
import { type PoolKey } from "./types.js";

/**
 * Pre-check: dry-run `quoteOpenFit()` — non-reverting view gate that maps the
 * leverage/duplicate/TVL-cap constraints to a stable machine-readable reason.
 */
export interface FitCheck {
    fits: boolean;
    reason: string;
}

export async function checkOpenFit(
    client: Pick<PublicClient, "readContract">,
    hook: Address,
    key: PoolKey,
    trader: Address,
    marginToken: Address,
    leverage: number,
    marginAmount: bigint,
    borrowedAmount: bigint,
): Promise<FitCheck> {
    const [fits, reason] = (await client.readContract({
        address: hook,
        abi: marginHookAbi,
        functionName: "quoteOpenFit",
        args: [key, trader, marginToken, leverage, marginAmount, borrowedAmount],
    })) as readonly [boolean, string];
    return { fits, reason };
}

/**
 * Quote simulation: `EswapLeverageQuoter.quoteExactInputSingleWithLeverage()`
 * estimates the collateral leg of a leveraged open so solvers can verify an
 * order's `buyAmount` is profitable before filling.
 */
export async function quoteLeveragedOutput(
    client: PublicClient,
    quoter: Address,
    tokenIn: Address,
    tokenOut: Address,
    fee: number,
    leverage: number,
    amountIn: bigint,
): Promise<bigint> {
    const amountOut = await client.readContract({
        address: quoter,
        abi: quoterAbi,
        functionName: "quoteExactInputSingleWithLeverage",
        args: [tokenIn, tokenOut, fee, leverage, amountIn],
    });
    if (amountOut <= 0n) {
        throw new Error(`quoteExactInputSingleWithLeverage returned ${amountOut} for ${amountIn} in`);
    }
    return amountOut;
}