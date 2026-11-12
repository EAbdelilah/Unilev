# Third Audit — Adversarial Economic & Multi-Block MEV

**Target:** Eswap Margin v4 (`src/v4/`)
**Scope of this pass:** economic exploitability only — transient-storage ordering, zero-carry free optionality / fee evasion, cross-protocol solver-debt desync, and multi-block griefing / insolvency (incl. USDC-blacklist style recipient failures).
**Explicitly out of scope (per brief):** syntax, basic reentrancy, access-control hygiene, SafeCast/overflow, gas micro-optimisation.
**Chain model:** Base L2, single sequencer, EIP-1153, Uniswap v4 hooks, CoW / UniswapX / 1inch-Fusion intents, aggregator `eth_call` routing.
**Commit:** `09ef1ae` (working tree contains pre-existing, uncommitted changes that were **not** modified).

Reproduction harness (new file, mock PoolManager, **no RPC / no fork**):

```
forge test --match-contract AuditThird -vv
# 3 tests, 3 passed
```

---

## 0. Executive summary

| # | Finding | Class | Severity | Status |
|---|---------|-------|----------|--------|
| F-01 | JIT spot RFQ lets the **swapper name the solver's payment**; the only bound (oracle floor) ships **disabled** | fee evasion / unilateral value transfer | **Critical** | PoC passes |
| F-02 | Whitelisted `EswapLeverageAdapter` allows **any caller to open a position against a victim's router allowance** (`recipient` is attacker-chosen) | MEV / forced trade | **High** | PoC passes |
| F-03 | Liquidation unwind is an **unbounded descending auction** (full-range price limit, caller-supplied floor, no oracle floor) | liquidation MEV | **High** | code-verified |
| F-04 | `EswapSettlement` repayment is **first-come-first-served over the aggregate balance** — a short-paid filler is made whole out of another filler's principal | cross-protocol debt desync | **High** | PoC passes |
| F-05 | **Oracle-liveness asymmetry**: exits need no oracle, liquidations revert on any feed fault → the protocol is frozen exactly when it must act | insolvency | **High** | code-verified |
| F-06 | `isLiquidatable` values a **stale book** (`pos.collateralAmount`) while the LP band has already converted to the debt currency → premature/incorrect liquidation | accounting drift | **Medium** | code-verified |
| F-07 | **Zero keeper incentive**: 3% reward is routed to the insurance fund and `liquidatorIncentiveBps` defaults to `0` → rational third parties never liquidate | liveness / insolvency | **Medium** | code-verified |
| F-08 | A blacklisted (or native-reverting) payout recipient **bricks close and the 100–105% liquidation band** → position is permanently stuck, solver principal unrecoverable | griefing / insolvency | **Medium** | code-verified |

**Retired premises from the brief** (falsified by the code, see §2): vector 1 (dirty transient state across bundles/txs) is structurally impossible; and the "solver overwrite / debt orphaning" form of vector 3 was already closed by `[AUDIT CRIT-ACT-04]`.

**The single economic headline:** the protocol charges **10 bps once** (`protocolFeeFor`) and then carries **unlimited, zero-carry tail risk** on a 5–20× position. At 20× the collateral cushion above par is **0.25 % of notional**; one 10 % gap produces bad debt ≈ **50× the entire fee** collected on that position. Every finding below is a way to accelerate, select, or socialise that loss.

---

## 1. Ground truth used by every finding

| Parameter | Value | Source |
|---|---|---|
| Protocol fee | `boughtAmount * protocolFeeFor(trader) / 10000`, **one-time on output**, default 10 bps | `EswapMarginHookLogic.sol:325-328` |
| Borrow interest | **none** (0 % carry) | design |
| Liquidation threshold | `12000 − 200×lev` bps, clamped to `10500` at ≥10× | `EswapMarginLib.sol:40-57` |
| Liquidation reward | 300 bps → **insurance fund**, never the caller | `EswapMarginHook.sol:281`, `Logic2.sol:519-537` |
| Keeper incentive | `liquidatorIncentiveBps`, **default 0** | `EswapMarginHook.sol:529`, `Logic2.sol:510` |
| Max leverage | `defaultMaxLeverage = 5`, per-pool override up to 20 | `Hook.sol:257,632,874` |
| Unwind price limit | full range (`MIN_SQRT_PRICE+1` / `MAX_SQRT_PRICE−1`) | `EswapMarginLib.sol:34-36` |
| Insurance coverage | `insuranceCoverageBps`, default 10000, **capped at actual fund balance and at burnable claims** | `Logic2.sol:473-496` |
| Transient margin slots | written `beforeSwap`, zeroed `afterSwap` | `Hook.sol:822-827`, `Logic2.sol:1071-1073` |

---

## 2. Premises the architecture falsifies (do not spend auditor time here)

### 2.1 Vector 1 — transient-storage / sequencer-ordering state leakage: **NOT POSSIBLE**

* `TRADER_BASE`, `BORROW_BASE`, `LEVERAGE_BASE` are per-trader transient slots (`Hook.sol:822-827`).
* Re-entry into a margin swap for the same trader is rejected: `if (traderKey.tload() != bytes32(0)) revert ReentrantSwap();` (`Hook.sol:823`), and a second live position is rejected by `PositionAlreadyOpen` (`Hook.sol:876`).
* The slots are explicitly cleared in `afterSwap` (`Logic2.sol:1071-1073`).
* EIP-1153 semantics already guarantee zeroing at end-of-transaction, so a **bundle** of sequential transactions cannot observe a previous transaction's residue. A reverted transaction rolls the writes back with the rest of the frame.

**Residual risk is not memory-safety, it is oracle timing** — see F-05.

### 2.2 Vector 3 (first form) — solver overwrite / orphaned `solverDebts`: **ALREADY CLOSED**

`registerSolverDebt` rejects a second, different solver for a live position (`Hook.sol:1331-1332`) and `_settle` deletes the ledger for exactly the recorded solver (`Logic2.sol:566`). The surviving desync is the **settlement-level** one — see F-04.

### 2.3 "JIT swaps pay the protocol fee": **false**

The JIT branch returns before any fee logic (`Hook.sol:791-807`) and never calls `registerMarginOpen`. JIT is **0 % protocol fee and 0 % LP fee**. This is what makes F-01 a pure transfer rather than a discounted trade.

---

## 3. Findings

### F-01 — JIT RFQ: the swapper sets the price it is paid at (Critical)

**Exploit Vector Name**
`EswapRouterExt.executeJITSpotSwap` — swapper-controlled `solverOutput` with the oracle floor disabled by default.

**Economic Threat Model & Assumptions**
- Attacker holds `jitApprovedSwappers[attacker] == true`. This is the whole trust boundary. In practice: a market-maker integration, a compromised approved swapper key, or a phishing-approved EOA.
- The solver is any `router.registeredSolvers(...)` address that keeps a standing router allowance (solvers must approve the router for the borrow-leg fallback at `Router.sol:839`, so a max-approval is the norm).
- No mempool racing, no capital, no price risk: **one transaction**.
- The "RFQ" has no signature. `solverOutput` and `minSolverOutput` are both supplied by the **caller** (`Ext.sol:441`), so `require(solverOutput >= minSolverOutput)` (`Ext.sol:816`) is a caller-checking-its-own-number. The only trustless bound is `_jitOracleMinOutput`, which returns 0 whenever `jitOracleFloorLeniencyBps == 0` (`Ext.sol:155-156`) — and `0` is the deployed default (`Ext.sol:122`, asserted in the PoC).

**Attack Trace**
1. Attacker calls `executeJITSpotSwap({key, zeroForOne: true, amountSpecified: −1e18, solver: victimSolver, solverOutput: 900e18, minSolverOutput: 0, swapper: attacker})`.
2. `executeJITSpotSwap` checks only `msg.sender == params.swapper` and `registeredSolvers[params.solver]` (`Ext.sol:450-451`).
3. `beforeSwap` returns a `beforeSwapDelta` that neutralises the AMM (`Hook.sol:796-806`), so there is **no pool price to anchor to**.
4. `_jitSpotCallback`: `minSolverOutput` passes trivially; `oracleMin == 0` so `if (oracleMin != 0 && ...)` is skipped (`Ext.sol:821-826`).
5. `IERC20(output).safeTransferFrom(victimSolver, manager, 900e18)` (`Ext.sol:862`) then `manager.take(output, attacker, 900e18)` (`Ext.sol:866`).
6. The attacker's 1 token0 is delivered to the solver (`Ext.sol:870`) — the solver is "paid" 1 token0 for 900 token1.

**Profitability Formula**

```
π = solverOutput − fairValue(amountIn)
  = S_out − (P_out/P_in)·S_in
```

with `S_in` free (attacker-chosen, 1 wei is enough) and `S_out` bounded only by the solver's allowance `A`:

```
π_max = A − ε ,     cost = gas ≈ 250k × L2 gas price ≈ $0.01
```

The protocol fee is not paid at all (JIT is fee-free), so the comparison is **not** `π > 0.10 %` — it is `π > gas`, i.e. *every wei above gas is profit*. Empirically: `π = 900 token1` for `1 token0`, on a position where the 10 bps fee would have been `0.0009 token1`.

**Architectural Mitigation** (preserves 0 % carry and aggregator compatibility)
1. **Ship the floor on.** `setJitOracleFloorLeniencyBps(200)` at deploy (≤ 2 %), and treat `0` as *revert* rather than *disable* (`Ext.sol:155-156`). A legitimate RFQ that beats the Chainlink mid by more than 2 % is a mispriced oracle, not a fill.
2. **Move price discovery to the solver.** `solverOutput` must be signed by `params.solver` over `(key, amountIn, swapper, nonce, deadline)`; the swapper may only *lower* its own `minSolverOutput`. This is the CoW/UniswapX pattern already used elsewhere in the repo.
3. **Per-fill solver cap.** `solverOutput ≤ oracleValue(amountIn) × (1 + maxSpreadBps)` plus a per-block `solverOutput` ceiling in the hook, so a compromised swapper key is a bounded loss.

---

### F-02 — Whitelisted adapter lets anyone spend a victim's router allowance (High)

**Exploit Vector Name**
`EswapLeverageAdapter.exactInputSingleWithLeverage(..., recipient)` — missing `msg.sender == recipient` gate on the executor-relay path.

**Economic Threat Model & Assumptions**
- The adapter is **executor-whitelisted on the live router**: `router.setExecutorWhitelist(adapter, true)` (`MAINNET_PROOF.md:39,60`; `scripts/fork-validate-full-cycle.ts:627`).
- The dashboard grants the router a standing `MaxUint256` allowance (documented behaviour).
- The adapter passes the caller-supplied `recipient` straight through as `trader` (`Adapter.sol:258-277`), and `_multiPoolOpen` pulls margin **from `trader`** (`Router.sol:810`).
- The router's `ExecutorUnauthorized` gate (`Router.sol:429-431`) is satisfied *by the adapter*, not by the attacker. This is precisely the bug class the team already fixed — twice — in the sibling entrypoints: `[AUDIT CRIT-4]`, `[AUDIT CRIT-4b]` (`Router.sol:451-461`) and `[AUDIT CRIT-4c]` (`Ext.sol:487-494`, "any address could force-open a position against a victim's router allowance"). The adapter was missed.
- No mempool race is needed: the attacker simply picks a `minAmountOut` of 0 and a leverage of their choice, so the forced trade is **already profitable to sandwich** before it is broadcast.

**Attack Trace**
1. Victim approves the router (`MaxUint256`) and stops trading. No pending order.
2. Attacker wraps the open in a sandwich on the same standard pool: buy collateral → force-open → sell collateral.
3. Attacker calls
   `adapter.exactInputSingleWithLeverage(tokenIn, tokenOut, fee, leverage = max, amountIn = k, minAmountOut = 0, recipient = victim)`.
4. `_resolveSolver(0, victim)` returns `defaultSolver` (no restriction, `Adapter.sol:135-137`), so the borrow leg is funded by a whitelisted solver and the gate passes.
5. `swapMultiPoolFor(params, victim)` → `safeTransferFrom(victim, manager, marginAmount)` (`Router.sol:810`) → the victim is debited, the position is credited to the victim with the **attacker's** leverage and the attacker's slippage floor of 0 (`Router.sol:780-781` passes because 0 ≤ anything).
6. The victim now owns a max-leverage position they never requested; the attacker closes the sandwich around the forced fill.

**Profitability Formula**

Let `N = k × leverage` be the forced notional, `R` the standard-pool quote depth, `f` the pool fee (5–30 bps), `g` the L2 gas for 3 legs.

```
π_sandwich ≈ N²/(2R) − f·N − g
π_forced_open = 0 (the attacker never pays the 10 bps — the victim's position does)
```

Positive whenever `N > 2R(f + g/N)`. With `R = $20M`, `N = $2M`, `f = 5 bps`: `π ≈ 100k − 1k − 0.03 ≈ $99k`. Against the protocol's own 0.10 % fee (`$2k` on the same notional) the attack is **≈ 50× more profitable than the honest trade is for the protocol**, and it is paid by the victim, not by the market.

PoC (`test_PoC_Adapter_ThirdPartyForcedOpen_DrainsVictimAllowance`, passes): attacker holds **0 tokens**, calls once, victim loses exactly `10 ether`, and `hook.positions(...)` shows `trader = victim`, `leverage = 5`, `borrowed = 40 ether`.

**Architectural Mitigation**
1. In `_open`: `if (msg.sender != recipient && !userApprovedExecutor[recipient][msg.sender]) revert;` — mirror `[AUDIT CRIT-4c]`.
2. For genuine relayers (aggregators, bridges), require a **signed open intent** from `recipient` over `(tokenIn, tokenOut, fee, leverage, maxAmountIn, minAmountOut, nonce, deadline)`. That keeps `recipient`-routing (needed by every aggregator) without transferring spend authority.
3. Do **not** rely on `executorWhitelist` as the moat for a contract that is also a public front door — the two roles are contradictory.

---

### F-03 — Liquidation unwind is an unbounded descending auction (High)

**Exploit Vector Name**
`EswapRouter.liquidate` / `partialLiquidate` → `EswapMarginHookLogic2._unwindBand` — full-range `sqrtPriceLimit`, caller-supplied `minAmountOut`.

**Economic Threat Model & Assumptions**
- Liquidation is permissionless (`Router.sol:1336-1352`); the liquidator supplies `minAmountOut` and will supply `0` (`Logic2.sol:182-183`).
- `_unwindBand` sells the *entire* held collateral as an **exact-input market order with the least restrictive price limit possible** (`Logic2.sol:867-873` + `MarginLib.sol:34-36`). There is no oracle reference anywhere in the unwind path — contrast the JIT path, which at least *has* `_jitOracleMinOutput`.
- The unwind runs on the **standard (deep) pool** (`_resolveUnwindPool`, `Logic2.sol:802-807`), i.e. on liquidity the protocol does not control and where any LP can sit in front of the flow.
- Atomic self-sandwiching (sell → liquidate → buy back) is blocked by the single-unlock invariant (`manager.unlock` nesting reverts). The practical forms are: (a) a standing bid / LP position **below** the market placed in a previous block, into which the unwind walks; (b) a 2-transaction bundle (sell, then liquidate, then backrun) on the Base sequencer. Both are ordinary, well-capitalised strategies.

**Attack Trace**
1. Attacker places `B` of bid liquidity on the standard pool at a price `δ` below fair (or holds an overlapping V3/V4 range).
2. A position becomes liquidatable (`isLiquidatable` true at ≤ 105 % collateralisation).
3. Attacker calls `liquidate(hook, key, trader, minAmountOut = 0)`.
4. The hook removes the band and dumps `availableCollateral` at market with `sqrtPriceLimit = MIN_SQRT_PRICE+1` (`Logic2.sol:870`), filling the attacker's bid at `fair × (1 − δ)`.
5. `_settle` pays the solver first, then the 3 % reward to insurance, then the trader's residual **capped by physical proceeds** (`Logic2.sol:538-546`). The discount `δ·S` is simply *gone* from the payout pool.
6. If the discount is large enough to push `totalSource` below the solver claim, the gap is covered by insurance up to `insuranceCoverageBps`, and anything left is booked as `badDebt` (`Logic2.sol:469-497`).

**Profitability Formula**

Selling `S` into depth `R` at mid `P`:

```
executed ≈ P·S·(1 − S/(2R))            (CPMM, exact-input)
π = P·S·S/(2R) − f·P·S − g_capital − g_gas
  ≈ S²/(2R) − f·S − g
```

Condition for +EV: `S > 2R·f + 2g/S`.
With `R = $10M`, `S = $1M`, `f = 5 bps`: `π ≈ 1e12/2e7 − 5e3 ≈ $45k` per liquidation, against `$0.01` of gas. The victim-side loss is the same `$45k`, taken from the trader's residual and, past that, from the solver and the insurance fund. Note the liquidator does **not** pay the 10 bps protocol fee, so the fee is irrelevant to the attacker's EV — it is borne by the (already underwater) position.

**Architectural Mitigation**
1. Reuse the existing JIT machinery: compute `oracleMinOut` from `triggerPriceFeed` in `_unwindBand` and revert if `receivedAmount < oracleMinOut × (1 − maxUnwindSlippageBps)` (e.g. 100 bps). One function, already written (`Ext.sol:142-161`) — this is the cheapest high-impact fix in the report.
2. Split the unwind into oracle-floored tranches with a per-block cap so a single liquidation cannot walk the book.
3. Stop accepting `minAmountOut` from the caller as "protection": the keeper's parameter is a *self*-protection, not the protocol's. Enforce a protocol-side floor in the hook and let the keeper's value only *raise* it.

---

### F-04 — Settlement repayment is first-come-first-served over the aggregate balance (High)

**Exploit Vector Name**
`EswapSettlement.claimRepayment` — per-order principal, **aggregate** balance cap.

**Economic Threat Model & Assumptions**
- `fill()` records `fillerPrincipal[orderId] = borrowAmount` (`Settlement.sol:201`) but never records *which tokens arrived for which order*.
- `claimRepayment` pays `min(fillerPrincipal[orderId], IERC20(token).balanceOf(address(this)))` (`Settlement.sol:232-248`). The `[AUDIT NEW-CRIT-01]` fix added a *position-closed* gate (`Settlement.sol:234`, `_positionStillOpen`), which stops claiming against a live position — but it does **not** attribute the incoming repayment.
- `insuranceCoverageBps` defaults to 10000, but coverage is capped at the fund balance and at burnable claims (`Logic2.sol:473-491`). On a fresh market, or after any prior shortfall, coverage is **0**. Then `_settle` pays the solver `min(totalPayout, payableAmount)` (`Logic2.sol:499`), i.e. the settlement is short-paid.
- The settlement is the `positionSolver` for every order, so **all** orders' principal flows into one balance, and `balanceOf` is the only cap.

**Attack Trace** (PoC: `test_PoC_Settlement_CrossOrderPrincipalFungibility`, passes)
1. Alice fills a 50-notional order (10 margin + 40 borrow). Mallory fills another.
2. Alice's position closes healthy → 40 principal parked in the settlement.
3. Mallory's position closes after a crash → only 15 reaches the settlement for a 40 principal (insurance empty → 25 booked as `badDebt`).
4. Settlement balance = **55**, total owed = **80**.
5. Mallory calls `claimRepayment` **first**: `min(40, 55) = 40` → Mallory is **100 % whole**.
6. Alice calls `claimRepayment`: `min(40, 15) = 15` → Alice absorbs the **entire 25** shortfall.

Carol (a third filler) can be drained the same way without ever being involved in the failing market.

**Profitability Formula**

For an attacker who controls (or can cheaply acquire) a filler position that is about to be short-paid:

```
π = min(P_attacker, Σ_j P_j_received) − P_attacker_received
```

i.e. the attacker extracts up to `min(P_self, Σ_{others} P)` — in the PoC, `25` units for `0` additional capital, with a gas cost of ~$0.01. The protocol's 10 bps fee is irrelevant: it was paid at open by the *trader*, and the attacker's profit comes from **other solvers' capital**. This is a pure redistribution: the aggregate conservation invariant (assets = liabilities) is preserved, so no accounting check will catch it.

**Architectural Mitigation**
1. **Attribution, not gating.** Have `_settle` report the actual repayment per order to a per-order escrow: either (a) a per-order clone/CREATE2 address owned by the filler, or (b) a hook-side `repaidForOrder(bytes32 orderId, uint256 amount)` callback keyed by an `orderId` the position stores. Then `claimRepayment` pays `balance_of_that_order`, not `balanceOf(this)`.
2. If attribution is too invasive: pay **pro-rata** in a shortfall epoch — snapshot `totalOwed` and `totalReceived` at the moment the first claim is made, and cap every claim at `principal × totalReceived / totalOwed`.
3. Sweep unclaimable yield explicitly (today it silently becomes owner-rescuable residue).

---

### F-05 — Oracle-liveness asymmetry: the protocol freezes exactly when it needs to act (High)

**Exploit Vector Name**
`isLiquidatable` → `PriceFeed.getAmountInUsd` reverts; `closePosition` does not.

**Economic Threat Model & Assumptions**
- `isLiquidatable` calls the feed **without** `try/catch` (`Logic2.sol:783-790`).
- `PriceFeed._getValidatedPrice` reverts on `SequencerDown`, `GracePeriodNotMet` (20-minute post-restart grace), `StalePrice` (heartbeat/round), `OraclePriceOutOfBounds` (depeg bands, `requireBounds`), `BoundsNotConfigured` (`PriceFeed.sol:68-71, 178-223`).
- `executeLiquidation` and `partialLiquidation` both start with `if (!isLiquidatable(pos, key)) revert` (`Logic2.sol:142, 249`) → **any feed fault disables all liquidations**.
- `closePosition` (`Logic2.sol:58-134`) touches **no oracle** at all: it computes `netToTrader` from physical proceeds. And `_settle`'s open-interest release was explicitly made never-reverting "because a counter decrement must never be able to block a trader's exit" (`Logic2.sol:549-555`).
- Consequence: **the trader keeps a free American option during the outage; the protocol has none.**

**Attack Trace**
1. A Base sequencer restart, a Chainlink heartbeat gap, or a USDC/debt-asset depeg pushes the feed into a revert state.
2. Every `liquidate` / `partialLiquidate` reverts for the duration (up to the full grace period; longer for a stale feed or a depeg that violates `minAnswers`/`maxAnswers`).
3. A trader whose position is underwater closes at the pre-event price (no oracle check) and keeps the residual that the liquidation would have routed to the solver first.
4. When the feed recovers, the remaining positions are already past the bad-debt line; `_settle` books `badDebt` (`Logic2.sol:493-496`).

**Profitability Formula**

```
trader_gain = residual_at_t0 − expected_residual_after_liquidation
            ≈ max(0, totalSource − solverClaim − 3%) − max(0, totalSource' − solverClaim)
```

For a position at 103 % collateralisation, the trader keeps `3 % × notional` that a liquidation would have routed to the solver/reward; if the feed stays down through a further 5 % move, the **entire** solver principal becomes bad debt:

```
badDebt = B − N·(1 − x),   x > 1 − B/N
        = 19M − 20M(1 − x)  at 20×,  B = 19M
        = M·(20x − 1)
```

At `x = 10 %` → `badDebt = 1.0M` for a position that paid `0.02M` in fees: **50× the revenue, with the trader risking nothing beyond the margin already lost.**

**Architectural Mitigation**
1. **Two-tier oracle reads.** `isLiquidatable` must use a lenient variant (`try/catch` → fall back to the last good price with a time-decay and a hard staleness ceiling, or to the deepest-pool TWAP) so liquidation is never *globally* disabled. A revert is the worst possible failure mode.
2. **Asymmetric liveness is the bug.** Either the trader's exit must also be gated (unacceptable — it strands funds), or liquidation must be oracle-independent enough to run. Prefer a *circuit-breaker* mode: when the feed is unhealthy, allow liquidation with a wider buffer (e.g. threshold + 500 bps) and an oracle-floored unwind (F-03), instead of reverting.
3. Keep `badDebt` bookkeeping, but emit it with the reason code so the operator can distinguish feed faults from market losses.

---

### F-06 — `isLiquidatable` values a stale book, not the actual assets (Medium)

**Exploit Vector Name**
Rehypothecation ledger drift: `pos.collateralAmount` vs the band's realised debt-currency proceeds.

**Economic Threat Model & Assumptions**
- `isLiquidatable` values `pos.collateralAmount` in the **collateral** currency (`Logic2.sol:785-788`).
- The LP band converts collateral → debt currency as the price moves in the position's favour; the realised proceeds are taken physically (`bandProceeds`, `Logic2.sol:879-880`) but `pos.collateralAmount` is **only** rewritten inside `rebalancePosition` (`Logic2.sol:392-398`).
- `rebalancePosition` is **not permissionless** — trader or whitelisted executor only (`Router.sol:1364-1367`), and it is a no-op until `_bandConsumed ≥ bandConsumptionTriggerBps` (`Logic2.sol:352`).
- Therefore, between rebalances, `isLiquidatable` is a valuation of an asset mix the hook no longer holds.

Two directions, both real:
- **Premature liquidation (trader loses the 3 % reward + optionality):** after a favourable move converts the band and the price then retraces, the booked collateral is worth *less* than `retained + bandProceeds`, so the position can be liquidated while it is physically solvent.
- **Delayed liquidation (protocol risk):** the mirror case — the book still counts collateral whose economic exposure has already been sold — understates risk right up to the next rebalance, which nobody is obliged to call.

**Attack Trace**
1. Trader opens a long; the band sells collateral into a rally; proceeds sit in the debt currency.
2. Price retraces. `isLiquidatable` reads `collateralAmount × newPrice < 1.05 × debt` → true.
3. Anyone calls `liquidate` with `minAmountOut = 0` (`Router.sol:1336`).
4. `_settle` pays the solver, credits 3 % of the surplus to insurance, and returns the rest to the trader — but the position is closed at a moment the trader did not choose, and the 3 % is transferred.

**Profitability Formula**

```
keeper_π = incentiveBps × 3% × afterSolver − gas        (0 by default → not profitable)
protocol_π = 3% × afterSolver                          (always collected)
trader_loss = 3% × afterSolver + lost_optionality
```

Because the default `liquidatorIncentiveBps == 0`, this is **not** a profitable standalone attack today; it becomes one the moment the incentive is enabled (F-07's fix), which is precisely why it must be fixed *before* the incentive.

**Architectural Mitigation**
1. Make the health check value the *actual* holding: `collateralValue = value(recovered + retained, collateralCcy) + value(bandProceeds, debtCcy)`. The hook already computes both in `_unwindBand`; mirror that in the view (it can be approximated from `rehypPrincipal`, `pos.liquidity` and `slot0`, or maintained incrementally in `afterSwap`).
2. Make `rebalance` permissionless **with a protocol-side bound** (rebalance is value-neutral if the recovered amount is written honestly, which it is at `Logic2.sol:398`), so the book cannot be left stale by inaction.
3. Add an invariant test: `positionCollateralUSD(pool, trader) ≈ value(actual holdings)` within a small band, asserted after every state transition.

---

### F-07 — Zero keeper incentive makes insolvency the rational outcome (Medium)

**Exploit Vector Name**
`liquidatorIncentiveBps == 0` + 3 % routed to insurance = no third-party liquidator.

**Economic Threat Model & Assumptions**
- `LIQUIDATION_REWARD_BPS = 300` is credited to `insuranceFund` "whoever triggers the liquidation" (`Hook.sol:281`, `Logic2.sol:519-537`).
- `liquidatorIncentiveBps` defaults to `0` (`Hook.sol:529`) and is only paid out of `liquidatorReward + traderPayout` (`Logic2.sol:510-518`).
- `[AUDIT HIGH-10]` acknowledges the routing; this finding is the *economic* consequence, not a repeat of the code note.
- The only liquidator is the team's `EswapLiquidationKeeper` (`EswapLiquidationKeeper.sol:292-315`), i.e. a permissioned, operational dependency in a system that advertises permissionless keepers.

**Attack Trace** (no attacker required — this is a *non*-action exploit)
1. A position crosses 105 % collateralisation.
2. No rational third party acts: `π = 0 − gas < 0`.
3. The team keeper acts on its own schedule (operational latency ≥ 1 block, realistically minutes).
4. Each extra block of adverse drift converts equity into `badDebt` (`Logic2.sol:492-496`) that the insurance fund must cover, capped by its actual balance.

**Profitability Formula**

```
keeper_π = 0 − gas < 0                       → no liquidation
badDebt per late block ≈ N · σ_block
fee revenue per position = 0.001 · N        (one-time)
```

At Base block time 2 s and 60 % annualised vol, `σ_block ≈ 0.2 %` of notional. The fee equals **0.5 blocks** of tail exposure — so the protocol's revenue covers its risk for *less than one block per position*. Any liquidation latency worse than that is structurally loss-making.

**Architectural Mitigation**
1. Enable a **direct** keeper cut (e.g. 50 bps of `afterSolver`, paid before the insurance credit) — this costs the insurance fund nothing it would not lose to latency.
2. Alternatively (or additionally) pay the keeper a **flat, gas-indexed bounty** in the debt currency, capped by the surplus, so the incentive is positive even on small positions.
3. Keep 0 % carry: the bounty is event-driven, not time-based, so it does not reintroduce interest.

---

### F-08 — A blacklisted or native-reverting recipient bricks settlement (Medium)

**Exploit Vector Name**
`NativeTokens.transfer` inside `_settle` — a reverting payout recipient freezes the position.

**Economic Threat Model & Assumptions**
- `NativeTokens.transfer` is a plain `safeTransfer` / raw `call{value:}` with **no try/catch and no escrow fallback** (`libraries/NativeTokens.sol:30-38`).
- `_settle` pays the solver (`Logic2.sol:498-502`), the optional liquidator (`510-518`), and the trader (`538-546`) — all in the **debt** currency. A revert in *any* of them aborts the whole close/liquidation.
- Two independent triggers:
  - **USDC blacklist.** Circle blacklists addresses (sanctions, hacks) as routine operations. A blacklisted trader makes `closePosition` revert forever (they cannot be paid), and makes liquidation revert **whenever the trader residual is non-zero**, i.e. exactly the 100–105 % band where the position is liquidatable but still solvent.
  - **Self-inflicted, free.** A trader can be a contract with no `receive()`/a reverting `receive()`. For a **native** debt leg, `to.call{value: amount}("")` reverts (`NativeTokens.sol:33-34`). This blocks `partialLiquidation` (whose `traderPayout > 0`) and any liquidation with a residual — at zero cost to the trader, and without any external actor.
- `partialLiquidation` is the *only* mechanism that improves a position's health without full closure; blocking it converts a recoverable position into a total loss.
- Worst case: if the **solver** (often `EswapSettlement` itself) is blacklisted, *every* position it funded becomes unsettleable.

**Attack Trace**
1. Trader opens a position through a contract wallet that rejects native currency (or gets blacklisted).
2. Price drifts; the position enters the 100–105 % band.
3. Every `partialLiquidate` reverts at `NativeTokens.transfer(debtCurrency, trader, finalTraderPayout)` (`Logic2.sol:540-545`).
4. Price continues; the position crosses into bad debt. Full liquidation now has a zero trader payout, so it *can* run — but the position has already lost the cushion that partial liquidation would have preserved.

**Profitability Formula**

```
attacker_π = 0 (griefing) or = preserved_optionality (trader)
protocol_ΔbadDebt = D_blocked · σ_block   (per block of blocked partial liquidation)
```

The interesting quantity is the **free option**: for `gas ≈ $0.01` and a one-time `deploy cost`, a trader can guarantee that no partial liquidation ever reduces their position, shifting up to the full 5 % `LIQUIDATION_COVER_BPS` slice of the loss onto insurance. Compared with the 10 bps fee, that is a **500× leverage on the fee** for the price of a reverting `receive()`.

**Architectural Mitigation**
1. **Never let a payout revert the settlement.** Wrap each transfer; on failure, credit an ERC-6909 / internal `claimable[recipient][currency]` balance (the hook already has the claim machinery) and emit an event. The position closes; the recipient pulls later.
2. Add `payoutRecipient` to the open parameters (distinct from `trader`), so a compromised/blacklisted EOA can route proceeds to a clean address without moving the position.
3. For the native leg, use `call` + fallback-to-credit rather than `revert`.

---

## 4. Cross-cutting recommendations (ranked by impact per line of code)

| Priority | Change | Files | Preserves 0 % carry? | Aggregator-safe? |
|---|---|---|---|---|
| P0 | Enable `jitOracleFloorLeniencyBps` (≤ 200) and treat `0` as revert | `EswapRouterExt.sol:122,155` | yes | yes |
| P0 | `msg.sender == recipient` (or signed intent) in adapter `_open` | `EswapLeverageAdapter.sol:241-289` | yes | yes (add signed relay) |
| P0 | Oracle-floored unwind in `_unwindBand` (reuse `_jitOracleMinOutput`) | `EswapMarginHookLogic2.sol:867` | yes | yes |
| P1 | Per-order repayment attribution in `EswapSettlement` | `EswapSettlement.sol:201,229` | yes | yes |
| P1 | Lenient/two-tier oracle read in `isLiquidatable` | `EswapMarginHookLogic2.sol:783` | yes | yes |
| P1 | Direct keeper incentive (bps or flat bounty) | `Logic2.sol:510`, `Hook.sol:529` | yes (event-driven) | n/a |
| P2 | Actual-holdings valuation in `isLiquidatable`; permissionless (bounded) rebalance | `Logic2.sol:783,343` | yes | yes |
| P2 | Non-reverting payouts with internal credit + `payoutRecipient` | `NativeTokens.sol:30`, `Logic2.sol:498-546` | yes | yes |

**Invariants worth adding to CI** (all cheap, all mock-compatible):

1. `Σ fillers' principals ≤ balanceOf(settlement) + badDebt` at all times, **per deposit epoch**.
2. `receivedAmount + bandProceeds ≥ oracleValue(availableCollateral) × (1 − maxUnwindSlippage)` for every unwind.
3. `isLiquidatable == false` ⟹ `value(actual holdings) ≥ threshold × debt`.
4. No state transition may revert on a transfer failure (fuzz the recipient: blackhole, reverting `receive`, `address(0)`).
5. `jitOracleFloorLeniencyBps != 0` on any deployment with `jitApprovedSwappers.length > 0` — asserted in the deploy script, not just documented.

---

## 5. Appendix — PoC results

`src/v4/test/AuditThirdAdversarialPoC.t.sol` (new, additive; production contracts untouched):

```
[PASS] test_PoC_Adapter_ThirdPartyForcedOpen_DrainsVictimAllowance() (gas: 1033772)
[PASS] test_PoC_Settlement_CrossOrderPrincipalFungibility()           (gas: 2231990)
[PASS] test_PoC_JIT_SwapperNamesSolverPayment_DrainsSolver()          (gas: 408282)
Suite result: ok. 3 passed; 0 failed; 0 skipped
```

* PoC 1: attacker holds 0 tokens; victim (never a caller) loses exactly the margin; `hook.positions` records the victim as trader with attacker-chosen leverage and borrow.
* PoC 2: settlement holds 55 against 80 owed; the loss-making filler claims first and is paid in full (40), the honest filler is paid 15 of 40 — a 25-unit transfer of another filler's principal.
* PoC 3: `jitOracleFloorLeniencyBps == 0`; the swapper pays 1 token0 and receives 900 token1 from a whitelisted solver in one transaction.

**Nothing in `src/v4/` outside the new test file was modified.**

---

## Remediation Status (post-fix)

All eight findings (F-01 – F-08) have been remediated in the src/v4/ contracts. ABI/storage-layout changes were permitted and applied.

| Finding | Status | Key change |
|---|---|---|
| F-01 JIT spot RFQ drain | Fixed | EswapRouterExt._jitOracleBounds now returns (minOutput, maxOutput) and reverts fail-closed (JitOraclePriceUnavailable, JitFillAboveOracleCeiling); default leniency 200 bps. |
| F-02 Forced open via whitelisted adapter | Fixed | EswapLeverageAdapter: `approvedExecutor` + setExecutorApproval; _open gate ExecutorNotApproved. |
| F-03 Unwind below oracle floor | Fixed | _unwindBand(enforceFloor) + USD floor (MAX_UNWIND_SLIPPAGE_BPS=500); closePosition passes false, liquidation/partial pass true. |
| F-04 Settlement cross-order fungibility | Fixed | EswapSettlement: pro-rata cap principal – balance / totalOwed; `rescueToken` capped at surplus. |
| F-05 Oracle outage disables liquidation | Fixed | cachedPriceUsd/cachedPriceAt + _usdOrCache (live ? cache ? OraclePriceUnavailable); circuit breaker widens threshold by CIRCUIT_BREAKER_BPS=500. |
| F-06 Stale rehypothecation book value | Fixed | Health check values actual holdings (retained + live LP band via LiquidityAmounts.getAmountsForLiquidity), counting debt-currency leg as asset. Duplicated inline in hook and Logic3 (no delegatecall under STATICCALL). |
| F-07 Keeper liveness (-EV liquidation) | Fixed | _settle/_settlePartial pay max(incentiveBps, LIQUIDATOR_MIN_INCENTIVE_BPS=50) of surplus via _payOrCredit. |
| F-08 Non-reverting payouts | Fixed | _payOrCredit + payoutCredits; pull-claim claimPayout(Currency) and setPayoutRedirect(address) in Logic1 with literal selectors in hook fallback. |

### Architecture notes
- EswapMarginHook gained no constructor change (5-arg ctor and storage order preserved; new state appended only).
- New third logic contract EswapMarginHookLogic3 owns partialLiquidation/_settlePartial; Logic1 routes its selector via fallback; logic3 is a 4th ctor arg of Logic1.
- Deploy order: Logic3 ? Logic2 ? Logic1(manager, feed, logic2, logic3) ? Hook(manager, feed, logic1, logic2, owner).
- Health check is duplicated (not delegatecalled) in hook and Logic3 so keepers' STATICCALL view works.
- Owner setters relocated to Logic1 to keep EswapMarginHook under EIP-170 (23,854 B runtime).
- F-04 PoC now asserts pro-rata 27.5/27.5 ether split; F-01 PoC asserts fail-closed + ceiling; F-02 PoC asserts ExecutorNotApproved then success after approval.

### PoC test status
- AuditThirdAdversarialPoC (F-01, F-02, F-04): 1 + 3 + 1 = 5 tests PASS.
- AuditThirdLiquidationPoC (F-03, F-05, F-08): 1 + 1 + 2 = 4 tests PASS.
- EswapLiquidatorIncentiveTest (F-07): 4 tests PASS.
- EswapJITSpotTest: 10 tests PASS (updated for armed-by-default floor).
- EswapLiquidatorIncentiveTest renamed default test asserts 0.05 ether floor bounty.

### Known follow-ups
- Fork tests (EswapForkVerification.t.sol, EswapMainnetV4LiquidationForkTest.t.sol, EswapChainlinkForkTest.t.sol) still need re-validation against the new settlement/health formulas.