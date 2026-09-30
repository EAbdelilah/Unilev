/**
 * src/config.ts — single source of truth for the ESWAP integration harness.
 *
 * Everything chain-specific lives here so the other modules stay testable and
 * chain-agnostic. Values come from the environment; the literals below are the
 * audited Unichain (chain 130) deployment and are only used as a fallback so a
 * missing env var fails loudly at runtime instead of silently pointing at the
 * wrong chain.
 */

import { config as loadEnv } from 'dotenv'
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  type Chain,
  type PublicClient,
  type WalletClient,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import type { Address, Hex } from 'viem'

loadEnv()

// ─── Chain ────────────────────────────────────────────────────────────────────

export const UNICHAIN_ID = 130

export const unichain = defineChain({
  id: UNICHAIN_ID,
  name: 'Unichain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: [process.env.UNICHAIN_RPC_URL ?? 'https://mainnet.unichain.org'] },
  },
  blockExplorers: {
    default: { name: 'Unichain Explorer', url: 'https://uniscan.xyz' },
  },
  testnet: false,
})

/** Local anvil fork used by `test/Arbitrage.test.ts`. */
export const anvilChain = defineChain({
  id: 31337,
  name: 'Anvil (Unichain fork)',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['http://127.0.0.1:8545'] } },
})

// ─── Well-known Unichain addresses (chain 130) ───────────────────────────────

export const NATIVE_ETH: Address = '0x0000000000000000000000000000000000000000'

export const ADDRESSES = {
  /** v4-core PoolManager — all V4 swaps and free flash loans originate here. */
  poolManager: '0x1F98400000000000000000000000000000000004' as Address,
  /** Real USDC on Unichain (6 decimals). */
  usdc: '0x078D782b760474a361dDA0AF3839290b0EF57AD6' as Address,
  /** WETH — only used as the Chainlink oracle key for native ETH. */
  weth: '0x4200000000000000000000000000000000000006' as Address,
  /** Deployed ESWAP core (live deployment). */
  hook: '0xdF768b7eb6A76594b21177bb0Cd55bA433D290c8' as Address,
  router: '0xD123B24D7e6a8e8AD015523D7a32F3Ff2ca12B46' as Address,
  routerExt: '0xAC31Ee1c156Bfd6E3e23c3dc6F33B0c3ee311cd1' as Address,
  keeper: '0x47fe478bc096C5C98E3f9A47CBFB63673A2bC702' as Address,
  priceFeed: '0x57BFFfaa81ea509eFAe9174C9e6e04D4B15690Fb' as Address,
  /** Optional deployed adapters/venue. Empty on the live deployment. */
  adapter: (process.env.V4_ADAPTER_ADDRESS ?? '') as Address,
  quoter: (process.env.V4_QUOTER_ADDRESS ?? '') as Address,
  settlement: (process.env.V4_SETTLEMENT_ADDRESS ?? '') as Address,
  timelock: (process.env.V4_TIMELOCK_ADDRESS ?? '') as Address,
  executor: (process.env.ARBITRAGE_EXECUTOR_ADDRESS ?? '') as Address,
  venue: (process.env.ARBITRAGE_VENUE_ADDRESS ?? '') as Address,
  /** Aave V3-style pool used only as the executor's atomic funding source. */
  flashProvider: (process.env.FLASH_PROVIDER_ADDRESS ?? '') as Address,
} as const

// ─── Market configuration ────────────────────────────────────────────────────

export interface PoolConfig {
  currency0: Address
  currency1: Address
  fee: number
  tickSpacing: number
  hooks: Address
}

export interface MarketConfig {
  /** Base (debt) currency of the pair. */
  tokenIn: Address
  /** Collateral currency. */
  tokenOut: Address
  decimalsIn: number
  decimalsOut: number
  /** Hook-enabled accounting pool (fee 3000 on Unichain). */
  hookPool: PoolConfig
  /** Deep physical pool the hook routes fills through (fee 500 on Unichain). */
  standardPool: PoolConfig
  /** Fee tier registered in the adapter's pool registry. */
  adapterFeeTier: number
}

/**
 * Live Unichain ETH/USDC market.
 *
 * Note this is NATIVE ETH / USDC, not WETH / USDC: the deployed accounting pool
 * uses `address(0)` as currency0 and the deployment script wires the WETH oracle
 * key separately. `requireStandardPool` is false for the live hook pool, so the
 * bare WETH/USDC pool on the chain is irrelevant to execution.
 */
export const ETH_USDC: MarketConfig = {
  tokenIn: ADDRESSES.usdc,
  tokenOut: NATIVE_ETH,
  decimalsIn: 6,
  decimalsOut: 18,
  hookPool: {
    currency0: NATIVE_ETH,
    currency1: ADDRESSES.usdc,
    fee: 3000,
    tickSpacing: 60,
    hooks: ADDRESSES.hook,
  },
  standardPool: {
    currency0: NATIVE_ETH,
    currency1: ADDRESSES.usdc,
    fee: 500,
    tickSpacing: 10,
    hooks: NATIVE_ETH,
  },
  adapterFeeTier: 3000,
}

// ─── Cost model (must mirror the deployed contracts) ─────────────────────────

export const COSTS = {
  /** ESWAP protocol toll charged on the leveraged open (10 bps, set live). */
  protocolFeeBps: 10,
  /** Physical (deep) pool fee — 500 = 0.05%. */
  standardPoolFeeBps: Number(ETH_USDC.standardPool.fee) / 100,
  /** Hook accounting pool fee — informational; the physical leg pays this. */
  hookPoolFeeBps: Number(ETH_USDC.hookPool.fee) / 100,
  /** Flash premium ceiling the executor will accept, in bps. */
  maxFlashPremiumBps: 5,
  /** Native gas price on Unichain, in gwei. Overridable for what-if runs. */
  gasPriceGwei: Number(process.env.GAS_PRICE_GWEI ?? 0.001),
} as const

/** Aggregate trading cost on both the open and the close, in bps. */
export const ROUND_TRIP_COST_BPS =
  COSTS.protocolFeeBps * 2 + COSTS.standardPoolFeeBps * 2 + COSTS.maxFlashPremiumBps

// ─── Gas budgets (from the integration spec) ─────────────────────────────────

export const GAS_BUDGET = {
  /** Overhead of the leveraged open itself, excluding the flash unwind. */
  openOverhead: 110_000n,
  /** Whole flash -> open -> unwind -> repay loop. */
  fullLoop: 320_000n,
} as const

/** Hard ceilings mirrored from the executor's owner-set limits. */
export const LIMITS = {
  maxFlashAmount: BigInt(process.env.MAX_FLASH_AMOUNT ?? 5_000_000_000), // 5,000 USDC (6dp)
  maxLeverage: Number(process.env.MAX_LEVERAGE ?? 5),
  maxPremiumBps: Number(process.env.MAX_PREMIUM_BPS ?? COSTS.maxFlashPremiumBps),
} as const

/** Health canary size band, in the canary asset's base units. */
export const CANARY = {
  minMarginIn: 1_000_000n, // $1 at 6dp
  maxMarginIn: 5_000_000n, // $5 at 6dp
  /** Default canary notional: $2. */
  defaultMarginIn: 2_000_000n,
  leverage: 2,
} as const

// ─── Clients ─────────────────────────────────────────────────────────────────

export function rpcUrl(): string {
  const url = process.env.UNICHAIN_RPC_URL
  if (!url) throw new Error('UNICHAIN_RPC_URL is not set')
  return url
}

export function publicClient(chain: Chain = unichain): PublicClient {
  return createPublicClient({ chain, transport: http(rpcUrl()) })
}

export function walletClient(chain: Chain = unichain): WalletClient {
  const pk = process.env.PRIVATE_KEY
  if (!pk) throw new Error('PRIVATE_KEY is not set')
  return createWalletClient({ chain, transport: http(rpcUrl()), account: privateKeyToAccount(pk as Hex) })
}

/** Ordered list of live-deployment gaps, surfaced by the monitor at boot. */
export function deploymentGaps(): string[] {
  const gaps: string[] = []
  if (!ADDRESSES.adapter) gaps.push('V4_ADAPTER_ADDRESS')
  if (!ADDRESSES.quoter) gaps.push('V4_QUOTER_ADDRESS')
  if (!ADDRESSES.settlement) gaps.push('V4_SETTLEMENT_ADDRESS')
  if (!ADDRESSES.timelock) gaps.push('V4_TIMELOCK_ADDRESS')
  if (!ADDRESSES.executor) gaps.push('ARBITRAGE_EXECUTOR_ADDRESS')
  if (!ADDRESSES.venue) gaps.push('ARBITRAGE_VENUE_ADDRESS')
  if (!ADDRESSES.flashProvider) gaps.push('FLASH_PROVIDER_ADDRESS')
  return gaps
}

/** True when the harness is allowed to broadcast anything at all. */
export function broadcastEnabled(): boolean {
  return process.env.ALLOW_BROADCAST === 'true'
}