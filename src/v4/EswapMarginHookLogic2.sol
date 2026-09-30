// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BaseHook} from "./BaseHook.sol";
import {IHooks} from "./interfaces/IHooks.sol";
import {IPoolManager} from "./interfaces/IPoolManager.sol";
import {PoolKey} from "./types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "./types/PoolId.sol";
import {Currency} from "./types/Currency.sol";
import {BalanceDelta, BalanceDeltaLibrary} from "./types/BalanceDelta.sol";
import {IPriceFeedLogic, EswapMarginHookLogicStorage} from "./EswapMarginHookLogicStorage.sol";
import {EswapMarginLib} from "./EswapMarginLib.sol";
import {NativeTokens} from "./libraries/NativeTokens.sol";
import {TickMath} from "./libraries/TickMath.sol";
import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";
import {IPoolManager as RealIPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolId as RealPoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {TransientStorage} from "./libraries/TransientStorage.sol";

/**
 * @title EswapMarginHookLogic2
 * @notice Second half of the EIP-170 split of the hook's heavyweight execution
 *         logic. Holds the close / liquidation / partial-liquidation / rebalance
 *         family (unwind + settle engine) that previously lived in
 *         EswapMarginHookLogic, which was 30,528 bytes — over the 24,576-byte
 *         runtime cap and undeployable on a real chain.
 *
 * @dev Storage layout is inherited from EswapMarginHookLogicStorage (identical
 *      to EswapMarginHook and EswapMarginHookLogic). EswapMarginHookLogic's
 *      fallback routes the close/liquidation/rebalance selectors here via
 *      delegatecall. NOT registered as a hook by the PoolManager.
 */
contract EswapMarginHookLogic2 is BaseHook, EswapMarginHookLogicStorage {
    using PoolIdLibrary for PoolKey;
    using PoolIdLibrary for PoolId;
    using BalanceDeltaLibrary for BalanceDelta;
    using SafeERC20 for IERC20;
    using TransientStorage for bytes32;

    modifier onlyRouter() {
        if (msg.sender != router) revert Unauthorized();
        _;
    }

    modifier onlyPoolManager() {
        if (msg.sender != address(manager)) revert NotPoolManager();
        _;
    }

    constructor(IPoolManager _manager, IPriceFeedLogic _priceFeed) BaseHook(_manager) {
        priceFeed = _priceFeed;
    }

    function closePosition(
        PoolKey calldata key,
        address trader,
        address,
        /* solver */
        uint256 minAmountOut
    ) external onlyRouter {
        PoolId poolId = key.toId();
        Position storage pos = positions[poolId][trader];
        if (pos.collateralAmount == 0) revert NoActivePosition();

        Currency collateralCurrency = _collateralCurrency(pos, key);
        Currency debtCurrency = _debtCurrency(pos, key);
        uint256 collateralAmount = pos.collateralAmount;
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

        address yieldRecipient = positionSolver[poolId][trader];
        if (yieldRecipient == address(0)) yieldRecipient = trader;
        _distributeRehypothecation(key, removeDelta, collateralCurrency, rehypPrincipal[poolId][trader], yieldRecipient);

        // [FIX C-14] Unwind-swap only the collateral the hook actually holds:
        // the band's collateral-currency return PLUS the share that never left
        // the accounting pool (`collateralAmount - rehypPrincipal`). Adverse
        // price drift can convert part of the deployed collateral into the DEBT
        // currency, so removing the band can leave the hook holding LESS
        // collateral than the book `collateralAmount`; swapping the full book
        // amount would force _settleTransientDebt to physically transfer
        // collateral tokens the hook never recovered — bricking close and
        // liquidation forever. The converted value is recovered as `bandProceeds`
        // (already taken physically by _netLiquidityDelta) and joins the payout
        // pool, so the trader/solver are still paid their full value. When NO band
        // was ever deployed, the full book `collateralAmount` sits in the
        // accounting pool and is the correct unwind quantity.
        (uint256 receivedAmount, uint256 bandProceeds,) = _unwindBand(
            key,
            poolId,
            removeDelta,
            collateralCurrency,
            collateralAmount,
            rehypPrincipal[poolId][trader],
            hadBand,
            type(uint256).max
        );

        address actualSolver = positionSolver[poolId][trader];
        SolverDebt storage debt = solverDebts[poolId][trader][actualSolver];
        uint256 totalPayout = debt.principal + debt.accumulatedYield;
        if (totalPayout == 0 && pos.borrowedAmount > 0) totalPayout = pos.borrowedAmount;
        uint256 totalSource = receivedAmount + bandProceeds;
        uint256 netToTrader = totalSource >= totalPayout ? totalSource - totalPayout : 0;
        if (netToTrader < minAmountOut) revert SlippageExceeded(netToTrader, minAmountOut);

        _settle(
            poolId,
            trader,
            collateralCurrency,
            debtCurrency,
            collateralAmount,
            receivedAmount,
            actualSolver,
            address(0),
            0,
            netToTrader,
            pos.borrowedAmount,
            bandProceeds
        );
    }

    function executeLiquidation(PoolKey calldata key, address trader, uint256 minAmountOut, address liquidator)
        external
        onlyRouter
    {
        PoolId poolId = key.toId();
        Position storage pos = positions[poolId][trader];
        if (!isLiquidatable(pos, key)) revert PositionNotLiquidatable();

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

        address yieldRecipient = positionSolver[poolId][trader];
        if (yieldRecipient == address(0)) yieldRecipient = trader;
        _distributeRehypothecation(key, removeDelta, collateralCurrency, rehypPrincipal[poolId][trader], yieldRecipient);

        // [FIX C-14] See closePosition/_unwindBand: unwind-swap only the collateral
        // the hook actually holds (band return + accounting-pool remainder),
        // never the book `collateralAmount`, and credit the band's returned DEBT
        // currency value.
        (uint256 receivedAmount, uint256 bandProceeds,) = _unwindBand(
            key,
            poolId,
            removeDelta,
            collateralCurrency,
            collateralAmount,
            rehypPrincipal[poolId][trader],
            hadBand,
            type(uint256).max
        );

        // Guard on the TOTAL recovered value (swap output + band proceeds): a
        // fully-converted band can leave `receivedAmount == 0` while the LP value
        // sits in `bandProceeds` — that is still a valid, fully-payable unwind.
        uint256 totalSource = receivedAmount + bandProceeds;
        if (totalSource == 0) revert SlippageExceeded(0, minAmountOut);
        if (totalSource < minAmountOut) revert SlippageExceeded(totalSource, minAmountOut);

        address solver = positionSolver[poolId][trader];
        uint256 afterSolver;
        {
            SolverDebt storage debt = solverDebts[poolId][trader][solver];
            uint256 sp = debt.principal + debt.accumulatedYield;
            if (sp == 0 && pos.borrowedAmount > 0) sp = pos.borrowedAmount;
            afterSolver = totalSource >= sp ? totalSource - sp : 0;
        }
        uint256 liqReward = (afterSolver * LIQUIDATION_REWARD_BPS) / 10000;

        _settle(
            poolId,
            trader,
            collateralCurrency,
            debtCurrency,
            collateralAmount,
            receivedAmount,
            solver,
            liquidator,
            liqReward,
            afterSolver - liqReward,
            pos.borrowedAmount,
            bandProceeds
        );
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
        if (!isLiquidatable(pos, key)) revert PositionNotLiquidatable();

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
        (uint256 receivedAmount, uint256 bandProceeds, uint256 unwindAmount) = _unwindBand(
            key,
            poolId,
            removeDelta,
            collateralCurrency,
            collateralAmount,
            rehypPrincipal[poolId][trader],
            hadBand,
            liqCollateral
        );

        uint256 totalSource = receivedAmount + bandProceeds;
        if (totalSource == 0) revert SlippageExceeded(0, minAmountOut);
        if (totalSource < minAmountOut) revert SlippageExceeded(totalSource, minAmountOut);

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
        if (unwindAmount < collateralAmount) {
            uint256 remainingCollateral = collateralAmount - unwindAmount;
            uint256 remainingDebt = borrowedAmount > liqDebt ? borrowedAmount - liqDebt : 0;
            if (
                EswapMarginLib.isLiquidatable(
                    _usdValueOf(Currency.unwrap(collateralCurrency), remainingCollateral),
                    _usdValueOf(Currency.unwrap(debtCurrency), remainingDebt),
                    pos.leverage
                )
            ) revert PartialLiquidationLeavesUnhealthyPosition();
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
            collateralAmount
        );
    }

    function rebalancePosition(PoolKey calldata key, address trader) external onlyRouter {
        PoolId poolId = key.toId();
        Position storage pos = positions[poolId][trader];
        if (pos.collateralAmount == 0) return;

        PoolKey memory lpPool = _rehypothecationPool(poolId, key);
        (, int24 currentTick,,) = _slot0(lpPool.toId());
        bool isCurrency0 = Currency.unwrap(_collateralCurrency(pos, key)) == Currency.unwrap(key.currency0);

        if (!_bandConsumed(pos, currentTick, isCurrency0)) return;

        (BalanceDelta removeDelta,) = manager.modifyLiquidity(
            lpPool, IPoolManager.ModifyLiquidityParams(pos.tickLower, pos.tickUpper, -int128(pos.liquidity), 0), ""
        );
        _netLiquidityDelta(lpPool, removeDelta);

        Currency collateralCurrency = _collateralCurrency(pos, key);
        Currency debtCurrency = _debtCurrency(pos, key);

        address yieldRecipient = positionSolver[poolId][trader];
        if (yieldRecipient == address(0)) yieldRecipient = trader;
        _distributeRehypothecation(key, removeDelta, collateralCurrency, rehypPrincipal[poolId][trader], yieldRecipient);

        int128 recoveredCollatInt = isCurrency0 ? removeDelta.amount0() : removeDelta.amount1();
        uint256 availableCollateral = recoveredCollatInt > 0 ? uint256(uint128(recoveredCollatInt)) : 0;
        if (availableCollateral > pos.collateralAmount) {
            availableCollateral = pos.collateralAmount;
        }

        int128 removedDebtInt = isCurrency0 ? removeDelta.amount1() : removeDelta.amount0();
        if (removedDebtInt > 0) {
            uint256 removedDebt = uint256(uint128(removedDebtInt));
            bool zeroForOneBack = Currency.unwrap(debtCurrency) == Currency.unwrap(key.currency0);
            PoolKey memory swapPool = _resolveUnwindPool(key.toId(), key);
            BalanceDelta backDelta = manager.swap(
                swapPool,
                IPoolManager.SwapParams(
                    zeroForOneBack, -SafeCast.toInt256(removedDebt), EswapMarginLib.sqrtPriceLimit(zeroForOneBack)
                ),
                ""
            );
            int128 gotBackInt = zeroForOneBack ? backDelta.amount1() : backDelta.amount0();
            _settleTransientDebt(debtCurrency, removedDebt);
            if (gotBackInt > 0) {
                manager.take(collateralCurrency, address(this), uint256(int256(gotBackInt)));
                availableCollateral += uint256(uint128(gotBackInt));
            }
        }

        // [FIX M-3] Record the ACTUAL recovered principal against the position:
        // impermanent loss can leave the removed LP worth less than the book
        // `collateralAmount` (recovered + swap-back of the debt leg). Keeping the
        // old (larger) book value would settle/liquidate against collateral the
        // vault no longer holds, creating a deficit on close. Writing the
        // physically-recovered amount keeps ledger == vault.
        pos.collateralAmount = availableCollateral;

        (int24 tickLower, int24 tickUpper) = _deploymentTicks(currentTick, key.tickSpacing, isCurrency0);
        uint160 sqrtLower = TickMath.getSqrtRatioAtTick(tickLower);
        uint160 sqrtUpper = TickMath.getSqrtRatioAtTick(tickUpper);
        uint256 sqrtSpan = uint256(sqrtUpper) - uint256(sqrtLower);
        uint256 maxLiquidity;
        if (isCurrency0) {
            maxLiquidity = FullMath.mulDiv(availableCollateral, uint256(sqrtLower), sqrtSpan);
            maxLiquidity = FullMath.mulDiv(maxLiquidity, uint256(sqrtUpper), 1 << 96);
        } else {
            maxLiquidity = FullMath.mulDiv(availableCollateral, 1 << 96, sqrtSpan);
        }
        maxLiquidity = FullMath.mulDiv(maxLiquidity, 9, 10);
        uint128 newLiquidity = pos.liquidity <= maxLiquidity
            ? pos.liquidity
            : (maxLiquidity > uint256(type(uint128).max) ? type(uint128).max : uint128(maxLiquidity));

        if (newLiquidity > 0) {
            (BalanceDelta addDelta,) = manager.modifyLiquidity(
                lpPool, IPoolManager.ModifyLiquidityParams(tickLower, tickUpper, int128(newLiquidity), 0), ""
            );
            _netLiquidityDelta(lpPool, addDelta);
            int128 pDelta = isCurrency0 ? addDelta.amount0() : addDelta.amount1();
            rehypPrincipal[poolId][trader] = pDelta < 0 ? uint256(int256(-pDelta)) : 0;
        } else {
            rehypPrincipal[poolId][trader] = 0;
        }
        pos.tickLower = tickLower;
        pos.tickUpper = tickUpper;
        pos.liquidity = newLiquidity;
    }

    // ─── Internal helpers (shared with EswapMarginHookLogic) ─────────────────

    function _settle(
        PoolId poolId,
        address trader,
        Currency collateralCurrency,
        Currency debtCurrency,
        uint256 collateralAmount,
        uint256 receivedAmount,
        address solver,
        address liquidator,
        uint256 liquidatorReward,
        uint256 traderPayout,
        uint256 borrowedAmount,
        uint256 extraProceeds
    ) internal {
        // [FIX C-1] extraProceeds (e.g. the debt currency the LP band returned) is
        // already held physically by the hook (_netLiquidityDelta took it), so it
        // joins the payout pool without another PoolManager take.
        if (receivedAmount > 0) {
            manager.take(debtCurrency, address(this), receivedAmount);
        }
        SolverDebt storage debt = solverDebts[poolId][trader][solver];
        uint256 totalPayout = debt.principal + debt.accumulatedYield;
        // [AUDIT HIGH-14] When a position owed a borrow but NO solver debt ledger
        // exists (1x positions legitimately; otherwise an edge / partial-cleared
        // path), fall back to the outstanding borrow so the solver is still paid
        // from proceeds. Record the abnormal path for forensics.
        if (totalPayout == 0 && borrowedAmount > 0) {
            totalPayout = borrowedAmount;
            emit SolverDebtFallbackUsed(poolId, trader, borrowedAmount);
        }
        // [FIX C-7] Physical tokens available to cover the solver/trader claims:
        // the unwind proceeds plus whatever the insurance fund covers from the
        // shortfall. Any gap the insurance fund cannot cover is RECORDED as
        // protocol bad debt instead of reverting — a reverted close/liquidation
        // would strand the position (and the trader's collateral) forever.
        uint256 payableAmount = receivedAmount + extraProceeds;
        if (totalPayout > 0) {
            uint256 shortfall = totalPayout > payableAmount ? totalPayout - payableAmount : 0;
            if (shortfall > 0) {
                uint256 claimId = uint256(uint160(Currency.unwrap(debtCurrency)));
                uint256 covered = shortfall > insuranceFund[debtCurrency] ? insuranceFund[debtCurrency] : shortfall;
                // [FIX C-2] Insurance coverage is claim-backed: on the real
                // PoolManager a bare take() debits a transient delta against the
                // hook that never nets, reverting the unlock with
                // CurrencyNotSettled. Burn the hook's own ERC-6909 claim (+delta)
                // before the take (-delta) so extraction nets to zero. Coverage is
                // further capped at the claims actually held so an
                // under-collateralised insurance ledger books bad debt instead of
                // reverting (and stranding) the close/liquidation.
                uint256 claimsHeld = manager.balanceOf(address(this), claimId);
                if (covered > claimsHeld) covered = claimsHeld;
                insuranceFund[debtCurrency] -= covered;
                if (covered > 0) {
                    manager.burn(address(this), claimId, covered);
                    manager.take(debtCurrency, address(this), covered);
                    payableAmount += covered;
                }
                uint256 uncovered = shortfall - covered;
                if (uncovered > 0) {
                    badDebt[debtCurrency] += uncovered;
                    emit BadDebtRecorded(debtCurrency, uncovered);
                }
            }
            if (solver != address(0)) {
                uint256 solverPayout = totalPayout > payableAmount ? payableAmount : totalPayout;
                payableAmount -= solverPayout;
                NativeTokens.transfer(debtCurrency, solver, solverPayout);
            }
        }
        // [P2#8] Optional executor incentive: a bps share of the post-solver surplus
        // (= liquidatorReward + traderPayout) paid DIRECTLY to the liquidator in
        // the debt currency BEFORE the insurance credit/trader payout. 0 by
        // default preserves the H-5b insurance-only routing; enabling it makes
        // liquidations permissionless while the solver claim (above) still takes
        // precedence. Close calls with liquidator == address(0) → never paid.
        if (liquidator != address(0) && liquidatorIncentiveBps > 0) {
            uint256 lpIncentive = liquidatorReward + traderPayout;
            lpIncentive = (lpIncentive * liquidatorIncentiveBps) / 10000;
            if (lpIncentive > payableAmount) lpIncentive = payableAmount;
            if (lpIncentive > 0) {
                payableAmount -= lpIncentive;
                NativeTokens.transfer(debtCurrency, liquidator, lpIncentive);
            }
        }
        // [FIX H-5b] The liquidation reward (300 bps of the post-solver surplus)
        // is credited to the insurance fund, whoever triggers the liquidation and
        // regardless of how it is triggered. The credit is claim-backed exactly
        // like seedInsuranceFund: the physical tokens return to the PoolManager
        // (via _settleToManager) and the hook's ERC-6909 claim is minted to back
        // the ledger, so a later shortfall coverage can burn+take against a real
        // claim. Liveness is provided by the team-operated keeper, the solver
        // (whose claim always takes precedence), and any owner-configured
        // [P2#8] liquidator incentive paid above.
        if (liquidatorReward > 0) {
            uint256 liqCredit = liquidatorReward > payableAmount ? payableAmount : liquidatorReward;
            if (liqCredit > 0) {
                payableAmount -= liqCredit;
                insuranceFund[debtCurrency] += liqCredit;
                uint256 claimId = uint256(uint160(Currency.unwrap(debtCurrency)));
                _settleToManager(debtCurrency, liqCredit);
                manager.mint(address(this), claimId, liqCredit);
            }
        }
        // [FIX C-7] Never transfer the trader more than the physical tokens still
        // available after the solver claim.
        if (traderPayout > 0) {
            uint256 finalTraderPayout = traderPayout > payableAmount ? payableAmount : traderPayout;
            if (finalTraderPayout > 0) {
                payableAmount -= finalTraderPayout;
                NativeTokens.transfer(debtCurrency, trader, finalTraderPayout);
            }
        }
        _clearCollateralAccounting(trader, collateralCurrency, collateralAmount);
        if (borrowedAmount > 0) {
            // [PHASE-0 FIX] Never-reverting open-interest release. The old
            // `_usdValueOf(...)` call here reverted `StalePrice` /
            // `OraclePriceOutOfBounds`, unwinding the ENTIRE settlement —
            // including the payout transfer above — and stranding the trader's
            // collateral whenever the feed was unhealthy. A counter decrement
            // must never be able to block a trader's exit.
            _releaseOpenInterest(Currency.unwrap(debtCurrency), borrowedAmount);
            // [FIX] Keep totalBorrowedByToken in sync: it was previously only
            // incremented on open (registerMarginOpen) and never decremented on
            // close/liquidation, so the ledger drifted upward over time.
            totalBorrowedByToken[debtCurrency] =
                EswapMarginLib.saturatingSub(totalBorrowedByToken[debtCurrency], borrowedAmount);
        }
        totalCollateralUSDRunning =
            EswapMarginLib.saturatingSub(totalCollateralUSDRunning, positionCollateralUSD[poolId][trader]);
        delete positionCollateralUSD[poolId][trader];
        delete positions[poolId][trader];
        delete solverDebts[poolId][trader][solver];
        delete positionSolver[poolId][trader];
        rehypPrincipal[poolId][trader] = 0;
    }

    // ─── [P1#3] Partial-liquidation settlement ───────────────────────────────

    /**
     * @notice Settlement for a PARTIAL liquidation. Unlike _settle this does NOT
     *         delete the position: it shaves `liqDebt` off `borrowedAmount` and
     *         `unwindAmount` off `collateralAmount` (leaving the surviving stake),
     *         repays the solver share with cover-backed proceeds, credits the
     *         liquidation reward to the insurance fund, and pays the remainder to
     *         the liquidator/trader as in a full liquidation.
     * @dev The reduced position keeps its leverage discipline via the fee-bps
     *      check on the next open. The LP band is fully removed for the unwind
     *      and re-established by the next deployCollateral/rebalance call.
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
        uint256 collateralAmount
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
                uint256 covered = shortfall > insuranceFund[debtCurrency] ? insuranceFund[debtCurrency] : shortfall;
                uint256 claimsHeld =
                    manager.balanceOf(address(this), uint256(uint160(Currency.unwrap(debtCurrency))));
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
            if (solver != address(0)) NativeTokens.transfer(debtCurrency, solver, solverPayout);
        }
        // [P2#8] Direct liquidator share on the partial slice (see _settle).
        if (liquidator != address(0) && liquidatorIncentiveBps > 0) {
            uint256 lpIncentive = liquidatorReward + traderPayout;
            lpIncentive = (lpIncentive * liquidatorIncentiveBps) / 10000;
            if (lpIncentive > payableAmount) lpIncentive = payableAmount;
            if (lpIncentive > 0) {
                payableAmount -= lpIncentive;
                NativeTokens.transfer(debtCurrency, liquidator, lpIncentive);
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
                NativeTokens.transfer(debtCurrency, trader, finalTraderPayout);
            }
        }
        // Clear the trader's accounting claim on the LIQUIDATED collateral slice
        // only; the remainder stays backing the surviving position.
        if (unwindAmount > 0) {
            _clearCollateralAccounting(trader, collateralCurrency, unwindAmount);
        }
        pos.collateralAmount = pos.collateralAmount > unwindAmount ? pos.collateralAmount - unwindAmount : 0;
        pos.borrowedAmount = pos.borrowedAmount > liqDebt ? pos.borrowedAmount - liqDebt : 0;

        if (liqDebt > 0) {
            // [PHASE-0 FIX] Never-reverting open-interest release: this is a
            // counter decrement, and letting the live feed revert here blocked
            // the liquidation itself.
            _releaseOpenInterest(Currency.unwrap(debtCurrency), liqDebt);
            totalBorrowedByToken[debtCurrency] = EswapMarginLib.saturatingSub(totalBorrowedByToken[debtCurrency], liqDebt);
        }
        if (unwindAmount > 0 && collateralAmount > 0) {
            uint256 removedCollateralUsd =
                FullMath.mulDiv(positionCollateralUSD[poolId][trader], unwindAmount, collateralAmount);
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
        // actually deployed into it (i.e. the accrued fees), NOT beyond the
        // whole position collateral (which would always be zero here).
        int256 yieldAmount =
            recoveredCollateral > int256(rehypPrincipal_) ? recoveredCollateral - int256(rehypPrincipal_) : int256(0);
        if (yieldAmount > 0) {
            if (NativeTokens.isNative(collateralCurrency)) {
                (bool success,) = recipient.call{value: uint256(yieldAmount)}("");
                if (!success) {
                    insuranceFund[collateralCurrency] += uint256(yieldAmount);
                }
            } else {
                // [AUDIT HIGH-3] Raw IERC20.transfer + abi.decode(bool) misrouted
                // non-standard tokens (USDT-style empty returns) into a failure,
                // silently donating the solver's LP yield to the insurance fund.
                // Mirror SafeERC20.safeTransfer semantics with a low-level call:
                // an empty return is treated as SUCCESS (recipient actually paid),
                // while a revert or explicit `false` books the yield as insurance.
                (bool ok, bytes memory ret) = address(Currency.unwrap(collateralCurrency)).call(
                    abi.encodeCall(IERC20.transfer, (recipient, uint256(yieldAmount)))
                );
                if (!ok || (ret.length != 0 && !abi.decode(ret, (bool)))) {
                    insuranceFund[collateralCurrency] += uint256(yieldAmount);
                }
            }
        }
    }

    function _clearCollateralAccounting(address trader, Currency currency, uint256 amount) internal {
        uint256 collateralId = uint256(uint160(Currency.unwrap(currency)));
        if (_claimBalances[trader][collateralId] < amount) revert ERC6909InsufficientBalance();
        _claimBalances[trader][collateralId] -= amount;
        if (totalCollateral[currency] < amount) revert UnsupportedFeature();
        totalCollateral[currency] -= amount;
    }

    function _bandConsumed(Position storage pos, int24 currentTick, bool isCurrency0) internal view returns (bool) {
        if (currentTick < pos.tickLower || currentTick >= pos.tickUpper) return true;
        int256 width = int256(uint256(uint24(pos.tickUpper - pos.tickLower)));
        int256 consumed = isCurrency0
            ? int256(uint256(uint24(currentTick - pos.tickLower)))
            : int256(uint256(uint24(pos.tickUpper - currentTick)));
        return uint256(consumed) * 10000 >= uint256(width) * bandConsumptionTriggerBps;
    }

    function _deploymentTicks(int24 currentTick, int24 spacing, bool isCurrency0)
        internal
        pure
        returns (int24 lower, int24 upper)
    {
        int24 q = currentTick / spacing;
        int24 r = currentTick % spacing;
        if (r != 0 && currentTick < 0) q -= 1;
        int24 floorGrid = q * spacing;
        int24 ceilGrid = (r != 0) ? floorGrid + spacing : floorGrid;
        if (isCurrency0) {
            return (ceilGrid, ceilGrid + spacing * 10);
        }
        return (floorGrid - spacing * 10, floorGrid);
    }

    function isLiquidatable(Position memory pos, PoolKey calldata key) public view returns (bool) {
        if (pos.collateralAmount == 0) return false;
        uint256 collateralValueUsd =
            priceFeed.getAmountInUsd(Currency.unwrap(_collateralCurrency(pos, key)), pos.collateralAmount);
        uint256 borrowedValueUsd =
            priceFeed.getAmountInUsd(Currency.unwrap(_debtCurrency(pos, key)), pos.borrowedAmount);
        return EswapMarginLib.isLiquidatable(collateralValueUsd, borrowedValueUsd, pos.leverage);
    }

    function _rehypothecationPool(PoolId poolId, PoolKey calldata key) internal view returns (PoolKey memory) {
        PoolKey memory sk = standardPoolKeys[poolId];
        if (Currency.unwrap(sk.currency1) != address(0)) return sk;
        // [FIX M-9] When requireStandardPoolKey is set, a position must
        // have a configured standard (deep) pool — no silent fallback to the
        // hook's own accounting pool.
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

    function _baseCurrency(PoolKey calldata key) internal view returns (Currency) {
        Currency base = baseCurrency[key.toId()];
        return Currency.unwrap(base) == address(0) ? key.currency0 : base;
    }

    function _isLong(PoolKey calldata key, Currency boughtCurrency) internal view returns (bool) {
        return Currency.unwrap(boughtCurrency) == Currency.unwrap(_baseCurrency(key));
    }

    /// @dev Unwind-settle a removed LP band. Swaps back only the collateral the
    ///      hook ACTUALLY holds: the band's collateral-currency return PLUS the
    ///      share that never left the accounting pool
    ///      (`collateralAmount - deployedPrincipal`) — never the book
    ///      `collateralAmount`, which drifts with the price (FIX C-14). When no
    ///      band was ever deployed, the full book `collateralAmount` sits in the
    ///      accounting pool and is the correct unwind quantity. Then settles the
    ///      transient delta. Returns (`receivedAmount`, `bandProceeds`): the
    ///      unwind-swap output plus the value the band returned in the DEBT
    ///      currency (FIX C-1 — already held physically, so the caller just adds
    ///      it to the payout pool).
    function _unwindBand(
        PoolKey calldata key,
        PoolId poolId,
        BalanceDelta removeDelta,
        Currency collateralCurrency,
        uint256 collateralAmount,
        uint256 deployedPrincipal,
        bool hadBand,
        uint256 maxUnwind
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

        _settleTransientDebt(collateralCurrency, availableCollateral);
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
        uint256 fromClaims = manager.balanceOf(address(this), claimId);
        if (fromClaims > amount) fromClaims = amount;
        if (fromClaims > 0) {
            manager.burn(address(this), claimId, fromClaims);
        }
        if (fromClaims < amount) {
            _settleToManager(currency, amount - fromClaims);
        }
    }

    /// @dev Settles a netting delta owed to the PoolManager. Native: settle via
    ///      msg.value (ETH already held by the hook); ERC20: sync+transfer+settle.
    function _settleToManager(Currency currency, uint256 amount) internal {
        manager.sync(currency);
        if (NativeTokens.isNative(currency)) {
            manager.settle{value: amount}();
        } else {
            IERC20(Currency.unwrap(currency)).safeTransfer(address(manager), amount);
            manager.settle();
        }
    }

    function _slot0(PoolId id)
        internal
        view
        returns (uint160 sqrtPriceX96, int24 tick, uint16 protocolFee, uint24 lpFee)
    {
        (uint160 price, int24 t, uint24 pFee, uint24 lFee) =
            StateLibrary.getSlot0(RealIPoolManager(address(manager)), RealPoolId.wrap(PoolId.unwrap(id)));
        return (price, t, uint16(pFee), lFee);
    }

    function _usdValueOf(address token, uint256 amount) internal view returns (uint256) {
        if (address(priceFeed) == address(0)) return 0;
        return priceFeed.getAmountInUsd(token, amount);
    }

    /// @dev [PHASE-0 FIX] Release `amount` of `token` from the open-interest
    ///      counter WITHOUT ever reverting. `PriceFeed._getValidatedPrice`
    ///      reverts `StalePrice` / `OraclePriceOutOfBounds`, so a bare
    ///      `getAmountInUsd` on the close/liquidation path made an entire
    ///      settlement revert — stranding the trader's collateral and blocking
    ///      the exit — over what is only a counter update. Degrades to no-op when
    ///      the feed is unhealthy, leaving `totalOpenInterestUSD` conservatively
    ///      HIGH and therefore under-allocating OI capacity. Deliberately NOT
    ///      used on the open path, where a stale feed must still hard-block entry.
    function _releaseOpenInterest(address token, uint256 amount) internal {
        if (amount == 0 || address(priceFeed) == address(0)) return;
        try priceFeed.getAmountInUsd(token, amount) returns (uint256 usd) {
            totalOpenInterestUSD = EswapMarginLib.saturatingSub(totalOpenInterestUSD, usd);
        } catch {
            return;
        }
    }

    function _getKey(bytes32 base, address trader) internal pure returns (bytes32) {
        return keccak256(abi.encode(base, trader));
    }

    function _registerCurrency(Currency currency) internal {
        if (!isCurrencyRegistered[currency]) {
            isCurrencyRegistered[currency] = true;
            registeredCurrencies.push(currency);
        }
    }

    function _protocolFeeFor(address trader) internal view returns (uint256) {
        uint256 custom = addressProtocolFeeBps[trader];
        return custom > 0 ? custom : reserveFactor;
    }

    /// @dev [EIP-170 rebalance] Hosted here (instead of EswapMarginHook, which had
    ///       creaked past the 24,576 runtime cap) so the router's unlocks can open
    ///       positions. Mirrors the semantics previously living in the hook: the
    ///       PoolManager invokes this via the hook's fallback → delegatecall, so it
    ///       runs against the hook's shared storage and transient slots.
    function afterSwap(address, PoolKey calldata key, IPoolManager.SwapParams calldata params, BalanceDelta delta, bytes calldata data)
        external
        override
        onlyPoolManager
        returns (bytes4, int128)
    {
        // Record last oracle sqrtPriceX96 for oracle price-capping test
        (uint160 sqrtPriceX96,,,) = _slot0(key.toId());
        if (sqrtPriceX96 > 0) lastOraclePrice[key.toId()] = sqrtPriceX96;

        if (data.length == 0) return (IHooks.afterSwap.selector, 0);

        (bool isMargin,, address trader) = abi.decode(data, (bool, uint8, address));
        if (isMargin && trader != address(0)) {
            uint256 borrow = _getKey(BORROW_BASE, trader).tloadUint();
            // Delta is provided from the swapper's perspective: the received currency
            // is positive (the output of the swap), regardless of zeroForOne direction.
            int128 rawAmount = params.zeroForOne ? delta.amount1() : delta.amount0();
            if (rawAmount <= 0) revert SwapOutputZero();
            uint256 boughtAmount = uint256(int256(rawAmount));
            Currency boughtCurrency = params.zeroForOne ? key.currency1 : key.currency0;

            // STEP 2: Custom Accounting & Hook-Held Collateral (ERC-6909)
            // The Router mints the collateral as ERC-6909 claims held by THIS hook
            // (the custodian) inside the unlock callback. No mint here: minting in
            // afterSwap would create an unpayable -amount delta for the hook against
            // the real PoolManager (CurrencyNotSettled at unlock exit).
            uint256 protocolReserve = (boughtAmount * _protocolFeeFor(trader)) / 10000;
            uint256 positionCollateral = boughtAmount - protocolReserve;

            protocolFees[boughtCurrency] += protocolReserve;
            // Hook-side ledger of trader-held collateral claims (mirrors the
            // ERC-6909 claims the router mints to this hook on the PM singleton).
            _claimBalances[trader][uint256(uint160(Currency.unwrap(boughtCurrency)))] += positionCollateral;
            totalCollateral[boughtCurrency] += positionCollateral;

            // [FIX M-1] Track USD value at open time so beforeSwap can use O(1) lookup
            if (positionCollateral > 0) {
                uint256 collateralUsd = _usdValueOf(Currency.unwrap(boughtCurrency), positionCollateral);
                totalCollateralUSDRunning += collateralUsd;
                positionCollateralUSD[key.toId()][trader] = collateralUsd;
            }

            _registerCurrency(boughtCurrency);
            // Track borrow for protocol-wide health view
            Currency borrowedToken = params.zeroForOne ? key.currency0 : key.currency1;
            totalBorrowedByToken[borrowedToken] += borrow;
            _registerCurrency(borrowedToken);

            if (borrow > 0) {
                uint256 tradeOIUsd = _usdValueOf(Currency.unwrap(borrowedToken), borrow);
                totalOpenInterestUSD += tradeOIUsd;
            }

            positions[key.toId()][trader] = Position({
                trader: trader,
                collateralAmount: positionCollateral,
                borrowedAmount: borrow,
                leverage: uint8(_getKey(LEVERAGE_BASE, trader).tloadUint()),
                isLong: _isLong(key, boughtCurrency),
                liquidationSqrtPrice: 0,
                tickLower: 0,
                tickUpper: 0,
                liquidity: 0
            });

            _getKey(TRADER_BASE, trader).tstore(address(0));
            emit HookSwap(key.toId(), trader, delta.amount0(), delta.amount1(), 0);
        }
        return (IHooks.afterSwap.selector, 0);
    }
}