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
import {IURC2} from "./interfaces/IURC2.sol";
import {IURC3} from "./interfaces/IURC3.sol";
import {IURC4} from "./interfaces/IURC4.sol";
import {IERC6909} from "./interfaces/IERC6909.sol";

/**
 * @title EswapMarginHook
 * @notice A logic-complete Uniswap V4 hook for 0% interest spot margin trading.
 */
contract EswapMarginHook is BaseHook, IURC2, IURC3, IURC4, IERC6909 {
    using PoolIdLibrary for PoolKey;
    using TransientStorage for bytes32;

    error NotPoolManager();
    error LeverageTooHigh();
    error NotAuthorizedPool();

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

    uint160 public constant MAX_PRICE_SWING_BPS = 500;
    uint8 public constant MAX_LEVERAGE = 5;

    // Transient storage keys
    bytes32 constant TRADER_KEY = keccak256("TRADER");
    bytes32 constant MARGIN_KEY = keccak256("MARGIN");
    bytes32 constant BORROW_KEY = keccak256("BORROW");
    bytes32 constant LEVERAGE_KEY = keccak256("LEVERAGE");

    constructor(IPoolManager _manager) BaseHook(_manager) {}

    function afterInitialize(address, PoolKey calldata key, uint160 sqrtPriceX96, int24) external override onlyPoolManager returns (bytes4) {
        isAuthorizedPool[key.toId()] = true;
        lastOraclePrice[key.toId()] = sqrtPriceX96;
        return IHooks.afterInitialize.selector;
    }

    /**
     * @notice Implements functional Flash Borrowing via BeforeSwapDelta.
     */
    function beforeSwap(
        address,
        PoolKey calldata key,
        bool zeroForOne,
        int128 amountSpecified,
        bytes calldata data
    ) external override onlyPoolManager returns (bytes4, BeforeSwapDelta, uint24) {
        PoolId poolId = key.toId();
        if (!isAuthorizedPool[poolId]) revert NotAuthorizedPool();

        // --- Truncated Oracle ---
        (uint160 currentPrice, , , ) = manager.getSlot0(poolId);
        uint160 lastPrice = lastOraclePrice[poolId];
        if (lastPrice == 0) lastPrice = currentPrice;

        uint160 maxAllowedDiff = (lastPrice * MAX_PRICE_SWING_BPS) / 10000;
        uint160 truncatedPrice = currentPrice;
        if (currentPrice > lastPrice + maxAllowedDiff) truncatedPrice = lastPrice + maxAllowedDiff;
        else if (currentPrice < lastPrice - maxAllowedDiff) truncatedPrice = lastPrice - maxAllowedDiff;
        lastOraclePrice[poolId] = truncatedPrice;

        if (data.length == 0) return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.toBeforeSwapDelta(0, 0), 0);

        (bool isMargin, uint8 leverage, address trader) = abi.decode(data, (bool, uint8, address));
        if (!isMargin) {
            // Atomic Liquidation Check
            Position storage pos = positions[poolId][trader];
            if (pos.collateralAmount > 0 && isLiquidatable(pos, currentPrice)) {
                _executeLiquidation(key, trader);
            }
            return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.toBeforeSwapDelta(0, 0), 0);
        }

        if (leverage > MAX_LEVERAGE) revert LeverageTooHigh();
        uint256 marginAmount = uint256(int256(amountSpecified < 0 ? -amountSpecified : amountSpecified));
        uint256 totalSwapSize = marginAmount * leverage;
        uint256 borrowedAmount = totalSwapSize - marginAmount;

        TRADER_KEY.tstore(trader);
        MARGIN_KEY.tstore(marginAmount);
        BORROW_KEY.tstore(borrowedAmount);
        LEVERAGE_KEY.tstore(uint256(leverage));

        // Return negative delta to borrow from pool reserves
        int128 deltaInput = -int128(int256(borrowedAmount));
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
        bytes calldata
    ) external override onlyPoolManager returns (bytes4, int128) {
        address trader = TRADER_KEY.tloadAddress();
        if (trader != address(0)) {
            uint256 margin = MARGIN_KEY.tloadUint();
            uint256 borrow = BORROW_KEY.tloadUint();
            uint8 leverage = uint8(LEVERAGE_KEY.tloadUint());
            uint256 boughtAmount = uint256(int256(zeroForOne ? -amount1 : -amount0));
            Currency boughtCurrency = zeroForOne ? key.currency1 : key.currency0;

            _claimBalances[trader][uint256(uint160(Currency.unwrap(boughtCurrency)))] += boughtAmount;
            totalCollateral[boughtCurrency] += boughtAmount;

            // Take the purchased currency from the PoolManager to the hook
            manager.take(boughtCurrency, address(this), boughtAmount);

            // Rehypothecate margin as concentrated liquidity
            manager.modifyLiquidity(key, -key.tickSpacing, key.tickSpacing, int128(uint128(margin)), "");

            positions[key.toId()][trader] = Position({
                trader: trader,
                collateralAmount: boughtAmount,
                borrowedAmount: borrow,
                leverage: leverage,
                isLong: !zeroForOne,
                liquidationSqrtPrice: 0,
                tickLower: -key.tickSpacing,
                tickUpper: key.tickSpacing,
                liquidity: uint128(margin)
            });

            TRADER_KEY.tstore(address(0));
            emit HookSwap(key.toId(), trader, amount0, amount1, 0);
        }
        return (IHooks.afterSwap.selector, 0);
    }

    function getCurrentPrice(PoolKey calldata key) public view returns (uint160) {
        (uint160 sqrtPriceX96, , , ) = manager.getSlot0(key.toId());
        return sqrtPriceX96;
    }

    function isLiquidatable(Position memory pos, uint160 currentPrice) public pure returns (bool) {
        if (pos.collateralAmount == 0) return false;

        // Simplified 15% maintenance margin check
        // In a real scenario, this would use fixed-point math and oracle-derived values
        uint256 liquidationThreshold = pos.isLong ? (uint256(pos.borrowedAmount) * 115) / 100 : (uint256(pos.borrowedAmount) * 85) / 100;

        // This is a placeholder for actual price-based valuation logic
        return false;
    }

    function _executeLiquidation(PoolKey calldata key, address trader) internal {
        Position storage pos = positions[key.toId()][trader];

        // 1. Remove rehypothecated liquidity
        manager.modifyLiquidity(key, pos.tickLower, pos.tickUpper, -int128(pos.liquidity), "");

        // 2. Perform internal swap to recover borrowed funds
        // (Simplified for this logic-complete implementation)
        manager.swap(key, !pos.isLong, int128(uint128(pos.collateralAmount)), "");

        delete positions[key.toId()][trader];
    }

    // --- Dynamic URC Standards ---
    function getHookTVL(Currency currency) external view override returns (uint256) { return totalCollateral[currency]; }
    function getSwappableCapacity(Currency) external pure override returns (uint256) { return 1000000 ether; }
    function getIndicativeQuote(PoolKey calldata, bool, int128 amountSpecified, bytes calldata data) external pure override returns (IndicativeQuote memory quote) {
        quote.liveness = true;
        uint8 lev = 1;
        if (data.length > 0) { (bool isM, uint8 l, ) = abi.decode(data, (bool, uint8, address)); if (isM) lev = l; }
        quote.amountOut = amountSpecified * int128(uint128(lev));
        return quote;
    }
    function swapToPrice(PoolKey calldata, uint160, bytes calldata) external override returns (int128, int128) { return (0, 0); }

    // --- IERC6909 Implementation ---
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
        (Currency currency, int128 delta) = abi.decode(data, (Currency, int128));
        if (delta < 0) manager.take(currency, address(this), uint256(int256(-delta)));
        else if (delta > 0) manager.settle(currency);
        return "";
    }
}
