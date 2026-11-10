/**
 * Eswap protocol constants — Base Mainnet (chainId 8453).
 *
 * Defaults are the LIVE deployment verified on-chain 2026-11-03. All values
 * can be overridden at agent startup via runtime settings:
 *   ESWAP_HOOK_ADDRESS / ESWAP_ROUTER_ADDRESS / BASE_RPC_URL.
 */
import type { Address } from "viem";
import { isAddress } from "viem";

export const ESWAP_CHAIN_ID = 8453;
export const ESWAP_NETWORK_ID = "base-mainnet";
export const ESWAP_EXPLORER_TX_URL = "https://basescan.org/tx" as const;

const DEFAULT_HOOK_ADDRESS: Address = "0xe33A630503c640143126BBF222a82689D49b50c8";
const DEFAULT_ROUTER_ADDRESS: Address = "0xD3360D67E366Cac21a1c18fC9100B93be79e1437";
export const BASE_POOL_MANAGER_ADDRESS: Address = "0x498581fF718922c3f8e6A244956aF099B2652b2b";
export const DEFAULT_RPC_URL = "https://mainnet.base.org" as const;

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

/** Illustrative comparison benchmark for the carry-savings stat (12% APR borrow venue). */
export const CARRY_BENCHMARK_APR_BPS = 1200n;
export const CARRY_BENCHMARK_DAYS = 7n;

/** Fixed spot-margin leverage shipped by this plugin. */
export const DEFAULT_LEVERAGE = 5;
export const DEFAULT_SLIPPAGE_TOLERANCE_BPS = 50;

/** Matches router `DEFAULT_DEADLINE_SLACK` (15 min). */
export const DEFAULT_TX_DEADLINE_SECONDS = 900;

export const MAX_UINT256 = 2n ** 256n - 1n;

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

export const ESWAP_PAIRS: Record<EswapPairId, EswapPairConfig> = {
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

export type EswapPairId = "WETH/USDC" | "WBTC/USDC";

export function hookPoolKey(pair: EswapPairConfig, hook: Address): PoolKeyTuple {
  return [pair.base, pair.quote, pair.hookPoolFee, pair.hookPoolTickSpacing, hook];
}

export function standardPoolKey(pair: EswapPairConfig): PoolKeyTuple {
  return [pair.base, pair.quote, 500, 10, "0x0000000000000000000000000000000000000000"];
}

/**
 * Resolves deployment settings (with defaults). Ownership of the actual
 * settings store (`runtime.getSetting`) is in `settings.ts`; this function
 * is the pure part used by tests.
 */
export function resolveDeploymentWith(
  hookSetting: string | null | undefined,
  routerSetting: string | null | undefined,
): EswapDeployment {
  const deployment = {
    hook: toAddress(hookSetting) ?? DEFAULT_HOOK_ADDRESS,
    router: toAddress(routerSetting) ?? DEFAULT_ROUTER_ADDRESS,
  };
  return deployment;
}

function toAddress(value: string | null | undefined): Address | null {
  if (typeof value !== "string") {
    return null;
  }
  return isAddress(value.trim()) ? (value.trim() as Address) : null;
}
