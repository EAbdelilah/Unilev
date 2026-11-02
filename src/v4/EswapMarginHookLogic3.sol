// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BaseHook} from "./BaseHook.sol";
import {IPoolManager} from "./interfaces/IPoolManager.sol";
import {PoolKey} from "./types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "./types/PoolId.sol";
import {Currency} from "./types/Currency.sol";
import {BalanceDelta, BalanceDeltaLibrary} from "./types/BalanceDelta.sol";
import {IPriceFeedLogic, EswapMarginHookLogicStorage} from "./EswapMarginHookLogicStorage.sol";
import {EswapMarginLib} from "./EswapMarginLib.sol";
import {NativeTokens} from "./libraries/NativeTokens.sol";
import {LiquidityAmounts} from "./libraries/LiquidityAmounts.sol";
import {TickMath} from "./libraries/TickMath.sol";
import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IPoolManager as RealIPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolId as RealPoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {EswapMarginHookLogic2} from "./EswapMarginHookLogic2.sol";

/**
 * @title EswapMarginHookLogic3
 * @notice Third half of the EIP-170 split of the hook's heavyweight execution
 *         logic: the PARTIAL-liquidation engine (`partialLiquidation` +
 *         `_settlePartial`), moved out of EswapMarginHookLogic2 so that contract
 *         could absorb the third-audit settlement work (oracle-floored unwind,
 *         non-reverting payouts, keeper bounty) without crossing the 24,576-byte
 *         runtime cap.
 *
 * @dev Call path: `EswapMarginHook.partialLiquidation` (router-gated) →
 *      delegatecall to `EswapMarginHookLogic` → its `fallback` recognises the
 *      selector and delegatecalls THIS contract. Storage layout is inherited
 *      from EswapMarginHookLogicStorage and mirrors EswapMarginHook exactly, so
 *      every hop reads/writes the hook's own slots.
 *
 *      Code is intentionally duplicated from EswapMarginHookLogic2 (helpers such
 *      as `_unwindBand`) rather than shared: this contract is a delegatecall
 *      target and cannot link against another target's internal functions, and
 *      the whole point of the split is to spend bytecode here, not there.
 */
contract EswapMarginHookLogic3 is BaseHook, EswapMarginHookLogicStorage {
    using PoolIdLibrary for PoolKey;
    using PoolIdLibrary for PoolId;
    using BalanceDeltaLibrary for BalanceDelta;
    using SafeERC20 for IERC20;

    modifier onlyRouter() {
        if (msg.sender != router) revert Unauthorized();
        _;
    }

    constructor(IPoolManager _manager, IPriceFeedLogic _priceFeed) BaseHook(_manager) {
        priceFeed = _priceFeed;
    }

    // ─── [P1#3] Partial liquidation ──────────────────────────────────────────

    /**
     * @notice Liquidates ONLY `liquidationBps` (1-9999) of an underwater
     *         position, keeping the remainder open with reduced collateral and
     *         debt. Unlike a full liquidation (which closes entirely), a partial:
     *          1. Unwinds a proportional slice of the collateral, repaid debt, and
     *             the LP band (if any).
     *          2. Seizes `(1 + LIQUIDATION_COVER_BPS) × proportional` collateral so
     *             the position's collateralization RATIO improves (a plain f/f
     *             shrink would leave the ratio unchanged and therefore the position
     *             still liquidatable).
     *          3. Repays the proportional solver principal and updates all ledger
     *             aggregates; the position SURVIVES and can be closed or re-armed
     *             by the trader later.
     * @param liquidationBps Fraction of the position to liquidate, in basis points
     *                       (1 through 9999). 10000 (full) must use
     *                       `executeLiquidation` instead.
     */
    function partialLiquidation(
        PoolKey calldata key,
        address trader,
        uint256 minAmountOut,
        address liquidator,
        uint256 liquidationBps
    ) external onlyRouter {
        if (liquidationBps == 0 || liquidationBps >= 10000) revert InvalidLiquidationBps();
        // [AUDIT HIGH-4] A partial liquidation seizes `(1 + COVER_BPS) × bps` of
        // the collateral. Above ~9523 bps the cover-inflated slice caps at the
        // whole position — silently converting the "partial" into a full
        // liquidation that bypasses executeLiquidation's stricter flow. Reject
        // outright instead of relying on the downstream `liqCollateral` cap.
        if (FullMath.mulDiv(liquidationBps, 10000 + LIQUIDATION_COVER_BPS, 10000) >= 10000) {
            revert InvalidLiquidationBps();
        }

        PoolId poolId = key.toId();
        Position storage pos = positions[poolId][trader];
        if (!_isLiquidatable(pos, key)) revert PositionNotLiquidatable();

        bool hadBand = pos.liquidity > 0;
        BalanceDelta removeDelta;
        if (hadBand) {
            PoolKey memory lpPool = _rehypothecationPool(poolId, key);
            (removeDelta,) = manager.modifyLiquidity(
                lpPool, IPoolManager.ModifyLiquidityParams(pos.tickLower, pos.tickUpper, -int128(pos.liquidity), 0), ""
            );
            _netLiquidityDelta(lpPool, removeDelta);
            pos.liquidity = 0;
        }

        Currency collateralCurrency = _collateralCurrency(pos, key);
        Currency debtCurrency = _debtCurrency(pos, key);
        uint256 collateralAmount = pos.collateralAmount;
        uint256 borrowedAmount = pos.borrowedAmount;

        address yieldRecipient = positionSolver[poolId][trader];
        if (yieldRecipient == address(0)) yieldRecipient = trader;
        _distributeRehypothecation(key, removeDelta, collateralCurrency, rehypPrincipal[poolId][trader], yieldRecipient);

        // [P1#3] Collateral to seize: proportional slice plus the cover bonus
        // (thinner collateral than debt ⇒ the surviving position's health rises).
        uint256 liqCollateral = FullMath.mulDiv(collateralAmount, liquidationBps, 10000);
        liqCollateral = FullMath.mulDiv(liqCollateral, 10000 + LIQUIDATION_COVER_BPS, 10000);
        if (liqCollateral > collateralAmount) liqCollateral = collateralAmount;

        // The remainder of the collateral that never left the accounting pool stays
        // behind as the reduced position's backing (see _unwindBand: available =
        // band-recovered + retained, capped at the book collateralAmount).
        // [AUDIT F-03] `enforceFloor = true`: a liquidation unwind that realises a
        // materially worse price than the oracle is the attacker's profit, and
        // Unlike closePosition the position owner never chose the timing.
        (uint256 receivedAmount, uint256 bandProceeds, uint256 unwindAmount) = _unwindBand(
            key,
            poolId,
            removeDelta,
            collateralCurrency,
            collateralAmount,
            rehypPrincipal[poolId][trader],
            hadBand,
            liqCollateral,
            true
        );

        uint256 totalSource = receivedAmount + bandProceeds;
        if (totalSource == 0) revert SlippageExceeded(0, minAmountOut);
        if (totalSource < minAmountOut) revert SlippageExceeded(totalSource, minAmountOut);

        // [AUDIT N-02] What the surviving position ACTUALLY holds after the
        // unwind, in the collateral currency: the band's collateral-currency
        // return plus the share that never left the accounting pool, minus the
        // slice just sold. This is NOT `collateralAmount - unwindAmount`: when
        // the band had already converted collateral into the debt currency
        // (F-06), the book overstates the physical backing, so the old gate
        // could pass a genuinely underwater survivor and leave a ledger that no
        // longer matches the hook's holdings.
        uint256 remainingCollateral = _survivingCollateral(
            key,
            removeDelta,
            collateralCurrency,
            collateralAmount,
            rehypPrincipal[poolId][trader],
            hadBand,
            unwindAmount
        );

        // Repay the proportional share of the solver claim first.
        address solver = positionSolver[poolId][trader];
        SolverDebt storage debt = solverDebts[poolId][trader][solver];
        uint256 totalPayout = debt.principal + debt.accumulatedYield;
        if (totalPayout == 0 && borrowedAmount > 0) totalPayout = borrowedAmount;
        uint256 liqDebt = FullMath.mulDiv(totalPayout, liquidationBps, 10000);
        if (liqDebt > borrowedAmount) liqDebt = borrowedAmount;

        uint256 afterSolver = totalSource >= liqDebt ? totalSource - liqDebt : 0;
        uint256 liqReward = (afterSolver * LIQUIDATION_REWARD_BPS) / 10000;

        // [AUDIT CRIT-04] The surviving position must clear the maintenance
        // threshold. Leaving a still-liquidatable remainder lets any keeper
        // repeat small slices indefinitely, skimming the cover bonus + reward
        // each round until the stake is dust. Revert instead, so an underwater
        // position can only be settled by a FULL liquidation (100% of the debt
        // repaid in one pass). NOTE: the check runs AFTER the unwind swap but is
        // still atomic — a revert rolls the whole transaction back untouched.
        //
        // [AUDIT F-05] Values go through `_usdOrCache`: this gate already ran
        // `_isLiquidatable` (which tolerates a feed outage by using the cached
        // mark), so a fresh live read here must not be able to re-break
        // liquidation liveness.
        //
        // [AUDIT N-02] Value the survivor's REAL holdings (`remainingCollateral`,
        // computed above), not the stale book. The band has already been fully
        // removed and its proceeds distributed, so the surviving position holds
        // only the remaining collateral currency.
        if (unwindAmount < collateralAmount) {
            uint256 remainingDebt = borrowedAmount > liqDebt ? borrowedAmount - liqDebt : 0;
            (uint256 remCollUsd, bool remCollCached) =
                _usdOrCache(Currency.unwrap(collateralCurrency), remainingCollateral);
            (uint256 remDebtUsd, bool remDebtCached) = _usdOrCache(Currency.unwrap(debtCurrency), remainingDebt);
            if (
                EswapMarginLib.isLiquidatable(
                    remCollUsd, remDebtUsd, pos.leverage, (remCollCached || remDebtCached) ? CIRCUIT_BREAKER_BPS : 0
                )
            ) {
                revert PartialLiquidationLeavesUnhealthyPosition();
            }
        }

        _settlePartial(
            poolId,
            trader,
            pos,
            collateralCurrency,
            debtCurrency,
            unwindAmount,
            receivedAmount,
            solver,
            liquidator,
            liqReward,
            afterSolver - liqReward,
            liqDebt,
            bandProceeds,
            collateralAmount,
            remainingCollateral
        );
    }

    // ─── [P1#3] Partial-liquidation settlement ───────────────────────────────

    /**
     * @notice Settlement for a PARTIAL liquidation. Unlike Logic2's `_settle`
     *         this does NOT delete the position: it shaves `liqDebt` off
     *         `borrowedAmount` and `unwindAmount` off `collateralAmount` (leaving
     *         the surviving stake), repays the solver share with cover-backed
     *         proceeds, credits the liquidation reward to the insurance fund, and
     *         pays the remainder to the liquidator/trader as in a full
     *         liquidation.
     * @dev [AUDIT F-07] The keeper bounty is applied here exactly as in `_settle`
     *      (floor `LIQUIDATOR_MIN_INCENTIVE_BPS`).
     *      [AUDIT F-08] Every outgoing transfer is non-reverting: a failed payout
     *      is credited to `payoutCredits` instead of bricking the liquidation.
     */
    function _settlePartial(
        PoolId poolId,
        address trader,
        Position storage pos,
        Currency collateralCurrency,
        Currency debtCurrency,
        uint256 unwindAmount,
        uint256 receivedAmount,
        address solver,
        address liquidator,
        uint256 liquidatorReward,
        uint256 traderPayout,
        uint256 liqDebt,
        uint256 extraProceeds,
        uint256 collateralAmount,
        uint256 remainingCollateral
    ) internal {
        if (receivedAmount > 0) {
            manager.take(debtCurrency, address(this), receivedAmount);
        }
        SolverDebt storage debt = solverDebts[poolId][trader][solver];
        uint256 totalPayout = debt.principal + debt.accumulatedYield;
        uint256 payableAmount = receivedAmount + extraProceeds;
        // Never repay more than the ledger actually owes the solver.
        if (liqDebt > totalPayout && totalPayout > 0) liqDebt = totalPayout;
        // [P2#8] Emit the partial-liquidation summary HERE while `totalPayout`
        // is still live (its slot is reused by later locals): keeps the inlined
        // partialLiquidation graph under via-ir stack depth.
        emit PositionPartiallyLiquidated(
            poolId, trader, liquidationBpsOf(liqDebt, totalPayout), unwindAmount, liqDebt, receivedAmount
        );
        // Shortfall: insurance covers what the seized collateral could not
        // physically produce; the uncovered remainder books as bad debt.
        if (liqDebt > 0) {
            uint256 shortfall = liqDebt > payableAmount ? liqDebt - payableAmount : 0;
            if (shortfall > 0) {
                // [INSURANCE POLICY] The fund covers at most `insuranceCoverageBps` of the shortfall.
                uint256 coverable = FullMath.mulDiv(shortfall, insuranceCoverageBps, 10000);
                uint256 covered = coverable > insuranceFund[debtCurrency] ? insuranceFund[debtCurrency] : coverable;
                // [FIX FEE-BACKING] Cap at burnable claims (excludes fee/insurance
                // reservation) so insurance coverage never eats fee backing.
                uint256 claimsHeld = _burnableClaims(debtCurrency);
                if (covered > claimsHeld) covered = claimsHeld;
                insuranceFund[debtCurrency] -= covered;
                if (covered > 0) {
                    manager.burn(address(this), uint256(uint160(Currency.unwrap(debtCurrency))), covered);
                    manager.take(debtCurrency, address(this), covered);
                    payableAmount += covered;
                }
                uint256 uncovered = shortfall - covered;
                if (uncovered > 0) {
                    badDebt[debtCurrency] += uncovered;
                    emit BadDebtRecorded(debtCurrency, uncovered);
                }
            }
            uint256 solverPayout = liqDebt > payableAmount ? payableAmount : liqDebt;
            payableAmount -= solverPayout;
            if (solver != address(0)) _payOrCredit(debtCurrency, solver, solverPayout);
        }
        // [P2#8] Direct liquidator share on the partial slice (see _settle).
        // [AUDIT F-07] Floored so a keeper is always paid to act.
        if (liquidator != address(0)) {
            uint256 effBps =
                liquidatorIncentiveBps > LIQUIDATOR_MIN_INCENTIVE_BPS ? liquidatorIncentiveBps : LIQUIDATOR_MIN_INCENTIVE_BPS;
            uint256 lpIncentive = liquidatorReward + traderPayout;
            lpIncentive = (lpIncentive * effBps) / 10000;
            if (lpIncentive > payableAmount) lpIncentive = payableAmount;
            if (lpIncentive > 0) {
                payableAmount -= lpIncentive;
                _payOrCredit(debtCurrency, liquidator, lpIncentive);
            }
        }
        if (liquidatorReward > 0) {
            uint256 liqCredit = liquidatorReward > payableAmount ? payableAmount : liquidatorReward;
            if (liqCredit > 0) {
                payableAmount -= liqCredit;
                insuranceFund[debtCurrency] += liqCredit;
                _settleToManager(debtCurrency, liqCredit);
                manager.mint(address(this), uint256(uint160(Currency.unwrap(debtCurrency))), liqCredit);
            }
        }
        if (traderPayout > 0) {
            uint256 finalTraderPayout = traderPayout > payableAmount ? payableAmount : traderPayout;
            if (finalTraderPayout > 0) {
                payableAmount -= finalTraderPayout;
                _payOrCredit(debtCurrency, trader, finalTraderPayout);
            }
        }
        // [AUDIT N-02] Reconcile the trader's ledger with what the survivor
        // ACTUALLY holds. `collateralAmount - remainingCollateral` is the slice
        // sold plus any collateral the band had already converted into the debt
        // currency (whose proceeds were paid out above). Keeping the old
        // `collateralAmount - unwindAmount` book would over-credit the survivor
        // and later burn claims that are no longer backed by hook holdings.
        uint256 ledgerReduction = collateralAmount > remainingCollateral ? collateralAmount - remainingCollateral : 0;
        if (ledgerReduction > 0) {
            _clearCollateralAccounting(trader, collateralCurrency, ledgerReduction);
        }
        pos.collateralAmount = remainingCollateral;
        pos.borrowedAmount = pos.borrowedAmount > liqDebt ? pos.borrowedAmount - liqDebt : 0;

        if (liqDebt > 0) {
            // [PHASE-0 FIX] Never-reverting open-interest release: this is a
            // counter decrement, and letting the live feed revert here blocked
            // the liquidation itself.
            _releaseOpenInterest(Currency.unwrap(debtCurrency), liqDebt);
            totalBorrowedByToken[debtCurrency] = EswapMarginLib.saturatingSub(totalBorrowedByToken[debtCurrency], liqDebt);
        }
        if (ledgerReduction > 0 && collateralAmount > 0) {
            uint256 removedCollateralUsd =
                FullMath.mulDiv(positionCollateralUSD[poolId][trader], ledgerReduction, collateralAmount);
            uint256 pc = positionCollateralUSD[poolId][trader];
            positionCollateralUSD[poolId][trader] = pc > removedCollateralUsd ? pc - removedCollateralUsd : 0;
            totalCollateralUSDRunning = EswapMarginLib.saturatingSub(totalCollateralUSDRunning, removedCollateralUsd);
        }
        // Reduce the solver debt ledger: principal first, then yield.
        uint256 payPrincipal = liqDebt > debt.principal ? debt.principal : liqDebt;
        debt.principal -= payPrincipal;
        uint256 payYield = liqDebt - payPrincipal;
        if (payYield > 0) {
            debt.accumulatedYield = debt.accumulatedYield > payYield ? debt.accumulatedYield - payYield : 0;
        }
        // Band fully removed; clear stale deployed-principal bookkeeping so a
        // future deploy starts clean.
        rehypPrincipal[poolId][trader] = 0;
    }

    /// @dev Recover the bps share of a partial liquidation for the event.
    function liquidationBpsOf(uint256 part, uint256 whole) internal pure returns (uint256) {
        if (whole == 0) return 0;
        return (part * 10000) / whole;
    }

    /// @dev [AUDIT N-02] Collateral-currency backing a position still owns after
    ///      its LP band was removed and `unwindAmount` was sold. `recovered` is
    ///      the band's collateral-currency return; `retained` is the share that
    ///      never left the accounting pool. Capped at the book so a yield
    ///      distribution cannot inflate the survivor's value, and clamped at zero
    ///      so a fully-drained position cannot underflow.
    function _survivingCollateral(
        PoolKey calldata key,
        BalanceDelta removeDelta,
        Currency collateralCurrency,
        uint256 collateralAmount,
        uint256 deployedPrincipal,
        bool hadBand,
        uint256 unwindAmount
    ) internal pure returns (uint256) {
        uint256 backing = collateralAmount;
        if (hadBand) {
            int128 recoveredInt = Currency.unwrap(collateralCurrency) == Currency.unwrap(key.currency0)
                ? removeDelta.amount0()
                : removeDelta.amount1();
            uint256 recovered = recoveredInt > 0 ? uint256(uint128(recoveredInt)) : 0;
            uint256 retained = collateralAmount > deployedPrincipal ? collateralAmount - deployedPrincipal : 0;
            backing = recovered + retained;
            if (backing > collateralAmount) backing = collateralAmount;
        }
        return backing > unwindAmount ? backing - unwindAmount : 0;
    }

    // ─── Unwind engine (duplicated from Logic2 — see contract notice) ─────────

    /// @dev Unwind-settle a removed LP band. Swaps back only the collateral the
    ///      hook ACTUALLY holds: the band's collateral-currency return PLUS the
    ///      share that never left the accounting pool
    ///      (`collateralAmount - deployedPrincipal`) — never the book
    ///      `collateralAmount`, which drifts with the price (FIX C-14).
    ///      [AUDIT F-03] `enforceFloor` gates the oracle floor. Liquidation paths
    ///      pass `true`: they unwind collateral the owner did not choose to sell,
    ///      so a materially-below-oracle fill is pure value transfer to whoever
    ///      steers the swap. `closePosition` passes `false` so a trader's own exit
    ///      can never be stranded by an unhealthy oracle.
    function _unwindBand(
        PoolKey calldata key,
        PoolId poolId,
        BalanceDelta removeDelta,
        Currency collateralCurrency,
        uint256 collateralAmount,
        uint256 deployedPrincipal,
        bool hadBand,
        uint256 maxUnwind,
        bool enforceFloor
    ) internal returns (uint256 receivedAmount, uint256 bandProceeds, uint256 actualUnwound) {
        bool zeroForOne = Currency.unwrap(collateralCurrency) == Currency.unwrap(key.currency0);
        uint256 availableCollateral = collateralAmount;
        if (hadBand) {
            int128 recoveredCollatInt = zeroForOne ? removeDelta.amount0() : removeDelta.amount1();
            uint256 recovered = recoveredCollatInt > 0 ? uint256(uint128(recoveredCollatInt)) : 0;
            uint256 retained = collateralAmount > deployedPrincipal ? collateralAmount - deployedPrincipal : 0;
            availableCollateral = recovered + retained;
            if (availableCollateral > collateralAmount) availableCollateral = collateralAmount;
        }
        // [P1#3] Partial liquidation unwinds only a capped slice of the available
        // collateral; full close/liquidation pass maxUnwind = type(uint256).max.
        if (availableCollateral > maxUnwind) availableCollateral = maxUnwind;
        actualUnwound = availableCollateral;

        BalanceDelta delta;
        if (availableCollateral > 0) {
            delta = manager.swap(
                _resolveUnwindPool(poolId, key),
                IPoolManager.SwapParams(
                    zeroForOne, -int256(availableCollateral), EswapMarginLib.sqrtPriceLimit(zeroForOne)
                ),
                ""
            );
        }

        int128 receivedDelta = zeroForOne ? delta.amount1() : delta.amount0();
        receivedAmount = receivedDelta > 0 ? uint256(uint128(receivedDelta)) : 0;

        int128 removedDebtInt = zeroForOne ? removeDelta.amount1() : removeDelta.amount0();
        bandProceeds = removedDebtInt > 0 ? uint256(uint128(removedDebtInt)) : 0;

        // [AUDIT F-03] Oracle floor: the realised USD value of everything the
        // unwind recovered for `availableCollateral` must be within
        // MAX_UNWIND_SLIPPAGE_BPS of the oracle value of that collateral.
        // Values are compared in USD so the two currency legs need not share
        // decimals. `_usdOrCache` keeps an oracle outage from re-breaking
        // liquidation liveness (F-05): a stale mark is still far better than
        // letting an adversary name the price. This is a HARD revert for the
        // liquidation paths (the owner did not choose the timing); closePosition
        // stays advisory-only.
        if (enforceFloor && availableCollateral > 0) {
            Currency debtCurrency = zeroForOne ? key.currency1 : key.currency0;
            if (_priceAvailable(Currency.unwrap(debtCurrency)) && _priceAvailable(Currency.unwrap(collateralCurrency))) {
                (uint256 outUsd,) = _usdOrCache(Currency.unwrap(debtCurrency), receivedAmount + bandProceeds);
                (uint256 inUsd,) = _usdOrCache(Currency.unwrap(collateralCurrency), availableCollateral);
                uint256 floorUsd = FullMath.mulDiv(inUsd, 10000 - MAX_UNWIND_SLIPPAGE_BPS, 10000);
                if (inUsd > 0 && outUsd < floorUsd) revert UnwindBelowOracleFloor(outUsd, floorUsd);
            }
        }

        _settleTransientDebt(collateralCurrency, availableCollateral);
    }

    // ─── [AUDIT F-08] Non-reverting payout ───────────────────────────────────

    /// @dev Pays `amount` of `currency` to `to` (or its configured redirect).
    ///      A reverting/failing transfer is CREDITED to `payoutCredits` instead
    ///      of reverting the settlement, so one blacklisted or non-receiving
    ///      recipient can never freeze a position (nor every position funded by a
    ///      blacklisted solver). Pull-claim via `EswapMarginHookLogic.claimPayout`.
    function _payOrCredit(Currency currency, address to, uint256 amount) internal {
        if (amount == 0 || to == address(0)) return;
        address dest = payoutRedirect[to];
        if (dest == address(0)) dest = to;

        bool success;
        if (NativeTokens.isNative(currency)) {
            (success,) = dest.call{value: amount}("");
        } else {
            (bool ok, bytes memory ret) = address(Currency.unwrap(currency)).call(
                abi.encodeCall(IERC20.transfer, (dest, amount))
            );
            uint256 word;
            assembly ("memory-safe") {
                word := mload(add(ret, 32))
            }
            // Empty returndata is a success for non-standard (USDT-style) tokens.
            success = ok && (ret.length == 0 || word != 0);
        }
        if (!success) {
            payoutCredits[to][currency] += amount;
            emit PayoutDeferred(to, currency, amount);
        }
    }

    // ─── Oracle helpers ──────────────────────────────────────────────────────

    /// @dev [AUDIT F-04 liveness] True when `token` can be priced: live feed
    ///      answer or a cached mark. Lets view/gate paths degrade to `false`.
    function _priceAvailable(address token) internal view returns (bool) {
        if (address(priceFeed) != address(0)) {
            uint8 d = tokenDecimals[token];
            if (d == 0) d = 18;
            try priceFeed.getAmountInUsd(token, 10 ** uint256(d)) returns (uint256 value) {
                if (value != 0) return true;
            } catch {}
        }
        return cachedPriceUsd[token] != 0;
    }

    /// @dev [AUDIT F-05] Live oracle value, or the last cached mark when the live
    ///      read reverts. `cached == true` tells the caller the protocol is
    ///      running on a stale price (circuit-breaker mode). Reverts
    ///      `OraclePriceUnavailable` only when neither exists.
    function _usdOrCache(address token, uint256 amount) internal view returns (uint256 usd, bool cached) {
        if (address(priceFeed) != address(0)) {
            try priceFeed.getAmountInUsd(token, amount) returns (uint256 value) {
                return (value, false);
            } catch {}
        }
        uint256 perWhole = cachedPriceUsd[token];
        if (perWhole == 0) revert OraclePriceUnavailable();
        uint8 d = tokenDecimals[token];
        if (d == 0) d = 18;
        usd = FullMath.mulDiv(amount, perWhole, 10 ** uint256(d));
        cached = true;
    }

    /// @dev [AUDIT F-05/F-06] Health check, duplicated from
    ///      EswapMarginHookLogic2.isLiquidatable so the partial-liquidation gate
    ///      and the full-liquidation gate apply the identical formula. A
    ///      delegatecall is not an option here: the keeper's `view` call runs under
    ///      STATICCALL, where any delegatecall aborts.
    function _isLiquidatable(Position memory pos, PoolKey calldata key) internal view returns (bool) {
        if (pos.collateralAmount == 0) return false;

        // [AUDIT F-04 liveness] Unpriced => not actionable, never revert.
        if (!_priceAvailable(Currency.unwrap(_collateralCurrency(pos, key)))) return false;
        if (!_priceAvailable(Currency.unwrap(_debtCurrency(pos, key)))) return false;

        PoolId poolId = key.toId();
        Currency collateral = _collateralCurrency(pos, key);
        bool isCurrency0 = Currency.unwrap(collateral) == Currency.unwrap(key.currency0);
        uint256 collateralAmount = pos.collateralAmount;
        uint256 debtLegRaw;

        uint256 deployed = rehypPrincipal[poolId][pos.trader];
        if (pos.liquidity > 0 && deployed > 0) {
            uint256 retained = collateralAmount > deployed ? collateralAmount - deployed : 0;
            (uint160 sqrtPriceX96,,,) = _slot0(_rehypothecationPool(poolId, key).toId());
            (uint256 amount0, uint256 amount1) = sqrtPriceX96 == 0
                ? (uint256(0), uint256(0))
                : LiquidityAmounts.getAmountsForLiquidity(
                    sqrtPriceX96,
                    TickMath.getSqrtRatioAtTick(pos.tickLower),
                    TickMath.getSqrtRatioAtTick(pos.tickUpper),
                    pos.liquidity
                );
            collateralAmount = (isCurrency0 ? amount0 : amount1) + retained;
            debtLegRaw = isCurrency0 ? amount1 : amount0;
        }

        (uint256 collateralValueUsd, bool breaker) = _usdOrCache(Currency.unwrap(collateral), collateralAmount);
        if (debtLegRaw > 0) {
            (uint256 debtLegUsd, bool breaker2) =
                _usdOrCache(Currency.unwrap(isCurrency0 ? key.currency1 : key.currency0), debtLegRaw);
            collateralValueUsd += debtLegUsd;
            breaker = breaker || breaker2;
        }

        uint256 borrowedValueUsd;
        if (pos.borrowedAmount > 0) {
            bool breaker3;
            (borrowedValueUsd, breaker3) = _usdOrCache(Currency.unwrap(_debtCurrency(pos, key)), pos.borrowedAmount);
            breaker = breaker || breaker3;
        }

        return EswapMarginLib.isLiquidatable(
            collateralValueUsd, borrowedValueUsd, pos.leverage, breaker ? CIRCUIT_BREAKER_BPS : 0
        );
    }

    // ─── Shared helper duplicates ────────────────────────────────────────────

    function _slot0(PoolId id)
        internal
        view
        returns (uint160 sqrtPriceX96, int24 tick, uint16 protocolFee, uint24 lpFee)
    {
        (uint160 price, int24 t, uint24 pFee, uint24 lFee) =
            StateLibrary.getSlot0(RealIPoolManager(address(manager)), RealPoolId.wrap(PoolId.unwrap(id)));
        return (price, t, uint16(pFee), lFee);
    }

    function _distributeRehypothecation(
        PoolKey calldata key,
        BalanceDelta removeDelta,
        Currency collateralCurrency,
        uint256 rehypPrincipal_,
        address recipient
    ) internal {
        if (recipient == address(0)) return;
        int256 recoveredCollateral;
        if (Currency.unwrap(collateralCurrency) == Currency.unwrap(key.currency0)) {
            recoveredCollateral = removeDelta.amount0();
        } else {
            recoveredCollateral = removeDelta.amount1();
        }
        // Yield = what the LP band returned beyond the principal that was
        // actually deployed into it (i.e. the accrued fees).
        int256 yieldAmount =
            recoveredCollateral > int256(rehypPrincipal_) ? recoveredCollateral - int256(rehypPrincipal_) : int256(0);
        if (yieldAmount > 0) {
            if (NativeTokens.isNative(collateralCurrency)) {
                (bool success,) = recipient.call{value: uint256(yieldAmount)}("");
                if (!success) {
                    _creditStrandedYield(collateralCurrency, uint256(yieldAmount));
                }
            } else {
                // [AUDIT HIGH-3] Mirror SafeERC20 semantics: empty return is a
                // success (recipient actually paid), revert or explicit `false`
                // books the yield as insurance.
                (bool ok, bytes memory ret) = address(Currency.unwrap(collateralCurrency)).call(
                    abi.encodeCall(IERC20.transfer, (recipient, uint256(yieldAmount)))
                );
                if (!ok || (ret.length != 0 && !abi.decode(ret, (bool)))) {
                    // [AUDIT N-01] Credit CLAIM-BACKED insurance (settle + mint),
                    // never a bare ledger increment: see
                    // EswapMarginHookLogic2._creditStrandedYield.
                    _creditStrandedYield(collateralCurrency, uint256(yieldAmount));
                }
            }
        }
    }

    /// @dev [AUDIT N-01] Duplicate of Logic2's helper: convert a failed yield
    ///      push into claim-backed insurance by settling the stranded tokens
    ///      into the PoolManager and minting the matching ERC-6909 claim before
    ///      crediting the ledger.
    function _creditStrandedYield(Currency currency, uint256 amount) internal {
        if (amount == 0) return;
        insuranceFund[currency] += amount;
        _settleToManager(currency, amount);
        manager.mint(address(this), uint256(uint160(Currency.unwrap(currency))), amount);
    }

    function _clearCollateralAccounting(address trader, Currency currency, uint256 amount) internal {
        uint256 collateralId = uint256(uint160(Currency.unwrap(currency)));
        if (_claimBalances[trader][collateralId] < amount) revert ERC6909InsufficientBalance();
        _claimBalances[trader][collateralId] -= amount;
        if (totalCollateral[currency] < amount) revert UnsupportedFeature();
        totalCollateral[currency] -= amount;
    }

    function _netLiquidityDelta(PoolKey memory key, BalanceDelta delta) internal {
        _netCurrencyDelta(key.currency0, delta.amount0());
        _netCurrencyDelta(key.currency1, delta.amount1());
    }

    function _netCurrencyDelta(Currency currency, int128 amount) internal {
        if (amount > 0) {
            manager.take(currency, address(this), uint256(int256(amount)));
        } else if (amount < 0) {
            _settleTransientDebt(currency, uint256(int256(-amount)));
        }
    }

    function _settleTransientDebt(Currency currency, uint256 amount) internal {
        uint256 claimId = uint256(uint160(Currency.unwrap(currency)));
        // [FIX FEE-BACKING] Never burn below the ledgered obligation floor.
        uint256 fromClaims = _burnableClaims(currency);
        if (fromClaims > amount) fromClaims = amount;
        if (fromClaims > 0) {
            manager.burn(address(this), claimId, fromClaims);
        }
        if (fromClaims < amount) {
            _settleToManager(currency, amount - fromClaims);
        }
    }

    /// @dev Claims the hook may legitimately burn: its ERC-6909 balance minus the
    ///      PROTOCOL-FEE reservation (mirrors Logic1/Logic2).
    function _burnableClaims(Currency currency) internal view returns (uint256) {
        uint256 held = manager.balanceOf(address(this), uint256(uint160(Currency.unwrap(currency))));
        uint256 reserved = protocolFees[currency];
        return held > reserved ? held - reserved : 0;
    }

    /// @dev Settles a netting delta owed to the PoolManager.
    function _settleToManager(Currency currency, uint256 amount) internal {
        manager.sync(currency);
        if (NativeTokens.isNative(currency)) {
            manager.settle{value: amount}();
        } else {
            IERC20(Currency.unwrap(currency)).safeTransfer(address(manager), amount);
            manager.settle();
        }
    }

    /// @dev [PHASE-0 FIX] Never-reverting open-interest release.
    function _releaseOpenInterest(address token, uint256 amount) internal {
        if (amount == 0 || address(priceFeed) == address(0)) return;
        try priceFeed.getAmountInUsd(token, amount) returns (uint256 usd) {
            totalOpenInterestUSD = EswapMarginLib.saturatingSub(totalOpenInterestUSD, usd);
        } catch {
            return;
        }
    }

    function _rehypothecationPool(PoolId poolId, PoolKey calldata key) internal view returns (PoolKey memory) {
        PoolKey memory sk = standardPoolKeys[poolId];
        if (Currency.unwrap(sk.currency1) != address(0)) return sk;
        // [FIX M-9] When requireStandardPoolKey is set, a position must
        // have a configured standard (deep) pool.
        if (requireStandardPoolKey) revert InvalidStandardPoolKey();
        return key;
    }

    function _resolveUnwindPool(PoolId poolId, PoolKey calldata key) internal view returns (PoolKey memory) {
        PoolKey memory sk = standardPoolKeys[poolId];
        if (Currency.unwrap(sk.currency1) != address(0)) return sk;
        if (requireStandardPoolKey) revert InvalidStandardPoolKey();
        return key;
    }

    function _collateralCurrency(Position memory pos, PoolKey calldata key) internal view returns (Currency) {
        Currency base = baseCurrency[key.toId()];
        if (Currency.unwrap(base) == address(0)) base = key.currency0;
        if (pos.isLong) return base;
        return Currency.unwrap(base) == Currency.unwrap(key.currency0) ? key.currency1 : key.currency0;
    }

    function _debtCurrency(Position memory pos, PoolKey calldata key) internal view returns (Currency) {
        Currency collateral = _collateralCurrency(pos, key);
        return Currency.unwrap(collateral) == Currency.unwrap(key.currency0) ? key.currency1 : key.currency0;
    }
}
