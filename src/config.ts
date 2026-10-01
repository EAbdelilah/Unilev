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
  /**
   * Balancer V2 Vault. A canonical singleton deployed at the same address on
   * every network, so this literal is chain-constant. Preferred flash source on
   * Unichain: V2 flash loans carry a zero premium, which removes the premium
   * leg from the round trip's cost floor entirely.
   */
  balancerVault: '0xBA12222222228d8Ba445958a75a0704d566BF2C8' as Address,
  /** Optional deployed adapters/venue. Empty on the live deployment. */
  adapter: (process.env.V4_ADAPTER_ADDRESS ?? '') as Address,
  quoter: (process.env.V4_QUOTER_ADDRESS ?? '') as Address,
  settlement: (process.env.V4_SETTLEMENT_ADDRESS ?? '') as Address,
  timelock: (process.env.V4_TIMELOCK_ADDRESS ?? '') as Address,
  executor: (process.env.ARBITRAGE_EXECUTOR_ADDRESS ?? '') as Address,
  venue: (process.env.ARBITRAGE_VENUE_ADDRESS ?? '') as Address,
  /**
 * Atomic funding source for the executor.
 *
 * Balancer V2 Vault only. Aave V3 is deliberately NOT configurable here: the
 * address checked on Unichain (`0x794a…14aD`) has no bytecode, so it is an
 * Ethereum-mainnet address that does not exist on this chain. Keeping it
 * reachable through an env var meant a typo, a stale `.env`, or a copy-pasted
 * mainnet address would silently produce an executor whose every flash reverts
 * in the callback rather than at construction. An unset provider is now the only
 * way to get a non-Balancer executor, and it fails fast.
 */
flashProvider: '0xBA12222222228d8Ba445958a75a0704d566BF2C8' as Address,
} as const

/**
 * Flash-loan entrypoint of the deployed executor.
 *
 * `1` = Balancer V2. The contract's `FlashMode` enum still declares `0` (Aave),
 * but the off-chain layer can no longer select it — see `flashProvider` above.
 * The variant is left in place rather than renumbered because the value is
 * encoded into the executor's storage and reordering an enum would change the
 * meaning of an already-deployed contract.
 */
export const FLASH_MODE = {
  balancer: 1,
} as const

export type FlashModeName = keyof typeof FLASH_MODE

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
  /**
   * Flash premium ceiling the executor will accept, in bps.
   *
   * Balancer V2 charges no flash premium, so a Balancer-funded round trip's
   * realised premium is 0. This stays at 5 bps because it is a *ceiling* the
   * contract enforces, not a forecast; `actualFlashPremiumBps` below is what the
   * cost model should charge.
   */
  maxFlashPremiumBps: 5,
  /** Realised premium for the configured provider. Balancer V2 = 0. */
  actualFlashPremiumBps: Number(process.env.FLASH_PREMIUM_BPS ?? 0),
  /** Native gas price on Unichain, in gwei. Overridable for what-if runs. */
  gasPriceGwei: Number(process.env.GAS_PRICE_GWEI ?? 0.001),
} as const

/** Aggregate trading cost on both the open and the close, in bps. */
export const ROUND_TRIP_COST_BPS =
  COSTS.protocolFeeBps * 2
  + COSTS.standardPoolFeeBps * 2
  + COSTS.actualFlashPremiumBps

/**
 * Slippage floors applied to every leg.
 *
 * The default of 50 bps (0.5%) is a *floor*, never a target: a venue that fills
 * better than the floor is fine, one that fills worse is rejected. The contract
 * enforces the same numbers on-chain via `canarySlippageBps` / the plan's
 * `minOpenOut` / `minCloseOut` / `minVenueOut`, so an off-chain slippage change
 * cannot silently disable the on-chain protection.
 */
export const SLIPPAGE = {
  defaultBps: Number(process.env.SLIPPAGE_BPS ?? 50),
  /** Hard ceiling; the contract rejects anything >= 10_000. */
  maxBps: 5_000,
} as const

/**
 * Convert an L2 gas bill into basis points of a notional, so gas can be compared
 * against fee-based costs on a single scale.
 *
 * @param gasUnits    gas the transaction will consume
 * @param gasPriceGwei L2 gas price, in gwei
 * @param notional    notional being traded, in `tokenIn` base units
 * @param decimalsIn  `tokenIn` decimals
 */
export function gasCostBps(
  gasUnits: bigint,
  gasPriceGwei: number,
  notional: bigint,
  decimalsIn: number,
): number {
  if (notional <= 0n) return Number.POSITIVE_INFINITY
  // gas * gwei-per-gas = wei spent; compare against notional scaled to wei.
  const weiSpent = gasUnits * BigInt(Math.round(gasPriceGwei * 1e9))
  const notionalWei = notional * 10n ** BigInt(18 - decimalsIn)
  if (notionalWei === 0n) return Number.POSITIVE_INFINITY
  return Number((weiSpent * 10_000n) / notionalWei) / 100
}

// ─── Gas budgets (measured, not aspirational) ────────────────────────────────

/**
 * Gas figures, replaced with what the fork actually charges.
 *
 * The integration spec quoted `320,000` for the whole flash -> open -> unwind ->
 * repay loop and `110,000` for the open overhead. Neither is reachable. Measured
 * on the Unichain fork at current contract sizes: the canary, which is an open
 * AND a close in a single transaction, costs ~1.16M, and the open alone
 * estimates ~1.36M.
 *
 * This mattered because these numbers feed `gasCostBps` in the net-EV
 * calculation. A budget understated by ~4x makes every candidate trade look ~4x
 * cheaper than it is, so the EV gate would admit trades that lose money — the
 * exact failure the gate exists to prevent. An aspirational budget is not a
 * conservative one; it is an error that makes the strategy look viable.
 *
 * The original figures are kept below purely so the discrepancy stays visible in
 * review rather than being quietly deleted.
 */
export const GAS_BUDGET = {
  /** Measured: open + close in one tx (the canary). */
  measuredCanaryRoundTrip: 1_161_132n,
  /** Measured: the leveraged open on its own. */
  measuredOpenOnly: 1_360_318n,
  /**
   * Budget for a full flash -> open -> unwind -> repay loop: the canary's two
   * hook legs plus a same-size external venue unwind, with ~15% headroom for the
   * extra swap and the premium accounting the canary does not perform.
   */
  fullLoop: 1_400_000n,
  /** Alias of `measuredOpenOnly`, kept for callers that want the open alone. */
  openOverhead: 1_360_318n,
  /** The spec's figures, retained only to document what was wrong. */
  specFullLoop: 320_000n,
  specOpenOverhead: 110_000n,
} as const

/**
 * Gas the router requires to be left for the collateral deploy.
 *
 * This is a per-call floor, not a total-transaction budget: the router checks it
 * before a swap it is about to make. A transaction that consumes more than this
 * is not rejected outright, but a transaction that leaves less cannot open a
 * position. It is reported separately from `GAS_BUDGET` because the two are not
 * comparable quantities and conflating them is how a 350,000 "budget" came to be
 * read as a total.
 */
export const ROUTER_GAS_FLOOR = 350_000n

/** Hard ceilings mirrored from the executor's owner-set limits. */
export const LIMITS = {
  maxFlashAmount: BigInt(process.env.MAX_FLASH_AMOUNT ?? 5_000_000_000), // 5,000 USDC (6dp)
  maxLeverage: Number(process.env.MAX_LEVERAGE ?? 5),
  maxPremiumBps: Number(process.env.MAX_PREMIUM_BPS ?? COSTS.maxFlashPremiumBps),
} as const

/**
 * Canary size, in the canary asset's base units (USDC, 6dp).
 *
 * $0.01 = 10,000 base units. The canary is a proof of life, not a position: its
 * job is to prove the open/close/unwind machinery settles and the invariants
 * hold, which costs ~1.16M gas regardless of size. Sizing it at $1 spent 100x the
 * capital for identical evidence and made a routine health check a
 * non-trivial balance-sheet event on a live account.
 *
 * The floor is genuinely usable at this size: the canary's own measured close
 * payout is ~996,002 units on a 1,000,000 margin, so the round trip returns
 * real, non-dust numbers that the floors can actually be checked against.
 */
export const CANARY = {
  minMarginIn: 10_000n, // $0.01 at 6dp
  maxMarginIn: 10_000n, // $0.01 — deliberately not a band
  /** Default canary margin: $0.01, the smallest useful proof of life. */
  defaultMarginIn: 10_000n,
  leverage: 2,
  /** Slippage floors the contract applies to both canary legs. */
  openSlippageBps: SLIPPAGE.defaultBps,
  closeSlippageBps: SLIPPAGE.defaultBps,
  /**
   * Notional the contract quotes on-chain to derive those floors.
   *
   * MUST equal `defaultMarginIn`: `canaryExecute` reverts `QuoteMarginMismatch`
   * otherwise, because the open floor is derived from this notional and would
   * otherwise belong to a different trade.
   */
  quoteMarginIn: 10_000n,
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
  return gaps
}

/** True when the harness is allowed to broadcast anything at all. */
export function broadcastEnabled(): boolean {
  return process.env.ALLOW_BROADCAST === 'true'
}