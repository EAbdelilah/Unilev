/**
 * 1inch Fusion taker — fill LimitOrderProtocol orders into leveraged Eswap
 * positions via `IPostInteraction`.
 *
 * Target contract: `EswapOneInchFusionSettlement`
 * (src/v4/EswapOneInchFusionSettlement.sol), which implements
 * `IPostInteraction` against `lib/limit-order-protocol/IOrderMixin.sol`.
 *
 * HOW FUSION DIFFERS FROM COW / UNISWAPX
 *
 *   1inch Fusion is a single-tx protocol. There is no settlement contract the
 *   order routes through, and no Dutch auction. Instead the taker calls
 *   `LimitOrderProtocol.fillOrderArgs(...)` directly, passing a `TakerTraits`
 *   blob that encodes how to call back into the maker-assigned `IPostInteraction`.
 *
 *   The post-interaction is where Eswap slots in: after 1inch settles the maker
 *   leg, it calls `postInteraction(...)` on our contract, and that is where the
 *   leveraged position opens. This is what makes a Fusion order a leveraged
 *   order rather than a plain swap.
 *
 * TAKER TRAITS — the part that is easy to get wrong
 *
 *   `TakerTraits` is a `uint256` bitfield (type alias, not a struct). Two fields
 *   the settlement validates strictly:
 *
 *     EswapOneInchFusionSettlement.sol
 *       if (TakerTraitsLib.argsHasTarget(takerTraits)) revert UnexpectedArgsTarget();
 *       if (TakerTraitsLib.argsExtensionLength(takerTraits) != extension.length)
 *           revert ExtensionLengthMismatch();
 *
 *   So the trait MUST NOT declare a target, and the declared extension length
 *   MUST equal the actual extension byte length. Offsets (from TakerTraitsLib):
 *     _ARGS_HAS_TARGET, _ARGS_EXTENSION_LENGTH_OFFSET / _MASK,
 *     _ARGS_INTERACTION_LENGTH_OFFSET / _MASK
 *
 * CAPITAL
 *
 *   The taker supplies margin + borrow. Repaid at close as
 *   principal + accumulatedYield (EswapMarginHookLogic2.sol:454). Approve both
 *   legs or the open reverts on allowance.
 */

import {
  encodeFunctionData,
  parseAbi,
  type Address,
  type Hex,
} from 'viem'

import { SETTLEMENTS, borrowNotional } from '../shared.js'

// -----------------------------------------------------------------------------
// 1inch types (from lib/limit-order-protocol/IOrderMixin.sol)
// -----------------------------------------------------------------------------

/** `IOrderMixin.Order`. */
export interface OneInchOrder {
  salt: bigint
  maker: Address
  receiver: Address
  makerAsset: Address
  takerAsset: Address
  makingAmount: bigint
  takingAmount: bigint
  makerTraits: bigint
}

/**
 * `TakerTraits` is `type TakerTraits is uint256` — a user-defined value type.
 * This module encodes it manually to avoid importing Solidity, and mirrors
 * `TakerTraitsLib` bit positions.
 *
 * NOTE: the bit offsets below MUST be kept in sync with
 * lib/limit-order-protocol/IOrderMixin.sol. If upstream 1inch changes them this
 * encoding silently produces invalid traits. Re-verify against the vendored
 * library before any live fill.
 */
const ARGS_HAS_TARGET_BIT = 0
const ARGS_EXTENSION_LENGTH_OFFSET = 32n
const ARGS_EXTENSION_LENGTH_MASK = (1n << 32n) - 1n
const ARGS_INTERACTION_LENGTH_OFFSET = 64n
const ARGS_INTERACTION_LENGTH_MASK = (1n << 32n) - 1n

/** Build `TakerTraits` for a post-interaction with no explicit target. */
export function makeTakerTraits(p: {
  extensionLength: number
  interactionLength: number
  /** Always must be false for Eswap: the settlement rejects a target. */
  argsHasTarget?: boolean
  /** e.g. `TakerTraits.TakerTraitsLibrary.ARGS_HAS_TARGET`. Leave 0. */
  argsTargetMask?: number
  /** Reserved higher-order flags. */
  argsAdditional?: number
}): bigint {
  const ext = BigInt(p.extensionLength)
  const inter = BigInt(p.interactionLength)

  if (ext > ARGS_EXTENSION_LENGTH_MASK || inter > ARGS_INTERACTION_LENGTH_MASK) {
    throw new Error('extension/interaction length exceeds the trait field width')
  }

  let v = 0n
  if (p.argsHasTarget) v |= 1n << BigInt(ARGS_HAS_TARGET_BIT)
  // `argsTargetMask` is supplied pre-shifted by the caller as a library flag.
  if (p.argsTargetMask) v |= BigInt(p.argsTargetMask)
  v |= ext << ARGS_EXTENSION_LENGTH_OFFSET
  v |= inter << ARGS_INTERACTION_LENGTH_OFFSET
  // Higher-order flags are OR'd at the top of the word; the caller supplies them
  // already positioned.
  if (p.argsAdditional) v |= BigInt(p.argsAdditional)

  return v
}

/** Mirror of `TakerTraitsLib.argsHasTarget`. */
export function argsHasTarget(traits: bigint): boolean {
  return (traits & (1n << BigInt(ARGS_HAS_TARGET_BIT))) !== 0n
}

/** Mirror of `TakerTraitsLib.argsExtensionLength`. */
export function argsExtensionLength(traits: bigint): bigint {
  return (traits >> ARGS_EXTENSION_LENGTH_OFFSET) & ARGS_EXTENSION_LENGTH_MASK
}

/** Mirror of `TakerTraitsLib.argsInteractionLength`. */
export function argsInteractionLength(traits: bigint): bigint {
  return (traits >> ARGS_INTERACTION_LENGTH_OFFSET) & ARGS_INTERACTION_LENGTH_MASK
}

/** `IOrderMixin` fragment — 1inch's contract, not Eswap's. */
export const LIMIT_ORDER_PROTOCOL_ABI = [
  {
    type: 'function',
    name: 'fillOrderArgs',
    stateMutability: 'payable',
    inputs: [
      {
        name: 'order',
        type: 'tuple',
        internalType: 'struct IOrderMixin.Order',
        components: [
          { name: 'salt', type: 'uint256' },
          { name: 'maker', type: 'address' },
          { name: 'receiver', type: 'address' },
          { name: 'makerAsset', type: 'address' },
          { name: 'takerAsset', type: 'address' },
          { name: 'makingAmount', type: 'uint256' },
          { name: 'takingAmount', type: 'uint256' },
          { name: 'makerTraits', type: 'uint256' },
        ],
      },
      { name: 'r', type: 'bytes32' },
      { name: 'vs', type: 'bytes32' },
      { name: 'amount', type: 'uint256' },
      { name: 'takerTraits', type: 'uint256' },
      { name: 'args', type: 'bytes' },
    ],
    outputs: [
      { name: 'r', type: 'bytes32' },
      { name: 'vs', type: 'bytes32' },
      { name: 'spentMakerAmount', type: 'uint256' },
      { name: 'spentTakerAmount', type: 'uint256' },
    ],
  },
] as const

/** ABI fragment of the Eswap settlement as an `IPostInteraction`. */
export const FUSION_SETTLEMENT_ABI = [
  {
    type: 'function',
    name: 'fill',
    stateMutability: 'nonpayable',
    inputs: [
      {
        name: 'order',
        type: 'tuple',
        internalType: 'struct IOrderMixin.Order',
        components: [
          { name: 'salt', type: 'uint256' },
          { name: 'maker', type: 'address' },
          { name: 'receiver', type: 'address' },
          { name: 'makerAsset', type: 'address' },
          { name: 'takerAsset', type: 'address' },
          { name: 'makingAmount', type: 'uint256' },
          { name: 'takingAmount', type: 'uint256' },
          { name: 'makerTraits', type: 'uint256' },
        ],
      },
      { name: 'r', type: 'bytes32' },
      { name: 'vs', type: 'bytes32' },
      { name: 'amount', type: 'uint256' },
      { name: 'takerTraits', type: 'uint256' },
      { name: 'extension', type: 'bytes' },
      { name: 'interaction', type: 'bytes' },
      { name: 'recipient', type: 'address' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'postInteraction',
    stateMutability: 'nonpayable',
    inputs: [
      {
        name: 'order',
        type: 'tuple',
        internalType: 'struct IOrderMixin.Order',
        components: [
          { name: 'salt', type: 'uint256' },
          { name: 'maker', type: 'address' },
          { name: 'receiver', type: 'address' },
          { name: 'makerAsset', type: 'address' },
          { name: 'takerAsset', type: 'address' },
          { name: 'makingAmount', type: 'uint256' },
          { name: 'takingAmount', type: 'uint256' },
          { name: 'makerTraits', type: 'uint256' },
        ],
      },
      { name: 'extension', type: 'bytes' },
      { name: 'orderHash', type: 'bytes32' },
      { name: 'taker', type: 'address' },
      { name: 'makingAmount', type: 'uint256' },
      { name: 'takingAmount', type: 'uint256' },
      { name: 'remainingMakingAmount', type: 'uint256' },
      { name: 'extraData', type: 'bytes' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'operator',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'maxFillAmount',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'makerAsset',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'takerAsset',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
] as const

// -----------------------------------------------------------------------------
// Order eligibility
// -----------------------------------------------------------------------------

export type FusionRejection =
  | 'not-operator'
  | 'wrong-maker-asset'
  | 'wrong-taker-asset'
  | 'amount-too-large'
  | 'zero-recipient'
  | 'receiver-mismatch'
  | 'unexpected-args-target'
  | 'extension-length-mismatch'
  | 'interaction-length-mismatch'
  | 'unregistered-pool'
  | 'native-margin-unsupported'

export interface FusionPrecheck {
  ok: boolean
  reason?: FusionRejection
  detail?: string
  capitalFronted: bigint
  borrowRequired: bigint
}

/**
 * Reproduce `EswapOneInchFusionSettlement.fill`'s guards off-chain.
 *
 * Read from EswapOneInchFusionSettlement.sol:120-130. These are hard gates, so
 * a wrong `TakerTraits` build burns gas with no fill — check locally first.
 */
export function precheckFusionFill(p: {
  order: OneInchOrder
  amount: bigint
  takerTraits: bigint
  extension: Hex
  interaction: Hex
  recipient: Address
  solver: Address
  leverage: number
  marginAmount: bigint
  makerAsset: Address
  takerAsset: Address
  maxFillAmount: bigint
  registeredSolver?: boolean
}): FusionPrecheck {
  const borrow = borrowNotional(p.marginAmount, p.leverage)
  const capital = p.marginAmount + borrow

  const fail = (reason: FusionRejection, detail: string): FusionPrecheck => ({
    ok: false,
    reason,
    detail,
    capitalFronted: capital,
    borrowRequired: borrow,
  })

  if (p.solver === '0x0000000000000000000000000000000000000000') {
    return fail('not-operator', 'operator must be set before it can fill')
  }
  if (p.order.makerAsset.toLowerCase() !== p.makerAsset.toLowerCase()) {
    return fail('wrong-maker-asset', `order.makerAsset ${p.order.makerAsset} != configured ${p.makerAsset}`)
  }
  if (p.order.takerAsset.toLowerCase() !== p.takerAsset.toLowerCase()) {
    return fail('wrong-taker-asset', `order.takerAsset ${p.order.takerAsset} != configured ${p.takerAsset}`)
  }
  if (p.order.makingAmount > p.maxFillAmount || p.amount > p.maxFillAmount) {
    return fail('amount-too-large', `maxFillAmount is ${p.maxFillAmount}`)
  }
  if (p.recipient === '0x0000000000000000000000000000000000000000') {
    return fail('zero-recipient', 'recipient must be non-zero')
  }
  if (p.order.receiver.toLowerCase() !== p.recipient.toLowerCase()) {
    return fail('receiver-mismatch', `order.receiver ${p.order.receiver} != recipient ${p.recipient} (WrongReceiver)`)
  }
  if (argsHasTarget(p.takerTraits)) {
    return fail('unexpected-args-target', 'takerTraits declares a target; Eswap requires argsHasTarget == false')
  }

  const declaredExt = argsExtensionLength(p.takerTraits)
  const actualExt = BigInt((p.extension.length - 2) / 2)
  if (declaredExt !== actualExt) {
    return fail(
      'extension-length-mismatch',
      `trait declares ${declaredExt} extension bytes, actual is ${actualExt}`,
    )
  }

  const declaredInt = argsInteractionLength(p.takerTraits)
  const actualInt = BigInt((p.interaction.length - 2) / 2)
  if (declaredInt !== actualInt) {
    return fail(
      'interaction-length-mismatch',
      `trait declares ${declaredInt} interaction bytes, actual is ${actualInt}`,
    )
  }

  return { ok: true, capitalFronted: capital, borrowRequired: borrow }
}

// -----------------------------------------------------------------------------
// Calldata
// -------------------------------------------------------------------------

export interface BuildFusionFillParams {
  order: OneInchOrder
  r: Hex
  vs: Hex
  amount: bigint
  takerTraits: bigint
  extension: Hex
  interaction: Hex
  recipient: Address
}

/** Encode `EswapOneInchFusionSettlement.fill(...)` (the operator path). */
export function buildSettlementFillCalldata(p: BuildFusionFillParams): Hex {
  return encodeFunctionData({
    abi: FUSION_SETTLEMENT_ABI,
    functionName: 'fill',
    args: [p.order, p.r, p.vs, p.amount, p.takerTraits, p.extension, p.interaction, p.recipient],
  })
}

/**
 * Encode the 1inch-side call.
 *
 * In a real Fusion fill the taker calls `LimitOrderProtocol.fillOrderArgs` with
 * `args` = encoded `PostInteractionData` pointing at the Eswap settlement. The
 * exact 1inch `PostInteractionData` layout lives in the 1inch contracts and is
 * NOT vendored in this repo, so it is left to the integrator rather than guessed.
 *
 * What IS asserted here is the constraint the settlement enforces: the trait
 * must declare no target, and its extension length must match `args`.
 */
export function buildLimitOrderFillCalldata(p: {
  order: OneInchOrder
  r: Hex
  vs: Hex
  amount: bigint
  takerTraits: bigint
  /** Encoded PostInteractionData. Layout is integrator-supplied. */
  args: Hex
}): Hex {
  return encodeFunctionData({
    abi: LIMIT_ORDER_PROTOCOL_ABI,
    functionName: 'fillOrderArgs',
    args: [p.order, p.r, p.vs, p.amount, p.takerTraits, p.args],
  })
}

/**
 * Taker approvals.
 *
 * The taker fronts margin + borrow; the settlement pulls the borrow via
 * `safeTransferFrom` (EswapRouter.sol:784). Approve both legs to the router,
 * and separately ensure 1inch's LimitOrderProtocol is approved for the taker
 * leg.
 */
export function buildTakerApprovals(p: {
  tokenIn: Address
  marginAmount: bigint
  leverage: number
  limitOrderProtocol: Address
}): { token: Address; spender: Address; amount: bigint }[] {
  const total = p.marginAmount + borrowNotional(p.marginAmount, p.leverage)
  return [
    // Borrow + margin leg to Eswap's router.
    { token: p.tokenIn, spender: SETTLEMENTS.router, amount: total },
    // Maker leg to 1inch.
    { token: p.tokenIn, spender: p.limitOrderProtocol, amount: p.marginAmount },
  ]
}

export const ESCROW_ABI = parseAbi([
  'function depositBorrowEscrow(address token, uint256 amount)',
  'function erc20BorrowEscrow(address solver, address token) view returns (uint256)',
])

export const FUSION_SETTLEMENT_ADDRESS = SETTLEMENTS.oneInchFusion

/**
 * DEPLOYMENT STATUS — honest state.
 *
 * `EswapOneInchFusionSettlement` compiles against the vendored
 * `lib/limit-order-protocol/IOrderMixin.sol` and is unit tested
 * (src/v4/test/EswapVenueSettlementTest.t.sol) but is NOT deployed on Unichain.
 * Additionally, `TakerTraits` bit offsets are duplicated from the Solidity
 * library in this file and must be re-verified against the vendored library
 * before any live fill.
 */
export const DEPLOYMENT_STATUS = {
  contractImplemented: true,
  unitTested: true,
  deployedOnUnichain: false,
  chainId: 130,
  operatorConfigured: false,
  blockers: [
    'Settlement not deployed (address is the zero address).',
    'operator must be set; only operator may call fill.',
    'makerAsset/takerAsset and maxFillAmount must be configured.',
    '1inch LimitOrderProtocol address on Unichain not yet supplied.',
    'TakerTraits bit offsets are duplicated here; re-verify against lib/limit-order-protocol.',
  ],
} as const