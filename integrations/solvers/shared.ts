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
 * `EswapLiquidationKeeper` is live at 0x5E8aDA65050962c62A815932BF38dc144E0545DA
 * (7,451 bytes verified on chain) and answers `watchesLength()` — which currently
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
import { unichain } from 'viem/chains'

import { USDC, NATIVE_ETH, HOOK_POOL_KEY, STANDARD_POOL_KEY } from '../aggregators/shared.js'

export type { Address }

/** v4 `PoolKey`. */
export interface PoolKey {
  currency0: Address
  currency1: Address
  fee: number
  tickSpacing: number
  hooks: Address
}

export const LIVE_HOOK_POOL: PoolKey = { ...HOOK_POOL_KEY }
export const LIVE_STANDARD_POOL: PoolKey = { ...STANDARD_POOL_KEY }

/** Live settlement contracts on Unichain. */
export const SETTLEMENTS = {
  cow: '0x0000000000000000000000000000000000000000' as Address,
  uniswapX: '0x0000000000000000000000000000000000000000' as Address,
  oneInchFusion: '0x0000000000000000000000000000000000000000' as Address,
  erc7683: '0x0000000000000000000000000000000000000000' as Address,
  router: '0xe7c5AE37DDAca662B483ab5F29a30860835e8C3b' as Address,
  hook: '0x4Bd545f6438a27614098984E1322939af53AD0C8' as Address,
  adapter: '0xC5616D22892828a500b5957efA9e5CcCD59d5C70' as Address,
  // Verified live: 2,379 bytes of deployed code, positive int128 amountOut.
  quoter: '0x3177f4e53a0EE0318174771b32E68aDe63c20f3b' as Address,
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

/** Convenience Unichain client for solver modules. */
export function solverClient(rpcUrl: string) {
  return createPublicClient({ chain: unichain, transport: http(rpcUrl) })
}

export const NATIVE = NATIVE_ETH