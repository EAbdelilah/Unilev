/**
 * Strict Zod validation schemas for the Eswap AgentKit actions.
 * Library: `zod` — schemas are passed to `@CreateAction` so the LLM's tool
 * arguments are validated at the boundary BEFORE any chain interaction.
 */
import { z } from "zod";

export const EswapPairSchema = z.enum(["WETH/USDC", "WBTC/USDC"]);
export type EswapPair = z.infer<typeof EswapPairSchema>;

const collateralAmountSchema = z
  .string()
  .trim()
  .min(1)
  .regex(/^\d+(\.\d+)?$/, "collateralAmount must be a positive decimal string, e.g. '100.5'")
  .refine((value) => {
    const [whole = "", fraction = ""] = value.split(".");
    return fraction.length <= 6; // USDC precision shows up fully in 6 decimals
  }, "collateralAmount is finer than USDC's 6 decimals")
  .describe("Amount of USDC collateral to commit (human-readable string, e.g. '100.5')");

const leverageSchema = z
  .literal(5)
  .default(5)
  .describe("Leverage multiplier (fixed at 5x spot margin)");

/**
 * `open_spot_margin` arguments.
 * Strict object: unknown keys are rejected before touching the wallet.
 */
export const OpenSpotMarginSchema = z
  .object({
    pair: EswapPairSchema,
    collateralAmount: collateralAmountSchema,
    leverage: leverageSchema,
    slippageToleranceBps: z
      .number()
      .int()
      .min(0)
      .max(3000)
      .default(50)
      .describe("Slippage tolerance in basis points (default 50 = 0.5%)"),
  })
  .strict();
export type OpenSpotMarginArgs = z.infer<typeof OpenSpotMarginSchema>;

/**
 * `get_eswap_margin_quote` arguments (read-only; no leverage/slippage knobs).
 */
export const GetEswapQuoteSchema = z
  .object({
    pair: EswapPairSchema,
    collateralAmount: collateralAmountSchema,
  })
  .strict();
export type GetEswapQuoteArgs = z.infer<typeof GetEswapQuoteSchema>;
