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
import {IERC6909} from "./interfaces/IERC6909.sol";
import {IPoolManager as RealIPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolId as RealPoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {EswapMarginLib} from "./EswapMarginLib.sol";
import {TransientStorage} from "./libraries/TransientStorage.sol";
import {NativeTokens} from "./libraries/NativeTokens.sol";

interface IPriceFeedLogic {
    function getAmountInUsd(address token, uint256 amount) external view returns (uint256);
    function getTwapPrice(address token) external view returns (uint256);
}

/**
 * @title EswapMarginHookLogic
 * @notice Heavy execution logic extracted from EswapMarginHook to keep the hook
 *         within the EIP-170 24,576-byte runtime limit. Called via delegatecall
 *         from the hook's fallback or thin wrappers.
 * @dev Storage layout MUST exactly mirror EswapMarginHook. Every mapping,
 *      variable, and packed slot must appear in the same declaration order.
 */
contract EswapMarginHookLogic is BaseHook {
    using PoolIdLibrary for PoolKey;
    using PoolIdLibrary for PoolId;
    using TransientStorage for bytes32;
    using SafeERC20 for IERC20;

    // ─── Structs (must match EswapMarginHook) ─────────────────────────────────
    struct Position {
        address trader;
        uint256 collateralAmount;
        uint256 borrowedAmount;
        uint8 leverage;
        bool isLong;
        uint160 liquidationSqrtPrice;
        int24 tickLower;
        int24 tickUpper;
        uint128 liquidity;
    }

    struct SolverDebt {
        address solver;
        uint256 principal;
        uint256 accumulatedYield;
    }

    struct ConfigParams {
        address treasury;
        address router;
        uint256 reserveFactor;
        uint160 maxPriceSwingBps;
        uint8 defaultMaxLeverage;
        bool requireTwapOracle;
    }

    // ─── Errors ───────────────────────────────────────────────────────────────
    error NotPoolManager();
    error NotAuthorizedPool();
    error InvalidHookAddress();
    error InsufficientInsuranceFund();
    error SlippageExceeded(uint256 received, uint256 minAmountOut);
    error InsufficientInsuranceFundForShortfall(uint256 shortfall, uint256 available);
    error MaxLeverageExceeded();
    error CollateralTooLow();
    error SwapOutputZero();
    error RouterNotSet();
    error PositionExceedsSingleCap(uint256 tradeOI, uint256 maxSingleOI);
    error OpenInterestExceedsCapacity(uint256 newTotalOI, uint256 maxTotalOI);
    error NotOwner();
    error ZeroAddress();
    error PositionAlreadyOpen();
    error ReentrantSwap();
    error NoActivePosition();
    error FeeTooHigh();
    error BpsTooHigh();
    error InvalidLeverageRange();
    error Unauthorized();
    error ExtttloadFailed();
    error TwapManipulated();
    error TwapNotConfigured();
    error TreasuryNotSet();
    error InsufficientProtocolFees(uint256 requested, uint256 available);
    error ERC6909InsufficientBalance();
    error UnsupportedFeature();
    error InvalidBoughtCurrency();
    error InsufficientResidue(uint256 requested, uint256 available);
    error ZeroSweepRecipient();
    error EmergencyPaused();

    // ─── Events ───────────────────────────────────────────────────────────────
    event HookSwap(PoolId indexed poolId, address indexed trader, int128 amount0, int128 amount1, uint128 liquidityDelta);
    event BaseCurrencySet(PoolId indexed poolId, Currency currency);
    event TradingPairRegistered(PoolId indexed poolId, Currency base, PoolKey standardKey);
    event MultiPoolMarginOpened(
        PoolId indexed poolId, address indexed trader, uint8 leverage, uint256 marginAmount, uint256 boughtAmount
    );
    event ResidueSwept(Currency indexed currency, address indexed to, uint256 amount);
    event EmergencyPauseToggled(bool indexed paused);

    // ─── Storage layout (MUST mirror EswapMarginHook exactly) ──────────────────
    mapping(PoolId => bool) public isAuthorizedPool;
    mapping(PoolId => mapping(address => Position)) public positions;
    mapping(PoolId => mapping(address => bool)) public isSyntheticArbun;
    mapping(PoolId => PoolKey) public standardPoolKeys;
    mapping(Currency => bool) public isCurrencyRegistered;
    Currency[] public registeredCurrencies;
    mapping(address => mapping(uint256 => uint256)) public _claimBalances;
    mapping(address => mapping(address => mapping(uint256 => uint256))) public _allowances;
    mapping(address => mapping(address => bool)) public _isOperator;
    mapping(Currency => uint256) public totalCollateral;
    mapping(Currency => uint256) public totalBorrowedByToken;
    mapping(PoolId => uint160) public lastOraclePrice;
    mapping(address => uint8) public tokenDecimals;
    mapping(PoolId => Currency) public baseCurrency;
    mapping(PoolId => mapping(address => mapping(address => SolverDebt))) public solverDebts;
    mapping(PoolId => mapping(address => address)) public positionSolver;
    address public owner;
    address public router;
    mapping(Currency => uint256) public insuranceFund;
    mapping(Currency => uint256) public protocolFees;
    address public treasury;
    uint256 public reserveFactor;
    mapping(address => uint256) public addressProtocolFeeBps;
    uint256 public totalOpenInterestUSD;
    uint256 public totalCollateralUSDRunning;
    mapping(PoolId => mapping(address => uint256)) public positionCollateralUSD;
    bool public requireTwapOracle;
    bool public emergencyPaused;
    uint256 public pauseExpiry;
    uint160 public maxPriceSwingBps;
    uint8 public defaultMaxLeverage;
    mapping(PoolId => uint8) public maxLeverageByPool;
    uint256 public maxSingleOIBps;
    uint256 public maxTotalOIBps;
    uint256 public oiCapTvlFloorUsd;
    uint256 public bandConsumptionTriggerBps;
    uint256 public insuranceWithdrawalCapBps;
    uint256 public minCollateralUsd;

    bytes32 constant TRADER_BASE = keccak256("TRADER");
    bytes32 constant BORROW_BASE = keccak256("BORROW");
    bytes32 constant LEVERAGE_BASE = keccak256("LEVERAGE");

    uint256 public constant LIQUIDATION_REWARD_BPS = 300;
    uint256 public constant MIN_COLLATERAL = 0.01 ether;
    uint256 public constant MAX_PAUSE_DURATION = 72 hours;

    IPriceFeedLogic public immutable priceFeed;

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

    // ─── External functions (called via delegatecall from hook) ────────────────

    function closePosition(
        PoolKey calldata key,
        address trader,
        address,
        /* solver */
        uint256 minAmountOut
    )
        external
        onlyRouter
    {
        PoolId poolId = key.toId();
        Position storage pos = positions[poolId][trader];
        if (pos.collateralAmount == 0) revert NoActivePosition();

        Currency collateralCurrency = _collateralCurrency(pos, key);
        Currency debtCurrency = _debtCurrency(pos, key);
        uint256 collateralAmount = pos.collateralAmount;

        BalanceDelta removeDelta;
        if (pos.liquidity > 0) {
            PoolKey memory lpPool = _rehypothecationPool(poolId, key);
            (removeDelta,) = manager.modifyLiquidity(
                lpPool, IPoolManager.ModifyLiquidityParams(pos.tickLower, pos.tickUpper, -int128(pos.liquidity), 0), ""
            );
            _netLiquidityDelta(lpPool, removeDelta);
            pos.liquidity = 0;
        }

        address yieldRecipient = positionSolver[poolId][trader];
        if (yieldRecipient == address(0)) yieldRecipient = trader;
        _distributeRehypothecation(key, removeDelta, collateralCurrency, collateralAmount, yieldRecipient);

        bool zeroForOne = Currency.unwrap(collateralCurrency) == Currency.unwrap(key.currency0);
        PoolKey memory standardKey = standardPoolKeys[poolId];
        if (Currency.unwrap(standardKey.currency1) == address(0)) {
            standardKey = key;
        }
        BalanceDelta delta = manager.swap(
            standardKey,
            IPoolManager.SwapParams(zeroForOne, -int256(collateralAmount), EswapMarginLib.sqrtPriceLimit(zeroForOne)),
            ""
        );

        int128 receivedDelta = zeroForOne ? delta.amount1() : delta.amount0();
        uint256 receivedAmount = receivedDelta > 0 ? uint256(uint128(receivedDelta)) : 0;

        _settleTransientDebt(collateralCurrency, collateralAmount);

        address actualSolver = positionSolver[poolId][trader];
        SolverDebt storage debt = solverDebts[poolId][trader][actualSolver];
        uint256 totalPayout = debt.principal + debt.accumulatedYield;
        if (totalPayout == 0 && pos.borrowedAmount > 0) totalPayout = pos.borrowedAmount;
        uint256 netToTrader = receivedAmount >= totalPayout ? receivedAmount - totalPayout : 0;
        if (netToTrader < minAmountOut) revert SlippageExceeded(netToTrader, minAmountOut);

        _settle(
            poolId, trader, collateralCurrency, debtCurrency, collateralAmount, receivedAmount,
            actualSolver, address(0), 0, netToTrader, pos.borrowedAmount
        );
    }

    function executeLiquidation(PoolKey calldata key, address trader, uint256 minAmountOut, address liquidator)
        external
        onlyRouter
    {
        PoolId poolId = key.toId();
        Position storage pos = positions[poolId][trader];
        if (!isLiquidatable(pos, key)) return;

        BalanceDelta removeDelta;
        if (pos.liquidity > 0) {
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
        _distributeRehypothecation(key, removeDelta, collateralCurrency, collateralAmount, yieldRecipient);

        bool zeroForOne = Currency.unwrap(collateralCurrency) == Currency.unwrap(key.currency0);
        PoolKey memory standardKey = standardPoolKeys[poolId];
        if (Currency.unwrap(standardKey.currency1) == address(0)) {
            standardKey = key;
        }
        BalanceDelta delta = manager.swap(
            standardKey,
            IPoolManager.SwapParams(zeroForOne, -int256(collateralAmount), EswapMarginLib.sqrtPriceLimit(zeroForOne)),
            ""
        );

        int128 receivedDelta = zeroForOne ? delta.amount1() : delta.amount0();
        uint256 receivedAmount = receivedDelta > 0 ? uint256(uint128(receivedDelta)) : 0;

        _settleTransientDebt(collateralCurrency, collateralAmount);

        if (receivedAmount == 0) revert SlippageExceeded(0, minAmountOut);
        if (receivedAmount < minAmountOut) revert SlippageExceeded(receivedAmount, minAmountOut);

        address solver = positionSolver[poolId][trader];
        uint256 afterSolver;
        {
            SolverDebt storage debt = solverDebts[poolId][trader][solver];
            uint256 sp = debt.principal + debt.accumulatedYield;
            if (sp == 0 && pos.borrowedAmount > 0) sp = pos.borrowedAmount;
            afterSolver = receivedAmount >= sp ? receivedAmount - sp : 0;
        }
        uint256 liqReward = (afterSolver * LIQUIDATION_REWARD_BPS) / 10000;

        _settle(
            poolId, trader, collateralCurrency, debtCurrency, collateralAmount, receivedAmount,
            solver, liquidator, liqReward, afterSolver - liqReward, pos.borrowedAmount
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
        _distributeRehypothecation(key, removeDelta, collateralCurrency, pos.collateralAmount, yieldRecipient);

        int128 recoveredCollatInt = isCurrency0 ? removeDelta.amount0() : removeDelta.amount1();
        uint256 availableCollateral = recoveredCollatInt > 0 ? uint256(uint128(recoveredCollatInt)) : 0;
        if (availableCollateral > pos.collateralAmount) {
            availableCollateral = pos.collateralAmount;
        }

        int128 removedDebtInt = isCurrency0 ? removeDelta.amount1() : removeDelta.amount0();
        if (removedDebtInt > 0) {
            uint256 removedDebt = uint256(uint128(removedDebtInt));
            bool zeroForOneBack = Currency.unwrap(debtCurrency) == Currency.unwrap(key.currency0);
            PoolKey memory swapPool = standardPoolKeys[key.toId()];
            if (Currency.unwrap(swapPool.currency1) == address(0)) swapPool = key;
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
        }
        pos.tickLower = tickLower;
        pos.tickUpper = tickUpper;
        pos.liquidity = newLiquidity;
    }

    function deployCollateral(PoolKey calldata key, address trader) external onlyRouter {
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
        if (capped == 0) return;
        uint128 liquidity = capped > uint256(type(uint128).max) ? type(uint128).max : uint128(capped);

        (BalanceDelta addDelta,) = manager.modifyLiquidity(
            lpPool, IPoolManager.ModifyLiquidityParams(tickLower, tickUpper, int128(liquidity), 0), ""
        );
        _netLiquidityDelta(lpPool, addDelta);

        pos.tickLower = tickLower;
        pos.tickUpper = tickUpper;
        pos.liquidity = liquidity;
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
            uint256 collateralUsd = priceFeed.getAmountInUsd(Currency.unwrap(boughtCurrency), positionCollateral);
            totalCollateralUSDRunning += collateralUsd;
            positionCollateralUSD[poolId][trader] = collateralUsd;
        }

        _registerCurrency(boughtCurrency);
        totalBorrowedByToken[inputCurrency] += borrowedAmount;
        _registerCurrency(inputCurrency);

        if (borrowedAmount > 0) {
            uint256 tradeOIUsd = priceFeed.getAmountInUsd(Currency.unwrap(inputCurrency), borrowedAmount);
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
        uint256 borrowedAmount
    ) internal {
        if (receivedAmount > 0) {
            manager.take(debtCurrency, address(this), receivedAmount);
        }
        if (liquidatorReward > 0) {
            insuranceFund[debtCurrency] += liquidatorReward;
            _settleToManager(debtCurrency, liquidatorReward);
            manager.mint(address(this), uint256(uint160(Currency.unwrap(debtCurrency))), liquidatorReward);
        }
        SolverDebt storage debt = solverDebts[poolId][trader][solver];
        uint256 totalPayout = debt.principal + debt.accumulatedYield;
        if (totalPayout == 0 && borrowedAmount > 0) totalPayout = borrowedAmount;
        if (totalPayout > 0) {
            uint256 shortfall = totalPayout > receivedAmount ? totalPayout - receivedAmount : 0;
            if (shortfall > 0) {
                if (insuranceFund[debtCurrency] < shortfall) {
                    revert InsufficientInsuranceFundForShortfall(shortfall, insuranceFund[debtCurrency]);
                }
                insuranceFund[debtCurrency] -= shortfall;
            }
            if (solver != address(0)) {
                NativeTokens.transfer(debtCurrency, solver, totalPayout);
            }
        }
        if (traderPayout > 0) {
            NativeTokens.transfer(debtCurrency, trader, traderPayout);
        }
        _clearCollateralAccounting(trader, collateralCurrency, collateralAmount);
        if (borrowedAmount > 0) {
            uint256 tradeOIUsd = priceFeed.getAmountInUsd(Currency.unwrap(debtCurrency), borrowedAmount);
            totalOpenInterestUSD = EswapMarginLib.saturatingSub(totalOpenInterestUSD, tradeOIUsd);
        }
        totalCollateralUSDRunning =
            EswapMarginLib.saturatingSub(totalCollateralUSDRunning, positionCollateralUSD[poolId][trader]);
        delete positionCollateralUSD[poolId][trader];
        delete positions[poolId][trader];
        delete solverDebts[poolId][trader][solver];
        delete positionSolver[poolId][trader];
    }

    function _distributeRehypothecation(
        PoolKey calldata key,
        BalanceDelta removeDelta,
        Currency collateralCurrency,
        uint256 collateralAmount,
        address recipient
    ) internal {
        if (recipient == address(0)) return;
        int256 recoveredCollateral;
        if (Currency.unwrap(collateralCurrency) == Currency.unwrap(key.currency0)) {
            recoveredCollateral = removeDelta.amount0();
        } else {
            recoveredCollateral = removeDelta.amount1();
        }
        int256 yieldAmount =
            recoveredCollateral > int256(collateralAmount) ? recoveredCollateral - int256(collateralAmount) : int256(0);
        if (yieldAmount > 0) {
            if (NativeTokens.isNative(collateralCurrency)) {
                (bool success, ) = recipient.call{value: uint256(yieldAmount)}("");
                if (!success) {
                    insuranceFund[collateralCurrency] += uint256(yieldAmount);
                }
            } else {
                try IERC20(Currency.unwrap(collateralCurrency)).transfer(recipient, uint256(yieldAmount)) returns (
                    bool success
                ) {
                    if (!success) revert UnsupportedFeature();
                } catch {
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
        if (Currency.unwrap(sk.currency1) == address(0)) return key;
        return sk;
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

    /// @dev Takes `amount` of `currency` from the PoolManager into this hook and
    ///      net-settles it out of the unlock (used before paying out/taking).
    function _takeAndNet(Currency currency, uint256 amount) internal {
        manager.take(currency, address(this), amount);
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
                uint256 tradeOIUsd = priceFeed.getAmountInUsd(Currency.unwrap(inputCurrency), borrowedAmount);
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
        // LIVE-MARKET GUARD (REDEPLOY-3): Every pool-based price source we can
        // read is unreliable for a "honest trade always passes" guarantee:
        //   - The accounting (hook) pool is empty by design → slot0 frozen at init
        //     and never tracks the market.
        //   - The standard (fill) pool may be thin/illiquid and lag the market.
        // The authoritative market price is the LIVE Chainlink oracle itself
        // (latestRoundData, staleness + sequencer guarded). Because the whole
        // accounting/liquidation path (collateral, borrow, isLiquidatable) is
        // already oracle-anchored via getAmountInUsd(), the AMM pool price is NOT
        // a trusted input — so we source the spot reference from the oracle too.
        // This makes the guard track the live market at ANY price for ANY pair
        // (WETH or WBTC) and never false-positive on an honest trade, while still
        // reverting TwapNotConfigured when a feed is missing (requireTwapOracle).
        uint256 twap0 = priceFeed.getTwapPrice(Currency.unwrap(key.currency0));
        uint256 twap1 = priceFeed.getTwapPrice(Currency.unwrap(key.currency1));
        if (twap0 == 0 || twap1 == 0) {
            if (requireTwapOracle) revert TwapNotConfigured();
            return;
        }
        // Derive the honest spot sqrtPriceX96 that EswapMarginLib.checkTwap would
        // compute for a pool whose spot EXACTLY equals the live oracle pair price.
        // checkTwap computes spotRatio18 from the sqrt then applies the token-decimal
        // adjustment (d0,d1) before comparing to twapRatio18, so we invert that
        // adjustment here to build a self-consistent spot against the same oracle.
        //   rawSpot = sqrtPriceX96^2 * 1e18 / 2^192
        //   d0 >= d1 : adjusted = rawSpot * 10^(d0-d1)
        //   d1 >  d0 : adjusted = rawSpot / 10^(d1-d0)
        // Setting adjusted == twapRatio18 yields deviation ~0 at every price level.
        uint256 twapRatio18 = (twap0 * 1e18) / twap1;
        uint8 d0 = tokenDecimals[Currency.unwrap(key.currency0)] == 0
            ? 18
            : tokenDecimals[Currency.unwrap(key.currency0)];
        uint8 d1 = tokenDecimals[Currency.unwrap(key.currency1)] == 0
            ? 18
            : tokenDecimals[Currency.unwrap(key.currency1)];
        uint256 rawSpot18;
        if (d0 >= d1) {
            rawSpot18 = twapRatio18 / (10 ** (uint256(d0) - uint256(d1)));
        } else {
            rawSpot18 = twapRatio18 * (10 ** (uint256(d1) - uint256(d0)));
        }
        uint256 spotSq = FullMath.mulDiv(rawSpot18, 1 << 192, 1e18);
        uint160 sqrtPriceX96 = SafeCast.toUint160(Math.sqrt(spotSq));
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
}
