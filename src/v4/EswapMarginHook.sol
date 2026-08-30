// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BaseHook} from "./BaseHook.sol";
import {IPoolManager} from "./interfaces/IPoolManager.sol";
import {IHooks} from "./interfaces/IHooks.sol";
import {PoolKey} from "./types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "./types/PoolId.sol";
import {Currency} from "./types/Currency.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary} from "./types/BeforeSwapDelta.sol";
import {BalanceDelta, BalanceDeltaLibrary} from "./types/BalanceDelta.sol";
import {TransientStorage} from "./libraries/TransientStorage.sol";
import {HookFlags} from "./libraries/HookFlags.sol";
import {LiquidityAmounts} from "./libraries/LiquidityAmounts.sol";
import {TickMath} from "./libraries/TickMath.sol";
import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";
import {IURC2} from "./interfaces/IURC2.sol";
import {IURC3} from "./interfaces/IURC3.sol";
import {IURC4} from "./interfaces/IURC4.sol";
import {IERC6909} from "./interfaces/IERC6909.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {IPoolManager as RealIPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolId as RealPoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {EswapMarginLib} from "./EswapMarginLib.sol";
import {EswapMarginHookLogic} from "./EswapMarginHookLogic.sol";
import {IPriceFeedLogic} from "./EswapMarginHookLogic.sol";

interface IPriceFeed {
    function getAmountInUsd(address token, uint256 amount) external view returns (uint256);
    function getTwapPrice(address token) external view returns (uint256);
}

/**
 * @title EswapMarginHook
 * @notice The "End-Game" V4 hook addressing TVL and User Acquisition via:
 * 1. EIP-1153 Flash Borrowing (Solves TVL bottleneck by utilizing AMM reserves)
 * 2. Treasury-Assisted Settlement (Enables multi-day 0% interest positions)
 * 3. Standardized URC Compliance (Solves User Acquisition via Solver/Aggregator routing)
 *
 * @dev SDIM execution model: the hook is a registry + ERC-6909 collateral
 *      custodian. No protocol vaults exist. An off-chain Solver physically
 *      settles the borrowed leg (margin x (leverage-1)) inside the router's
 *      unlock callback; the hook guarantees Solver repayment (principal + yield)
 *      via the on-chain `solverDebts` registry before the trader can withdraw.
 *      The PoolManager API is the REAL lib/v4-core ABI: extsload for the packed
 *      slot0, exttload for transient currency deltas, no-arg settle().
 */
contract EswapMarginHook is BaseHook, IURC2, IURC3, IURC4, IERC6909 {
    using PoolIdLibrary for PoolKey;
    using PoolIdLibrary for PoolId;
    using TransientStorage for bytes32;
    using BalanceDeltaLibrary for BalanceDelta;
    using SafeERC20 for IERC20; // [FIX C-2]

    error NotPoolManager();
    error LeverageTooHigh();
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
    error ERC6909InsufficientAllowance();
    error UnsupportedFeature();
    error InvalidStandardPoolKey();
    error InvalidBoughtCurrency();
    error InsufficientResidue(uint256 requested, uint256 available);
    error ZeroSweepRecipient();
    error EmergencyPaused();

    event BaseCurrencySet(PoolId indexed poolId, Currency currency);
    event TradingPairRegistered(PoolId indexed poolId, Currency base, PoolKey standardKey);
    event AddressProtocolFeeSet(address indexed account, uint256 bps);
    event MultiPoolMarginOpened(
        PoolId indexed poolId, address indexed trader, uint8 leverage, uint256 marginAmount, uint256 boughtAmount
    );
    event ResidueSwept(Currency indexed currency, address indexed to, uint256 amount);
    event EmergencyPauseToggled(bool indexed paused);

    modifier onlyPoolManager() {
        if (msg.sender != address(manager)) revert NotPoolManager();
        _;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyRouter() {
        if (msg.sender != router) revert Unauthorized();
        _;
    }

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

    mapping(PoolId => bool) public isAuthorizedPool;
    mapping(PoolId => mapping(address => Position)) public positions;
    mapping(PoolId => mapping(address => bool)) public isSyntheticArbun;
    mapping(PoolId => PoolKey) public standardPoolKeys;

    // Dynamic tracking of registered currencies for USD aggregate valuations
    mapping(Currency => bool) public isCurrencyRegistered;
    Currency[] public registeredCurrencies;

    mapping(address => mapping(uint256 => uint256)) public _claimBalances;
    mapping(address => mapping(address => mapping(uint256 => uint256))) public _allowances;
    mapping(address => mapping(address => bool)) public _isOperator;
    mapping(Currency => uint256) public totalCollateral;
    // Running USD-denominated aggregates for invariant/health views
    mapping(Currency => uint256) public totalBorrowedByToken;
    mapping(PoolId => uint160) public lastOraclePrice;
    // ERC-20 decimals per pool token. Unconfigured tokens default to 18.
    // Required by _checkV4SpotAgainstV3Twap to compare the V4 spot price against
    // the 18-decimal TWAP ratio for pools with non-18-decimal tokens (e.g. USDC).
    mapping(address => uint8) public tokenDecimals;

    // Base token ("what the trader is long/short") per authorized pool. Anchors the
    // `isLong` flag reported to consumers: `isLong == (collateral == baseCurrency)`.
    // When unset, defaults to currency0 to preserve the legacy convention where
    // zeroForOne=false (buying currency0) is a LONG. Uniswap V4 orders currencies
    // ascending by address, so on Unichain currency0=USDC and currency1=WETH; a
    // trader "long WETH" therefore buys currency1 and must have baseCurrency=WETH.
    mapping(PoolId => Currency) public baseCurrency;

    struct SolverDebt {
        address solver;
        uint256 principal;
        uint256 accumulatedYield;
    }

    // PoolId => trader => solver => SolverDebt
    mapping(PoolId => mapping(address => mapping(address => SolverDebt))) public solverDebts;
    // PoolId => trader => solver responsible for repaying the position's borrow.
    // Populated by registerSolverDebt so liquidations can repay without an
    // explicit solver argument.
    mapping(PoolId => mapping(address => address)) public positionSolver;

    address public owner;
    address public router;
    IPriceFeed public immutable priceFeed;
    address public immutable hookLogic;

    // Insurance Fund for bad debt coverage during liquidations
    mapping(Currency => uint256) public insuranceFund;
    // Protocol fee revenue (separate from insurance fund)
    mapping(Currency => uint256) public protocolFees;
    address public treasury;
    uint256 public reserveFactor = 50; // 0.5% Protocol Fee (Mutable, default 50 basis points)
    // Per-trader protocol fee override in basis points. 0 = use the global
    // `reserveFactor` ("one fee for everyone"); a non-zero value gives that
    // specific address its own fee (VIP/partner/tiered pricing).
    mapping(address => uint256) public addressProtocolFeeBps;
    uint256 public totalOpenInterestUSD; // Dynamic tracker of total on-chain Open Interest in USD
    // [FIX M-1] Running USD-value tracker — avoids the O(n) currency-loop in beforeSwap on every trade
    uint256 public totalCollateralUSDRunning;
    // [FIX M-1] Stores each position's collateral USD value at open time for accurate decrement on close/liquidation
    mapping(PoolId => mapping(address => uint256)) public positionCollateralUSD;
    // [FIX H-1] When true, revert if the TWAP oracle is not configured for the pool (set true in production)
    bool public requireTwapOracle;
    // Emergency pause: when true, all new position opens are blocked (close/liquidate/rebalance unaffected)
    bool public emergencyPaused;
    // Auto-unpause: emergency pause auto-expires after this timestamp (max 72h per toggle)
    uint256 public pauseExpiry;
    uint256 public constant MAX_PAUSE_DURATION = 72 hours;

    // Mutable by owner — start at 800 bps (8%) to tolerate genuine market volatility
    // without false-tripping the TWAP circuit breaker and hurting aggregator success rate.
    uint160 public maxPriceSwingBps = 800;
    // Default maximum leverage. Can be overridden per-pool via setMaxLeverageForPool()
    // to offer higher leverage on deeper, more liquid pools.
    uint8 public defaultMaxLeverage = 5;

    struct ConfigParams {
        address treasury;
        address router;
        uint256 reserveFactor;
        uint160 maxPriceSwingBps;
        uint8 defaultMaxLeverage;
        bool requireTwapOracle;
    }
    // Per-pool leverage cap (0 = use defaultMaxLeverage)
    mapping(PoolId => uint8) public maxLeverageByPool;
    uint256 public constant LIQUIDATION_REWARD_BPS = 300; // 3% of recovered output routed to insurance fund
    uint256 public constant MIN_COLLATERAL = 0.01 ether;
    // USD-denominated collateral floor override (18-decimals, e.g. 200000 = $0.20).
    // When zero (default), the legacy raw-token MIN_COLLATERAL floor applies so all
    // existing tests and 1x flows behave identically. When set, beforeSwap and
    // getIndicativeQuote compare the margin's oracle USD value against this floor,
    // enabling micro-margin ($1-scale) solver test positions on live networks.
    uint256 public minCollateralUsd;

    bytes32 constant TRADER_BASE = keccak256("TRADER");
    bytes32 constant BORROW_BASE = keccak256("BORROW");
    bytes32 constant LEVERAGE_BASE = keccak256("LEVERAGE");

    function _getKey(bytes32 base, address trader) internal pure returns (bytes32) {
        return keccak256(abi.encode(base, trader));
    }

    constructor(IPoolManager _manager, IPriceFeed _priceFeed, address initialOwner) BaseHook(_manager) {
        if (initialOwner == address(0)) revert ZeroAddress();
        priceFeed = _priceFeed;
        owner = initialOwner;
        if (uint160(address(this)) & getHookFlags() != getHookFlags()) revert InvalidHookAddress();
        EswapMarginHookLogic logic = new EswapMarginHookLogic(_manager, IPriceFeedLogic(address(_priceFeed)));
        hookLogic = address(logic);
    }

    /**
     * @notice Reads the REAL packed slot0 of a pool from the PoolManager via
     *         extsload. `_pools[id].slot0` lives at the mapping slot
     *         keccak256(abi.encode(id, uint256(0))) and packs
     *         sqrtPriceX96 (low 160) | tick (160..184) | protocolFee (184..200)
     *         | lpFee (200..224) — exactly as Pool.State.slot0 in lib/v4-core.
     */
    function _slot0(PoolId id)
        internal
        view
        returns (uint160 sqrtPriceX96, int24 tick, uint16 protocolFee, uint24 lpFee)
    {
        (uint160 price, int24 t, uint24 pFee, uint24 lFee) =
            StateLibrary.getSlot0(RealIPoolManager(address(manager)), RealPoolId.wrap(PoolId.unwrap(id)));
        return (price, t, uint16(pFee), lFee);
    }

    /**
     * @notice Reads a transient currency delta via exttload. Mirrors the REAL
     *         CurrencyDelta._computeSlot: keccak256(abi.encodePacked(target, currency)).
     */
    function _currencyDelta(address locker, Currency currency) internal view returns (int256) {
        bytes32 slot = keccak256(abi.encodePacked(locker, Currency.unwrap(currency)));
        // Low-level call: solc 0.8.28 via-ir fails to resolve the `extttload` member
        // on IPoolManager when the contract name matches the source file name, so
        // route around it. Selector matches IExttload.extttload(bytes32).
        (bool success, bytes memory data) =
            address(manager).staticcall(abi.encodeWithSignature("extttload(bytes32)", slot));
        if (!success) revert ExtttloadFailed();
        return int256(uint256(abi.decode(data, (bytes32))));
    }

    function setAuthorizedPool(PoolId poolId, bool authorized) external onlyOwner {
        isAuthorizedPool[poolId] = authorized;
    }

    function setStandardPoolKey(PoolId poolId, PoolKey calldata key) external {
        if (msg.sender != owner && msg.sender != router) revert Unauthorized();
        standardPoolKeys[poolId] = key;
    }

    /**
     * @notice Configures the ERC-20 decimals for a pool token.
     * @dev Required for pools containing non-18-decimal tokens (e.g. 6-decimal USDC)
     *      so the V4-spot vs V3-TWAP circuit breaker compares like-for-like prices.
     *      Unconfigured tokens are assumed to be 18 decimals.
     */
    function setTokenDecimals(address token, uint8 decimals) external onlyOwner {
        tokenDecimals[token] = decimals;
    }

    /// @notice Fraction of a collateral band's width that price may consume from
    ///         the collateral side before rebalancePosition re-centers an
    ///         IN-RANGE band, in bps of band width. 2500 = 25%. Prevents the
    ///         stuck window where a sweep converts most of the collateral into
    ///         the debt currency while rebalance waits for full band exit.
    uint256 public bandConsumptionTriggerBps = 2500;

    event BandConsumptionTriggerSet(uint256 oldBps, uint256 newBps);

    function setBandConsumptionTriggerBps(uint256 bps) external onlyOwner {
        require(bps > 0 && bps < 10000, "trigger out of range");
        emit BandConsumptionTriggerSet(bandConsumptionTriggerBps, bps);
        bandConsumptionTriggerBps = bps;
    }

    // --- Open-interest risk caps (aggregator-friendly sizing) --------------
    // Per-trade and aggregate OI limits as fractions of tracked collateral
    // TVL, applied to leveraged (>1x) opens. Defaults preserve the original
    // hardcoded 2% / 15% / $100k-floor behavior. The preview views below
    // expose live capacity so routers can size orders BEFORE routing instead
    // of discovering the caps by revert.

    uint256 public maxSingleOIBps = 200;
    uint256 public maxTotalOIBps = 1500;
    uint256 public oiCapTvlFloorUsd = 100000 ether;

    event OpenInterestCapsSet(uint256 maxSingleBps, uint256 maxTotalBps, uint256 tvlFloorUsd);

    function setOpenInterestCaps(uint256 _maxSingleBps, uint256 _maxTotalBps, uint256 _tvlFloorUsd) external onlyOwner {
        require(_maxSingleBps > 0 && _maxSingleBps < 10000, "single cap out of range");
        require(_maxTotalBps >= _maxSingleBps && _maxTotalBps < 10000, "total cap out of range");
        emit OpenInterestCapsSet(_maxSingleBps, _maxTotalBps, _tvlFloorUsd);
        maxSingleOIBps = _maxSingleBps;
        maxTotalOIBps = _maxTotalBps;
        oiCapTvlFloorUsd = _tvlFloorUsd;
    }

    /// @notice Toggles the emergency pause. When active, all new position opens
    ///         (beforeSwap margin mode + registerMarginOpen) are blocked.
    ///         Close, liquidate, and rebalance remain operational so existing
    ///         positions can be safely wound down.
    function setEmergencyPause(bool paused) external onlyOwner {
        emergencyPaused = paused;
        if (paused) {
            pauseExpiry = block.timestamp + MAX_PAUSE_DURATION;
        } else {
            pauseExpiry = 0;
        }
        emit EmergencyPauseToggled(paused);
    }

    /// @dev Checks emergency pause with auto-expiry. If paused but expired, auto-unpauses.
    function _checkEmergencyPause() internal {
        if (!emergencyPaused) return;
        if (block.timestamp >= pauseExpiry) {
            emergencyPaused = false;
            pauseExpiry = 0;
            return;
        }
        revert EmergencyPaused();
    }

    /// @notice Transfers hook ownership to a new address. Only callable by current owner.
    ///         Use with TimelockController for time-gated governance.
    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        owner = newOwner;
    }

    /**
     * @notice Configures the base (underlying) token for a pool.
     * @dev Determines the meaning of the reported `isLong` flag: a position whose
     *      collateral is the base token is LONG, otherwise SHORT. Defaults to
     *      currency0 when unset. On Unichain (currency0=USDC, currency1=WETH) set
     *      this to WETH so "long WETH" positions report isLong=true.
     */
    function setBaseCurrency(PoolId poolId, Currency currency) external onlyOwner {
        baseCurrency[poolId] = currency;
        emit BaseCurrencySet(poolId, currency);
    }

    /**
     * @notice Withdraws physically settled tokens from the Insurance Fund.
     */
    uint256 public insuranceWithdrawalCapBps = 5000; // 50% max per call

    function withdrawInsuranceFund(Currency currency, address to, uint256 amount) external onlyOwner {
        uint256 cap = (insuranceFund[currency] * insuranceWithdrawalCapBps) / 10000;
        if (amount > cap) revert UnsupportedFeature();
        insuranceFund[currency] -= amount;
        manager.unlock(abi.encode(currency, -SafeCast.toInt128(int256(amount)), true)); // Take from PM
        IERC20(Currency.unwrap(currency)).safeTransfer(to, amount); // [FIX C-2]
    }

    /**
     * @notice Withdraws accumulated protocol fee revenue (reserve factor on each trade)
     *         to the configured treasury. Reverts until a treasury is set via setConfig.
     */
    function withdrawProtocolFee(Currency currency, uint256 amount) external onlyOwner {
        if (treasury == address(0)) revert TreasuryNotSet();
        if (protocolFees[currency] < amount) revert InsufficientProtocolFees(amount, protocolFees[currency]);
        protocolFees[currency] -= amount;
        manager.unlock(abi.encode(currency, -SafeCast.toInt128(int256(amount)), true)); // Take from PM
        IERC20(Currency.unwrap(currency)).safeTransfer(treasury, amount); // [FIX C-2]
    }

    // ─── Protocol-Owned Residue Sweep ─────────────────────────────────────────

    /**
     * @notice ERC6909 claim balance the hook physically holds inside the PoolManager.
     */
    function heldReserve(Currency currency) external view returns (uint256) {
        return manager.balanceOf(address(this), uint256(uint160(Currency.unwrap(currency))));
    }

    /**
     * @notice Tokens held beyond every ledgered obligation — the only amount
     *         `sweepResidue` may move.
     * @dev Obligation floor = trader collateral claims (`totalCollateral`) +
     *      insurance fund + accrued protocol fees. Registered solver debts are
     *      senior claims against position collateral already counted inside
     *      `totalCollateral`, so they need no separate reservation. Sources of
     *      residue: the open fee retained on collateral (50bps default),
     *      settlement rounding dust, and direct donations.
     */
    function sweepableResidue(Currency currency) public view returns (uint256) {
        uint256 obligations = totalCollateral[currency] + insuranceFund[currency] + protocolFees[currency];
        uint256 held = manager.balanceOf(address(this), uint256(uint160(Currency.unwrap(currency))));
        return held > obligations ? held - obligations : 0;
    }

    /**
     * @notice Owner sweep of protocol-owned residue to an arbitrary recipient
     *         (normally the treasury). Hard-capped at `sweepableResidue` so a
     *         compromised owner key can never strand trader collateral,
     *         insurance backing or accrued fees.
     */
    function sweepResidue(Currency currency, address to, uint256 amount) external onlyOwner {
        if (to == address(0)) revert ZeroSweepRecipient();
        uint256 sweepable = sweepableResidue(currency);
        if (amount > sweepable) revert InsufficientResidue(amount, sweepable);
        manager.unlock(abi.encode(currency, -SafeCast.toInt128(int256(amount)), true)); // Take from PM
        IERC20(Currency.unwrap(currency)).safeTransfer(to, amount);
        emit ResidueSwept(currency, to, amount);
    }

    function setConfig(EswapMarginHook.ConfigParams calldata params) external onlyOwner {
        if (params.reserveFactor > 100) revert FeeTooHigh();
        if (params.maxPriceSwingBps > 2000) revert BpsTooHigh();
        if (params.defaultMaxLeverage < 2 || params.defaultMaxLeverage > 20) revert InvalidLeverageRange();

        treasury = params.treasury;
        router = params.router;
        reserveFactor = params.reserveFactor;
        maxPriceSwingBps = params.maxPriceSwingBps;
        defaultMaxLeverage = params.defaultMaxLeverage;
        requireTwapOracle = params.requireTwapOracle;
    }

    /**
     * @notice Sets a protocol-fee override (basis points of position collateral)
     *         for ONE specific address. Everyone else keeps paying the global
     *         `reserveFactor`. Set bps = 0 to fall back to the default fee.
     */
    function setAddressProtocolFee(address account, uint256 bps) external onlyOwner {
        if (account == address(0)) revert ZeroAddress();
        if (bps > 100) revert FeeTooHigh();
        addressProtocolFeeBps[account] = bps;
        emit AddressProtocolFeeSet(account, bps);
    }

    /// @notice Effective protocol fee (bps) charged to `trader`: the per-address
    ///         override when set, otherwise the global `reserveFactor`.
    function protocolFeeFor(address trader) public view returns (uint256) {
        uint256 custom = addressProtocolFeeBps[trader];
        return custom > 0 ? custom : reserveFactor;
    }

    /**
     * @notice Adds a NEW trading pair at runtime — no protocol redeploy needed.
     * @dev One owner transaction authorizes the hook pool, pins the deep standard
     *      pool used by close/liquidation unwind swaps, anchors the base currency
     *      (what "long" means for this pair), and records both tokens' decimals
     *      for the TWAP circuit breaker. The pool itself must already be
     *      initialized on the PoolManager with this hook (permissionless via
     *      pm.initialize), and oracle feeds must be registered on the PriceFeed
     *      via setPriceFeed(). See scripts/v4/AddPair.s.sol for the full flow.
     */
    function registerTradingPair(
        PoolKey calldata key,
        PoolKey calldata standardKey,
        Currency base,
        uint8 currency0Decimals,
        uint8 currency1Decimals
    ) external onlyOwner {
        if (key.hooks != address(this)) revert InvalidHookAddress();
        if (
            Currency.unwrap(standardKey.currency0) != Currency.unwrap(key.currency0)
                || Currency.unwrap(standardKey.currency1) != Currency.unwrap(key.currency1)
        ) revert InvalidStandardPoolKey();
        PoolId poolId = key.toId();
        isAuthorizedPool[poolId] = true;
        standardPoolKeys[poolId] = standardKey;
        baseCurrency[poolId] = base;
        tokenDecimals[Currency.unwrap(key.currency0)] = currency0Decimals;
        tokenDecimals[Currency.unwrap(key.currency1)] = currency1Decimals;
        _registerCurrency(key.currency0);
        _registerCurrency(key.currency1);
        emit TradingPairRegistered(poolId, base, standardKey);
    }

    /**
     * @notice Sets the router and the USD-denominated collateral floor together.
     * @dev Combining both one-time prod configs saves a dispatch (~gas + bytes).
     *      `minCollateralUsd` is 18-decimals: position margins are valued via the
     *      oracle and must meet this USD threshold; 0 restores the legacy raw-token
     *      MIN_COLLATERAL floor.
     */
    function setRouterAndMinCollateralUsd(address _router, uint256 _usdFloor) external onlyOwner {
        router = _router;
        minCollateralUsd = _usdFloor;
    }

    /// @dev Decides whether a raw `marginAmount` of `token` clears the collateral
    ///      floor. The lib distinguishes a USD override (`minCollateralUsd > 0`,
    ///      oracle-valued margin meets a USD floor) from the legacy raw-token
    ///      `MIN_COLLATERAL` floor via the `minCollateralUsd`-as-usdFloor signal.
    ///      The math is delegatecall'd from EswapMarginLib to keep the hook within
    ///      the 24KB EIP-170 bound.
    function _collateralOk(address token, uint256 marginAmount) internal view returns (bool) {
        return EswapMarginLib.collateralOk(
            address(priceFeed), token, marginAmount, minCollateralUsd, MIN_COLLATERAL, tokenDecimals[token]
        );
    }

    /// @dev Resolves the effective max leverage for a pool (per-pool override or global default).
    function _maxLeverageForPool(PoolId poolId) internal view returns (uint8) {
        uint8 override_ = maxLeverageByPool[poolId];
        return override_ > 0 ? override_ : defaultMaxLeverage;
    }

    /**
     * @notice Seed the insurance fund using physical ERC20s, converting them to 6909s.
     */
    function seedInsuranceFund(Currency currency, uint256 amount) external {
        // [FIX H-2] Pull tokens first with safeTransferFrom, then settle inside the unlock context.
        // The old approve() left a dangling approval window exploitable via reentrancy.
        IERC20(Currency.unwrap(currency)).safeTransferFrom(msg.sender, address(this), amount);
        manager.unlock(abi.encode(currency, SafeCast.toInt128(int256(amount)), false)); // Settle to PM to get 6909s
        insuranceFund[currency] += amount;
    }

    function getHookFlags() public pure returns (uint160) {
        return HookFlags.AFTER_INITIALIZE_FLAG | HookFlags.BEFORE_SWAP_FLAG | HookFlags.AFTER_SWAP_FLAG
            | HookFlags.BEFORE_SWAP_RETURNS_DELTA_FLAG;
    }

    function _registerCurrency(Currency currency) internal {
        if (!isCurrencyRegistered[currency]) {
            isCurrencyRegistered[currency] = true;
            registeredCurrencies.push(currency);
        }
    }

    function afterInitialize(address, PoolKey calldata key, uint160 sqrtPriceX96, int24)
        external
        override
        onlyPoolManager
        returns (bytes4)
    {
        // [FIX L-4] Removed auto-authorization: permissionless pool init would have granted
        // trading rights to any pool using this hook, including malicious fake-token pools.
        // Pools must be explicitly authorized via setAuthorizedPool() by the owner.
        lastOraclePrice[key.toId()] = sqrtPriceX96;
        _registerCurrency(key.currency0);
        _registerCurrency(key.currency1);
        return IHooks.afterInitialize.selector;
    }

    function beforeSwap(address, PoolKey calldata key, IPoolManager.SwapParams calldata params, bytes calldata data)
        external
        override
        onlyPoolManager
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        if (router == address(0)) revert RouterNotSet();
        PoolId poolId = key.toId();
        if (!isAuthorizedPool[poolId]) revert NotAuthorizedPool();

        if (data.length == 0) return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.toBeforeSwapDelta(0, 0), 0);

        bool isMargin = abi.decode(data, (bool));

        if (!isMargin) {
            // JIT Spot Swap Mode
            (, address solver, uint256 solverOutput) = abi.decode(data, (bool, address, uint256));

            // JIT Solver absorbs the entire trade, bypassing the AMM.
            int128 deltaSpecified = int128(-params.amountSpecified);
            int128 deltaUnspecified = int128(uint128(solverOutput));

            // Note: Router's unlockCallback will pull solverOutput from the Solver
            // and give the input tokens to the Solver.
            return
                (
                    IHooks.beforeSwap.selector,
                    BeforeSwapDeltaLibrary.toBeforeSwapDelta(deltaSpecified, deltaUnspecified),
                    0
                );
        }

        // Margin Mode
        (, uint8 leverage, address trader) = abi.decode(data, (bool, uint8, address));

        _checkEmergencyPause();

        uint256 marginAmount =
            uint256(int256(params.amountSpecified < 0 ? -params.amountSpecified : params.amountSpecified));
        Currency inputCurrency = params.zeroForOne ? key.currency0 : key.currency1;
        uint256 borrowedAmount = marginAmount * (leverage - 1);
        _validateOpen(key, trader, leverage, inputCurrency, marginAmount, borrowedAmount);

        bytes32 traderKey = _getKey(TRADER_BASE, trader);
        if (traderKey.tload() != bytes32(0)) revert ReentrantSwap();

        traderKey.tstore(trader);
        _getKey(BORROW_BASE, trader).tstore(borrowedAmount);
        _getKey(LEVERAGE_BASE, trader).tstore(uint256(leverage));

        // TECHNICAL BREAKTHROUGH: Unlimited TVL Scaling (Flash Accounting)
        // We return a negative delta to the PoolManager, signaling that the Hook
        // is providing the borrowed portion. This allows us to utilize the AMM's
        // depth for the swap execution without an external lending vault.
        //
        // Real v4-core packs BeforeSwapDelta as (specified, unspecified): the
        // SPECIFIED leg is the swap input (currency0 for zeroForOne, currency1
        // otherwise). The hook flash-provides the borrowed amount on the input
        // leg, so the specified delta is always the (negative) borrow and the
        // unspecified delta is zero. Mapping by zeroForOne here would break the
        // short direction against the real PoolManager (the borrow would land on
        // the output leg and never be added to amountToSwap).
        int128 deltaInput = -int128(uint128(borrowedAmount));

        return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.toBeforeSwapDelta(deltaInput, 0), 0);
    }

    /// @dev Shared open-position validation used by BOTH execution modes:
    ///      the single-pool AMM path (beforeSwap) and the multi-pool deep-fill
    ///      path (registerMarginOpen). Keeps risk gates identical regardless of
    ///      where the physical swap fills.
    /// @dev Single source of truth for open-interest capacity math, shared by
    ///      _validateOpen and the aggregator-facing preview views so the
    ///      enforcement and the advertised limits can never drift.
    ///      @return active True when caps bind at current tracked TVL.
    ///      @return maxSingleUsd Largest single-trade OI allowed (USD 1e18).
    ///      @return remainingUsd Headroom under the aggregate cap (USD 1e18).
    function _oiCapacity() internal view returns (bool active, uint256 maxSingleUsd, uint256 remainingUsd) {
        uint256 poolTVL = totalCollateralUSDRunning;
        if (poolTVL <= oiCapTvlFloorUsd) return (false, 0, 0);
        maxSingleUsd = FullMath.mulDiv(poolTVL, maxSingleOIBps, 10000);
        uint256 maxTotalUsd = FullMath.mulDiv(poolTVL, maxTotalOIBps, 10000);
        remainingUsd = maxTotalUsd > totalOpenInterestUSD ? maxTotalUsd - totalOpenInterestUSD : 0;
        active = true;
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

        // [FIX] Decimals-aware collateral floor: when the USD override is unset, the
        // raw margin is normalized to 18 decimals before comparing against
        // MIN_COLLATERAL. Otherwise a 6-decimal token like USDC would require 1e16
        // raw units ($10B) to open a position. When set, the oracle USD value of the
        // margin is compared against the configured USD floor.
        if (!_collateralOk(Currency.unwrap(inputCurrency), marginAmount)) revert CollateralTooLow();

        // V3 TWAP Circuit Breaker — delegated to EswapMarginLib to reduce hook bytecode
        _checkV4SpotAgainstV3Twap(key);

        // Aggregator-facing risk gates: per-trade and aggregate open-interest
        // caps as fractions of tracked collateral TVL. 1x trades are exempt
        // (margin self-collateralizes). quoteOpenFit() mirrors these checks
        // without reverting so orders can be pre-sized off-chain.
        if (leverage > 1) {
            (bool capsActive, uint256 maxSingleOI, uint256 remainingOI) = _oiCapacity();
            if (capsActive) {
                uint256 tradeOIUsd = priceFeed.getAmountInUsd(Currency.unwrap(inputCurrency), borrowedAmount);
                if (tradeOIUsd > maxSingleOI) {
                    revert PositionExceedsSingleCap(tradeOIUsd, maxSingleOI);
                }
                if (tradeOIUsd > remainingOI) {
                    // Arg2 reconstructs the absolute aggregate cap:
                    // totalOI + remaining == maxTotal.
                    revert OpenInterestExceedsCapacity(
                        totalOpenInterestUSD + tradeOIUsd, totalOpenInterestUSD + remainingOI
                    );
                }
            }
        }
    }

    // --- Aggregator-facing preview views -----------------------------------
    // Routers should eth_call these BEFORE quoting so oversized orders get
    // sized to capacity (or routed elsewhere) instead of reverting at
    // execution time. All three share _oiCapacity() with _validateOpen.

    /// @notice Live open-interest capacity snapshot.
    /// @return capsActive False when tracked TVL is below the floor (uncapped regime).
    function openInterestCapacity()
        external
        view
        returns (
            bool capsActive,
            uint256 poolTvlUsd,
            uint256 totalOiUsd,
            uint256 maxSingleTradeUsd,
            uint256 remainingOiUsd
        )
    {
        poolTvlUsd = totalCollateralUSDRunning;
        totalOiUsd = totalOpenInterestUSD;
        (capsActive, maxSingleTradeUsd, remainingOiUsd) = _oiCapacity();
    }

    /// @notice Largest borrow (raw units of `inputCurrency`) a NEW leveraged
    ///         (>1x) position may take right now without hitting an OI cap.
    ///         Returns 0 when the caps are inactive — that means "no protocol
    ///         ceiling", not "no capacity".
    function maxOpenBorrowRaw(Currency inputCurrency) external view returns (uint256) {
        (bool active, uint256 maxSingleUsd, uint256 remainingUsd) = _oiCapacity();
        if (!active) return 0;
        uint256 effectiveUsd = maxSingleUsd < remainingUsd ? maxSingleUsd : remainingUsd;
        if (effectiveUsd == 0) return 0;
        address token = Currency.unwrap(inputCurrency);
        uint8 dec = _tokenDecimalsSafe(token);
        uint256 price18;
        try priceFeed.getAmountInUsd(token, 10 ** dec) returns (uint256 p) {
            price18 = p;
        } catch {
            return 0;
        }
        if (price18 == 0) return 0;
        return FullMath.mulDiv(effectiveUsd, 10 ** dec, price18);
    }

    /// @notice Non-reverting dry-run of every size gate applied on open:
    ///         leverage bounds, duplicate position, collateral floor and the
    ///         OI caps. The TWAP circuit breaker is state-dependent and is
    ///         only evaluated at execution time.
    /// @return fits True when the order would pass every size gate.
    /// @return reason Empty string when fits; otherwise a stable machine code
    ///         aggregators can map to their own error taxonomy.
    function quoteOpenFit(
        PoolKey calldata key,
        address trader,
        Currency inputCurrency,
        uint8 leverage,
        uint256 marginAmount,
        uint256 borrowedAmount
    ) external view returns (bool fits, string memory reason) {
        if (leverage == 0 || leverage > _maxLeverageForPool(key.toId())) {
            return (false, "LEVERAGE_EXCEEDED");
        }
        if (positions[key.toId()][trader].collateralAmount != 0) {
            return (false, "POSITION_ALREADY_OPEN");
        }
        if (!_collateralOk(Currency.unwrap(inputCurrency), marginAmount)) {
            return (false, "COLLATERAL_TOO_LOW");
        }
        if (leverage > 1) {
            (bool capsActive, uint256 maxSingleOI, uint256 remainingOI) = _oiCapacity();
            if (capsActive) {
                uint256 tradeOIUsd;
                try priceFeed.getAmountInUsd(Currency.unwrap(inputCurrency), borrowedAmount) returns (uint256 usd) {
                    tradeOIUsd = usd;
                } catch {
                    return (false, "ORACLE_UNAVAILABLE");
                }
                if (tradeOIUsd > maxSingleOI) return (false, "SINGLE_TRADE_CAP");
                if (tradeOIUsd > remainingOI) return (false, "OPEN_INTEREST_CAP");
            }
        }
        return (true, "");
    }

    /// @dev Token decimals with fallback to 18 for non-standard tokens.
    function _tokenDecimalsSafe(address token) internal view returns (uint8 d) {
        (bool ok, bytes memory ret) = token.staticcall(abi.encodeWithSignature("decimals()"));
        d = (ok && ret.length >= 32) ? uint8(uint256(abi.decode(ret, (uint256)))) : 18;
    }

    /// @dev Effective base currency for a pool (defaults to currency0 when unset).
    function _baseCurrency(PoolKey calldata key) internal view returns (Currency) {
        Currency base = baseCurrency[key.toId()];
        return Currency.unwrap(base) == address(0) ? key.currency0 : base;
    }

    /// @dev Whether buying `boughtCurrency` in this pool is a LONG position.
    function _isLong(PoolKey calldata key, Currency boughtCurrency) internal view returns (bool) {
        return Currency.unwrap(boughtCurrency) == Currency.unwrap(_baseCurrency(key));
    }

    /// @dev The currency actually held as collateral (the one bought by the opening swap).
    function _collateralCurrency(Position memory pos, PoolKey calldata key) internal view returns (Currency) {
        Currency base = _baseCurrency(key);
        if (pos.isLong) return base;
        return Currency.unwrap(base) == Currency.unwrap(key.currency0) ? key.currency1 : key.currency0;
    }

    /// @dev The currency originally borrowed (the counterpart of the collateral).
    function _debtCurrency(Position memory pos, PoolKey calldata key) internal view returns (Currency) {
        Currency collateral = _collateralCurrency(pos, key);
        return Currency.unwrap(collateral) == Currency.unwrap(key.currency0) ? key.currency1 : key.currency0;
    }

    function afterSwap(
        address,
        PoolKey calldata key,
        IPoolManager.SwapParams calldata params,
        BalanceDelta delta,
        bytes calldata data
    ) external override onlyPoolManager returns (bytes4, int128) {
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
            uint256 protocolReserve = (boughtAmount * protocolFeeFor(trader)) / 10000;
            uint256 positionCollateral = boughtAmount - protocolReserve;

            protocolFees[boughtCurrency] += protocolReserve;
            // Hook-side ledger of trader-held collateral claims (mirrors the
            // ERC-6909 claims the router mints to this hook on the PM singleton).
            _claimBalances[trader][uint256(uint160(Currency.unwrap(boughtCurrency)))] += positionCollateral;
            totalCollateral[boughtCurrency] += positionCollateral;

            // [FIX M-1] Track USD value at open time so beforeSwap can use O(1) lookup
            if (positionCollateral > 0) {
                uint256 collateralUsd = priceFeed.getAmountInUsd(Currency.unwrap(boughtCurrency), positionCollateral);
                totalCollateralUSDRunning += collateralUsd;
                positionCollateralUSD[key.toId()][trader] = collateralUsd;
            }

            _registerCurrency(boughtCurrency);
            // Track borrow for protocol-wide health view
            Currency borrowedToken = params.zeroForOne ? key.currency0 : key.currency1;
            totalBorrowedByToken[borrowedToken] += borrow;
            _registerCurrency(borrowedToken);

            if (borrow > 0) {
                uint256 tradeOIUsd = priceFeed.getAmountInUsd(Currency.unwrap(borrowedToken), borrow);
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

    /**
     * @notice Returns the dynamic liquidation threshold for a position in basis points of collateralization.
     * @dev Threshold decreases as leverage increases, giving higher-leverage positions more
     *      breathing room before liquidation — improving UX and margin aggregator risk scores.
     *      Formula: 120% - (leverage × 2%), so higher leverage is more forgiving:
     *        2x → 116%,  3x → 114%,  5x → 110%,  10x → 100% (hard floor).
     *      The result is floored at 10000 (100%) to always require positive collateral.
     */
    function isLiquidatable(Position memory pos, PoolKey calldata key) public view returns (bool) {
        if (pos.collateralAmount == 0) return false;
        uint256 collateralValueUsd =
            priceFeed.getAmountInUsd(Currency.unwrap(_collateralCurrency(pos, key)), pos.collateralAmount);
        uint256 borrowedValueUsd =
            priceFeed.getAmountInUsd(Currency.unwrap(_debtCurrency(pos, key)), pos.borrowedAmount);
        return EswapMarginLib.isLiquidatable(collateralValueUsd, borrowedValueUsd, pos.leverage);
    }

    function rebalancePosition(PoolKey calldata key, address trader) external onlyRouter {
        _delegateToLogic();
    }

    // ------------------------------------------------------------------------
    // --- JIT Spot RFQ ---
    // ------------------------------------------------------------------------
    function clearJITDelta(Currency token, address to, uint256 amount) external onlyRouter {
        manager.take(token, to, amount);
    }

    /**
     * @notice Converts a synthetic Arbun position into physical asset delivery on Uniswap V4.
     * @dev Fulfills the Shariah Arbun requirement (Qabd) by physically swapping on standardPoolKey.
     */
    function executeArbunDelivery(PoolKey calldata key, address trader) external onlyRouter {
        PoolId poolId = key.toId();
        Position storage pos = positions[poolId][trader];
        if (pos.collateralAmount == 0) revert NoActivePosition();
        isSyntheticArbun[poolId][trader] = false;
    }

    function executeLiquidation(PoolKey calldata key, address trader, uint256 minAmountOut, address liquidator)
        external
        onlyRouter
    {
        _delegateToLogic();
    }

    function swapToPrice(PoolKey calldata, uint160, bytes calldata) external pure override returns (int128, int128) {
        revert UnsupportedFeature();
    }

    function getHookTVL(Currency currency) external view override returns (uint256) {
        return totalCollateral[currency];
    }

    function getSwappableCapacity(Currency currency) external view override returns (uint256) {
        // Physical execution routes through Unichain's existing deep standard pool,
        // so capacity is not capped by hook reserves. Return hook-held collateral
        // as a conservative, verifiable floor for aggregator routing graphs.
        return totalCollateral[currency];
    }

    function getIndicativeQuote(PoolKey calldata key, bool zeroForOne, int128 amountSpecified, bytes calldata data)
        external
        view
        override
        returns (IndicativeQuote memory quote)
    {
        // Signal not live for sub-minimum orders: routing them here fails Solver economics
        // and would hurt the protocol's aggregator success-rate score.
        int256 absAmount = amountSpecified < 0 ? -int256(amountSpecified) : int256(amountSpecified);
        // [FIX] Decimals-aware collateral floor (mirrors beforeSwap): the margin's
        // oracle USD value is checked against the configured USD floor when set,
        // otherwise the raw amount is normalized to 18 decimals before the
        // MIN_COLLATERAL comparison.
        Currency input = zeroForOne ? key.currency0 : key.currency1;
        if (!_collateralOk(Currency.unwrap(input), uint256(absAmount))) {
            quote.liveness = false;
            return quote;
        }

        uint8 lev = 1;
        if (data.length > 0) {
            try this.decodeHookData(data) returns (bool isM, uint8 l, address) {
                if (isM) {
                    lev = l;
                } else {
                    // Spot swaps should route directly to the standard pool where our TVL is deployed
                    quote.liveness = false;
                    return quote;
                }
            } catch {
                quote.liveness = false;
                return quote;
            }
        } else {
            // No hook data provided -> standard spot swap -> reject
            quote.liveness = false;
            return quote;
        }

        quote.liveness = true;

        // Leverage-adjusted output with a conservative 0.1% slippage discount so
        // the indicative quote matches actual execution on the standard pool.
        int128 leveragedAmount = amountSpecified * int128(uint128(lev));
        quote.amountOut = (leveragedAmount * 9990) / 10000;
        return quote;
    }

    function decodeHookData(bytes calldata data) external pure returns (bool, uint8, address) {
        return abi.decode(data, (bool, uint8, address));
    }

    function deployCollateral(PoolKey calldata key, address trader) external onlyRouter {
        _delegateToLogic();
    }

    // --- IERC6909 ---
    function balanceOf(address _owner, uint256 id) public view override returns (uint256) {
        return _claimBalances[_owner][id];
    }

    function allowance(address _owner, address spender, uint256 id) public view override returns (uint256) {
        return _allowances[_owner][spender][id];
    }

    function isOperator(address _owner, address operator) public view override returns (bool) {
        return _isOperator[_owner][operator];
    }

    function transfer(address receiver, uint256 id, uint256 amount) public override returns (bool) {
        if (_isCollateralTokenId(id)) revert UnsupportedFeature();
        if (_claimBalances[msg.sender][id] < amount) revert ERC6909InsufficientBalance();
        _claimBalances[msg.sender][id] -= amount;
        _claimBalances[receiver][id] += amount;
        return true;
    }

    function transferFrom(address sender, address receiver, uint256 id, uint256 amount) public override returns (bool) {
        if (_isCollateralTokenId(id)) revert UnsupportedFeature();
        if (msg.sender != sender && !_isOperator[sender][msg.sender]) {
            if (_allowances[sender][msg.sender][id] < amount) revert ERC6909InsufficientAllowance();
            _allowances[sender][msg.sender][id] -= amount;
        }
        if (_claimBalances[sender][id] < amount) revert ERC6909InsufficientBalance();
        _claimBalances[sender][id] -= amount;
        _claimBalances[receiver][id] += amount;
        return true;
    }

    function _isCollateralTokenId(uint256 id) internal view returns (bool) {
        for (uint256 i = 0; i < registeredCurrencies.length; i++) {
            if (id == uint256(uint160(Currency.unwrap(registeredCurrencies[i])))) return true;
        }
        return false;
    }

    function approve(address spender, uint256 id, uint256 amount) public override returns (bool) {
        _allowances[msg.sender][spender][id] = amount;
        return true;
    }

    function setOperator(address operator, bool approved) public override returns (bool) {
        _isOperator[msg.sender][operator] = approved;
        return true;
    }

    /**
     * @notice Registers solver debt when a leveraged margin position is opened.
     * The solver physically settled the borrowed leg inside the router's unlock
     * callback; this registry guarantees its repayment (principal + yield)
     * before the trader can withdraw on close/liquidation.
     */
    /**
     * @notice Multi-pool deep-fill open: records a position whose physical swap
     *         executed on the standard (no-hook) pool. The router calls this
     *         inside the same unlock AFTER funding both input legs and BEFORE
     *         minting the collateral ERC-6909 claim to this hook.
     * @dev Accounting mirrors afterSwap's margin block exactly: protocol-fee
     *      split, claim-balance mirror of the minted 6909, TVL/OI trackers and
     *      the Position record. Risk gates come from the same _validateOpen used
     *      by beforeSwap, so both execution modes enforce identical limits.
     */
    function registerMarginOpen(
        PoolKey calldata key,
        address trader,
        uint8 leverage,
        uint256 marginAmount,
        uint256 borrowedAmount,
        Currency boughtCurrency,
        uint256 boughtAmount
    ) external onlyRouter {
        _delegateToLogic();
    }

    function registerSolverDebt(PoolId poolId, address trader, address solver, uint256 principal) external onlyRouter {
        Position storage pos = positions[poolId][trader];
        if (principal > pos.borrowedAmount) revert UnsupportedFeature();
        solverDebts[poolId][trader][solver] = SolverDebt({solver: solver, principal: principal, accumulatedYield: 0});
        positionSolver[poolId][trader] = solver;
    }

    /**
     * @notice Closes a leveraged margin position, settling solver debt and returning profit.
     */
    function closePosition(
        PoolKey calldata key,
        address trader,
        address solver,
        uint256 minAmountOut
    )
        external
        onlyRouter
    {
        _delegateToLogic();
    }

    // --- Invariant & Health View Helpers ---
    function getTransientLockState() external view returns (uint256) {
        return uint256(_getKey(TRADER_BASE, msg.sender).tloadUint());
    }

    /**
     * @notice Resolves the collateral and debt currencies for a trader's position.
     * @dev Needed by off-chain/keeper consumers because `isLong` is anchored to the
     *      pool's configured base currency (see setBaseCurrency) and therefore no
     *      longer maps 1:1 to currency0.
     */
    function positionCurrencies(PoolKey calldata key, address trader)
        external
        view
        returns (Currency collateral, Currency debt)
    {
        Position storage pos = positions[key.toId()][trader];
        collateral = _collateralCurrency(pos, key);
        debt = _debtCurrency(pos, key);
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(manager)) revert NotPoolManager();
        (Currency currency, int128 delta, bool isTake) = abi.decode(data, (Currency, int128, bool));
        if (isTake) {
            manager.take(currency, address(this), uint256(int256(-delta)));
        } else {
            uint256 amount = uint256(int256(delta));
            manager.sync(currency);
            IERC20(Currency.unwrap(currency)).safeTransfer(address(manager), amount);
            manager.settle();
            manager.mint(address(this), uint256(uint160(Currency.unwrap(currency))), amount);
        }
        return "";
    }

    // ─── Delegatecall to Logic Contract ────────────────────────────────────────

    /// @dev Delegates the current call to the logic contract. Used by thin
    ///      wrappers for heavy execution functions to keep the hook's runtime
    ///      bytecode within the EIP-170 24,576-byte limit.
    function _delegateToLogic() internal {
        address logic = hookLogic;
        assembly {
            calldatacopy(0, 0, calldatasize())
            let result := delegatecall(gas(), logic, 0, calldatasize(), 0, 0)
            returndatacopy(0, 0, returndatasize())
            switch result
            case 0 { revert(0, returndatasize()) }
            default { return(0, returndatasize()) }
        }
    }

    /// @dev Plain ETH receiver for PoolManager.take() / settle calls.
    receive() external payable {}

    /// @dev Fallback delegates any selector not matching a function on this
    ///      contract to the logic contract (defense-in-depth for future additions).
    fallback() external payable {
        _delegateToLogic();
    }
}
