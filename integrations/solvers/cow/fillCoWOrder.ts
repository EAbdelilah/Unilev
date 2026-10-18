/**
 * CoW Protocol solver — fill GPv2 orders into leveraged Eswap positions.
 *
 * Target contract: `EswapCoWSettlement` (src/v4/EswapCoWSettlement.sol, unit
 * tested at src/v4/test/EswapCoWSettlementTest.t.sol). Live on Base Mainnet —
 * see DEPLOYMENT_STATUS.
 *
 * WHAT A COW SOLVER DOES HERE
 *
 *   CoW gives you a signed GPv2 order for a plain swap. Eswap's settlement turns
 *   it into a LEVERAGED position, so the order's appData must carry the
 *   trader's leverage commitment:
 *
 *     EswapCoWSettlement.sol `appDataJson(uint8)`
 *       => '{"version":1,"appCode":"eswap","metadata":{"eswapLeverage":"<lev>"}}'
 *     EswapCoWSettlement.sol `leverageCommitment(uint8 lev)`
 *       => keccak256(bytes(appDataJson(lev)))
 *
 *   `leverageCommitment` is therefore EXACTLY the CoW `appData` hash of the
 *   canonical document: the trader registers the document via
 *   `PUT /app_data/{hash}` and the orderbook accepts the order. The solver picks
 *   `params.leverage`, and the settlement refuses the fill if it disagrees with
 *   the trader's commitment. That is the underwriting control: the trader signs
 *   the exact leverage, the solver cannot silently change it.
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
  {
    type: 'function',
    name: 'appDataJson',
    stateMutability: 'pure',
    inputs: [{ name: 'leverage', type: 'uint8' }],
    outputs: [{ name: '', type: 'string' }],
  },
] as const

// -----------------------------------------------------------------------------
// Commitment helpers
// -----------------------------------------------------------------------------

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

/** Legacy tag (retained for ABI/discovery); NOT hashed into the commitment. */
export const APP_DATA_LEVERAGE_TAG: Hex = keccakUtf8('eswap-cow-leverage-v1')

/** Prefix/suffix of the canonical `fullAppData` document (byte-exact). */
const APP_DATA_PREFIX = '{"version":1,"appCode":"eswap","metadata":{"eswapLeverage":"'
const APP_DATA_SUFFIX = '"}}'

/** Canonical `fullAppData` document, mirroring `EswapCoWSettlement.appDataJson`. */
export function appDataJson(leverage: number): string {
  if (!Number.isInteger(leverage) || leverage < 0 || leverage > 255) {
    throw new Error(`leverage must be a uint8, got ${leverage}`)
  }
  return `${APP_DATA_PREFIX}${leverage}${APP_DATA_SUFFIX}`
}

/**
 * Reproduce `EswapCoWSettlement.leverageCommitment(leverage)` off-chain.
 *
 * The order's appData MUST equal this or the fill reverts
 * `LeverageCommitmentMismatch` (EswapCoWSettlement.sol:83). It is the CoW
 * `appData` hash of the canonical document: `keccak256(bytes(appDataJson(lev)))`.
 */
export function leverageCommitment(leverage: number): Hex {
  return keccak256(toHex(appDataJson(leverage)))
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

/**
 * Build the CoW orderbook cancellation request for an order settled OFF-book.
 *
 * `EswapCoWSettlement.fillOrder` settles directly between solver and trader —
 * the GPv2 order it references stays LIVE on the CoW book until cancelled, so a
 * real GPv2 solver can still settle it and the trader pays twice (observed
 * live: UID 0x0cd5…8902 was fulfilled by a real CoW solver after our direct
 * fill). Cancel IMMEDIATELY after a successful `fillOrder` tx.
 *
 * Per the orderbook OpenAPI (services/crates/orderbook/openapi.yml), the
 * request is:
 *     DELETE https://api.cow.fi/base/api/v1/orders/{UID}
 *     body:  {"signature":"<65-byte hex>","signingScheme":"eip712"}
 * Auth is an EIP-712 signature of `OrderCancellation(bytes orderUid)` from the
 * ORDER OWNER (not the solver) — pass it in; this module stays network-free
 * and key-free.
 *
 * CAVEATS (from the API itself): cancellation is BEST-EFFORT and deprecated —
 * an order already in an in-flight settlement transaction can still be
 * executed, and pre-sign/eth-flow orders must be invalidated ON-CHAIN instead.
 * Treat a 200 as "removed from future auctions", never as "cannot settle".
 *
 * @param p.orderUid   GPv2 uid: 56 bytes as 0x-hex (order digest ‖ owner ‖ validTo).
 * @param p.signature  Owner's 65-byte `r ‖ s ‖ v` over OrderCancellation(uid).
 * @param p.signingScheme Signing scheme of the original order (default 'eip712').
 */
export function buildCancelOrderRequest(p: {
  orderUid: string
  signature: Hex
  signingScheme?: 'eip712' | 'ethsign'
}): { method: 'DELETE'; url: string; body: string } {
  if (!/^0x[0-9a-fA-F]{112}$/.test(p.orderUid)) {
    throw new Error(`not a GPv2 order uid (want 0x + 112 hex chars): ${p.orderUid}`)
  }
  if (!/^0x[0-9a-fA-F]{130}$/.test(p.signature)) {
    throw new Error(`cancellation signature must be 65 bytes: ${p.signature}`)
  }
  return {
    method: 'DELETE',
    url: `https://api.cow.fi/base/api/v1/orders/${p.orderUid}`,
    body: JSON.stringify({
      signature: p.signature,
      signingScheme: p.signingScheme ?? 'eip712',
    }),
  }
}

export const COW_SETTLEMENT_ADDRESS = SETTLEMENTS.cow

/**
 * DEPLOYMENT STATUS — honest state.
 *
 * `EswapCoWSettlement` compiles, is unit tested
 * (src/v4/test/EswapCoWSettlementTest.t.sol), and IS deployed on Base Mainnet.
 * {@link COW_SETTLEMENT_ADDRESS} is live.
 *
 * IMPORTANT (appData): the settlement now commits the CANONICAL CoW appData —
 * `leverageCommitment(lev) == keccak256(bytes(appDataJson(lev)))`, where
 * `appDataJson(lev) = {"version":1,"appCode":"eswap","metadata":{"eswapLeverage":"<lev>"}}`.
 * The trader MUST register that exact document via `PUT /app_data/{hash}` and set
 * the order's `appData` to the hash, or the fill reverts LeverageCommitmentMismatch.
 * The old `keccak256(tag ‖ lev)` preimage had no CoW appData record and was
 * therefore unfillable — do not reintroduce it.
 */
export const DEPLOYMENT_STATUS = {
  contractImplemented: true,
  unitTested: true,
  testFile: 'src/v4/test/EswapCoWSettlementTest.t.sol',
  deployedOnBase: true,
  chainId: 8453,
  settlementAddress: COW_SETTLEMENT_ADDRESS,
  note: 'LIVE PROOF (2026-10-18): A real CoW Base order (appData = leverageCommitment(5), canonical appDataJson) was posted and settled on-chain via EswapCoWSettlement.fillOrder by an ANONYMOUS solver (not registered; escrow-bonded) in tx 0xc915…aa10 (block 52766244). OrderFilled emitted, hook.positions created at lev=5, escrowAfter=0, filledOrders(uidHash)=true. Keeper watch exists on hook WETH/USDC 3000/60 with live trader 0xd9Aba9…F3c (watchesLength=1).',
  postFillRequirement: 'After every off-book fillOrder, cancel the order on the CoW book with buildCancelOrderRequest (owner-signed DELETE /api/v1/orders/{uid}); otherwise a real GPv2 solver can still settle it and the trader pays twice. Cancellation is best-effort — an in-flight settlement may already be executing.',
} as const