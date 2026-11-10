/**
 * Strict Zod validation schemas for the Eswap AgentKit actions.
 * Library: `zod` — schemas are passed to `@CreateAction` so the LLM's tool
 * arguments are validated at the boundary BEFORE any chain interaction.
 */
import { z } from "zod";
export declare const EswapPairSchema: z.ZodEnum<["WETH/USDC", "WBTC/USDC"]>;
export type EswapPair = z.infer<typeof EswapPairSchema>;
/**
 * `open_spot_margin` arguments.
 * Strict object: unknown keys are rejected before touching the wallet.
 */
export declare const OpenSpotMarginSchema: z.ZodObject<{
    pair: z.ZodEnum<["WETH/USDC", "WBTC/USDC"]>;
    collateralAmount: z.ZodEffects<z.ZodString, string, string>;
    leverage: z.ZodDefault<z.ZodLiteral<5>>;
    slippageToleranceBps: z.ZodDefault<z.ZodNumber>;
}, "strict", z.ZodTypeAny, {
    leverage: 5;
    pair: "WETH/USDC" | "WBTC/USDC";
    collateralAmount: string;
    slippageToleranceBps: number;
}, {
    pair: "WETH/USDC" | "WBTC/USDC";
    collateralAmount: string;
    leverage?: 5 | undefined;
    slippageToleranceBps?: number | undefined;
}>;
export type OpenSpotMarginArgs = z.infer<typeof OpenSpotMarginSchema>;
/**
 * `get_eswap_margin_quote` arguments (read-only; no leverage/slippage knobs).
 */
export declare const GetEswapQuoteSchema: z.ZodObject<{
    pair: z.ZodEnum<["WETH/USDC", "WBTC/USDC"]>;
    collateralAmount: z.ZodEffects<z.ZodString, string, string>;
}, "strict", z.ZodTypeAny, {
    pair: "WETH/USDC" | "WBTC/USDC";
    collateralAmount: string;
}, {
    pair: "WETH/USDC" | "WBTC/USDC";
    collateralAmount: string;
}>;
export type GetEswapQuoteArgs = z.infer<typeof GetEswapQuoteSchema>;
//# sourceMappingURL=schemas.d.ts.map