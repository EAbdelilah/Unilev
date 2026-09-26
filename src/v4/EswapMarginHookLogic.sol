// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BaseHook} from "./BaseHook.sol";
import {IPoolManager} from "./interfaces/IPoolManager.sol";
import {IHooks} from "./interfaces/IHooks.sol";
import {PoolKey} from "./types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "./types/PoolId.sol";
import {Currency} from "./types/Currency.sol";
import {BalanceDelta, BalanceDeltaLibrary} from "./types/BalanceDelta.sol";
import {HookFlags} from "./libraries/HookFlags.sol";
import {TickMath} from "./libraries/TickMath.sol";
import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";
import {TickMath as RealTickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {IERC6909} from "./interfaces/IERC6909.sol";
import {IPoolManager as RealIPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolId as RealPoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {Lock} from "@uniswap/v4-core/src/libraries/Lock.sol";
import {IExttload} from "@uniswap/v4-core/src/interfaces/IExttload.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {EswapMarginLib} from "./EswapMarginLib.sol";
import {TransientStorage} from "./libraries/TransientStorage.sol";
import {NativeTokens} from "./libraries/NativeTokens.sol";

import {IPriceFeedLogic, EswapMarginHookLogicStorage} from "./EswapMarginHookLogicStorage.sol";
import {EswapMarginHookLogic2} from "./EswapMarginHookLogic2.sol";

/**
 * @title EswapMarginHookLogic
 * @notice Heavy execution logic extracted from EswapMarginHook to keep the hook
 *         within the EIP-170 24,576-byte runtime limit. Called via delegatecall
 *         from the hook's fallback or thin wrappers. Holds the open / deploy /
 *         insurance-staking surface. The close / liquidation / rebalance family
 *         lives in EswapMarginHookLogic2, routed here through this contract's
 *         fallback. Storage layout is inherited from EswapMarginHookLogicStorage
 *         and MUST exactly mirror EswapMarginHook.
 */
contract EswapMarginHookLogic is BaseHook, EswapMarginHookLogicStorage {
    using PoolIdLibrary for PoolKey;
    using PoolIdLibrary for PoolId;
    using BalanceDeltaLibrary for BalanceDelta;
    using SafeERC20 for IERC20;

    // ─── Types, errors, events, storage, constants ───────────────────────────
    // All inherited from EswapMarginHookLogicStorage (single source of truth).

    modifier onlyRouter() {
        if (msg.sender != router) revert Unauthorized();
        _;
    }

    modifier onlyRouterOrManager() {
        if (msg.sender != router && msg.sender != address(manager)) revert Unauthorized();
        _;
    }

    modifier onlyPoolManager() {
        if (msg.sender != address(manager)) revert NotPoolManager();
        _;
    }

    constructor(IPoolManager _manager, IPriceFeedLogic _priceFeed, address _logic2) BaseHook(_manager) {
        priceFeed = _priceFeed;
        logic2 = _logic2;
    }

    // ─── External functions (called via delegatecall from hook) ────────────────
    // Close / liquidation / partial-liquidation / rebalance now live in
    // EswapMarginHookLogic2, routed via this contract's fallback.

    /// @dev Tagged payload for self-wrapped `deployCollateral` calls. Mixed into

    function deployCollateral(PoolKey calldata key, address trader) external onlyRouterOrManager {
        if (!_pmUnlocked()) {
            // [FIX SELF-CLOSE] Mining flows (live self-close) call the hook
            // outside a PoolManager unlock. `modifyLiquidity` on the real
            // PoolManager reverts `ManagerLocked` there, so wrap the deploy
            // into an unlock: the PoolManager invokes this hook's
            // `unlockCallback` with the tagged payload, which re-enters
            // `deployCollateral` (msg.sender == manager, lock now open) and
            // executes the body directly.
            manager.unlock(abi.encode(DEPLOY_TAG, key, trader));
            return;
        }

        Position storage pos = positions[key.toId()][trader];
        if (pos.collateralAmount == 0 || pos.liquidity > 0) return;

        PoolKey memory lpPool = _rehypothecationPool(key.toId(), key);
        (, int24 currentTick,,) = _slot0(lpPool.toId());
        bool isCurrency0 = Currency.unwrap(_collateralCurrency(pos, key)) == Currency.unwrap(key.currency0);
        (int24 tickLower, int24 tickUpper) = _deploymentTicks(currentTick, key.tickSpacing, isCurrency0);

        uint160 sqrtLower = TickMath.getSqrtRatioAtTick(tickLower);
        uint160 sqrtUpper = TickMath.getSqrtRatioAtTick(tickUpper);
        uint256 sqrtSpan = uint256(sqrtUpper) - uint256(sqrtLower);
        uint256 maxLiquidity;
        if (isCurrency0) {
            maxLiquidity = FullMath.mulDiv(pos.collateralAmount, uint256(sqrtLower), sqrtSpan);
            maxLiquidity = FullMath.mulDiv(maxLiquidity, uint256(sqrtUpper), 1 << 96);
        } else {
            maxLiquidity = FullMath.mulDiv(pos.collateralAmount, 1 << 96, sqrtSpan);
        }
        uint256 capped = FullMath.mulDiv(maxLiquidity, 9, 10);
        if (capped == 0) {
            rehypPrincipal[key.toId()][trader] = 0;
            return;
        }
        uint128 liquidity = capped > uint256(type(uint128).max) ? type(uint128).max : uint128(capped);

        (BalanceDelta addDelta,) = manager.modifyLiquidity(
            lpPool, IPoolManager.ModifyLiquidityParams(tickLower, tickUpper, int128(liquidity), 0), ""
        );
        _netLiquidityDelta(lpPool, addDelta);

        int128 principalInt = isCurrency0 ? addDelta.amount0() : addDelta.amount1();
        rehypPrincipal[key.toId()][trader] = principalInt < 0 ? uint256(int256(-principalInt)) : 0;

        pos.tickLower = tickLower;
        pos.tickUpper = tickUpper;
        pos.liquidity = liquidity;
    }

    // ─── [P1#6] Yield-bearing insurance fund (LP staking) ─────────────────────

    /**
     * @notice [P1#6] Stakes idle insurance claims as full-range LP liquidity in
     *         the pool's deep STANDARD venue, where real swap fees accrue. The
     *         staked principal is bounded per currency to
     *         INSURANCE_STAKE_MAX_BPS of `insuranceFund` so shortfall coverage
     *         always retains claim-backed availability. Yield is realised back
     *         into `insuranceFund` on unstake (fees earned > principal removed).
     * @dev Owner-triggered. Unlike position collateral, the insurance fund holds
     *      NO position; it is LP liquidity owned by the hook itself. Self-wraps
     *      in an unlock when called outside the PoolManager (DEPLOY_TAG pattern).
     */
    function insuranceStake(PoolKey calldata hookKey, uint128 maxLiquidity) external {
        if (!_pmUnlocked()) {
            manager.unlock(abi.encode(INSURANCE_STAKE_TAG, hookKey, maxLiquidity));
            return;
        }
        PoolId poolId = hookKey.toId();
        PoolKey memory std = _insuranceStandardKey(hookKey, poolId);
        int24 tickLower;
        int24 tickUpper;
        if (insuranceStakedLiquidity[poolId] > 0) {
            // Additional stake must land on the EXISTING band (matches the LP
            // already in place); only the first stake anchors the band.
            tickLower = insuranceTickLower[poolId];
            tickUpper = insuranceTickUpper[poolId];
        } else {
            (, int24 currentTick,,) = _slot0(std.toId());
            (tickLower, tickUpper) = _insuranceTicks(currentTick, std.tickSpacing);
            insuranceTickLower[poolId] = tickLower;
            insuranceTickUpper[poolId] = tickUpper;
        }
        uint160 sqrtLower = RealTickMath.getSqrtPriceAtTick(tickLower);
        uint160 sqrtUpper = RealTickMath.getSqrtPriceAtTick(tickUpper);
        uint256 cap0 = _availableForStake(std.currency0);
        uint256 cap1 = _availableForStake(std.currency1);
        if (cap0 == 0 && cap1 == 0) revert NothingToStake();
        uint128 l0 = _liqFromAmount0(cap0, sqrtLower, sqrtUpper);
        uint128 l1 = _liqFromAmount1(cap1, sqrtLower, sqrtUpper);
        uint128 liquidity = l0 < l1 ? l0 : l1;
        if (maxLiquidity > 0 && maxLiquidity < liquidity) liquidity = maxLiquidity;
        if (liquidity == 0) revert NothingToStake();
        (BalanceDelta addDelta,) = manager.modifyLiquidity(
            std, IPoolManager.ModifyLiquidityParams(tickLower, tickUpper, int128(liquidity), 0), ""
        );
        _netLiquidityDelta(std, addDelta);
        uint256 funded0 = addDelta.amount0() < 0 ? uint256(int256(-addDelta.amount0())) : 0;
        uint256 funded1 = addDelta.amount1() < 0 ? uint256(int256(-addDelta.amount1())) : 0;
        if (funded0 > cap0 || funded1 > cap1) revert StakeCapExceeded();
        // Ledger bookkeeping: the staked share of the obligation is no longer
        // claim-backed (it lives in LP), so move it from `insuranceFund` to
        // `insuranceStaked`. Unstake credits it back (+ any fees). This keeps
        // insuranceFund + insuranceStaked equal to the claim-backed basis and
        // never double-counts the principal.
        insuranceFund[std.currency0] = insuranceFund[std.currency0] - funded0;
        insuranceFund[std.currency1] = insuranceFund[std.currency1] - funded1;
        insuranceStakedLiquidity[poolId] += liquidity;
        insuranceStakedInPool[poolId][std.currency0] += funded0;
        insuranceStakedInPool[poolId][std.currency1] += funded1;
        insuranceStaked[std.currency0] += funded0;
        insuranceStaked[std.currency1] += funded1;
        emit InsuranceStaked(poolId, std.currency0, funded0, std.currency1, funded1, liquidity);
    }

    /**
     * @notice [P1#6] Removes (all or part) of the insurance fund's staked LP
     *         liquidity and credits the FULL removed value — principal plus any
     *         accrued swap fees — back to `insuranceFund` as claim-backed funds.
     */
    function insuranceUnstake(PoolKey calldata hookKey, uint128 liquidity) external {
        if (!_pmUnlocked()) {
            manager.unlock(abi.encode(INSURANCE_UNSTAKE_TAG, hookKey, liquidity));
            return;
        }
        PoolId poolId = hookKey.toId();
        PoolKey memory std = _insuranceStandardKey(hookKey, poolId);
        uint128 stakedLiq = insuranceStakedLiquidity[poolId];
        if (stakedLiq == 0 || liquidity == 0) revert NothingToUnstake();
        if (liquidity > stakedLiq) liquidity = stakedLiq;
        int24 tickLower = insuranceTickLower[poolId];
        int24 tickUpper = insuranceTickUpper[poolId];
        (BalanceDelta removeDelta,) = manager.modifyLiquidity(
            std, IPoolManager.ModifyLiquidityParams(tickLower, tickUpper, -int128(liquidity), 0), ""
        );
        _netLiquidityDelta(std, removeDelta);
        uint256 removed0 = removeDelta.amount0() > 0 ? uint256(int256(removeDelta.amount0())) : 0;
        uint256 removed1 = removeDelta.amount1() > 0 ? uint256(int256(removeDelta.amount1())) : 0;
        (uint256 p0, uint256 p1) =
            (insuranceStakedInPool[poolId][std.currency0], insuranceStakedInPool[poolId][std.currency1]);
        // Reduce the principal ledgers PROPORTIONALLY to the liquidity share
        // removed; the full removed value (principal + fees) is credited back.
        uint256 p0Share = stakedLiq > 0 ? (p0 * liquidity) / stakedLiq : 0;
        uint256 p1Share = stakedLiq > 0 ? (p1 * liquidity) / stakedLiq : 0;
        insuranceStaked[std.currency0] -= p0Share;
        insuranceStaked[std.currency1] -= p1Share;
        insuranceStakedInPool[poolId][std.currency0] = p0 - p0Share;
        insuranceStakedInPool[poolId][std.currency1] = p1 - p1Share;
        insuranceStakedLiquidity[poolId] = stakedLiq - liquidity;
        _creditInsurance(std.currency0, removed0);
        _creditInsurance(std.currency1, removed1);
        emit InsuranceUnstaked(poolId, std.currency0, removed0, std.currency1, removed1, liquidity);
    }

    /// @dev Resolves the authoritative deep standard venue for `hookKey` from the
    ///      governance-configured mapping (standardPoolKeys[hookKey.toId()]). The
    ///      caller can never redirect staking to an arbitrary same-pair venue.
    function _insuranceStandardKey(PoolKey calldata hookKey, PoolId poolId) internal view returns (PoolKey memory std) {
        std = standardPoolKeys[poolId];
        if (Currency.unwrap(std.currency1) == address(0)) revert InvalidStandardPoolKey();
    }

    function _insuranceTicks(int24 currentTick, int24 spacing) internal pure returns (int24 lower, int24 upper) {
        int24 q = currentTick / spacing;
        int24 r = currentTick % spacing;
        if (r != 0 && currentTick < 0) q -= 1;
        int24 floorGrid = q * spacing;
        int24 half = INSURANCE_STAKE_RANGE_SPACINGS * spacing;
        lower = floorGrid - half;
        upper = floorGrid + half;
        int24 minTick = RealTickMath.minUsableTick(spacing);
        int24 maxTick = RealTickMath.maxUsableTick(spacing);
        if (lower < minTick) lower = minTick;
        if (upper > maxTick) upper = maxTick;
    }

    function _availableForStake(Currency currency) internal view returns (uint256) {
        // [AUDIT MED-5] The cap is a live fraction of `insuranceFund`. If a
        // coverage draw down drops the fund below the already-staked principal,
        // this returns 0 (no further staking) — the over-cap state is benign
        // because the staked principal physically lives in the LP band and is
        // credited back in full on unstake. New stakes are additionally guarded
        // by the `StakeCapExceeded` check in `insuranceStake`.
        uint256 cap = (insuranceFund[currency] * INSURANCE_STAKE_MAX_BPS) / 10000;
        return insuranceStaked[currency] >= cap ? 0 : cap - insuranceStaked[currency];
    }

    function _liqFromAmount0(uint256 amount0, uint160 sqrtLower, uint160 sqrtUpper) internal pure returns (uint128) {
        uint256 span = uint256(sqrtUpper) - uint256(sqrtLower);
        if (span == 0 || amount0 == 0) return 0;
        uint256 L = FullMath.mulDiv(amount0, uint256(sqrtLower), span);
        L = FullMath.mulDiv(L, uint256(sqrtUpper), 1 << 96);
        return L > uint256(type(uint128).max) ? type(uint128).max : uint128(L);
    }

    function _liqFromAmount1(uint256 amount1, uint160 sqrtLower, uint160 sqrtUpper) internal pure returns (uint128) {
        uint256 span = uint256(sqrtUpper) - uint256(sqrtLower);
        if (span == 0 || amount1 == 0) return 0;
        uint256 L = FullMath.mulDiv(amount1, 1 << 96, span);
        return L > uint256(type(uint128).max) ? type(uint128).max : uint128(L);
    }

    /// @dev Credits removed staking proceeds back to the insurance fund as
    ///      claim-backed funds (settle into the manager, then mint the 6909 claim).
    function _creditInsurance(Currency currency, uint256 amount) internal {
        if (amount == 0) return;
        insuranceFund[currency] += amount;
        manager.sync(currency);
        if (NativeTokens.isNative(currency)) {
            manager.settle{value: amount}();
        } else {
            IERC20(Currency.unwrap(currency)).safeTransfer(address(manager), amount);
            manager.settle();
        }
        manager.mint(address(this), uint256(uint160(Currency.unwrap(currency))), amount);
    }

    /// @dev Whether the PoolManager's transient unlock lock is currently open.
    ///      On the real (Exttload) PoolManager the lock is tracked in transient
    ///      storage; the test/legacy mock reports the standard locked slot as
    ///      always open via `exttload`/`extsload` overrides.
    function _pmUnlocked() internal view returns (bool) {
        return IExttload(address(manager)).exttload(Lock.IS_UNLOCKED_SLOT) != bytes32(0);
    }

    function registerMarginOpen(
        PoolKey calldata key,
        address trader,
        uint8 leverage,
        uint256 marginAmount,
        uint256 borrowedAmount,
        Currency boughtCurrency,
        uint256 boughtAmount
    ) external onlyRouter {
        _checkEmergencyPause();
        PoolId poolId = key.toId();
        if (!isAuthorizedPool[poolId]) revert NotAuthorizedPool();
        if (
            Currency.unwrap(boughtCurrency) != Currency.unwrap(key.currency0)
                && Currency.unwrap(boughtCurrency) != Currency.unwrap(key.currency1)
        ) revert InvalidBoughtCurrency();
        if (boughtAmount == 0) revert SwapOutputZero();

        Currency inputCurrency =
            Currency.unwrap(boughtCurrency) == Currency.unwrap(key.currency0) ? key.currency1 : key.currency0;
        _validateOpen(key, trader, leverage, inputCurrency, marginAmount, borrowedAmount);

        uint256 protocolReserve = (boughtAmount * protocolFeeFor(trader)) / 10000;
        uint256 positionCollateral = boughtAmount - protocolReserve;

        protocolFees[boughtCurrency] += protocolReserve;
        _claimBalances[trader][uint256(uint160(Currency.unwrap(boughtCurrency)))] += positionCollateral;
        totalCollateral[boughtCurrency] += positionCollateral;

        if (positionCollateral > 0) {
            uint256 collateralUsd = _usdValueOf(Currency.unwrap(boughtCurrency), positionCollateral);
            totalCollateralUSDRunning += collateralUsd;
            positionCollateralUSD[poolId][trader] = collateralUsd;
        }

        _registerCurrency(boughtCurrency);
        totalBorrowedByToken[inputCurrency] += borrowedAmount;
        _registerCurrency(inputCurrency);

        if (borrowedAmount > 0) {
            uint256 tradeOIUsd = _usdValueOf(Currency.unwrap(inputCurrency), borrowedAmount);
            totalOpenInterestUSD += tradeOIUsd;
        }

        positions[poolId][trader] = Position({
            trader: trader,
            collateralAmount: positionCollateral,
            borrowedAmount: borrowedAmount,
            leverage: leverage,
            isLong: _isLong(key, boughtCurrency),
            liquidationSqrtPrice: 0,
            tickLower: 0,
            tickUpper: 0,
            liquidity: 0
        });

        emit MultiPoolMarginOpened(poolId, trader, leverage, marginAmount, boughtAmount);
    }

    // ─── Internal helpers (same logic as EswapMarginHook) ─────────────────────
    // _settle / _settlePartial / _unwindBand / _distributeRehypothecation /
    // _clearCollateralAccounting / _bandConsumed / _resolveUnwindPool and the
    // close/liquidation/rebalance engine now live in EswapMarginHookLogic2.

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

    function _getKey(bytes32 base, address trader) internal pure returns (bytes32) {
        return keccak256(abi.encode(base, trader));
    }

    function _registerCurrency(Currency currency) internal {
        if (!isCurrencyRegistered[currency]) {
            isCurrencyRegistered[currency] = true;
            registeredCurrencies.push(currency);
        }
    }

    function _checkEmergencyPause() internal {
        if (!emergencyPaused) return;
        if (block.timestamp >= pauseExpiry) {
            emergencyPaused = false;
            pauseExpiry = 0;
            return;
        }
        revert EmergencyPaused();
    }

    function _collateralOk(address token, uint256 marginAmount) internal view returns (bool) {
        return EswapMarginLib.collateralOk(
            address(priceFeed), token, marginAmount, minCollateralUsd, MIN_COLLATERAL, tokenDecimals[token]
        );
    }

    function _maxLeverageForPool(PoolId poolId) internal view returns (uint8) {
        uint8 override_ = maxLeverageByPool[poolId];
        return override_ > 0 ? override_ : defaultMaxLeverage;
    }

    function _tokenDecimalsSafe(address token) internal view returns (uint8 d) {
        (bool ok, bytes memory ret) = token.staticcall(abi.encodeWithSignature("decimals()"));
        d = (ok && ret.length >= 32) ? uint8(uint256(abi.decode(ret, (uint256)))) : 18;
    }

    function _usdValueOf(address token, uint256 amount) internal view returns (uint256) {
        if (address(priceFeed) == address(0)) return 0;
        return priceFeed.getAmountInUsd(token, amount);
    }

    function protocolFeeFor(address trader) public view returns (uint256) {
        uint256 custom = addressProtocolFeeBps[trader];
        return custom > 0 ? custom : reserveFactor;
    }

    function _validateOpen(
        PoolKey calldata key,
        address trader,
        uint8 leverage,
        Currency inputCurrency,
        uint256 marginAmount,
        uint256 borrowedAmount
    ) internal view {
        PoolId poolId = key.toId();
        if (leverage == 0 || leverage > _maxLeverageForPool(poolId)) revert MaxLeverageExceeded();
        if (positions[poolId][trader].collateralAmount != 0) revert PositionAlreadyOpen();
        if (!_collateralOk(Currency.unwrap(inputCurrency), marginAmount)) revert CollateralTooLow();
        _checkV4SpotAgainstV3Twap(key);
        if (leverage > 1) {
            (bool capsActive, uint256 maxSingleOI, uint256 remainingOI) = _oiCapacity();
            if (capsActive) {
                uint256 tradeOIUsd = _usdValueOf(Currency.unwrap(inputCurrency), borrowedAmount);
                if (tradeOIUsd > maxSingleOI) {
                    revert PositionExceedsSingleCap(tradeOIUsd, maxSingleOI);
                }
                if (tradeOIUsd > remainingOI) {
                    revert OpenInterestExceedsCapacity(
                        totalOpenInterestUSD + tradeOIUsd, totalOpenInterestUSD + remainingOI
                    );
                }
            }
        }
    }

    function _oiCapacity() internal view returns (bool active, uint256 maxSingleUsd, uint256 remainingUsd) {
        uint256 poolTVL = totalCollateralUSDRunning;
        if (poolTVL <= oiCapTvlFloorUsd) return (false, 0, 0);
        maxSingleUsd = FullMath.mulDiv(poolTVL, maxSingleOIBps, 10000);
        uint256 maxTotalUsd = FullMath.mulDiv(poolTVL, maxTotalOIBps, 10000);
        remainingUsd = maxTotalUsd > totalOpenInterestUSD ? maxTotalUsd - totalOpenInterestUSD : 0;
        active = true;
    }

    function _checkV4SpotAgainstV3Twap(PoolKey calldata key) internal view {
        // LIVE-MARKET GUARD (REDEPLOY-3, [FIX H-2]): compare the REAL V4 spot
        // price of the EXECUTION venue — the configured standard (deep fill) pool
        // — against the Chainlink-anchored TWAP ratio. The accounting (hook) pool
        // is empty by design (slot0 frozen at init, never tracks the market), so
        // it carries no honest spot: for accounting-only pairs the guard degrades
        // to verifying the oracle is configured (requireTwapOracle) and otherwise
        // passes — the accounting/liquidation path is oracle-anchored anyway via
        // getAmountInUsd(). When a standard pool IS configured, its live slot0 is a
        // genuine independent market read, so deviation > maxPriceSwingBps from the
        // oracle TWAP (e.g. a flash-manipulated or stale fill venue) reverts the
        // trade instead of silently executing against a bad price.
        // [REDEPLOY-3b] The hook is deployable WITHOUT a price feed
        // (priceFeed == address(0), e.g. a testnet with no Chainlink feeds and
        // requireTwapOracle=false). A low-level call to address(0) returns EMPTY
        // returndata, so an unguarded interface call would revert on ABI decode
        // even though an absent oracle is tolerated when requireTwapOracle=false.
        // _tryTwap treats the missing feed exactly like a zero TWAP: skipped when
        // the oracle is not required, TwapNotConfigured when it is.
        uint256 twap0 = _tryTwap(Currency.unwrap(key.currency0));
        uint256 twap1 = _tryTwap(Currency.unwrap(key.currency1));
        if (twap0 == 0 || twap1 == 0) {
            if (requireTwapOracle) revert TwapNotConfigured();
            return;
        }

        PoolKey memory execKey = standardPoolKeys[key.toId()];
        if (Currency.unwrap(execKey.currency1) == address(0)) {
            // Accounting-only pool: no execution venue to protect; the frozen
            // slot0 would false-positive on any real market move.
            return;
        }

        (uint160 sqrtPriceX96,,,) = _slot0(execKey.toId());
        if (sqrtPriceX96 == 0) {
            if (requireTwapOracle) revert TwapNotConfigured();
            return;
        }
        EswapMarginLib.checkTwap(
            address(priceFeed),
            key,
            sqrtPriceX96,
            tokenDecimals[Currency.unwrap(key.currency0)],
            tokenDecimals[Currency.unwrap(key.currency1)],
            maxPriceSwingBps,
            requireTwapOracle
        );
    }

    /// @dev Safe oracle read for _checkV4SpotAgainstV3Twap: returns 0 when the
    ///      feed is unset (address(0)) or the call fails, so an optional oracle
    ///      can never brick position opens when requireTwapOracle=false.
    function _tryTwap(address token) internal view returns (uint256) {
        if (address(priceFeed) == address(0)) return 0;
        try priceFeed.getTwapPrice(token) returns (uint256 value) {
            return value;
        } catch {
            return 0;
        }
    }

    // ─── EIP-170 split: route the close/liquidation/rebalance family ──────────

    /// @dev The close / liquidation / partial-liquidation / rebalance surface was
    ///      split into EswapMarginHookLogic2 (TWO logic contracts each under the
    ///      EIP-170 24,576-byte cap instead of one 30,528-byte undeployable
    ///      contract). Those selectors are forwarded here via delegatecall; the
    ///      target address is written by EswapMarginHook's constructor into the
    ///      shared `logic2` storage slot (this call stack's host storage).
    fallback() external payable {
        if (msg.data.length < 4) revert UnsupportedFeature();
        bytes4 sig = bytes4(msg.data[0:4]);
        if (
            sig != EswapMarginHookLogic2.closePosition.selector
                && sig != EswapMarginHookLogic2.executeLiquidation.selector
                && sig != EswapMarginHookLogic2.partialLiquidation.selector
                && sig != EswapMarginHookLogic2.rebalancePosition.selector
        ) {
            revert UnsupportedFeature();
        }
        address target = logic2;
        assembly {
            calldatacopy(0, 0, calldatasize())
            let result := delegatecall(gas(), target, 0, calldatasize(), 0, 0)
            returndatacopy(0, 0, returndatasize())
            switch result
            case 0 { revert(0, returndatasize()) }
            default { return(0, returndatasize()) }
        }
    }
}
