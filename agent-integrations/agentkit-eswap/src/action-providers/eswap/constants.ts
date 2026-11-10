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
import { isAddress } from "viem";

export const ESWAP_CHAIN_ID = 8453;
export const ESWAP_NETWORK_ID = "base-mainnet";
export const ESWAP_EXPLORER_URL = "https://basescan.org" as const;
export const ESWAP_EXPLORER_TX_URL = "https://basescan.org/tx" as const;

/** Verified live on-chain 2026-11-03 (getHookPermissions/openInterestCapacity/standardPoolKeys all respond). */
const DEFAULT_HOOK_ADDRESS: Address = "0xe33A630503c640143126BBF222a82689D49b50c8";
/** Live router — v4 unlock flow + margin accounting entrypoint (quoteExactInput/swapMultiPool/escrow). */
const DEFAULT_ROUTER_ADDRESS: Address = "0xD3360D67E366Cac21a1c18fC9100B93be79e1437";
/** Canonical Base Uniswap v4 PoolManager (the singleton the hook is bound to). */
export const BASE_POOL_MANAGER_ADDRESS: Address = "0x498581fF718922c3f8e6A244956aF099B2652b2b";

/** Registry contracts (ERC-20 tokens). */
export const USDC_ADDRESS: Address = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
export const WETH_ADDRESS: Address = "0x4200000000000000000000000000000000000006";
export const WBTC_ADDRESS: Address = "0x0555E30da8f98308EdB960aa94C0Db47230d2B9c";

/** Token decimals (explicit — never assume 18). */
export const USDC_DECIMALS = 6;
export const WETH_DECIMALS = 18;
export const WBTC_DECIMALS = 8;

/** Flat protocol fee: 0.10% (10 bps) of notional, settled into `protocolFees`. */
export const PROTOCOL_FEE_BPS = 10n;

/**
 * Illustrative comparison benchmark used ONLY for the "carry saved" stat the
 * quote reports: a 12%-APR continuous-borrow venue (Aave/Perp style).
 * Eswap itself charges 0.00% daily borrow carry — lenders are made whole by
 * the solver-escrow model, not by ongoing trader interest.
 */
export const CARRY_BENCHMARK_APR_BPS = 1200n;
export const CARRY_BENCHMARK_DAYS = 7n;

/** Fixed spot-margin leverage shipped in this provider (hook caps at 20x). */
export const DEFAULT_LEVERAGE = 5;
export const DEFAULT_SLIPPAGE_TOLERANCE_BPS = 50;

/** Matches router `DEFAULT_DEADLINE_SLACK` (15 min) used across default opens. */
export const DEFAULT_TX_DEADLINE_SECONDS = 900;

/** MaxUint256 approval target used for token approvals to the router. */
export const MAX_UINT256 = 2n ** 256n - 1n;

/** Hook (margin/accounting) pool key for a pair: [currency0, currency1, fee, tickSpacing, hooks]. */
export type PoolKeyTuple = readonly [Address, Address, number, number, Address];

export interface EswapDeployment {
  readonly hook: Address;
  readonly router: Address;
}

function envOrUndefined(key: string): string | undefined {
  try {
    return process.env[key];
  } catch {
    return undefined;
  }
}

function toAddress(value: string | undefined): Address | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  if (!isAddress(trimmed)) {
    return undefined;
  }
  return trimmed as Address;
}

/**
 * Resolves the deployment (hook + router), honoring `ESWAP_HOOK_ADDRESS` /
 * `ESWAP_ROUTER_ADDRESS` env overrides; falls back to the verified defaults.
 */
export function resolveEswapDeployment(): EswapDeployment {
  const hook = toAddress(envOrUndefined("ESWAP_HOOK_ADDRESS")) ?? DEFAULT_HOOK_ADDRESS;
  const router = toAddress(envOrUndefined("ESWAP_ROUTER_ADDRESS")) ?? DEFAULT_ROUTER_ADDRESS;
  return { hook, router };
}

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

export const ESWAP_PAIRS: Record<"WETH/USDC" | "WBTC/USDC", EswapPairConfig> = {
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

export type EswapPairId = keyof typeof ESWAP_PAIRS;

/** Builds the full hook PoolKey tuple for a pair against a given hook address. */
export function hookPoolKey(pair: EswapPairConfig, hook: Address): PoolKeyTuple {
  return [pair.base, pair.quote, pair.hookPoolFee, pair.hookPoolTickSpacing, hook];
}

/**
 * Default deep-fill PoolKey (currency0, currency1, 500, 10, hooks=0).
 * The hook itself exposes `standardPoolKeys(poolId)` — callers should prefer
 * the live read when available and fall back to this default.
 */
export function standardPoolKey(pair: EswapPairConfig): PoolKeyTuple {
  return [pair.base, pair.quote, 500, 10, "0x0000000000000000000000000000000000000000"];
}
