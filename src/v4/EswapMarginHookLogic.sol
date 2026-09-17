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
    error InvalidLiquidationBps();
    // [P1#6] Yield-bearing insurance fund staking
    error NothingToStake();
    error NothingToUnstake();
    error StakeCapExceeded();

    // ─── Events ───────────────────────────────────────────────────────────────
    event HookSwap(
        PoolId indexed poolId, address indexed trader, int128 amount0, int128 amount1, uint128 liquidityDelta
    );
    event BaseCurrencySet(PoolId indexed poolId, Currency currency);
    event TradingPairRegistered(PoolId indexed poolId, Currency base, PoolKey standardKey);
    event MultiPoolMarginOpened(
        PoolId indexed poolId, address indexed trader, uint8 leverage, uint256 marginAmount, uint256 boughtAmount
    );
    event InsuranceStaked(
        PoolId indexed poolId,
        Currency currency0,
        uint256 funded0,
        Currency currency1,
        uint256 funded1,
        uint128 liquidity
    );
    event InsuranceUnstaked(
        PoolId indexed poolId,
        Currency currency0,
        uint256 returned0,
        Currency currency1,
        uint256 returned1,
        uint128 liquidity
    );
    event ResidueSwept(Currency indexed currency, address indexed to, uint256 amount);
    event EmergencyPauseToggled(bool indexed paused);
    event BadDebtRecorded(Currency indexed currency, uint256 amount);
    event PositionPartiallyLiquidated(
        PoolId indexed poolId,
        address indexed trader,
        uint256 liquidationBps,
        uint256 collateralLiquidated,
        uint256 debtRepaid,
        uint256 receivedAmount
    );

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
    // [P1#6] Yield-bearing insurance: idle insurance claims staked as full-range
    // LP liquidity in the deep standard pool accrue swap fees. Ledgers keep the
    // staked share bounded (INSURANCE_STAKE_MAX_BPS) so shortfall coverage always
    // has claim-backed funds available.
    mapping(PoolId => uint128) public insuranceStakedLiquidity;
    mapping(Currency => uint256) public insuranceStaked;
    mapping(PoolId => mapping(Currency => uint256)) public insuranceStakedInPool;
    // [P1#6] Band anchors persisted at stake time so unstake burns the exact LP
    // position even after the price moves.
    mapping(PoolId => int24) public insuranceTickLower;
    mapping(PoolId => int24) public insuranceTickUpper;
    // [P2#8] Optional direct liquidator incentive: bps of the post-solver
    // liquidation surplus paid DIRECTLY to the liquidator (debt currency) before
    // the insurance credit/trader payout. 0 by default (insurance-only routing,
    // H-5b behavior). Declared AFTER everything mirrored so the storage layout
    // stays in lockstep with EswapMarginHook. Set via EswapMarginHook only.
    uint256 public liquidatorIncentiveBps;

    bytes32 constant TRADER_BASE = keccak256("TRADER");
    bytes32 constant BORROW_BASE = keccak256("BORROW");
    bytes32 constant LEVERAGE_BASE = keccak256("LEVERAGE");

    uint256 public constant LIQUIDATION_REWARD_BPS = 300;
    // [P1#3] Additional collateral (bps) seized beyond the repaid debt share on a
    // PARTIAL liquidation. A plain f/f proportional shrink keeps the
    // collateralization ratio exactly unchanged (useless): seizing (1+cover)×f
    // collateral while repaying only f×debt thins the position toward health.
    uint256 public constant LIQUIDATION_COVER_BPS = 500;
    uint256 public constant MIN_COLLATERAL = 0.01 ether;
    uint256 public constant MAX_PAUSE_DURATION = 72 hours;
    // [P1#6] Maximum share of a currency's insurance fund that may be staked as
    // LP liquidity at any time (5000 = 50%). The remainder stays claim-backed so
    // shortfall coverage is never fully locked up behind LP positions.
    uint256 public constant INSURANCE_STAKE_MAX_BPS = 5000;
    // [P1#6] Half-width of the staking LP band in tickSpacing units (10×spacing
    // = ~6.2% either side at spacing 60). Concentrated around the standard pool's
    // current price: full-range staking is a geometric no-op for realistic funds.
    int24 public constant INSURANCE_STAKE_RANGE_SPACINGS = 10;
    uint256 private constant INSURANCE_STAKE_TAG = uint256(keccak256("INSURANCE_STAKE"));
    uint256 private constant INSURANCE_UNSTAKE_TAG = uint256(keccak256("INSURANCE_UNSTAKE"));

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
            uint256 tradeOIUsd = _usdValueOf(Currency.unwrap(debtCurrency), borrowedAmount);
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
            uint256 liqDebtUsd = _usdValueOf(Currency.unwrap(debtCurrency), liqDebt);
            totalOpenInterestUSD = EswapMarginLib.saturatingSub(totalOpenInterestUSD, liqDebtUsd);
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
                (bool success,) = recipient.call{value: uint256(yieldAmount)}("");
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
}
