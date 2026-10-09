/**
 * CoW Protocol solver — fill GPv2 orders into leveraged Eswap positions.
 *
 * Target contract: `EswapCoWSettlement` (src/v4/EswapCoWSettlement.sol, unit
 * tested at src/v4/test/EswapCoWSettlementTest.t.sol). Not yet deployed on
 * Unichain — see DEPLOYMENT_STATUS.
 *
 * WHAT A COW SOLVER DOES HERE
 *
 *   CoW gives you a signed GPv2 order for a plain swap. Eswap's settlement turns
 *   it into a LEVERAGED position, so the order's appData must carry the
 *   trader's leverage commitment:
 *
 *     EswapCoWSettlement.sol:87
 *       bytes32 APP_DATA_LEVERAGE_TAG = keccak256("eswap-cow-leverage-v1");
 *     EswapCoWSettlement.sol:96
 *       function leverageCommitment(uint8 lev) => keccak256(abi.encodePacked(TAG, lev));
 *
 *   The solver picks `params.leverage`, and the settlement refuses the fill if
 *   it disagrees with the trader's commitment. That is the underwriting control:
 *   the trader signs the exact leverage, the solver cannot silently change it.
 *
 * CAPITAL
 *
 *   The solver funds BOTH the margin and the borrowed leg for every fill:
 *     EswapMarginHookLogic2.sol:454  totalPayout = principal + accumulatedYield
 *
 *   A non-whitelisted solver posts `erc20BorrowEscrow >= borrowedAmount` first,
 *   which is what makes the orderbook route permissionless.
 *
 *   The bond is returned on close; the yield is the solver's compensation.
 *
 * ACCURACY NOTE — the settlement does not trust the solver's own quote. It
 * re-derives the fill against the router. Do not skip the on-chain quote.
 */

import {
concatHex,
encodeFunctionData,
keccak256,
  parseAbi,
  toHex,
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
// Order shapes (from src/v4/cow/CowOrder.sol)
// -----------------------------------------------------------------------------

/** `CowOrder.Data` — the canonical GPv2 order struct. */
export interface CowOrder {
  sellToken: Address
  buyToken: Address
  receiver: Address
  sellAmount: bigint
  buyAmount: bigint
  validTo: number
  appData: Hex
  feeAmount: bigint
  kind: Hex
  partiallyFillable: boolean
  sellTokenBalance: Hex
  buyTokenBalance: Hex
}

/** Signature schemes accepted by `CowSigning.recoverOrderSigner`. */
export enum Scheme {
  Eip712 = 'eip712',
  EthSign = 'ethsign',
  Eip1271 = 'eip1271',
  PreSign = 'presign',
}

/**
 * `EswapCoWSettlement.FillParams`.
 *
 * Read from EswapCoWSettlement.sol:46-67. The solver address here is the
 * position's `positionSolver`, which is what routes rehypothecation yield to
 * the solver — set it to the address that actually holds the capital.
 */
export interface FillParams {
  /** Must equal the order's appData commitment. */
  leverage: number
  /** Solver funding the margin AND the borrow leg. */
  solver: Address
  /** Hook-enabled pool where the position is registered. */
  key: PoolKey
  /** Deep standard pool where the physical fill executes. */
  standardPoolKey: PoolKey
}

/** ABI fragment for the settlement. */
export const COW_SETTLEMENT_ABI = [
  {
    type: 'function',
    name: 'fillOrder',
    stateMutability: 'nonpayable',
    inputs: [
      {
        name: 'order',
        type: 'tuple',
        internalType: 'struct CowOrder.Data',
        components: [
          { name: 'sellToken', type: 'address' },
          { name: 'buyToken', type: 'address' },
          { name: 'receiver', type: 'address' },
          { name: 'sellAmount', type: 'uint256' },
          { name: 'buyAmount', type: 'uint256' },
          { name: 'validTo', type: 'uint32' },
          { name: 'appData', type: 'bytes32' },
          { name: 'feeAmount', type: 'uint256' },
          { name: 'kind', type: 'bytes32' },
          { name: 'partiallyFillable', type: 'bool' },
          { name: 'sellTokenBalance', type: 'bytes32' },
          { name: 'buyTokenBalance', type: 'bytes32' },
        ],
      },
      { name: 'scheme', type: 'uint8' },
      { name: 'signature', type: 'bytes' },
      {
        name: 'params',
        type: 'tuple',
        internalType: 'struct EswapCoWSettlement.FillParams',
        components: [
          { name: 'leverage', type: 'uint8' },
          { name: 'solver', type: 'address' },
          {
            name: 'key',
            type: 'tuple',
            internalType: 'PoolKey',
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
            internalType: 'PoolKey',
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
    ],
    outputs: [{ name: 'owner', type: 'address' }],
  },
  {
    type: 'function',
    name: 'fillOrders',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'orders', type: 'tuple[]', internalType: 'struct CowOrder.Data[]' },
      { name: 'schemes', type: 'uint8[]' },
      { name: 'signatures', type: 'bytes[]' },
      { name: 'params', type: 'tuple[]', internalType: 'struct EswapCoWSettlement.FillParams[]' },
    ],
    outputs: [
      { name: 'count', type: 'uint256' },
      { name: 'failed', type: 'uint256' },
    ],
  },
  {
    type: 'function',
    name: 'hashOrder',
    stateMutability: 'view',
    inputs: [
      {
        name: 'order',
        type: 'tuple',
        internalType: 'struct CowOrder.Data',
        components: [
          { name: 'sellToken', type: 'address' },
          { name: 'buyToken', type: 'address' },
          { name: 'receiver', type: 'address' },
          { name: 'sellAmount', type: 'uint256' },
          { name: 'buyAmount', type: 'uint256' },
          { name: 'validTo', type: 'uint32' },
          { name: 'appData', type: 'bytes32' },
          { name: 'feeAmount', type: 'uint256' },
          { name: 'kind', type: 'bytes32' },
          { name: 'partiallyFillable', type: 'bool' },
          { name: 'sellTokenBalance', type: 'bytes32' },
          { name: 'buyTokenBalance', type: 'bytes32' },
        ],
      },
    ],
    outputs: [{ name: '', type: 'bytes32' }],
  },
  {
    type: 'function',
    name: 'leverageCommitment',
    stateMutability: 'pure',
    inputs: [{ name: 'leverage', type: 'uint8' }],
    outputs: [{ name: '', type: 'bytes32' }],
  },
] as const

// -----------------------------------------------------------------------------
// Commitment helpers
// -----------------------------------------------------------------------------

/** `keccak256("eswap-cow-leverage-v1")` — must match the contract exactly. */
/**
 * `keccak256` of a UTF-8 string, matching Solidity's `keccak256("literal")`.
 *
 * viem's `keccak256` accepts only Hex/ByteArray, so string literals must be
 * hex-encoded first. Getting this wrong is silent — you get a valid-looking hash
 * of the wrong bytes.
 */
function keccakUtf8(s: string): Hex {
  return keccak256(toHex(s))
}

export const APP_DATA_LEVERAGE_TAG: Hex = keccakUtf8('eswap-cow-leverage-v1')

/**
 * Reproduce `EswapCoWSettlement.leverageCommitment(leverage)` off-chain.
 *
 * The order's appData MUST equal this or the fill reverts
 * `LeverageCommitmentMismatch` (EswapCoWSettlement.sol:83).
 */
export function leverageCommitment(leverage: number): Hex {
  if (!Number.isInteger(leverage) || leverage < 0 || leverage > 255) {
    throw new Error(`leverage must be a uint8, got ${leverage}`)
  }
// Packed exactly as the settlement's `leverageCommitment` does it:
//   keccak256(abi.encodePacked(TAG, uint8(leverage)))
//
// `abi.encodePacked` of a bytes32 and a uint8 is 33 bytes (32 + 1, no padding).
// DO NOT use `encodeAbiParameters` here: it pads every static parameter out to a
// full 32-byte word, giving a 64-byte preimage and a completely different hash.
// That mistake is silent — you get a valid-looking commitment that the
// settlement rejects with `LeverageCommitmentMismatch` on every fill.
  return keccak256(concatHex([APP_DATA_LEVERAGE_TAG, toHex(Uint8Array.of(leverage))]))
}

/** `keccak256("sell")` — the GPv2 sell-order kind marker. */
export const KIND_SELL: Hex = keccakUtf8('sell')

// -----------------------------------------------------------------------------
// Order construction
// -----------------------------------------------------------------------------

export interface BuildCowOrderParams {
  sellToken: Address
  buyToken: Address
  /** The position owner. MUST equal `receiver` or the fill reverts. */
  receiver: Address
  /** Margin in sellToken units. NOT notional. */
  sellAmount: bigint
  /** Leverage the trader authorises. Drives the appData commitment. */
  leverage: number
  /** Unix deadline. */
  validTo: number
  /** CoW protocol fee in sellToken units. */
  feeAmount?: bigint
}

/**
 * Build a GPv2 order whose appData authorises a leveraged Eswap fill.
 *
 * The order's `sellAmount` is the MARGIN. The borrowed leg is the solver's, so
 * the order does not price it — do not inflate sellAmount to cover the borrow.
 */
export function buildCowOrder(p: BuildCowOrderParams): CowOrder {
  const feeAmount = p.feeAmount ?? 0n

  return {
    sellToken: p.sellToken,
    buyToken: p.buyToken,
    receiver: p.receiver,
    sellAmount: p.sellAmount,
    buyAmount: 0n,
    validTo: p.validTo,
    appData: leverageCommitment(p.leverage),
    feeAmount,
    kind: KIND_SELL,
    partiallyFillable: false,
    sellTokenBalance: keccakUtf8('erc20'),
    buyTokenBalance: keccakUtf8('erc20'),
  }
}

// -----------------------------------------------------------------------------
// Fill params
// -----------------------------------------------------------------------------

/** CoW scheme -> the settlement's uint8 `Scheme` enum value. */
const SCHEME_TO_UINT8: Record<Scheme, number> = {
  [Scheme.Eip712]: 0,
  [Scheme.EthSign]: 1,
  [Scheme.Eip1271]: 2,
  [Scheme.PreSign]: 3,
}

/**
 * Build `FillParams`.
 *
 * `solver` must be the address whose capital funds the position: it becomes the
 * position's `positionSolver` and receives the yield. Setting it to a third
 * party pays that third party instead of you.
 */
export function buildFillParams(p: {
  leverage: number
  solver: Address
  key?: PoolKey
  standardPoolKey?: PoolKey
}): FillParams {
  return {
    leverage: p.leverage,
    solver: p.solver,
    key: p.key ?? LIVE_HOOK_POOL,
    standardPoolKey: p.standardPoolKey ?? LIVE_STANDARD_POOL,
  }
}

// -----------------------------------------------------------------------------
// Calldata encoding
// -----------------------------------------------------------------------------

export interface BuildFillCalldataParams {
  order: CowOrder
  signature: Hex
  scheme: Scheme
  params: FillParams
}

/** Encode a single `fillOrder` call. */
export function buildFillOrderCalldata(p: BuildFillCalldataParams): Hex {
  return encodeFunctionData({
    abi: COW_SETTLEMENT_ABI,
    functionName: 'fillOrder',
    args: [p.order, SCHEME_TO_UINT8[p.scheme], p.signature, p.params],
  })
}

/**
 * Encode a batched `fillOrders`.
 *
 * Each order is filled independently and a failure does NOT revert the batch
 * (EswapCoWSettlement.sol:129-152). Counters are returned and `Failure` emitted.
 * That makes this safe for competitive quoting: one bad order cannot grief the
 * rest. Do not treat a non-zero `failed` as a tx failure.
 */
export function buildBatchFillCalldata(p: {
  orders: CowOrder[]
  signatures: Hex[]
  schemes: Scheme[]
  params: FillParams[]
}): Hex {
  if (
    p.orders.length !== p.signatures.length ||
    p.orders.length !== p.schemes.length ||
    p.orders.length !== p.params.length
  ) {
    throw new Error('batch arrays must be the same length')
  }
  return encodeFunctionData({
    abi: COW_SETTLEMENT_ABI,
    functionName: 'fillOrders',
    args: [
      p.orders,
      p.schemes.map((s) => SCHEME_TO_UINT8[s]),
      p.signatures,
      p.params,
    ],
  })
}

// -----------------------------------------------------------------------------
// Pre-flight validation (mirrors the contract's own rejections)
// -----------------------------------------------------------------------------

export type RejectionReason =
  | 'order-expired'
  | 'invalid-order-kind'
  | 'partially-fillable-unsupported'
  | 'fee-not-supported'
  | 'receiver-mismatch'
  | 'receiver-unverified'
  | 'leverage-commitment-mismatch'
  | 'zero-solver'
  | 'native-margin-unsupported'
  | 'unregistered-pool'
  | 'insufficient-escrow'

export interface PrecheckResult {
  ok: boolean
  reason?: RejectionReason
  detail?: string
  /** Margin this fill consumes. */
  marginAmount: bigint
  /** Borrow the solver must have available. */
  borrowRequired: bigint
  /** Total capital the solver fronts for this fill. */
  capitalFronted: bigint
}

/**
 * Reproduce the settlement's rejections before broadcasting.
 *
 * Mirrors `_validateOrder` and `_fillOrder`. Catching these locally saves gas
 * and — more importantly — a batch fill's failures are silent on-chain except
 * for the counter, so a local precheck is the only cheap way to avoid a wasted
 * bundle.
 */
export function precheckFill(p: {
  order: CowOrder
  params: FillParams
  solver: Address
  now: number
  /** Solvers cover all fills from balance, so this can be 0 if whitelisted. */
  availableEscrow: bigint
  registeredSolver?: boolean
  /**
   * Owner recovered from `order.signature`, if you have already recovered it.
   *
   * The settlement compares `receiver` against the RECOVERED OWNER
   * (`EswapCoWSettlement.sol:70-78`), NOT against the solver. Without recovery
   * the check cannot be evaluated, so pass this when you have it. When omitted,
   * a non-zero `receiver` is reported as unverified rather than mismatched —
   * guessing here would reject valid fills.
   */
  recoveredOwner?: Address
}): PrecheckResult {
  const margin = p.order.sellAmount
  const borrow = borrowNotional(margin, p.params.leverage)
  const capital = margin + borrow

  const fail = (reason: RejectionReason, detail: string): PrecheckResult => ({
    ok: false,
    reason,
    detail,
    marginAmount: margin,
    borrowRequired: borrow,
    capitalFronted: capital,
  })

  if (p.order.validTo < p.now) {
    return fail('order-expired', `validTo ${p.order.validTo} < now ${p.now}`)
  }
  if (p.order.kind.toLowerCase() !== KIND_SELL.toLowerCase()) {
    return fail('invalid-order-kind', 'only sell orders are supported')
  }
  if (p.order.partiallyFillable) {
    return fail('partially-fillable-unsupported', 'settlement fills full orders only')
  }
  if (p.order.feeAmount > 0n) {
    return fail(
      'fee-not-supported',
      `feeAmount ${p.order.feeAmount} is charged in sellToken; Eswap's toll is the 10 bps protocol fee`,
    )
  }
  const receiver = p.order.receiver
  const zeroAddress = '0x0000000000000000000000000000000000000000'
  if (receiver !== zeroAddress) {
    // The settlement recovers the signer and requires receiver == owner
    // (EswapCoWSettlement.sol:70-78). The solver is NOT the owner, so the only
    // valid comparison is against the recovered signer.
    if (!p.recoveredOwner) {
      return fail(
        'receiver-unverified',
        `order.receiver is ${receiver}; recover the signer and confirm it equals receiver before filling`,
      )
    }
    if (receiver.toLowerCase() !== p.recoveredOwner.toLowerCase()) {
      return fail(
        'receiver-mismatch',
        `receiver ${receiver} != recovered order owner ${p.recoveredOwner}`,
      )
    }
  }
  if (p.order.appData.toLowerCase() !== leverageCommitment(p.params.leverage).toLowerCase()) {
    return fail(
      'leverage-commitment-mismatch',
      `appData does not commit leverage ${p.params.leverage}; the trader must have signed leverageCommitment(${p.params.leverage})`,
    )
  }
  if (p.params.solver === '0x0000000000000000000000000000000000000000') {
    return fail('zero-solver', 'FillParams.solver must be set; it receives the yield')
  }
  if (!p.registeredSolver && p.availableEscrow < borrow) {
    return fail(
      'insufficient-escrow',
      `non-whitelisted solver needs erc20BorrowEscrow >= ${borrow}, has ${p.availableEscrow}`,
    )
  }

  return {
    ok: true,
    marginAmount: margin,
    borrowRequired: borrow,
    capitalFronted: capital,
  }
}

/** Deposit the solver's borrow bond. Requires prior ERC-20 approval. */
export function buildDepositEscrowCalldata(
  solver: Address,
  token: Address,
  amount: bigint,
): { to: Address; data: Hex } {
  if (amount <= 0n) throw new Error('escrow amount must be positive')
  return {
    to: SETTLEMENTS.router,
    data: encodeFunctionData({
      abi: parseAbi(['function depositBorrowEscrow(address,uint256)']),
      functionName: 'depositBorrowEscrow',
      args: [token, amount],
    }),
  }
}

export const COW_SETTLEMENT_ADDRESS = SETTLEMENTS.cow

/**
 * DEPLOYMENT STATUS — honest state.
 *
 * `EswapCoWSettlement` compiles and is unit tested
 * (src/v4/test/EswapCoWSettlementTest.t.sol) but is NOT yet deployed on
 * Unichain; {@link COW_SETTLEMENT_ADDRESS} is the zero address. Do not point a
 * live CoW orderbook at it, and do not run a real fill, until it is deployed and
 * the address here is replaced.
 */
export const DEPLOYMENT_STATUS = {
  contractImplemented: true,
  unitTested: true,
  testFile: 'src/v4/test/EswapCoWSettlementTest.t.sol',
  deployedOnUnichain: false,
  chainId: 130,
  note: 'Set COW_SETTLEMENT_ADDRESS after deployment. Registered as zero to fail loudly rather than route value to the wrong address.',
} as const