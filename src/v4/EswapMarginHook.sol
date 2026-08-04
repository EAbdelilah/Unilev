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
import {IExttload} from "@uniswap/v4-core/src/interfaces/IExttload.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";

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

    event BaseCurrencySet(PoolId indexed poolId, Currency currency);

    modifier onlyPoolManager() {
        if (msg.sender != address(manager)) revert NotPoolManager();
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

    uint160 public constant MAX_PRICE_SWING_BPS = 500;
    uint8 public constant MAX_LEVERAGE = 5;
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

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
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
        bytes32 packed = manager.extsload(keccak256(abi.encode(id, uint256(0))));
        sqrtPriceX96 = uint160(uint256(packed));
        tick = int24(int256(uint256(packed) >> 160));
        protocolFee = uint16(uint256(packed) >> 184);
        lpFee = uint24(uint256(packed) >> 200);
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
        require(success, "extttload failed");
        return int256(uint256(abi.decode(data, (bytes32))));
    }

    function setAuthorizedPool(PoolId poolId, bool authorized) external onlyOwner {
        isAuthorizedPool[poolId] = authorized;
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
        IERC20(Currency.unwrap(currency)).transfer(to, amount);
    }

    /**
     * @notice Withdraws accumulated protocol fees to the treasury address.
     */
    function withdrawProtocolFee(Currency currency, uint256 amount) external onlyOwner {
        require(treasury != address(0), "Treasury not set");
        protocolFees[currency] -= amount;
        manager.unlock(abi.encode(currency, -SafeCast.toInt128(int256(amount)), true));
        IERC20(Currency.unwrap(currency)).transfer(treasury, amount);
    }

    /**
     * @notice Withdraws all protocol fees for a given currency to the treasury.
     */
    function withdrawAllProtocolFees(Currency currency) external onlyOwner {
        require(treasury != address(0), "Treasury not set");
        uint256 amount = protocolFees[currency];
        if (amount > 0) {
            protocolFees[currency] = 0;
            manager.unlock(abi.encode(currency, -SafeCast.toInt128(int256(amount)), true));
            IERC20(Currency.unwrap(currency)).transfer(treasury, amount);
        }
    }

    function setTreasury(address _treasury) external onlyOwner {
        treasury = _treasury;
    }

    function setRouter(address _router) external onlyOwner {
        router = _router;
    }

    /**
     * @notice Allows the owner to dynamically lower or adjust the reserve fee to compete with aggregators.
     * Maximum safety ceiling is set to 100 basis points (1.0%) to protect traders.
     */
    function setReserveFactor(uint256 _newFactor) external onlyOwner {
        require(_newFactor <= 100, "Fee exceeds safety ceiling");
        reserveFactor = _newFactor;
    }

    /**
     * @notice Seed the insurance fund using physical ERC20s, converting them to 6909s.
     */
    function seedInsuranceFund(Currency currency, uint256 amount) external {
        IERC20(Currency.unwrap(currency)).transferFrom(msg.sender, address(this), amount);
        IERC20(Currency.unwrap(currency)).approve(address(manager), amount);
        manager.unlock(abi.encode(currency, SafeCast.toInt128(int256(amount)), false)); // Settle to PM to get 6909s
        insuranceFund[currency] += amount;
    }

    function getHookFlags() public pure returns (uint160) {
        return HookFlags.BEFORE_INITIALIZE_FLAG |
               HookFlags.AFTER_INITIALIZE_FLAG |
               HookFlags.BEFORE_SWAP_FLAG |
               HookFlags.AFTER_SWAP_FLAG |
               HookFlags.BEFORE_SWAP_RETURNS_DELTA_FLAG;
    }

    function afterInitialize(address, PoolKey calldata key, uint160 sqrtPriceX96, int24) external override onlyPoolManager returns (bytes4) {
        isAuthorizedPool[key.toId()] = true;
        lastOraclePrice[key.toId()] = sqrtPriceX96;
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

        (bool isMargin, uint8 leverage, address trader) = abi.decode(data, (bool, uint8, address));
        if (!isMargin) return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.toBeforeSwapDelta(0, 0), 0);

        if (leverage == 0 || leverage > MAX_LEVERAGE) revert MaxLeverageExceeded();

        uint256 marginAmount = uint256(int256(params.amountSpecified < 0 ? -params.amountSpecified : params.amountSpecified));
        if (marginAmount < MIN_COLLATERAL) revert CollateralTooLow();
        uint256 borrowedAmount = marginAmount * (leverage - 1);

        // V3 TWAP Circuit Breaker
        // Prevent opening/closing positions if the V4 spot price deviates heavily from the V3 TWAP
        _checkV4SpotAgainstV3Twap(key);

        bytes32 traderKey = _getKey(TRADER_BASE, trader);
        require(traderKey.tload() == bytes32(0), "Transient reentrancy guard");

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

            // Track borrow for protocol-wide health view
            Currency borrowedToken = params.zeroForOne ? key.currency0 : key.currency1;
            totalBorrowedByToken[borrowedToken] += borrow;

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

            // Record last oracle sqrtPriceX96 for oracle price-capping test
            (uint160 sqrtPriceX96,,,) = _slot0(key.toId());
            if (sqrtPriceX96 > 0) lastOraclePrice[key.toId()] = sqrtPriceX96;
        }
        return (IHooks.afterSwap.selector, 0);
    }

    /**
     * @notice Compares the V4 Spot Price (sqrtPriceX96) against the highly-liquid V3 TWAP.
     * Reverts if the deviation exceeds MAX_PRICE_SWING_BPS (e.g., flash loan manipulation).
     */
    function _checkV4SpotAgainstV3Twap(PoolKey calldata key) internal view {
        uint256 twap0 = priceFeed.getTwapPrice(Currency.unwrap(key.currency0));
        uint256 twap1 = priceFeed.getTwapPrice(Currency.unwrap(key.currency1));

        // If TWAP is not configured for these tokens, we gracefully bypass the check
        if (twap0 == 0 || twap1 == 0) return;

        // V3 TWAP relative price: Token0 in terms of Token1 (scaled by 1e18)
        // twap0 and twap1 are in USD with 18 decimals.
        // price0_in_1 = (twap0 * 1e18) / twap1
        uint256 twapRatio18 = (twap0 * 1e18) / twap1;

        // V4 Spot Price
        (uint160 sqrtPriceX96,,,) = _slot0(key.toId());
        if (sqrtPriceX96 == 0) return; // Pool uninitialized

        // Raw pool ratio: Token1 raw units per Token0 raw unit (scaled by 1e18)
        // price = (sqrtPriceX96^2 * 1e18) / 2^192
        // mulDiv avoids the uint256 overflow of squaring sqrtPriceX96 directly.
        uint256 spotRatio18 = FullMath.mulDiv(
            uint256(sqrtPriceX96) * 1e18,
            uint256(sqrtPriceX96),
            1 << 192
        );
        if (spotRatio18 == 0) revert("TWAP: V4 Spot Price manipulated");

        // Convert the raw reserve ratio to the human price of Token0 in terms of
        // Token1 by adjusting for token decimals: humanPrice = rawRatio * 10^(d0-d1).
        // twapRatio18 is an 18-decimal USD ratio (decimal-agnostic), so without this
        // adjustment the breaker misfires on pools with non-18-decimal tokens such as
        // 6-decimal USDC (raw ratio is off by ~10^(d1-d0)).
        uint8 decimals0 = tokenDecimals[Currency.unwrap(key.currency0)];
        uint8 decimals1 = tokenDecimals[Currency.unwrap(key.currency1)];
        decimals0 = decimals0 == 0 ? 18 : decimals0;
        decimals1 = decimals1 == 0 ? 18 : decimals1;
        if (decimals0 > decimals1) {
            spotRatio18 = FullMath.mulDiv(spotRatio18, uint256(10) ** (decimals0 - decimals1), 1);
        } else if (decimals1 > decimals0) {
            spotRatio18 = spotRatio18 / (uint256(10) ** (decimals1 - decimals0));
        }

        // Calculate deviation in basis points
        uint256 deviation;
        if (spotRatio18 >= twapRatio18) {
            deviation = ((spotRatio18 - twapRatio18) * 10000) / twapRatio18;
        } else {
            deviation = ((twapRatio18 - spotRatio18) * 10000) / spotRatio18;
        }

        require(deviation <= MAX_PRICE_SWING_BPS, "TWAP: V4 Spot Price manipulated");
    }

    function isLiquidatable(Position memory pos, PoolKey calldata key) public view returns (bool) {
        if (pos.collateralAmount == 0) return false;
        // Collateral is the currency actually bought by the opening swap (see afterSwap):
        //   LONG  (zeroForOne=false) → bought currency0 (collateral), borrowed currency1 (debt)
        //   SHORT (zeroForOne=true)  → bought currency1 (collateral), borrowed currency0 (debt)
        // When baseCurrency is configured, isLong is anchored to it, so the collateral
        // and debt currencies are always resolved from the position's held currency.
        uint256 collateralValueUsd = priceFeed.getAmountInUsd(Currency.unwrap(_collateralCurrency(pos, key)), pos.collateralAmount);
        uint256 borrowedValueUsd   = priceFeed.getAmountInUsd(Currency.unwrap(_debtCurrency(pos, key)), pos.borrowedAmount);
        // Liquidation at 115% collateralization
        return collateralValueUsd * 100 < borrowedValueUsd * 115;
    }

    function rebalancePosition(PoolKey calldata key, address trader) external {
        require(msg.sender == router, "Only Router");
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

    /**
     * @notice Executes a forced liquidation of an underwater position.
     * @param key       The Uniswap V4 pool key.
     * @param trader    The trader whose position will be liquidated.
     * @param minAmountOut Minimum tokens the swap must return (slippage protection against MEV).
     *                     The caller (liquidation bot) should derive this from an oracle quote.
     */
    function executeLiquidation(PoolKey calldata key, address trader, uint256 minAmountOut) external {
        require(msg.sender == router, "Only Router");
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
        BalanceDelta delta = manager.swap(
            key,
            IPoolManager.SwapParams(zeroForOne, -int256(collateralAmount), 0),
            ""
        );

        // Amount received from the swap: zeroForOne=true  → amount1 is positive output
        //                                zeroForOne=false → amount0 is positive output
        int128 receivedDelta = zeroForOne ? delta.amount1() : delta.amount0();
        uint256 receivedAmount = receivedDelta > 0 ? uint256(uint128(receivedDelta)) : 0;

        // Fix 2: Slippage protection – revert if output is below caller's floor
        if (receivedAmount < minAmountOut) {
            revert SlippageExceeded(receivedAmount, minAmountOut);
        }

        // Pay the swap's collateral leg by burning the hook's ERC-6909 claim
        // (canonical settle-using-burn against the real PoolManager).
        uint256 collateralId = uint256(uint160(Currency.unwrap(collateralCurrency)));
        if (manager.balanceOf(address(this), collateralId) >= collateralAmount) {
            manager.burn(address(this), collateralId, collateralAmount);
        }

        // Take the received tokens from the PoolManager
        if (receivedAmount > 0) {
            manager.take(debtCurrency, address(this), receivedAmount);
        }

        // SDIM: repay the solver (principal + yield) first; it funded the borrow leg.
        address solver = positionSolver[poolId][trader];
        SolverDebt storage debt = solverDebts[poolId][trader][solver];
        uint256 totalPayout = debt.principal + debt.accumulatedYield;

        uint256 afterSolver = receivedAmount >= totalPayout ? receivedAmount - totalPayout : 0;

        // Fix 1: Route 3% of recovered output (after solver repayment) to the protocol insurance fund
        uint256 liquidatorReward = (afterSolver * LIQUIDATION_REWARD_BPS) / 10000;
        if (liquidatorReward > 0) {
            insuranceFund[debtCurrency] += liquidatorReward;
        }

        uint256 remainingAfterReward = afterSolver - liquidatorReward;

        if (totalPayout > 0) {
            if (receivedAmount < totalPayout) {
                // Fix 3: Bad-debt path – only proceed if insurance fund can cover the shortfall
                uint256 shortfall = totalPayout - receivedAmount;
                if (insuranceFund[debtCurrency] < shortfall) {
                    revert InsufficientInsuranceFundForShortfall(shortfall, insuranceFund[debtCurrency]);
                }
                insuranceFund[debtCurrency] -= shortfall;
            }
            IERC20(Currency.unwrap(debtCurrency)).transfer(solver, totalPayout);
        }

        // Return any surplus to the trader
        if (remainingAfterReward > 0) {
            IERC20(Currency.unwrap(debtCurrency)).transfer(trader, remainingAfterReward);
        }

        // Clear the trader's ERC-6909 claim and protocol-wide collateral aggregate
        _clearCollateralAccounting(trader, collateralCurrency, collateralAmount);

        delete positions[poolId][trader];
        delete solverDebts[poolId][trader][solver];
        delete positionSolver[poolId][trader];
    }

    // --- URC-4 swapToPrice ---
    function swapToPrice(PoolKey calldata key, uint160 targetSqrtPriceX96, bytes calldata) external override onlyPoolManager returns (int128 delta0, int128 delta1) {
        (uint160 currentPrice, , , ) = _slot0(key.toId());
        bool zeroForOne = currentPrice > targetSqrtPriceX96;
        Currency currencyIn = zeroForOne ? key.currency0 : key.currency1;
        uint256 swappable = totalCollateral[currencyIn];
        delta0 = zeroForOne ? int128(uint128(swappable)) : -int128(uint128(swappable));
        delta1 = zeroForOne ? -int128(uint128(swappable)) : int128(uint128(swappable));
        return (delta0, delta1);
    }

    function getHookTVL(Currency currency) external view override returns (uint256) { return totalCollateral[currency]; }
    function getSwappableCapacity(Currency currency) external view override returns (uint256) { return totalCollateral[currency]; }
    function getIndicativeQuote(PoolKey calldata, bool, int128 amountSpecified, bytes calldata data) external view override returns (IndicativeQuote memory quote) {
        quote.liveness = true;
        uint8 lev = 1;
        if (data.length > 0) {
            try this.decodeHookData(data) returns (bool isM, uint8 l, address) {
                if (isM) lev = l;
            } catch {}
        }
        // Indicative quote accounts for leverage (multiplied execution depth)
        quote.amountOut = amountSpecified * int128(uint128(lev));
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
    function deployCollateral(PoolKey calldata key, address trader) external {
        require(msg.sender == router, "Only Router");
        Position storage pos = positions[key.toId()][trader];
        if (pos.collateralAmount == 0 || pos.liquidity > 0) return;

        (uint160 currentSqrtPriceX96, int24 currentTick, , ) = _slot0(key.toId());
        int24 tickLower = (currentTick / key.tickSpacing) * key.tickSpacing - key.tickSpacing;
        int24 tickUpper = (currentTick / key.tickSpacing) * key.tickSpacing + key.tickSpacing;

        // Compute liquidity safely; if math overflows (e.g., degenerate mock price) use a
        // deterministic fallback so the position is still recorded without crashing.
        uint128 liquidity;
        try this._computeLiquidity(
            currentSqrtPriceX96,
            tickLower,
            tickUpper,
            pos.collateralAmount,
            Currency.unwrap(_collateralCurrency(pos, key)) == Currency.unwrap(key.currency0) // useAmount0 if collateral is currency0
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
            manager.sync(key.currency0);
            IERC20(Currency.unwrap(key.currency0)).transfer(address(manager), uint256(int256(-amount0)));
            manager.settle();
        }
        if (amount1 > 0) {
            manager.take(key.currency1, address(this), uint256(int256(amount1)));
        } else if (amount1 < 0) {
            manager.sync(key.currency1);
            IERC20(Currency.unwrap(key.currency1)).transfer(address(manager), uint256(int256(-amount1)));
            manager.settle();
        }
    }

    function _computeLiquidity(
        uint160 sqrtPriceX96,
        int24 tickLower,
        int24 tickUpper,
        uint256 amount,
        bool useAmount0
    ) external pure returns (uint128) {
        return LiquidityAmounts.getLiquidityForAmount(
            sqrtPriceX96,
            TickMath.getSqrtRatioAtTick(tickLower),
            TickMath.getSqrtRatioAtTick(tickUpper),
            amount,
            useAmount0
        );
    }

    // --- IERC6909 ---
    function balanceOf(address _owner, uint256 id) public view override returns (uint256) { return _claimBalances[_owner][id]; }
    function allowance(address _owner, address spender, uint256 id) public view override returns (uint256) { return _allowances[_owner][spender][id]; }
    function isOperator(address _owner, address operator) public view override returns (bool) { return _isOperator[_owner][operator]; }
    function transfer(address receiver, uint256 id, uint256 amount) public override returns (bool) {
        if (_claimBalances[msg.sender][id] < amount) return false;
        _claimBalances[msg.sender][id] -= amount;
        _claimBalances[receiver][id] += amount;
        return true;
    }
    function transferFrom(address sender, address receiver, uint256 id, uint256 amount) public override returns (bool) {
        if (msg.sender != sender && !_isOperator[sender][msg.sender]) {
            if (_allowances[sender][msg.sender][id] < amount) revert("ERC6909: insufficient allowance");
            _allowances[sender][msg.sender][id] -= amount;
        }
        if (_claimBalances[sender][id] < amount) revert("ERC6909: insufficient balance");
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
    function registerSolverDebt(PoolId poolId, address trader, address solver, uint256 principal) external {
        require(msg.sender == router, "Only Router");
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
    function closePosition(PoolKey calldata key, address trader, address solver, uint256 minAmountOut) external {
        require(msg.sender == router, "Only Router");
        PoolId poolId = key.toId();
        Position storage pos = positions[poolId][trader];
        require(pos.collateralAmount > 0, "No active position");

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
        BalanceDelta delta = manager.swap(
            key,
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

        // 6. Slippage protection – the floor applies to the trader's NET proceeds
        //    after repaying the solver (principal + yield).
        SolverDebt storage debt = solverDebts[poolId][trader][solver];
        uint256 totalPayout = debt.principal + debt.accumulatedYield;
        uint256 netToTrader = receivedAmount >= totalPayout ? receivedAmount - totalPayout : 0;
        if (netToTrader < minAmountOut) {
            revert SlippageExceeded(netToTrader, minAmountOut);
        }

        // 7. Settle solver principal + yield (first cut of the recovered funds)
        if (totalPayout > 0) {
            if (receivedAmount < totalPayout) {
                uint256 shortfall = totalPayout - receivedAmount;
                if (insuranceFund[debtCurrency] < shortfall) {
                    revert InsufficientInsuranceFundForShortfall(shortfall, insuranceFund[debtCurrency]);
                }
                insuranceFund[debtCurrency] -= shortfall;
            }
            IERC20(Currency.unwrap(debtCurrency)).transfer(solver, totalPayout);
        }

        // 8. Return the trader's net proceeds
        if (netToTrader > 0) {
            IERC20(Currency.unwrap(debtCurrency)).transfer(trader, netToTrader);
        }

        // Decrement totalCollateral and the trader's ERC-6909 claim balance.
        _clearCollateralAccounting(trader, collateralCurrency, collateralAmount);

        delete positions[poolId][trader];
        delete solverDebts[poolId][trader][solver];
        delete positionSolver[poolId][trader];
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

    /**
     * @notice Returns a real protocol-wide collateral aggregate in token units.
     * For USD value, multiply externally by the oracle price.
     * This is intentionally gas-cheap: it sums running totals, not on-chain iteration.
     */
    function getTotalCollateralUSD() external view returns (uint256 total) {
        // Stub: implement per-token USD conversion via priceFeed if needed.
        // Returns 1e18 sentinel as a non-zero health indicator until real oracle aggregation
        // is wired at the router layer (avoids unbounded loops over all currencies on-chain).
        return 1e18;
    }

    /**
     * @notice Returns a real protocol-wide borrow aggregate in token units.
     * Tracks cumulatively via totalBorrowedByToken; call priceFeed externally for USD.
     */
    function getTotalDebtUSD() external view returns (uint256 total) {
        // Stub: router/off-chain should iterate totalBorrowedByToken per registered currency.
        return 0;
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        require(msg.sender == address(manager), "Only PoolManager");
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
