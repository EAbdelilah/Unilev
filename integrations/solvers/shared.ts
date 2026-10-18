/**
 * Module 2 — Multi-Venue Intent Solver Package (shared base).
 *
 * THE SUPPLY SIDE. A trader opens a leveraged position; the borrowed leg must be
 * funded by a solver who holds it for the position's lifetime. Solvers earn the
 * principal back PLUS rehypothecation yield.
 *
 * All four settlement contracts exist in this repo and are unit-tested:
 *   src/v4/EswapCoWSettlement.sol
 *   src/v4/EswapUniswapXSettlement.sol
 *   src/v4/EswapOneInchFusionSettlement.sol
 *   src/v4/EswapSettlement.sol
 *
 * THE CAPITAL MODEL (read this before integrating):
 *
 *   borrowAmount = marginAmount * (leverage - 1)
 *
 *   The router pulls it from the SOLVER and settles it against the hook's
 *   transient v4 delta:
 *     EswapRouter.sol:784
 *       IERC20(input).safeTransferFrom(params.solver, address(manager), borrowAmount);
 *     EswapRouter.sol:785
 *       manager.settleFor(address(params.key.hooks));
 *
 *   Then the debt is registered and becomes senior to the trader's payout:
 *     EswapRouter.sol:789 → hook.registerSolverDebt(poolId, trader, solver, principal)
 *     EswapMarginHookLogic2.sol:454
 *       uint256 totalPayout = debt.principal + debt.accumulatedYield;
 *     EswapMarginHookLogic2.sol:496-500  solver paid BEFORE the liquidator incentive
 *
 * TRANSPARENCY: `hook.solverDebts(poolId, trader, solver)` is a public mapping,
 * so a solver can read its own APY basis on-chain at any time.
 *
 * WHAT A SOLVER IS *NOT* GUARANTEED — read before writing any partner material.
 * If an unwind yields less than owed, insurance is drawn first (capped at the
 * ERC-6909 claims actually held), then the remainder is BOOKED AS bad debt and
 * the solver payout is truncated to available proceeds:
 *     EswapMarginHookLogic2.sol:490-497
 *       uint256 uncovered = shortfall - covered;
 *       if (uncovered > 0) badDebt[debtCurrency] += uncovered;
 *       uint256 solverPayout = totalPayout > payableAmount ? payableAmount : totalPayout;
 *
 * Solver capital is PRIORITY, not guaranteed. Do not tell partners otherwise.
 *
 * Also note the KEEPER is deployed but covers nothing.
 * `EswapLiquidationKeeper` is live on Base at 0xb7ce4c1b40BBd537091E973B3c3C7DEB35106A7d
 * (~7,402 bytes verified on chain) and answers `watchesLength()` — which currently
 * returns 0. No position is under automated liquidation; coverage is added
 * owner-only via `addWatch()`. Do not describe a deployed keeper as protection.
 */

import {
  createPublicClient,
  http,
  parseAbi,
  type Address,
  type PublicClient,
} from 'viem'
import { base } from 'viem/chains'

export type { Address }

/** Target chain: Base Mainnet (8453). Every live address below is on Base. */
export const CHAIN_ID = 8453

/** v4 `PoolKey`. */
export interface PoolKey {
  currency0: Address
  currency1: Address
  fee: number
  tickSpacing: number
  hooks: Address
}

const ZERO_ADDRESS: Address = '0x0000000000000000000000000000000000000000'

/** USDC on Base (6 decimals). */
export const USDC: Address = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
/** WETH on Base (18 decimals). */
export const WETH: Address = '0x4200000000000000000000000000000000000006'
/** Native-ETH sentinel. NOTE: the live Base pool keys are WETH-based, not native. */
export const NATIVE_ETH: Address = ZERO_ADDRESS

/** `EswapMarginHook` (accounting hook) on Base. */
export const HOOK: Address = '0x6f98Ea19e522Ecc706E0Fb1574BDA8D32aC510C8'

/**
 * Hook-enabled ACCOUNTING pool on Base: `[WETH, USDC, 3000, 60, hook]`.
 * Pool id `0xcebee673dfdc9bc1f4b1e24cd0f21b437869660fbe0ecaf697ec4acd04c87231`.
 */
export const LIVE_HOOK_POOL: PoolKey = {
  currency0: WETH,
  currency1: USDC,
  fee: 3000,
  tickSpacing: 60,
  hooks: HOOK,
}

/** Deep physical pool on Base: `[WETH, USDC, 500, 10, 0x0]` (where the fill executes). */
export const LIVE_STANDARD_POOL: PoolKey = {
  currency0: WETH,
  currency1: USDC,
  fee: 500,
  tickSpacing: 10,
  hooks: ZERO_ADDRESS,
}

/** Live settlement + core contracts on Base Mainnet (deployed 2026, chain 8453). */
export const SETTLEMENTS = {
  /** EswapCoWSettlement — appData commitment = keccak256(appDataJson(leverage)). */
  cow: '0x8e54f58AaD4bdc29D18C6b02064e1c481AfCCe46' as Address,
  /** EswapUniswapXSettlement — plain-swap inventory settler (DutchV3 reactor). */
  uniswapX: '0xE8A0EC44818395d5DE7c11df672B409539978Aa7' as Address,
  /** EswapOneInchFusionSettlement — plain-swap inventory settler (LOP v4). */
  oneInchFusion: '0x2797C7850e8724B9b7222DDddD42aEFc27c9F20A' as Address,
  /** EswapSettlement — generic ERC-7683 destination settler (solver-whitelisted). */
  erc7683: '0x1244a9977368A09aA38619D92959A78638Ac0DEa' as Address,
  router: '0x57E75A87A62ab8Ff14C59FA10Ac2AB2c8cBD45D1' as Address,
  hook: HOOK,
  adapter: '0x9Ee7A81D90fF816Aa9Ae0C9C8dDFAE85E11F5983' as Address,
  keeper: '0xb7ce4c1b40BBd537091E973B3c3C7DEB35106A7d' as Address,
  /**
   * No `EswapLeverageQuoter` is deployed on Base yet. This is NOT a missing
   * settlement (the four settlers above are live) — quote against the live
   * router/hook reads instead. Deliberately the zero address.
   */
  quoter: ZERO_ADDRESS,
} as const

export const SOLVER_ESCROW_ABI = parseAbi([
  'function depositBorrowEscrow(address token, uint256 amount)',
  'function erc20BorrowEscrow(address solver, address token) view returns (uint256)',
  'function nativeBorrowEscrow(address solver) view returns (uint256)',
  'function registeredSolvers(address solver) view returns (bool)',
  'function setRegisteredSolver(address solver, bool approved)',
])

export const SOLVER_DEBT_ABI = parseAbi([
  'function solverDebts(bytes32 poolId, address trader, address solver) view returns (uint256 principal, uint256 accumulatedYield)',
])

/** On-chain view of one solver's book on one pool. */
export interface SolverPosition {
  poolId: `0x${string}`
  trader: Address
  solver: Address
  /** Outstanding borrowed principal. */
  principal: bigint
  /** Accrued rehypothecation yield owed to the solver. */
  accumulatedYield: bigint
  /** principal + accumulatedYield — what the hook will pay on close. */
  totalPayout: bigint
}

/**
 * Read a solver's on-chain book.
 *
 * This is the transparency primitive: a partner can verify their APY basis
 * directly from chain state with no oracle and no Eswap-operated accounting.
 */
export async function readSolverBook(
  client: PublicClient,
  p: { poolId: `0x${string}`; trader: Address; solver: Address },
): Promise<SolverPosition> {
  const [principal, accumulatedYield] = (await client.readContract({
    address: SETTLEMENTS.hook,
    abi: SOLVER_DEBT_ABI,
    functionName: 'solverDebts',
    args: [p.poolId, p.trader, p.solver],
  })) as readonly [bigint, bigint]

  return {
    poolId: p.poolId,
    trader: p.trader,
    solver: p.solver,
    principal,
    accumulatedYield,
    totalPayout: principal + accumulatedYield,
  }
}

/** Total ERC-20 borrow notional a solver must bond for a leveraged open. */
export function borrowNotional(marginAmount: bigint, leverage: number): bigint {
  if (leverage < 1) throw new Error('leverage must be >= 1')
  if (marginAmount < 0n) throw new Error('marginAmount must be non-negative')
  return marginAmount * BigInt(leverage - 1)
}

/** Total position notional, for reference. */
export function positionNotional(marginAmount: bigint, leverage: number): bigint {
  if (leverage < 1) throw new Error('leverage must be >= 1')
  return marginAmount * BigInt(leverage)
}

/**
 * Solve-side readiness check.
 *
 * Answers: can this solver open a leveraged position at this size, and how much
 * escrow must it post first?
 *
 * A solver may be capitalised two ways, in priority order:
 *   1. governance `registeredSolvers[solver] == true`, OR
 *   2. a pre-funded `erc20BorrowEscrow[solver][token]` bond covering the whole
 *      borrow notional (EswapRouter.sol:719 gates on the whitelist, but the
 *      escrow leg is what makes the orderbook route permissionless — an
 *      anonymous solver can bond and fill with no allowlist entry).
 */
export async function checkSolverReady(
  client: PublicClient,
  p: { solver: Address; marginAmount: bigint; leverage: number; tokenIn?: Address },
): Promise<{
  registered: boolean
  requiredEscrow: bigint
  currentEscrow: bigint
  shortfall: bigint
  canOpen: boolean
  /** How the solver should capitalise, given its current state. */
  path: 'whitelisted' | 'escrow-bond' | 'unfunded'
}> {
  const tokenIn = p.tokenIn ?? USDC
  const required = borrowNotional(p.marginAmount, p.leverage)

  const [registered, currentEscrow] = await Promise.all([
    client.readContract({
      address: SETTLEMENTS.router,
      abi: SOLVER_ESCROW_ABI,
      functionName: 'registeredSolvers',
      args: [p.solver],
    }) as Promise<boolean>,
    client.readContract({
      address: SETTLEMENTS.router,
      abi: SOLVER_ESCROW_ABI,
      functionName: 'erc20BorrowEscrow',
      args: [p.solver, tokenIn],
    }) as Promise<bigint>,
  ])

  // Whitelisted solvers still need LIQUIDITY, but no bond is posted on-chain.
  const shortfall = registered ? 0n : currentEscrow >= required ? 0n : required - currentEscrow

  return {
    registered,
    requiredEscrow: required,
    currentEscrow,
    shortfall,
    canOpen: shortfall === 0n,
    path: registered ? 'whitelisted' : currentEscrow >= required ? 'escrow-bond' : 'unfunded',
  }
}

/**
 * Approve the router for the margin AND the solver's borrow leg.
 *
 * Solvers are the case where the caller must handle allowances explicitly: the
 * router pulls the solver's borrow with `safeTransferFrom`, so without an
 * allowance the open reverts `ERC20: transfer amount exceeds allowance`.
 * Observed live.
 *
 * Approve margin + borrow in one call so a single approval covers both legs.
 */
export function buildSolverApprovals(
  token: Address,
  marginAmount: bigint,
  leverage: number,
): { token: Address; spender: Address; amount: bigint } {
  const total = marginAmount + borrowNotional(marginAmount, leverage)
  return { token, spender: SETTLEMENTS.router, amount: total }
}

/** Convenience Base client for solver modules. */
export function solverClient(rpcUrl: string) {
  return createPublicClient({ chain: base, transport: http(rpcUrl) })
}

export const NATIVE = NATIVE_ETH