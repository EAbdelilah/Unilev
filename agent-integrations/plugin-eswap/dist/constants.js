import { isAddress } from "viem";
export const ESWAP_CHAIN_ID = 8453;
export const ESWAP_NETWORK_ID = "base-mainnet";
export const ESWAP_EXPLORER_TX_URL = "https://basescan.org/tx";
const DEFAULT_HOOK_ADDRESS = "0xe33A630503c640143126BBF222a82689D49b50c8";
const DEFAULT_ROUTER_ADDRESS = "0xD3360D67E366Cac21a1c18fC9100B93be79e1437";
export const BASE_POOL_MANAGER_ADDRESS = "0x498581fF718922c3f8e6A244956aF099B2652b2b";
export const DEFAULT_RPC_URL = "https://mainnet.base.org";
/** Registry contracts (ERC-20 tokens). */
export const USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
export const WETH_ADDRESS = "0x4200000000000000000000000000000000000006";
export const WBTC_ADDRESS = "0x0555E30da8f98308EdB960aa94C0Db47230d2B9c";
/** Token decimals (explicit — never assume 18). */
export const USDC_DECIMALS = 6;
export const WETH_DECIMALS = 18;
export const WBTC_DECIMALS = 8;
/** Flat protocol fee: 0.10% (10 bps) of notional, settled into `protocolFees`. */
export const PROTOCOL_FEE_BPS = 10n;
/** Illustrative comparison benchmark for the carry-savings stat (12% APR borrow venue). */
export const CARRY_BENCHMARK_APR_BPS = 1200n;
export const CARRY_BENCHMARK_DAYS = 7n;
/** Fixed spot-margin leverage shipped by this plugin. */
export const DEFAULT_LEVERAGE = 5;
export const DEFAULT_SLIPPAGE_TOLERANCE_BPS = 50;
/** Matches router `DEFAULT_DEADLINE_SLACK` (15 min). */
export const DEFAULT_TX_DEADLINE_SECONDS = 900;
export const MAX_UINT256 = 2n ** 256n - 1n;
export const ESWAP_PAIRS = {
    "WETH/USDC": {
        id: "WETH/USDC",
        base: WETH_ADDRESS,
        baseSymbol: "WETH",
        baseDecimals: WETH_DECIMALS,
        quote: USDC_ADDRESS,
        quoteSymbol: "USDC",
        quoteDecimals: USDC_DECIMALS,
        hookPoolFee: 3000,
        hookPoolTickSpacing: 60,
        longZeroForOne: false,
        fillVenueConfiguredInOut: true,
    },
    "WBTC/USDC": {
        id: "WBTC/USDC",
        base: WBTC_ADDRESS,
        baseSymbol: "WBTC",
        baseDecimals: WBTC_DECIMALS,
        quote: USDC_ADDRESS,
        quoteSymbol: "USDC",
        quoteDecimals: USDC_DECIMALS,
        hookPoolFee: 3000,
        hookPoolTickSpacing: 60,
        longZeroForOne: false,
        fillVenueConfiguredInOut: false,
    },
};
export function hookPoolKey(pair, hook) {
    return [pair.base, pair.quote, pair.hookPoolFee, pair.hookPoolTickSpacing, hook];
}
export function standardPoolKey(pair) {
    return [pair.base, pair.quote, 500, 10, "0x0000000000000000000000000000000000000000"];
}
/**
 * Resolves deployment settings (with defaults). Ownership of the actual
 * settings store (`runtime.getSetting`) is in `settings.ts`; this function
 * is the pure part used by tests.
 */
export function resolveDeploymentWith(hookSetting, routerSetting) {
    const deployment = {
        hook: toAddress(hookSetting) ?? DEFAULT_HOOK_ADDRESS,
        router: toAddress(routerSetting) ?? DEFAULT_ROUTER_ADDRESS,
    };
    return deployment;
}
function toAddress(value) {
    if (typeof value !== "string") {
        return null;
    }
    return isAddress(value.trim()) ? value.trim() : null;
}
