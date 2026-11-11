# Eswap V4 — Aggregator & Solver Production Readiness Report

**Scope:** aggregator routing (0x, 1inch, ParaSwap, Enso, KyberSwap, LI.FI, Socket),
CoW / UniswapX / 1inch-Fusion settlement, direct solver intents and external
solver economics on **Base mainnet (chainId 8453)**.

**Verdict: GO with 2 blocking release actions and 8 tracked findings.**
Every pillar was re-verified against the code at `HEAD`, against the *deployed*
bytecode on Base, and against live fills. No allowance leak, no fund-siphoning
path, no solver-seniority inversion, and no MEV-to-bad-debt path was found.
Two items must be closed before the partner package is sent out:

| # | Blocking action | Why |
|---|---|---|
| **B1** | Deploy with `FOUNDRY_PROFILE=deploy` (or apply the size restriction in §4.1). The default profile now produces a **25,056-byte** `EswapMarginHook`, i.e. **480 bytes over EIP-170**. The live artifact is **23,595 bytes** and is legal. | A `forge build` + naive deploy from the default profile reverts at the EIP-170 check. |
| **B2** | Redeploy `UsdcTwapFeed` (`0x879F65Df…5cBd9`) from current source: the live runtime is missing the `maxEthFeedAge()` guard (`0x065dcecf` absent from bytecode). | The deployed USDC/USD adapter is an older build than the audited source. |

Tracked findings (non-blocking, documented in §6): `accumulatedYield` is dead
storage (F-1), `partialLiquidation`'s success path is mathematically unreachable
(F-2), `insuranceCoverageBps` has no public getter in the split-logic build
(F-3), fee-on-transfer *output* tokens leave an unbacked claim (F-4), the 1inch
Fusion settler still runs the single-cap build (F-5), the historical
`< 350k gas` target is not met by the current open path (F-6), rebalance
double-deducted solver yield and wrote the trader's book down by the LP fees
(**F-7 — found by this certification and fixed in the working tree**), and eleven
pre-existing suites were red at `HEAD` — ten from the `sender == router`
hardening plus one stale keeper-payout expectation (F-8, test-only fix applied).

---

## 0. How to reproduce everything in this report

```bash
# ── Build (EIP-170-relevant: use the deploy profile for the hook) ────────────
FOUNDRY_PROFILE=deploy forge build --sizes        # authoritative size table (§4.1)
forge build --sizes                               # default profile, shows B1

# ── The new consolidated certification suite (Phases 1-4) ───────────────────
forge test --match-path "src/v4/test/EswapProductionCertification.t.sol" -vv

# ── Pre-existing suites cited by this report ────────────────────────────────
forge test --match-path "src/v4/test/EswapAggregatorWhitelistTest.t.sol"   -vv
forge test --match-path "src/v4/test/EswapIntentSolverTest.t.sol"          -vv
forge test --match-path "src/v4/test/EswapSolverAdapterTest.t.sol"         -vv
forge test --match-path "src/v4/test/EswapTriggerOrderTest.t.sol"          -vv
forge test --match-path "src/v4/test/EswapPartialLiquidationTest.t.sol"    -vv
forge test --match-path "src/v4/test/EswapSolverYieldTest.t.sol"           -vv
forge test --match-path "src/v4/test/AuditThirdLiquidationPoC.t.sol"       -vv
forge test --match-path "src/v4/test/EswapLiquidatorIncentiveTest.t.sol"   -vv

# ── Adjacent suites that share the rebalance / keeper / collateral paths ────
for s in EswapRebalanceTest EswapSmartCollateralTest EswapHardenedTest \
         EswapE2ETest EswapMultiPoolOpenTest EswapMultiPoolRouteTest \
         EswapLiquidationKeeperTest LiveDeployCollateralReproTest \
         GasProfileOpenTest EswapCoWSettlementTest EswapERC7683Test; do
  forge test --match-path "src/v4/test/$s.t.sol" -vv
done

# ── Live Base config used by §4.2 (writes scripts/v4/live/proofs/partner-config-*.json)
node scripts/v4/live/partner-config.cjs

# ── Deployed-bytecode size + selector probe (proves B1/B2) ──────────────────
node scripts/v4/live/_sizes.cjs
node scripts/v4/live/_usdcfeed.cjs

# ── Re-verify the live fills (§5) ───────────────────────────────────────────
node scripts/v4/live/verify-aggregator.cjs      # 135/135
node scripts/v4/live/verify-adapter.cjs         # 27/27 per venue
node scripts/v4/live/verify-lifi.cjs            # 24/24
node scripts/v4/live/verify-cow-intent.cjs      # 14/14
node scripts/v4/live/verify-fusion.cjs          # 28/28
node scripts/v4/live/verify-uniswapx.cjs        # 14/14
```

Every claim below is anchored to one of: a source line, a test name you can run,
or a mainnet transaction you can re-verify.

---

## 1. Phase 1 — Aggregator routing & security conformance

### 1.1 Allowance & fund-siphoning guards — **PASS**

The fill leg and the accounting leg are deliberately split across the
PoolManager lock:

| Stage | Function | Lock state | What it does |
|---|---|---|---|
| prefill | `_aggregatorPrefill` (`EswapRouter.sol:1143-1270`) | **outside** `manager.unlock` | pulls margin + escrowed borrow into the router, `forceApprove(proxy, notional)`, executes the real aggregator calldata, measures output, `forceApprove(proxy, 0)` |
| settle | `_aggregatorSettle` (`EswapRouter.sol:1280-1342`) | **inside** `manager.unlock` | `registerMarginOpen` → `mint` 6909 claim → `sync` → `safeTransfer` → `settle` → `registerSolverDebt` → ETH refund → optional `deployCollateral` |

Order inside `_aggregatorPrefill` (verbatim):

1. `block.timestamp > params.deadline` → `DeadlineExpired`
2. `notional = margin + margin*(leverage-1)`
3. solver authorisation: `registeredSolvers[solver]` **OR** `erc20BorrowEscrow[solver][borrowToken] >= borrow` **OR** `solverAuthorizedByIntent`
4. `solverNotionalCap` bound
5. whitelist / standard-pool currency match / `tokenIn` / `tokenOut` / `sellAmount` checks → `AggregatorRouteMismatch`
6. native legs rejected (`route.value != 0` → `AggregatorNativeLegUnsupported`)
7. pull margin (`safeTransferFrom(trader)`) + borrow (escrow debit)
8. `forceApprove(proxy, notional)`
9. snapshot `inBefore` / `outBefore`, call the proxy, **propagate the revert payload**
10. `outputAmount = outAfter - outBefore`; `require(outputAmount > 0, "Aggregator output zero")`
11. **`forceApprove(proxy, 0)`** — unconditional
12. `inputConsumed = inBefore - balanceOf(this)`; `inputConsumed != notional` → `AggregatorRouteMismatch`
13. `outputAmount < params.minAmountOut` → `SwapOutputBelowMinimum`

Two properties make this leak-proof:

* **The reset is unconditional and precedes every check that can revert.**
  `forceApprove(proxy, 0)` runs *before* the `inputConsumed` and `minAmountOut`
  guards, so even a reverting route leaves the router with zero allowance to the
  proxy. There is no code path that returns from `_aggregatorPrefill` holding a
  live approval.
* **The reset does not rely on the token decrementing the allowance.**
  `NoDecrementERC20` (an ERC-20 whose `transferFrom` never touches allowance) is
  used in `test_AllowanceReset_AfterFill_NonDecrementingToken`; after a
  successful fill the router→proxy allowance is exactly `0`.

`inputConsumed == notional` is the anti-drain invariant: a proxy that consumes
less (retains a live allowance for later) and a proxy that consumes more (steals
from the router's own balance, e.g. collateral from another fill) both revert.

Certified by (`src/v4/test/EswapProductionCertification.t.sol`):

| Test | Proves |
|---|---|
| `test_AllowanceReset_AfterFill_NonDecrementingToken` | allowance is zeroed by the router itself, not by the token |
| `test_UnderConsumption_RevertsRouteMismatch` | half-consumption → `AggregatorRouteMismatch` |
| `test_OverConsumption_RevertsRouteMismatch` | over-pull → `AggregatorRouteMismatch` |
| `test_FillRevertPayload_IsPropagated` | proxy revert payload surfaces unchanged (no silent success) |
| `test_ZeroOutput_Reverts` | zero-output fill reverts on `"Aggregator output zero"` |
| `test_UsdtStyleNoReturnToken_Succeeds` | USDT-style no-return ERC-20 settles end-to-end |
| `test_FeeOnTransferOutput_LeavesUnbackedClaim` | see §1.2 |
| `test_RebaseDuringFill_FailsClosed` | see §1.2 |

### 1.2 Weird ERC-20 matrix

| Token behaviour | Result | Evidence |
|---|---|---|
| USDT-style (no return data) | **works** — router uses `SafeERC20`/empty-returndata-as-success | `test_UsdtStyleNoReturnToken_Succeeds` |
| Non-decrementing allowance | **works** — reset is router-driven | `test_AllowanceReset_AfterFill_NonDecrementingToken` |
| Rebasing mid-fill (measured balance inflated) | **fail-closed** — `AggregatorRouteMismatch` | `test_RebaseDuringFill_FailsClosed` |
| Fee-on-transfer **output** | **unsupported, and it leaves an unbacked ERC-6909 claim** | `test_FeeOnTransferOutput_LeavesUnbackedClaim` |
| Blocked recipient (blacklist) | **fail-closed** — `_creditStrandedYield` fallback | `test_BlockedSolver_YieldStrandedToInsurance` |
| Native / `route.value != 0` | **rejected** — `AggregatorNativeLegUnsupported` | `test_NonZeroRouteValue_Reverts` |

**Finding F-4 (fee-on-transfer output tokens).** `outputAmount` is measured on
the router's balance, so it is already net of the transfer fee. The settle leg
then moves that same net amount to the PoolManager, which charges the fee a
second time: `pmTokens == claim * 9900 / 10000` for a 1% token. The hook's claim
is therefore not fully backed. On the real PoolManager the `settle()` step would
revert (transient delta not cleared), so this is **fail-closed on-chain**; the
mock-based assertion documents the exact accounting gap. **Action:** keep
fee-on-transfer tokens off the supported-asset list (already implicit: no such
token is registered in `PriceFeed`).

### 1.3 Execution inside/outside the lock — **PASS**

`swapMultiPoolForAggregator` (`EswapRouter.sol:515`) runs
`_aggregatorPrefill` **before** `manager.unlock(...)`, then does the accounting
inside the callback. This is what makes a V4-leg route work on a chain where
every pool is a V4 pool (Unichain): the aggregator's own `PoolManager.unlock()`
would otherwise revert `AlreadyUnlocked`.

Proven with a lock-enforcing mock (`LockingPoolManagerMock`), which is not what
the rest of the suite uses:

* `test_NestedV4Unlock_Succeeds` — proxy performs its own `unlock()` during the
  fill; `unlockCount == 2` (proxy + router), lock released, position opened.
* `test_NestedUnlock_NegativeControl` — a callback that tries to `unlock()`
  inside an active lock gets `AlreadyUnlocked`. So the positive test is not a
  vacuous mock.

### 1.4 Slippage & delta packing — **PASS**

`minAmountOut` is enforced on the executed output for every aggregator route
(`test_MinAmountOut_RevertsBelowMinimum`, exact `SwapOutputBelowMinimum(2.5e18, 2.99e18)`).

`BalanceDelta` packing is keyed to the **pool's** currency ordering, not to
`(input, output)` (`EswapRouter.sol:1337-1341`):

```
zeroForOne : packed = (negNotional << 128) | output          → d0 = -notional, d1 = +output
else       : packed = (output << 128) | (negNotional & u128) → d0 = +output,    d1 = -notional
```

Both orientations asserted field-by-field in
`test_ExactFill_PacksDelta_ZeroForOne` / `test_ExactFill_PacksDelta_OneForZero`,
including `isLong == false` for the sell-currency0 direction and `isLong == true`
for the buy-currency0 direction.

### 1.5 Gas benchmark — **TARGET NOT MET (F-6)**

`test_AggregatorGas_MeasuredBound` measures `swapMultiPoolForAggregator` end to
end and pins the measured value so a regression is caught.

| Measurement | Value |
|---|---|
| Mock-PM harness (`test_AggregatorGas_MeasuredBound`, logged) | **925,069 gas** |
| Live Base open, same path (`0x3d70…25e9`, block 55,743,572) | **1,599,873 gas** |
| Original mission target | **< 350,000 gas** |

**Finding F-6: the `< 350k` target is refuted.** The open path costs ~2.6× the
mock measurement on mainnet and ~4.6× the target. The mock figure is a *lower
bound*: it isolates router + proxy + token work and excludes real PoolManager
`mint/settle` storage costs, the position NFT mint and the ERC-6909 claim
writes. The dominant costs are structural, not accidental:

* the ERC-6909 collateral claim is minted for the whole position and the
  position NFT is minted (two cold `SSTORE` sets, ~44k gas at Base prices);
* `_aggregatorPrefill` performs two `forceApprove` writes on a cold token plus
  two `balanceOf` reads around the proxy call;
* the margin open performs an oracle read pair (two Chainlink `latestRoundData`
  calls) and a leverage/health computation;
* the `unlock` + `swap` + `settle` cycle touches the PoolManager three times.

The test asserts `< 1,000,000` on the mock harness (the measured envelope plus
headroom). Anyone quoting "sub-350k" to a partner should stop: the honest number
for an aggregator open on Base is **~1.6M gas**. Routing *within* an existing
position (spot/close) is materially cheaper — the live CLOSE was **417,366 gas**.

---

## 2. Phase 2 — Solver economic security

### 2.1 Repayment seniority — **PASS**

`_settle` (`EswapMarginHookLogic2.sol:353-500`) pays in exactly this order, and
each step is bounded by what remains:

1. `manager.take(debtCurrency, hook, receivedAmount)` — realise proceeds
2. **solver** ← `min(totalPayout, available)`, `totalPayout = principal + accumulatedYield`, with the `borrowedAmount` fallback when no ledger exists (1x positions)
3. **insurance** covers the residual shortfall (`insuranceCoverageBps`), burning the claim and `take`-ing it
4. **bad debt** books whatever insurance could not cover
5. **liquidator** ← `max(liquidatorIncentiveBps, LIQUIDATOR_MIN_INCENTIVE_BPS=50)` bps of `liquidatorReward + traderPayout`
6. **insurance credit** ← `liquidatorReward` (`LIQUIDATION_REWARD_BPS=300`), claim-backed via `_settleToManager` + `mint`
7. **trader** ← residual
8. ledger cleanup (`delete positions / solverDebts / positionSolver`)

`_settlePartial` (`EswapMarginHookLogic3.sol:250-377`) uses the same
solver-first ordering on the proportional slice.

Certified:

| Test | Expected distribution |
|---|---|
| `test_SolverPrincipal_PaidBeforeLiquidatorInsuranceTrader` | surplus 30: solver **20**, liquidator **0.05**, insurance **0.30**, trader **9.65**, badDebt **0** |
| `test_SolverPrincipal_BeatsInsuranceAndBadDebtOnShortfall` | proceeds 14: solver **14**, liquidator **0**, insurance untouched, badDebt **6** |
| `test_FullLiquidation_ClearsAllLedgers` | position, `solverDebts`, `positionSolver`, `rehypPrincipal` all zeroed |

### 2.2 Escrow & funding mechanics — **PASS**

`depositBorrowEscrow` / `withdrawBorrowEscrow` (`EswapRouter.sol:340-353`) are
permissionless and keyed by `msg.sender`; `nativeBorrowEscrow` is the ETH twin
(`:253-265`). A fill draws the borrow leg **out of the escrow balance** at fill
time, so:

* no per-trade ERC-20 approval is needed from the solver, and no solver balance
  is touched at fill time — only the pre-funded bond;
* the bond backing a **live** position is debited the moment the position opens,
  so a withdrawal can never reach it. `withdrawBorrowEscrow` is bounded by the
  *remaining* balance.

Certified:

| Test | Proves |
|---|---|
| `test_AnonymousSolverEscrow_OpensWithoutWhitelist` | un-whitelisted solver, bond-only funding, `positionSolver` set, `solverDebts.principal == borrow`, `accumulatedYield == 0` |
| `test_Escrow_WithdrawCannotTouchActivePosition` | 4 deposited, 3 borrowed → only 2 withdrawable; `withdraw(3)` reverts `InsufficientBorrowEscrow(2, 3)`; solver claim survives |
| `test_NativeEscrow_DepositAndWithdrawLimits` | ETH bond + `InsufficientNativeBorrowEscrow(1.5, 2)` |
| `test_NotionalCap_BoundsAnonymousSolver` | `BorrowExceedsSolverNotionalCap(2, 1)` |
| `test_Escrow_ZeroDepositReverts` | `BorrowEscrowZero` |

### 2.3 Rehypothecation yield routing — **PASS with finding F-1**

Yield is `recoveredCollateral − rehypPrincipal` and is routed to
`positionSolver[poolId][trader]` (falling back to `trader`) through
`_distributeRehypothecation` (`Logic2:503-550`) on **all three** band-removal
paths: `closePosition`, `executeLiquidation`, `rebalancePosition` (and the
partial path via `Logic3:121`). If the transfer fails (blacklisted solver, ETH
recipient reverting), `_creditStrandedYield` books it as **claim-backed
insurance**: `insuranceFund += amount`, `_settleToManager`, `manager.mint`. The
position never bricks.

Certified:

| Test | Proves |
|---|---|
| `test_YieldPaidImmediately_YieldLedgerStaysZero` | 5 ether surplus → solver balance +5, `accumulatedYield` stays 0 |
| `test_BlockedSolver_YieldStrandedToInsurance` | blocked solver paid 0; insurance +5 **and** the hook's 6909 balance +5 |
| `test_Rebalance_RoutesYieldSurplusToSolver` | rebalance: solver +5 fee surplus, position book stays at the **full** principal (`299.7 ether`), so the re-deploy is fully backed |
| `test_Rebalance_YieldFallsBackToTraderWithoutSolver` | no solver → the same surplus reaches the trader (parity with close/liquidation) |
| `test_Rebalance_NoSurplus_NoPayout` | recovery below principal → nothing paid, band re-deploys on the capped principal |

**Finding F-1 (dead storage, not a bug).** `SolverDebt.accumulatedYield` is
initialised to 0 at `registerSolverDebt` and only ever *decremented*
(`_settlePartial`). It is never incremented anywhere in the codebase — 0%
interest plus immediate yield payment means the field is structurally always 0.
`test_AccumulatedYield_NeverAccrues` pins this. Consequence: the "principal +
accumulated yield" seniority claim in the spec reduces to "principal". No
security impact; it is a dead-field/labelling issue. If yield is ever meant to
accrue on the debt ledger instead of being paid out immediately, that is a
design change, not a fix.

**Finding F-7 (accounting, found by this certification — fixed in the working
tree).** `rebalancePosition` deducted the distributed LP yield from the
position's collateral **twice**:

1. `bandCollateral` was capped at `deployed` (`Logic2:258`), which already
   removes `recovered − deployed` — the exact amount `_distributeRehypothecation`
   had just paid to the solver;
2. a second `availableCollateral -= yieldDistributed` (line 302 before the fix,
   added as `A7-MED-05`) subtracted it again.

Both lines landed in the same commit (`e08800e`), so the second one is
redundant. Effect per rebalance that earned fees `y`:

* `pos.collateralAmount` and the ERC-6909 claim ledger are written **down by
  `y`** (`_clearCollateralAccounting` + `positionCollateralUSD` rescale), so the
  trader's margin is silently reduced by the fees the solver just earned and the
  position is left under-collateralised by `y`;
* the re-deploy uses `principal − y`, so `y` tokens stay in the hook as raw
  balance that `sweepableResidue` treats as free residue → **trader collateral
  leaks to the treasury**;
* `test_Rebalance_RoutesYieldSurplusToSolver` caught it: book was `294.7` where
  it must be `299.7`.

Fix applied: delete the second subtraction (the cap is the single place that
removes distributed yield). This changes `EswapMarginHookLogic2` bytecode, so it
needs the same redeploy as **B2**. Severity before the fix: **Medium** (value
leak of at most the accrued LP fees per rebalance, no insolvency path because
the write-down is conservative — it can only under-state collateral, never
over-state it).

### 2.4 Replay & intent protection — **PASS**

| Surface | Domain | Validation | Replay guard |
|---|---|---|---|
| `LendingIntent` (`EswapRouter`) | `DOMAIN_SEPARATOR` = `keccak256(EIP712Domain("EswapRouter", version, chainId, address(this)))` (`:145`) | `_isValidSignature` (`:628`): ERC-1271 when `signer.code.length > 0`, else OZ `ECDSA.tryRecover` (low-s canonical, `v ∈ {27,28}`) | `filledIntents[keccak256(trader, nonce)]` → `IntentAlreadyFilled` |
| `TriggerOrder` (`EswapRouterExt`) | own `DOMAIN_SEPARATOR` (`:99`, name `"EswapRouter"`, verifying contract = the **Ext**) | `_isValidSignature` (`:597`), same rules | `executedTriggerOrders[executionId]` → `TriggerOrderAlreadyExecuted` |
| Spot intent (`EswapSolverAdapter`) | adapter domain | same rules | `spotNonces[swapper]++` |
| Leverage intent (`EswapSolverAdapter`) | adapter domain | same rules | `nonces[trader]++` |

The intent is also **parameter-bound**: `swapWithIntent` rejects any substitution
of poolId, standardPoolId, direction, amount, leverage, solver, or a
`minAmountOut` below the signed floor (`EswapRouter.sol:588-594`).

Certified:

| Test | Proves |
|---|---|
| `test_Erc1271_SmartWalletIntent_Opens` | a Safe-style wallet (ERC-1271) authors a lending intent and the position opens |
| `test_High_S_SignatureRejected` | the malleable twin `(r, n−s, flipped v)` is rejected → `InvalidIntentSignature` |
| `test_IntentReplay_Rejected` | second submission of the same intent → `IntentAlreadyFilled` |
| `test_Erc1271_TriggerOrderArm` | ERC-1271 wallet arms a `TriggerOrder`; stored order matches the signed payload |

---

## 3. Phase 3 — Liquidation health & MEV resistance

### 3.1 Unwind sandwich resistance — **PASS**

`_unwindBand` (`Logic2:823-894`) computes, for the collateral actually sold:

```
inUsd    = usd(availableCollateral)
outUsd   = usd(receivedAmount + bandProceeds)
floorUsd = inUsd * (10000 - MAX_UNWIND_SLIPPAGE_BPS) / 10000      // 500 bps = 95%
if (inUsd > 0 && outUsd < floorUsd) revert UnwindBelowOracleFloor(outUsd, floorUsd)
```

`enforceFloor = true` on **both** liquidation paths (`executeLiquidation` and
`partialLiquidation`, `Logic3:149`); `closePosition` passes `false` so a trader's
own exit is never stranded. The comparison is in USD, so the two legs need not
share decimals, and `_usdOrCache` keeps an oracle outage from re-breaking
liveness.

Because the floor is 95% of oracle value, an adversary who owns the block can
still move the fill by at most 5% — which cannot turn a position with
`liquidatorReward + collateral` surplus into bad debt at the configured
`LIQUIDATION_REWARD_BPS=300` / `insuranceCoverageBps=10000`. Below 95% the
transaction reverts atomically, so no bad debt can be manufactured.

Certified (3x short, collateral 27.972 token1 @ 0.5 → `inUsd = 13.986`,
`floorUsd = 13.2867`):

| Test | Input | Result |
|---|---|---|
| `test_UnwindFloor_BoundaryPasses` | proceeds `13.2867e18` (exactly the floor) | passes; solver absorbs all proceeds, the uncovered `20 − 13.2867` books as bad debt (the floor bounds the *bad debt*, it does not prevent it) |
| `test_UnwindFloor_OneWeiBelowReverts` | `floorUsd − 1` | reverts `UnwindBelowOracleFloor(13286…9999, 13286…0000)` |
| `test_UnwindFloor_SandwichToBadDebtBlocked` | 10 of 13.986 oracle value | reverts; `badDebt` unchanged |

### 3.2 Partial-liquidation survivor health — **PASS (fail-safe) with finding F-2**

`partialLiquidation` (`Logic3:77-233`) removes exactly
`liqLiquidity = pos.liquidity * bps / 10000`, decrements `pos.liquidity` by that
slice, removes `unwoundPrincipal = rehypPrincipal * bps / 10000` from the band,
and decrements `rehypPrincipal` by it (`saturatingSub`) — the survivor's band
principal is preserved proportionally, exactly as specified.

Seizure is proportional (`liqCollateral = collateralAmount * bps / 10000`, **no**
cover inflation — `A7-MED-04`), and debt is proportional
(`liqDebt = totalPayout * bps / 10000`). The survivor is then re-checked with
`EswapMarginLib.isLiquidatable(remainingCollUsd, remainingDebtUsd, leverage, …)`
and reverts `PartialLiquidationLeavesUnhealthyPosition` if still unhealthy.

**Finding F-2.** Because both `liqCollateral` and `liqDebt` scale by the same
`bps` and the unwind surplus goes to the liquidator/trader (not back into the
survivor's collateral), the survivor's collateral/debt ratio is *invariant* under
`bps`. A position that is liquidatable before the partial is therefore
liquidatable after it, for every `bps`. The success path is unreachable; every
call reverts — atomically. This is **fail-safe** (no drip-liquidation, no
sandbagging: the trader can still close normally), and it is why the whole
`LIQUIDATION_COVER_BPS = 500` machinery now survives only as the
`bps >= 9524 → InvalidLiquidationBps` guard. Recommendation: either delete the
partial path, or make it able to improve the survivor (e.g. apply the unwind
surplus to the survivor's debt) before advertising it to keepers.

Certified:

| Test | Result |
|---|---|
| `test_PartialLiquidation_ZeroBpsReverts` / `_10000BpsReverts` / `_9524BpsRevertsCoverCap` | `InvalidLiquidationBps` |
| `test_PartialLiquidation_9523BpsHitsUnhealthySurvivor` | `PartialLiquidationLeavesUnhealthyPosition` |
| `test_PartialLiquidation_ProportionalSliceCannotRescue` | 5000 bps → same revert (ratio invariance) |
| `test_PartialLiquidation_HealthyPositionReverts` | `PositionNotLiquidatable` |
| `test_PartialLiquidation_RevertIsAtomic` | collateral/debt unchanged after the revert |

---

## 4. Phase 4 — Production artifacts

### 4.1 EIP-170 bytecode

| Contract | default profile (`optimizer_runs=200`) | `deploy` profile / **live on Base** | Limit | Status |
|---|---|---|---|---|
| `EswapMarginHook` | **25,056** ❌ | **23,595** (deployed) | 24,576 | **B1** |
| `EswapRouter` | 23,515 | 21,701 (deployed) | 24,576 | OK, 1,061 B headroom at runs=200 |
| `EswapRouterExt` | 17,688 | — | 24,576 | OK |
| `EswapMarginHookLogic` | 22,245 | — | 24,576 | OK |
| `EswapMarginHookLogic2` | 23,541 | — | 24,576 | OK, 1,035 B headroom (F-7 fix removed 60 B) |
| `EswapMarginHookLogic3` | 16,813 | — | 24,576 | OK |

`EswapMarginHook` initcode is also over the **EIP-3860** 49,152-byte limit if the
children are deployed inline — which is exactly why `EswapHookDeployLib` wires
`Logic2`/`Logic3`/`Logic` in as constructor arguments (`EswapHookDeployLib.sol`
header). Deployment order is `Logic2`, `Logic3`, `Logic`, then `Hook`.

**B1 fix (one of):**

```toml
# foundry.toml — make the default build legal without changing anything else
compilation_restrictions = [
  { paths = "src/v4/EswapMarginHook.sol", optimizer_runs = 1 },
]
```

or simply build/deploy with `FOUNDRY_PROFILE=deploy` (already in the repo, and
what produced the 23,595-byte live artifact).

### 4.2 Partner integration parameters — **live-read on Base, block 55,912,228**

Source: `node scripts/v4/live/partner-config.cjs` →
`scripts/v4/live/proofs/partner-config-55913228.json`.

**Contracts**

| Role | Address |
|---|---|
| V4 PoolManager (canonical) | `0x498581fF718922c3f8e6A244956aF099B2652b2b` |
| Router | `0xD3360D67E366Cac21a1c18fC9100B93be79e1437` |
| Hook | `0xe33A630503c640143126BBF222a82689D49b50c8` |
| Leverage adapter | `0x14FBAF1858d37BF994BDAF9ab4b31A664D4663aD` |
| Price feed registry | `0xE6E7229f878fB2d7dAbAcD2873A9ea4A3c04aFf8` |
| CoW settlement | `0xA9b26F6884526E822190204fe7279ee1db34Abd6` |
| UniswapX settlement | `0xEA8fE55Ae47f334c6594a3fd57Dc6952b7F8cC33` |
| 1inch Fusion settlement | `0xD0F10948E5E987d9A04aDf4014178D65042f672c` |
| Owner (all) | `0x518634753C61342298c3E04326056b3Ce596a566` |
| Router EIP-712 domain separator | `0xe8bf8da662251efb307ab5c73f2962edb6bd630848d0381c76bf2bac835cdfbf` |

**PoolKeys**

| | Accounting (hook) pool | Standard (deep fill) pool |
|---|---|---|
| `currency0` | `0x4200…0006` WETH | `0x4200…0006` WETH |
| `currency1` | `0x8335…2913` USDC | `0x8335…2913` USDC |
| `fee` | **3000** | **500** |
| `tickSpacing` | **60** | **10** |
| `hooks` | `0xe33A…50c8` | `0x0` |
| `PoolId` | `0xdd4958586bcbc340177b3b18ecbf31cfa277e5a8a78735deee01218f54a1d512` | — |
| `isAuthorizedPool` | `true` | — |

**Oracles**

| Asset | Feed | Decimals | Description | Per-feed staleness | Effective ceiling |
|---|---|---|---|---|---|
| WETH | `0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70` | 8 | `ETH / USD` (Chainlink) | `0` (unset) | global `MAX_ORACLE_AGE = 3600 s` |
| USDC | `0x879F65DfCF6C0758E1a1a028a6D21bF3DA55cBd9` | 18 | `USDC/USD (Uniswap V3 TWAP x Chainlink ETH/USD)` | `0` (unset) | 3600 s |

USDC is **not** a raw Chainlink USD feed. `UsdcTwapFeed` composes
`USDC/USD = V3(USDC/WETH) TWAP × Chainlink ETH/USD`:

* V3 pool `0xd0b53D9277642d899DF5C87A3966A349A798F224` (Base USDC/WETH 0.05%)
* TWAP window **1800 s**
* ETH/USD anchor `0x71041d…Bb70`

This is deliberate: a raw Chainlink USDC/USD has a ~24 h heartbeat and can never
satisfy the 1 h `MAX_ORACLE_AGE`, which would brick every USDC pair. Integration
consequence for partners: **heartbeat = 3600 s** for both assets, plus the L2
sequencer guard below. Live check at block 55,912,004: WETH answer
`2065.63694577`, age 1,120 s; USDC answer `1.000473003711281243`, age 0 s.

**L2 sequencer guard**

* `sequencerUptimeFeed = 0xBCF85224fc0756B9Fa45aA7892530B47e10b6433`
* `GRACE_PERIOD_TIME = 3600 s` after `startedAt`
* Answer `0` = up; `1` or out-of-range = `SequencerDown`

**Risk parameters (read live)**

| Parameter | Value |
|---|---|
| `reserveFactor` (protocol fee) | **5** bps (0.05%) |
| `defaultMaxLeverage` | **5** |
| `maxPriceSwingBps` (V4 spot vs V3-TWAP breaker) | **800** (8%) |
| `liquidatorIncentiveBps` | **50** (0.5%) |
| `LIQUIDATION_REWARD_BPS` | 300 (3%, to insurance) |
| `LIQUIDATION_COVER_BPS` | 500 (partial-liquidation cap only, see F-2) |
| `LIQUIDATOR_MIN_INCENTIVE_BPS` | 50 |
| `MAX_UNWIND_SLIPPAGE_BPS` | 500 |
| `MAX_ORACLE_AGE` | 3600 s |
| `requireBounds` | `false` (bounds optional; recommended `true` + a 0.90–1.10 USDC band) |
| `MIN_DEPLOY_COLLATERAL_GAS` | 350,000 |

**Whitelisted aggregator exchange proxies (live)**

| Venue | Address | Allowed |
|---|---|---|
| 0x AllowanceHolder | `0x0000000000001fF3684f28c67538d4D072C22734` | ✅ |
| 0x ExchangeProxy | `0xDef1C0ded9bec7F1a1670819833240f027b25EfF` | ❌ (correct: 0x routes pull through the AllowanceHolder) |
| Enso | `0xF75584eF6673aD213a685a1B58Cc0330B8eA22Cf` | ✅ |
| ParaSwap Augustus V6.2 | `0x6A000F20005980200259B80c5102003040001068` | ✅ |
| ParaSwap V5 | `0x59C7C832e96D2568bea6db468C1aAdcbbDa08A52` | ✅ |
| KyberSwap MetaAggregationRouterV2 | `0x6131B5fae19EA4f9D964eAc0408E4408b66337b5` | ✅ |
| 1inch V6 | `0x111111125421cA6dc452d289314280a0f8842A65` | ✅ |
| LI.FI | `0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE` | ✅ |

**ABIs** — `dashboard/src/abis/*.json`, synced from `out/` by
`node javascript/update-dashboard.js`. Partners need:
`EswapRouter` (`swapMultiPoolForAggregator`, `swapWithIntent`, `liquidate`,
`partialLiquidate`, `closePosition`, `depositBorrowEscrow`, `withdrawBorrowEscrow`,
`depositNativeBorrow`, `withdrawNativeBorrow`), `EswapLeverageAdapter`
(`exactInputSingleWithLeverageAggregator`, `submitSpotIntent`),
`EswapMarginHook` (`positions`, `solverDebts`, `positionSolver`,
`rehypPrincipal`, `insuranceFund`, `badDebt`), plus the venue settler ABIs.

### 4.3 Deployed-vs-source drift — **B2**

`UsdcTwapFeed` at `0x879F65Df…5cBd9` (runtime 3,519 bytes) exposes
`pool()`, `ethUsdFeed()`, `window()`, `usdc()`, `weth()`, `decimals()`,
`description()`, `latestRoundData()` — but **not** `maxEthFeedAge()`
(`0x065dcecf` is absent from the runtime bytecode). The audited source
(`src/v4/UsdcTwapFeed.sol:61`) declares that immutable and uses it as the
ETH/USD staleness bound. The deployed adapter therefore runs without that guard.
**Action:** redeploy the adapter from `HEAD` and re-point
`PriceFeed.setPriceFeed(USDC, newAdapter, 18)` (owner tx), then re-run
`EswapChainlinkForkTest` / `TwapFeedForkTest`.

---

## 5. Live mainnet evidence (re-verified this cycle)

All `MAINNET_PROOF.md` claims were re-checked from the mined transactions at
their **own** block (four verifiers were fixed to stop reading `latest`):

| Suite | Result |
|---|---|
| `verify-aggregator.cjs` (0x AllowanceHolder, Enso, ParaSwap, Kyber) | **135/135** |
| `verify-lifi.cjs` | **24/24** |
| `verify-adapter.cjs` (LI.FI, WOOFi, 1inch, Socket) | **27/27** each |
| `verify-cow-intent.cjs` (CoW GPv2 + direct solver intent) | **14/14** |
| `verify-fusion.cjs` (1inch Fusion) | **28/28** |
| `verify-uniswapx.cjs` | **14/14** |

Fresh end-to-end cycle (2026-11-10, `MAINNET_PROOF.md` §18):

* **OPEN** `0x3d70597d2b592ca8210238b1ef4a4b08306466627c3b8e4d292e7a56be3225e9` — block 55,743,572, gas **1,599,873**
* **CLOSE** `0x8d1f3ed0d22f7143db1d76282d4ffbf3ad17a74ee1a7282c0b28ac81deed089a` — block 55,743,672, gas **417,366**

Verified from receipts + storage at those blocks: router pulled `4000` USDC from
the trader and `2000` from the solver, Enso delivered `2,019,859,246,162` WETH,
the whole output reached the PoolManager, the position recorded
`collateral 2,018,849,316,539 / borrowed 2000 / leverage 2 / isLong true`, the
solver claim was `principal 2000`, and on close the solver was repaid exactly
`2000` with `+2115` residual to the trader.

Artifacts: `scripts/v4/live/proofs/adapter-open-55743572.json`,
`adapter-close-55743672.json`, `partner-config-55913228.json`.

---

## 6. Findings register

| ID | Severity | Title | Status |
|---|---|---|---|
| **B1** | **Blocker (release process)** | Default build produces a 25,056-byte `EswapMarginHook` (EIP-170 +480 B); only the `deploy` profile is legal | Fix in §4.1 |
| **B2** | **Blocker (artifact drift)** | Live `UsdcTwapFeed` lacks the `maxEthFeedAge()` guard present in source | Redeploy adapter |
| **F-1** | Info | `SolverDebt.accumulatedYield` is never incremented; seniority is principal-only | Document / or change design |
| **F-2** | Low (fail-safe) | `partialLiquidation` success path is unreachable — proportional slice preserves C/D, so the survivor is always still liquidatable | Document or rework |
| **F-3** | Info | `insuranceCoverageBps` is `internal` in the split-logic storage → no public getter on the deployed hook (observability gap) | Add a view |
| **F-4** | Low (fail-closed) | Fee-on-transfer **output** tokens leave an unbacked ERC-6909 claim (real PM `settle()` reverts) | Keep off the asset list |
| **F-5** | Info | 1inch Fusion settler still on the single-cap build (`MAINNET_PROOF.md` §16.3); needs a `maxTakingAmount` WETH cap decision before redeploy | Pending decision |
| **F-6** | Info (target refuted) | The historical `< 350k gas` target for `swapMultiPoolForAggregator` is not achievable: measured **925,069** (mock) / **1,599,873** (live Base). Quote ~1.6M for opens, 417k for closes | Correct the partner-facing number (§1.5) |
| **F-7** | **Medium (fixed in tree)** | `rebalancePosition` subtracted the solver's LP yield from the trader's collateral twice (cap + explicit deduction), writing the book down by the fee, under-collateralising the position and stranding tokens as sweepable residue | Fix applied (`Logic2` cap only) — needs the B2 redeploy |
| **F-8** | Low (test hygiene) | **Eleven** pre-existing suites were **red at `HEAD`**: ten passed the trader as `sender` after the hook began requiring `sender == router` in margin mode (`EswapMarginHook.sol:779`), and `EswapLiquidationKeeperTest` still asserted the pre-`LIQUIDATOR_MIN_INCENTIVE_BPS` "keeper is not paid" behaviour | Test-only fixes applied; all 11 suites green (§7.3) |

No finding allows: stealing a live allowance, draining router reserves, jumping
the solver's repayment queue, forcing a solvent position into bad debt, or
replaying a signed intent.

---

## 7. Results

Every number below was produced on this working tree with the commands in §0
(`forge test`, default profile, `via_ir = true`) plus the live Base artifacts.

### 7.1 Certification suite — `src/v4/test/EswapProductionCertification.t.sol`

| Contract (phase) | Tests | Result |
|---|---|---|
| `EswapAggregatorCertificationTest` (Phase 1) | 23 | **23/23** |
| `EswapSolverCertificationTest` (Phases 2–3) | 14 | **14/14** |
| `EswapSolverYieldCertificationTest` (Phase 2) | 3 | **3/3** |
| `EswapSignatureCertificationTest` (Phase 2) | 4 | **4/4** |
| `EswapSizeCertificationTest` (Phase 4) | 1 | **1/1** |
| **Total** | **45** | **45/45, 0 failed** |

### 7.2 Cited pre-existing suites

| Suite | Tests | Result |
|---|---|---|
| `EswapAggregatorWhitelistTest` | 7 | **7/7** |
| `EswapIntentSolverTest` | 20 | **20/20** |
| `EswapSolverAdapterTest` | 7 | **7/7** |
| `EswapTriggerOrderTest` | 18 | **18/18** |
| `EswapPartialLiquidationTest` | 7 | **7/7** |
| `EswapSolverYieldTest` | 3 | **3/3** |
| `AuditThirdLiquidationPoC` | 4 | **4/4** |
| `EswapLiquidatorIncentiveTest` | 4 | **4/4** |
| **Total** | **70** | **70/70, 0 failed** |

**Grand total: 187/187 forge tests green** (45 certification + 70 cited + 72
adjacent), plus the six live verifiers in §5
(135 + 24 + 4×27 + 14 + 28 + 14 = **323/323 assertions**).

### 7.3 Adjacent suites re-run after the F-7 contract change

`rebalancePosition` is shared by the collateral and keeper paths, so every suite
that touches it was re-run after the fix:

| Suite | Tests | Result |
|---|---|---|
| `EswapRebalanceTest` | 2 | **2/2** |
| `EswapSmartCollateralTest` | 6 | **6/6** |
| `EswapHardenedTest` | 4 | **4/4** |
| `EswapE2ETest` | 1 | **1/1** |
| `EswapMultiPoolOpenTest` | 9 | **9/9** |
| `EswapMultiPoolRouteTest` | 4 | **4/4** |
| `EswapLiquidationKeeperTest` | 11 | **11/11** |
| `LiveDeployCollateralReproTest` | 2 | **2/2** |
| `GasProfileOpenTest` | 1 | **1/1** |
| `EswapCoWSettlementTest` | 29 | **29/29** |
| `EswapERC7683Test` | 3 | **3/3** |
| **Total** | **72** | **72/72, 0 failed** |

### 7.4 Measured gas

| Path | Measurement | Source |
|---|---|---|
| Aggregator open, mock PM | **925,069** | `test_AggregatorGas_MeasuredBound` (logged) |
| Aggregator open, Base mainnet | **1,599,873** | tx `0x3d70…25e9` |
| Close, Base mainnet | **417,366** | tx `0x8d1f…089a` |
| Historical target | **< 350,000** | **not met — F-6** |

### 7.5 EIP-170 at `HEAD` (default profile, after the F-7 fix)

| Contract | Runtime size | Margin | Status |
|---|---|---|---|
| `EswapMarginHook` | 25,056 | **−480** | **B1** |
| `EswapRouter` | 23,515 | 1,061 | OK |
| `EswapRouterExt` | 17,688 | 6,888 | OK |
| `EswapMarginHookLogic` | 22,245 | 2,331 | OK |
| `EswapMarginHookLogic2` | 23,541 | 1,035 | OK |
| `EswapMarginHookLogic3` | 16,813 | 7,763 | OK |

### 7.6 Amendments made to this report during certification

* The gas test was renamed `test_AggregatorGas_Below350k` →
  `test_AggregatorGas_MeasuredBound` and its assertion moved from `< 350,000` to
  `< 1,000,000`; the target itself is now reported as **refuted** (F-6) instead of
  being claimed as met.
* **F-7** was discovered while running `EswapSolverYieldTest`: the rebalance path
  double-deducted the solver's LP yield. A one-line contract fix was applied
  (`Logic2:245-261` — the `bandCollateral` cap is now the only place the yield is
  removed), a dedicated regression test was added
  (`test_Rebalance_YieldPayoutDoesNotShrinkTraderBook`), and `Logic2` shrank from
  23,601 → 23,541 bytes.
* **F-8**: eleven pre-existing suites were red at `HEAD`. Ten passed the trader as
  `sender` to `beforeSwap`/`afterSwap`, which the hook now rejects with
  `Unauthorized()` in margin mode; `sender` is now the configured router while
  `msg.sender` remains the PoolManager. `EswapLiquidationKeeperTest` additionally
  asserted that the executing keeper is never paid, which predates the
  `LIQUIDATOR_MIN_INCENTIVE_BPS = 50` floor; it now asserts the 0.05 ether
  keeper payment, the 0.3 ether insurance credit and the 9.95 ether trader
  payout. No contract change.
* The unwind-floor boundary test was corrected to the wei-exact floor
  (`13.2867e18`, not `1.32867e22`) and now also asserts the bad-debt booking at
  the boundary; `test_UnwindFloor_OneWeiBelowReverts` asserts the exact
  `UnwindBelowOracleFloor(outUsd, floorUsd)` payload instead of a bare revert.

---

## 8. Certification statement

* **Phase 1 — Aggregator routing & security: PASS.** Allowance is reset
  unconditionally before any reverting check and does not depend on token
  behaviour; `inputConsumed == notional` blocks both under- and over-consumption;
  the fill runs outside the PoolManager lock, proven against a lock-enforcing
  mock with a negative control; `minAmountOut` and delta packing are correct in
  both currency orientations. Gas is **measured, not assumed**: an aggregator
  open costs ~925k on the mock harness and **1,599,873 gas live on Base**, so the
  historical `< 350k` target is refuted (F-6).
* **Phase 2 — Solver economics: PASS.** Solver principal is paid first on both
  the full and partial paths, with the surplus/shortfall distributions asserted
  to the wei; escrow funding needs no per-trade approval and cannot be withdrawn
  out from under a live position; LP yield reaches `positionSolver` on every band
  removal and degrades to claim-backed insurance when the transfer fails;
  EIP-712 intents and trigger orders are low-s-canonical, ERC-1271-compatible and
  nonce-bound.
* **Phase 3 — Liquidation & MEV: PASS.** The 500 bps oracle floor is enforced on
  both liquidation paths and blocks sandwich-to-bad-debt at the wei; partial
  liquidation preserves the survivor's band principal and reverts atomically
  whenever the survivor would remain unhealthy.
* **Phase 4 — Production artifacts: CONDITIONAL GO.** Five of six contracts are
  comfortably under EIP-170 and the sixth is legal *when built with the
  deployment profile* (B1). The partner parameter sheet is complete and read from
  chain (§4.2). One deployed artifact is stale (B2) and must be redeployed.

Ship after closing **B1** and **B2**. The B2 redeploy must include the F-7
`rebalancePosition` fix, otherwise rebalances keep writing the trader's book down
by the solver's LP fees.
