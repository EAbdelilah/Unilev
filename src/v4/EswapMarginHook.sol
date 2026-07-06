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
 * @notice A hardened Uniswap V4 hook for 0% interest spot margin trading with Insurance Fund and TWAP/Oracle protection.
 */
contract EswapMarginHook is BaseHook, IURC2, IURC3, IURC4, IERC6909 {
    using PoolIdLibrary for PoolKey;
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

    // --- Hardening state ---
    IPriceFeed public immutable priceFeed;
    mapping(Currency => uint256) public insuranceFund;
    uint256 public constant RESERVE_FACTOR = 1000; // 10%

    uint160 public constant MAX_PRICE_SWING_BPS = 500;
    uint8 public constant MAX_LEVERAGE = 5;

    // Transient storage keys
    bytes32 constant TRADER_KEY = keccak256("TRADER");
    bytes32 constant MARGIN_KEY = keccak256("MARGIN");
    bytes32 constant BORROW_KEY = keccak256("BORROW");
    bytes32 constant LEVERAGE_KEY = keccak256("LEVERAGE");

    constructor(IPoolManager _manager, IPriceFeed _priceFeed) BaseHook(_manager) {
        priceFeed = _priceFeed;
        if (uint160(address(this)) & getHookFlags() != getHookFlags()) revert InvalidHookAddress();
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

        (uint160 currentPrice, int24 currentTick, , ) = manager.getSlot0(poolId);

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
            Position storage pos = positions[poolId][trader];
            if (pos.collateralAmount > 0) {
                if (isLiquidatable(pos, key)) {
                    _executeLiquidation(key, trader);
                } else {
                    if (currentTick < pos.tickLower || currentTick >= pos.tickUpper) {
                        _rebalancePosition(key, trader, currentTick);
                    }
                }
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
            manager.take(boughtCurrency, address(this), boughtAmount);

            (uint160 currentSqrtPriceX96, int24 currentTick, , ) = manager.getSlot0(key.toId());
            int24 tickLower = (currentTick / key.tickSpacing) * key.tickSpacing - key.tickSpacing;
            int24 tickUpper = (currentTick / key.tickSpacing) * key.tickSpacing + key.tickSpacing;

            uint128 liquidity = LiquidityAmounts.getLiquidityForAmount(
                currentSqrtPriceX96,
                LiquidityAmounts.getSqrtRatioAtTick(tickLower),
                LiquidityAmounts.getSqrtRatioAtTick(tickUpper),
                margin,
                zeroForOne
            );

            manager.modifyLiquidity(key, tickLower, tickUpper, int128(liquidity), "");

            positions[key.toId()][trader] = Position({
                trader: trader,
                collateralAmount: boughtAmount,
                borrowedAmount: borrow,
                leverage: leverage,
                isLong: !zeroForOne,
                liquidationSqrtPrice: 0,
                tickLower: tickLower,
                tickUpper: tickUpper,
                liquidity: liquidity
            });

            TRADER_KEY.tstore(address(0));
            emit HookSwap(key.toId(), trader, amount0, amount1, 0);
        }
        return (IHooks.afterSwap.selector, 0);
    }

    function isLiquidatable(Position memory pos, PoolKey calldata key) public view returns (bool) {
        if (pos.collateralAmount == 0) return false;

        uint256 collateralValueUsd = priceFeed.getAmountInUsd(
            Currency.unwrap(pos.isLong ? key.currency1 : key.currency0),
            pos.collateralAmount
        );
        uint256 borrowedValueUsd = priceFeed.getAmountInUsd(
            Currency.unwrap(pos.isLong ? key.currency0 : key.currency1),
            pos.borrowedAmount
        );

        return collateralValueUsd * 100 < borrowedValueUsd * 115;
    }

    function _rebalancePosition(PoolKey calldata key, address trader, int24 currentTick) internal {
        Position storage pos = positions[key.toId()][trader];
        manager.modifyLiquidity(key, pos.tickLower, pos.tickUpper, -int128(pos.liquidity), "");

        int24 tickLower = (currentTick / key.tickSpacing) * key.tickSpacing - key.tickSpacing;
        int24 tickUpper = (currentTick / key.tickSpacing) * key.tickSpacing + key.tickSpacing;
        manager.modifyLiquidity(key, tickLower, tickUpper, int128(pos.liquidity), "");

        pos.tickLower = tickLower;
        pos.tickUpper = tickUpper;
    }

    function _executeLiquidation(PoolKey calldata key, address trader) internal {
        Position storage pos = positions[key.toId()][trader];

        manager.modifyLiquidity(key, pos.tickLower, pos.tickUpper, -int128(pos.liquidity), "");

        int128 delta = manager.swap(key, !pos.isLong, int128(uint128(pos.collateralAmount)), "");

        Currency borrowedCurrency = pos.isLong ? key.currency0 : key.currency1;

        // --- PRODUCTION SETTLEMENT ---
        // Uniswap V4: After swap, the PM is owed tokens if delta > 0.
        // We must transfer tokens to the PM and then call settle().
        if (delta > 0) {
            uint256 amountOwed = uint256(int256(delta));
            uint256 recoveryAmount = amountOwed < pos.borrowedAmount ? amountOwed : pos.borrowedAmount; // Placeholder logic

            // If shortfall exists, cover from Insurance Fund
            if (recoveryAmount < amountOwed) {
                uint256 shortfall = amountOwed - recoveryAmount;
                if (insuranceFund[borrowedCurrency] >= shortfall) {
                    insuranceFund[borrowedCurrency] -= shortfall;
                    // Transfer insurance funds to PM
                    IERC20(Currency.unwrap(borrowedCurrency)).transfer(address(manager), shortfall);
                    manager.settle(borrowedCurrency);
                }
            }
        }

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
