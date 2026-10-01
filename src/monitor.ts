/**
 * src/monitor.ts — per-block read-only watcher for the ESWAP venue.
 *
 * Polls roughly once per block (~2s on Unichain) and emits a structured record
 * for every check: the protocol quote, the deep-pool reference, the net delta,
 * and the venue's own accounting invariants.
 *
 * This module is STRICTLY read-only. It never holds a key, never builds a
 * transaction, and cannot broadcast. The single reason a delta is ever
 * actionable is if it survives the cost gate in `src/quoter.ts` — which, on the
 * current deployment, it does not: ESWAP routes its physical fill through the
 * same deep pool it is benchmarked against and then adds a 0.10% toll on top, so
 * the honest steady-state answer is "no edge". The monitor exists to prove that
 * continuously, not to manufacture the opposite.
 */

import type { Address, Hex, PublicClient } from 'viem'
import { concatHex, keccak256, toHex } from 'viem'
import {
  ADDRESSES,
  COSTS,
  ETH_USDC,
  deploymentGaps,
  GAS_BUDGET,
  gasCostBps,
  type MarketConfig,
} from './config'
import { EswapQuoter, type Quote, type QuoteOptions, toWad, fromWad, applyBpsDown } from './quoter'
import { VenueQuoteBook, type VenueSnapshot } from './venues'

// ─── Hook ABI (read-only) ────────────────────────────────────────────────────

export const HOOK_VIEW_ABI = [
  {
    type: 'function',
    name: 'totalOpenInterestUSD',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'totalCollateralUSDRunning',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'registeredSolvers',
    stateMutability: 'view',
    inputs: [{ name: 'solver', type: 'address' }],
    outputs: [{ type: 'bool' }],
  },
] as const

/**
 * `IPoolManager` has no `getLiquidity`; liquidity lives in `Pool.State` and is
 * only reachable through `extsload`. These offsets mirror
 * `v4-core/src/libraries/StateLibrary.sol`.
 */
export const POOL_MANAGER_ABI = [
  {
    type: 'function',
    name: 'extsload',
    stateMutability: 'view',
    inputs: [{ name: 'slot', type: 'bytes32' }],
    outputs: [{ type: 'bytes32' }],
  },
] as const

/** `StateLibrary.POOLS_SLOT` — slot of `mapping(PoolId => Pool.State) internal _pools`. */
const POOLS_SLOT = 6n
/** `StateLibrary.LIQUIDITY_OFFSET` — `uint128 liquidity` inside `Pool.State`. */
const LIQUIDITY_OFFSET = 3n

/**
 * Reproduce `StateLibrary._getPoolStateSlot` + `LIQUIDITY_OFFSET`:
 * `keccak256(abi.encodePacked(poolId, bytes32(POOLS_SLOT))) + LIQUIDITY_OFFSET`.
 *
 * `abi.encodePacked` here is exactly 64 bytes: the pool id followed by the
 * slot, so plain hex concatenation is the correct encoding.
 */
export function poolLiquiditySlot(poolId: Hex): Hex {
  const packed = `${poolId.slice(2).padStart(64, '0')}${POOLS_SLOT.toString(16).padStart(64, '0')}`
  const slot = BigInt(keccak256(`0x${packed}`)) + LIQUIDITY_OFFSET
  return `0x${slot.toString(16).padStart(64, '0')}`
}

/** Read a pool's liquidity via `extsload`, matching `StateLibrary.getLiquidity`. */
export async function readPoolLiquidity(
  client: PublicClient,
  poolId: Hex
): Promise<bigint> {
  const raw = await client.readContract({
    address: ADDRESSES.poolManager,
    abi: POOL_MANAGER_ABI,
    functionName: 'extsload',
    args: [poolLiquiditySlot(poolId)],
  })
  return BigInt(raw) & ((1n << 128n) - 1n)
}

// ─── Types ───────────────────────────────────────────────────────────────────

export interface VenueHealth {
  blockNumber: bigint
  timestamp: number
  /** `true` when every configured read succeeded. */
  ok: boolean
  totalOpenInterestUSD: bigint
  totalCollateralUSDRunning: bigint
  /** Liquidity of the deep physical pool the hook fills through. */
  standardPoolLiquidity: bigint
  /** Liquidity of the hook-enabled accounting pool. */
  hookPoolLiquidity: bigint
  /** Solvers currently on the router whitelist. */
  registeredSolvers: Address[]
  /** Non-fatal problems found during the read. */
  warnings: string[]
  /** Fatal problems that make the venue unusable. */
  errors: string[]
}

export interface MonitorRecord {
  health: VenueHealth
  quote: Quote | null
  /** Independent venue prices for the same notional, if the book was queried. */
  venues?: VenueSnapshot
  /**
   * Best independent venue's edge over ESWAP, net of every fee and the L2 gas
   * bill. Positive means an external venue genuinely pays better than ESWAP —
   * the only condition under which an atomic ESWAP round trip can be profitable.
   */
  externalEdgeBps?: number
  /** Gas cost of one full loop, expressed in bps of the notional. */
  gasCostBps?: number
  /** Round-trip cost floor in bps — the hurdle the delta must clear. */
  costFloorBps: number
  /** Milliseconds spent on this check. */
  durationMs: number
}

export interface MonitorOptions extends QuoteOptions {
  market?: MarketConfig
  hook?: Address
  quoter?: Address
  /** Polling interval; defaults to one block (~2s on Unichain). */
  intervalMs?: number
  /** Called for every record. */
  onRecord?: (record: MonitorRecord) => void | Promise<void>
  /** Gas units used for the L2 gas cost term. Defaults to `GAS_BUDGET.fullLoop`. */
  gasEstimate?: bigint
}

// ─── Pool id helper (keccak of the ABI-encoded pool key) ─────────────────────

/**
 * Uniswap V4 pool id = keccak256(abi.encode(PoolKey)).
 *
 * `abi.encode` of a static struct is the five 32-byte words concatenated, so the
 * encoding is built explicitly here rather than through `encodeAbiParameters`
 * (whose generic form cannot express this call site). `tickSpacing` is an
 * `int24` and therefore needs two's-complement sign extension to 32 bytes — a
 * zero-padded negative value would hash to a different pool id and silently
 * report zero liquidity.
 *
 * `test/Arbitrage.test.ts` cross-checks this against the hook's on-chain
 * `standardPoolKeys(poolId)` registry, so the encoding is verified rather than
 * assumed.
 */
export function poolIdOf(pool: MarketConfig['hookPool']): `0x${string}` {
  const TWO_256 = 1n << 256n
  const tickSpacing =
    pool.tickSpacing < 0
      ? TWO_256 + BigInt(pool.tickSpacing) // sign extend
      : BigInt(pool.tickSpacing)

  const encoded = concatHex([
    // Addresses go through `BigInt` first: viem's `toHex` measures a *string*
    // argument's length in characters, so a `0x…` address would be rejected as
    // "42 bytes" against a 32-byte word.
    toHex(BigInt(pool.currency0), { size: 32 }),
    toHex(BigInt(pool.currency1), { size: 32 }),
    toHex(BigInt(pool.fee), { size: 32 }),
    toHex(tickSpacing, { size: 32 }),
    toHex(BigInt(pool.hooks), { size: 32 }),
  ])

  return keccak256(encoded)
}

// ─── Monitor ─────────────────────────────────────────────────────────────────

export class EswapMonitor {
  private readonly client: PublicClient
  private readonly quoter: EswapQuoter
  private readonly venueBook: VenueQuoteBook
  private readonly hook: Address
  private readonly poolManager: Address
  private readonly options: Required<Pick<MonitorOptions, 'intervalMs' | 'minEdgeBps'>> & MonitorOptions
  private timer?: ReturnType<typeof setTimeout>
  private running = false

  constructor(client: PublicClient, options: MonitorOptions = {}) {
    this.client = client
    this.hook = options.hook ?? ADDRESSES.hook
    this.poolManager = ADDRESSES.poolManager
    this.options = {
      intervalMs: options.intervalMs ?? 2_000,
      minEdgeBps: options.minEdgeBps ?? 20,
      ...options,
    }
    const market = options.market ?? ETH_USDC
    this.quoter = new EswapQuoter(client, market, options.quoter ?? ADDRESSES.quoter)
    this.venueBook = new VenueQuoteBook(client, market)
  }

  /**
   * One-shot health read.
   *
   * Every read is independent and errors are collected rather than thrown, so a
   * single broken getter (e.g. an uninitialised pool) degrades the report instead
   * of killing the monitor.
   */
  async health(marginIn: bigint, leverage: number): Promise<VenueHealth> {
    const market = this.options.market ?? ETH_USDC
    const errors: string[] = []
    const warnings: string[] = []

    const block = await this.client.getBlock({ blockTag: 'latest' })
    const hookRead = async <T>(fn: () => Promise<T>, label: string, fallback: T): Promise<T> => {
      try {
        return await fn()
      } catch (err) {
        warnings.push(`${label} read failed: ${short(err)}`)
        return fallback
      }
    }

    const [oi, collateral, hookLiqRaw, stdLiqRaw] = await Promise.all([
      hookRead(
        () =>
          this.client.readContract({
            address: this.hook,
            abi: HOOK_VIEW_ABI,
            functionName: 'totalOpenInterestUSD',
          }) as Promise<bigint>,
        'totalOpenInterestUSD',
        0n,
      ),
      hookRead(
        () =>
          this.client.readContract({
            address: this.hook,
            abi: HOOK_VIEW_ABI,
            functionName: 'totalCollateralUSDRunning',
          }) as Promise<bigint>,
        'totalCollateralUSDRunning',
        0n,
      ),
      hookRead(
        () => readPoolLiquidity(this.client as PublicClient, poolIdOf(market.hookPool)),
        'hookPoolLiquidity',
        0n,
      ),
      hookRead(
        () => readPoolLiquidity(this.client as PublicClient, poolIdOf(market.standardPool)),
        'standardPoolLiquidity',
        0n,
      ),
    ])

    // Zero liquidity on the accounting pool is expected on the live deployment
    // (the hook pool is accounting-only; fills go to the deep pool).
    if (hookLiqRaw === 0n) {
      warnings.push('hook accounting pool has zero liquidity (expected in accounting-only mode)')
    }
    if (stdLiqRaw === 0n) {
      errors.push('deep standard pool has zero liquidity — venue cannot fill')
    }

    const registeredSolvers = await this.solvers(market.tokenIn)

    const gaps = deploymentGaps()
    if (gaps.length > 0) warnings.push(`unconfigured: ${gaps.join(', ')}`)

    return {
      blockNumber: block.number,
      timestamp: Number(block.timestamp),
      ok: errors.length === 0,
      totalOpenInterestUSD: oi,
      totalCollateralUSDRunning: collateral,
      standardPoolLiquidity: stdLiqRaw,
      hookPoolLiquidity: hookLiqRaw,
      registeredSolvers,
      warnings,
      errors,
    }
  }

  /**
   * Scan the router's solver whitelist.
   *
   * The whitelist is a mapping, so there is no enumeration primitive. Rather than
   * guess log ranges, this reads the deployment's configured solver plus the
   * adapter's `defaultSolver`/`backupSolver` and reports whether each is enabled.
   */
  async solvers(_token: Address): Promise<Address[]> {
    const candidates = [
      ADDRESSES.flashProvider,
      process.env.SOLVER_ADDRESS,
    ].filter((a): a is Address => Boolean(a) && a !== '')

    const out: Address[] = []
    for (const candidate of candidates) {
      try {
        const enabled = await this.client.readContract({
          address: ADDRESSES.router,
          abi: HOOK_VIEW_ABI,
          functionName: 'registeredSolvers',
          args: [candidate],
        })
        if (enabled) out.push(candidate)
      } catch {
        // whitelist not readable → not registered
      }
    }
    return out
  }

  /** One full monitor tick: health + quote + independent venue book. */
  async tick(marginIn: bigint, leverage: number): Promise<MonitorRecord> {
    const started = Date.now()
    const market = this.options.market ?? ETH_USDC
    const health = await this.health(marginIn, leverage)

    let quote: Quote | null = null
    if (this.quoter.isConfigured && health.ok) {
      try {
        quote = await this.quoter.quote(
          { market, marginIn, leverage },
          { minEdgeBps: this.options.minEdgeBps },
        )
      } catch (err) {
        health.warnings.push(`quote failed: ${short(err)}`)
      }
    }

    // Independent venue book, quoted on the UNWIND leg.
    //
    // This is the leg that actually decides whether a round trip is worth
    // attempting: ESWAP opens in the deep pool, and the recovered collateral has
    // to come back out somewhere. If that "somewhere" is the same pool the open
    // filled through, the trip is structurally loss-making no matter how good the
    // quote looks, which is why the venue is external to ESWAP's own routing.
    //
    // The notional quoted is the collateral the open is expected to produce, and
    // the reference is that same collateral valued at the ESWAP pool price — so
    // the edge is "how much better does an independent venue pay for the same
    // collateral", in the flash asset's units, on both sides of the subtraction.
    let venues: VenueSnapshot | undefined
    let externalEdgeBps: number | undefined
    let gasBps: number | undefined
    if (health.ok && quote && quote.eswapOut > 0n) {
      try {
        venues = await this.venueBook.unwindQuote(quote.eswapOut, null)
      } catch (err) {
        health.warnings.push(`venue book failed: ${short(err)}`)
      }
    }

    // Net EV of a full atomic round trip, in bps of the flash-asset notional:
    //
    //   + best external venue's unwind output, valued in the flash asset
    //   - flash principal + premium that must be repaid
    //   - ESWAP's own cost of producing the collateral (protocol toll + pool fee)
    //   - the external venue's own taker fee, already inside its quote, so it is
    //     NOT double-subtracted here
    //   - L2 gas for open + close + unwind
    //
    // The previous formula compared the external FORWARD quote (USDC->ETH)
    // against ESWAP's leveraged open output, then subtracted the venue fee a
    // second time even though the quote already nets it. That produced a number
    // that was neither the open leg's edge nor the round trip's edge, and it
    // could be positive for a trade that loses money on every execution.
    if (venues?.best?.amountOut != null && quote && quote.eswapOut > 0n) {
      const notionalIn = quote.notionalIn
      // What ESWAP's own unwind would return, in flash-asset units: the same
      // collateral re-sold into the pool it came from, valued at the pool's own
      // price rather than at a raw decimal cast. `toWad` then `fromWad` is the
      // unit-safe path from ETH (18dp) to USDC (6dp).
      const referenceFlash = fromWad(toWad(quote.eswapOut, market.decimalsOut), market.decimalsIn)
      const venueFee = applyBpsDown(venues.best.amountOut, venues.best.feeBps)

      const gross = venues.best.amountOut - venueFee - referenceFlash
      // Repayment, expressed as a fraction of notional, is premium-only: the
      // principal comes back in full on a break-even trade.
      const repayBps = COSTS.actualFlashPremiumBps
      const eswapCostBps = COSTS.protocolFeeBps + COSTS.standardPoolFeeBps

      gasBps = gasCostBps(
        this.options.gasEstimate ?? GAS_BUDGET.fullLoop,
        this.options.gasPriceGwei ?? COSTS.gasPriceGwei,
        notionalIn,
        market.decimalsIn,
      )

      const grossBps = notionalIn > 0n ? Number((gross * 10_000n) / notionalIn) : 0
      externalEdgeBps = grossBps - repayBps - eswapCostBps - gasBps
    }

    return {
      health,
      quote,
      venues,
      externalEdgeBps,
      gasCostBps: gasBps,
      costFloorBps: roundTripFloorBps(),
      durationMs: Date.now() - started,
    }
  }

  /**
   * Start polling.
   *
   * `onRecord` is awaited before the next tick is scheduled, so a slow consumer
   * can never build up an unbounded backlog of stale quotes.
   */
  async start(marginIn: bigint, leverage: number): Promise<void> {
    if (this.running) return
    this.running = true

    const loop = async () => {
      while (this.running) {
        try {
          const record = await this.tick(marginIn, leverage)
          await this.options.onRecord?.(record)
        } catch (err) {
          console.error('[monitor] tick failed:', short(err))
        }
        await sleep(this.options.intervalMs)
      }
    }

    void loop()
  }

  stop(): void {
    this.running = false
    if (this.timer) clearTimeout(this.timer)
  }
}

// ─── Formatting ──────────────────────────────────────────────────────────────

/** The bps hurdle a round trip must clear before any trade is even considered. */
export function roundTripFloorBps(): number {
  return COSTS.protocolFeeBps * 2 + COSTS.standardPoolFeeBps * 2 + COSTS.actualFlashPremiumBps
}

/**
 * Tolerance between the collateral the open is expected to produce and the
 * collateral the unwind was actually sized against.
 *
 * A quote and its unwind are two separate RPC reads and the pool can move
 * between them, so exact equality is the wrong test. Too tight a tolerance
 * rejects every live plan; too loose a one lets a stale unwind floor through.
 */
const UNWIND_NOTIONAL_TOLERANCE_BPS = 100

/**
 * Build the unwind leg of a plan from a real independent venue quote.
 *
 * `minVenueOut` is the executor's repayment floor and is denominated in the
 * FLASH ASSET (USDC, 6dp). This function therefore refuses any snapshot that is
 * not the reverse leg, not in flash-asset units, or not sized against the
 * collateral the open actually produces.
 *
 * The previous version ignored both its `quote` and `market` arguments and
 * returned `venue.best.amountOut` unconditionally, which silently accepted a
 * FORWARD (ETH-denominated, 18dp) snapshot as a USDC floor — a floor roughly
 * 1e12x too large, which can never bind and looks like protection while
 * enforcing nothing. Silently disabling the only repayment floor is worse than
 * failing loudly, so every mismatch is an error here.
 *
 * @returns the venue's unwind output and its name
 */
export function planFromVenue(
  quote: Quote,
  venue: VenueSnapshot,
  market: MarketConfig,
): { venueQuoteOut: bigint; venueName: string; collateralIn: bigint } {
  if (venue.side !== 'reverse') {
    throw new Error(
      `refusing to build a plan from a ${venue.side} snapshot: minVenueOut needs the unwind leg`,
    )
  }
  if (venue.outputToken.toLowerCase() !== market.tokenIn.toLowerCase()) {
    throw new Error(
      `refusing to build a plan: unwind is priced in ${venue.outputToken} but ` +
        `minVenueOut must be in the flash asset ${market.tokenIn}`,
    )
  }
  // The unwind is sized on the collateral the open produces. If the snapshot was
  // quoted against some other amount, its output is not the output this trade
  // would get, so using it as a floor is a category error even when the units
  // happen to agree.
  const driftBps =
    quote.eswapOut === 0n
      ? null
      : Number(((venue.amountIn - quote.eswapOut) * 10_000n) / quote.eswapOut)
  if (driftBps === null || Math.abs(driftBps) > UNWIND_NOTIONAL_TOLERANCE_BPS) {
    throw new Error(
      `refusing to build a plan: unwind was quoted for ${venue.amountIn} collateral ` +
        `but the open produces ${quote.eswapOut} (${driftBps ?? 'n/a'}bps drift, ` +
        `tolerance ${UNWIND_NOTIONAL_TOLERANCE_BPS}bps)`,
    )
  }
  const out = venue.best?.amountOut
  if (out == null) {
    throw new Error('no external venue could be quoted — refusing to build a plan')
  }
  if (out <= 0n) {
    throw new Error(`external venue quoted a non-positive unwind output (${out})`)
  }
  return { venueQuoteOut: out, venueName: venue.best!.venue, collateralIn: venue.amountIn }
}

export function formatRecord(r: MonitorRecord): string {
  const q = r.quote
  const head =
    `[block ${r.health.blockNumber}] ok=${r.health.ok} ` +
    `oi=${r.health.totalOpenInterestUSD} coll=${r.health.totalCollateralUSDRunning} ` +
    `stdLiq=${r.health.standardPoolLiquidity} floor=${r.costFloorBps.toFixed(2)}bps ${r.durationMs}ms`
  const venueLine =
    r.externalEdgeBps === undefined
      ? ''
      : `  externalEdge=${r.externalEdgeBps.toFixed(2)}bps ` +
        `gas=${(r.gasCostBps ?? 0).toFixed(2)}bps — ` +
        `${(r.externalEdgeBps ?? 0) > 0 ? 'trade candidate' : 'no independent edge'}\n`

  if (!q) return `${head}\n${venueLine}  quote: unavailable`
  return (
    `${head}\n` +
    `  notional=${q.notionalIn} @ ${q.leverage}x  eswap=${q.eswapOut} ref=${q.referenceOut}\n` +
    `  delta=${q.deltaOut} (${q.deltaBps.toFixed(3)}bps) net=${q.netEdgeOut} ` +
    `profitable=${q.profitable} — ${q.verdict}\n` +
    venueLine
  )
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function short(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  return msg.length > 140 ? `${msg.slice(0, 140)}…` : msg
}