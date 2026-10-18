/**
 * Module 3 — ERC-7683 cross-chain intent relayer.
 *
 * Target contract: `EswapSettlement` (src/v4/EswapSettlement.sol), implementing
 * the ERC-7683 destination-settler interface:
 *
 *   fill(bytes32 orderId, bytes calldata originData, bytes calldata fillerData)
 *
 * Bridge networks covered by this module's shape: Across, Socket/Bungee, and any
 * other ERC-7683 filler. The bridge is only the transport — the leveraged open
 * is executed by Eswap on Base.
 *
 * THE FLOW
 *
 *   Origin chain    trader signs a CrossChainOrder committing to a leveraged fill
 *   Bridge          relayer supplies margin + borrow on Base
 *   Destination     relayer calls EswapSettlement.fill(orderId, originData, fillerData)
 *
 * WHY THE POSITION LANDS WITH THE USER, NOT THE SETTLEMENT
 *
 *   EswapSettlement.sol:19-28 documents an explicit design decision (H-4):
 *
 *     "Positions are credited DIRECTLY to the order recipient (the swapper
 *      recovered from hookData), NOT to this settlement. The settlement acts
 *      only as the filler-side solver + margin funder for the router's
 *      solver-funded multi-pool open; the recipient owns the position claim from
 *      the first block."
 *
 *   Two consequences for a relayer:
 *     1. You never custody the user's position. Your capital is repaid from the
 *        hook, not from the user's claim.
 *     2. `filledRecipient[orderId]` is recorded so the recipient can be resolved
 *        after the bridge. Read it before paying out.
 *
 *   The recipient closes with `EswapRouter.closePosition` as the DIRECT caller
 *   (the router's C-1 rule), so you cannot close on their behalf.
 *
 * CAPITAL
 *
 *   The settlement overwrites the origin order's solver address with
 *   `address(this)` (EswapSettlement.sol:67). That means THE SETTLEMENT CONTRACT
 *   is the recorded solver — it must hold the margin and borrow leg, and its
 *   operator manages replenishment.
 *
 *   Repayment is principal + accumulatedYield (EswapMarginHookLogic2.sol:454),
 *   paid before the liquidator incentive (lines 496-500). Uncovered shortfall
 *   after insurance becomes badDebt (line 492) and the payout is truncated
 *   (line 497). Priority, not a guarantee.
 */

import {
  decodeAbiParameters,
  encodeAbiParameters,
  encodeFunctionData,
  keccak256,
  parseAbi,
  type AbiParameter,
  type Address,
  type Hex,
} from 'viem'

import {
  SETTLEMENTS,
  LIVE_HOOK_POOL,
  LIVE_STANDARD_POOL,
  borrowNotional,
  type PoolKey,
} from '../solvers/shared.js'

// -----------------------------------------------------------------------------
// ERC-7683 origin-chain types
// -----------------------------------------------------------------------------

/** `OutputToken` in ERC-7683. */
export interface Erc7683OutputToken {
  token: Address
  amount: bigint
  recipient: Address
  /** Optional bridge-specific call executed before delivery. */
  callData: Hex
}

/**
 * ERC-7683 `CrossChainOrder`.
 *
 * Field set per the ERC-7683 reference; `customData` is the open field the
 * chain-specific fillers define. Across, Socket and Bungee each reserve
 * different bytes of it, so a real integration must decode it per bridge.
 */
export interface CrossChainOrder {
  originChainId: bigint
  destinationChainId: bigint
  depositNonce: bigint
  fillDeadline: bigint
  originData: Hex
  maxSpent: { amount: bigint; chainId: bigint }
  minReceived: { amount: bigint; chainId: bigint }
  /**
   * ERC-7683 `filler`: an opaque `bytes32` identifier naming the permitted
   * filler — NOT an address. A bridge may encode an address left-padded to 32
   * bytes, or an arbitrary tag. Getting this wrong makes the id encoding throw.
   */
  filler: Hex
}

/**
 * Eswap originData.
 *
 * Documented at EswapSettlement.sol:65-68 as ABI-encoded `SwapParams`:
 *   (PoolKey key, PoolKey standardPoolKey, bool zeroForOne,
 *    int256 amountSpecified, uint8 leverage, address solver,
 *    bytes hookData, uint256 minAmountOut)
 *
 * The `solver` field is OVERWRITTEN with `address(this)` on fill. Put the true
 * user recipient in `hookData` — that is what H-4 relies on.
 */
export type EswapOriginData = {
  key: PoolKey
  standardPoolKey: PoolKey
  zeroForOne: boolean
  /**
   * Signed, v4 convention: NEGATIVE = exact input.
   *
   * This is the EXECUTION path, not the quoter. Unlike the view-only
   * `quoteExactInput`, the real open is a v4 swap and genuinely branches on the
   * sign, so a positive value here would invert exact-input into exact-output
   * and change both the economics and the slippage direction. `precheckFill`
   * rejects a non-negative value rather than normalising it.
   */
  amountSpecified: bigint
  leverage: number
  /** Ignored; overwritten with the settlement address. */
  solver: Address
  hookData: Hex
  minAmountOut: bigint
}

/** ABI fragment of `EswapSettlement`. */
export const ERC7683_SETTLEMENT_ABI = [
  {
    type: 'function',
    name: 'fill',
    stateMutability: 'payable',
    inputs: [
      { name: 'orderId', type: 'bytes32' },
      { name: 'originData', type: 'bytes' },
      { name: 'fillerData', type: 'bytes' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'filledOrders',
    stateMutability: 'view',
    inputs: [{ name: 'orderId_', type: 'bytes32' }],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'filledRecipient',
    stateMutability: 'view',
    inputs: [{ name: 'orderId_', type: 'bytes32' }],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'router',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'event',
    name: 'PositionFilled',
    inputs: [
      { name: 'orderId', type: 'bytes32', indexed: true },
      { name: 'recipient', type: 'address', indexed: true },
      { name: 'tokenIn', type: 'address', indexed: true },
      { name: 'marginAmount', type: 'uint256', indexed: false },
    ],
  },
] as const

/** PoolKey tuple shape, reused across originData decoding. */
const POOL_KEY_TUPLE_COMPONENTS = [
  { name: 'currency0', type: 'address' },
  { name: 'currency1', type: 'address' },
  { name: 'fee', type: 'uint24' },
  { name: 'tickSpacing', type: 'int24' },
  { name: 'hooks', type: 'address' },
]

/**
 * OriginData parameter layout, per EswapSettlement.sol:65-68.
 *
 * The outer list is `as const` (so decode order stays literal-typed), while the
 * component list stays mutable: viem's `AbiParameter` requires a mutable
 * `components` array, and an `as const` component list fails to assign.
 */
const ORIGIN_DATA_PARAMS = [
  { type: 'tuple', components: POOL_KEY_TUPLE_COMPONENTS },
  { type: 'tuple', components: POOL_KEY_TUPLE_COMPONENTS },
  { type: 'bool' },
  { type: 'int256' },
  { type: 'uint8' },
  { type: 'address' },
  { type: 'bytes' },
  { type: 'uint256' },
] as const satisfies readonly AbiParameter[]

/** Decode `originData` from a bridge payload. */
export function decodeOriginData(originData: Hex): EswapOriginData {
  const decoded = decodeAbiParameters(ORIGIN_DATA_PARAMS, originData)
  return {
    key: decoded[0] as unknown as PoolKey,
    standardPoolKey: decoded[1] as unknown as PoolKey,
    zeroForOne: decoded[2],
    amountSpecified: decoded[3],
    leverage: Number(decoded[4]),
    solver: decoded[5],
    hookData: decoded[6],
    minAmountOut: decoded[7],
  }
}

/**
 * Derive the order id.
 *
 * The settlement only stores `bytes32 orderId`, and its replay guard is
 * `filledOrders[orderId]`. A relayer MUST therefore use the bridge's canonical
 * id, not a locally invented hash — otherwise replay protection does not
 * correspond to anything the origin chain can invalidate.
 */
const ORDER_ID_PARAMS = [
  { type: 'uint256' },
  { type: 'uint256' },
  { type: 'uint256' },
  { type: 'uint256' },
  { type: 'bytes' },
  { type: 'uint256' },
  { type: 'uint256' },
  { type: 'uint256' },
  { type: 'uint256' },
  { type: 'bytes32' },
] as const

/**
 * Fallback order id.
 *
 * Deliberately NOT production-grade. Each bridge derives its id differently
 * (Across uses a spoke-pool-specific hash; Socket and Bungee each have their
 * own), and the settlement's replay guard is keyed on this value. A derivation
 * that disagrees with the origin chain means a filled order is not recognised
 * as filled — or worse, an unfilled one is.
 *
 * Replace per bridge before any production fill. `deriveOrderId` accepts an
 * override so the bridge-specific derivation can be injected cleanly.
 */
function fallbackOrderId(order: CrossChainOrder): Hex {
  return keccak256(
    encodeAbiParameters(ORDER_ID_PARAMS, [
      order.originChainId,
      order.destinationChainId,
      order.depositNonce,
      order.fillDeadline,
      order.originData,
      order.maxSpent.amount,
      order.maxSpent.chainId,
      order.minReceived.amount,
      order.minReceived.chainId,
      order.filler,
    ]),
  )
}

/**
 * Derive the order id the settlement's replay guard will use.
 *
 * `settlement.fill` only stores a `bytes32 orderId` and checks
 * `filledOrders[orderId]`. A relayer MUST therefore pass the bridge's canonical
 * id, not a locally invented hash — otherwise replay protection does not
 * correspond to anything the origin chain can invalidate.
 *
 * Pass `bridgeDeriveId` to override the placeholder with the bridge's real
 * algorithm.
 */
export function deriveOrderId(
  crossChainOrder: CrossChainOrder,
  bridgeDeriveId?: (order: CrossChainOrder) => Hex,
): Hex {
  return bridgeDeriveId ? bridgeDeriveId(crossChainOrder) : fallbackOrderId(crossChainOrder)
}

// -----------------------------------------------------------------------------
// Economics
// -----------------------------------------------------------------------------

export interface CrossChainEconomics {
  /** Margin the settlement must hold. */
  marginRequired: bigint
  /** Borrow notional, margin * (leverage - 1). */
  borrowRequired: bigint
  /** Total capital the settlement must front. */
  capitalFronted: bigint
  /** 10 bps protocol toll at open. */
  protocolFee: bigint
  /** 5 bps settlement pool fee. */
  settlementFee: bigint
  /** 0 bps — the flash provider hardcodes a zero premium. */
  flashPremium: bigint
  /** Total fixed cost at open. */
  openCost: bigint
  /** Fixed cost if the position is opened and closed. */
  roundTripCost: bigint
  /**
   * Minimum rehypothecation yield required for the position to break even.
   *
   * This is the only break-even figure computable at fill time. It is a
   * REQUIREMENT, not a prediction — whether the band actually accrues that much
   * depends on the price path until close.
   */
  minYieldToBreakEven: bigint
}

/**
 * Compute what a fill costs the settlement before quoting a relayer.
 *
 * Note this is the settlement's cost, which it recovers from principal + yield.
 * A relayer's own profit is a SEPARATE number that depends on its bridge fee
 * and competitive fill pricing; do not conflate the two.
 */
export function computeCrossChainEconomics(p: {
  marginAmount: bigint
  leverage: number
  roundTripCostBps?: number
}): CrossChainEconomics {
  const leverage = p.leverage
  if (leverage < 2) throw new Error('ERC-7683 leveraged fills require leverage >= 2')

  const margin = p.marginAmount
  const borrow = borrowNotional(margin, leverage)
  const notional = margin * BigInt(leverage)

  const protocolFee = (notional * 10n) / 10_000n
  const settlementFee = (notional * 5n) / 10_000n
  const flashPremium = 0n
  const openCost = protocolFee + settlementFee + flashPremium

  const bps = BigInt(p.roundTripCostBps ?? 30)
  const roundTripCost = (notional * bps) / 10_000n * 2n

  return {
    marginRequired: margin,
    borrowRequired: borrow,
    capitalFronted: margin + borrow,
    protocolFee,
    settlementFee,
    flashPremium,
    openCost,
    roundTripCost,
    minYieldToBreakEven: roundTripCost,
  }
}

// -----------------------------------------------------------------------------
// Pre-flight validation
// -----------------------------------------------------------------------------

export type CrossChainRejection =
  | 'deadline-expired'
  | 'wrong-destination-chain'
  | 'non-negative-amount-specified'
  | 'amount-specified-must-be-negative'
  | 'leverage-out-of-range'
  | 'order-already-filled'
  | 'origin-data-undecodable'
  | 'recipient-unresolved'
  | 'not-solver-funded'
  | 'zero-solver'

export interface CrossChainPrecheck {
  ok: boolean
  reason?: CrossChainRejection
  detail?: string
  economics?: CrossChainEconomics
  /** Whether the settlement already holds the margin + borrow. */
  settlementFunded?: boolean
}

/**
 * Validate before filling.
 *
 * `amountSpecified` MUST be negative (v4 exact-input convention). A positive
 * value would be read as exact-output and would change the economics entirely,
 * so it is rejected rather than normalised.
 */
export function precheckFill(p: {
  orderId: Hex
  order: CrossChainOrder
  now: number
  localChainId: number
  alreadyFilled: boolean
  /** Margin the settlement actually holds for this order. */
  settlementBalance: bigint
  recipientFromHookData: Address | null
}): CrossChainPrecheck {
  const fail = (
    reason: CrossChainRejection,
    detail: string,
    economics?: CrossChainEconomics,
  ): CrossChainPrecheck => ({
    ok: false,
    reason,
    detail,
    economics,
    settlementFunded: false,
  })

  if (p.order.destinationChainId !== BigInt(p.localChainId)) {
    return fail(
      'wrong-destination-chain',
      `destinationChainId ${p.order.destinationChainId} != ${p.localChainId}`,
    )
  }
  if (p.order.fillDeadline < BigInt(p.now)) {
    return fail('deadline-expired', `fillDeadline ${p.order.fillDeadline} < now ${p.now}`)
  }
  if (p.alreadyFilled) {
    return fail('order-already-filled', `filledOrders[${p.orderId}] is true`)
  }

  let origin: EswapOriginData
  try {
    origin = decodeOriginData(p.order.originData)
  } catch (e) {
    return fail(
      'origin-data-undecodable',
      `originData did not decode as Eswap SwapParams: ${String((e as Error).message).slice(0, 120)}`,
    )
  }

  if (origin.amountSpecified >= 0n) {
    return fail(
      'amount-specified-must-be-negative',
      `amountSpecified ${origin.amountSpecified} must be negative (v4 exact-input convention)`,
    )
  }
  if (origin.leverage < 2 || origin.leverage > 5) {
    return fail('leverage-out-of-range', `leverage ${origin.leverage} outside hook range 2..5`)
  }
  if (!p.recipientFromHookData) {
    return fail(
      'recipient-unresolved',
      'could not recover the position recipient from hookData; H-4 credits the position to that address, so it MUST be resolvable before filling',
    )
  }

  const margin = -origin.amountSpecified
  const econ = computeCrossChainEconomics({ marginAmount: margin, leverage: origin.leverage })

  if (p.settlementBalance < econ.capitalFronted) {
    return {
      ok: false,
      reason: 'not-solver-funded',
      detail: `settlement holds ${p.settlementBalance}, needs margin+borrow ${econ.capitalFronted}`,
      economics: econ,
      settlementFunded: false,
    }
  }

  return { ok: true, economics: econ, settlementFunded: true }
}

// -----------------------------------------------------------------------------
// Execution
// -----------------------------------------------------------------------------

/**
 * Encode `EswapSettlement.fill(orderId, originData, fillerData)`.
 *
 * `fillerData` is bridge-specific and unused by the settlement (its parameter is
 * unnamed and ignored). Pass the bridge's own blob; `0x` is valid.
 */
export function buildFillCalldata(p: {
  orderId: Hex
  originData: Hex
  fillerData?: Hex
}): Hex {
  return encodeFunctionData({
    abi: ERC7683_SETTLEMENT_ABI,
    functionName: 'fill',
    args: [p.orderId, p.originData, p.fillerData ?? '0x'],
  })
}

/**
 * Top up the settlement so it can act as solver.
 *
 * The settlement's `solver` field is overwritten to `address(this)`, so the
 * MARGIN AND BORROW must sit on the SETTLEMENT contract. The most reliable
 * mechanism is `router.depositBorrowEscrow` — the settlement contract would need
 * a callable path to it, which it does not currently expose. Until a
 * `fundSolver`-style entrypoint exists, an operator must transfer tokens to the
 * settlement directly.
 *
 * THIS IS A REAL GAP. See BLOCKERS.
 */
export const SETTLEMENT_FUNDING_ABI = parseAbi([
  'function filledRecipient(bytes32) view returns (address)',
  'function filledOrders(bytes32) view returns (bool)',
])

/** Pool keys the fill uses. */
export const CROSSCHAIN_POOL_KEYS = {
  accounting: LIVE_HOOK_POOL,
  settlement: LIVE_STANDARD_POOL,
} satisfies { accounting: PoolKey; settlement: PoolKey }

export const ERC7683_SETTLEMENT_ADDRESS = SETTLEMENTS.erc7683

/**
 * DEPLOYMENT STATUS and the honest blockers.
 *
 * `EswapSettlement` compiles, is unit tested
 * (src/v4/test/EswapSettlementTest.t.sol), and IS deployed on Base Mainnet
 * (solver-whitelisted). Beyond deployment, the blockers listed below remain
 * before a cross-chain fill is possible at all.
 */
export const DEPLOYMENT_STATUS = {
  contractImplemented: true,
  unitTested: true,
  testFile: 'src/v4/test/EswapSettlementTest.t.sol',
  deployedOnBase: true,
  chainId: 8453,
  settlementAddress: ERC7683_SETTLEMENT_ADDRESS,
  solverWhitelisted: true,
  bridges: {
    across: 'flow is transport-agnostic; only the order id derivation differs',
    socketBungee: 'same',
    uniswapXCrossChain: 'see integrations/solvers/uniswapx — separate settlement contract',
  },
  blockers: [
    'Order id derivation is a placeholder. Across, Socket and Bungee each derive ids differently; a mismatch with the origin chain invalidates replay protection. Must be implemented per bridge.',
    'No settle-refund / capital-return path is implemented: the settlement overwrites solver to address(this) but exposes no funded `depositBorrowEscrow` entrypoint, so margin + borrow must be transferred to the contract with no on-chain accounting of who is owed what. Add a funded escrow or accounting path before production.',
    'hookData recipient recovery is not specified per bridge. H-4 depends on it to credit the position to the user; without it the position cannot be attributed.',
    'EswapLiquidationKeeper IS deployed (0xb7ce4c1b40BBd537091E973B3c3C7DEB35106A7d on Base, verified live) and a watch for hook WETH/USDC 3000/60 + trader 0xd9Aba9723d14b36588bcF9D47c2FF355EEC47F3c is registered (addWatch tx 0x6f6c…481f, block 52764738; watchesLength=1, isWatched=true). checkUpkeep currently returns upkeepNeeded=false because no position is liquidatable; performUpkeep itself remains unproven until one is.',
  ],
} as const