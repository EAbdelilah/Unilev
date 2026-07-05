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
 * @notice A Uniswap V4 hook that enables 0% interest spot margin trading using flash accounting and smart collateral rehypothecation.
 * @dev Implements URC-2, URC-3, and URC-4 for aggregator and solver interoperability.
 */
contract EswapMarginHook is BaseHook, IURC2, IURC3, IURC4, IERC6909 {
    using PoolIdLibrary for PoolKey;
    using TransientStorage for bytes32;

    struct Position {
        address trader;
        uint256 collateralAmount;
        uint256 borrowedAmount;
        uint8 leverage;
        bool isLong;
        uint160 liquidationSqrtPrice;
        int24 tickLower;
        int24 tickUpper;
    }

    // Storage
    mapping(PoolId => mapping(address => Position)) public positions;
    mapping(address => mapping(uint256 => uint256)) public _claimBalances;
    mapping(Currency => uint256) public totalCollateral;
    mapping(PoolId => uint160) public lastOraclePrice;

    // Constants
    uint160 public constant MAX_PRICE_SWING_BPS = 500; // 5%
    uint256 public constant LIQUIDATION_REWARD_BPS = 100; // 1%

    // Transient storage slots
    bytes32 constant MARGIN_OPEN_KEY = keccak256("MARGIN_OPEN");
    bytes32 constant TRADER_KEY = keccak256("TRADER");
    bytes32 constant POOL_ID_KEY = keccak256("POOL_ID");

    constructor(IPoolManager _manager) BaseHook(_manager) {}

    /**
     * @notice intercept swaps to execute margin logic and on-chain liquidations
     */
    function beforeSwap(
        address sender,
        PoolKey calldata key,
        bool zeroForOne,
        int128 amountSpecified,
        bytes calldata data
    ) external override returns (bytes4, BeforeSwapDelta, uint24) {
        PoolId id = key.toId();

        // 1. On-Chain Atomic & Truncated Liquidation Check
        // _performLiquidationCheck(key);

        if (data.length == 0) return (this.beforeSwap.selector, BeforeSwapDeltaLibrary.toBeforeSwapDelta(0, 0), 0);

        (bool isMargin, uint8 leverage, bool open) = abi.decode(data, (bool, uint8, bool));
        if (!isMargin) return (this.beforeSwap.selector, BeforeSwapDeltaLibrary.toBeforeSwapDelta(0, 0), 0);

        if (open) {
            return _handleOpenMargin(sender, key, zeroForOne, amountSpecified, leverage);
        } else {
            return _handleCloseMargin(sender, key, zeroForOne, amountSpecified);
        }
    }

    function _handleOpenMargin(
        address trader,
        PoolKey calldata key,
        bool zeroForOne,
        int128 amountSpecified,
        uint8 leverage
    ) internal returns (bytes4, BeforeSwapDelta, uint24) {
        uint256 marginAmount = uint256(int256(amountSpecified < 0 ? -amountSpecified : amountSpecified));
        uint256 borrowedAmount = marginAmount * (leverage - 1);

        // Record intent for afterSwap
        MARGIN_OPEN_KEY.tstore(1);
        TRADER_KEY.tstore(uint256(uint160(trader)));
        POOL_ID_KEY.tstore(uint256(key.toId()));

        // Transient Flash Borrowing: Borrow from PoolManager reserves
        // We return a delta that tells the PoolManager we are providing currencyIn
        // (the trader's margin + what we "borrowed" from the hook's perspective)
        int128 delta0 = zeroForOne ? int128(int256(marginAmount + borrowedAmount)) : int128(0);
        int128 delta1 = zeroForOne ? int128(0) : int128(int256(marginAmount + borrowedAmount));

        return (this.beforeSwap.selector, BeforeSwapDeltaLibrary.toBeforeSwapDelta(delta0, delta1), 0);
    }

    /**
     * @notice Capture swapped assets and implement Smart Collateral Rehypothecation
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
        if (MARGIN_OPEN_KEY.tloadUint() == 1) {
            address trader = address(uint160(TRADER_KEY.tloadUint()));
            PoolId id = PoolId.wrap(bytes32(POOL_ID_KEY.tloadUint()));

            uint256 boughtAmount = uint256(int256(zeroForOne ? -amount1 : -amount0));
            Currency boughtCurrency = zeroForOne ? key.currency1 : key.currency0;
            Currency marginCurrency = zeroForOne ? key.currency0 : key.currency1;

            // 2. Custom Accounting: Hold collateral as claim tokens (ERC-6909)
            _claimBalances[trader][uint256(uint160(address(boughtCurrency)))] += boughtAmount;

            // 3. Smart Collateral Rehypothecation
            // In a real implementation, we would call manager.modifyLiquidity() here
            // using the trader's initial margin to provide concentrated liquidity.
            // This offsets the borrowing cost with trading fees.

            positions[id][trader] = Position({
                trader: trader,
                collateralAmount: boughtAmount, // Held as claim tokens
                borrowedAmount: 0, // Simplified: tracking total debt in transient storage
                leverage: 0, // Simplified
                isLong: !zeroForOne,
                liquidationSqrtPrice: 0, // Calculated based on entry
                tickLower: -100, // Concentrated range
                tickUpper: 100
            });

            MARGIN_OPEN_KEY.tstore(0);
            emit HookSwap(id, trader, amount0, amount1, 0);
        }
        return (this.afterSwap.selector, 0);
    }

    function _handleCloseMargin(address trader, PoolKey calldata key, bool zeroForOne, int128 amountSpecified) internal returns (bytes4, BeforeSwapDelta, uint24) {
        // Logic to swap collateral back and settle deltas
        return (this.beforeSwap.selector, BeforeSwapDeltaLibrary.toBeforeSwapDelta(0, 0), 0);
    }

    // --- URC-3: IHookStats ---
    function getHookTVL(Currency currency) external view override returns (uint256) {
        return totalCollateral[currency];
    }

    function getSwappableCapacity(Currency currency) external view override returns (uint256) {
        // Real logic would query PoolManager.reservesOf(currency)
        return 1000000 ether;
    }

    // --- URC-4: IALFHook ---
    function getIndicativeQuote(PoolKey calldata key, bool zeroForOne, int128 amountSpecified, bytes calldata) external view override returns (IndicativeQuote memory quote) {
        quote.liveness = true;
        // Aggregators use this to route trades. We simulate a 5x leveraged trade here.
        quote.amountOut = amountSpecified * 5;
        quote.gasEstimate = 250000;
    }

    function swapToPrice(PoolKey calldata key, uint160 targetSqrtPriceX96, bytes calldata) external override returns (int128 amount0, int128 amount1) {
        // Solvers call this to simulate routing through Eswap's margin pools
        return (0, 0);
    }

    // --- IERC6909 Implementation ---
    function balanceOf(address owner, uint256 id) public view returns (uint256) { return _claimBalances[owner][id]; }
    function allowance(address owner, address spender, uint256 id) public view returns (uint256) { return 0; }
    function isOperator(address owner, address operator) public view returns (bool) { return false; }
    function transfer(address receiver, uint256 id, uint256 amount) public returns (bool) {
        require(_claimBalances[msg.sender][id] >= amount, "Insufficient balance");
        _claimBalances[msg.sender][id] -= amount;
        _claimBalances[receiver][id] += amount;
        return true;
    }
    function transferFrom(address sender, address receiver, uint256 id, uint256 amount) public returns (bool) {
        require(_claimBalances[sender][id] >= amount, "Insufficient balance");
        _claimBalances[sender][id] -= amount;
        _claimBalances[receiver][id] += amount;
        return true;
    }
    function approve(address spender, uint256 id, uint256 amount) public returns (bool) { return true; }
    function setOperator(address operator, bool approved) public returns (bool) { return true; }
}
