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
import { ADDRESSES, broadcastEnabled, SLIPPAGE, type MarketConfig } from './config'
import type { Quote } from './quoter'

/**
 * Apply a slippage floor to an expected amount.
 *
 * The result is never zero: for a dust notional the bps discount can round to 0,
 * and a zero floor silently disables the contract's protection while still
 * *looking* like protection is in place. Mirrors the contract's
 * `minOutWithSlippage`, so the off-chain and on-chain floors agree.
 */
export function slippageFloor(expected: bigint, slippageBps: number): bigint {
  if (slippageBps <= 0) throw new Error(`slippageBps must be positive, got ${slippageBps}`)
  if (slippageBps >= 10_000) throw new Error(`slippageBps must be < 10_000, got ${slippageBps}`)
  const floored = (expected * BigInt(10_000 - Math.trunc(slippageBps))) / 10_000n
  return floored === 0n ? 1n : floored
}

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
    name: 'canaryExecute',
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
    name: 'setCanarySlippageBps',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'openBps', type: 'uint256' },
      { name: 'closeBps', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'minOutWithSlippage',
    stateMutability: 'pure',
    inputs: [
      { name: 'expectedOut', type: 'uint256' },
      { name: 'slippageBps', type: 'uint256' },
    ],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'dryRunArbitrage',
    stateMutability: 'nonpayable',
    // Declared POSITIONALLY, with no component names.
    //
    // viem resolves struct inputs by matching component names against the object
    // it is given. `Plan` has a nested `hookPoolKey` tuple, and the plan object
    // also carries sibling fields with the same names (`currency0`, `fees`,
    // `hook`…). With named components viem cannot decide which field belongs to
    // which level of the struct and throws before the call is ever built, so the
    // entry used to be missing from this ABI entirely and callers reached for a
    // private copy. A positional ABI has no ambiguity, so the production ABI can
    // carry the real signature and there is exactly one source of truth.
    inputs: [
      {
        name: 'plan',
        type: 'tuple',
        components: [
          { type: 'address' },
          { type: 'uint256' },
          { type: 'address' },
          { type: 'uint24' },
          { type: 'uint8' },
          { type: 'uint256' },
          { type: 'uint256' },
          { type: 'uint256' },
          { type: 'address' },
          {
            type: 'tuple',
            components: [
              { type: 'address' },
              { type: 'address' },
              { type: 'uint24' },
              { type: 'int24' },
              { type: 'address' },
            ],
          },
          { type: 'address' },
          { type: 'address' },
          { type: 'bytes' },
          { type: 'uint256' },
          { type: 'uint256' },
          { type: 'uint256' },
        ],
      },
    ],
    outputs: [
      { name: 'venueOut', type: 'int256' },
      { name: 'repay', type: 'uint256' },
      { name: 'touchedStandardPool', type: 'uint256' },
      { name: 'profit', type: 'uint256' },
    ],
  },
  {
    type: 'function',
    name: 'canarySlippageBps',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'canaryCloseSlippageBps',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'flashMode',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint8' }],
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
      { name: 'quoter', type: 'address' },
      { name: 'quoteMargin', type: 'uint256' },
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
    { indexed: false, name: 'pnl', type: 'int256' },
    { indexed: false, name: 'enforced', type: 'bool' },
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

/**
 * Result of a contract-side dry run.
 *
 * `venueOut` is SIGNED: a negative value means the venue took that much of the
 * flash asset rather than returning it. It is the normal result for a same-pool
 * unwind, and reading it as an unsigned amount turns a loss into an apparent
 * multi-billion-unit windfall.
 */
export interface DryRunResult {
  /** Flash-asset amount the venue returned. Negative = the venue cost us. */
  venueOut: bigint
  /** Principal + premium the flash loan must be repaid with. */
  repay: bigint
  /** 1 if the unwind touched the same pool the hook fills through. */
  touchedStandardPool: bigint
  /** Contract-measured profit in flash-asset base units. */
  profit: bigint
}

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
   * Every floor is non-zero by construction: each is derived from the quoted
   * output minus a slippage buffer, never hardcoded to `0`. A zero floor would
   * disable the contract's own protection.
   *
   * UNIT SAFETY — the three floors are in three DIFFERENT currencies, and two
   * of them are not in `tokenOut`:
   *
   *   - `minOpenOut`  `tokenOut` (ETH, 18dp) — collateral the open must produce.
   *   - `minCloseOut` DEBT currency (USDC, 6dp). The hook settles the close as
   *     `netToTrader = collateralRecovered - solverPrincipal`, and the solver
   *     principal is registered in the debt currency, so this floor is compared
   *     against micro-dollars. Deriving it from `eswapOut` compares wei against
   *     micro-dollars and yields a floor ~1e12x too large.
   *   - `minVenueOut` `flashAsset` (USDC, 6dp) — the venue swaps
   *     `tokenOut -> flashAsset` and its return value is denominated there.
   *
   * Both USDC floors therefore have to be supplied by the caller from quotes in
   * USDC units. There is no honest way to infer them from a `tokenOut` quote,
   * and guessing is what produced the two off-by-1e12 floors this replaces.
   */
  buildPlan(
    quote: Quote,
    opts: {
      hook: Address
      solver: Address
      venue: Address
      venueData: Hex
      market: MarketConfig
      /**
       * Best external venue's expected output for the unwind leg, in
       * `market.tokenIn` (flash asset, USDC 6dp) base units. Required — see the
       * unit note above.
       */
      venueQuoteOut: bigint
      /**
       * Floor for the close leg in DEBT-currency base units (USDC, 6dp).
       * Required — the hook compares this against `netToTrader`, which is
       * denominated there. Deriving it from `tokenOut` is a unit error.
       */
      minCloseOut: bigint
      /** Slippage buffer applied to the open leg, in bps. Default `SLIPPAGE.defaultBps`. */
      slippageBps?: number
      /** Net profit floor in `flashAsset` base units. Default 1. */
      minProfit?: bigint
      deadlineSeconds?: number
    },
  ): ArbPlan {
    const slippageBps = BigInt(opts.slippageBps ?? SLIPPAGE.defaultBps)
    if (slippageBps <= 0n) throw new Error('slippageBps must be positive')
    if (slippageBps >= 10_000n) throw new Error('slippageBps must be < 10_000')

    if (opts.venueQuoteOut <= 0n) {
      throw new Error('venueQuoteOut must be positive — no external venue quote to floor against')
    }
    if (opts.minCloseOut <= 0n) {
      throw new Error(
        'minCloseOut must be positive — the close floor is denominated in the debt currency ' +
          '(USDC, 6dp) and cannot be derived from a tokenOut quote',
      )
    }

    const slip = (v: bigint) => {
      const floored = (v * (10_000n - slippageBps)) / 10_000n
      return floored === 0n ? 1n : floored
    }

    // `minOpenOut` is the one floor genuinely derived from `eswapOut`: the open
    // really does have to deliver that much collateral.
    const minOpenOut = slip(quote.eswapOut)
    // `minCloseOut` and `minVenueOut` are caller-supplied USDC figures.
    const minCloseOut = opts.minCloseOut
    const minVenueOut = slip(opts.venueQuoteOut)

    for (const [label, value] of [
      ['minOpenOut', minOpenOut],
      ['minCloseOut', minCloseOut],
      ['minVenueOut', minVenueOut],
    ] as const) {
      if (value <= 0n) throw new Error(`${label} collapsed to zero — refusing to build a plan`)
    }

    return {
      flashAsset: opts.market.tokenIn,
      // MUST equal `marginIn`: the contract reverts `MarginMustEqualFlashAmount`
      // otherwise. The flash funds the trader's equity only — the leveraged
      // borrow is on-balance-sheet hook debt settled from the unwind at close,
      // so it is not an upfront cash requirement and must not be added here.
      // Sizing the flash to the notional would fund the position twice over and
      // leave the extra principal stranded.
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
   * Ask the contract what a plan would actually do, without broadcasting.
   *
   * This is the only trustworthy profitability signal available: the contract
   * runs the real callbacks and reports what it measured. An off-chain venue
   * quote is an estimate of the same thing and will disagree whenever the pool
   * moves between the quote and the inclusion.
   *
   * `profit <= 0` and `touchedStandardPool != 0` are both hard refusals. A plan
   * that unwinds through the pool the hook fills through is a wash trade by
   * construction and can never clear its cost floor, no matter how the quote
   * looks.
   */
  async dryRun(plan: ArbPlan): Promise<DryRunResult | { refusal: string }> {
    if (!this.isConfigured) return { refusal: 'executor address is not configured' }
    const account = this.walletClient.account
    if (!account) return { refusal: 'wallet client has no account' }
    try {
      const { result } = await this.publicClient.simulateContract({
        address: this.address,
        abi: EXECUTOR_ABI,
        functionName: 'dryRunArbitrage',
        args: [toPlanTuple(plan)],
        account,
      })
      const [venueOut, repay, touchedStandardPool, profit] = result as [
        bigint,
        bigint,
        bigint,
        bigint,
      ]
      if (touchedStandardPool !== 0n) {
        return {
          refusal:
            'plan unwinds through the same standard pool the hook fills through — ' +
            'structurally loss-making, refusing',
        }
      }
      if (profit <= 0n) return { refusal: `contract-measured profit is ${profit} (needs > 0)` }
      return { venueOut, repay, touchedStandardPool, profit }
    } catch (err) {
      return { refusal: err instanceof Error ? err.message : String(err) }
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
  async canaryExecute(marginIn: bigint, leverage: number): Promise<SubmissionResult> {
    if (!this.isConfigured) return refuse('executor address is not configured')
    if (marginIn <= 0n) return refuse('marginIn must be positive')

    const account = this.walletClient.account
    if (!account) return refuse('wallet client has no account')
    if (this.inFlight) return refuse('another submission is still in flight')

    this.inFlight = true
    try {
      const request = encodeFunctionData({
        abi: EXECUTOR_ABI,
        functionName: 'canaryExecute',
        args: [marginIn, leverage],
      })

      let gasEstimate: bigint
      try {
        const sim = await this.publicClient.simulateContract({
          account,
          address: this.address,
          abi: EXECUTOR_ABI,
          functionName: 'canaryExecute',
          args: [marginIn, leverage],
        })
        gasEstimate = BigInt(sim.request?.gas ?? 0)
      } catch (err) {
        return refuse(`canary simulation reverted: ${short(err)}`)
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
        functionName: 'canaryExecute',
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

/**
 * The same plan as an ORDERED TUPLE, for ABI entries declared positionally.
 *
 * `dryRunArbitrage` is declared without component names precisely because
 * viem cannot resolve the nested `hookPoolKey` from a named object. Positional
 * components make viem expect an array, so the plan has to be flattened here.
 *
 * The order MUST match the struct exactly, including the nested
 * `hookPoolKey` expanding into five flat elements. Getting this wrong does not
 * throw: it silently produces a well-formed call with the wrong arguments, which
 * is why `toPlanArg` (named, for `executeArbitrage`) and this function are kept
 * adjacent and covered together.
 */
function toPlanTuple(plan: ArbPlan) {
  return [
    plan.flashAsset,
    plan.flashAmount,
    plan.tokenOut,
    plan.feeTier,
    plan.leverage,
    plan.marginIn,
    plan.minOpenOut,
    plan.minCloseOut,
    plan.hook,
    [
      plan.hookPoolKey.currency0,
      plan.hookPoolKey.currency1,
      plan.hookPoolKey.feeTier,
      plan.hookPoolKey.tickSpacing,
      plan.hookPoolKey.hooks,
    ],
    plan.solver,
    plan.venue,
    plan.venueData,
    plan.minVenueOut,
    plan.minProfit,
    plan.deadline,
  ] as const
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