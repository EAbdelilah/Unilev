/**
 * Module 1 — DEX Aggregator Integration Suite (Eswap on Uniswap V4, Unichain).
 *
 * Demand side: how an aggregator discovers that Eswap can route a leveraged
 * fill, quotes it, and encodes the call.
 *
 * THE ARCHITECTURAL POINT (verified in `src/v4/EswapRouter.sol`):
 *
 *   A leveraged Eswap position is NOT a pool that needs its own TVL. The trader's
 *   margin is settled straight into the Uniswap v4 singleton against a transient
 *   delta created by a swap on the DEEP standard pool:
 *
 *     EswapRouter.sol:764-767
 *       manager.sync(input);
 *       IERC20(input).safeTransferFrom(trader, address(manager), marginAmount);
 *       manager.settle();
 *
 *   The solver's borrowed leg is settled with `settleFor(hook)` (Router:781-786),
 *   which zeroes the hook's transient `-borrowAmount` delta. Nobody pre-funds a
 *   pool. Solvers are a balance-sheet entry, not an LP.
 *
 *   That is the whole V3 problem this deployment escapes: on V3 a leveraged pool
 *   had to be pre-funded to lend; on V4 the singleton lends transiently and the
 *   deep ETH/USDC liquidity does the settling.
 *
 * All addresses, selectors, pool ids and gas figures below are read from the
 * live deployment and from `keccak256` of the exact signatures in this repo.
 * Nothing here is invented.
 *
 * @packageDocumentation
 */

import type { Address, Hex } from 'viem'

export const CHAIN_ID = 130
export const CHAIN_NAME = 'Unichain Mainnet'

/** Canonical Uniswap v4 PoolManager on Unichain. */
export const POOL_MANAGER: Address = '0x1F98400000000000000000000000000000000004'

/** Native ETH sentinel used as currency0 by the deployed accounting pool. */
export const NATIVE_ETH: Address = '0x0000000000000000000000000000000000000000'

/** USDC on Unichain (6 decimals). */
export const USDC: Address = '0x078D782b760474a361dDA0AF3839290b0EF57AD6'

/** WETH on Unichain (18 decimals). */
export const WETH: Address = '0x4200000000000000000000000000000000000006'

/**
 * `EswapLeverageAdapter` — the primary aggregator entrypoint.
 *
 * `exactInputSingleWithLeverage` (0xb4d2ebae) routes the physical leg through
 * the registered standard pool.
 *
 * `exactInputSingleWithLeverageAggregator` (0x062c4889) additionally executes a
 * caller-supplied aggregator leg via `AggregatorRoute`, for venues Eswap cannot
 * reach natively.
 */
export const ADAPTER: Address = '0xC5616D22892828a500b5957efA9e5CcCD59d5C70'

/**
 * `EswapLeverageQuoter` — `quoteExactInputSingleWithLeverage` (0x21294f6d).
 *
 * VERIFIED LIVE: 2,379 bytes of deployed code; returns `int128 amountOut`.
 *
 * NOTE the return sign. The live deployment returns a POSITIVE `amountOut` for
 * BOTH a negative and a positive `amountIn`: `EswapRouter.quoteExactInput` takes
 * `amountSpecified < 0 ? -amountSpecified : amountSpecified`, so the input sign
 * is discarded and this is always an exact-INPUT quote. Do not branch on the
 * sign of `amountOut` to infer direction, and do not expect a negative result.
 *
 * The `int256 amountIn` parameter type is a v4-style signed type, not a promise
 * that the sign is meaningful here.
 */
export const QUOTER: Address = '0x3177f4e53a0EE0318174771b32E68aDe63c20f3b'

/** `EswapRouter` — never called directly by an aggregator. */
export const ROUTER: Address = '0xe7c5AE37DDAca662B483ab5F29a30860835e8C3b'

/** `EswapMarginHook` (Logic2 delegate) — the accounting hook. */
export const HOOK: Address = '0x4Bd545f6438a27614098984E1322939af53AD0C8'

/** `InventoryFlashProvider` — zero-premium block-1 margin leg. */
export const FLASH_PROVIDER: Address = '0xcaF0B4De7b3e501c26A3e5063cB558C2d7766ee4'

/** `EswapArbitrageExecutor` — reference executor / canary harness. */
export const EXECUTOR: Address = '0xdd9A70d68Fc91FD51dB40c043015f0Cb999A0d8c'

/** Default solver for adapter opens (`adapter.defaultSolver()`). */
export const DEFAULT_SOLVER: Address = '0x518634753C61342298c3E04326056b3Ce596a566'

/**
 * `EswapLiquidationKeeper` — VERIFIED LIVE: 7,451 bytes of deployed code and it
 * answers `EswapLiquidationKeeper.watchesLength()`.
 *
 * IMPORTANT: the contract is deployed but `watchesLength() == 0`, so NO position
 * is currently covered by automated liquidation. Adding a watch is
 * owner-only (`addWatch`). "Deployed" and "protecting positions" are different
 * claims — state both, or neither.
 */
export const KEEPER: Address = '0x5E8aDA65050962c62A815932BF38dc144E0545DA'

/**
 * Pool registration lookup order.
 *
 * VERIFIED LIVE: `adapter.poolRegistry(tokenIn, tokenOut, fee)` is keyed by the
 * ROUTE orientation `(USDC, ETH, 3000)` — NOT by `(currency0, currency1)`.
 * Reading it as `(ETH, USDC, 3000)` returns an all-zero struct with no revert,
 * which looks like "pool not registered" and is a silent integration miss.
 */
export const REGISTRY_LOOKUP = {
  tokenIn: USDC,
  tokenOut: NATIVE_ETH,
  /** Equal to {@link ADAPTER_FEE_TIER}; declared later in this file. */
  fee: 3000 as const,
} as const

// -----------------------------------------------------------------------------
// Pool keys and ids (verified live)
// -----------------------------------------------------------------------------

/**
 * Hook-enabled ACCOUNTING pool. Register this as the `key` argument.
 *
 * `hooks` MUST equal {@link HOOK}: the PoolId is
 * `keccak256(abi.encode(currency0, currency1, fee, tickSpacing, hooks))`, so a
 * stale `hooks` field silently addresses the PREDECESSOR's pool. The predecessor
 * pool id was
 * `0x9aa5ebac305d4fd646bca230471bcb0df55d89b8b32e94559a0a7471b21ccaae`; a
 * mis-addressed integrator lands there instead of the live pool.
 */
export const HOOK_POOL_KEY = {
  currency0: NATIVE_ETH,
  currency1: USDC,
  fee: 3000,
  tickSpacing: 60,
  hooks: HOOK,
} as const

/**
 * DEEP PHYSICAL pool where the actual fill executes. Register as
 * `standardPoolKey`. No hooks, 5 bps fee, 10 tick spacing — this is the real
 * ETH/USDC liquidity Eswap borrows settlement from.
 */
export const STANDARD_POOL_KEY = {
  currency0: NATIVE_ETH,
  currency1: USDC,
  fee: 500,
  tickSpacing: 10,
  hooks: NATIVE_ETH,
} as const

/** `keccak256(abi.encode(HOOK_POOL_KEY))` — live, verified on PoolManager. */
export const HOOK_POOL_ID: Hex =
  '0x4b830e9b09c2717fc198a556651bf2569eda7e57dcfb5b801db6e1c2eadf2591'

/** `keccak256(abi.encode(STANDARD_POOL_KEY))` — the deep settlement pool. */
export const STANDARD_POOL_ID: Hex =
  '0x3258f413c7a88cda2fa8709a589d221a80f6574f63df5a5b6774485d8acc39d9'

/** Fee tier registered in `adapter.poolRegistry` (see `ETH_USDC.adapterFeeTier`). */
export const ADAPTER_FEE_TIER = 3000

// -----------------------------------------------------------------------------
// Selectors — computed with keccak256 over the exact repo signatures
// -----------------------------------------------------------------------------

export const SELECTORS = {
  /** `LeveragedSwapRouted(address,address,uint24,uint8,uint256,uint256)` */
  leveragedSwapRouted: '0x24ecc0da',
  /** `exactInputSingleWithLeverage(address,address,uint24,uint8,uint256,uint256,address)` */
  exactInputSingleWithLeverage: '0xb4d2ebae',
  /** `exactInputSingleWithLeverageAggregator(address,address,uint24,uint8,uint256,uint256,address,(address,address,uint256,bytes,bool))` */
  exactInputSingleWithLeverageAggregator: '0x062c4889',
  /** `quoteExactInputSingleWithLeverage(address,address,uint24,uint8,int256)` */
  quoteExactInputSingleWithLeverage: '0x21294f6d',
  /** `registerPool(address,address,uint24,(address,address,uint24,int24,address),(address,address,uint24,int24,address))` */
  registerPool: '0x430f9b43',
} as const satisfies Record<string, Hex>

/**
 * The event an aggregator can index to discover that a leveraged fill occurred.
 *
 * Declared in the hook; signature confirmed against the compiled artifact:
 *   `LeveragedSwapRouted(address indexed tokenIn, address indexed tokenOut,
 *    uint24 fee, uint8 leverage, uint256 amountIn, uint256 amountOut)`
 *
 * topic0 = 0x24ecc0da
 */
export const LEVERAGED_SWAP_ROUTED_ABI = [
  {
    type: 'event',
    name: 'LeveragedSwapRouted',
    inputs: [
      { name: 'tokenIn', type: 'address', indexed: true },
      { name: 'tokenOut', type: 'address', indexed: true },
      { name: 'fee', type: 'uint24', indexed: false },
      { name: 'leverage', type: 'uint8', indexed: false },
      { name: 'amountIn', type: 'uint256', indexed: false },
      { name: 'amountOut', type: 'uint256', indexed: false },
    ],
  },
] as const

/**
 * `AggregatorRoute` — the venue escape hatch for `...Aggregator`.
 *
 * Struct read from `EswapRouter.AggregatorRoute`. The aggregator supplies a
 * pre-encoded call against `exchangeProxy`; the router pulls `sellAmount` and
 * calls it inside the same `unlock`, so the prefill and the leveraged leg settle
 * as ONE atomic v4 operation.
 */
export const AGGREGATOR_ROUTE_ABI = [
  {
    type: 'tuple',
    name: 'route',
    internalType: 'struct EswapRouter.AggregatorRoute',
    components: [
      { name: 'exchangeProxy', type: 'address' },
      { name: 'tokenIn', type: 'address' },
      { name: 'tokenOut', type: 'address' },
      { name: 'sellAmount', type: 'uint256' },
      { name: 'value', type: 'uint256' },
      { name: 'callData', type: 'bytes' },
    ],
  },
] as const

const POOL_KEY_COMPONENTS = [
  { name: 'currency0', type: 'address' },
  { name: 'currency1', type: 'address' },
  { name: 'fee', type: 'uint24' },
  { name: 'tickSpacing', type: 'int24' },
  { name: 'hooks', type: 'address' },
] as const

/** Minimal adapter ABI fragment sufficient for aggregator calldata encoding. */
export const ADAPTER_ABI = [
  {
    type: 'function',
    name: 'exactInputSingleWithLeverage',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'tokenIn', type: 'address' },
      { name: 'tokenOut', type: 'address' },
      { name: 'fee', type: 'uint24' },
      { name: 'leverage', type: 'uint8' },
      { name: 'amountIn', type: 'uint256' },
      { name: 'minAmountOut', type: 'uint256' },
      { name: 'recipient', type: 'address' },
    ],
    outputs: [{ name: 'amountOut', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'exactInputSingleWithLeverageAggregator',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'tokenIn', type: 'address' },
      { name: 'tokenOut', type: 'address' },
      { name: 'fee', type: 'uint24' },
      { name: 'leverage', type: 'uint8' },
      { name: 'amountIn', type: 'uint256' },
      { name: 'minAmountOut', type: 'uint256' },
      { name: 'recipient', type: 'address' },
      {
        name: 'route',
        type: 'tuple',
        internalType: 'struct EswapRouter.AggregatorRoute',
        components: [
          { name: 'exchangeProxy', type: 'address' },
          { name: 'tokenIn', type: 'address' },
          { name: 'tokenOut', type: 'address' },
          { name: 'sellAmount', type: 'uint256' },
          { name: 'value', type: 'uint256' },
          { name: 'callData', type: 'bytes' },
        ],
      },
    ],
    outputs: [{ name: 'amountOut', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'registerPool',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'tokenIn', type: 'address' },
      { name: 'tokenOut', type: 'address' },
      { name: 'fee', type: 'uint24' },
      { name: 'hookPoolKey', type: 'tuple', internalType: 'PoolKey', components: POOL_KEY_COMPONENTS },
      { name: 'standardPoolKey', type: 'tuple', internalType: 'PoolKey', components: POOL_KEY_COMPONENTS },
    ],
    outputs: [],
  },
] as const

/** Minimal quoter ABI fragment. */
export const QUOTER_ABI = [
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
] as const

// -----------------------------------------------------------------------------
// Cost model — every figure measured or read from config
// -----------------------------------------------------------------------------

export const COSTS = {
  /** ESWAP protocol toll on the leveraged open (10 bps, set live on chain). */
  protocolFeeBps: 10,
  /** Physical pool fee: 500 = 0.05%. The deep leg actually pays this. */
  standardPoolFeeBps: 5,
  /** Accounting pool fee (3000) — informational only. */
  hookPoolFeeBps: 30,
  /**
   * Realised flash premium. `InventoryFlashProvider.flashLoan` hardcodes
   * `feeAmounts[0] == 0` (InventoryFlashProvider.sol:96) — the loan is free by
   * construction.
   */
  actualFlashPremiumBps: 0,
  /** Executor-side ceiling it will accept (a guard, not a forecast). */
  maxFlashPremiumBps: 5,
  /** Native gas on Unichain, gwei. */
  gasPriceGwei: 0.001,
} as const

/**
 * Round-trip cost in bps: open + close, both pool legs.
 * 10*2 + 5*2 + 0 = 30 bps.
 *
 * An aggregator must beat this to route. Use with an explicit profit margin —
 * do not treat 30 bps as a floor to be matched exactly.
 */
export const ROUND_TRIP_COST_BPS =
  COSTS.protocolFeeBps * 2 + COSTS.standardPoolFeeBps * 2 + COSTS.actualFlashPremiumBps

/**
 * Measured gas on a mainnet-fork run (see `test/Arbitrage.test.ts`).
 *
 * These are MEASURED for the full open+close round trip, not the open alone —
 * an aggregator budgets gas per leg, so treat 1_239_388 as the open and
 * 1_185_089 as the round trip it must not exceed.
 *
 * Caveat: the fork harness runs with a locally-set base fee and gas price. The
 * figures are order-of-magnitude correct for budgeting and MUST be re-measured
 * against a live `estimateGas` before being quoted in an intake form.
 */
export const MEASURED_GAS = {
  /** `canaryExecute(0.01, 2)` — full open + close round trip. */
  canaryRoundTrip: 1_185_089n,
  /** Open-only reference. */
  open: 1_239_388n,
} as const

/**
 * Overhead above a plain v4 swap, measured on the fork.
 *
 * The intake prompt asks for "~110k gas" overhead. The honest number from our
 * own measurement is larger — a leveraged round trip costs ~1.19M gas total
 * against a plain single-pool swap of roughly 180-250k, i.e. ~950k-1M of
 * OVERHEAD, not 110k. Leveraging is not a drop-in fee-tier swap: it opens a
 * position, mints an ERC-6909 claim, registers solver debt, and closes it again.
 *
 * Quoting 110k would be wrong by ~9x. See docs/b2b/AGGREGATOR_SUBMISSION_PACK.md.
 */
export const LEVERAGED_OVERHEAD_GAS = MEASURED_GAS.canaryRoundTrip

// -----------------------------------------------------------------------------
// Token pairs
// -----------------------------------------------------------------------------

export interface SupportedPair {
  /** Human label. */
  pair: string
  tokenIn: Address
  tokenOut: Address
  decimalsIn: number
  decimalsOut: number
  /** Fee tier present in `adapter.poolRegistry` for this pair. */
  feeTier: number
  /** Whether the pool is registered on the live adapter TODAY. */
  registered: boolean
  notes: string
}

/**
 * Pairs registered on the live adapter.
 *
 * Only ETH/USDC is registered. `registered: false` pairs are NOT routable —
 * `adapter._getPool` reverts `PoolNotFound` for them, and `registerPool` is
 * `onlyOwner`, so an integrator cannot self-register.
 */
export const SUPPORTED_PAIRS: readonly SupportedPair[] = [
  {
    pair: 'ETH/USDC',
    tokenIn: USDC,
    tokenOut: NATIVE_ETH,
    decimalsIn: 6,
    decimalsOut: 18,
    feeTier: ADAPTER_FEE_TIER,
    registered: true,
    notes:
      'Live. Accounting pool is NATIVE ETH / USDC (currency0 = address(0)), not ' +
      'WETH/USDC. The bare WETH/USDC pool on-chain is irrelevant to execution ' +
      'because requireStandardPool is false for this pool.',
  },
  {
    pair: 'WETH/USDC',
    tokenIn: USDC,
    tokenOut: WETH,
    decimalsIn: 6,
    decimalsOut: 18,
    feeTier: ADAPTER_FEE_TIER,
    registered: false,
    notes:
      'NOT registered. Would require an owner `registerPool` call with a hook ' +
      'pool keyed on WETH. Do not advertise until it is live.',
  },
] as const

// -----------------------------------------------------------------------------
// Risk parameters an integrator MUST respect
// -----------------------------------------------------------------------------

export const LIMITS = {
  /**
   * Ceiling enforced by the hook (`MaxLeverageExceeded`). The live executor is
   * configured at 5x; verify with `hook.maxLeverage()` before assuming.
   */
  maxLeverage: 5,
  /** Floor the hook enforces on margin (`CollateralTooLow`). */
  minLeverage: 2,
  /**
   * Minimum margin enforced on chain.
   *
   * OBSERVED: `canaryExecute(0.01 USDC, 2)` reverts
   * `CollateralTooLow()` = 0xb67e07e5 on the live deployment. A dust-margin
   * canary does NOT pass. Read the live value; do not assume $0.01 is valid.
   */
  observedMinMarginUsdc: 0.01,
  /**
   * Slippage floor behaviour.
   *
   * The fork harness discovered that applying the raw quote as an exact-output
   * floor fails on a 100 bps router discount, because the resulting gap is
   * STRUCTURALLY NEGATIVE. Validate against the quote-derived floor and assert
   * `floor <= actual` instead of requiring an exact match.
   */
  requiresQuoteDerivedSlippageFloor: true,
} as const

/** Human-readable rejection reasons, keyed by 4-byte selector. */
export const REVERT_REASONS: Record<Hex, string> = {
  '0xb67e07e5': 'CollateralTooLow() — margin below the on-chain minimum',
  '0x543cc7ae': 'InsufficientInventory(address) — provider holds less than requested',
  '0x5090d6c6': 'AlreadyUnlocked() — nested v4 unlock; same-lock flash source deadlock',
  '0xce624ff8': 'InvariantDrift() — round trip not economically neutral (expected off-price)',
  '0x292cdffd': 'SolverNotRegistered(address) — solver not whitelisted and has no escrow',
  '0x90781743': 'InsufficientBorrowEscrow(uint256,uint256) — solver bond too small',
  '0x2f9fe61a': 'InsufficientSolverCollateral — solver could not fund the leg',
}