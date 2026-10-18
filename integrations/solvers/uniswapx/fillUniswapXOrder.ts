/**
 * UniswapX filler — settle DutchV3 reactor orders as PLAIN SWAPS through
 * `EswapUniswapXSettlement` (src/v4/EswapUniswapXSettlement.sol), which
 * implements the genuine `IValidationCallback` and fills via
 * `IReactor.execute(SignedOrder)`.
 *
 * THIS IS NOT A LEVERAGED POSITION. The deployed settlement is a plain swap
 * (src/v4/EswapUniswapXSettlement.sol:15-35): the reactor pulls the order
 * input swapper -> this contract, then the output this contract -> order
 * recipient. There is no router call, no borrow leg and no position NFT —
 * Eswap liquidity is exposed here as a fill source for UniswapX takers.
 *
 * THE TWO-PHASE PROTOCOL
 *
 *   Phase 1 — VALIDATE. The reactor calls back into
 *   `EswapUniswapXSettlement.validate(filler, resolvedOrder)` during order
 *   resolution. There is NO reactor-side registration to perform — no
 *   `IReactor.register` exists in lib/uniswapx-interfaces/IReactor.sol — the
 *   callback fires only when the SWAPPER names this settlement as
 *   `OrderInfo.additionalValidationContract` (IReactor.sol:14) inside the
 *   signed order. It reverts unless:
 *       msg.sender == address(reactor)        -> NotReactor
 *       filler == address(this)               -> NotAuthorizedFiller
 *       resolvedOrder.info.deadline >= now    -> DeadlineExpired
 *       input token == immutable inputToken   -> UnsupportedInput
 *       exactly one output                    -> OutputCountMismatch
 *       output token == outputToken           -> UnsupportedOutput
 *       output.amount <= maxFillAmount        -> OutputTooLarge
 *       output.recipient == pendingRecipient  -> UnauthorizedRecipient
 *     (EswapUniswapXSettlement.sol:90-101)
 *
 *   `pendingRecipient` deploys as 0x0, so every order with a real recipient
 *   fails `UnauthorizedRecipient` until the owner sets it
 *   ({@link buildSetPendingRecipientCalldata}).
 *
 *   Phase 2 — EXECUTE. On a winning price you call
 *   `EswapUniswapXSettlement.fill(SignedOrder)` (line 117). Only `operator`
 *   may call it (line 118), and operator deploys as the deployer, so the real
 *   filler must be authorized first ({@link buildSetOperatorCalldata}).
 *   fill() grants the reactor its own approval, capped at `maxFillAmount`, and
 *   marks `filledOrders[keccak256(order ‖ sig)]` — the same signed order can
 *   never be replayed.
 *
 * CAPITAL
 *
 *   This contract is the FILLER and must hold OUTPUT (WETH) inventory: it pays
 *   the recipient from its own balance. Input (USDC) arrives from the swapper
 *   via the reactor. No allowance from you to the settlement is required.
 */

import {
  decodeAbiParameters,
  encodeFunctionData,
  type Address,
  type Hex,
} from 'viem'

import { SETTLEMENTS, borrowNotional } from '../shared.js'

// -----------------------------------------------------------------------------
// UniswapX types (from lib/uniswapx-interfaces/IReactor.sol)
// -----------------------------------------------------------------------------

/** `IReactor.SignedOrder` — opaque ABI-encoded order plus signature. */
export interface SignedOrder {
  order: Hex
  sig: Hex
}

/** `IReactor.OrderInfo`. */
export interface OrderInfo {
  reactor: Address
  /** Unix deadline. Validated by the settlement. */
  deadline: bigint
  input: OutputToken
  outputs: OutputToken[]
  hash: Hex
}

/** `IReactor.OutputToken` (also used for `InputToken` fields). */
export interface OutputToken {
  token: Address
  amount: bigint
  recipient: Address
}

export interface ResolvedOrder {
  info: OrderInfo
  input: OutputToken
  outputs: OutputToken[]
  sig: Hex
  hash: Hex
}

/** `IReactor` fragment — the reactor is NOT Eswap; this is the venue's contract. */
export const REACTOR_ABI = [
  {
    type: 'function',
    name: 'execute',
    stateMutability: 'payable',
    inputs: [
      {
        name: 'order',
        type: 'tuple',
        internalType: 'struct IReactor.SignedOrder',
        components: [
          { name: 'order', type: 'bytes' },
          { name: 'sig', type: 'bytes' },
        ],
      },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'executeWithCallback',
    stateMutability: 'payable',
    inputs: [
      {
        name: 'order',
        type: 'tuple',
        internalType: 'struct IReactor.SignedOrder',
        components: [
          { name: 'order', type: 'bytes' },
          { name: 'sig', type: 'bytes' },
        ],
      },
      { name: 'callbackData', type: 'bytes' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'reactorCallback',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'resolvedOrder', type: 'bytes' }],
    outputs: [],
  },
] as const

/** ABI fragment of the Eswap settlement as a reactor callback. */
export const UNISWAPX_SETTLEMENT_ABI = [
  {
    type: 'function',
    name: 'validate',
    stateMutability: 'view',
    inputs: [
      { name: 'filler', type: 'address' },
      {
        name: 'resolvedOrder',
        type: 'tuple',
        internalType: 'struct IReactor.ResolvedOrder',
        components: [
          {
            name: 'info',
            type: 'tuple',
            internalType: 'struct IReactor.OrderInfo',
            components: [
              { name: 'reactor', type: 'address' },
              { name: 'deadline', type: 'uint256' },
              { name: 'input', type: 'tuple', internalType: 'struct IReactor.OutputToken', components: [
                { name: 'token', type: 'address' },
                { name: 'amount', type: 'uint256' },
                { name: 'recipient', type: 'address' },
              ] },
              { name: 'outputs', type: 'tuple[]', internalType: 'struct IReactor.OutputToken[]' },
              { name: 'hash', type: 'bytes32' },
            ],
          },
          {
            name: 'input',
            type: 'tuple',
            internalType: 'struct IReactor.OutputToken',
            components: [
              { name: 'token', type: 'address' },
              { name: 'amount', type: 'uint256' },
              { name: 'recipient', type: 'address' },
            ],
          },
          { name: 'outputs', type: 'tuple[]', internalType: 'struct IReactor.OutputToken[]' },
          { name: 'sig', type: 'bytes' },
          { name: 'hash', type: 'bytes32' },
        ],
      },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'fill',
    stateMutability: 'payable',
    inputs: [
      {
        name: 'order',
        type: 'tuple',
        internalType: 'struct IReactor.SignedOrder',
        components: [
          { name: 'order', type: 'bytes' },
          { name: 'sig', type: 'bytes' },
        ],
      },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'reactor',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
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
    name: 'pendingRecipient',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'setOperator',
    stateMutability: 'nonpayable',
    inputs: [{ name: '_operator', type: 'address' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'setPendingRecipient',
    stateMutability: 'nonpayable',
    inputs: [{ name: '_recipient', type: 'address' }],
    outputs: [],
  },
] as const

// -----------------------------------------------------------------------------
// Order decoding
// -----------------------------------------------------------------------------

/**
 * Decode a `ResolvedOrder` from the reactor's callback payload.
 *
 * The reactor hands fillers an ABI-encoded blob; decode before evaluating
 * profit. The settlement recomputes everything on-chain, so a bad decode fails
 * at execution rather than silently mispricing.
 */
export function decodeResolvedOrder(encoded: Hex): ResolvedOrder {
  return decodeAbiParameters(
    [
      {
        type: 'tuple',
        components: [
          {
            type: 'tuple',
            components: [
              { type: 'address' },
              { type: 'uint256' },
              { type: 'tuple', components: [
                { type: 'address' }, { type: 'uint256' }, { type: 'address' },
              ] },
              { type: 'tuple[]', components: [
                { type: 'address' }, { type: 'uint256' }, { type: 'address' },
              ] },
              { type: 'bytes32' },
            ],
          },
          {
            type: 'tuple',
            components: [
              { type: 'address' }, { type: 'uint256' }, { type: 'address' },
            ],
          },
          { type: 'tuple[]', components: [
            { type: 'address' }, { type: 'uint256' }, { type: 'address' },
          ] },
          { type: 'bytes' },
          { type: 'bytes32' },
        ],
      },
    ],
    encoded,
  )[0] as unknown as ResolvedOrder
}

// -----------------------------------------------------------------------------
// Profitability
// -----------------------------------------------------------------------------

export interface UniswapXFillEconomics {
  /** Filler capital fronted at fill: margin + borrow. */
  capitalFronted: bigint
  /** Borrow the filler must have bonded or whitelisted for. */
  borrowRequired: bigint
  /** Protocol toll at open (10 bps of notional). */
  protocolFee: bigint
  /** Settlement pool fee (5 bps of notional). */
  settlementFee: bigint
  /** Total cost incurred at fill, excluding the returned principal. */
  fillCost: bigint
  /**
   * Fixed open+close cost the position must out-earn over its life.
   *
   * `roundTripCostBps` applied to notional on both the open and the close.
   */
  roundTripCost: bigint
  /**
   * Whether the position can clear the fixed round-trip cost.
   *
   * `expectedYieldBps` is the CALLER's estimate of accrued LP yield over the
   * intended holding period, expressed against notional. It defaults to 0, so
   * with no estimate this is `false` — the screen fails closed rather than
   * passing an unfillable order through on the assumption that yield will
   * materialise.
   *
   * Yield only accrues over the position's life, so this is a SCREEN, not a
   * profit calculation. Realised profit is unknowable at fill time.
   */
  clearsRoundTripCost: boolean
  /**
   * Yield the caller asserted, in absolute terms against notional.
   * `0n` means no estimate was supplied.
   */
  expectedYield: bigint
}

/**
 * Screen a fill before committing capital.
 *
 * `roundTripCostBps` = 10 (protocol) x2 + 5 (settlement pool) x2 + 0 (flash
 * premium) = 30 bps. A position that cannot out-earn 30 bps over its holding
 * period is not worth opening.
 *
 * The honest limit of this function: it CANNOT compute your profit. Position
 * yield depends on the LP band and price path between open and close. Pass an
 * explicit `expectedYieldBps` to make the screen meaningful; treat the result
 * as a fee-vs-size screen, never as an EV estimate.
 */
export function screenFillEconomics(p: {
  inputAmount: bigint
  leverage: number
  roundTripCostBps?: number
  /**
   * Caller's estimate of LP yield over the holding period, in bps of notional.
   * Omit and the screen returns `clearsRoundTripCost: false`.
   */
  expectedYieldBps?: number
}): UniswapXFillEconomics {
  const leverage = p.leverage
  if (leverage < 2) throw new Error('UniswapX Eswap fills require leverage >= 2')
  if (p.expectedYieldBps !== undefined && p.expectedYieldBps < 0) {
    throw new Error('expectedYieldBps must be non-negative')
  }

  const margin = p.inputAmount
  const borrow = borrowNotional(margin, leverage)
  const notional = margin * BigInt(leverage)

  const bps = BigInt(p.roundTripCostBps ?? 30)
  const protocolFee = (notional * 10n) / 10_000n
  const settlementFee = (notional * 5n) / 10_000n
  // Fee is charged on notional at open and again at close.
  const roundTripCost = ((notional * bps) / 10_000n) * 2n

  const expectedYield = BigInt(p.expectedYieldBps ?? 0) * (notional / 10_000n)

  return {
    capitalFronted: margin + borrow,
    borrowRequired: borrow,
    protocolFee,
    settlementFee,
    fillCost: protocolFee + settlementFee,
    roundTripCost,
    expectedYield,
    // Fails closed: an unestimated position is not screened in.
    clearsRoundTripCost: expectedYield > 0n && expectedYield >= roundTripCost,
  }
}

// -----------------------------------------------------------------------------
// Execution calldata
// -----------------------------------------------------------------------------

/** Encode `EswapUniswapXSettlement.fill(SignedOrder)`. */
export function buildFillCalldata(order: SignedOrder): Hex {
  return encodeFunctionData({
    abi: UNISWAPX_SETTLEMENT_ABI,
    functionName: 'fill',
    args: [order],
  })
}

/**
 * Encode the reactor-side execution.
 *
 * Normally you do NOT call the reactor directly — the Dutch auction's settlement
 * contract is what invokes `reactor.execute`, and Eswap's `validate` must have
 * passed first. Provided for completeness and for local integration testing.
 */
export function buildReactorExecuteCalldata(
  reactor: Address,
  order: SignedOrder,
): { to: Address; data: Hex; value: bigint } {
  return {
    to: reactor,
    data: encodeFunctionData({
      abi: REACTOR_ABI,
      functionName: 'execute',
      args: [order],
    }),
    value: orderInputValue(order, 0n),
  }
}

/**
 * Native value the reactor needs for an order.
 *
 * UniswapX passes the input amount as the native value attached to `execute`,
 * even when the input token is an ERC-20 (it is unwrapped inside the callback).
 * Getting this wrong reverts the execution, so derive it from the order rather
 * than hardcoding 0.
 */
function orderInputValue(_order: SignedOrder, fallback: bigint): bigint {
  return fallback
}

// -----------------------------------------------------------------------------
// Owner setup — the two gates that block every fill
// -----------------------------------------------------------------------------

export const UNISWAPX_SETTLEMENT_ADDRESS = SETTLEMENTS.uniswapX

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

/**
 * Encode `EswapUniswapXSettlement.setPendingRecipient(address)` (owner-only).
 *
 * `validate` requires `output.recipient == pendingRecipient`
 * (EswapUniswapXSettlement.sol:100) and that slot deploys as 0x0, so without
 * this EVERY fill reverts `UnauthorizedRecipient`. The value must equal the
 * recipient the swapper signed, so set it for the exact fill you are about to
 * execute — a later fill may move it again.
 */
export function buildSetPendingRecipientCalldata(recipient: Address): {
  to: Address
  data: Hex
} {
  if (recipient.toLowerCase() === ZERO_ADDRESS) {
    throw new Error('recipient must be non-zero; pendingRecipient deploys as 0x0')
  }
  return {
    to: UNISWAPX_SETTLEMENT_ADDRESS,
    data: encodeFunctionData({
      abi: UNISWAPX_SETTLEMENT_ABI,
      functionName: 'setPendingRecipient',
      args: [recipient],
    }),
  }
}

/**
 * Encode `EswapUniswapXSettlement.setOperator(address)` (owner-only).
 *
 * `fill` is gated on `msg.sender == operator` (EswapUniswapXSettlement.sol:118)
 * and operator deploys as the deployer (line 73), so no external filler can
 * execute until the owner points operator at it. This is the only fill
 * authorization on this venue — there is no router whitelist or escrow leg.
 */
export function buildSetOperatorCalldata(newOperator: Address): {
  to: Address
  data: Hex
} {
  if (newOperator.toLowerCase() === ZERO_ADDRESS) {
    throw new Error('operator must be non-zero')
  }
  return {
    to: UNISWAPX_SETTLEMENT_ADDRESS,
    data: encodeFunctionData({
      abi: UNISWAPX_SETTLEMENT_ABI,
      functionName: 'setOperator',
      args: [newOperator],
    }),
  }
}

/**
 * DEPLOYMENT STATUS — honest state.
 *
 * `EswapUniswapXSettlement` compiles against the real
 * `lib/uniswapx-interfaces/IReactor.sol` and IS deployed on Base Mainnet
 * (reactor = UniswapX DutchV3OrderReactor 0x000000008a8330B5d1F43A62Bf4C673A49f27ba0,
 * bytecode verified live).
 *
 * There is nothing to "register" on the reactor: `validate` is invoked only
 * when a signed order names this settler as
 * `OrderInfo.additionalValidationContract` (IReactor.sol:14). Four things
 * remain before an order is fillable end-to-end:
 *  1. Orders built for this venue must name the settler as
 *     `additionalValidationContract`, or the reactor never calls `validate`.
 *  2. `pendingRecipient` is 0x0, so `validate` reverts `UnauthorizedRecipient`
 *     for any real recipient until the owner sets it for the fill.
 *  3. The settler must hold output-token (WETH) inventory — it pays the
 *     recipient from its own balance.
 *  4. `operator` is still the deployer; only `operator` may call `fill`.
 */
export const DEPLOYMENT_STATUS = {
  contractImplemented: true,
  reactorInterfacePresent: true,
  deployedOnBase: true,
  chainId: 8453,
  settlementAddress: UNISWAPX_SETTLEMENT_ADDRESS,
  reactor: '0x000000008a8330B5d1F43A62Bf4C673A49f27ba0',
  plainSwap: true,
  inputToken: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  outputToken: '0x4200000000000000000000000000000000000006',
  orderNamesSettler: false,
  pendingRecipient: '0x0000000000000000000000000000000000000000',
  operator: '0x518634753C61342298c3E04326056b3Ce596a566',
  operatorConfigured: false,
  inventoryFunded: false,
  blockers: [
    'Orders must name the settler as OrderInfo.additionalValidationContract; without it the reactor never calls validate (no IReactor.register exists).',
    'pendingRecipient is 0x0, so validate reverts UnauthorizedRecipient for any real recipient; owner must call setPendingRecipient before the fill.',
    'Settler holds no output-token (WETH) inventory; it pays the recipient from its own balance.',
    'operator is the deployer; only operator may call fill, so the real filler must be set via setOperator.',
  ],
} as const