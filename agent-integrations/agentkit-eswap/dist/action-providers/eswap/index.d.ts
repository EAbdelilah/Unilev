/**
 * Eswap AgentKit provider package exports.
 *
 * ```ts
 * import { eswapActionProvider } from "@eswap/agentkit-action-provider";
 * const provider = eswapActionProvider(); // → { name: "eswap", actions: get_eswap_margin_quote, open_spot_margin }
 * ```
 */
export { EswapActionProvider, eswapActionProvider } from "./eswapActionProvider.js";
export { EswapPairSchema, OpenSpotMarginSchema, GetEswapQuoteSchema, type EswapPair, type OpenSpotMarginArgs, type GetEswapQuoteArgs, } from "./schemas.js";
export { EswapProviderError } from "./errors.js";
export { ESWAP_CHAIN_ID, ESWAP_NETWORK_ID, ESWAP_PAIRS, resolveEswapDeployment, DEFAULT_LEVERAGE, DEFAULT_SLIPPAGE_TOLERANCE_BPS, CARRY_BENCHMARK_APR_BPS, PROTOCOL_FEE_BPS, } from "./constants.js";
//# sourceMappingURL=index.d.ts.map