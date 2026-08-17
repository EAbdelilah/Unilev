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
import {IURC2} from "./interfaces/IURC2.sol";
import {IURC3} from "./interfaces/IURC3.sol";
import {IURC4} from "./interfaces/IURC4.sol";
import {IERC6909} from "./interfaces/IERC6909.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {IPoolManager as RealIPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolId as RealPoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {EswapMarginLib} from "./EswapMarginLib.sol";

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
    error PositionAlreadyOpen();
    error ReentrantSwap();
    error NoActivePosition();
    error FeeTooHigh();
    error BpsTooHigh();
    error InvalidLeverageRange();
    error Unauthorized();
    error ExtttloadFailed();
    error TreasuryNotSet();
    error ERC6909InsufficientBalance();
    error ERC6909InsufficientAllowance();
    error UnsupportedFeature();

    event BaseCurrencySet(PoolId indexed poolId, Currency currency);

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

    // Insurance Fund for bad debt coverage during liquidations
    mapping(Currency => uint256) public insuranceFund;
    // Protocol fee revenue (separate from insurance fund)
    mapping(Currency => uint256) public protocolFees;
    address public treasury;
    uint256 public reserveFactor = 50; // 0.5% Protocol Fee (Mutable, default 50 basis points)
    uint256 public totalOpenInterestUSD; // Dynamic tracker of total on-chain Open Interest in USD
    // [FIX M-1] Running USD-value tracker — avoids the O(n) currency-loop in beforeSwap on every trade
    uint256 public totalCollateralUSDRunning;
    // [FIX M-1] Stores each position's collateral USD value at open time for accurate decrement on close/liquidation
    mapping(PoolId => mapping(address => uint256)) public positionCollateralUSD;
    // [FIX H-1] When true, revert if the TWAP oracle is not configured for the pool (set true in production)
    bool public requireTwapOracle;

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

    bytes32 constant TRADER_BASE = keccak256("TRADER");
    bytes32 constant BORROW_BASE = keccak256("BORROW");
    bytes32 constant LEVERAGE_BASE = keccak256("LEVERAGE");

    function _getKey(bytes32 base, address trader) internal pure returns (bytes32) {
        return keccak256(abi.encode(base, trader));
    }

    constructor(IPoolManager _manager, IPriceFeed _priceFeed) BaseHook(_manager) {
        priceFeed = _priceFeed;
        owner = msg.sender;
        if (uint160(address(this)) & getHookFlags() != getHookFlags()) revert InvalidHookAddress();
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
    function withdrawInsuranceFund(Currency currency, address to, uint256 amount) external onlyOwner {
        insuranceFund[currency] -= amount;
        manager.unlock(abi.encode(currency, -SafeCast.toInt128(int256(amount)), true)); // Take from PM
        IERC20(Currency.unwrap(currency)).safeTransfer(to, amount); // [FIX C-2]
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

    function setRouter(address _router) external onlyOwner {
        router = _router;
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
        return HookFlags.AFTER_INITIALIZE_FLAG |
               HookFlags.BEFORE_SWAP_FLAG |
               HookFlags.AFTER_SWAP_FLAG |
               HookFlags.BEFORE_SWAP_RETURNS_DELTA_FLAG;
    }

    function _registerCurrency(Currency currency) internal {
        if (!isCurrencyRegistered[currency]) {
            isCurrencyRegistered[currency] = true;
            registeredCurrencies.push(currency);
        }
    }

    function afterInitialize(address, PoolKey calldata key, uint160 sqrtPriceX96, int24) external override onlyPoolManager returns (bytes4) {
        // [FIX L-4] Removed auto-authorization: permissionless pool init would have granted
        // trading rights to any pool using this hook, including malicious fake-token pools.
        // Pools must be explicitly authorized via setAuthorizedPool() by the owner.
        lastOraclePrice[key.toId()] = sqrtPriceX96;
        _registerCurrency(key.currency0);
        _registerCurrency(key.currency1);
        return IHooks.afterInitialize.selector;
    }

    function beforeSwap(
        address,
        PoolKey calldata key,
        IPoolManager.SwapParams calldata params,
        bytes calldata data
    ) external override onlyPoolManager returns (bytes4, BeforeSwapDelta, uint24) {
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
            return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.toBeforeSwapDelta(deltaSpecified, deltaUnspecified), 0);
        }

        // Margin Mode
        (, uint8 leverage, address trader) = abi.decode(data, (bool, uint8, address));
        if (leverage == 0 || leverage > _maxLeverageForPool(poolId)) revert MaxLeverageExceeded();

        if (positions[poolId][trader].collateralAmount != 0) revert PositionAlreadyOpen();

        uint256 marginAmount = uint256(int256(params.amountSpecified < 0 ? -params.amountSpecified : params.amountSpecified));
        if (marginAmount < MIN_COLLATERAL) revert CollateralTooLow();
        uint256 borrowedAmount = marginAmount * (leverage - 1);

        // V3 TWAP Circuit Breaker — delegated to EswapMarginLib to reduce hook bytecode
        _checkV4SpotAgainstV3Twap(key);

        uint256 poolTVL = totalCollateralUSDRunning;
        if (poolTVL > 100000 ether && leverage > 1) {
            Currency inputCurrency = params.zeroForOne ? key.currency0 : key.currency1;
            uint256 tradeOIUsd = priceFeed.getAmountInUsd(Currency.unwrap(inputCurrency), borrowedAmount);
            uint256 maxTotalOI = (poolTVL * 15) / 100;
            uint256 maxSingleOI = (poolTVL * 2) / 100;

            if (tradeOIUsd > maxSingleOI) {
                revert PositionExceedsSingleCap(tradeOIUsd, maxSingleOI);
            }
            if (totalOpenInterestUSD + tradeOIUsd > maxTotalOI) {
                revert OpenInterestExceedsCapacity(totalOpenInterestUSD + tradeOIUsd, maxTotalOI);
            }
        }

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

        (bool isMargin, , address trader) = abi.decode(data, (bool, uint8, address));
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
            uint256 protocolReserve = (boughtAmount * reserveFactor) / 10000;
            uint256 positionCollateral = boughtAmount - protocolReserve;

            protocolFees[boughtCurrency] += protocolReserve;
            // Hook-side ledger of trader-held collateral claims (mirrors the
            // ERC-6909 claims the router mints to this hook on the PM singleton).
            _claimBalances[trader][uint256(uint160(Currency.unwrap(boughtCurrency)))] += positionCollateral;
            totalCollateral[boughtCurrency] += positionCollateral;

            // [FIX M-1] Track USD value at open time so beforeSwap can use O(1) lookup
            if (positionCollateral > 0) {
                try priceFeed.getAmountInUsd(Currency.unwrap(boughtCurrency), positionCollateral) returns (uint256 collateralUsd) {
                    totalCollateralUSDRunning += collateralUsd;
                    positionCollateralUSD[key.toId()][trader] = collateralUsd;
                } catch {}
            }

            _registerCurrency(boughtCurrency);
            // Track borrow for protocol-wide health view
            Currency borrowedToken = params.zeroForOne ? key.currency0 : key.currency1;
            totalBorrowedByToken[borrowedToken] += borrow;
            _registerCurrency(borrowedToken);

            // [FIX M-4] Wrap oracle call in try/catch: a stale/paused Chainlink feed must not brick swaps
            if (borrow > 0) {
                try priceFeed.getAmountInUsd(Currency.unwrap(borrowedToken), borrow) returns (uint256 tradeOIUsd) {
                    totalOpenInterestUSD += tradeOIUsd;
                } catch {}
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
        (uint160 sqrtPriceX96,,,) = _slot0(key.toId());
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
    function liquidationThresholdBps(uint8 leverage) public pure returns (uint256) {
        return EswapMarginLib.liquidationThresholdBps(leverage);
    }

    function isLiquidatable(Position memory pos, PoolKey calldata key) public view returns (bool) {
        if (pos.collateralAmount == 0) return false;
        uint256 collateralValueUsd = priceFeed.getAmountInUsd(Currency.unwrap(_collateralCurrency(pos, key)), pos.collateralAmount);
        uint256 borrowedValueUsd   = priceFeed.getAmountInUsd(Currency.unwrap(_debtCurrency(pos, key)), pos.borrowedAmount);
        return EswapMarginLib.isLiquidatable(collateralValueUsd, borrowedValueUsd, pos.leverage);
    }

    function rebalancePosition(PoolKey calldata key, address trader) external onlyRouter {
        Position storage pos = positions[key.toId()][trader];
        if (pos.collateralAmount == 0) return;

        (, int24 currentTick, , ) = _slot0(key.toId());
        if (currentTick >= pos.tickLower && currentTick < pos.tickUpper) return;

        (BalanceDelta removeDelta, ) = manager.modifyLiquidity(
            key,
            IPoolManager.ModifyLiquidityParams(pos.tickLower, pos.tickUpper, -int128(pos.liquidity), 0),
            ""
        );
        _netLiquidityDelta(key, removeDelta);

        int24 tickLower = (currentTick / key.tickSpacing) * key.tickSpacing - key.tickSpacing;
        int24 tickUpper = (currentTick / key.tickSpacing) * key.tickSpacing + key.tickSpacing;
        (BalanceDelta addDelta, ) = manager.modifyLiquidity(
            key,
            IPoolManager.ModifyLiquidityParams(tickLower, tickUpper, int128(pos.liquidity), 0),
            ""
        );
        _netLiquidityDelta(key, addDelta);

        pos.tickLower = tickLower;
        pos.tickUpper = tickUpper;
    }

    /**
     * @notice Decrements the trader's ERC-6909 claim balance and the protocol-wide
     *         totalCollateral aggregate for the collateral currency. Guards against
     *         underflow so bookkeeping converges to zero even if a partially
     *         transferred claim is cleared.
     */
    function _clearCollateralAccounting(address trader, Currency currency, uint256 amount) internal {
        uint256 collateralId = uint256(uint160(Currency.unwrap(currency)));
        if (_claimBalances[trader][collateralId] >= amount) {
            _claimBalances[trader][collateralId] -= amount;
        } else {
            _claimBalances[trader][collateralId] = 0;
        }
        if (totalCollateral[currency] >= amount) {
            totalCollateral[currency] -= amount;
        } else {
            totalCollateral[currency] = 0;
        }
    }

    // ------------------------------------------------------------------------
    // --- JIT Spot RFQ ---
    // ------------------------------------------------------------------------
    function clearJITDelta(Currency token, address to, uint256 amount) external {
        if (msg.sender != router) revert("Only router can clear JIT delta");
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

    /**
     * @notice Executes a forced liquidation of an underwater position.
     * @param key       The Uniswap V4 pool key.
     * @param trader    The trader whose position will be liquidated.
     * @param minAmountOut Minimum tokens the swap must return (slippage protection against MEV).
     *                     The caller (liquidation bot) should derive this from an oracle quote.
     */
    function executeLiquidation(PoolKey calldata key, address trader, uint256 minAmountOut) external onlyRouter {
        PoolId poolId = key.toId();
        Position storage pos = positions[poolId][trader];
        if (!isLiquidatable(pos, key)) return;

        // Remove concentrated liquidity if deployed so we hold the tokens
        if (pos.liquidity > 0) {
            (BalanceDelta removeDelta, ) = manager.modifyLiquidity(
                key,
                IPoolManager.ModifyLiquidityParams(pos.tickLower, pos.tickUpper, -int128(pos.liquidity), 0),
                ""
            );
            _netLiquidityDelta(key, removeDelta);
            pos.liquidity = 0;
        }

        Currency collateralCurrency = _collateralCurrency(pos, key);
        Currency debtCurrency = _debtCurrency(pos, key);
        uint256 collateralAmount = pos.collateralAmount;

        // To unwind: sell the held collateral → receive the borrowed (debt) currency.
        // zeroForOne is true when the collateral is currency0, false when it is currency1.
        bool zeroForOne = Currency.unwrap(collateralCurrency) == Currency.unwrap(key.currency0);
        PoolKey memory standardKey = standardPoolKeys[poolId];
        if (Currency.unwrap(standardKey.currency0) == address(0)) {
            standardKey = key;
        }
        BalanceDelta delta = manager.swap(
            standardKey,
            IPoolManager.SwapParams(zeroForOne, -int256(collateralAmount), 0),
            ""
        );

        // Amount received from the swap: zeroForOne=true  → amount1 is positive output
        //                                zeroForOne=false → amount0 is positive output
        int128 receivedDelta = zeroForOne ? delta.amount1() : delta.amount0();
        uint256 receivedAmount = receivedDelta > 0 ? uint256(uint128(receivedDelta)) : 0;

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
            poolId, trader,
            collateralCurrency, debtCurrency,
            collateralAmount, receivedAmount,
            solver,
            liqReward,
            afterSolver - liqReward,
            pos.borrowedAmount
        );
    }

    /// @dev Shared settlement: burn collateral ERC-6909, take debt from PM, repay solver,
    ///      seed insurance fund reward, and clean up all accounting.
    function _settle(
        PoolId poolId,
        address trader,
        Currency collateralCurrency,
        Currency debtCurrency,
        uint256 collateralAmount,
        uint256 receivedAmount,
        address solver,
        uint256 liquidatorReward,
        uint256 traderPayout,
        uint256 borrowedAmount
    ) internal {
        // Burn ERC-6909 collateral claim
        uint256 collateralId = uint256(uint160(Currency.unwrap(collateralCurrency)));
        if (manager.balanceOf(address(this), collateralId) >= collateralAmount) {
            manager.burn(address(this), collateralId, collateralAmount);
        }
        // Take recovered debt tokens
        if (receivedAmount > 0) {
            manager.take(debtCurrency, address(this), receivedAmount);
        }
        // Route insurance reward
        if (liquidatorReward > 0) {
            insuranceFund[debtCurrency] += liquidatorReward;
        }
        // Repay solver (principal + yield)
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
                IERC20(Currency.unwrap(debtCurrency)).safeTransfer(solver, totalPayout);
            }
        }
        // Return surplus to trader
        if (traderPayout > 0) {
            IERC20(Currency.unwrap(debtCurrency)).safeTransfer(trader, traderPayout);
        }
        // Clear collateral accounting
        _clearCollateralAccounting(trader, collateralCurrency, collateralAmount);
        // Decrement OI
        if (borrowedAmount > 0) {
            uint256 tradeOIUsd = priceFeed.getAmountInUsd(Currency.unwrap(debtCurrency), borrowedAmount);
            totalOpenInterestUSD = EswapMarginLib.saturatingSub(totalOpenInterestUSD, tradeOIUsd);
        }
        // Decrement collateral USD running tracker
        totalCollateralUSDRunning = EswapMarginLib.saturatingSub(totalCollateralUSDRunning, positionCollateralUSD[poolId][trader]);
        delete positionCollateralUSD[poolId][trader];
        delete positions[poolId][trader];
        delete solverDebts[poolId][trader][solver];
        delete positionSolver[poolId][trader];
    }

    function swapToPrice(PoolKey calldata, uint160, bytes calldata) external pure override returns (int128, int128) {
        revert UnsupportedFeature();
    }

    function getHookTVL(Currency currency) external view override returns (uint256) { return totalCollateral[currency]; }
    function getSwappableCapacity(Currency currency) external view override returns (uint256) {
        // Physical execution routes through Unichain's existing deep standard pool,
        // so capacity is not capped by hook reserves. Return hook-held collateral
        // as a conservative, verifiable floor for aggregator routing graphs.
        return totalCollateral[currency];
    }
    function getIndicativeQuote(PoolKey calldata, bool, int128 amountSpecified, bytes calldata data) external view override returns (IndicativeQuote memory quote) {
        // Signal not live for sub-minimum orders: routing them here fails Solver economics
        // and would hurt the protocol's aggregator success-rate score.
        int256 absAmount = amountSpecified < 0 ? -int256(amountSpecified) : int256(amountSpecified);
        if (uint256(absAmount) < MIN_COLLATERAL) {
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

    /**
     * @notice STEP 3: Smart Collateral Rehypothecation (0% Interest)
     * Deploy the entire collateral as concentrated liquidity to harvest fees.
     * Called by the Router AFTER the swap to avoid re-entrancy locks.
     */
    function deployCollateral(PoolKey calldata key, address trader) external onlyRouter {
        Position storage pos = positions[key.toId()][trader];
        if (pos.collateralAmount == 0 || pos.liquidity > 0) return;

        (uint160 currentSqrtPriceX96, int24 currentTick, , ) = _slot0(key.toId());
        int24 tickLower = (currentTick / key.tickSpacing) * key.tickSpacing - key.tickSpacing;
        int24 tickUpper = (currentTick / key.tickSpacing) * key.tickSpacing + key.tickSpacing;

        uint128 liquidity;
        try EswapMarginLib.computeLiquidity(
            currentSqrtPriceX96,
            tickLower,
            tickUpper,
            pos.collateralAmount,
            Currency.unwrap(_collateralCurrency(pos, key)) == Currency.unwrap(key.currency0)
        ) returns (uint128 liq) {
            liquidity = liq;
        } catch {
            liquidity = uint128(pos.collateralAmount / 2); // graceful fallback
        }
        if (liquidity == 0) return;

        (BalanceDelta addDelta, ) = manager.modifyLiquidity(
            key,
            IPoolManager.ModifyLiquidityParams(tickLower, tickUpper, int128(liquidity), 0),
            ""
        );
        _netLiquidityDelta(key, addDelta);

        pos.tickLower = tickLower;
        pos.tickUpper = tickUpper;
        pos.liquidity = liquidity;
    }

    /**
     * @notice Nets a `modifyLiquidity` returned BalanceDelta against the PoolManager's
     *         flash accounting so the unlock callback leaves no unaccounted currency deltas.
     * @dev In real V4, modifyLiquidity returns a delta of the minted/burned position tokens:
     *      a positive component means the pool owes the caller tokens (caller `take`s them),
     *      a negative component means the caller must provide tokens (caller `settle`s them).
     *      The canonical settle pattern is sync + transfer + no-arg settle().
     */
    function _netLiquidityDelta(PoolKey calldata key, BalanceDelta delta) internal {
        int128 amount0 = delta.amount0();
        int128 amount1 = delta.amount1();
        if (amount0 > 0) {
            manager.take(key.currency0, address(this), uint256(int256(amount0)));
        } else if (amount0 < 0) {
            uint256 absAmt0 = uint256(int256(-amount0));
            uint256 claimId0 = uint256(uint160(Currency.unwrap(key.currency0)));
            if (manager.balanceOf(address(this), claimId0) >= absAmt0) {
                manager.burn(address(this), claimId0, absAmt0);
            } else {
                manager.sync(key.currency0);
                IERC20(Currency.unwrap(key.currency0)).transfer(address(manager), absAmt0);
                manager.settle();
            }
        }
        if (amount1 > 0) {
            manager.take(key.currency1, address(this), uint256(int256(amount1)));
        } else if (amount1 < 0) {
            uint256 absAmt1 = uint256(int256(-amount1));
            uint256 claimId1 = uint256(uint160(Currency.unwrap(key.currency1)));
            if (manager.balanceOf(address(this), claimId1) >= absAmt1) {
                manager.burn(address(this), claimId1, absAmt1);
            } else {
                manager.sync(key.currency1);
                IERC20(Currency.unwrap(key.currency1)).transfer(address(manager), absAmt1);
                manager.settle();
            }
        }
    }


    // --- IERC6909 ---
    function balanceOf(address _owner, uint256 id) public view override returns (uint256) { return _claimBalances[_owner][id]; }
    function allowance(address _owner, address spender, uint256 id) public view override returns (uint256) { return _allowances[_owner][spender][id]; }
    function isOperator(address _owner, address operator) public view override returns (bool) { return _isOperator[_owner][operator]; }
    function transfer(address receiver, uint256 id, uint256 amount) public override returns (bool) {
        if (_claimBalances[msg.sender][id] < amount) revert ERC6909InsufficientBalance();
        _claimBalances[msg.sender][id] -= amount;
        _claimBalances[receiver][id] += amount;
        return true;
    }
    function transferFrom(address sender, address receiver, uint256 id, uint256 amount) public override returns (bool) {
        if (msg.sender != sender && !_isOperator[sender][msg.sender]) {
            if (_allowances[sender][msg.sender][id] < amount) revert ERC6909InsufficientAllowance();
            _allowances[sender][msg.sender][id] -= amount;
        }
        if (_claimBalances[sender][id] < amount) revert ERC6909InsufficientBalance();
        _claimBalances[sender][id] -= amount;
        _claimBalances[receiver][id] += amount;
        return true;
    }
    function approve(address spender, uint256 id, uint256 amount) public override returns (bool) { _allowances[msg.sender][spender][id] = amount; return true; }
    function setOperator(address operator, bool approved) public override returns (bool) { _isOperator[msg.sender][operator] = approved; return true; }

    /**
     * @notice Registers solver debt when a leveraged margin position is opened.
     * The solver physically settled the borrowed leg inside the router's unlock
     * callback; this registry guarantees its repayment (principal + yield)
     * before the trader can withdraw on close/liquidation.
     */
    function registerSolverDebt(PoolId poolId, address trader, address solver, uint256 principal) external onlyRouter {
        solverDebts[poolId][trader][solver] = SolverDebt({
            solver: solver,
            principal: principal,
            accumulatedYield: 0
        });
        positionSolver[poolId][trader] = solver;
    }

    /**
     * @notice Closes a leveraged margin position, settling solver debt and returning profit.
     */
    function closePosition(PoolKey calldata key, address trader, address /* solver */, uint256 minAmountOut) external onlyRouter {
        PoolId poolId = key.toId();
        Position storage pos = positions[poolId][trader];
        if (pos.collateralAmount == 0) revert NoActivePosition();

        Currency collateralCurrency = _collateralCurrency(pos, key);
        Currency debtCurrency = _debtCurrency(pos, key);
        uint256 collateralAmount = pos.collateralAmount;

        // 1. Remove concentrated liquidity if deployed
        if (pos.liquidity > 0) {
            (BalanceDelta removeDelta, ) = manager.modifyLiquidity(
                key,
                IPoolManager.ModifyLiquidityParams(pos.tickLower, pos.tickUpper, -int128(pos.liquidity), 0),
                ""
            );
            _netLiquidityDelta(key, removeDelta);
            pos.liquidity = 0;
        }

        // 2. Swap collateral back to the debt token to repay the borrowed amount
        //    zeroForOne is true when the collateral is currency0, false when currency1.
        bool zeroForOne = Currency.unwrap(collateralCurrency) == Currency.unwrap(key.currency0);
        PoolKey memory standardKey = standardPoolKeys[poolId];
        if (Currency.unwrap(standardKey.currency0) == address(0)) {
            standardKey = key;
        }
        BalanceDelta delta = manager.swap(
            standardKey,
            IPoolManager.SwapParams(zeroForOne, -int256(collateralAmount), 0),
            ""
        );

        // 3. Amount received from the unwind swap: zeroForOne=true → amount1 (positive),
        //    zeroForOne=false → amount0 (positive)
        int128 receivedDelta = zeroForOne ? delta.amount1() : delta.amount0();
        uint256 receivedAmount = receivedDelta > 0 ? uint256(uint128(receivedDelta)) : 0;

        // 4. Pay the swap's collateral leg by burning the hook's ERC-6909 claim
        //    (canonical settle-using-burn against the real PoolManager).
        uint256 collateralId = uint256(uint160(Currency.unwrap(collateralCurrency)));
        if (manager.balanceOf(address(this), collateralId) >= collateralAmount) {
            manager.burn(address(this), collateralId, collateralAmount);
        }

        // 5. Take the recovered debt tokens from the PoolManager
        if (receivedAmount > 0) {
            manager.take(debtCurrency, address(this), receivedAmount);
        }

        // Slippage protection
        address actualSolver = positionSolver[poolId][trader];
        SolverDebt storage debt = solverDebts[poolId][trader][actualSolver];
        uint256 totalPayout = debt.principal + debt.accumulatedYield;
        if (totalPayout == 0 && pos.borrowedAmount > 0) totalPayout = pos.borrowedAmount;
        uint256 netToTrader = receivedAmount >= totalPayout ? receivedAmount - totalPayout : 0;
        if (netToTrader < minAmountOut) revert SlippageExceeded(netToTrader, minAmountOut);

        // Settle with PoolManager
        if (totalPayout > 0) { manager.sync(debtCurrency); manager.settle(); }

        _settle(
            poolId, trader,
            collateralCurrency, debtCurrency,
            collateralAmount, receivedAmount,
            actualSolver,
            0,           // no liquidator reward for voluntary close
            netToTrader,
            pos.borrowedAmount
        );
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
    function positionCurrencies(PoolKey calldata key, address trader) external view returns (Currency collateral, Currency debt) {
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
            IERC20(Currency.unwrap(currency)).transfer(address(manager), amount);
            manager.settle();
            manager.mint(address(this), uint256(uint160(Currency.unwrap(currency))), amount);
        }
        return "";
    }
}
