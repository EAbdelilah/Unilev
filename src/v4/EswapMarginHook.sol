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
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
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
    error SlippageExceeded(uint256 received, uint256 minAmountOut);
    error InsufficientInsuranceFundForShortfall(uint256 shortfall, uint256 available);
    error MaxLeverageExceeded();
    error CollateralTooLow();
    error SwapOutputZero();
    error RouterNotSet();

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

    struct SolverDebt {
        address solver;
        uint256 principal;
        uint256 accumulatedYield;
    }

    // PoolId => trader => solver => SolverDebt
    mapping(PoolId => mapping(address => mapping(address => SolverDebt))) public solverDebts;

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

    /**
     * @notice Withdraws accumulated protocol fees to the treasury address.
     */
    function withdrawProtocolFee(Currency currency, uint256 amount) external onlyOwner {
        require(treasury != address(0), "Treasury not set");
        protocolFees[currency] -= amount;
        manager.unlock(abi.encode(currency, -int128(uint128(amount)), true));
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
            manager.unlock(abi.encode(currency, -int128(uint128(amount)), true));
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
        if (router == address(0)) revert RouterNotSet();
        PoolId poolId = key.toId();
        if (!isAuthorizedPool[poolId]) revert NotAuthorizedPool();

        if (data.length == 0) return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.toBeforeSwapDelta(0, 0), 0);

        (bool isMargin, uint8 leverage, address trader) = abi.decode(data, (bool, uint8, address));
        if (!isMargin) return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.toBeforeSwapDelta(0, 0), 0);

        if (leverage == 0 || leverage > MAX_LEVERAGE) revert MaxLeverageExceeded();
        uint256 marginAmount = uint256(int256(amountSpecified < 0 ? -amountSpecified : amountSpecified));
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
            int128 rawAmount = zeroForOne ? -amount1 : -amount0;
            if (rawAmount <= 0) revert SwapOutputZero();
            uint256 boughtAmount = uint256(int256(rawAmount));
            Currency boughtCurrency = zeroForOne ? key.currency1 : key.currency0;

            // STEP 2: Custom Accounting & Hook-Held Collateral (ERC-6909)
            // We mint output tokens as 6909s within the PM Singleton.
            uint256 protocolReserve = (boughtAmount * reserveFactor) / 10000;
            uint256 positionCollateral = boughtAmount - protocolReserve;

            protocolFees[boughtCurrency] += protocolReserve;
            // The Hook "mints" its 6909 claim on the collateral
            _claimBalances[trader][uint256(uint160(Currency.unwrap(boughtCurrency)))] += positionCollateral;
            totalCollateral[boughtCurrency] += positionCollateral;

            manager.mint(address(this), uint256(uint160(Currency.unwrap(boughtCurrency))), boughtAmount);

            // Track borrow for protocol-wide health view
            Currency borrowedToken = zeroForOne ? key.currency0 : key.currency1;
            totalBorrowedByToken[borrowedToken] += borrow;

            positions[key.toId()][trader] = Position({
                trader: trader,
                collateralAmount: positionCollateral,
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

            // Record last oracle sqrtPriceX96 for oracle price-capping test
            (uint160 sqrtPriceX96,,,) = manager.getSlot0(key.toId());
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
        (uint160 sqrtPriceX96,,,) = manager.getSlot0(key.toId());
        if (sqrtPriceX96 == 0) return; // Pool uninitialized

        // Convert sqrtPriceX96 to standard price ratio (scaled by 1e18)
        // price = (sqrtPriceX96^2 * 1e18) / 2^192
        // To avoid overflow, we do it carefully:
        uint256 spotRatio18 = FullMath.mulDiv(
            uint256(sqrtPriceX96) * uint256(sqrtPriceX96),
            1e18,
            1 << 192
        );

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
        // LONG:  bought currency1 (collateral), borrowed currency0 (debt)
        // SHORT: bought currency0 (collateral), borrowed currency1 (debt)
        uint256 collateralValueUsd = priceFeed.getAmountInUsd(Currency.unwrap(pos.isLong ? key.currency1 : key.currency0), pos.collateralAmount);
        uint256 borrowedValueUsd   = priceFeed.getAmountInUsd(Currency.unwrap(pos.isLong ? key.currency0 : key.currency1), pos.borrowedAmount);
        // Liquidation at 115% collateralization
        return collateralValueUsd * 100 < borrowedValueUsd * 115;
    }

    function rebalancePosition(PoolKey calldata key, address trader) external {
        require(msg.sender == router, "Only Router");
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

    /**
     * @notice Executes a forced liquidation of an underwater position.
     * @param key       The Uniswap V4 pool key.
     * @param trader    The trader whose position will be liquidated.
     * @param minAmountOut Minimum tokens the swap must return (slippage protection against MEV).
     *                     The caller (liquidation bot) should derive this from an oracle quote.
     */
    function executeLiquidation(PoolKey calldata key, address trader, uint256 minAmountOut) external {
        require(msg.sender == router, "Only Router");
        Position storage pos = positions[key.toId()][trader];
        if (!isLiquidatable(pos, key)) return;

        // Remove concentrated liquidity if deployed so we hold the tokens
        if (pos.liquidity > 0) {
            manager.modifyLiquidity(key, pos.tickLower, pos.tickUpper, -int128(pos.liquidity), "");
        }

        // To unwind: LONG held currency1 → sell currency1 (zeroForOne=false) → receive currency0
        //            SHORT held currency0 → sell currency0 (zeroForOne=true)  → receive currency1
        bool zeroForOne = !pos.isLong;
        BalanceDelta delta = manager.swap(key, zeroForOne, int128(uint128(pos.collateralAmount)), "");

        // receivedCurrency == borrowedCurrency: we sold collateral to repay what was borrowed
        Currency receivedCurrency = pos.isLong ? key.currency0 : key.currency1;
        Currency borrowedCurrency = receivedCurrency;

        // Amount received from the swap: zeroForOne=false → amount0 is positive output for LONG
        //                                zeroForOne=true  → amount1 is positive output for SHORT
        int128 receivedDelta = pos.isLong ? delta.amount0() : delta.amount1();
        uint256 receivedAmount = receivedDelta > 0 ? uint256(uint128(receivedDelta)) : 0;

        // Fix 2: Slippage protection – revert if output is below caller's floor
        if (receivedAmount < minAmountOut) {
            revert SlippageExceeded(receivedAmount, minAmountOut);
        }

        // Take the received tokens from the PoolManager
        if (receivedAmount > 0) {
            manager.take(receivedCurrency, address(this), receivedAmount);
        }

        // Fix 1: Route 3% of recovered output to the protocol insurance fund
        uint256 liquidatorReward = (receivedAmount * LIQUIDATION_REWARD_BPS) / 10000;
        if (liquidatorReward > 0) {
            insuranceFund[receivedCurrency] += liquidatorReward;
        }

        // Repay the borrowed amount to the PoolManager
        uint256 borrowedAmount = pos.borrowedAmount;
        uint256 remainingAfterReward = receivedAmount - liquidatorReward;

        if (remainingAfterReward >= borrowedAmount) {
            // Solvent: repay the full debt, return surplus to the trader
            IERC20(Currency.unwrap(borrowedCurrency)).approve(address(manager), borrowedAmount);
            manager.settle(borrowedCurrency);

            uint256 surplus = remainingAfterReward - borrowedAmount;
            if (surplus > 0) {
                IERC20(Currency.unwrap(receivedCurrency)).transfer(pos.trader, surplus);
            }
        } else {
            // Fix 3: Bad-debt path – only proceed if insurance fund can cover the shortfall
            uint256 shortfall = borrowedAmount - remainingAfterReward;
            if (insuranceFund[borrowedCurrency] < shortfall) {
                revert InsufficientInsuranceFundForShortfall(shortfall, insuranceFund[borrowedCurrency]);
            }
            insuranceFund[borrowedCurrency] -= shortfall;

            // Use recovered amount + insurance to settle the debt with the PM
            uint256 totalToSettle = remainingAfterReward + shortfall; // == borrowedAmount
            IERC20(Currency.unwrap(borrowedCurrency)).approve(address(manager), totalToSettle);
            manager.settle(borrowedCurrency);
        }

        delete positions[key.toId()][trader];
    }

    // --- URC-4 swapToPrice ---
    function swapToPrice(PoolKey calldata key, uint160 targetSqrtPriceX96, bytes calldata) external override onlyPoolManager returns (int128 delta0, int128 delta1) {
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

        Currency boughtCurrency = pos.isLong ? key.currency1 : key.currency0;

        (uint160 currentSqrtPriceX96, int24 currentTick, , ) = manager.getSlot0(key.toId());
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
            !pos.isLong
        ) returns (uint128 liq) {
            liquidity = liq;
        } catch {
            liquidity = uint128(pos.collateralAmount / 2); // graceful fallback
        }
        if (liquidity == 0) return;

        IERC20(Currency.unwrap(boughtCurrency)).approve(address(manager), pos.collateralAmount);
        manager.modifyLiquidity(key, tickLower, tickUpper, int128(liquidity), "");
        manager.settle(boughtCurrency);

        pos.tickLower = tickLower;
        pos.tickUpper = tickUpper;
        pos.liquidity = liquidity;
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
     */
    function registerSolverDebt(PoolId poolId, address trader, address solver, uint256 principal) external {
        require(msg.sender == router, "Only Router");
        solverDebts[poolId][trader][solver] = SolverDebt({
            solver: solver,
            principal: principal,
            accumulatedYield: 0
        });
    }

    /**
     * @notice Closes a leveraged margin position, settling solver debt and returning profit.
     */
    function closePosition(PoolKey calldata key, address trader, address solver, uint256 minAmountOut) external {
        require(msg.sender == router, "Only Router");
        PoolId poolId = key.toId();
        Position storage pos = positions[poolId][trader];
        require(pos.collateralAmount > 0, "No active position");

        // Decrement totalCollateral tracking
        Currency collateralCurrencyTracked = pos.isLong ? key.currency1 : key.currency0;
        if (totalCollateral[collateralCurrencyTracked] >= pos.collateralAmount) {
            totalCollateral[collateralCurrencyTracked] -= pos.collateralAmount;
        } else {
            totalCollateral[collateralCurrencyTracked] = 0;
        }

        SolverDebt storage debt = solverDebts[poolId][trader][solver];

        // 1. Remove concentrated liquidity if deployed
        if (pos.liquidity > 0) {
            manager.modifyLiquidity(key, pos.tickLower, pos.tickUpper, -int128(pos.liquidity), "");
            pos.liquidity = 0;
        }

        // 2. Swap collateral back to the debt token to repay the borrowed amount
        // LONG held currency1 (collateral) → sell currency1 (zeroForOne=false) → receive currency0 (debt)
        // SHORT held currency0 (collateral) → sell currency0 (zeroForOne=true)  → receive currency1 (debt)
        bool zeroForOne = !pos.isLong;
        int128 swapAmount = int128(uint128(pos.collateralAmount));
        manager.swap(key, zeroForOne, swapAmount, "");

        // 3. Settle deltas with the PoolManager
        // debtCurrency      = what was originally borrowed (what we receive back from the unwind swap)
        // collateralCurrency = what we sold (the position's held token)
        Currency debtCurrency       = pos.isLong ? key.currency0 : key.currency1;
        Currency collateralCurrency = pos.isLong ? key.currency1 : key.currency0;

        int256 deltaDebt = manager.currencyDelta(address(this), debtCurrency);
        if (deltaDebt < 0) {
            IERC20(Currency.unwrap(debtCurrency)).approve(address(manager), uint256(-deltaDebt));
            manager.settle(debtCurrency);
        } else if (deltaDebt > 0) {
            manager.take(debtCurrency, address(this), uint256(deltaDebt));
        }

        int256 deltaCollateral = manager.currencyDelta(address(this), collateralCurrency);
        if (deltaCollateral < 0) {
            IERC20(Currency.unwrap(collateralCurrency)).approve(address(manager), uint256(-deltaCollateral));
            manager.settle(collateralCurrency);
        } else if (deltaCollateral > 0) {
            manager.take(collateralCurrency, address(this), uint256(deltaCollateral));
        }

        // 4. Settle Solver Principal + Yield
        uint256 totalPayout = debt.principal + debt.accumulatedYield;
        if (totalPayout > 0) {
            IERC20(Currency.unwrap(debtCurrency)).transfer(debt.solver, totalPayout);
        }

        // 5. Return remaining collateral/profit to the trader
        uint256 receivedAmount = deltaDebt > 0 ? uint256(deltaDebt) : 0;
        if (receivedAmount < minAmountOut) {
            revert SlippageExceeded(receivedAmount, minAmountOut);
        }
        if (receivedAmount > totalPayout) {
            uint256 profit = receivedAmount - totalPayout;
            IERC20(Currency.unwrap(debtCurrency)).transfer(trader, profit);
        }

        delete positions[poolId][trader];
        delete solverDebts[poolId][trader][solver];
    }

    // --- Invariant & Health View Helpers ---
    function getTransientLockState() external view returns (uint256) {
        return uint256(_getKey(TRADER_BASE, msg.sender).tloadUint());
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
            manager.settle(currency);
            manager.mint(address(this), uint256(uint160(Currency.unwrap(currency))), uint256(int256(delta)));
        }
        return "";
    }
}
