/**
 * src/telemetry.ts — scheduled health checks and invariant logging.
 *
 * The scheduler runs an owner-only micro round trip on a fixed interval and
 * writes one JSON line per check. Two rules keep the telemetry honest:
 *
 *   1. **Canaries are never counted as venue volume.** The only way this module
 *      identifies its own trades is the executor's `HealthCheckPassed` event, so
 *      `realTrades` and `canaries` are always tracked separately.
 *   2. **Canaries are never repeated into a loss loop.** At $1-$5 the round trip
 *      is structurally P&L-negative, so the scheduler runs on a coarse interval,
 *      caps the daily count, and stops permanently once `maxCanaries` is reached
 *      unless an operator raises the cap.
 *
 * Everything else it records is invariant state: hook open interest, running
 * collateral, pool liquidity and the round-trip cost floor.
 */

import type { Address, PublicClient, WalletClient, Hex } from 'viem'
import {
  ADDRESSES,
  CANARY,
  COSTS,
  ETH_USDC,
  broadcastEnabled,
  deploymentGaps,
  type MarketConfig,
} from './config'
import { EswapExecutor, EXECUTOR_ABI, type SubmissionResult } from './executor'
import { EswapMonitor, formatRecord, roundTripFloorBps } from './monitor'
import { EswapQuoter } from './quoter'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface TelemetryEvent {
  /** ISO-8601 UTC. */
  ts: string
  kind: 'health-check' | 'monitor' | 'invariant' | 'alert'
  ok: boolean
  data: Record<string, string | number | boolean | null>
}

export interface InvariantSnapshot {
  blockNumber: bigint
  totalOpenInterestUSD: bigint
  totalCollateralUSDRunning: bigint
  standardPoolLiquidity: bigint
  hookPoolLiquidity: bigint
  /** True when OI and running collateral are both at rest. */
  idle: boolean
}

export interface TelemetryOptions {
  executor?: EswapExecutor
  monitor?: EswapMonitor
  market?: MarketConfig
  /** Canary interval. Default 30 minutes — a diagnostic, not a strategy. */
  intervalMs?: number
  /** Hard cap on canaries per process. Default 48. */
  maxCanaries?: number
  /** Sink for telemetry lines. Default: stdout as JSON. */
  emit?: (event: TelemetryEvent) => void
  onAlert?: (event: TelemetryEvent) => void | Promise<void>
}

// ─── Log sink ────────────────────────────────────────────────────────────────

export const jsonSink =
  () =>
  (event: TelemetryEvent): void => {
    // One line per event so the stream is greppable and machine-parseable.
    process.stdout.write(`${JSON.stringify(event)}\n`)
  }

// ─── Telemetry ───────────────────────────────────────────────────────────────

export class EswapTelemetry {
  private readonly publicClient: PublicClient
  private readonly executor?: EswapExecutor
  private readonly monitor?: EswapMonitor
  private readonly market: MarketConfig
  private readonly intervalMs: number
  private readonly maxCanaries: number
  private readonly emit: (event: TelemetryEvent) => void

  canariesRun = 0
  realTrades = 0
  private timer?: ReturnType<typeof setTimeout>
  private running = false

  constructor(
    publicClient: PublicClient,
    walletClient?: WalletClient,
    options: TelemetryOptions = {},
  ) {
    this.publicClient = publicClient
    this.market = options.market ?? ETH_USDC
    this.intervalMs = options.intervalMs ?? 30 * 60 * 1000
    this.maxCanaries = options.maxCanaries ?? 48
    this.emit = options.emit ?? jsonSink()

    if (options.executor) {
      this.executor = options.executor
    } else if (walletClient) {
      this.executor = new EswapExecutor(publicClient, walletClient)
    }

    this.monitor = options.monitor ?? new EswapMonitor(publicClient, { market: this.market })
    this.onAlert = options.onAlert
  }

  private readonly onAlert?: (event: TelemetryEvent) => void | Promise<void>

  // ─── Invariants ──────────────────────────────────────────────────────────

  /**
   * Capture the venue's accounting state.
   *
   * `idle` is the key signal: with no open positions both aggregates must be
   * exactly zero. Any drift while idle is an invariant violation, not a rounding
   * artefact, because there is nothing left to account for.
   */
  async snapshot(): Promise<InvariantSnapshot> {
    const h = await this.monitor!.health(CANARY.defaultMarginIn, CANARY.leverage)
    return {
      blockNumber: h.blockNumber,
      totalOpenInterestUSD: h.totalOpenInterestUSD,
      totalCollateralUSDRunning: h.totalCollateralUSDRunning,
      standardPoolLiquidity: h.standardPoolLiquidity,
      hookPoolLiquidity: h.hookPoolLiquidity,
      idle: h.totalOpenInterestUSD === 0n && h.totalCollateralUSDRunning === 0n,
    }
  }

  async checkInvariants(): Promise<TelemetryEvent> {
    const snap = await this.snapshot()
    const event: TelemetryEvent = {
      ts: new Date().toISOString(),
      kind: 'invariant',
      ok: snap.idle || snap.totalOpenInterestUSD > 0n,
      data: {
        block: snap.blockNumber.toString(),
        oiUsd: snap.totalOpenInterestUSD.toString(),
        collateralUsd: snap.totalCollateralUSDRunning.toString(),
        standardPoolLiquidity: snap.standardPoolLiquidity.toString(),
        hookPoolLiquidity: snap.hookPoolLiquidity.toString(),
        idle: snap.idle,
        costFloorBps: roundTripFloorBps().toFixed(3),
      },
    }
    this.emit(event)
    if (!event.ok) await this.raise(event)
    return event
  }

  // ─── Canary ──────────────────────────────────────────────────────────────

  /**
   * Run one micro canary.
   *
   * Returns the submission outcome so a caller (or a test) can distinguish
   * "simulated and fine" from "refused" from "broadcast".
   */
  async canary(marginIn: bigint = CANARY.defaultMarginIn): Promise<SubmissionResult> {
    if (!this.executor) {
      throw new Error('telemetry has no executor; pass a walletClient or an executor')
    }
    if (this.canariesRun >= this.maxCanaries) {
      throw new Error(
        `canary cap reached (${this.maxCanaries}); raise maxCanaries explicitly to continue`,
      )
    }
    if (marginIn < CANARY.minMarginIn || marginIn > CANARY.maxMarginIn) {
      throw new Error(
        `canary notional must stay within $${CANARY.minMarginIn}-$${CANARY.maxMarginIn}`,
      )
    }

    const result = await this.executor.canaryExecute(marginIn, CANARY.leverage)
    this.canariesRun += 1

    this.emit({
      ts: new Date().toISOString(),
      kind: 'health-check',
      ok: result.simulated,
      data: {
        marginIn: marginIn.toString(),
        leverage: CANARY.leverage,
        simulated: result.simulated,
        broadcast: result.broadcast,
        gasEstimate: 'gasEstimate' in result ? result.gasEstimate.toString() : null,
        hash: 'hash' in result ? result.hash : null,
        // Counts only real trades, never canaries.
        canariesRun: this.canariesRun,
        realTrades: this.realTrades,
      },
    })

    if (!result.simulated) await this.raise({
      ts: new Date().toISOString(),
      kind: 'alert',
      ok: false,
      data: { reason: result.reason, scope: 'health-check' },
    })

    return result
  }

  /** Record a genuinely profitable trade. Canaries never call this. */
  recordRealTrade(hash: Hex, profit: bigint): void {
    this.realTrades += 1
    this.emit({
      ts: new Date().toISOString(),
      kind: 'health-check',
      ok: true,
      data: { hash, profit: profit.toString(), realTrades: this.realTrades, canariesRun: this.canariesRun },
    })
  }

  // ─── Scheduling ──────────────────────────────────────────────────────────

  /**
   * Start the canary loop.
   *
   * The first tick is delayed by a full interval so a freshly started process
   * does not immediately spend gas; call `canary()` directly for an on-demand
   * check.
   */
  start(): void {
    if (this.running) return
    this.running = true

    const boot: TelemetryEvent = {
      ts: new Date().toISOString(),
      kind: 'invariant',
      ok: true,
      data: {
        started: true,
        chain: this.publicClient.chain?.name ?? 'unknown',
        poolManager: ADDRESSES.poolManager,
        hook: ADDRESSES.hook,
        adapter: ADDRESSES.adapter || null,
        quoter: ADDRESSES.quoter || null,
        executor: ADDRESSES.executor || null,
        venue: ADDRESSES.venue || null,
        flashProvider: ADDRESSES.flashProvider || null,
        broadcastEnabled: broadcastEnabled(),
        costFloorBps: roundTripFloorBps().toFixed(3),
        unconfigured: deploymentGaps().join(',') || null,
      },
    }
    this.emit(boot)

    const tick = async () => {
      if (!this.running) return
      try {
        await this.checkInvariants()
        if (this.canariesRun < this.maxCanaries) {
          await this.canary()
        }
      } catch (err) {
        await this.raise({
          ts: new Date().toISOString(),
          kind: 'alert',
          ok: false,
          data: { reason: short(err), scope: 'scheduler' },
        })
      }
      if (this.running) this.timer = setTimeout(() => void tick(), this.intervalMs)
    }

    this.timer = setTimeout(() => void tick(), this.intervalMs)
  }

  stop(): void {
    this.running = false
    if (this.timer) clearTimeout(this.timer)
    this.monitor?.stop()
  }

  // ─── Quote tracking ──────────────────────────────────────────────────────

  /**
   * Log the current quote delta.
   *
   * The quoter is the arbiter: on the live deployment this reports a negative
   * delta, and the correct action is to log it and do nothing.
   */
  async logQuote(marginIn: bigint, leverage: number): Promise<TelemetryEvent> {
    const quoter = new EswapQuoter(this.publicClient, this.market)
    const event: TelemetryEvent = {
      ts: new Date().toISOString(),
      kind: 'monitor',
      ok: true,
      data: { note: 'quote unavailable', reason: 'quoter not configured' },
    }
    if (!quoter.isConfigured) {
      this.emit(event)
      return event
    }

    const quote = await quoter.quote({ market: this.market, marginIn, leverage })
    const record = {
      ts: event.ts,
      kind: 'monitor' as const,
      ok: true,
      data: {
        marginIn: marginIn.toString(),
        leverage,
        eswapOut: quote.eswapOut.toString(),
        referenceOut: quote.referenceOut.toString(),
        deltaOut: quote.deltaOut.toString(),
        deltaBps: quote.deltaBps.toFixed(4),
        netEdgeOut: quote.netEdgeOut.toString(),
        profitable: quote.profitable,
        verdict: quote.verdict,
      },
    }
    this.emit(record)
    return record
  }

  /** Print a formatted monitor record (handy from a CLI entry point). */
  async printRecord(marginIn: bigint, leverage: number): Promise<void> {
    const record = await this.monitor!.tick(marginIn, leverage)
    console.log(formatRecord(record))
  }

  private async raise(event: TelemetryEvent): Promise<void> {
    this.emit(event)
    await this.onAlert?.(event)
  }
}

// ─── Cost summary ────────────────────────────────────────────────────────────

/** Human-readable cost floor, reused by the CLI entry points. */
export function costSummary(): string {
  return [
    `protocol toll:  ${COSTS.protocolFeeBps}bps per side`,
    `physical pool:  ${COSTS.standardPoolFeeBps}bps per side`,
    `flash premium:  <=${COSTS.maxFlashPremiumBps}bps`,
    `round-trip floor: ${roundTripFloorBps().toFixed(2)}bps`,
  ].join('\n')
}

function short(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  return msg.length > 200 ? `${msg.slice(0, 200)}…` : msg
}

export { EXECUTOR_ABI }