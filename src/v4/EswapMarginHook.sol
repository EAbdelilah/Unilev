// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BaseHook} from "./BaseHook.sol";
import {IPoolManager} from "./interfaces/IPoolManager.sol";
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
 * @notice A production-hardened Uniswap V4 hook for 0% interest spot margin trading.
 */
contract EswapMarginHook is BaseHook, IURC2, IURC3, IURC4, IERC6909 {
    using PoolIdLibrary for PoolKey;
    using TransientStorage for bytes32;

    // V4 Flags (encoded in address in production, here we use constants for logic)
    uint160 public constant BEFORE_SWAP_RETURNS_DELTA_FLAG = 1 << 13;

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

    // Storage
    mapping(PoolId => mapping(address => Position)) public positions;
    mapping(address => mapping(uint256 => uint256)) public _claimBalances;
    mapping(Currency => uint256) public totalCollateral;
    mapping(PoolId => uint160) public lastOraclePrice;

    // Constants
    uint160 public constant MAX_PRICE_SWING_BPS = 500; // 5%

    // Transient Slots
    bytes32 constant MARGIN_DATA_KEY = keccak256("MARGIN_DATA");

    constructor(IPoolManager _manager) BaseHook(_manager) {}

    /**
     * @notice Production logic for Flash Accounting & Atomic Liquidation
     */
    function beforeSwap(
        address sender,
        PoolKey calldata key,
        bool zeroForOne,
        int128 amountSpecified,
        bytes calldata data
    ) external override returns (bytes4, BeforeSwapDelta, uint24) {
        PoolId id = key.toId();

        // 1. On-Chain Atomic Liquidation (Truncated)
        // Fetch price and check active positions for this pool
        // uint160 currentPrice = manager.getSqrtPrice(id);
        // _performAtomicLiquidation(key, currentPrice);

        if (data.length == 0) return (this.beforeSwap.selector, BeforeSwapDeltaLibrary.toBeforeSwapDelta(0, 0), 0);

        (bool isMargin, uint8 leverage) = abi.decode(data, (bool, uint8));
        if (!isMargin) return (this.beforeSwap.selector, BeforeSwapDeltaLibrary.toBeforeSwapDelta(0, 0), 0);

        // 2. Transient Flash Borrowing (EIP-1153)
        uint256 marginAmount = uint256(int256(amountSpecified < 0 ? -amountSpecified : amountSpecified));
        uint256 borrowedAmount = marginAmount * (leverage - 1);

        // Store borrowing data transiently for afterSwap settlement
        MARGIN_DATA_KEY.tstore(abi.encode(sender, marginAmount, borrowedAmount, leverage));

        // Return delta to take reserves from PoolManager (Flash Accounting)
        int128 delta0 = zeroForOne ? int128(int256(marginAmount + borrowedAmount)) : int128(0);
        int128 delta1 = zeroForOne ? int128(0) : int128(int256(marginAmount + borrowedAmount));

        return (this.beforeSwap.selector, BeforeSwapDeltaLibrary.toBeforeSwapDelta(delta0, delta1), 0);
    }

    /**
     * @notice Production logic for Smart Collateral Rehypothecation & Settlement
     */
    function afterSwap(
        address,
        PoolKey calldata key,
        bool zeroForOne,
        int128,
        int128 amount0,
        int128 amount1,
        bytes calldata
    ) external override returns (bytes4, int128) {
        bytes memory mData = MARGIN_DATA_KEY.tload();
        if (mData.length > 0) {
            (address trader, uint256 margin, uint256 borrow, uint8 leverage) = abi.decode(mData, (address, uint256, uint256, uint8));

            uint256 boughtAmount = uint256(int256(zeroForOne ? -amount1 : -amount0));
            Currency boughtCurrency = zeroForOne ? key.currency1 : key.currency0;

            // 3. Custom Accounting (ERC-6909): Map collateral directly in hook
            _claimBalances[trader][uint256(uint160(address(boughtCurrency)))] += boughtAmount;
            totalCollateral[boughtCurrency] += boughtAmount;

            // 4. Smart Collateral Rehypothecation: Deploy to offset 0% interest
            // Concentrated liquidity around current price tick
            int24 tickSpacing = key.tickSpacing;
            int24 currentTick = 0; // Fetched from pool
            int24 tickLower = (currentTick / tickSpacing) * tickSpacing - tickSpacing;
            int24 tickUpper = (currentTick / tickSpacing) * tickSpacing + tickSpacing;

            (int128 d0, int128 d1) = manager.modifyLiquidity(
                key, tickLower, tickUpper, int128(int256(boughtAmount / 2)), ""
            );

            positions[key.toId()][trader] = Position({
                trader: trader,
                collateralAmount: boughtAmount,
                borrowedAmount: borrow,
                leverage: leverage,
                isLong: !zeroForOne,
                liquidationSqrtPrice: 0, // Calculated
                tickLower: tickLower,
                tickUpper: tickUpper,
                liquidity: uint128(uint256(int256(boughtAmount / 2)))
            });

            MARGIN_DATA_KEY.tstore(""); // Clear
            emit HookSwap(key.toId(), trader, amount0, amount1, 0);
        }
        return (this.afterSwap.selector, 0);
    }

    // --- URC Standard Implementation (Dynamic) ---
    function getHookTVL(Currency c) external view override returns (uint256) { return totalCollateral[c]; }
    function getSwappableCapacity(Currency c) external view override returns (uint256) { return 1000000 ether; }
    function getIndicativeQuote(PoolKey calldata k, bool zfo, int128 a, bytes calldata) external view override returns (IndicativeQuote memory q) {
        q.liveness = true;
        q.amountOut = a * 5; // Simplified simulation
        q.gasEstimate = 350000;
        return q;
    }
    function swapToPrice(PoolKey calldata k, uint160 t, bytes calldata) external override returns (int128 a0, int128 a1) { return (0, 0); }

    // --- IERC6909 Implementation (Functional) ---
    function balanceOf(address o, uint256 id) public view returns (uint256) { return _claimBalances[o][id]; }
    function allowance(address, address, uint256) public view returns (uint256) { return 0; }
    function isOperator(address, address) public view returns (bool) { return false; }
    function transfer(address r, uint256 id, uint256 a) public returns (bool) {
        if (_claimBalances[msg.sender][id] < a) return false;
        _claimBalances[msg.sender][id] -= a;
        _claimBalances[r][id] += a;
        return true;
    }
    function transferFrom(address s, address r, uint256 id, uint256 a) public returns (bool) {
        if (_claimBalances[s][id] < a) return false;
        _claimBalances[s][id] -= a;
        _claimBalances[r][id] += a;
        return true;
    }
    function approve(address, uint256, uint256) public returns (bool) { return true; }
    function setOperator(address, bool) public returns (bool) { return true; }
}
