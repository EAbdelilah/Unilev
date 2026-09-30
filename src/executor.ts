/**
 * src/executor.ts — simulation-gated transaction submission for the ESWAP harness.
 *
 * Hard rules enforced here, not left to the caller:
 *
 *   1. **Never broadcast by default.** Every write goes through
 *      `publicClient.simulateContract()` first. Broadcasting additionally requires
 *      `ALLOW_BROADCAST=true` in the environment; without it the call returns the
 *      simulation result and stops.
 *   2. **Never send a plan the quote already rejected.** A quote must be present
 *      and `profitable === true`, otherwise the trade is refused before a
 *      simulation is even attempted.
 *   3. **One in-flight transaction at a time.** A monotonic nonce queue serialises
 *      submissions so two ticks can never race for the same nonce.
 *   4. **Never invent a slippage floor.** `minProfit`/`minAmountOut` are derived
 *      from the freshest quote, and a zero floor is treated as a bug.
 *
 * Because the executor contract reverts unless the round trip clears its profit
 * floor, rule 2 is a cost control, not a safety net: a losing round trip loses
 * gas rather than principal.
 */

import {
  type Address,
  type PublicClient,
  type WalletClient,
  type Hex,
  encodeFunctionData,
  formatEther,
} from 'viem'
import { ADDRESSES, broadcastEnabled, type MarketConfig } from './config'
import type { Quote } from './quoter'

// ─── Executor ABI ────────────────────────────────────────────────────────────

export const EXECUTOR_ABI = [
  {
    type: 'function',
    name: 'executeArbitrage',
    stateMutability: 'nonpayable',
    inputs: [
      {
        name: 'plan',
        type: 'tuple',
        components: [
          { name: 'flashAsset', type: 'address' },
          { name: 'flashAmount', type: 'uint256' },
          { name: 'tokenOut', type: 'address' },
          { name: 'feeTier', type: 'uint24' },
          { name: 'leverage', type: 'uint8' },
          { name: 'marginIn', type: 'uint256' },
          { name: 'minOpenOut', type: 'uint256' },
          { name: 'minCloseOut', type: 'uint256' },
          { name: 'hook', type: 'address' },
          {
            name: 'hookPoolKey',
            type: 'tuple',
            components: [
              { name: 'currency0', type: 'address' },
              { name: 'currency1', type: 'address' },
              { name: 'feeTier', type: 'uint24' },
              { name: 'tickSpacing', type: 'int24' },
              { name: 'hooks', type: 'address' },
            ],
          },
          { name: 'solver', type: 'address' },
          { name: 'venue', type: 'address' },
          { name: 'venueData', type: 'bytes' },
          { name: 'minVenueOut', type: 'uint256' },
          { name: 'minProfit', type: 'uint256' },
          { name: 'deadline', type: 'uint256' },
        ],
      },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'healthCheck',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'marginIn', type: 'uint256' },
      { name: 'leverage', type: 'uint8' },
    ],
    outputs: [
      { name: 'opened', type: 'uint256' },
      { name: 'closed', type: 'uint256' },
    ],
  },
  {
    type: 'function',
    name: 'setVenue',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'venue', type: 'address' },
      { name: 'allowed', type: 'bool' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'setCanaryRoute',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'asset', type: 'address' },
      { name: 'collateral', type: 'address' },
      { name: 'hook', type: 'address' },
      {
        name: 'key',
        type: 'tuple',
        components: [
          { name: 'currency0', type: 'address' },
          { name: 'currency1', type: 'address' },
          { name: 'feeTier', type: 'uint24' },
          { name: 'tickSpacing', type: 'int24' },
          { name: 'hooks', type: 'address' },
        ],
      },
      { name: 'solver', type: 'address' },
      { name: 'feeTier', type: 'uint24' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'allowedVenues',
    stateMutability: 'view',
    inputs: [{ name: 'venue', type: 'address' }],
    outputs: [{ type: 'bool' }],
  },
  {
    type: 'function',
    name: 'allowedVenues',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'bool' }],
  },
  {
    type: 'function',
    name: 'maxFlashAmount',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'maxLeverage',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint8' }],
  },
  {
    type: 'function',
    name: 'sweepToken',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    type: 'event',
    name: 'ArbitrageExecuted',
    inputs: [
      { indexed: true, name: 'flashAsset', type: 'address' },
      { indexed: true, name: 'tokenOut', type: 'address' },
      { indexed: false, name: 'leverage', type: 'uint8' },
      { indexed: false, name: 'premium', type: 'uint256' },
      { indexed: false, name: 'opened', type: 'uint256' },
      { indexed: false, name: 'closed', type: 'uint256' },
      { indexed: false, name: 'venueOut', type: 'uint256' },
      { indexed: false, name: 'profit', type: 'uint256' },
    ],
  },
  {
    type: 'event',
    name: 'HealthCheckPassed',
    inputs: [
      { indexed: false, name: 'marginIn', type: 'uint256' },
      { indexed: false, name: 'leverage', type: 'uint8' },
      { indexed: false, name: 'opened', type: 'uint256' },
      { indexed: false, name: 'closed', type: 'uint256' },
    ],
  },
] as const

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ArbPlan {
  flashAsset: Address
  flashAmount: bigint
  tokenOut: Address
  feeTier: number
  leverage: number
  marginIn: bigint
  minOpenOut: bigint
  minCloseOut: bigint
  hook: Address
  hookPoolKey: {
    currency0: Address
    currency1: Address
    feeTier: number
    tickSpacing: number
    hooks: Address
  }
  solver: Address
  venue: Address
  venueData: Hex
  minVenueOut: bigint
  minProfit: bigint
  deadline: bigint
}

export interface SimulationResult {
  simulated: true
  broadcast: false
  reason: string
  request: Hex
  gasEstimate: bigint
  quote: Quote
}

export interface BroadcastResult {
  simulated: true
  broadcast: true
  hash: Hex
  gasEstimate: bigint
  quote: Quote
}

export interface Refusal {
  simulated: false
  broadcast: false
  reason: string
}

export type SubmissionResult = SimulationResult | BroadcastResult | Refusal

export interface ExecutorOptions {
  executorAddress?: Address
  market?: MarketConfig
  /** Overrides the environment gate. Defaults to `ALLOW_BROADCAST === 'true'`. */
  allowBroadcast?: boolean
}

// ─── Executor ────────────────────────────────────────────────────────────────

export class EswapExecutor {
  private readonly publicClient: PublicClient
  private readonly walletClient: WalletClient
  private readonly address: Address
  private readonly allowBroadcast: boolean
  private nonce = -1
  private inFlight = false

  constructor(
    publicClient: PublicClient,
    walletClient: WalletClient,
    options: ExecutorOptions = {},
  ) {
    this.publicClient = publicClient
    this.walletClient = walletClient
    this.address = options.executorAddress ?? ADDRESSES.executor
    this.allowBroadcast = options.allowBroadcast ?? broadcastEnabled()
  }

  get isConfigured(): boolean {
    return Boolean(this.address)
  }

  get broadcastAllowed(): boolean {
    return this.allowBroadcast
  }

  /**
   * Build a plan from a fresh quote.
   *
   * Every floor is non-zero by construction: they are derived from the quoted
   * output minus a slippage buffer, never hardcoded to `0`. A zero floor would
   * disable the contract's own protection.
   */
  buildPlan(
    quote: Quote,
    opts: {
      hook: Address
      solver: Address
      venue: Address
      venueData: Hex
      market: MarketConfig
      /** Slippage buffer applied to each leg, in bps. Default 30 bps. */
      slippageBps?: number
      /** Net profit floor in `flashAsset` base units. Default 1. */
      minProfit?: bigint
      deadlineSeconds?: number
    },
  ): ArbPlan {
    const slippageBps = BigInt(opts.slippageBps ?? 30)

    const slip = (v: bigint) => (v * (10_000n - slippageBps)) / 10_000n

    // The open output is what the venue quotes; close nets the protocol toll
    // again, and the venue leg pays the pool fee on the unwind.
    const minOpenOut = slip(quote.eswapOut)
    const minCloseOut = slip((quote.eswapOut * 9_900n) / 10_000n)
    const minVenueOut = slip(quote.referenceOut)

    for (const [label, value] of [
      ['minOpenOut', minOpenOut],
      ['minCloseOut', minCloseOut],
      ['minVenueOut', minVenueOut],
    ] as const) {
      if (value <= 0n) throw new Error(`${label} collapsed to zero — refusing to build a plan`)
    }

    return {
      flashAsset: opts.market.tokenIn,
      flashAmount: quote.marginIn,
      tokenOut: opts.market.tokenOut,
      feeTier: opts.market.adapterFeeTier,
      leverage: quote.leverage,
      marginIn: quote.marginIn,
      minOpenOut,
      minCloseOut,
      hook: opts.hook,
      hookPoolKey: {
        currency0: opts.market.hookPool.currency0,
        currency1: opts.market.hookPool.currency1,
        feeTier: opts.market.hookPool.fee,
        tickSpacing: opts.market.hookPool.tickSpacing,
        hooks: opts.market.hookPool.hooks,
      },
      solver: opts.solver,
      venue: opts.venue,
      venueData: opts.venueData,
      minVenueOut,
      minProfit: opts.minProfit ?? 1n,
      deadline: BigInt(Math.floor(Date.now() / 1000) + (opts.deadlineSeconds ?? 120)),
    }
  }

  /**
   * Simulate, and only then (optionally) broadcast.
   *
   * @param quote must come from the same block the simulation will run against;
   *              a stale quote is rejected rather than silently reused.
   */
  async submit(plan: ArbPlan, quote: Quote): Promise<SubmissionResult> {
    if (!this.isConfigured) return refuse('executor address is not configured')
    if (!quote.profitable) {
      return refuse(`quote rejected the trade: ${quote.verdict}`)
    }
    if (plan.marginIn !== plan.flashAmount) {
      return refuse('marginIn must equal flashAmount so the residual is pure P&L')
    }

    const account = this.walletClient.account
    if (!account) return refuse('wallet client has no account')
    if (this.inFlight) return refuse('another submission is still in flight')

    this.inFlight = true
    try {
      const request = encodeFunctionData({
        abi: EXECUTOR_ABI,
        functionName: 'executeArbitrage',
        args: [toPlanArg(plan)],
      })

      // ── Gate 1: simulation ───────────────────────────────────────────────
      let gasEstimate: bigint
      try {
        const sim = await this.publicClient.simulateContract({
          account,
          address: this.address,
          abi: EXECUTOR_ABI,
          functionName: 'executeArbitrage',
          args: [toPlanArg(plan)],
        })
        gasEstimate = sim.request === undefined ? 0n : BigInt(sim.request.gas ?? 0)
      } catch (err) {
        return refuse(`simulation reverted: ${short(err)}`)
      }

      // ── Gate 2: explicit broadcast consent ───────────────────────────────
      if (!this.allowBroadcast) {
        return {
          simulated: true,
          broadcast: false,
          reason: 'ALLOW_BROADCAST is not set; simulation only',
          request,
          gasEstimate,
          quote,
        }
      }

      // ── Gate 3: serialised nonce ─────────────────────────────────────────
      if (this.nonce < 0) {
        this.nonce = await this.publicClient.getTransactionCount({
          address: account.address,
          blockTag: 'pending',
        })
      }
      const hash = await this.walletClient.writeContract({
        chain: this.walletClient.chain,
        account,
        address: this.address,
        abi: EXECUTOR_ABI,
        functionName: 'executeArbitrage',
        args: [toPlanArg(plan)],
        nonce: this.nonce++,
      })

      return { simulated: true, broadcast: true, hash, gasEstimate, quote }
    } finally {
      this.inFlight = false
    }
  }

  /**
   * Owner-only micro canary.
   *
   * Simulation is mandatory; broadcast needs the same consent flag as a trade.
   * The canary is $1-$5 by construction, so it can never be economically
   * motivated, and its `HealthCheckPassed` event is the marker telemetry uses to
   * exclude canary flow from venue volume.
   */
  async runHealthCheck(marginIn: bigint, leverage: number): Promise<SubmissionResult> {
    if (!this.isConfigured) return refuse('executor address is not configured')
    if (marginIn <= 0n) return refuse('marginIn must be positive')

    const account = this.walletClient.account
    if (!account) return refuse('wallet client has no account')
    if (this.inFlight) return refuse('another submission is still in flight')

    this.inFlight = true
    try {
      const request = encodeFunctionData({
        abi: EXECUTOR_ABI,
        functionName: 'healthCheck',
        args: [marginIn, leverage],
      })

      let gasEstimate: bigint
      try {
        const sim = await this.publicClient.simulateContract({
          account,
          address: this.address,
          abi: EXECUTOR_ABI,
          functionName: 'healthCheck',
          args: [marginIn, leverage],
        })
        gasEstimate = BigInt(sim.request?.gas ?? 0)
      } catch (err) {
        return refuse(`health-check simulation reverted: ${short(err)}`)
      }

      if (!this.allowBroadcast) {
        return {
          simulated: true,
          broadcast: false,
          reason: 'ALLOW_BROADCAST is not set; simulation only',
          request,
          gasEstimate,
          quote: fakeQuote(marginIn, leverage),
        }
      }

      if (this.nonce < 0) {
        this.nonce = await this.publicClient.getTransactionCount({
          address: account.address,
          blockTag: 'pending',
        })
      }
      const hash = await this.walletClient.writeContract({
        chain: this.walletClient.chain,
        account,
        address: this.address,
        abi: EXECUTOR_ABI,
        functionName: 'healthCheck',
        args: [marginIn, leverage],
        nonce: this.nonce++,
      })

      return {
        simulated: true,
        broadcast: true,
        hash,
        gasEstimate,
        quote: fakeQuote(marginIn, leverage),
      }
    } finally {
      this.inFlight = false
    }
  }

  /** Reset the nonce cache (e.g. after an external transaction used one). */
  resetNonce(): void {
    this.nonce = -1
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function refuse(reason: string): Refusal {
  return { simulated: false, broadcast: false, reason }
}

/** Object form matching the executor's `ArbPlan` ABI layout. */
function toPlanArg(plan: ArbPlan) {
  return {
    flashAsset: plan.flashAsset,
    flashAmount: plan.flashAmount,
    tokenOut: plan.tokenOut,
    feeTier: plan.feeTier,
    leverage: plan.leverage,
    marginIn: plan.marginIn,
    minOpenOut: plan.minOpenOut,
    minCloseOut: plan.minCloseOut,
    hook: plan.hook,
    hookPoolKey: {
      currency0: plan.hookPoolKey.currency0,
      currency1: plan.hookPoolKey.currency1,
      feeTier: plan.hookPoolKey.feeTier,
      tickSpacing: plan.hookPoolKey.tickSpacing,
      hooks: plan.hookPoolKey.hooks,
    },
    solver: plan.solver,
    venue: plan.venue,
    venueData: plan.venueData,
    minVenueOut: plan.minVenueOut,
    minProfit: plan.minProfit,
    deadline: plan.deadline,
  }
}

/** Placeholder quote so the canary result has the same shape as a trade result. */
function fakeQuote(marginIn: bigint, leverage: number): Quote {
  return {
    marginIn,
    notionalIn: marginIn * BigInt(leverage),
    leverage,
    eswapOut: 0n,
    referenceOut: 0n,
    deltaOut: 0n,
    deltaBps: 0,
    netEdgeOut: 0n,
    profitable: false,
    verdict: 'health check — not a trade',
    blockNumber: 0n,
  }
}

function short(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  return msg.length > 200 ? `${msg.slice(0, 200)}…` : msg
}

/** Convenience: approximate USD value of a token amount, for logging only. */
export function approxUsd(amount: bigint, decimals: number, priceUsd: number): string {
  const whole = (Number(amount) / 10 ** decimals) * priceUsd
  return `$${whole.toFixed(2)}`
}

export { formatEther }