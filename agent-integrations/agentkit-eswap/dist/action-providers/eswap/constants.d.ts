/**
 * Eswap protocol constants — Base Mainnet (chainId 8453).
 *
 * ┌─────────────────────────────────────────────────────────────────────────────┐
 * │ ADDRESSES: default here = LIVE deployment, verified on-chain 2026-11-03. │
 * │ Override via `ESWAP_HOOK_ADDRESS` / `ESWAP_ROUTER_ADDRESS` env vars at │
 * │ redeploy time — do NOT hardcode stale addresses into agents. │
 * └─────────────────────────────────────────────────────────────────────────────┘
 */
import type { Address } from "viem";
export declare const ESWAP_CHAIN_ID = 8453;
export declare const ESWAP_NETWORK_ID = "base-mainnet";
export declare const ESWAP_EXPLORER_URL: "https://basescan.org";
export declare const ESWAP_EXPLORER_TX_URL: "https://basescan.org/tx";
/** Canonical Base Uniswap v4 PoolManager (the singleton the hook is bound to). */
export declare const BASE_POOL_MANAGER_ADDRESS: Address;
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
/**
 * Illustrative comparison benchmark used ONLY for the "carry saved" stat the
 * quote reports: a 12%-APR continuous-borrow venue (Aave/Perp style).
 * Eswap itself charges 0.00% daily borrow carry — lenders are made whole by
 * the solver-escrow model, not by ongoing trader interest.
 */
export declare const CARRY_BENCHMARK_APR_BPS = 1200n;
export declare const CARRY_BENCHMARK_DAYS = 7n;
/** Fixed spot-margin leverage shipped in this provider (hook caps at 20x). */
export declare const DEFAULT_LEVERAGE = 5;
export declare const DEFAULT_SLIPPAGE_TOLERANCE_BPS = 50;
/** Matches router `DEFAULT_DEADLINE_SLACK` (15 min) used across default opens. */
export declare const DEFAULT_TX_DEADLINE_SECONDS = 900;
/** MaxUint256 approval target used for token approvals to the router. */
export declare const MAX_UINT256: bigint;
/** Hook (margin/accounting) pool key for a pair: [currency0, currency1, fee, tickSpacing, hooks]. */
export type PoolKeyTuple = readonly [Address, Address, number, number, Address];
export interface EswapDeployment {
    readonly hook: Address;
    readonly router: Address;
}
/**
 * Resolves the deployment (hook + router), honoring `ESWAP_HOOK_ADDRESS` /
 * `ESWAP_ROUTER_ADDRESS` env overrides; falls back to the verified defaults.
 */
export declare function resolveEswapDeployment(): EswapDeployment;
export interface EswapPairConfig {
    /** e.g. `WETH/USDC`. */
    readonly id: "WETH/USDC" | "WBTC/USDC";
    /** Base asset being bought (leveraged leg). */
    readonly base: Address;
    readonly baseSymbol: "WETH" | "WBTC";
    readonly baseDecimals: number;
    /** Quote asset committed as margin (always USDC on Base). */
    readonly quote: Address;
    readonly quoteSymbol: "USDC";
    readonly quoteDecimals: number;
    /** Hook pool key registered on the live deployment (fee 3000, tickSpacing 60). */
    readonly hookPoolFee: 3000;
    readonly hookPoolTickSpacing: 60;
    /**
     * v4 swap direction for a LONG: buy the base asset with the quote (USDC).
     * v4 orders currencies by address: WETH(0x42..) and WBTC(0x05..) are both
     * currency0 vs USDC(0x83..). `zeroForOne = false` therefore means
     * currency1 (USDC) -> currency0 (base) = opening a LONG.
     * Matches the live script: `swapMultiPoolForAggregator(..., false, ...)` for a
     * WETH/USDC long.
     */
    readonly longZeroForOne: false;
    /**
     * Whether the deep-fill (standard) pool has been configured by governance on
     * the live deployment. Verified 2026-11-03: WETH/USDC is configured
     * (500/10), WBTC/USDC is NOT yet (`standardPoolKeys` returns zeros).
     */
    readonly fillVenueConfiguredInOut: boolean;
}
export declare const ESWAP_PAIRS: Record<"WETH/USDC" | "WBTC/USDC", EswapPairConfig>;
export type EswapPairId = keyof typeof ESWAP_PAIRS;
/** Builds the full hook PoolKey tuple for a pair against a given hook address. */
export declare function hookPoolKey(pair: EswapPairConfig, hook: Address): PoolKeyTuple;
/**
 * Default deep-fill PoolKey (currency0, currency1, 500, 10, hooks=0).
 * The hook itself exposes `standardPoolKeys(poolId)` — callers should prefer
 * the live read when available and fall back to this default.
 */
export declare function standardPoolKey(pair: EswapPairConfig): PoolKeyTuple;
//# sourceMappingURL=constants.d.ts.map