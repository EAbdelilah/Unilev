# Eswap v4 — Pre-Audit Notes

Scope: `src/v4/**` (EswapMarginHook, EswapMarginLib, EswapRouter, EswapLiquidationKeeper,
PriceFeed, libraries). Generated as part of mainnet-readiness pass 1→4.

## 1. Recent protocol changes to review first

### 1.1 Solver band-fee incentive (`rebalancePosition`)
- Parity fix tagged `[FIX SOLVER-YIELD]`: LP-fee surplus recovered during a
  rebalance is paid to the position's solver via `_distributeRehypothecation`
  (trader fallback when unsolver'd), matching closePosition/executeLiquidation.
  Re-deployed liquidity is capped at the recorded principal so fees cannot
  compound into the trader's band.
- Review focus: solver repayment ordering vs. collateral accounting; no path
  should double-pay solver principal (repaid once at settlement).

### 1.2 Open-interest caps
- `_oiCapacity` / `_validateOpen` bound single-position and total OI against
  running trackers; saturating decrements on close/liquidation.
- Recommended production preset (validated by stress sims):
  `setOpenInterestCaps(200, 6500, tvlFloor)` — carries a ~39%-deployed mixed
  book that the legacy 1500bps aggregate cap rejects. Defaults stay
  conservative until set by owner.

### 1.3 Insurance fund liveness semantics (known design property)
- On liquidation shortfall the full amount is drawn from `insuranceFund`;
  if the fund is short, the ENTIRE liquidation reverts with
  `InsufficientInsuranceFundForShortfall(shortfall, available)`.
- This is a liveness floor, not just solvency: an underfunded fund strands
  bad-debt bags. Sizing must be ex-ante (see §3).

### 1.4 Residue sweep (new)
- `heldReserve(Currency)` / `sweepableResidue(Currency)` views and owner-only
  `sweepResidue(Currency, to, amount)`.
- Obligation floor = `totalCollateral + insuranceFund + protocolFees`;
  sweep is hard-capped at held − floor. Registered solver debts are senior
  claims against position collateral already inside `totalCollateral`.
- Sources of legitimate residue: wei-level rounding dust and direct donations;
  the 50bps open fee is fully ledgered under `protocolFees`.

### 1.5 Bare `.transfer()` → `.safeTransfer()` (slither fix)
- Three bare `IERC20.transfer()` calls in `_settle`, `_settleTransientDebt`
  and `unlockCallback` replaced with `.safeTransfer()`. All three had
  SafeERC20 already imported and `using`-declared; the bare calls were
  leftovers from before the `[FIX C-2]` SafeERC20 adoption pass.

## 2. Static-analysis findings (accepted, not fixed)

| Tool | Finding | Disposition |
|---|---|---|
| solhint | cyclomatic complexity >8: `EswapMarginLib.checkTwap`, hook `rebalancePosition`, `_settle` region, OI-cap validate region | Accepted: hot-path branching is intrinsic (direction × cap × oracle guards). Splitting pre-audit adds regression risk without safety gain. |
| solhint | 278 warnings (natspec gaps, non-strict inequalities in gas-golfed math, custom-error suggestions) | Cosmetic/gas nits; batch before final deploy. |
| slither 0.11.6 | `incorrect-exp` (ID-7, ID-8): `(3*denominator)^2` flagged as `**` vs XOR | **False positive.** Newton's method inverse-square-root uses intentional XOR (`^2`). Code correct; slither IR couldn't parse via-ir math. |
| slither 0.11.6 | `arbitrary-send-erc20` (ID-0..6): Router/Positions `transferFrom(trader/solver, ...)` | **By design.** Pull-from pattern; trader/solver have pre-approved via `SafeERC20.safeTransferFrom`. |
| slither 0.11.6 | `unchecked-transfer` (ID-9..21): bare `.transfer()`/`.transferFrom()` in Router + Hook | **Hook: fixed** — 3 bare `.transfer()` in `_settle`/`_settleTransientDebt`/`unlockCallback` replaced with `.safeTransfer`. **Router: pre-existing**, not from this session's scope; queue for Router cleanup pass. |
| slither 0.11.6 | `uninitialized-state` (ID-22): `maxLeverageByPool` mapping never written | **Benign.** Empty mapping returns 0; `_maxLeverageForPool` falls back to `defaultMaxLeverage`. Confirm intent in audit. |
| slither 0.11.6 | `immutable-states` (ID-280): `EswapMarginHook.owner` should be immutable | **Ignored.** `owner` can be transferred via config; intentionally not immutable. |
| slither 0.11.6 | `cache-array-length` (ID-278, 279): `watches.length` in keeper loop | **Pre-existing** in `EswapLiquidationKeeper.sol`; low-impact (small bounded arrays). |

## 3. Insurance-fund sizing data (from `EswapInsuranceStressTest`)

Fund flow per single liquidated SHORT (margin 100e, mock 96% fill):

| L \ crash | 10% | 30% | 50% |
|---|---|---|---|
| 2x | +2.158e accrual | +1.012e accrual | −44.8e draw |
| 3x | +1.737e accrual | +0.018e accrual | −56.72e draw |
| 5x | +0.895e accrual | −8.096e draw | −161.2e draw |

- Correlated cascade (5 × 5x positions @ 50% gap): minimum seed = **806e**
  ≈ Σ(borrow − recovery) = **~1.61× total margin** at design gap.
- Steady-state accrual covers ~0.9% of one tail need → **181 benign events**
  of equal size to pre-fund a single tail. Seeding dominates; accrual is cosmetic.

**Sizing policy recommendation:** seed ≥ Σ over book of
`(borrow_i − collateral_i × (1 − designGap))` for the correlated worst case at
the chosen design gap, plus buffer. Do NOT rely on accrual inflows.

## 4. Known limitations / auditor pointers

- TWAP circuit breaker only gates `beforeSwap` (open path); liquidation itself
  trusts Chainlink staleness checks. Confirm this matches threat model.
- Mock-based suites simulate PM custody via explicit claims credits; RealPM
  fork suites (`MainnetV4Fork`, `LiquidationFork`, `UnichainFork`) are the
  custody ground truth.
- Legacy `test/` (v3-era Polygon fork suites) fail without RPC env/anvil and
  are out of v4 scope.
- Keeper script nits (`EswapLiquidationKeeper.sol` :180/:220) still open.

## 5. Test coverage snapshot (this pass)

- 43/43 v4 suites green (201 tests) including new:
  - `EswapSolverYieldTest` (rebalance yield routing)
  - `EswapCapStressTest` (cap boundary exactness, preset validation)
  - `EswapInsuranceStressTest` (grid flows, cascade liveness ±1wei, steady state)
  - `EswapResidueSweepTest` (floor walls, access control, dust exactness)
