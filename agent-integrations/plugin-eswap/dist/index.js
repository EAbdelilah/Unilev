import { openMarginAction } from "./actions/openMargin.js";
import { eswapQuoteProvider } from "./providers/quoteProvider.js";
export const eswapPlugin = {
    name: "eswap-margin",
    description: "0% Interest Spot Leverage via Uniswap v4 Hooks on Base",
    actions: [openMarginAction],
    providers: [eswapQuoteProvider],
    evaluators: [],
};
export { openMarginAction } from "./actions/openMargin.js";
export { eswapQuoteProvider } from "./providers/quoteProvider.js";
export * from "./constants.js";
export * from "./utils.js";
export * from "./schemas.js";
export * from "./wallet.js";
export * from "./abis.js";
