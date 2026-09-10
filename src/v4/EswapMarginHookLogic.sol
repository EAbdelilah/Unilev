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
import {Lock} from "@uniswap/v4-core/src/libraries/Lock.sol";
import {IExttload} from "@uniswap/v4-core/src/interfaces/IExttload.sol";
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
    error PositionNotLiquidatable();
    error InvalidStandardPoolKey();

    // ─── Events ───────────────────────────────────────────────────────────────
    event HookSwap(PoolId indexed poolId, address indexed trader, int128 amount0, int128 amount1, uint128 liquidityDelta);
    event BaseCurrencySet(PoolId indexed poolId, Currency currency);
    event TradingPairRegistered(PoolId indexed poolId, Currency base, PoolKey standardKey);
    event MultiPoolMarginOpened(
        PoolId indexed poolId, address indexed trader, uint8 leverage, uint256 marginAmount, uint256 boughtAmount
    );
    event ResidueSwept(Currency indexed currency, address indexed to, uint256 amount);
    event EmergencyPauseToggled(bool indexed paused);
    event BadDebtRecorded(Currency indexed currency, uint256 amount);

    // ─── Storage layout (MUST mirror EswapMarginHook exactly) ──────────────────
    mapping(PoolId => bool) public isAuthorizedPool;
    mapping(PoolId => mapping(address => Position)) public positions;

    /// @dev Raw principal (in the collateral currency) currently rehypothecated
    ///      as the LP band for a position. When the band is removed, LP proceeds
    ///      beyond this principal (the accrued fees) are paid to the solver.
    mapping(PoolId => mapping(address => uint256)) public rehypPrincipal;
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
    uint256 public minCollateralUsd;
    uint256 public bandConsumptionTriggerBps;
    uint256 public maxSingleOIBps;
    uint256 public maxTotalOIBps;
    uint256 public oiCapTvlFloorUsd;
    uint256 public insuranceWithdrawalCapBps;
    // [FIX C-7] Uncovered liquidation/close shortfall (insurance insufficient) is
    // recorded as protocol bad debt instead of bricking the position forever.
    mapping(Currency => uint256) public badDebt;
    // [FIX M-9] When true, close/liquidation/rebalance unwind swaps require a
    // configured standard (deep) pool — no silent fallback to the accounting pool.
    bool public requireStandardPoolKey;
    // [FIX C-9] Per-currency cooldown for withdrawInsuranceFund (1 withdrawal/day).
    mapping(Currency => uint256) public lastInsuranceWithdrawal;

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

    modifier onlyRouterOrManager() {
        if (msg.sender != router && msg.sender != address(manager)) revert Unauthorized();
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
        (uint256 receivedAmount, uint256 bandProceeds) =
            _unwindBand(key, poolId, removeDelta, collateralCurrency, collateralAmount, rehypPrincipal[poolId][trader], hadBand);

        address actualSolver = positionSolver[poolId][trader];
        SolverDebt storage debt = solverDebts[poolId][trader][actualSolver];
        uint256 totalPayout = debt.principal + debt.accumulatedYield;
        if (totalPayout == 0 && pos.borrowedAmount > 0) totalPayout = pos.borrowedAmount;
        uint256 totalSource = receivedAmount + bandProceeds;
        uint256 netToTrader = totalSource >= totalPayout ? totalSource - totalPayout : 0;
        if (netToTrader < minAmountOut) revert SlippageExceeded(netToTrader, minAmountOut);

        _settle(
            poolId, trader, collateralCurrency, debtCurrency, collateralAmount, receivedAmount,
            actualSolver, address(0), 0, netToTrader, pos.borrowedAmount, bandProceeds
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
        (uint256 receivedAmount, uint256 bandProceeds) =
            _unwindBand(key, poolId, removeDelta, collateralCurrency, collateralAmount, rehypPrincipal[poolId][trader], hadBand);

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
            poolId, trader, collateralCurrency, debtCurrency, collateralAmount, receivedAmount,
            solver, liquidator, liqReward, afterSolver - liqReward, pos.borrowedAmount, bandProceeds
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

    /// @dev Tagged payload for self-wrapped `deployCollateral` calls. Mixed into
    ///      the first word of the unlock payload so it can never collide with the
    ///      legacy `(Currency, int128, bool)` unpause/seed encoding.
    uint256 private constant DEPLOY_TAG = uint256(keccak256("DEPLOY_COLLATERAL"));

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
        rehypPrincipal[key.toId()][trader] =
            principalInt < 0 ? uint256(int256(-principalInt)) : 0;

        pos.tickLower = tickLower;
        pos.tickUpper = tickUpper;
        pos.liquidity = liquidity;
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
        if (totalPayout == 0 && borrowedAmount > 0) totalPayout = borrowedAmount;
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
        // [FIX H-5] Pay the liquidator their reward OUT of the physically
        // recovered funds. Previously the reward was minted 100% into the
        // insurance fund, so keepers earned nothing for liquidating — positions
        // could sit under-collateralised indefinitely. The solver claim takes
        // precedence; the trader's book claim already excludes the reward
        // (callers pass afterSolver - liqReward), so a capped payout here keeps
        // the ledger fully token-backed.
        if (liquidator != address(0) && liquidatorReward > 0) {
            uint256 liqPayout = liquidatorReward > payableAmount ? payableAmount : liquidatorReward;
            if (liqPayout > 0) {
                payableAmount -= liqPayout;
                NativeTokens.transfer(debtCurrency, liquidator, liqPayout);
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
            uint256 tradeOIUsd = priceFeed.getAmountInUsd(Currency.unwrap(debtCurrency), borrowedAmount);
            totalOpenInterestUSD = EswapMarginLib.saturatingSub(totalOpenInterestUSD, tradeOIUsd);
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

    function _distributeRehypothecation(
        PoolKey calldata key,
        BalanceDelta removeDelta,
        Currency collateralCurrency,
        uint256 rehypPrincipal,
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
            recoveredCollateral > int256(rehypPrincipal) ? recoveredCollateral - int256(rehypPrincipal) : int256(0);
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
        bool hadBand
    ) internal returns (uint256 receivedAmount, uint256 bandProceeds) {
        bool zeroForOne = Currency.unwrap(collateralCurrency) == Currency.unwrap(key.currency0);
        uint256 availableCollateral = collateralAmount;
        if (hadBand) {
            int128 recoveredCollatInt = zeroForOne ? removeDelta.amount0() : removeDelta.amount1();
            uint256 recovered = recoveredCollatInt > 0 ? uint256(uint128(recoveredCollatInt)) : 0;
            uint256 retained = collateralAmount > deployedPrincipal ? collateralAmount - deployedPrincipal : 0;
            availableCollateral = recovered + retained;
            if (availableCollateral > collateralAmount) availableCollateral = collateralAmount;
        }

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
        uint256 twap0 = priceFeed.getTwapPrice(Currency.unwrap(key.currency0));
        uint256 twap1 = priceFeed.getTwapPrice(Currency.unwrap(key.currency1));
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
}
