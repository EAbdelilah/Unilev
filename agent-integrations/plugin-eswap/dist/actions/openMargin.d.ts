/**
 * EXECUTE_ESWAP_MARGIN — ElizaOS action.
 *
 * Opens a 5x spot-margin LONG on Eswap (Base mainnet) with 0.00% daily
 * borrow interest. Flow: approve USDC -> self-bond borrow leg into
 * `erc20BorrowEscrow` -> `router.swapMultiPool` with a quote-derived
 * minAmountOut slippage guard and 15-minute deadline.
 */
import type { Action } from "@elizaos/core";
export declare const openMarginAction: Action;
//# sourceMappingURL=openMargin.d.ts.map