/**
 * Eswap protocol constants — Base Mainnet (chainId 8453).
 *
 * Defaults are the LIVE deployment verified on-chain 2026-11-03. All values
 * can be overridden at agent startup via runtime settings:
 *   ESWAP_HOOK_ADDRESS / ESWAP_ROUTER_ADDRESS / BASE_RPC_URL.
 */
import type { Address } from "viem";
export declare const ESWAP_CHAIN_ID = 8453;
export declare const ESWAP_NETWORK_ID = "base-mainnet";
export declare const ESWAP_EXPLORER_TX_URL: "https://basescan.org/tx";
export declare const BASE_POOL_MANAGER_ADDRESS: Address;
export declare const DEFAULT_RPC_URL: "https://mainnet.base.org";
/** Registry contracts (ERC-20 tokens). */
export declare const USDC_ADDRESS: Address;
export declare const WETH_ADDRESS: Address;
export declare const WBTC_ADDRESS: Address;
/** Token decimals (explicit — never assume 18). */
export declare const USDC_DECIMALS = 6;
export declare const WETH_DECIMALS = 18;
export declare const WBTC_DECIMALS = 8;
/** Flat protocol fee: 0.10% (10 bps) of notional, settled into `protocolFees`. */
export declare const PROTOCOL_FEE_BPS = 10n;
/** Illustrative comparison benchmark for the carry-savings stat (12% APR borrow venue). */
export declare const CARRY_BENCHMARK_APR_BPS = 1200n;
export declare const CARRY_BENCHMARK_DAYS = 7n;
/** Fixed spot-margin leverage shipped by this plugin. */
export declare const DEFAULT_LEVERAGE = 5;
export declare const DEFAULT_SLIPPAGE_TOLERANCE_BPS = 50;
/** Matches router `DEFAULT_DEADLINE_SLACK` (15 min). */
export declare const DEFAULT_TX_DEADLINE_SECONDS = 900;
export declare const MAX_UINT256: bigint;
/** Hook (margin/accounting) pool key: [currency0, currency1, fee, tickSpacing, hooks]. */
export type PoolKeyTuple = readonly [Address, Address, number, number, Address];
export interface EswapDeployment {
    readonly hook: Address;
    readonly router: Address;
}
export interface EswapPairConfig {
    readonly id: "WETH/USDC" | "WBTC/USDC";
    readonly base: Address;
    readonly baseSymbol: "WETH" | "WBTC";
    readonly baseDecimals: number;
    readonly quote: Address;
    readonly quoteSymbol: "USDC";
    readonly quoteDecimals: number;
    /** Hook pool registered live: fee 3000, tickSpacing 60. */
    readonly hookPoolFee: 3000;
    readonly hookPoolTickSpacing: 60;
    /** LONG = buy base with USDC = currency1 -> currency0 → zeroForOne:false on both pairs. */
    readonly longZeroForOne: false;
    /** Verified on-chain 2026-11-03: WETH/USDC configured (500/10); WBTC/USDC NOT yet. */
    readonly fillVenueConfiguredInOut: boolean;
}
export declare const ESWAP_PAIRS: Record<EswapPairId, EswapPairConfig>;
export type EswapPairId = "WETH/USDC" | "WBTC/USDC";
export declare function hookPoolKey(pair: EswapPairConfig, hook: Address): PoolKeyTuple;
export declare function standardPoolKey(pair: EswapPairConfig): PoolKeyTuple;
/**
 * Resolves deployment settings (with defaults). Ownership of the actual
 * settings store (`runtime.getSetting`) is in `settings.ts`; this function
 * is the pure part used by tests.
 */
export declare function resolveDeploymentWith(hookSetting: string | null | undefined, routerSetting: string | null | undefined): EswapDeployment;
//# sourceMappingURL=constants.d.ts.map