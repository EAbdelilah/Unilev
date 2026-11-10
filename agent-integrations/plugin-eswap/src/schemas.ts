/**
 * Zod schemas for the EXECUTE_ESWAP_MARGIN action arguments.
 * Mirrors the AgentKit provider schemas so both surfaces accept identical inputs.
 */
import { z } from "zod";

export const EswapPairSchema = z.enum(["WETH/USDC", "WBTC/USDC"]);
export type EswapPair = z.infer<typeof EswapPairSchema>;

export const OpenMarginActionSchema = z
  .object({
    pair: EswapPairSchema,
    collateralAmount: z
      .string()
      .trim()
      .min(1)
      .regex(/^\d+(\.\d+)?$/, "collateralAmount must be a positive decimal string, e.g. '100.5'")
      .describe("Amount of USDC collateral to commit (human-readable string, e.g. '100.5')"),
    leverage: z.literal(5).default(5).describe("Leverage multiplier (fixed at 5x spot margin)"),
    slippageToleranceBps: z
      .number()
      .int()
      .min(0)
      .max(3000)
      .default(50)
      .describe("Slippage tolerance in basis points (default 50 = 0.5%)"),
  })
  .strict();

export type OpenMarginActionArgs = z.infer<typeof OpenMarginActionSchema>;
