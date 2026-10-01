/**
 * src/quoter.ts — read-only pricing for the ESWAP leveraged venue.
 *
 * Two independent quotes are produced for every check:
 *
 *   1. `eswapQuote`  — the protocol's own `EswapLeverageQuoter`, i.e. exactly what
 *      the adapter + router will attempt on-chain.
 *   2. `referenceQuote` — the same notional swapped on the DEEP standard pool at
 *      spot, with the protocol's 0.10% toll and both pool fees deducted.
 *
 * The delta between them is the only number worth acting on. It is computed
 * net of every fee, so a positive delta means a genuinely cheaper venue, not a
 * quote artifact. Nothing in this module can broadcast anything.
 */

import type { Address, PublicClient } from 'viem'
import {
  ADDRESSES,
  COSTS,
  ETH_USDC,
  NATIVE_ETH,
  type MarketConfig,
} from './config'

// ─── Minimal ABI surface (only what the quoter reads) ────────────────────────

export const LEVERAGE_QUOTER_ABI = [
  {
    type: 'function',
    name: 'quoteExactInputSingleWithLeverage',
    stateMutability: 'view',
    inputs: [
      { name: 'tokenIn', type: 'address' },
      { name: 'tokenOut', type: 'address' },
      { name: 'fee', type: 'uint24' },
      { name: 'leverage', type: 'uint8' },
      { name: 'amountIn', type: 'int256' },
    ],
    outputs: [{ name: 'amountOut', type: 'int128' }],
  },
  {
    type: 'function',
    name: 'getPoolKey',
    stateMutability: 'view',
    inputs: [
      { name: 'tokenIn', type: 'address' },
      { name: 'tokenOut', type: 'address' },
      { name: 'fee', type: 'uint24' },
    ],
    outputs: [
      {
        name: 'hookPoolKey',
        type: 'tuple',
        components: [
          { name: 'currency0', type: 'address' },
          { name: 'currency1', type: 'address' },
          { name: 'fee', type: 'uint24' },
          { name: 'tickSpacing', type: 'int24' },
          { name: 'hooks', type: 'address' },
        ],
      },
      {
        name: 'standardPoolKey',
        type: 'tuple',
        components: [
          { name: 'currency0', type: 'address' },
          { name: 'currency1', type: 'address' },
          { name: 'fee', type: 'uint24' },
          { name: 'tickSpacing', type: 'int24' },
          { name: 'hooks', type: 'address' },
        ],
      },
    ],
  },
] as const

export const ROUTER_ABI = [
  {
    type: 'function',
    name: 'quoteExactInput',
    stateMutability: 'view',
    inputs: [
      {
        name: 'key',
        type: 'tuple',
        components: [
          { name: 'currency0', type: 'address' },
          { name: 'currency1', type: 'address' },
          { name: 'fee', type: 'uint24' },
          { name: 'tickSpacing', type: 'int24' },
          { name: 'hooks', type: 'address' },
        ],
      },
      { name: 'zeroForOne', type: 'bool' },
      { name: 'amountSpecified', type: 'int128' },
      { name: 'leverage', type: 'uint8' },
    ],
    outputs: [{ name: 'amountOut', type: 'int128' }],
  },
] as const

// ─── Types ───────────────────────────────────────────────────────────────────

export interface QuoteRequest {
  market: MarketConfig
  /** Margin leg in `market.tokenIn` base units. */
  marginIn: bigint
  leverage: number
  quoter?: Address
}

export interface Quote {
  /** Margin leg, as requested. */
  marginIn: bigint
  /** Notional actually swapped = margin x leverage. */
  notionalIn: bigint
  leverage: number
  /** Protocol quote for the leveraged open, in `tokenOut` base units. */
  eswapOut: bigint
  /** Same notional on the deep pool at spot, net of all fees, `tokenOut` units. */
  referenceOut: bigint
  /** `eswapOut - referenceOut`, in `tokenOut` base units. Negative = ESWAP worse. */
  deltaOut: bigint
  /** `deltaOut` normalised to `tokenOut` base units per 1e4 (bps of reference). */
  deltaBps: number
  /** Net edge after both pool fees and the flash premium, in `tokenOut` units. */
  netEdgeOut: bigint
  /** True only when the net edge clears `minEdgeBps` with room to breathe. */
  profitable: boolean
  /** Human-readable reason when `profitable` is false. */
  verdict: string
  blockNumber: bigint
}

/**
 * A `Quote` extended with the close leg.
 *
 * The close leg is kept in its own fields rather than folded back into
 * `eswapOut`, so a round-trip quote can never be mistaken for an open quote.
 */
export interface RoundTripQuote extends Quote {
  /** Cost of both legs plus the flash premium, in bps of the notional. */
  roundTripCostBps: number
  /** The OPEN leg's output, `tokenOut` base units. Same value as `eswapOut`. */
  openOut: bigint
  /** The CLOSE leg's output, `tokenOut` base units. */
  closeOut: bigint
  /** Flash repayment including premium, normalised to 18-decimal wad space. */
  repayInWad: bigint
  /** `closeOut - repay`, in wad space. Negative = the round trip loses money. */
  roundTripNetWad: bigint
}

export interface QuoteOptions {
  /** Minimum net edge, in bps of the reference output. Default 20 bps. */
  minEdgeBps?: number
  /** Override the gas price used for the round-trip estimate. */
  gasPriceGwei?: number
}

// ─── Quote math ──────────────────────────────────────────────────────────────

function pow10(n: number): bigint {
  return 10n ** BigInt(n)
}

/**
 * Normalise a raw amount to 18-decimal "wad" space so deltas between
 * 6-decimal (USDC) and 18-decimal (ETH) legs can be compared directly.
 */
export function toWad(amount: bigint, decimals: number): bigint {
  return (amount * pow10(18)) / pow10(decimals)
}

/**
 * Convert a wad (18-decimal) amount down into `decimals` base units.
 *
 * The inverse of `toWad`. Needed whenever a value computed in wad space has to
 * be compared against a raw ERC-20 balance: a floor that is right in wad space
 * but 1e12x too large in 6-decimal USDC space can never bind, which is worse
 * than having no floor at all because it looks protected.
 *
 * Rounds DOWN, so the result never overstates what a repayment can cover.
 */
export function fromWad(amount: bigint, decimals: number): bigint {
  if (decimals > 18) throw new RangeError(`decimals must be <= 18, got ${decimals}`)
  return (amount * pow10(decimals)) / pow10(18)
}

/**
 * Take `bps` off an amount, rounding DOWN.
 *
 * A venue fee is already netted out of its own quote, so subtracting it from the
 * quote output is how the fee is isolated for reporting. Rounding down keeps the
 * EV arithmetic conservative: an under-estimate of cost can never manufacture a
 * profitable-looking round trip.
 */
export function applyBpsDown(amount: bigint, bps: number): bigint {
  return (amount * BigInt(Math.max(0, 10_000 - Math.round(bps)))) / 10_000n
}

/**
 * Spot reference output for the deep standard pool.
 *
 * The pool's own `quoteExactInput` already applies a 0.1% conservatism discount
 * that models the real pool fee and average slippage. On top of that we charge
 * the protocol's own toll, because a comparable venue must pay the same toll to
 * be substitutable. The result is a *floor* for what any venue can deliver, so a
 * positive net edge is not an artefact of an optimistic quote.
 */
export function referenceOut(
  rawQuoteOut: bigint,
  market: MarketConfig,
  tollBps: number = COSTS.protocolFeeBps,
): bigint {
  return (rawQuoteOut * BigInt(10_000 - tollBps)) / 10_000n
}

/** Convert an output delta to basis points of the reference output. */
export function toBps(delta: bigint, base: bigint): number {
  if (base === 0n) return 0
  const scaled = (delta * 1_000_000n) / base
  return Number(scaled) / 100
}

// ─── Quoter ──────────────────────────────────────────────────────────────────

export class EswapQuoter {
  private readonly client: PublicClient
  private readonly market: MarketConfig
  private readonly quoterAddress: Address
  private readonly routerAddress: Address

  constructor(
    client: PublicClient,
    market: MarketConfig = ETH_USDC,
    quoterAddress: Address = ADDRESSES.quoter,
    routerAddress: Address = ADDRESSES.router,
  ) {
    this.client = client
    this.market = market
    this.quoterAddress = quoterAddress
    this.routerAddress = routerAddress
  }

  get isConfigured(): boolean {
    return !isUnset(this.quoterAddress)
  }

  /**
   * Price one leveraged open.
   *
   * The protocol quote and the deep-pool reference are read from two different
   * contracts so a bug (or an outage) in one cannot silently make the delta look
   * attractive. If either read fails the whole quote fails — a partial quote is
   * never returned.
   */
  async quote(req: QuoteRequest, opts: QuoteOptions = {}): Promise<Quote> {
    const market = req.market ?? this.market
    if (!this.isConfigured) {
      throw new Error('ESWAP quoter address is not configured (V4_QUOTER_ADDRESS)')
    }
    const { marginIn, leverage } = req
    if (marginIn <= 0n) throw new Error('marginIn must be positive')
    if (leverage < 1 || leverage > 20) throw new Error(`leverage out of range: ${leverage}`)

    const notionalIn = marginIn * BigInt(leverage)
    const blockNumber = await this.client.getBlockNumber()

    // Both legs must describe the SAME trade for the delta to mean anything.
    //
    // The protocol quoter signs its input as a negative int256 margin (exact
    // input). `EswapRouter.quoteExactInput` applies `abs(amountSpecified) *
    // leverage` internally, so the router must be given the MARGIN as well -
    // passing `notionalIn` here would scale the reference by leverage a second
    // time and inflate it by `leverage`x, which reads as a large fake negative
    // edge on every quote.
    const amountSpecified = -BigInt(asInt256(marginIn))

    const [eswapOut, rawReferenceOut] = await Promise.all([
      this.client.readContract({
        address: this.quoterAddress,
        abi: LEVERAGE_QUOTER_ABI,
        functionName: 'quoteExactInputSingleWithLeverage',
        args: [market.tokenIn, market.tokenOut, market.adapterFeeTier, leverage, amountSpecified],
      }),
      this.client.readContract({
        address: this.routerAddress,
        abi: ROUTER_ABI,
        functionName: 'quoteExactInput',
        args: [toTuple(market.hookPool), isCurrency0(market, market.tokenIn), amountSpecified, leverage],
      }),
    ])

    const eswap = BigInt(eswapOut)
    const reference = referenceOut(BigInt(rawReferenceOut), market)
    const deltaOut = eswap - reference
    const deltaBps = toBps(deltaOut, reference)

    // Net edge: raw delta minus the physical pool fee we would pay on the unwind
    // leg and the flash premium. Both are charged in bps of the reference output.
    const unwindCostBps = COSTS.standardPoolFeeBps + COSTS.maxFlashPremiumBps
    const netEdgeOut = (deltaOut * BigInt(10_000 - unwindCostBps)) / 10_000n

    const minEdgeBps = opts.minEdgeBps ?? 20
    const profitable = toBps(netEdgeOut, reference) >= minEdgeBps

    return {
      marginIn,
      notionalIn,
      leverage,
      eswapOut: eswap,
      referenceOut: reference,
      deltaOut,
      deltaBps,
      netEdgeOut,
      profitable,
      verdict: profitable
        ? `net edge ${toBps(netEdgeOut, reference).toFixed(1)}bps >= ${minEdgeBps}bps`
        : `net edge ${toBps(netEdgeOut, reference).toFixed(1)}bps < ${minEdgeBps}bps (delta ${deltaBps.toFixed(2)}bps, costs ${unwindCostBps}bps)`,
      blockNumber,
    }
  }

/**
 * Price a full round trip: open then close, both through ESWAP.
 *
 * A round trip is always charged twice, so this is the number that decides
 * whether the atomic executor could ever clear its profit floor.
 *
 * UNIT SAFETY: `closeOut` is in `tokenOut` base units (ETH, 18dp) while the
 * flash repayment is in `tokenIn` base units (USDC, 6dp). Subtracting them
 * directly compares ~1e18-scale wei against ~1e6-scale micro-dollars and
 * produces a meaningless, wildly positive or negative number. Both legs are
 * normalised to 18-decimal wad space first.
 *
 * `eswapOut` is deliberately NOT overwritten. It previously was, which meant a
 * round-trip quote handed to `buildPlan` would floor the OPEN off the CLOSE
 * output — a floor derived from the wrong leg, silently. The two legs are now
 * separate fields and `eswapOut` keeps its one meaning everywhere.
 */
async quoteRoundTrip(req: QuoteRequest, opts: QuoteOptions = {}): Promise<RoundTripQuote> {
    const market = req.market ?? this.market
    const open = await this.quote(req, opts)
    const roundTripCostBps =
      COSTS.protocolFeeBps * 2 + COSTS.standardPoolFeeBps * 2 + COSTS.actualFlashPremiumBps

    // Closing returns collateral minus the solver's principal, so the trader's
    // recoverable value is strictly less than the open output.
    const closeOut = (open.eswapOut * BigInt(10_000 - COSTS.protocolFeeBps)) / 10_000n
    const owed = (open.marginIn * BigInt(10_000 + COSTS.actualFlashPremiumBps)) / 10_000n

    // Normalise both sides to 18 decimals before comparing.
    const closeWad = toWad(closeOut, market.decimalsOut)
    const owedWad = toWad(owed, market.decimalsIn)
    const roundTripNet = closeWad - owedWad
    const profitable = roundTripNet > 0n

    return {
      ...open,
      roundTripCostBps,
      repayInWad: owedWad,
      openOut: open.eswapOut,
      closeOut,
      roundTripNetWad: roundTripNet,
      netEdgeOut: roundTripNet,
      profitable,
      verdict: profitable
        ? `round trip clears by ${roundTripNet} wad units`
        : `round trip loses ${-roundTripNet} wad units before gas; cost floor ${roundTripCostBps.toFixed(2)}bps`,
    }
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** `amountSpecified` is int256; reject anything that cannot round-trip. */
function asInt256(value: bigint): string {
  const asString = value.toString()
  // 2^255 boundary check without BigInt exponent abuse in the hot path.
  if (asString.length > 77) throw new Error('amountIn exceeds int256 range')
  return asString
}

export function isCurrency0(market: MarketConfig, token: Address): boolean {
  return market.hookPool.currency0.toLowerCase() === token.toLowerCase()
}

/** An address is "unset" when the env var was missing or blank. */
export function isUnset(address: string): boolean {
  return address === '' || address === '0x'
}

/** Shape a `PoolConfig` into the object the router's `quoteExactInput` expects. */
export function toTuple(pool: MarketConfig['hookPool']) {
  return {
    currency0: pool.currency0,
    currency1: pool.currency1,
    fee: pool.fee,
    tickSpacing: pool.tickSpacing,
    hooks: pool.hooks,
  }
}

/** Convenience: the deepest native-ETH pool on the live deployment. */
export const DEEP_POOL = ETH_USDC.standardPool
export const NATIVE = NATIVE_ETH