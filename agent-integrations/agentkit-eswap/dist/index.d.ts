/**
 * Eswap — Coinbase AgentKit action provider.
 *
 * Pair: `ESWAP/USDC` 5x spot margin on Base mainnet via the Uniswap v4 hook.
 * 0.00% daily borrow carry — no funding rate, no continuous interest.
 *
 * Usage inside an AgentKit app:
 * ```ts
 * import { eswapActionProvider } from "@eswap/agentkit-action-provider";
 * const agentActions = AgentKit.from({
 *   walletProvider,
 *   actionProviders: [eswapActionProvider()],
 * });
 * ```
 */
export { eswapActionProvider, EswapActionProvider } from "./action-providers/eswap/index.js";
export type { EswapPair, GetEswapQuoteArgs, OpenSpotMarginArgs, } from "./action-providers/eswap/schemas.js";
export { ESWAP_CHAIN_ID, ESWAP_NETWORK_ID, DEFAULT_LEVERAGE, DEFAULT_SLIPPAGE_TOLERANCE_BPS, CARRY_BENCHMARK_APR_BPS, PROTOCOL_FEE_BPS, } from "./action-providers/eswap/constants.js";
//# sourceMappingURL=index.d.ts.map