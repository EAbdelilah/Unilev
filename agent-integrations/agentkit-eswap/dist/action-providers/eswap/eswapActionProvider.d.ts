/**
 * Eswap AgentKit action provider.
 *
 * Actions
 *  ─ get_eswap_margin_quote : read-only eth_call through `router.quoteExactInput`
 *                             (+ `hook.quoteOpenFit` size gates) — expected fill,
 *                             0.10% fee, and the 7-day carry savings vs. a
 *                             12% APR continuous-borrow benchmark.
 *  ─ open_spot_margin       : approve USDC -> self-bond the borrow leg into
 *                             `erc20BorrowEscrow` -> `router.swapMultiPool`
 *                             (5x spot margin; 0% daily carry).
 *
 * Both actions are ONLY registered on Base mainnet (chainId 8453).
 */
import "reflect-metadata";
import { ActionProvider, type EvmWalletProvider, type Network } from "@coinbase/agentkit";
import { type GetEswapQuoteArgs, type OpenSpotMarginArgs } from "./schemas.js";
export declare class EswapActionProvider extends ActionProvider<EvmWalletProvider> {
    constructor();
    /** @inheritdoc AgentKit — only Base mainnet. */
    supportsNetwork(network: Network): boolean;
    getEswapMarginQuote(walletProvider: EvmWalletProvider, args: GetEswapQuoteArgs): Promise<string>;
    openSpotMargin(walletProvider: EvmWalletProvider, args: OpenSpotMarginArgs): Promise<string>;
}
/** Factory export required by AgentKit conventions. */
export declare const eswapActionProvider: () => EswapActionProvider;
export type { GetEswapQuoteArgs, OpenSpotMarginArgs };
//# sourceMappingURL=eswapActionProvider.d.ts.map