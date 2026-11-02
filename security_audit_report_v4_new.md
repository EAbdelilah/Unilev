# New Findings — Eswap Margin V4 (Post-Audit Red-Team Pass)

**Target:** `src/v4/` (HEAD `e14e0fb`, post F-01..F-08 remediation)
**Method:** Manual adversarial review of the *new* surfaces introduced after the third audit:
partial liquidation (`EswapMarginHookLogic3`), yield-bearing insurance staking (`insuranceStake`/`insuranceUnstake`),
protocol residue sweep, aggregator best-route, intent opens, and the settlement repayment accounting.
V1–V5 / NEW-A..D / F-01..F-08 are assumed fixed and out of scope.

---

## N-01 — Yield distribution failure credits `insuranceFund` without minting a claim (Medium)

**Location:** `EswapMarginHookLogic2._distributeRehypothecation` (~504-524) and the
duplicate in `EswapMarginHookLogic3._distributeRehypothecation` (~560-582).

**Description:** When the LP band is removed, the accrued yield (collateral beyond the
deployed principal) is pushed to `recipient` (the solver) via a raw transfer. On a
reverting / failing transfer the code does

```solidity
insuranceFund[collateralCurrency] += uint256(yieldAmount);
```

but never settles that value into the PoolManager nor mints the backing ERC-6909 claim
(the way `_settle` does with `_settleToManager` + `manager.mint` for the liquidation
reward, and `seedInsuranceFund` does for deposits).

Consequence: `insuranceFund` is incremented while the physical tokens stay in the hook's
wallet as raw ERC20 (not as PM claims) and `insuranceStaked`/`totalCollateral` are
untouched. Later insurance coverage (`_settle`/`_settlePartial`) calls
`_burnableClaims` → `manager.balanceOf(...)`, which does **not** include these
stranded tokens, so the fund's claim-backed capacity is overstated on the ledger but
understated on-chain: shortfalls that should have been absorbable book `badDebt`
instead, and `sweepableResidue` over-reserves the stranded amount.

**Fix:** on a failed yield push, either (a) settle the yield into the PM and mint the
claim before crediting `insuranceFund` (mirroring the reward path), or (b) leave
`insuranceFund` unchanged and credit a separate `strandedYield` bucket that
`sweepableResidue` excludes until reconciled.

---

## N-02 — Partial-liquidation health gate values the book, not the real holdings (Medium)

**Location:** `EswapMarginHookLogic3.partialLiquidation`, surviving-position check
(~169-177).

**Description:** After unwinding, the gate rejects the partial liquidation only if the
*surviving* position would still be liquidatable:

```solidity
uint256 remainingCollateral = collateralAmount - unwindAmount;
uint256 remainingDebt = borrowedAmount > liqDebt ? borrowedAmount - liqDebt : 0;
if (EswapMarginLib.isLiquidatable(remCollUsd, remDebtUsd, pos.leverage, ...)) revert ...;
```

`remainingCollateral` is the **book** `collateralAmount`, not the value of what the
hook actually holds. When the position's band has already converted collateral into
the debt currency (F-06 territory), the book overstates the surviving collateral, so a
partial liquidation that leaves the position genuinely underwater can pass the gate.
Because `liqDebt` is reduced by the insurance/band proceeds while `collateralAmount`
is only reduced by `unwindAmount` (which is capped at `liqCollateral` and can round to
0 for small `liquidationBps`), the position can exit the liquidation with reduced debt
but an unchanged collateral book — a value leak that the gate cannot see.

**Fix:** mirror `_actualValue` (Logic2) in the gate: value the surviving position's
retained collateral plus the live LP band at the current slot0, in USD, exactly as
`isLiquidatable` does after the F-06 fix.

---

## N-03 — `claimPayout` does not honour `payoutRedirect` (Low)

**Location:** `EswapMarginHookLogic.claimPayout` (~405-411) vs.
`EswapMarginHookLogic.setPayoutRedirect` (~420-423) and `_payOrCredit` (~707-730).

**Description:** `_payOrCredit` routes a failed transfer to `payoutRedirect[to]` when
set, and the `setPayoutRedirect` docstring states that "Already-credited balances
follow the redirect too". `claimPayout`, however, always transfers to `msg.sender`
and never consults `payoutRedirect[msg.sender]`. A user who redirected payouts to a
clean address (e.g. after being blacklisted) still has to pull to the original,
possibly-blacklisted, address — defeating the purpose of the redirect for already-
credited balances.

**Fix:** in `claimPayout`, resolve `dest = payoutRedirect[msg.sender]` (fallback to
`msg.sender`) and transfer to `dest`.

---

## N-04 — Dust claim hack in `EswapSettlement.claimRepayment` (Low)

**Location:** `EswapSettlement.claimRepayment` (~307-312).

**Description:**

```solidity
if (amount == 0 && paid == 0) amount = 1;
```

A filler whose pro-rata share rounds to zero is allowed to claim 1 unit on the first
claim. With many small orders (or many dust orders created by an attacker who is also
a filler), this can siphon up to `number_of_orders` units from the shared repayment
pot, slightly diluting honest fillers. The cap `if (amount > available) amount = available;`
bounds a single claim, but the loop across orders is unbounded in gas.

**Fix:** remove the dust hack, or gate it on a minimum claimable threshold and a
per-transaction order cap.

---

## N-05 — Solver-funded opens credit arbitrary `trader` with the funder's capital (Medium)

**Location:** `EswapRouter.swapMultiPoolForSolverFunded` (~446-465) and
`_multiPoolOpen` (`marginFunder` path).

**Description:** The gate only requires `msg.sender == marginFunder`. `trader` is
caller-supplied and unrestricted, so a margin funder can open a position credited to
an arbitrary recipient. The recipient then owns the ERC-6909 collateral claim and can
close/withdraw it, while the funder's margin and the solver's borrow back the
position. This is the intended CoW flow when the funder is a settlement contract, but
for a direct caller it lets an attacker spend their own capital to grant a victim a
free, at-the-money (or better) position — a griefing / free-option vector, and a
confused-deputy risk if any whitelisted contract exposes this entrypoint.

**Fix:** require `trader == marginFunder` unless `msg.sender` is a governance-
whitelisted settlement/relay contract (a separate `settlementWhitelist`), mirroring
the `executorWhitelist` moat used by `swapFor`.

---

## Summary

| # | Severity | Surface |
|---|----------|---------|
| N-01 | Medium | Insurance yield accounting on failed transfer |
| N-02 | Medium | Partial-liquidation health gate (stale book) |
| N-03 | Low    | `claimPayout` ignores redirect |
| N-04 | Low    | Dust-claim siphon in settlement |
| N-05 | Medium | Solver-funded open credits arbitrary trader |

No Critical fund-loss vector comparable to V1/V2 was found; the residual risk is
concentrated in the partial-liquidation and insurance-staking paths added after the
third audit, which have not yet been exercised by the real-PoolManager lifecycle
proofs (per the third audit's "Known follow-ups").
