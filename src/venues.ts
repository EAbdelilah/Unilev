/**
 * src/venues.ts — independent price sources for the arbitrage engine.
 *
 * WHY THIS MODULE EXISTS
 * ----------------------
 * ESWAP's leveraged open fills through the same deep Uniswap V4 pool it is
 * benchmarked against (see `standardPoolKeys` in the hook registry). Swapping out
 * of an ESWAP position and straight back into that pool therefore pays the
 * protocol toll, the pool fee and the flash premium with no price improvement to
 * capture — a strictly losing round trip. The only way an atomic ESWAP
 * round trip can have positive EV is if the unwind leg fills on a *different*
 * venue at a better price.
 *
 * This module supplies those independent prices. It is strictly read-only: it
 * cannot broadcast, and it is imported by the monitor, the executor's simulation
 * gate and the fork test alike.
 *
 * NATIVE CURRENCY
 * ---------------
 * Uniswap V2 and V3 quoters cannot take `address(0)`. Native ETH is quoted
 * through its WETH wrapper instead, which is exactly 1:1 with ETH, so the quoted
 * WETH output is directly comparable to an ETH-denominated ESWAP output. The
 * substitution is applied here once, so callers never have to think about it.
 */

import type { Address, PublicClient } from 'viem'
import { ADDRESSES, ETH_USDC, NATIVE_ETH, type MarketConfig } from './config'

// ─── Addresses (Unichain mainnet, chain 130) ─────────────────────────────────
//
// Sourced from the Uniswap developers site, "Unichain / technical information /
// contract addresses". Nothing here is inferred or guessed.

export const UNICHAIN_VENUES = {
  /** Uniswap v3 — canonical singleton factory; `getPool` resolves the pool. */
  uniV3Factory: '0x1F98400000000000000000000000000000000003' as Address,
  /** Uniswap v3 QuoterV2. */
  uniV3Quoter: '0x385a5cf5f83e99f7bb2852b6a19c3538b9fa7658' as Address,
  /** Uniswap v2 Router02 — `getAmountsOut` gives a live V2 quote. */
  uniV2Router: '0x284f11109359a7e1306c3e447ef14d38400063ff' as Address,
  /** Uniswap v2 factory, for pool-existence checks. */
  uniV2Factory: '0x1F98400000000000000000000000000000000002' as Address,
  /** Uniswap v4 periphery Quoter. */
  uniV4Quoter: '0x333e3c607b141b18ff6de9f258db6e77fe7491e0' as Address,
  /** Uniswap v4 StateView — authoritative pool spot state. */
  uniV4StateView: '0x86e8631a016f9068c3f085faf484ee3f5fdee8f2' as Address,
  /**
   * Balancer V2 Vault. A canonical singleton deployed at the same address on
   * every supported network, so this value is chain-constant.
   */
  balancerVault: '0xBA12222222228d8Ba445958a75a0704d566BF2C8' as Address,
} as const

/** Fee tiers polled on Uniswap v3. */
export const V3_FEE_TIERS = [100, 500, 3_000, 10_000] as const

// ─── Minimal ABI surface ─────────────────────────────────────────────────────

export const UNI_V3_QUOTER_V2_ABI = [
  {
    type: 'function',
    name: 'quoteExactInputSingle',
    stateMutability: 'view',
    inputs: [
      {
        name: 'params',
        type: 'tuple',
        components: [
          { name: 'tokenIn', type: 'address' },
          { name: 'tokenOut', type: 'address' },
          { name: 'amountIn', type: 'uint256' },
          { name: 'fee', type: 'uint24' },
          { name: 'sqrtPriceLimitX96', type: 'uint160' },
        ],
      },
    ],
    outputs: [
      { name: 'amountOut', type: 'uint256' },
      { name: 'sqrtPriceX96After', type: 'uint160' },
      { name: 'initializedTicksCrossed', type: 'uint32' },
      { name: 'gasEstimate', type: 'uint256' },
    ],
  },
] as const

export const UNI_V3_FACTORY_ABI = [
  {
    type: 'function',
    name: 'getPool',
    stateMutability: 'view',
    inputs: [
      { name: 'tokenA', type: 'address' },
      { name: 'tokenB', type: 'address' },
      { name: 'fee', type: 'uint24' },
    ],
    outputs: [{ name: 'pool', type: 'address' }],
  },
] as const

export const UNI_V2_ROUTER_ABI = [
  {
    type: 'function',
    name: 'getAmountsOut',
    stateMutability: 'view',
    inputs: [
      { name: 'amountIn', type: 'uint256' },
      { name: 'path', type: 'address[]' },
    ],
    outputs: [{ name: 'amounts', type: 'uint256[]' }],
  },
] as const

export const UNI_V4_QUOTER_ABI = [
  {
    type: 'function',
    name: 'quoteExactInputSingle',
    stateMutability: 'view',
    inputs: [
      {
        name: 'params',
        type: 'tuple',
        components: [
          {
            name: 'poolKey',
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
          { name: 'amountIn', type: 'uint128' },
          { name: 'hookData', type: 'bytes' },
        ],
      },
    ],
    outputs: [
      { name: 'amountOut', type: 'uint256' },
      { name: 'sqrtPriceX96After', type: 'uint160' },
      { name: 'initializedTicksCrossed', type: 'uint32' },
      { name: 'gasEstimate', type: 'uint256' },
    ],
  },
] as const

export const UNI_V4_STATE_VIEW_ABI = [
  {
    type: 'function',
    name: 'getSlot0',
    stateMutability: 'view',
    inputs: [{ name: 'poolId', type: 'bytes32' }],
    outputs: [
      { name: 'sqrtPriceX96', type: 'uint160' },
      { name: 'tick', type: 'int24' },
      { name: 'protocolFee', type: 'uint24' },
      { name: 'lpFee', type: 'uint24' },
    ],
  },
  {
    type: 'function',
    name: 'getLiquidity',
    stateMutability: 'view',
    inputs: [{ name: 'poolId', type: 'bytes32' }],
    outputs: [{ name: 'liquidity', type: 'uint128' }],
  },
] as const

/** Balancer V2 `flashLoan`. Zero-premium on V2; the callback is generic. */
export const BALANCER_VAULT_ABI = [
  {
    type: 'function',
    name: 'flashLoan',
    stateMutability: 'payable',
    inputs: [
      { name: 'recipient', type: 'address' },
      { name: 'tokens', type: 'address[]' },
      { name: 'amounts', type: 'uint256[]' },
      { name: 'userData', type: 'bytes' },
    ],
    outputs: [],
  },
] as const

// ─── Types ───────────────────────────────────────────────────────────────────

export type VenueName =
| `uniswap-v3-${number}`
| 'uniswap-v2'
| 'uniswap-v4'

/**
 * Which leg of the round trip is being quoted.
 *
 * This distinction is load-bearing, not cosmetic. The two legs settle in
 * DIFFERENT currencies with different decimal bases:
 *
 *   - `forward`: ESWAP opens `flashAsset` (USDC, 6dp) -> `tokenOut` (ETH, 18dp).
 *     Comparing an external quote here is only meaningful against ESWAP's own
 *     open output, in ETH units.
 *   - `reverse`: the unwind converts recovered `tokenOut` (ETH, 18dp) back into
 *     `flashAsset` (USDC, 6dp). This is the quote that sizes `minVenueOut`, and
 *     it MUST be denominated in the flash asset, or the floor compares 18-decimal
 *     wei against a 6-decimal repayment and can never bind.
 */
export type Side = 'forward' | 'reverse'

/** One venue's quote for a notional. Never fabricated: absent is `null`. */
export interface VenueQuote {
  venue: VenueName
  /** Output in base units of whichever token this leg pays out; null if unavailable. */
  amountOut: bigint | null
  /** The venue's taker fee in bps, taken from the pool/constant, not guessed. */
  feeBps: number
  /** Set when the venue could not be quoted; `amountOut` is then null. */
  reason?: string
}

export interface VenueSnapshot {
  /** Which leg was quoted. */
  side: Side
  /** The input notional, in base units of this leg's input token. */
  amountIn: bigint
  /** The currency every `amountOut` above is denominated in. */
  outputToken: Address
  quotes: VenueQuote[]
  /** Highest-output venue, ignoring nulls. */
  best: VenueQuote | null
  blockNumber: bigint
  /**
   * Best external output minus the reference output for the same notional,
   * in `outputToken` units. Null when there is no reference (e.g. the open leg,
   * where ESWAP's own output is leveraged and therefore not comparable 1:1).
   */
  edge: bigint | null
  /** `edge` in bps of the reference output; null when there is no reference. */
  edgeBps: number | null
}

// ─── Quote book ──────────────────────────────────────────────────────────────

/**
 * Polls a fixed set of independent venues for the same trade.
 *
 * Every venue is attempted independently and a failure in one never suppresses
 * the others — a partial book is still useful, and the caller can see exactly
 * which venues went dark.
 */
export class VenueQuoteBook {
  private readonly client: PublicClient
  private readonly market: MarketConfig

  constructor(client: PublicClient, market: MarketConfig = ETH_USDC) {
    this.client = client
    this.market = market
  }

  /**
   * Quote every configured venue for one leg of the round trip.
   *
   * @param amountIn notional in this leg's INPUT token base units
   * @param side     `forward` = flashAsset -> tokenOut (the open)
   *                 `reverse` = tokenOut -> flashAsset (the unwind)
   * @param reference ESWAP's own output for the same leg, in this leg's OUTPUT
   *                  units. Only meaningful when the two are actually comparable;
   *                  pass `null` for the open leg, where ESWAP's output is
   *                  leveraged and a 1:1 comparison would be meaningless.
   */
  async snapshot(amountIn: bigint, side: Side, reference: bigint | null): Promise<VenueSnapshot> {
    const blockNumber = await this.client.getBlockNumber()
    const quotes = await Promise.all([
      ...V3_FEE_TIERS.map((fee) => this.uniV3(fee, amountIn, side)),
      this.uniV2(amountIn, side),
      this.uniV4(amountIn, side),
    ])

    const best = quotes.reduce<VenueQuote | null>((acc, q) => {
      if (q.amountOut === null) return acc
      if (acc === null || acc.amountOut === null) return q
      return q.amountOut > acc.amountOut ? q : acc
    }, null)

    const edge = best?.amountOut != null && reference != null ? best.amountOut - reference : null
    return {
      side,
      amountIn,
      outputToken: this.pair(side).tokenOut,
      quotes,
      best,
      blockNumber,
      edge,
      // `10_000n` already carries the bps scale. Dividing by 100 again here
      // would understate every edge by 100x, which is how a losing trade ends up
      // looking like a 0.3% winner.
      edgeBps:
        edge != null && reference != null && reference > 0n
          ? Number((edge * 10_000n) / reference)
          : null,
    }
  }

  /**
   * Quote the UNWIND leg: `tokenOut` back into the flash asset.
   *
   * This is the quote that sizes `minVenueOut`, and it must be in flash-asset
   * units. Callers that pass a tokenOut-denominated number here will produce a
   * floor that is ~1e12x too large and revert unconditionally.
   */
  unwindQuote(collateralIn: bigint, reference: bigint | null = null): Promise<VenueSnapshot> {
    return this.snapshot(collateralIn, 'reverse', reference)
  }

  // ─── Individual venues ───────────────────────────────────────────────────

  /** Uniswap v3 at a specific fee tier, via QuoterV2. */
  async uniV3(fee: number, amountIn: bigint, side: Side): Promise<VenueQuote> {
    const name = `uniswap-v3-${fee}` as VenueName
    try {
      const { tokenIn, tokenOut } = this.pair(side)
      const pool = (await this.client.readContract({
        address: UNICHAIN_VENUES.uniV3Factory,
        abi: UNI_V3_FACTORY_ABI,
        functionName: 'getPool',
        args: [tokenIn, tokenOut, fee],
      })) as Address
      if (pool === '0x0000000000000000000000000000000000000000') {
        return { venue: name, amountOut: null, feeBps: fee / 100, reason: 'pool not deployed' }
      }
      const out = await this.client.readContract({
        address: UNICHAIN_VENUES.uniV3Quoter,
        abi: UNI_V3_QUOTER_V2_ABI,
        functionName: 'quoteExactInputSingle',
        args: [{ tokenIn, tokenOut, amountIn, fee, sqrtPriceLimitX96: 0n }],
      })
      return { venue: name, amountOut: out[0], feeBps: fee / 100 }
    } catch (error) {
      return { venue: name, amountOut: null, feeBps: fee / 100, reason: short(error) }
    }
  }

  /**
   * Uniswap v2, via Router02 `getAmountsOut`. Fee is a fixed 30 bps.
   */
  async uniV2(amountIn: bigint, side: Side): Promise<VenueQuote> {
    const name = 'uniswap-v2' as VenueName
    try {
      const { tokenIn, tokenOut } = this.pair(side)
      const amounts = (await this.client.readContract({
        address: UNICHAIN_VENUES.uniV2Router,
        abi: UNI_V2_ROUTER_ABI,
        functionName: 'getAmountsOut',
        args: [amountIn, [tokenIn, tokenOut]],
      })) as readonly bigint[]
      return { venue: name, amountOut: amounts[1], feeBps: 30 }
    } catch (error) {
      return { venue: name, amountOut: null, feeBps: 30, reason: short(error) }
    }
  }

  /**
   * Uniswap v4 via the periphery Quoter, against the physical fee-500 pool the
   * hook routes fills through.
   *
   * NOTE: the v4 periphery `Quoter` ABI has changed shape across releases. A
   * mismatch is reported as an unavailable venue rather than throwing, so this
   * probe can never take down the whole book.
   */
  async uniV4(amountIn: bigint, side: Side): Promise<VenueQuote> {
    const name = 'uniswap-v4' as VenueName
    const feeBps = ETH_USDC.standardPool.fee / 100
    try {
      const pool = ETH_USDC.standardPool
      // `zeroForOne` must follow the leg being quoted, not the market's default
      // orientation, or the reverse leg prices the swap backwards and reports a
      // confident, entirely fictional number.
      const { tokenIn } = this.pair(side)
      const zeroForOne = pool.currency0.toLowerCase() === tokenIn.toLowerCase()
      const out = await this.client.readContract({
        address: UNICHAIN_VENUES.uniV4Quoter,
        abi: UNI_V4_QUOTER_ABI,
        functionName: 'quoteExactInputSingle',
        args: [
          {
            poolKey: {
              currency0: pool.currency0,
              currency1: pool.currency1,
              fee: pool.fee,
              tickSpacing: pool.tickSpacing,
              hooks: pool.hooks,
            },
            zeroForOne,
            amountIn,
            hookData: '0x',
          },
        ],
      })
      return { venue: name, amountOut: out[0], feeBps }
      } catch (error) {
      return { venue: name, amountOut: null, feeBps, reason: short(error) }
    }
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  /**
   * The quoteable pair for one leg.
   *
   * Native ETH is represented by its WETH wrapper because no v2/v3 quoter accepts
   * `address(0)`; WETH and ETH are 1:1, so this is exact rather than an
   * approximation. `reverse` swaps the orientation, which is what makes the
   * unwind leg quotable at all.
   */
  private pair(side: Side): { tokenIn: Address; tokenOut: Address } {
    const wrap = (token: Address): Address =>
      token === NATIVE_ETH ? ADDRESSES.weth : token
    const forward = {
      tokenIn: wrap(this.market.tokenIn),
      tokenOut: wrap(this.market.tokenOut),
    }
    if (side === 'forward') return forward
    return { tokenIn: forward.tokenOut, tokenOut: forward.tokenIn }
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** One-line reason string; keeps monitor output readable. */
export function short(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  const first = message.split('\n')[0]
  return first.length > 120 ? `${first.slice(0, 117)}...` : first
}

/** Human-readable multi-line rendering of a venue book. */
export function formatSnapshot(snapshot: VenueSnapshot): string {
  const lines = snapshot.quotes.map((q) => {
    if (q.amountOut === null) return `  ${q.venue.padEnd(24)} n/a  (${q.reason ?? 'unknown'})`
    const edge =
      snapshot.edgeBps === null
        ? ''
        : ` ${snapshot.edgeBps >= 0 ? '+' : ''}${snapshot.edgeBps.toFixed(2)}bps vs reference`
    return `  ${q.venue.padEnd(24)} ${q.amountOut.toString().padStart(22)}  fee=${String(q.feeBps).padStart(2)}bps${edge}`
  })
  const best = snapshot.best
  return [
    `venue book [${snapshot.side}] @ block ${snapshot.blockNumber} in=${snapshot.amountIn} out=${snapshot.outputToken}`,
    ...lines,
    best
      ? `  best: ${best.venue}${snapshot.edgeBps === null ? '' : ` (${snapshot.edgeBps.toFixed(2)}bps)`}`
      : '  best: none available',
  ].join('\n')
}