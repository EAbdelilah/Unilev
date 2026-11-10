/**
 * Zod schemas for the EXECUTE_ESWAP_MARGIN action arguments.
 * Mirrors the AgentKit provider schemas so both surfaces accept identical inputs.
 */
import { z } from "zod";
export declare const EswapPairSchema: z.ZodEnum<["WETH/USDC", "WBTC/USDC"]>;
export type EswapPair = z.infer<typeof EswapPairSchema>;
export declare const OpenMarginActionSchema: z.ZodObject<{
    pair: z.ZodEnum<["WETH/USDC", "WBTC/USDC"]>;
    collateralAmount: z.ZodString;
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
export type OpenMarginActionArgs = z.infer<typeof OpenMarginActionSchema>;
//# sourceMappingURL=schemas.d.ts.map