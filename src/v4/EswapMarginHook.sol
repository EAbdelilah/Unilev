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
    error OnlyRouter();
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

    // Insurance Fund is tracked internally as ERC-6909 claim tokens within the PoolManager
    mapping(Currency => uint256) public insuranceFund;
    uint256 public constant RESERVE_FACTOR = 50; // 0.5% Protocol Reserve (Flywheel for $0 Launch)

    uint160 public constant MAX_PRICE_SWING_BPS = 500;
    uint8 public constant MAX_LEVERAGE = 5;

    bytes32 constant TRADER_BASE = keccak256("TRADER");
    bytes32 constant BORROW_BASE = keccak256("BORROW");
    bytes32 constant LEVERAGE_BASE = keccak256("LEVERAGE");
    bytes32 constant ACTIVE_LOCKER = keccak256("ACTIVE_LOCKER");

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

    /**
     * @notice Withdraws physically settled tokens from the Insurance Fund.
     */
    function withdrawInsuranceFund(Currency currency, address to, uint256 amount) external onlyOwner {
        insuranceFund[currency] -= amount;
        manager.unlock(abi.encode(currency, -int128(uint128(amount)), true)); // Take from PM
        IERC20(Currency.unwrap(currency)).transfer(to, amount);
    }

    function setRouter(address _router) external onlyOwner {
        router = _router;
        // Grant router permission to manage hook's 6909 tokens for bridge settlement
        IERC6909(address(manager)).setOperator(_router, true);
    }

    /**
     * @notice Security verification set by the Router during its unlock callback.
     */
    function setTickLocker(address locker) external {
        if (msg.sender != router) revert OnlyRouter();
        ACTIVE_LOCKER.tstore(locker);
    }

    /**
     * @notice Allows the Router (locker) to bridge a V4 swap using Hook-held 6909 tokens.
     * This avoids ERC-20 transfers and keeps the settlement 100% within the Singleton.
     */
    function pullInsuranceBridge(Currency currency, uint256 amount) external {
        require(msg.sender == router, "Only Router");
        insuranceFund[currency] -= amount;
        // The Router will call manager.burn(currency, amount) using the Hook's balance
    }

    /**
     * @notice Seed the insurance fund using physical ERC20s, converting them to 6909s.
     */
    function seedInsuranceFund(Currency currency, uint256 amount) external {
        IERC20(Currency.unwrap(currency)).transferFrom(msg.sender, address(this), amount);
        IERC20(Currency.unwrap(currency)).approve(address(manager), amount);
        manager.unlock(abi.encode(currency, int128(uint128(amount)), false)); // Settle to PM to get 6909s
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

        // SECURITY FIX: Ensure the swap is initiated by our authorized Router
        if (ACTIVE_LOCKER.tload() != router) revert OnlyRouter();

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
            // We mint output tokens as 6909s within the PM Singleton.
            uint256 protocolReserve = (boughtAmount * RESERVE_FACTOR) / 10000;
            uint256 positionCollateral = boughtAmount - protocolReserve;

            insuranceFund[boughtCurrency] += protocolReserve;
            // The Hook "mints" its 6909 claim on the collateral
            _claimBalances[trader][uint256(uint160(Currency.unwrap(boughtCurrency)))] += positionCollateral;
            totalCollateral[boughtCurrency] += positionCollateral;

            manager.mint(address(this), uint256(uint160(Currency.unwrap(boughtCurrency))), boughtAmount);

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

        Currency collateralCurrency = pos.isLong ? key.currency1 : key.currency0;
        Currency borrowedCurrency = pos.isLong ? key.currency0 : key.currency1;

        // 1. Swap collateral back to borrowed currency
        manager.swap(key, pos.isLong, int128(uint128(pos.collateralAmount)), "");

        // 2. Settle the collateral input using 6909 claims
        manager.burn(address(this), uint256(uint160(Currency.unwrap(collateralCurrency))), pos.collateralAmount);

        // 3. Check borrowed currency delta to see if we have bad debt or surplus
        int256 borrowedDelta = manager.currencyDelta(router, borrowedCurrency);

        if (borrowedDelta > 0) {
             uint256 shortfall = uint256(borrowedDelta);
             // Cover Bad Debt using Insurance Fund if necessary
             if (insuranceFund[borrowedCurrency] >= shortfall) {
                 insuranceFund[borrowedCurrency] -= shortfall;
                 manager.burn(address(this), uint256(uint160(Currency.unwrap(borrowedCurrency))), shortfall);
             } else {
                 // Settle physically if insurance fund is insufficient
                 IERC20(Currency.unwrap(borrowedCurrency)).transfer(address(manager), shortfall);
                 manager.settle(borrowedCurrency);
             }
        } else if (borrowedDelta < 0) {
             // Surplus! Add to Insurance Fund
             uint256 surplus = uint256(-borrowedDelta);
             manager.mint(address(this), uint256(uint160(Currency.unwrap(borrowedCurrency))), surplus);
             insuranceFund[borrowedCurrency] += surplus;
        }

        delete positions[key.toId()][trader];
    }

    // --- URC-4 swapToPrice ---
    /**
     * @notice URC-4 Compliance: Allows solvers to simulate execution depth to a specific price.
     * ESWAP utilizes its hook-held collateral as "active liquidity" that solvers can route through.
     */
    function swapToPrice(PoolKey calldata key, uint160 targetSqrtPriceX96, bytes calldata) external override onlyPoolManager returns (int128 delta0, int128 delta1) {
        (uint160 currentSqrtPriceX96, , , ) = manager.getSlot0(key.toId());
        bool zeroForOne = currentSqrtPriceX96 > targetSqrtPriceX96;

        Currency currencyIn = zeroForOne ? key.currency0 : key.currency1;
        uint256 swappableAmount = totalCollateral[currencyIn];

        // Simplified price-math for simulation:
        // Solvers use this to understand how much the hook can contribute to reaching target price.
        // We contribute up to our total held collateral of the input currency.
        if (zeroForOne) {
            delta0 = int128(uint128(swappableAmount));
            // Output delta (delta1) would be calculated by PM based on curve
            delta1 = 0;
        } else {
            delta1 = int128(uint128(swappableAmount));
            delta0 = 0;
        }

        return (delta0, delta1);
    }

    function getHookTVL(Currency currency) external view override returns (uint256) { return totalCollateral[currency]; }
    function getSwappableCapacity(Currency currency) external view override returns (uint256) { return totalCollateral[currency]; }

    /**
     * @notice Returns the amount of debt the protocol can currently "bridge" to settle V4 deltas.
     */
    function getBridgeCapacity(Currency currency) external view returns (uint256) {
        return insuranceFund[currency];
    }
    function getIndicativeQuote(PoolKey calldata, bool, int128 amountSpecified, bytes calldata data) external pure override returns (IndicativeQuote memory quote) {
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

        manager.modifyLiquidity(key, tickLower, tickUpper, int128(liquidity), "");
        // ACCOUNTING FIX: Use 6909 tokens (claims) held by the hook to settle the delta
        manager.burn(address(this), uint256(uint160(Currency.unwrap(boughtCurrency))), pos.collateralAmount);

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
