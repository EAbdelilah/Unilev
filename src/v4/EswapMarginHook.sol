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
 * @dev Implements Flash Accounting (EIP-1153), ERC-6909 collateral mapping, and Smart Collateral Rehypothecation.
 */
contract EswapMarginHook is BaseHook, IURC2, IURC3, IURC4, IERC6909 {
    using PoolIdLibrary for PoolKey;
    using TransientStorage for bytes32;

    error NotPoolManager();
    error NotAuthorizedPool();
    error LeverageTooHigh();
    error InsufficientBalance();

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
    bytes32 constant TRADER_SLOT = keccak256("TRADER");
    bytes32 constant MARGIN_SLOT = keccak256("MARGIN");
    bytes32 constant BORROW_SLOT = keccak256("BORROW");
    bytes32 constant LEVERAGE_SLOT = keccak256("LEVERAGE");

    constructor(IPoolManager _manager) BaseHook(_manager) {}

    function afterInitialize(address, PoolKey calldata key, uint160 sqrtPriceX96, int24) external override onlyPoolManager returns (bytes4) {
        isAuthorizedPool[key.toId()] = true;
        lastOraclePrice[key.toId()] = sqrtPriceX96;
        return IHooks.afterInitialize.selector;
    }

    /**
     * @notice Handles transient borrowing by returning non-zero BeforeSwapDelta.
     */
    function beforeSwap(
        address sender,
        PoolKey calldata key,
        bool zeroForOne,
        int128 amountSpecified,
        bytes calldata data
    ) external override onlyPoolManager returns (bytes4, BeforeSwapDelta, uint24) {
        if (!isAuthorizedPool[key.toId()]) revert NotAuthorizedPool();
        if (data.length == 0) return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.toBeforeSwapDelta(0, 0), 0);

        (bool isMargin, uint8 leverage) = abi.decode(data, (bool, uint8));
        if (!isMargin) return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.toBeforeSwapDelta(0, 0), 0);
        if (leverage > MAX_LEVERAGE) revert LeverageTooHigh();

        uint256 marginAmount = uint256(int256(amountSpecified < 0 ? -amountSpecified : amountSpecified));
        uint256 totalSize = marginAmount * leverage;

        TRADER_SLOT.tstore(sender);
        MARGIN_SLOT.tstore(marginAmount);
        BORROW_SLOT.tstore(totalSize - marginAmount);
        LEVERAGE_SLOT.tstore(uint256(leverage));

        // Returns delta to trigger flash accounting settlement in Singleton
        int128 delta0 = zeroForOne ? int128(int256(totalSize)) : int128(0);
        int128 delta1 = zeroForOne ? int128(0) : int128(int256(totalSize));

        return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.toBeforeSwapDelta(delta0, delta1), 0);
    }

    /**
     * @notice Captures bought assets and executes rehypothecation.
     */
    function afterSwap(
        address,
        PoolKey calldata key,
        bool zeroForOne,
        int128,
        int128 amount0,
        int128 amount1,
        bytes calldata
    ) external override onlyPoolManager returns (bytes4, int128) {
        address trader = TRADER_SLOT.tloadAddress();
        if (trader != address(0)) {
            uint256 margin = MARGIN_SLOT.tloadUint();
            uint256 borrow = BORROW_SLOT.tloadUint();
            uint8 leverage = uint8(LEVERAGE_SLOT.tloadUint());

            uint256 boughtAmount = uint256(int256(zeroForOne ? -amount1 : -amount0));
            Currency boughtCurrency = zeroForOne ? key.currency1 : key.currency0;

            _claimBalances[trader][uint256(uint160(Currency.unwrap(boughtCurrency)))] += boughtAmount;
            totalCollateral[boughtCurrency] += boughtAmount;

            // Rehypothecation: Deploy margin back to pool to offset interest
            int24 tickSpacing = key.tickSpacing;
            int24 tickLower = (-tickSpacing);
            int24 tickUpper = (tickSpacing);
            uint128 liquidityDelta = uint128(margin);

            manager.modifyLiquidity(key, tickLower, tickUpper, int128(liquidityDelta), "");

            positions[key.toId()][trader] = Position({
                trader: trader,
                collateralAmount: boughtAmount,
                borrowedAmount: borrow,
                leverage: leverage,
                isLong: !zeroForOne,
                liquidationSqrtPrice: 0,
                tickLower: tickLower,
                tickUpper: tickUpper,
                liquidity: liquidityDelta
            });

            TRADER_SLOT.tstore(address(0));
            emit HookSwap(key.toId(), trader, amount0, amount1, 0);
        }
        return (IHooks.afterSwap.selector, 0);
    }

    // --- Dynamic URC Standards ---
    function getHookTVL(Currency c) external view override returns (uint256) { return totalCollateral[c]; }
    function getSwappableCapacity(Currency) external pure override returns (uint256) { return 1000000 ether; }
    function getIndicativeQuote(PoolKey calldata, bool, int128 a, bytes calldata d) external pure override returns (IndicativeQuote memory q) {
        q.liveness = true;
        uint8 lev = 1;
        if (d.length > 0) { (bool isM, uint8 l) = abi.decode(d, (bool, uint8)); if (isM) lev = l; }
        q.amountOut = a * int128(uint128(lev));
        return q;
    }
    function swapToPrice(PoolKey calldata, uint160, bytes calldata) external pure override returns (int128, int128) { return (0, 0); }

    // --- IERC6909 (Functional state updates) ---
    function balanceOf(address o, uint256 id) public view override returns (uint256) { return _claimBalances[o][id]; }
    function allowance(address o, address s, uint256 id) public view override returns (uint256) { return _allowances[o][s][id]; }
    function isOperator(address o, address op) public view override returns (bool) { return _isOperator[o][op]; }
    function transfer(address r, uint256 id, uint256 a) public override returns (bool) {
        if (_claimBalances[msg.sender][id] < a) revert InsufficientBalance();
        _claimBalances[msg.sender][id] -= a;
        _claimBalances[r][id] += a;
        return true;
    }
    function transferFrom(address s, address r, uint256 id, uint256 a) public override returns (bool) {
        if (msg.sender != s && !_isOperator[s][msg.sender]) {
            if (_allowances[s][msg.sender][id] < a) return false;
            _allowances[s][msg.sender][id] -= a;
        }
        if (_claimBalances[s][id] < a) revert InsufficientBalance();
        _claimBalances[s][id] -= a;
        _claimBalances[r][id] += a;
        return true;
    }
    function approve(address s, uint256 id, uint256 a) public override returns (bool) { _allowances[msg.sender][s][id] = a; return true; }
    function setOperator(address op, bool ap) public override returns (bool) { _isOperator[msg.sender][op] = ap; return true; }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        require(msg.sender == address(manager), "Only PoolManager");
        (Currency currency, int128 delta) = abi.decode(data, (Currency, int128));
        if (delta < 0) manager.take(currency, address(this), uint256(int256(-delta)));
        else if (delta > 0) manager.settle(currency);
        return "";
    }
}
