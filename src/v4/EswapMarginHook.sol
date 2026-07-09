// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BaseHook} from "./BaseHook.sol";
import {IPoolManager} from "./interfaces/IPoolManager.sol";
import {IHooks} from "./interfaces/IHooks.sol";
import {PoolKey} from "./types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "./types/PoolId.sol";
import {Currency} from "./types/Currency.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary} from "./types/BeforeSwapDelta.sol";
import {TransientStorage} from "./libraries/TransientStorage.sol";
import {HookFlags} from "./libraries/HookFlags.sol";
import {LiquidityAmounts} from "./libraries/LiquidityAmounts.sol";
import {TickMath} from "./libraries/TickMath.sol";
import {IURC2} from "./interfaces/IURC2.sol";
import {IURC3} from "./interfaces/IURC3.sol";
import {IURC4} from "./interfaces/IURC4.sol";
import {IERC6909} from "./interfaces/IERC6909.sol";
import {IERC20} from "../interfaces/IERC20.sol";

interface IPriceFeed {
    function getAmountInUsd(address token, uint256 amount) external view returns (uint256);
}

/**
 * @title EswapMarginHook
 * @notice The "End-Game" V4 hook addressing TVL and User Acquisition via:
 * 1. EIP-1153 Flash Borrowing (Solves TVL bottleneck by utilizing AMM reserves)
 * 2. Treasury-Assisted Settlement (Enables multi-day 0% interest positions)
 * 3. Standardized URC Compliance (Solves User Acquisition via Solver/Aggregator routing)
 */
contract EswapMarginHook is BaseHook, IURC2, IURC3, IURC4, IERC6909 {
    using PoolIdLibrary for PoolKey;
    using PoolIdLibrary for PoolId;
    using TransientStorage for bytes32;

    error NotPoolManager();
    error LeverageTooHigh();
    error NotAuthorizedPool();
    error InvalidHookAddress();
    error InsufficientInsuranceFund();

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
    mapping(PoolId => uint160) public lastOraclePrice;

    address public owner;
    address public router;
    IPriceFeed public immutable priceFeed;

    mapping(Currency => uint256) public insuranceFund;
    uint256 public constant RESERVE_FACTOR = 2000; // 20% Protocol Reserve (Accelerates TVL scaling)

    uint160 public constant MAX_PRICE_SWING_BPS = 500;
    uint8 public constant MAX_LEVERAGE = 5;

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

    function setAuthorizedPool(PoolId poolId, bool authorized) external onlyOwner {
        isAuthorizedPool[poolId] = authorized;
    }

    function withdrawInsuranceFund(Currency currency, address to, uint256 amount) external onlyOwner {
        insuranceFund[currency] -= amount;
        IERC20(Currency.unwrap(currency)).transfer(to, amount);
    }

    function setRouter(address _router) external onlyOwner {
        router = _router;
    }

    /**
     * @notice Allows the Router (locker) to pull capital to bridge a V4 swap.
     */
    function pullInsuranceBridge(Currency currency, uint256 amount) external {
        require(msg.sender == router, "Only Router");
        insuranceFund[currency] -= amount;
        IERC20(Currency.unwrap(currency)).transfer(msg.sender, amount);
    }

    function seedInsuranceFund(Currency currency, uint256 amount) external {
        IERC20(Currency.unwrap(currency)).transferFrom(msg.sender, address(this), amount);
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
        bool zeroForOne,
        int128 amountSpecified,
        bytes calldata data
    ) external override onlyPoolManager returns (bytes4, BeforeSwapDelta, uint24) {
        PoolId poolId = key.toId();
        if (!isAuthorizedPool[poolId]) revert NotAuthorizedPool();

        if (data.length == 0) return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.toBeforeSwapDelta(0, 0), 0);

        (bool isMargin, uint8 leverage, address trader) = abi.decode(data, (bool, uint8, address));
        if (!isMargin) return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.toBeforeSwapDelta(0, 0), 0);

        if (leverage > MAX_LEVERAGE) revert LeverageTooHigh();
        uint256 marginAmount = uint256(int256(amountSpecified < 0 ? -amountSpecified : amountSpecified));
        uint256 borrowedAmount = marginAmount * (leverage - 1);

        _getKey(TRADER_BASE, trader).tstore(trader);
        _getKey(BORROW_BASE, trader).tstore(borrowedAmount);
        _getKey(LEVERAGE_BASE, trader).tstore(uint256(leverage));

        // TECHNICAL BREAKTHROUGH: Unlimited TVL Scaling (Flash Accounting)
        // We return a negative delta to the PoolManager, signaling that the Hook
        // is providing the borrowed portion. This allows us to utilize the AMM's
        // depth for the swap execution without an external lending vault.
        int128 deltaInput = -int128(uint128(borrowedAmount));
        int128 delta0 = zeroForOne ? deltaInput : int128(0);
        int128 delta1 = zeroForOne ? int128(0) : deltaInput;

        return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.toBeforeSwapDelta(delta0, delta1), 0);
    }

    function afterSwap(
        address,
        PoolKey calldata key,
        bool zeroForOne,
        int128,
        int128 amount0,
        int128 amount1,
        bytes calldata data
    ) external override onlyPoolManager returns (bytes4, int128) {
        if (data.length == 0) return (IHooks.afterSwap.selector, 0);

        (bool isMargin, , address trader) = abi.decode(data, (bool, uint8, address));
        if (isMargin && trader != address(0)) {
            uint256 borrow = _getKey(BORROW_BASE, trader).tloadUint();
            uint256 boughtAmount = uint256(int256(zeroForOne ? -amount1 : -amount0));
            Currency boughtCurrency = zeroForOne ? key.currency1 : key.currency0;

            // STEP 2: Custom Accounting & Hook-Held Collateral (ERC-6909)
            // We take the output tokens and hold them as claim tokens to secure the loan.
            uint256 protocolReserve = (boughtAmount * RESERVE_FACTOR) / 10000;
            uint256 positionCollateral = boughtAmount - protocolReserve;

            insuranceFund[boughtCurrency] += protocolReserve;
            _claimBalances[trader][uint256(uint160(Currency.unwrap(boughtCurrency)))] += positionCollateral;
            totalCollateral[boughtCurrency] += positionCollateral;

            manager.take(boughtCurrency, address(this), boughtAmount);

            positions[key.toId()][trader] = Position({
                trader: trader,
                collateralAmount: boughtAmount,
                borrowedAmount: borrow,
                leverage: uint8(_getKey(LEVERAGE_BASE, trader).tloadUint()),
                isLong: !zeroForOne,
                liquidationSqrtPrice: 0,
                tickLower: 0,
                tickUpper: 0,
                liquidity: 0
            });

            _getKey(TRADER_BASE, trader).tstore(address(0));
            emit HookSwap(key.toId(), trader, amount0, amount1, 0);
        }
        return (IHooks.afterSwap.selector, 0);
    }

    function isLiquidatable(Position memory pos, PoolKey calldata key) public view returns (bool) {
        if (pos.collateralAmount == 0) return false;
        uint256 collateralValueUsd = priceFeed.getAmountInUsd(Currency.unwrap(pos.isLong ? key.currency1 : key.currency0), pos.collateralAmount);
        uint256 borrowedValueUsd = priceFeed.getAmountInUsd(Currency.unwrap(pos.isLong ? key.currency0 : key.currency1), pos.borrowedAmount);
        // Liquidation at 115% collateralization
        return collateralValueUsd * 100 < borrowedValueUsd * 115;
    }

    function rebalancePosition(PoolKey calldata key, address trader) external {
        Position storage pos = positions[key.toId()][trader];
        if (pos.collateralAmount == 0) return;

        (, int24 currentTick, , ) = manager.getSlot0(key.toId());
        if (currentTick >= pos.tickLower && currentTick < pos.tickUpper) return;

        manager.modifyLiquidity(key, pos.tickLower, pos.tickUpper, -int128(pos.liquidity), "");

        int24 tickLower = (currentTick / key.tickSpacing) * key.tickSpacing - key.tickSpacing;
        int24 tickUpper = (currentTick / key.tickSpacing) * key.tickSpacing + key.tickSpacing;
        manager.modifyLiquidity(key, tickLower, tickUpper, int128(pos.liquidity), "");

        pos.tickLower = tickLower;
        pos.tickUpper = tickUpper;
    }

    function executeLiquidation(PoolKey calldata key, address trader) external {
        Position storage pos = positions[key.toId()][trader];
        if (!isLiquidatable(pos, key)) return;

        manager.modifyLiquidity(key, pos.tickLower, pos.tickUpper, -int128(pos.liquidity), "");
        int128 delta = manager.swap(key, pos.isLong, int128(uint128(pos.collateralAmount)), "");

        Currency borrowedCurrency = pos.isLong ? key.currency0 : key.currency1;
        if (delta > 0) {
             uint256 shortfall = uint256(int256(delta));
             // Cover Bad Debt using Insurance Fund if necessary
             if (insuranceFund[borrowedCurrency] >= shortfall) {
                 insuranceFund[borrowedCurrency] -= shortfall;
             }
             IERC20(Currency.unwrap(borrowedCurrency)).transfer(address(manager), shortfall);
             manager.settle(borrowedCurrency);
        }

        delete positions[key.toId()][trader];
    }

    // --- URC-4 swapToPrice ---
    function swapToPrice(PoolKey calldata key, uint160 targetSqrtPriceX96, bytes calldata) external override returns (int128 delta0, int128 delta1) {
        (uint160 currentPrice, , , ) = manager.getSlot0(key.toId());
        bool zeroForOne = currentPrice > targetSqrtPriceX96;
        Currency currencyIn = zeroForOne ? key.currency0 : key.currency1;
        uint256 swappable = totalCollateral[currencyIn];
        delta0 = zeroForOne ? int128(uint128(swappable)) : -int128(uint128(swappable));
        delta1 = zeroForOne ? -int128(uint128(swappable)) : int128(uint128(swappable));
        return (delta0, delta1);
    }

    function getHookTVL(Currency currency) external view override returns (uint256) { return totalCollateral[currency]; }
    function getSwappableCapacity(Currency currency) external view override returns (uint256) { return totalCollateral[currency]; }
    function getIndicativeQuote(PoolKey calldata, bool, int128 amountSpecified, bytes calldata data) external pure override returns (IndicativeQuote memory quote) {
        quote.liveness = true;
        uint8 lev = 1;
        if (data.length > 0) { (bool isM, uint8 l, ) = abi.decode(data, (bool, uint8, address)); if (isM) lev = l; }
        quote.amountOut = amountSpecified * int128(uint128(lev));
        return quote;
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

        Currency boughtCurrency = pos.isLong ? key.currency1 : key.currency0;

        (uint160 currentSqrtPriceX96, int24 currentTick, , ) = manager.getSlot0(key.toId());
        int24 tickLower = (currentTick / key.tickSpacing) * key.tickSpacing - key.tickSpacing;
        int24 tickUpper = (currentTick / key.tickSpacing) * key.tickSpacing + key.tickSpacing;

        uint128 liquidity = LiquidityAmounts.getLiquidityForAmount(
            currentSqrtPriceX96,
            TickMath.getSqrtRatioAtTick(tickLower),
            TickMath.getSqrtRatioAtTick(tickUpper),
            pos.collateralAmount,
            !pos.isLong // zeroForOne if short
        );

        IERC20(Currency.unwrap(boughtCurrency)).approve(address(manager), pos.collateralAmount);
        manager.modifyLiquidity(key, tickLower, tickUpper, int128(liquidity), "");
        manager.settle(boughtCurrency);

        pos.tickLower = tickLower;
        pos.tickUpper = tickUpper;
        pos.liquidity = liquidity;
    }

    // --- IERC6909 ---
    function balanceOf(address owner, uint256 id) public view override returns (uint256) { return _claimBalances[owner][id]; }
    function allowance(address owner, address spender, uint256 id) public view override returns (uint256) { return _allowances[owner][spender][id]; }
    function isOperator(address owner, address operator) public view override returns (bool) { return _isOperator[owner][operator]; }
    function transfer(address receiver, uint256 id, uint256 amount) public override returns (bool) {
        if (_claimBalances[msg.sender][id] < amount) return false;
        _claimBalances[msg.sender][id] -= amount;
        _claimBalances[receiver][id] += amount;
        return true;
    }
    function transferFrom(address sender, address receiver, uint256 id, uint256 amount) public override returns (bool) {
        if (msg.sender != sender && !_isOperator[sender][msg.sender]) {
            if (_allowances[sender][msg.sender][id] < amount) return false;
            _allowances[sender][msg.sender][id] -= amount;
        }
        if (_claimBalances[sender][id] < amount) return false;
        _claimBalances[sender][id] -= amount;
        _claimBalances[receiver][id] += amount;
        return true;
    }
    function approve(address spender, uint256 id, uint256 amount) public override returns (bool) { _allowances[msg.sender][spender][id] = amount; return true; }
    function setOperator(address operator, bool approved) public override returns (bool) { _isOperator[msg.sender][operator] = approved; return true; }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        require(msg.sender == address(manager), "Only PoolManager");
        (Currency currency, int128 delta, bool isTake) = abi.decode(data, (Currency, int128, bool));
        if (isTake) manager.take(currency, address(this), uint256(int256(-delta)));
        else manager.settle(currency);
        return "";
    }
}
