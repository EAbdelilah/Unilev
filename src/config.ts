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

/**
 * Read a required address from the environment, failing loudly when it is absent.
 *
 * Used for contracts that a redeploy can move. A literal fallback in these slots once
 * made the harness call a dead router and surface the problem as a confusing
 * `Unauthorized()` from deep inside the hook; naming the missing variable turns that
 * into an immediate, actionable failure.
 */
function requiredEnvAddress(name: string): Address {
  const raw = process.env[name]?.trim()
  if (!raw) {
    throw new Error(
      `${name} is not set. It is required: this contract is redeployed when its ` +
        `logic changes, so a compiled-in fallback address silently rots and points ` +
        `at a dead contract. Add ${name} to .env.`,
    )
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(raw)) {
    throw new Error(`${name} is not a valid address: ${raw}`)
  }
  return raw as Address
}

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
  /**
   * Deployed ESWAP core (live deployment).
   *
   * 0x4Bd5..d0C8 is the settlement-capable rebuild: its Logic1 delegatecalls
   * Logic2 0x581E..0aB (24,458B), which carries the settlement-liveness fix.
   * The predecessor 0xdF76..290c8 is left deployed and configured as a rollback
   * target -- it stays functional, so this is an upgrade rather than a rescue.
   *
   * Every one of the 15 config scalars was diffed against the predecessor and
   * matched exactly; the standard (hookless) pool key is byte-identical.
   */
  hook: '0x4Bd545f6438a27614098984E1322939af53AD0C8' as Address,
  /**
   * Router/Ext/Keeper are REQUIRED and fail fast when unset.
   *
   * These three used to be hardcoded literals, which silently desynced the harness
   * from the chain: after the router was redeployed (to carry
   * QUOTE_EXECUTION_DISCOUNT_BPS) the fork harness kept driving the OLD router, so
   * every "wire the router" call landed on the stale contract and the canary died in
   * the hook's `onlyRouter` with `Unauthorized()` -- while the on-chain hook pointed
   * at the new one.
   *
   * A literal *fallback* is not a safe default here: a redeploy moves the address
   * again, and the failure mode is a silent call into a dead contract rather than an
   * error. So these are read from the environment and throw when missing, which
   * points at the exact variable to set.
   */
  router: requiredEnvAddress('V4_ROUTER_ADDRESS'),
  routerExt: requiredEnvAddress('V4_ROUTER_EXT_ADDRESS'),
  keeper: requiredEnvAddress('V4_KEEPER_ADDRESS'),
  priceFeed: '0x57BFFfaa81ea509eFAe9174C9e6e04D4B15690Fb' as Address,
  /**
   * Optional deployed adapters/venue. Empty on the live deployment.
   *
   * `balancerVault` was removed deliberately: Unichain has NO Balancer V2 Vault.
   * `0xBA12222222228d8Ba445958a75a0704d566BF2C8` is an unrelated 1,546-byte
   * contract on this chain with no `flashLoan` / `getPoolTokens`, so keeping it
   * around only invited code that could never work. The zero-premium funding source
   * is `InventoryFlashProvider` -- see `flashProvider` below.
   */
/** Deployed execution stack. All required; see {@link deploymentGaps}. */
  adapter: requiredEnvAddress('V4_ADAPTER_ADDRESS'),
  quoter: requiredEnvAddress('V4_QUOTER_ADDRESS'),
  settlement: (process.env.V4_SETTLEMENT_ADDRESS ?? '') as Address,
  timelock: (process.env.V4_TIMELOCK_ADDRESS ?? '') as Address,
  executor: requiredEnvAddress('ARBITRAGE_EXECUTOR_ADDRESS'),
  venue: requiredEnvAddress('ARBITRAGE_VENUE_ADDRESS'),
  /**
   * Atomic funding source for the executor. Must be an `InventoryFlashProvider` on
   * Unichain: the Balancer V2 Vault is not deployed on this chain (the canonical
   * `0xBA12222222228d8Ba445958a75a0704d566BF2C8` is an unrelated 1,546-byte
   * contract with no `flashLoan`), Morpho Blue is absent, and a V4 `flash()` source
   * is structurally impossible because it would hold the PoolManager lock across the
   * callback while the executor's router leg needs `unlock`. The provider is
   * immutable, so a wrong value here yields an executor whose every flash reverts
   * inside the callback rather than at construction. Hence `requiredEnvAddress`.
   */
  flashProvider: requiredEnvAddress('FLASH_PROVIDER_ADDRESS'),
} as const

/**
 * Flash-loan entrypoint of the deployed executor.
 *
 * `1` = the Balancer V2 `Vault.flashLoan` interface shape, which
 * `InventoryFlashProvider` implements. The provider is zero-premium and charges no
 * interest. The contract's `FlashMode` enum still declares `0` (Aave), but the
 * off-chain layer can no longer select it — see `flashProvider` above. The variant
 * is left in place rather than renumbered because the value is encoded into the
 * executor's storage and reordering an enum would change the meaning of an
 * already-deployed contract.
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
    // Must equal ADDRESSES.hook: the PoolId is keccak(currency0, currency1, fee,
    // tickSpacing, hooks), so a stale hooks field silently addresses the
    // predecessor's pool. The predecessor id was
    // 0x9aa5ebac305d4fd646bca230471bcb0df55d89b8b32e94559a0a7471b21ccaae.
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
 * AND a close in a single transaction, costs ~1.19M, and the open alone
 * estimates ~1.24M.
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
  /**
   * Measured at the deployed $0.01 canary size on the Unichain fork:
   * open + close in one transaction.
   *
   * Re-measured after the flash provider became the real `InventoryFlashProvider`
   * and `maxPremiumBps` dropped to 0. Re-measure whenever the open or close path
   * changes; these are observations, not guarantees.
   *
   * Re-measured again on the settlement-capable hook (`0x4Bd5..d0C8`) at
   * 1,185,089 — ~133k MORE than the 1,051,661 measured on the predecessor, and
   * higher than the doc comment above claims. The new Logic2 does strictly more
   * work (liquidation bookkeeping plus the settlement fix), so the older figure
   * understates the round trip by ~11%. That flows straight into `gasCostBps`
   * and therefore into the net-EV gate, where an understated gas cost is the
   * direction that admits losing trades, so the measurement is carried forward
   * rather than left flattering.
   */
  measuredCanaryRoundTrip: 1_185_089n,
  /**
   * Measured: the leveraged open on its own, via `estimateContractGas`.
   *
   * This is LARGER than the canary round trip, which is not a typo: the open is
   * the expensive leg (router unlock + hook accounting), while the close settles
   * against already-live state. A budget derived from the round trip would
   * under-provision the open, which is the leg actually broadcast.
   *
   * Re-measured on the settlement-capable hook at 1,239,388 (was 1,237,804).
   */
  measuredOpenOnly: 1_239_388n,
  /**
   * Budget for a full flash -> open -> unwind -> repay loop: the canary's two
   * hook legs plus a same-size external venue unwind, with ~15% headroom for the
   * extra swap and the premium accounting the canary does not perform.
   *
   * NOT YET MEASURED: the loop still reverts with `InvariantDrift` on economics, so
   * this figure is an estimate from the two measured legs plus the venue swap, not
   * an observation. Replace it with a measured value once the round trip settles.
   */
  fullLoop: 1_400_000n,
  /** Alias of `measuredOpenOnly`, kept for callers that want the open alone. */
  openOverhead: 1_237_804n,
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

/**
 * Components the arbitrage path cannot run without. A missing entry here is a
 * hard stop: the monitor refuses to quote rather than pricing a route it cannot
 * actually execute.
 *
 * `V4_SETTLEMENT_ADDRESS` / `V4_TIMELOCK_ADDRESS` are deliberately absent. They
 * name a CoW Protocol settlement contract and its timelock, which only the
 * *testnet* deployment profiles (`DeployUnichainSepoliaFull.s.sol`) ever
 * installed. The Unichain mainnet stack settles through the V4 PoolManager
 * directly, so reporting them as gaps cried wolf on every boot and would have
 * implied a missing contract that was never meant to exist.
 */
export function deploymentGaps(): string[] {
  const gaps: string[] = []
  if (!ADDRESSES.router) gaps.push('V4_ROUTER_ADDRESS')
  if (!ADDRESSES.routerExt) gaps.push('V4_ROUTER_EXT_ADDRESS')
  if (!ADDRESSES.keeper) gaps.push('V4_KEEPER_ADDRESS')
  if (!ADDRESSES.adapter) gaps.push('V4_ADAPTER_ADDRESS')
  if (!ADDRESSES.quoter) gaps.push('V4_QUOTER_ADDRESS')
  if (!ADDRESSES.executor) gaps.push('ARBITRAGE_EXECUTOR_ADDRESS')
  if (!ADDRESSES.venue) gaps.push('ARBITRAGE_VENUE_ADDRESS')
  if (!ADDRESSES.flashProvider) gaps.push('FLASH_PROVIDER_ADDRESS')
  return gaps
}

/**
 * True when the optional intent-settlement stack is configured. Reported
 * separately from {@link deploymentGaps} because it extends the protocol with
 * CoW-style fills rather than enabling the core margin path.
 */
export function intentSettlementConfigured(): boolean {
  return Boolean(ADDRESSES.settlement && ADDRESSES.timelock)
}

/** True when the harness is allowed to broadcast anything at all. */
export function broadcastEnabled(): boolean {
  return process.env.ALLOW_BROADCAST === 'true'
}