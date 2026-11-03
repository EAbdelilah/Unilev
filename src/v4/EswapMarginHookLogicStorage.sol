// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IPoolManager} from "./interfaces/IPoolManager.sol";
import {PoolKey} from "./types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "./types/PoolId.sol";
import {Currency} from "./types/Currency.sol";
import {BalanceDelta, BalanceDeltaLibrary} from "./types/BalanceDelta.sol";
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
 * @title EswapMarginHookLogicStorage
 * @notice SINGLE source of truth for the shared storage layout of the
 *         delegatecall'd logic split. EswapMarginHook remains the registered
 *         hook; EswapMarginHookLogic and EswapMarginHookLogic2 are both
 *         delegatecalled into the hook's storage, so ALL three contracts must
 *         see the exact same slot layout.
 *
 * @dev Any state variable added or REORDERED here MUST be added to
 *      EswapMarginHook's own mirrored storage block at the SAME position, or
 *      the delegatecall reads/writes the wrong slot.
 */
abstract contract EswapMarginHookLogicStorage {
    using PoolIdLibrary for PoolKey;
    using PoolIdLibrary for PoolId;
    using BalanceDeltaLibrary for BalanceDelta;
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
    error PositionAlreadyHasSolver(address existing);
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
    // [AUDIT CRIT-04] Reject a partial liquidation whose surviving position
    // would still be liquidatable (drip-drain of cover bonus + reward).
    error PartialLiquidationLeavesUnhealthyPosition();
    // [P1#6] Yield-bearing insurance fund staking
    error NothingToStake();
    error NothingToUnstake();
    error StakeCapExceeded();
    /// @dev [AUDIT F-03] The unwind swap returned materially less than the
    ///      oracle value of the collateral it sold.
    error UnwindBelowOracleFloor(uint256 receivedUsd, uint256 floorUsd);
    /// @dev [AUDIT F-05] Neither a live oracle value nor a cached price exists.
    error OraclePriceUnavailable();
    /// @dev [AUDIT F-08] No deferred payout to claim.
    error NoPayoutCredit();

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
    event BadDebtRepaid(Currency indexed currency, uint256 amount);
    event PositionPartiallyLiquidated(
        PoolId indexed poolId,
        address indexed trader,
        uint256 liquidationBps,
        uint256 collateralLiquidated,
        uint256 debtRepaid,
        uint256 receivedAmount
    );
    // [AUDIT HIGH-14] Emitted when a close/liquidation settles with NO solver
    // debt ledger entry but an outstanding `pos.borrowedAmount` (the 1x/edge
    // fallback). Makes the abnormal "debt not accounted via registerSolverDebt"
    // path auditable instead of silently zero-paying the solver.
    event SolverDebtFallbackUsed(PoolId indexed poolId, address indexed trader, uint256 borrowedAmount);

    // [AUDIT F-05] Last validated USD-per-whole-token price observed on a
    // non-view path. Written on every margin open so the liquidation health
    // check can degrade to a cached mark instead of reverting during a feed
    // outage (sequencer restart / heartbeat gap / depeg band breach).
    event PriceCached(address indexed token, uint256 usdPerWholeToken);
    // [AUDIT F-08] A payout that could not be delivered (blacklisted or
    // reverting recipient) was credited instead of bricking the settlement.
    event PayoutDeferred(address indexed recipient, Currency indexed currency, uint256 amount);
    event PayoutClaimed(address indexed recipient, Currency indexed currency, uint256 amount);
    event PayoutRedirectSet(address indexed account, address indexed redirect);

    // ─── Storage layout (MUST mirror EswapMarginHook exactly) ──────────────────
    mapping(PoolId => bool) public isAuthorizedPool;
    mapping(PoolId => mapping(address => Position)) public positions;

    /// @dev Raw principal (in the collateral currency) currently rehypothecated
    ///      as the LP band for a position. When the band is removed, LP proceeds
    ///      beyond this principal (the accrued fees) are paid to the solver.
    mapping(PoolId => mapping(address => uint256)) public rehypPrincipal;
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
    uint256 public firstPauseTimestamp;
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
    // H-5b behavior). [AUDIT HIGH-10] The 0 default is a deliberate economics
    // choice: the 3% LIQUIDATION_REWARD_BPS is always credited to the insurance
    // fund, and liveness comes from the team keeper / solver plus the owner-
    // configured bounty (setLiquidatorIncentiveBps). Horizontal: raise the
    // default only if no first-party keeper will operate. Set via EswapMarginHook
    // only.
    uint256 public liquidatorIncentiveBps;
    // [EIP-170 split] Address of the second logic contract (close/liquidation/
    // rebalance family). Written by EswapMarginHook's constructor ONLY (same
    // relative slot appended to the hook's mirror); EswapMarginHookLogic's
    // fallback routes those selectors here.
    address internal logic2;

    // [INSURANCE POLICY] Share of an uncovered shortfall the insurance fund may
    // cover, in bps. Initialised to 10000 (full coverage) by EswapMarginHook's
    // constructor. Appended AFTER `logic2` so every existing slot is unchanged.
    uint256 internal insuranceCoverageBps;

    // [LIVENESS] Bumped on every new position open for (pool, trader). A settlement
    // records the value it saw when it filled; a later bump proves that position
    // has since closed, because a new open requires the previous one to be gone.
    mapping(PoolId => mapping(address => uint256)) internal positionEpoch;

    // ─── [AUDIT F-05/F-08] Appended state (every earlier slot unchanged) ──────

    /// @dev [AUDIT F-05] Last validated oracle price per token, as USD per WHOLE
    ///      token (18 decimals) — exactly what `PriceFeed.getAmountInUsd(token,
    ///      10 ** decimals)` returns. Written only from non-view execution paths
    ///      (`registerMarginOpen`, margin `afterSwap`) so the liquidation health
    ///      check can fall back to a known-good mark when the live feed reverts
    ///      (sequencer restart grace window, heartbeat gap, depeg band breach).
    ///      A revert in a *view* is harmless; a revert in `isLiquidatable` is what
    ///      disables every liquidation, which is the bug this closes.
    mapping(address => uint256) internal cachedPriceUsd;

    /// @dev [AUDIT F-05] Block timestamp of the last `cachedPriceUsd` write.
    ///      Observability only: the circuit-breaker mode does not gate on age,
    ///      because staleness alone must never re-disable liquidations.
    mapping(address => uint256) internal cachedPriceAt;
    uint256 internal constant MAX_CACHED_PRICE_AGE = 4 hours;

    /// @dev [AUDIT F-08] Payouts that could not be delivered (blacklisted token
    ///      recipient, reverting `receive()`) are credited here instead of
    ///      reverting the whole settlement. Pull-claimed via `claimPayout`.
    mapping(address => mapping(Currency => uint256)) internal payoutCredits;

    /// @dev [AUDIT F-08] Optional redirect: proceeds credited/paid to an account
    ///      are sent to `payoutRedirect[account]` when set, so a compromised or
    ///      blacklisted address can route proceeds to a clean one.
    mapping(address => address) internal payoutRedirect;

    bytes32 constant TRADER_BASE = keccak256("TRADER");
    bytes32 constant BORROW_BASE = keccak256("BORROW");
    bytes32 constant LEVERAGE_BASE = keccak256("LEVERAGE");

    uint256 public constant LIQUIDATION_REWARD_BPS = 300;
    uint256 public constant LIQUIDATION_COVER_BPS = 500;
    uint256 public constant MIN_COLLATERAL = 0.01 ether;
    uint256 public constant MAX_PAUSE_DURATION = 72 hours;
    uint256 public constant INSURANCE_STAKE_MAX_BPS = 5000;
    int24 public constant INSURANCE_STAKE_RANGE_SPACINGS = 10;
    /// @dev [AUDIT F-05] Extra maintenance-threshold buffer applied when the
    ///      health check had to fall back to the cached oracle mark. Widens the
    ///      liquidation band by 5 pts of collateralisation instead of disabling
    ///      liquidation entirely while the feed is unhealthy.
    uint256 internal constant CIRCUIT_BREAKER_BPS = 500;
    /// @dev [AUDIT F-03] Maximum tolerated shortfall of an unwind swap's realised
    ///      USD value versus the oracle value of the collateral sold, in bps.
    ///      5% rather than ~1% so a legitimate large liquidation (the swap itself
    ///      moves price) is not DoS-able by the floor; beyond 5% the fill is
    ///      treated as adversarial and reverted.
    uint256 internal constant MAX_UNWIND_SLIPPAGE_BPS = 500;
    /// @dev [AUDIT F-07] Floor on the direct liquidator bounty. Even when the
    ///      owner leaves `liquidatorIncentiveBps` at 0, a keeper is paid this
    ///      share of the post-solver surplus so liquidation liveness does not
    ///      depend on a permissioned team keeper. Event-driven, so 0% carry holds.
    uint256 internal constant LIQUIDATOR_MIN_INCENTIVE_BPS = 50;
    uint256 internal constant INSURANCE_STAKE_TAG = uint256(keccak256("INSURANCE_STAKE"));
    uint256 internal constant INSURANCE_UNSTAKE_TAG = uint256(keccak256("INSURANCE_UNSTAKE"));
    uint256 internal constant DEPLOY_TAG = uint256(keccak256("DEPLOY_COLLATERAL"));

    IPriceFeedLogic public immutable priceFeed;
}