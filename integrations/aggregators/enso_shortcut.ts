/**
 * Enso Shortcuts — register Eswap as a custom strategy.
 *
 * Enso Shortcuts route by *selector*: a shortcut declares a target address and a
 * function selector, plus calldata templates for the calls around it. That maps
 * cleanly onto Eswap because the adapter exposes exactly two stable selectors.
 *
 * Two integration shapes:
 *
 *   1. calldata-based (no Enso SDK dependency) — build the shortcut config as a
 *      plain object and POST it. This file implements that so the package runs
 *      with only `viem` installed.
 *   2. `@ensofinance/sdk` — if you have the SDK, hand it the same descriptor.
 *      Type-guard keeps both paths honest; see `toEnsoSdkShortcut`.
 *
 * The important Enso-specific detail: Enso executes MULTIPLE calls per shortcut
 * (a call chain). For Eswap the minimum useful chain is:
 *
 *   1. `USDC.approve(adapter, amountIn)`   — only if amountIn > 0 and the caller
 *                                            is not the solver (the solver borrow
 *                                            leg is settled by the router, not the
 *                                            trader; see below)
 *   2. `adapter.exactInputSingleWithLeverage(...)`
 *   3. optional close, same executor session
 *
 * NOTE ON THE BORROW LEG: the trader's `amountIn` is MARGIN only. The borrowed
 * leg is pulled from the SOLVER by the router via
 * `safeTransferFrom(params.solver, address(manager), borrowAmount)` (Router:784)
 * and settled with `settleFor(hook)`. An integrator must NOT try to fund the
 * borrow, and must NOT approve more than its own margin.
 */

import {
  createPublicClient,
  encodeFunctionData,
  http,
  parseAbi,
  type Address,
  type Hex,
} from 'viem'
import { unichain } from 'viem/chains'

import {
  ADAPTER,
  ADAPTER_ABI,
  ADAPTER_FEE_TIER,
  CHAIN_ID,
  DEFAULT_SOLVER,
  HOOK_POOL_KEY,
  LIMITS,
  NATIVE_ETH,
  ROUND_TRIP_COST_BPS,
  SELECTORS,
  STANDARD_POOL_KEY,
  USDC,
  MEASURED_GAS,
} from './shared.js'

const USDC_ABI = parseAbi([
  'function approve(address spender, uint256 amount) returns (bool)',
])

/** Enso config endpoint. Override for staging/self-hosted. */
const ENSO_CONFIG_URL =
  process.env.ENSO_CONFIG_URL ?? 'https://api.enso.finance'

export interface EnsoCall {
  /** Contract to call. */
  to: Address
  /** `0x`-prefixed calldata. */
  data: Hex
  /** Native value forwarded, if any. */
  value?: bigint
  /** Enso-side label for tracing. */
  label?: string
}

export interface EnsoShortcutDescriptor {
  name: string
  description: string
  chainId: number
  /** Enso groups shortcuts under a "connector". */
  connector: string
  /** Function selector Enso routes on. */
  selector: Hex
  /** Contract owning that selector. */
  target: Address
  calls: EnsoCall[]
  /** Bps the shortcut is expected to be worth. Enso uses this for ranking. */
  valueBps: number
  /** Gas Enso should reserve for the whole chain. */
  gasReserve: bigint
  /** Tokens the chain touches, for approval checks. */
  tokens: Address[]
}

export interface BuildShortcutParams {
  tokenIn: Address
  tokenOut: Address
  /** Leverage multiplier, 2..maxLeverage. */
  leverage: number
  /** MARGIN in tokenIn units — NOT notional. */
  amountIn: bigint
  /** Minimum acceptable tokenOut. */
  minAmountOut: bigint
  /** Position owner; receives the ERC-6909 collateral claim. */
  recipient: Address
  /**
   * Skip the approval call. Set true when `amountIn` is 0 (e.g. a pure
   * aggregator-prefill open) or when approval is already in place.
   */
  skipApproval?: boolean
}

/**
 * Enso ranks shortcuts by `valueBps`. We refuse to let a caller fabricate it.
 *
 * The honest default is `ROUND_TRIP_COST_BPS` (30 bps) — below that a route
 * cannot clear Eswap's own costs. Anything higher must be a measured edge from
 * the caller's own quoting, passed explicitly.
 */
function assertSaneValueBps(valueBps: number): void {
  if (!Number.isFinite(valueBps)) throw new Error('valueBps must be finite')
  if (valueBps < ROUND_TRIP_COST_BPS) {
    throw new Error(
      `valueBps ${valueBps} is below Eswap's ${ROUND_TRIP_COST_BPS} bps round-trip cost; ` +
        `this route cannot be profitable`,
    )
  }
  if (valueBps > 10_000) throw new Error('valueBps exceeds 10000 bps')
}

function assertLeverage(leverage: number): void {
  if (leverage < LIMITS.minLeverage) {
    throw new Error(
      `leverage ${leverage} below hook minimum ${LIMITS.minLeverage}`,
    )
  }
  if (leverage > LIMITS.maxLeverage) {
    throw new Error(
      `leverage ${leverage} above hook maximum ${LIMITS.maxLeverage}`,
    )
  }
}

/**
 * Build the two-call chain Enso needs to open a leveraged position.
 *
 * Never encodes an approval for the borrowed leg: the borrow is the solver's,
 * and over-approving from the trader would be both wrong and unsafe.
 */
export function buildLeverageShortcut(
  params: BuildShortcutParams,
): EnsoShortcutDescriptor {
  const {
    tokenIn,
    tokenOut,
    leverage,
    amountIn,
    minAmountOut,
    recipient,
    skipApproval = false,
  } = params

  assertLeverage(leverage)
  if (recipient === '0x0000000000000000000000000000000000000000') {
    throw new Error('recipient must be non-zero')
  }

  const calls: EnsoCall[] = []

  // Approval is margin-only. The router pulls the borrow leg from the solver.
  if (!skipApproval && amountIn > 0n) {
    calls.push({
      to: tokenIn,
      data: encodeFunctionData({
        abi: USDC_ABI,
        functionName: 'approve',
        args: [ADAPTER, amountIn],
      }),
      label: 'approve margin to adapter',
    })
  }

  calls.push({
    to: ADAPTER,
    data: encodeFunctionData({
      abi: ADAPTER_ABI,
      functionName: 'exactInputSingleWithLeverage',
      args: [
        tokenIn,
        tokenOut,
        ADAPTER_FEE_TIER,
        leverage,
        amountIn,
        minAmountOut,
        recipient,
      ],
    }),
    label: 'eswap leveraged open',
  })

  // Measured round trip plus one approval; round generously for the close leg.
  const gasReserve = MEASURED_GAS.canaryRoundTrip + MEASURED_GAS.open / 2n

  const descriptor: EnsoShortcutDescriptor = {
    name: `eswap-leverage-${leverage}x`,
    description:
      `Open a ${leverage}x leveraged ${tokenIn === USDC ? 'ETH/USDC' : 'pair'} position on ` +
      `Eswap (Uniswap V4, chain ${CHAIN_ID}). Margin settles against the deep V4 pool via ` +
      `flash accounting; the borrowed leg is supplied by solver ` +
      `${DEFAULT_SOLVER} and earns principal + LP yield.`,
    chainId: CHAIN_ID,
    connector: 'eswap',
    selector: SELECTORS.exactInputSingleWithLeverage,
    target: ADAPTER,
    calls,
    // Default: exactly the protocol cost. Override with your own measured edge.
    valueBps: ROUND_TRIP_COST_BPS,
    gasReserve,
    tokens: [tokenIn, tokenOut],
  }

  return descriptor
}

/**
 * Shape the descriptor for `@ensofinance/sdk`.
 *
 * Kept as data rather than a hard SDK dependency so this package installs with
 * `viem` alone. Call it from a project that has the SDK installed.
 */
export function toEnsoSdkShortcut(
  d: EnsoShortcutDescriptor,
): Record<string, unknown> {
  assertSaneValueBps(d.valueBps)
  return {
    name: d.name,
    description: d.description,
    chainId: d.chainId,
    connector: d.connector,
    selector: d.selector,
    target: d.target,
    calls: d.calls.map((c) => ({
      to: c.to,
      data: c.data,
      value: c.value ? c.value.toString() : undefined,
      label: c.label,
    })),
    valueBps: d.valueBps,
    gasReserve: d.gasReserve.toString(),
    tokens: d.tokens,
  }
}

/**
 * Quote a leveraged open.
 *
 * VERIFIED LIVE: `amountIn` is a signed `int256`, but the sign is DISCARDED —
 * `EswapRouter.quoteExactInput` takes `absAmount = amountSpecified < 0 ?
 * -amountSpecified : amountSpecified`. A negative and a positive input of equal
 * magnitude return the identical result. So this is ALWAYS an exact-input quote
 * and the returned `amountOut` is always POSITIVE.
 *
 * Practical consequence: pass a positive magnitude for readability, and do not
 * branch on the sign of `amountOut` to infer direction.
 */
export async function quoteLeverage(
  quoter: Address,
  client: ReturnType<typeof createPublicClient>,
  p: {
    tokenIn: Address
    tokenOut: Address
    leverage: number
    amountIn: bigint
  },
): Promise<bigint> {
  assertLeverage(p.leverage)
  if (p.amountIn <= 0n) throw new Error('amountIn must be positive')

  const abi = parseAbi([
    'function quoteExactInputSingleWithLeverage(address,address,uint24,uint8,int256) view returns (int128)',
  ])

  const out = (await client.readContract({
    address: quoter,
    abi,
    functionName: 'quoteExactInputSingleWithLeverage',
    args: [p.tokenIn, p.tokenOut, ADAPTER_FEE_TIER, p.leverage, -p.amountIn],
  })) as bigint

  if (out <= 0n) throw new Error('quote returned non-positive output')
  return out
}

/** Convenience client on Unichain. */
export function ensoClient(rpcUrl: string) {
  return createPublicClient({ chain: unichain, transport: http(rpcUrl) })
}

/**
 * Register the shortcut with Enso.
 *
 * Posts the descriptor; on failure returns the parsed error instead of throwing
 * so a bad intake payload surfaces field names rather than a stack trace.
 */
export async function registerShortcut(
  descriptor: EnsoShortcutDescriptor,
  opts: { apiKey?: string; fetchImpl?: typeof fetch } = {},
): Promise<{ ok: true; status: number } | { ok: false; error: string }> {
  const body = toEnsoSdkShortcut(descriptor)
  const doFetch = opts.fetchImpl ?? fetch

  try {
    const res = await doFetch(`${ENSO_CONFIG_URL}/config/shortcuts`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(opts.apiKey ? { authorization: `Bearer ${opts.apiKey}` } : {}),
      },
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      return { ok: false, error: `HTTP ${res.status}: ${text.slice(0, 500)}` }
    }
    return { ok: true, status: res.status }
  } catch (e) {
    return { ok: false, error: String((e as Error).message).slice(0, 300) }
  }
}

// -----------------------------------------------------------------------------
// Live deployment summary, for the intake form
// -----------------------------------------------------------------------------

export const ENSO_SUBMISSION = {
  name: 'Eswap',
  chainId: CHAIN_ID,
  connector: 'eswap',
  selector: SELECTORS.exactInputSingleWithLeverage,
  target: ADAPTER,
  quoterSelector: SELECTORS.quoteExactInputSingleWithLeverage,
  adapter: ADAPTER,
  accountingPoolKey: HOOK_POOL_KEY,
  settlementPoolKey: STANDARD_POOL_KEY,
  nativeCurrencySentinel: NATIVE_ETH,
  leverageRange: [LIMITS.minLeverage, LIMITS.maxLeverage],
  roundTripCostBps: ROUND_TRIP_COST_BPS,
  measuredGas: MEASURED_GAS,
  docs: 'integrations/aggregators/odos_registration.json carries the full verified payload',
} as const