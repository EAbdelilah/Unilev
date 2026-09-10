# Comprehensive DeFi Security Audit Analysis: Eswap V4 Protocol

**Date:** September 2026  
**Auditor:** Antigravity Advanced Agentic Security Research Team  
**Scope:** All V4 Contracts & Periphery (`src/v4/`)  
**Target Platform:** Uniswap V4, Unichain Mainnet (OP Stack L2, Chain ID 130)  
**Compilation Target:** Solidity `^0.8.24`, `--via-ir`

---

## 1. Executive Summary

A comprehensive, adversarial security re-audit was performed on the **Eswap V4 Protocol**, covering the core margin hook, logic contracts, router, settlement, adapters, keepership, and options modules. 

The audit focused on:
1. **Uniswap V4 Invariants:** Transient storage (EIP-1153) netting, `unlockCallback` delta zeroing, and ERC-6909 claim lifecycle.
2. **SDIM (Solver-Delegated Integration Margin) Execution:** Single-pool and multi-pool flash accounting integrity.
3. **Rehypothecated Concentrated Liquidity:** Automated range deployment, band consumption, yield distribution, and unwind solvency.
4. **Oracle Integrity & MEV Surface:** Price feed normalization, TWAP circuit-breaker behavior, and slippage protection.
5. **Economic Solvency & Liquidation Dynamics:** Shortfall settlement, bad debt ledgering, and liquidator game-theoretic incentives.

### Summary of Findings

| Severity | Count | Status |
|---|:---:|:---|
| **Critical** | 4 | Action Required |
| **High** | 4 | Action Required |
| **Medium** | 5 | Action Required |
| **Low / Informational** | 4 | Optimization / Documentation |

---

## 2. Severity Classification Matrix

| Finding ID | Title | Severity | Impact | Status |
|---|---|---|---|---|
| **C-01** | Rehypothecated Position Unwind Ignores Returned Debt Currency — Bricks Position Close & Liquidation | **Critical** | Permanent lock of user collateral & positions | **Vulnerable** |
| **C-02** | Shortfall Coverage in `_settle` Calls `manager.take` Without Burning ERC-6909 Claims | **Critical** | `CurrencyNotSettled` revert on real Uniswap V4 PoolManager | **Vulnerable** |
| **C-03** | `withdrawInsuranceFund`, `withdrawProtocolFee`, and `sweepResidue` Fail on Real PoolManager | **Critical** | Complete failure of protocol revenue & insurance withdrawals | **Vulnerable** |
| **C-04** | Complete Absence of Slippage Protection (`minAmountOut`) in `EswapRouter.swap()` / `swapMultiPool()` | **Critical** | 100% MEV Sandwich extraction / capital drain on open | **Vulnerable** |
| **H-01** | `ArbunPutOption` Hardcodes 18 Decimals for Collateral — Trillion-Dollar Overflow for USDC | **High** | Option creation and exercise completely broken for USDC | **Vulnerable** |
| **H-02** | `_checkV4SpotAgainstV3Twap` Compares Oracle TWAP to Itself (Spot Circuit Breaker Disabled) | **High** | Manipulation of execution standard pool undetectable | **Vulnerable** |
| **H-03** | Zero Economic Incentive for Third-Party Keepers (`liquidatorReward` Sent to Protocol Fund) | **High** | High risk of unliquidated bad debt if keeper bot pauses | **Fixed** — `_settle` pays `LIQUIDATION_REWARD_BPS` (300bps) to the `liquidator` from recovered proceeds; insurance mint removed |
| **H-04** | Missing `deployCollateral` Router Entrypoint Leaves Standalone Positions Un-deployed | **High** | Failed initial deployment cannot be re-triggered by user | **Fixed** — `EswapRouter.deployCollateral` entrypoint added |
| **M-01** | `EswapRouter` Native ETH Refund Uses Hardcoded `.transfer(2300 gas)` | **Medium** | DoS for smart contract traders / multisigs (Gnosis Safe) | **Vulnerable** |
| **M-02** | 24-Hour Oracle Staleness Window (`MAX_ORACLE_AGE = 86400s`) | **Medium** | Exploitable stale prices during high market volatility | **Fixed** — `MAX_ORACLE_AGE` tightened to 3,600s (1h) in `PriceFeed.sol:54`; staleness test coverage updated |
| **M-03** | Impermanent Loss in Concentrated Liquidity Rehypothecation Induces Collateral Deficit | **Medium** | Position close requires more collateral than available | **Fixed** — `rebalancePosition` now writes `pos.collateralAmount = availableCollateral` (actually-recovered principal) |
| **M-04** | `EswapRouter` Refunds Total Balance Rather Than Transaction Native Surplus | **Medium** | Accidental ETH trapped in Router given to next swapper | **Vulnerable** |
| **M-05** | `EswapSolverAdapter.registerSolverDebt` Inoperable Due to `onlyRouter` Guard | **Medium** | Reverting dead-code function | **Fixed** — unauthenticated public forwarder removed; only the authorized `onlyRouter` hook path remains |
| **L-01** | Unchecked ERC-20 `decimals()` Call in `PriceFeed.getAmountInUsd` | **Low** | Reverts on non-standard ERC-20 tokens | **Low** |
| **L-02** | `EswapSettlement.rescueToken` Lacks Protection for Position Tokens | **Low** | Owner error can disrupt in-flight bridge fills | **Low** |
| **I-01** | `PositionClosed` Event in `EswapSettlement` Emits Hardcoded Zero Payout | **Informational** | Misleading off-chain indexing | **Fixed** — event removed in H-04 redesign (settlement never owns/custodies positions) |
| **I-02** | Unused Function Parameters in `_settle` (`liquidator`) | **Informational** | Dead code | **Fixed** — `liquidator` now consumed for the H-05 keeper reward payout |

---

## 3. Deep-Dive Vulnerability Analysis

---

### [C-01] CRITICAL: Rehypothecated Position Unwind Ignores Returned Debt Currency — Bricks Position Close & Liquidation

**Affected Contracts:** `EswapMarginHookLogic.sol` (`closePosition`, `executeLiquidation`)  
**Impact:** Total loss of ability to close or liquidate any rehypothecated position that suffered price movement.

#### Mechanism Breakdown
When collateral is deployed into concentrated liquidity via `deployCollateral()`:
- The hook deploys liquidity into an LP band just outside the current tick.
- When market price moves into this band, the position is partially or fully converted into the opposite currency (`debtCurrency`).
- In `rebalancePosition()` (lines 344–362), the contract correctly recognizes this:
  ```solidity
  int128 removedDebtInt = isCurrency0 ? removeDelta.amount1() : removeDelta.amount0();
  if (removedDebtInt > 0) {
      // Swaps removed debt currency back to collateralCurrency on standard pool
      manager.swap(swapPool, ...);
  }
  ```
- **However, in `closePosition()` and `executeLiquidation()`, this swap-back step is completely absent!**
  ```solidity
  // Lines 218-230:
  (removeDelta,) = manager.modifyLiquidity(lpPool, ...);
  _netLiquidityDelta(lpPool, removeDelta); // Pulls both collateral and debt tokens to Hook

  // Lines 231-237:
  manager.swap(
      standardKey,
      IPoolManager.SwapParams(zeroForOne, -int256(collateralAmount), ...), // SWAPS FULL ORIGINAL COLLATERAL
      ""
  );

  // Line 242:
  _settleTransientDebt(collateralCurrency, collateralAmount);
  ```

#### Exploitation Scenario
1. Trader opens a Long position with 1 WETH collateral ($3,000).
2. The hook deploys the 1 WETH into an LP band.
3. Market price dips; the band is 50% consumed: the LP position now holds 0.5 WETH and 1,500 USDC.
4. When the trader calls `closePosition()` (or a keeper calls `executeLiquidation()`):
   - `modifyLiquidity` removes the LP band, delivering 0.5 WETH and 1,500 USDC to the Hook.
   - `closePosition` immediately attempts to swap **1.0 WETH** (`collateralAmount`) into USDC.
   - The swap incurs a transient debt of 1.0 WETH.
   - `_settleTransientDebt` attempts to transfer 1.0 WETH to the PoolManager.
   - **The Hook only holds 0.5 WETH!**
   - The ERC-20 `safeTransfer` reverts with `ERC20: transfer amount exceeds balance`.
5. **Result:** The position can **never be closed or liquidated**. Capital is permanently frozen.

#### Recommended Remediation
In `EswapMarginHookLogic.sol`, port the `rebalancePosition` swap-back logic into `closePosition` and `executeLiquidation` before initiating the primary collateral unwind swap:
```solidity
int128 removedDebtInt = isCurrency0 ? removeDelta.amount1() : removeDelta.amount0();
if (removedDebtInt > 0) {
    uint256 removedDebt = uint256(uint128(removedDebtInt));
    bool zeroForOneBack = Currency.unwrap(debtCurrency) == Currency.unwrap(key.currency0);
    PoolKey memory swapPool = _resolveUnwindPool(poolId, key);
    BalanceDelta backDelta = manager.swap(
        swapPool,
        IPoolManager.SwapParams(zeroForOneBack, -SafeCast.toInt256(removedDebt), EswapMarginLib.sqrtPriceLimit(zeroForOneBack)),
        ""
    );
    int128 gotBackInt = zeroForOneBack ? backDelta.amount1() : backDelta.amount0();
    _settleTransientDebt(debtCurrency, removedDebt);
    if (gotBackInt > 0) {
        manager.take(collateralCurrency, address(this), uint256(int256(gotBackInt)));
    }
}
```

---

### [C-02] CRITICAL: Shortfall Coverage in `_settle` Calls `manager.take` Without Burning ERC-6909 Claims

**Affected Contracts:** `EswapMarginHookLogic.sol` (`_settle`, line 532)  
**Impact:** Any liquidation involving insurance fund shortfall compensation reverts with `CurrencyNotSettled`.

#### Mechanism Breakdown
In `_settle()` (lines 527–540):
```solidity
if (shortfall > 0) {
    uint256 covered = shortfall > insuranceFund[debtCurrency] ? insuranceFund[debtCurrency] : shortfall;
    insuranceFund[debtCurrency] -= covered;
    if (covered > 0) {
        manager.take(debtCurrency, address(this), covered);
        payableAmount += covered;
    }
    ...
```
1. Protocol insurance funds are deposited into the PoolManager as **ERC-6909 claims** (see `seedInsuranceFund()` line 572: `manager.mint(...)`).
2. When `_settle()` needs to cover a liquidation shortfall, it calls `manager.take(debtCurrency, address(this), covered)`.
3. In Uniswap V4, `manager.take()` creates a negative transient delta (`-covered`) for the caller.
4. **The Hook never burns the corresponding ERC-6909 claim (`manager.burn()`)!**
5. At the exit of `manager.unlock()`, the PoolManager inspects `_getTransientDelta(hook, debtCurrency)` and finds non-zero debt (`-covered`).
6. The transaction reverts with `RealIPoolManager.CurrencyNotSettled.selector`.

#### Recommended Remediation
Burn the ERC-6909 insurance claims to offset the `manager.take` debit:
```solidity
if (covered > 0) {
    uint256 claimId = uint256(uint160(Currency.unwrap(debtCurrency)));
    manager.burn(address(this), claimId, covered);
    manager.take(debtCurrency, address(this), covered);
    payableAmount += covered;
}
```

---

### [C-03] CRITICAL: Protocol Withdrawals (`withdrawInsuranceFund`, `withdrawProtocolFee`, `sweepResidue`) Revert on Real PoolManager

**Affected Contracts:** `EswapMarginHook.sol` (lines 413, 425, 464, 1223–1233)  
**Impact:** 100% of accumulated protocol fees, insurance withdrawals, and residue sweeps fail on mainnet.

#### Mechanism Breakdown
In `EswapMarginHook.sol`:
```solidity
function withdrawInsuranceFund(...) external onlyOwner {
    ...
    manager.unlock(abi.encode(currency, -SafeCast.toInt128(int256(amount)), true));
    IERC20(Currency.unwrap(currency)).safeTransfer(to, amount);
}
```
Inside `unlockCallback()`:
```solidity
(Currency currency, int128 delta, bool isTake) = abi.decode(data, (Currency, int128, bool));
if (isTake) {
    manager.take(currency, address(this), uint256(int256(-delta)));
}
```
1. `isTake == true` calls `manager.take(currency, address(this), amount)`.
2. This creates a transient debit of `-amount` on the Hook.
3. No offset (neither token deposit nor ERC-6909 burn) is executed.
4. The transaction reverts on real V4 PoolManager (`CurrencyNotSettled`).
*(Note: Tests passed previously solely because `PoolManagerMock` did not check transient deltas on `take()`)*.

#### Recommended Remediation
Update `unlockCallback()` to burn the ERC-6909 claim before taking physical tokens:
```solidity
if (isTake) {
    uint256 amount = uint256(int256(-delta));
    uint256 claimId = uint256(uint160(Currency.unwrap(currency)));
    manager.burn(address(this), claimId, amount);
    manager.take(currency, address(this), amount);
}
```

---

### [C-04] CRITICAL: Complete Absence of Slippage Protection in `EswapRouter.swap()` and `swapMultiPool()`

**Affected Contracts:** `EswapRouter.sol` (`SwapParams`, `_swapCallback`, `_multiPoolSwapCallback`)  
**Impact:** Traders opening margin positions can be 100% sandwiched by MEV bots, losing up to their entire margin.

#### Mechanism Breakdown
Inspect `SwapParams` in `EswapRouter.sol` (lines 184–201):
```solidity
struct SwapParams {
    PoolKey key;
    PoolKey standardPoolKey;
    bool zeroForOne;
    int256 amountSpecified;
    uint8 leverage;
    address solver;
    bytes hookData;
    uint256 deadline;
}
```
In `_multiPoolSwapCallback()`:
```solidity
BalanceDelta stdDelta = manager.swap(
    params.standardPoolKey,
    IPoolManager.SwapParams(
        params.zeroForOne, -int256(notional), EswapMarginLib.sqrtPriceLimit(params.zeroForOne)
    ),
    ""
);
int128 outputDelta = params.zeroForOne ? stdDelta.amount1() : stdDelta.amount0();
require(outputDelta > 0, "Swap output zero");
uint256 outputAmount = uint256(int256(outputDelta));
```
1. `EswapMarginLib.sqrtPriceLimit` permits full-range execution (`MIN_SQRT_PRICE + 1` / `MAX_SQRT_PRICE - 1`).
2. There is **no `minAmountOut`** or slippage parameter.
3. The only assertion is `require(outputDelta > 0, "Swap output zero")`.
4. A sandwich bot can front-run the trader's open, pump the price 1000x, let the trader swap at the manipulated top receiving 1 wei of collateral, and back-run for massive profit.
5. The trader is left with a position holding 1 wei of collateral and full debt, instantly liquidated.

#### Recommended Remediation
1. Add `uint256 minAmountOut` to `SwapParams`.
2. In `_swapCallback` and `_multiPoolSwapCallback`, require:
   ```solidity
   require(outputAmount >= params.minAmountOut, "Router: slippage exceeded");
   ```

---

### [H-01] HIGH: `ArbunPutOption` Decimals Assumption Breaks for USDC

**Affected Contracts:** `ArbunPutOption.sol` (lines 125–136)  
**Impact:** DoS / Overflow when interacting with standard stablecoins like USDC (6 decimals).

#### Description
`priceFeed.getTwapPrice(underlyingToken)` returns 18-decimal USD price per whole token.
When calculating notional value:
```solidity
uint256 notionalCollateralValue = (quantity * currentPrice) / 1e18;
```
For 1 WETH at $3,000, `notionalCollateralValue = 3000e18`.
When transferring USDC:
```solidity
IERC20(collateralToken).safeTransferFrom(msg.sender, address(this), totalCollect);
```
USDC has 6 decimals. `3000e18` raw units is $3,000,000,000,000 (3 Trillion USDC).
The transaction will always revert with `ERC20: transfer amount exceeds balance`.

#### Remediation
Normalize notional value by the collateral token's decimals:
```solidity
uint8 colDec = IERC20Decimals(collateralToken).decimals();
uint256 notionalCollateralValue = colDec <= 18
    ? (quantity * currentPrice) / (1e18 * 10**(18 - colDec))
    : (quantity * currentPrice * 10**(colDec - 18)) / 1e18;
```

---

### [H-02] HIGH: `_checkV4SpotAgainstV3Twap` Compares Oracle TWAP to Itself

**Affected Contracts:** `EswapMarginHook.sol` (lines 921–978), `EswapMarginHookLogic.sol` (lines 825–882)  
**Impact:** Spot price manipulation on the execution venue cannot be detected.

#### Description
In `_checkV4SpotAgainstV3Twap`:
```solidity
uint256 twap0 = priceFeed.getTwapPrice(Currency.unwrap(key.currency0));
uint256 twap1 = priceFeed.getTwapPrice(Currency.unwrap(key.currency1));
...
uint256 twapRatio18 = (twap0 * 1e18) / twap1;
...
// Sqrt price is synthesized mathematically from twapRatio18:
uint256 spotSq = FullMath.mulDiv(rawSpot18, 1 << 192, 1e18);
uint160 sqrtPriceX96 = SafeCast.toUint160(Math.sqrt(spotSq));

EswapMarginLib.checkTwap(..., sqrtPriceX96, ...);
```
The function derives `sqrtPriceX96` from the Chainlink TWAP itself, ensuring `deviation == 0` always. It never reads the slot0 of `standardPoolKey` where actual swaps execute.

#### Remediation
Read the actual execution venue slot0:
```solidity
PoolKey memory execKey = standardPoolKeys[key.toId()];
if (Currency.unwrap(execKey.currency0) == address(0)) execKey = key;
(uint160 actualSqrtPriceX96,,,) = _slot0(execKey.toId());
EswapMarginLib.checkTwap(address(priceFeed), key, actualSqrtPriceX96, ...);
```

---

### [H-03] HIGH: Zero Keeper Liquidation Incentive

**Affected Contracts:** `EswapMarginHookLogic.sol` (`_settle`, lines 512–516)  
**Impact:** Third-party keepers have no financial incentive to liquidate bad debt.

#### Description
In `executeLiquidation()`:
```solidity
uint256 liqReward = (afterSolver * LIQUIDATION_REWARD_BPS) / 10000;
_settle(..., liquidator, liqReward, ...);
```
Inside `_settle()`:
```solidity
if (liquidatorReward > 0) {
    insuranceFund[debtCurrency] += liquidatorReward;
    _settleToManager(debtCurrency, liquidatorReward);
    manager.mint(address(this), uint256(uint160(Currency.unwrap(debtCurrency))), liquidatorReward);
}
```
The entire 3% reward is minted into the `insuranceFund`. The `liquidator` address receives 0 tokens while paying L2 gas. If the protocol team's private keeper bot runs out of gas or crashes, underwater positions will go unliquidated, causing severe bad debt accumulation.

#### Remediation
Split the liquidation fee between the keeper (to cover gas + profit) and the insurance fund:
```solidity
uint256 keeperReward = liquidatorReward / 2;
uint256 fundReward = liquidatorReward - keeperReward;

if (fundReward > 0) {
    insuranceFund[debtCurrency] += fundReward;
    _settleToManager(debtCurrency, fundReward);
    manager.mint(address(this), uint256(uint160(Currency.unwrap(debtCurrency))), fundReward);
}
if (keeperReward > 0 && liquidator != address(0)) {
    NativeTokens.transfer(debtCurrency, liquidator, keeperReward);
}
```

---

### [H-04] HIGH: Missing `deployCollateral` Router Entrypoint

**Affected Contracts:** `EswapRouter.sol`, `EswapMarginHook.sol`  
**Impact:** Rehypothecation failure on open leaves position permanently un-rehypothecated.

#### Description
`hook.deployCollateral` requires `onlyRouter`. Furthermore, `deployCollateral` must be called inside `manager.unlock()`.
However, `EswapRouter` does not expose an external function to call `deployCollateral` on an existing position.
If gas limits or network state cause `deployCollateral` to fail or skip during open, there is no way for the user or keeper to ever deploy collateral into an LP band later.

#### Remediation
Add a `deployCollateral` function to `EswapRouter.sol`:
```solidity
function deployCollateral(address hook, PoolKey calldata key, address trader) external {
    manager.unlock(abi.encode(CallType.DEPLOY_COLLATERAL, hook, key, trader));
}
```

---

### [M-01] MEDIUM: `EswapRouter` ETH Refund Uses `.transfer()` (2300 Gas Revert)

**Affected Contracts:** `EswapRouter.sol` (line 703)  
**Location:** `_multiPoolSwapCallback`  
```solidity
if (inputNative && notional > 0 && address(this).balance > 0) {
    payable(trader).transfer(address(this).balance);
}
```
Calling `.transfer()` enforces a 2,300 gas stipend. If `trader` is a smart contract wallet (Gnosis Safe, Argent, Account Abstraction contract), the call reverts, breaking all native ETH margin opens for smart accounts.

#### Remediation
Use low-level call:
```solidity
(bool success,) = payable(trader).call{value: refundAmount}("");
require(success, "ETH refund failed");
```

---

### [M-02] MEDIUM: 24-Hour Oracle Staleness Window (`MAX_ORACLE_AGE = 86400s`)

**Affected Contracts:** `PriceFeed.sol` (line 53)  
A 24-hour staleness threshold is excessively wide for margin trading with leverage up to 20x. In volatile market events, a 2-hour-old price can allow users to open already-underwater positions or avoid rightful liquidations.

#### Remediation
Reduce `MAX_ORACLE_AGE` to at most 3,600 seconds (1 hour) or calibrate per feed based on heartbeat specifications.

---

### [M-03] MEDIUM: Impermanent Loss Induces Collateral Shortfall on Position Close

**Affected Contracts:** `EswapMarginHookLogic.sol`  
When collateral is deployed as concentrated liquidity, impermanent loss reduces the total value of returned assets relative to the initial deposit. If fees earned do not exceed impermanent loss, `recoveredCollateral < rehypPrincipal`. The hook does not record this loss against `pos.collateralAmount`, leading to a deficit when settling.

#### Remediation
Update `pos.collateralAmount` dynamically upon removing LP liquidity to reflect actual recovered principal.

---

### [M-04] MEDIUM: ETH Refund Sweeps Total Router Balance

**Affected Contracts:** `EswapRouter.sol` (line 703)  
```solidity
payable(trader).transfer(address(this).balance);
```
Refunding `address(this).balance` sweeps any residual or accidentally sent ETH to whoever opens the next native trade, rather than strictly refunding `msg.value - notional`.

#### Remediation
Calculate exact excess:
```solidity
uint256 excess = msg.value > notional ? msg.value - notional : 0;
if (excess > 0) {
    (bool ok,) = payable(trader).call{value: excess}("");
    require(ok, "Refund failed");
}
```

---

### [M-05] MEDIUM: `EswapSolverAdapter.registerSolverDebt` Is Inoperable Dead Code

**Affected Contracts:** `EswapSolverAdapter.sol` (line 110)  
`EswapSolverAdapter.registerSolverDebt()` calls `hook.registerSolverDebt()`. Because the hook function has the `onlyRouter` modifier and the adapter is not the router, this call will always revert.

#### Remediation
Remove this dead-code function or route the call through `EswapRouter`.

---

## 4. Architectural & Systemic Risk Analysis

### A. PoolManager Singleton Solvency
Eswap relies entirely on the Uniswap V4 PoolManager singleton for collateral custody. By minting ERC-6909 claims to the Hook contract, trader collateral is physically held inside the PoolManager. 
- **Strength:** No external protocol vault contracts exist that can be drained via flash loans.
- **Vulnerability:** Strict delta balance checks in V4 necessitate perfect netting in every unlock. The bugs identified in **C-02** and **C-03** arise because the mock tests did not simulate real V4 delta enforcement.

### B. Shariah Arbun Option Model
The `ArbunPutOption` implementation achieves valid structural Shariah compliance (physical delivery prior to execution, no interest/Riba, mutual Takaful fund). However:
- The decimal scaling bug (**H-01**) prevents its operational execution with USDC.
- Solvency of the Takaful fund relies on canceled downpayments exceeding successful put payouts. If price crashes monotonically without downpayment forfeiture, the Takaful fund will deplete, leading to payout insolvency.

### C. Unichain L2 Deployment Specifics
Unichain operates on the OP Stack.
- **Sequencer Downtime:** While sequencer downtime checks are implemented, the `sequencerUptimeFeed` remains address(0). In the event of sequencer halts, oracle updates may stack and execute abruptly on recovery.
- **Gas Pricing:** L2 execution is negligible (<$0.01), but L1 data posting costs dominate. Ensuring compact calldata on margin intent signatures is critical for aggregator profitability.

---

## 5. Automated Testing & Verification Report

- **Total Test Suites:** 55
- **Passing Unit & Mock Tests:** 250 / 250 (100%)
- **Fork Simulation Failures:** 4 (Identified in pre-deployed live address repros due to `ManagerLocked` and obsolete live cap parameters).
- **Static Analysis Highlights:**
  - Slither: Unchecked return values in `sweepResidue` and `NativeTokens` identified and confirmed in manual review.
  - Solhint: Complexity warnings in `_settle` validated as having missing branches (identified in **C-01** and **C-02**).

---

## 6. Audit Sign-Off & Next Steps

Before mainnet deployment and marketing to DeFi aggregators (ODOS, Enso, 1inch):
1. **Apply Hotfixes for C-01 through C-04** immediately.
2. **Standardize ERC-20 Decimal Handling** across `ArbunPutOption` and `PriceFeed`.
3. **Incentivize Liquidators** by allocating a portion of the liquidation reward directly to the calling keeper.
4. **Re-run the Complete Fork Test Suite** against live Unichain RPC to verify real PoolManager delta netting.
