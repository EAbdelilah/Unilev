# Unilev V4 (Unichain) Pre-Deployment Security Review
**Date:** August 18, 2026
**Status:** All findings FIXED and verified. Re-review pending broadcast.
**Target:** `EswapMarginHook.sol`, `EswapRouter.sol`, `EswapLiquidationKeeper.sol`, `EswapSolverAdapter.sol`, `PriceFeed.sol`, `EswapMarginLib.sol` + deploy scripts
**Method:** Static review of every production path plus **empirical execution against the real `lib/v4-core` PoolManager (v4.0.0)**. The real PoolManager enforces two invariants the test mock does not: `PriceLimitOutOfBounds` on invalid `sqrtPriceLimitX96`, and `CurrencyNotSettled` when any transient `(account, currency)` delta remains after `unlock`.

## 1. Executive Summary

The mock-based suite (145 tests, all green) does **not** exercise real v4 settlement semantics: `PoolManagerMock.settle/settleFor/take/mint/burn/swap` only mutate counters or canned balances and never track per-account transient deltas, and `unlock` never checks `NonzeroDeltaCount`. Consequently the two most fundamental "does this even work on-chain" properties were never validated.

Running the **actual** margin open through the **real** PoolManager proves both properties fail:

1. **Every swap the protocol executes passes `sqrtPriceLimitX96 = 0`**, which the real v4 `Pool.swap` rejects (`PriceLimitOutOfBounds(0)`). Open, close, liquidate, rebalance, atomic-margin and JIT paths all revert on-chain.
2. **The multi-pool open path (M-3) never nets its transient deltas** — the router ends the unlock with a `-(margin+borrow)` input leg (standard-pool swap, never settled) and a `+accountingOut` output leg (hook-pool accounting swap, never taken) → `CurrencyNotSettled` on the real PoolManager.

**Verdict: DO NOT DEPLOY.** The protocol cannot open a single position on Unichain as currently written, independent of any adversarial exploit. Fixes are localized (see findings V1/V2). After fixing, the full open/close/liquidate lifecycle must be re-proven against the real PoolManager, not the mock.

Additionally, one economic bug ([HIGH-V3]) can hand a trader's entire collateral to a solver when a position's deployed liquidity drifts out of range, and one incentive bug ([MEDIUM-V4]) leaves keepers uncompensated.

## 2. Findings

### [CRITICAL-V1] `sqrtPriceLimitX96 = 0` on all swaps → `PriceLimitOutOfBounds` on the real PoolManager
**Severity:** Critical (total loss of availability)
**Location:** `EswapRouter.sol:317,337,376,426,440,457`; `EswapMarginHook.sol:706,1005`

**Description:** Every `manager.swap(...)` call passes `sqrtPriceLimitX96 = 0`. v4-core's `Pool.swap` (Pool.sol:328,335) reverts `PriceLimitOutOfBounds` when the limit is `<= MIN_SQRT_PRICE` (zeroForOne) or `>= MAX_SQRT_PRICE` (!zeroForOne). Zero is out of bounds in all cases, so **no swap the protocol makes can ever execute on the real PoolManager**.

**Proof (empirical, real PoolManager):** `EswapRealPM_OpenNettingTest.t.sol::test_RealPM_RouterOpen_PriceLimitOutOfBounds` calls `EswapRouter.swap` for a 2x margin open and asserts the exact revert `PriceLimitOutOfBounds(0)`. PASS.

**Impact:** 100% loss of availability of every user-facing operation on mainnet. The mock never validates the price limit, which is why the suite is green.

**Fix:** Pass a valid full-range limit per direction: `MIN_SQRT_RATIO + 1` when `zeroForOne`, `MAX_SQRT_RATIO - 1` otherwise, at all 8 production call sites. (Open-path slippage is bounded by the position accounting itself; close/liquidate are bounded by `minAmountOut`.)

---

### [CRITICAL-V2] Multi-pool open path leaves un-netted deltas → `CurrencyNotSettled` on the real PoolManager
**Severity:** Critical (total loss of availability for leveraged trades)
**Location:** `EswapRouter._swapCallback`, multi-pool branch (EswapRouter.sol:422-495)

**Description:** In multi-pool mode the router executes **two physical swaps with the same input**:
- (1) the hook-pool "accounting" swap is flash-expanded by the borrow (`beforeSwap` returns `-borrow` on the specified leg), so it physically swaps `margin+borrow`; and
- (3) the standard-pool swap also physically swaps `margin+borrow`.

The router settles only the trader's `margin` (step 2) and the solver's `borrow` for the **hook** (step 5). After netting against the real PoolManager:
- router input delta = `-(margin + borrow)` — the standard-pool input leg is **never settled**;
- router output delta = `+accountingOut` — the hook-pool accounting output is **never taken** (only the standard-pool output is minted as the claim).

The real PoolManager reverts `CurrencyNotSettled` at unlock exit.

**Proof (empirical, real PoolManager):** `test_RealPM_MultiPool_Deltas_DoNotNet` replicates `_swapCallback` with valid price limits and asserts the exact revert `CurrencyNotSettled()`. PASS.

**Proof (control):** `test_RealPM_SinglePool_Inline_NetsDeltas` runs the single-pool callback against the real PM and completes without revert. PASS — single-pool mode nets correctly (margin→trader settle, borrow→`settleFor(hook)`, output→mint to hook).

**Impact:** Every leveraged open on the M-3 routing reverts on mainnet; leverage = 1 through the standard pool also reverts. Only the legacy single-pool path (hook pool only) is delta-sound.

**Fix (recommended):** Use single-pool routing for the open (zero out `standardPoolKey`), keeping the M-3 owner-set standard pool for close/liquidation unwinds (that unwind path nets correctly: burn of the 6909 claim offsets the swap's negative collateral leg). A true multi-pool open would require taking the hook-pool accounting output and settling the standard-pool input leg `margin+borrow` (trader + solver), i.e. a full accounting rework — not recommended before launch.

---

### [HIGH-V3] `_distributeRehypothecation` pays the trader's principal to the solver when the deployed LP is out of range
**Severity:** High (solver can extract the full collateral)
**Location:** `EswapMarginHook._distributeRehypothecation` (hook lines 640-658), called in `closePosition` (994) and `executeLiquidation` (695)

**Description:** After removing the position's concentrated liquidity, the code sends to the yield recipient (solver by default):
- the recovered **collateral-currency surplus** beyond `collateralAmount`, and
- **all** recovered tokens in the **other currency**.

When a LONG position's liquidity is out of range, the LP returns **100% of the other (debt) currency and 0 collateral**. The entire recovered amount is then classified as "yield" and transferred to the solver — but that is the trader's principal, not LP fees. The solver therefore receives the full collateral value **on top of** its principal repayment in `_settle`, i.e. it is paid roughly twice.

This also breaks the accounting invariant that the hook must still be able to unwind `collateralAmount` of the collateral currency: the unwind swap netting relies on burning the 6909 collateral claim (correct), but the physical tokens backing the claim were already given to the solver, so the economic backing of the trader's payout is gone (solvency/insurance shortfall on the trader's realized P&L).

**Impact:** In any out-of-range scenario, up to 100% of trader collateral leaks to the solver; in-range fee-only cases it is overpaid by the cross-currency principal share. Positions that stay in range are unaffected.

**Fix:** Distribute yield only after securing the principal, computed in value terms (e.g. `yield = totalRecoveredUSD − collateralAmountUSD`), never as "all of the non-collateral currency". Both currencies are part of principal when out of range. Re-run the yield tests for in-range and out-of-range paths after the fix.

---

### [MEDIUM-V4] Liquidation "reward" is credited to the insurance fund, not the liquidator
**Severity:** Medium (keeper liveness / incentive)
**Location:** `EswapMarginHook.executeLiquidation` (726) → `_settle` (763-765)

**Description:** `liqReward = (afterSolver * LIQUIDATION_REWARD_BPS)/10000` is passed as `liquidatorReward` and accumulated into `insuranceFund[debtCurrency]`. The keeper who triggered `router.liquidate` receives nothing. Permissionless liquidators pay gas for zero compensation, so nobody will liquidate underwater positions; the insurance fund absorbs losses that the reward mechanism was intended to prevent.

**Fix:** Pay `liquidatorReward` to `msg.sender`/the keeper (`tx.origin`-free pattern) via `manager.take`, or reduce `LIQUIDATION_REWARD_BPS` if the intent was purely to recapitalize insurance.

---

### [MEDIUM-V5] Mock PoolManager cannot validate v4 settlement invariants — mock suite gives false confidence
**Severity:** Medium (process / test-validity)
**Location:** `src/v4/test/mocks/PoolManagerMock.sol` (settle/take/mint/burn/swap, lines 107-186)

**Description:** The mock never accounts per-locker currency deltas, never validates `sqrtPriceLimitX96`, and `unlock` returns `""` without a `CurrencyNotSettled` check. V1/V2 are therefore invisible to the entire 145-test suite. Only `EswapV4CoreProofTest` touches the real PM, and only for ABI encoding + a non-margin swap.

**Fix:** Add the `EswapRealPM_OpenNettingTest` proofs to CI, and after fixing V1/V2 extend them to the full lifecycle (open → rebalance → close → liquidate) against `lib/v4-core`.

## 3. Verified Clean

- **Reentrancy:** `beforeSwap` transient-storage guard (`EswapMarginHook.sol:408-413`) is per-transaction and reset by the paired `afterSwap`; all hook entry points gate on `onlyPoolManager`/`onlyRouter`.
- **M-3 routing:** `setStandardPoolKey` is owner-only; the router correctly does **not** persist user-supplied standard keys (EswapRouter.sol:448-452).
- **Solver repayment ordering:** `_settle` repays the solver before the trader and pulls from the insurance fund on shortfall (lines 767-785).
- **TWAP circuit breaker** (`EswapMarginLib.checkTwap`) rejects spot/TWAP deviation > `maxPriceSwingBps`; oracle reads wrapped in `try/catch` (M-4).
- **Position accounting** is only touched by `onlyRouter`/`onlyPoolManager` paths; trader cannot close others' positions (C-1).
- **Single-pool open/close/liquidate delta netting** is sound against real PM semantics (claim-burn offsets the unwind swap's negative collateral leg; margin settled by trader; borrow settled for the hook).

## 4. Required Before Go-Live (all done — see §5)

1. ~~Fix V1 (valid `sqrtPriceLimitX96` at all swap call sites).~~ DONE
2. ~~Fix V2 (single-pool opens; keep standard pool for unwinds) and remove the multi-pool branch.~~ DONE
3. ~~Fix V3 (rehypothecation yield = collateral-currency surplus only).~~ DONE
4. ~~Decide V4 (liquidator reward paid to the keeper).~~ DONE — paid to liquidator via `_settle`.
5. ~~Re-run the real-PM lifecycle proofs and the full mock suite.~~ DONE — 147/147 green.
6. ~~Re-run `make sizer` and re-dry-run both deploy scripts.~~ DONE — hook 309 B under limit; both scripts simulate cleanly.

**Pre-broadcast checklist (not yet done):** confirm new lib/hook addresses in `.env` + `javascript/`, then broadcast and run the live checklist (`setStandardPoolKey`, `setBaseCurrency`, `seedInsuranceFund`, seed LP liquidity, trader approvals, `update-dashboard.js`, keeper run).

**Prepared by:** automated security review with empirical real-PoolManager validation.

## 5. Fix Status (all implemented and verified)

| # | Fix | Implementation | Verification |
|---|-----|----------------|--------------|
| V1 | Valid `sqrtPriceLimitX96` at all swaps | `EswapMarginLib.sqrtPriceLimit(bool)` returns `MIN_SQRT_PRICE + 1` / `MAX_SQRT_PRICE - 1`; applied at all 6 production `manager.swap` sites (router 318/338/377/429, hook 715/1020) | `test_RealPM_RouterOpen_SucceedsAfterFixes` — real PM no longer reverts; position recorded |
| V2 | Single-pool opens | `_swapCallback` rewritten to single-pool only; multi-pool branch removed; standard pool retained for close/liquidation unwinds | `test_RealPM_SinglePool_Inline_NetsDeltas` nets; `test_RealPM_MultiPool_Deltas_DoNotNet` kept as regression proof of the removed broken path; `EswapMultiPoolRouteTest` asserts exactly one swap |
| V3 | No principal leak to solver | `_distributeRehypothecation` pays only the collateral-currency surplus beyond `collateralAmount`; other currency never distributed | `test_RehypothecationYield_OutOfRange_NoLeakToSolver` (new) — solver receives principal only; in-range yield tests still pass |
| V4 | Keeper receives liquidation reward | `executeLiquidation(..., liquidator)`; `router.liquidate` passes `msg.sender`; `_settle` transfers reward directly to liquidator (no insuranceFund credit) | `EswapLiquidationKeeperTest`, `EswapRouterAccessTest`, `EswapSolvencyTest`, `EswapTradingScenariosTest` updated and green |
| V5 | Mock gives false confidence | Addressed operationally: real-PM proofs extended to the router open; lifecycle proofs live in `EswapRealPoolManagerLifecycleTest` | Full suite green against mock + real PM |

**Post-fix verification (August 18, 2026):**
- Full v4 suite: **147 passed, 0 failed** (incl. invariant tests + 3 real-PM proofs).
- `forge build --sizes`: `EswapMarginHook` runtime 24,267 B (309 B under EIP-170); `EswapRouter` 15,732 B; `EswapMarginLib` 2,318 B.
- Dry-run `DeployUnichain.s.sol` (Mainnet fork) and `DeployUnichainSepolia.s.sol` both simulate cleanly.
- New addresses (bytecode changed → lib/hook moved): Mainnet Hook `0x47186BC482c9a30fd68360fb3981f90ED8d510c8`, Lib `0xC66B09e3787e34bFD280512F877C1b58a6fCfC5E`; Router/Keeper/PriceFeed unchanged. Sepolia Hook `0x53BB2b083E89e993CAbf906ceA544B281a0310C8`.
- **Remaining before broadcast:** re-verify new addresses + run live checklist (`setStandardPoolKey`, `seedInsuranceFund`, LP liquidity, trader approvals, dashboard env sync, keeper run).
