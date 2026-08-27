// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {IUniswapV3Factory, IUniswapV3Pool} from "../interfaces/IUniswapV3.sol";
import {PriceFeedL1} from "../PriceFeedL1.sol";
import {LiquidityPoolFactory} from "../LiquidityPoolFactory.sol";
import {
    Positions__POOL_NOT_OFFICIAL,
    Positions__TOKEN_NOT_SUPPORTED,
    Positions__NO_PRICE_FEED,
    Positions__LEVERAGE_NOT_IN_RANGE,
    Positions__TOKEN_NOT_SUPPORTED_ON_MARGIN,
    Positions__AMOUNT_TO_SMALL,
    Positions__LIMIT_ORDER_PRICE_NOT_CONCISTENT,
    Positions__STOP_LOSS_ORDER_PRICE_NOT_CONCISTENT
} from "./PositionTypes.sol";

library PositionLogic {
    struct ValidationParams {
        address token0;
        address token1;
        uint24 fee;
        uint8 leverage;
        uint256 amount;
        uint256 limitPrice;
        uint256 stopLossPrice;
        address liquidityPoolFactoryUniswapV3;
        address liquidityPoolFactory;
        address priceFeed;
        uint256 maxLeverage;
        uint256 minPositionAmountInUsd;
    }

    struct ValidationResult {
        uint256 price;
        address baseToken;
        address quoteToken;
        bool isBaseToken0;
        address v3Pool;
    }

    struct PnLCalculationParams {
        uint256 initialPrice;
        uint256 currentPrice;
        uint256 totalBorrow;
        uint128 positionSize;
        uint128 collateralSize;
        uint8 leverage;
        bool isShort;
        address initialToken;
        address priceFeed;
        uint24 poolFee;
        address feeManager;
        address trader;
    }

    struct PnLCalculationResult {
        int128 currentPnL;
        int128 collateralLeft;
    }

    // Input struct for position opening calculations
    struct PositionOpeningCalcParams {
        uint256 price; // Current price from oracle
        uint8 leverage; // Leverage multiplier (2-5)
        uint128 baseCollateralAmount; // Collateral after swaps/fees
        uint8 baseDecimals; // Decimals of base token
        uint256 baseDecimalsPow; // 10^baseDecimals
        bool isShort; // True for short position
        address baseToken; // Base token address
        address quoteToken; // Quote token address
    }

    // Output struct for position opening calculations
    struct PositionOpeningCalcResult {
        uint256 liquidationFloor; // Price at which position becomes undercollateralized (collateral depleted)
        uint256 totalBorrow; // Amount to borrow from liquidity pool
        address borrowToken; // Token to borrow (base for short, quote for long)
        address liquidityPoolToken; // Token for liquidity pool lookup
    }

    /**
     * @notice Calculate the PnL and collateral left for a position
     * @param params PnL calculation parameters
     * @return result Current PnL and collateral left
     * @dev PnL Calculation Logic:
     * - Long: profit when price goes UP (base token appreciates vs quote)
     * - Short: profit when price goes DOWN (base token depreciates vs quote)
     * - PnL = totalBorrow * priceChangePercent / 10000
     */
    function calculatePnL(PnLCalculationParams memory params)
        internal
        view
        returns (PnLCalculationResult memory result)
    {
        int256 finalValue;
        uint256 collat = uint256(params.collateralSize);
        uint256 positionSize = uint256(params.positionSize);
        uint256 swapInputAmount;

        if (params.isShort) {
            // Short: Total Quote Held = positionSize + collateral
            uint256 totalQuoteHeld = positionSize + collat;
            // Debt is taken in Base. Current Quote required to buy back Base = positionSize * (current/initial)
            uint256 debtQuoteCurrent = (positionSize * params.currentPrice) / params.initialPrice;

            finalValue = int256(totalQuoteHeld) - int256(debtQuoteCurrent);
            swapInputAmount = debtQuoteCurrent;
        } else {
            // Long: Total Base Held = positionSize
            uint256 initialBaseSwapped = positionSize > collat ? positionSize - collat : 0;
            // Debt is taken in Quote. Current Base required to buy back Quote = initial ratio * (initial/current)
            uint256 debtBaseCurrent = (initialBaseSwapped * params.initialPrice) / params.currentPrice;

            finalValue = int256(positionSize) - int256(debtBaseCurrent);
            swapInputAmount = debtBaseCurrent;
        }

        if (finalValue > 0 && params.poolFee > 0) {
            int256 swapFee = (int256(swapInputAmount) * int256(uint256(params.poolFee))) / 1_000_000;
            finalValue -= swapFee;
        }

        if (finalValue > 0 && params.feeManager != address(0)) {
            (bool success, bytes memory data) =
                params.feeManager.staticcall(abi.encodeWithSignature("getFees(address)", params.trader));
            if (success) {
                (uint128 treasureFee,) = abi.decode(data, (uint128, uint128));
                int256 treasureDeduction = (finalValue * int256(uint256(treasureFee))) / 10000;
                finalValue -= treasureDeduction;
            }
        }

        result.currentPnL = int128(finalValue - int256(uint256(params.collateralSize)));
        result.collateralLeft = int128(finalValue);
    }

    function _getBaseValidationResult(ValidationParams memory params)
        private
        view
        returns (ValidationResult memory result)
    {
        result.v3Pool = address(
            IUniswapV3Factory(params.liquidityPoolFactoryUniswapV3).getPool(params.token0, params.token1, params.fee)
        );

        // [FIX LOW-5] Guard against address(0): getPool() returns address(0) for
        // non-existent pools. Calling .factory() on address(0) would revert with an
        // opaque low-level error instead of the informative custom error below.
        if (result.v3Pool == address(0)) {
            revert Positions__POOL_NOT_OFFICIAL(result.v3Pool);
        }

        // Cache pool contract to avoid repeated external calls
        IUniswapV3Pool pool = IUniswapV3Pool(result.v3Pool);

        if (pool.factory() != params.liquidityPoolFactoryUniswapV3) {
            revert Positions__POOL_NOT_OFFICIAL(result.v3Pool);
        }

        // Cache token addresses
        address poolToken0 = pool.token0();
        address poolToken1 = pool.token1();

        // check token
        if (poolToken0 != params.token0 && poolToken1 != params.token0) {
            revert Positions__TOKEN_NOT_SUPPORTED(params.token0);
        }

        uint256 token0UsdPrice = PriceFeedL1(params.priceFeed).getTokenLatestPriceInUsd(params.token0);
        bool isToken0Stable = (token0UsdPrice >= 0.9e18 && token0UsdPrice <= 1.1e18);

        if (isToken0Stable) {
            result.quoteToken = params.token0;
            result.baseToken = (params.token0 == poolToken0) ? poolToken1 : poolToken0;
        } else {
            result.baseToken = params.token0;
            result.quoteToken = (params.token0 == poolToken0) ? poolToken1 : poolToken0;
        }
        result.isBaseToken0 = (result.baseToken == poolToken0);

        // check if pair is supported by PriceFeed
        if (!PriceFeedL1(params.priceFeed).isPairSupported(result.baseToken, result.quoteToken)) {
            revert Positions__NO_PRICE_FEED(result.baseToken, result.quoteToken);
        }

        result.price = PriceFeedL1(params.priceFeed).getPairLatestPrice(result.baseToken, result.quoteToken);

        // check leverage
        if (params.leverage <= 1 || params.leverage > params.maxLeverage) {
            revert Positions__LEVERAGE_NOT_IN_RANGE(params.leverage);
        }

        // check amount
        uint256 humanReadableUsd = PriceFeedL1(params.priceFeed).getAmountInUsd(params.token0, params.amount); // Returns value with 18 decimals
        if (humanReadableUsd < params.minPositionAmountInUsd) {
            revert Positions__AMOUNT_TO_SMALL(IERC20Metadata(params.token0).symbol(), humanReadableUsd, params.amount);
        }
    }

    function validateOpenLongPosition(ValidationParams memory params)
        external
        view
        returns (ValidationResult memory result)
    {
        result = _getBaseValidationResult(params);

        if (LiquidityPoolFactory(params.liquidityPoolFactory).getTokenToLiquidityPools(result.quoteToken) == address(0))
        {
            revert Positions__TOKEN_NOT_SUPPORTED_ON_MARGIN(result.quoteToken);
        }

        if (params.limitPrice < result.price && params.limitPrice != 0) {
            revert Positions__LIMIT_ORDER_PRICE_NOT_CONCISTENT(params.limitPrice);
        }
        if (params.stopLossPrice > result.price && params.stopLossPrice != 0) {
            revert Positions__STOP_LOSS_ORDER_PRICE_NOT_CONCISTENT(params.stopLossPrice);
        }
    }

    function validateOpenShortPosition(ValidationParams memory params)
        external
        view
        returns (ValidationResult memory result)
    {
        result = _getBaseValidationResult(params);

        if (LiquidityPoolFactory(params.liquidityPoolFactory).getTokenToLiquidityPools(result.baseToken) == address(0))
        {
            revert Positions__TOKEN_NOT_SUPPORTED_ON_MARGIN(result.baseToken);
        }

        if (params.limitPrice > result.price && params.limitPrice != 0) {
            revert Positions__LIMIT_ORDER_PRICE_NOT_CONCISTENT(params.limitPrice);
        }
        if (params.stopLossPrice < result.price && params.stopLossPrice != 0) {
            revert Positions__STOP_LOSS_ORDER_PRICE_NOT_CONCISTENT(params.stopLossPrice);
        }
    }

    /**
     * @notice Calculate position opening parameters (breakEven, borrow amounts)
     * @param params Calculation input parameters
     * @return result Calculated outputs for position opening
     * @dev Logic:
     * - Short: breakEven = price + price/leverage (price goes UP = loss)
     * - Long: breakEven = price - price/leverage (price goes DOWN = loss)
     * - Short totalBorrow: collateral * leverage * baseDecimalsPow / price
     * - Long totalBorrow: collateral * (leverage-1) * price / baseDecimalsPow
     */
    function calculatePositionOpening(PositionOpeningCalcParams memory params)
        internal
        pure
        returns (PositionOpeningCalcResult memory result)
    {
        // Liquidation floor calculation (price where collateral is fully depleted)
        // For short: liquidation floor = price + price/leverage (price goes UP = loss)
        // For long: liquidation floor = price - price/leverage (price goes DOWN = loss)
        if (params.isShort) {
            result.liquidationFloor = params.price + (params.price * 10000) / (uint256(params.leverage) * 10000);
            result.totalBorrow =
                (uint256(params.baseCollateralAmount) * params.baseDecimalsPow * params.leverage) / params.price;
            result.borrowToken = params.baseToken;
            result.liquidityPoolToken = params.baseToken;
        } else {
            result.liquidationFloor = params.price - (params.price * 10000) / (uint256(params.leverage) * 10000);
            result.totalBorrow =
                (uint256(params.baseCollateralAmount) * (params.leverage - 1) * params.price) / params.baseDecimalsPow;
            result.borrowToken = params.quoteToken;
            result.liquidityPoolToken = params.quoteToken;
        }
    }
}
