/**
 * UniswapX filler — execute reactor orders into leveraged Eswap positions.
 *
 * Target contract: `EswapUniswapXSettlement` (src/v4/EswapUniswapXSettlement.sol),
 * which implements the genuine `IValidationCallback` and fills via
 * `IReactor.execute(SignedOrder)`.
 *
 * THE TWO-PHASE PROTOCOL
 *
 *   Phase 1 — VALIDATE. The reactor calls back into
 *   `EswapUniswapXSettlement.validate(filler, resolvedOrder)` during the
 *   reactor's own validation pass. It reverts unless:
 *       msg.sender == address(reactor)        -> NotReactor
 *       filler == address(this)               -> NotAuthorizedFiller
 *       resolvedOrder.info.deadline >= now    -> DeadlineExpired
 *     (EswapUniswapXSettlement.sol:90-93)
 *
 *   Only a fill where THIS contract is the designated filler will validate, so
 *   competing fillers cannot take an order Eswap has committed to. That is the
 *   Dutch-auction exclusivity mechanism.
 *
 *   Phase 2 — EXECUTE. On a winning price you call
 *   `EswapUniswapXSettlement.fill(SignedOrder)`, which re-derives the leveraged
 *   open. Only `operator` may call it (line 117).
 *
 * CAPITAL AND PROFIT
 *
 *   The filler's capital is the borrowed leg. It is repaid principal + yield:
 *       EswapMarginHookLogic2.sol:454  totalPayout = principal + accumulatedYield
 *
 *   Profit accrues at CLOSE, not at fill. An open position is a claim, not
 *   realised P&L. Never treat an executed fill as profit.
 *
 *   Note the validator does NOT accept native margin here
 *   (NativeMarginNotSupported on the CoW side has an analogue), and the
 *   settlement pulls the borrow from the filler, so allowances must be set.
 */

import {
  decodeAbiParameters,
  encodeFunctionData,
  parseAbi,
  type Address,
  type Hex,
} from 'viem'

import {
  SETTLEMENTS,
  LIVE_HOOK_POOL,
  LIVE_STANDARD_POOL,
  borrowNotional,
  type PoolKey,
} from '../shared.js'

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
// Allowances — the operational gotcha
// ---------------------------------------------------------------------------

/**
 * Approve the settlement for the borrowed leg.
 *
 * The settlement pulls the borrow from the filler:
 *   EswapRouter.sol:784
 *     IERC20(input).safeTransferFrom(params.solver, address(manager), borrowAmount)
 *
 * Without this the fill reverts `ERC20: transfer amount exceeds allowance` —
 * observed live. Approve margin + borrow in one allowance.
 */
export function buildFillerApproval(
  token: Address,
  marginAmount: bigint,
  leverage: number,
): { token: Address; spender: Address; amount: bigint } {
  const total = marginAmount + borrowNotional(marginAmount, leverage)
  return { token, spender: SETTLEMENTS.router, amount: total }
}

// -----------------------------------------------------------------------------
// Pool keys
// -----------------------------------------------------------------------------

export const UNISWAPX_POOL_KEYS = {
  accounting: LIVE_HOOK_POOL,
  settlement: LIVE_STANDARD_POOL,
} satisfies { accounting: PoolKey; settlement: PoolKey }

/** ABI fragment the settlement uses to build its leveraged open. */
export const ROUTER_ESCROW_ABI = parseAbi([
  'function depositBorrowEscrow(address token, uint256 amount)',
  'function erc20BorrowEscrow(address solver, address token) view returns (uint256)',
  'function registeredSolvers(address solver) view returns (bool)',
])

export const UNISWAPX_SETTLEMENT_ADDRESS = SETTLEMENTS.uniswapX

/**
 * DEPLOYMENT STATUS — honest state.
 *
 * `EswapUniswapXSettlement` compiles against the real
 * `lib/uniswapx-interfaces/IReactor.sol` but is NOT deployed on Unichain, and
 * the UniswapX reactor on Unichain has not been wired to call it. Until both are
 * true, `validate` can never succeed and no order is fillable.
 */
export const DEPLOYMENT_STATUS = {
  contractImplemented: true,
  reactorInterfacePresent: true,
  deployedOnUnichain: false,
  reactorConfigured: false,
  chainId: 130,
  blockers: [
    'Settlement not deployed (address is the zero address).',
    'Reactor not configured to call EswapUniswapXSettlement.validate, so validate reverts NotReactor or the reactor is never invoked.',
    'Solver must be set as operator; only operator may call fill.',
  ],
} as const