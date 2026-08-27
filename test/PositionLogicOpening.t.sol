// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {Test} from "forge-std/Test.sol";
import {PositionLogic} from "../src/libraries/PositionLogic.sol";

/**
 * @title PositionLogicOpeningTest
 * @notice Unit tests for PositionLogic.calculatePositionOpening function
 * @dev Tests calculatePositionOpening function for:
 * - Long positions with 2x, 3x, 4x, 5x leverage
 * - Short positions with 2x, 3x, 4x, 5x leverage
 * - Different token decimals (6 and 18)
 * - Edge cases: max leverage, small amounts, zero collateral
 * - Verify borrowToken and liquidityPoolToken assignments
 */
contract PositionLogicOpeningTest is Test {
    // Test addresses
    address constant BASE_TOKEN = address(0x1111111111111111111111111111111111111111);
    address constant QUOTE_TOKEN = address(0x2222222222222222222222222222222222222222);

    // Price constants (8 decimals typical for Chainlink)
    uint256 constant PRICE_1e8 = 100_000e8; // $100,000

    // Decimal constants
    uint8 constant DECIMALS_6 = 6;
    uint8 constant DECIMALS_18 = 18;
    uint256 constant DECIMALS_POW_6 = 10 ** 6;
    uint256 constant DECIMALS_POW_18 = 10 ** 18;

    // ===================================================================
    // LONG POSITION TESTS
    // ===================================================================

    function test_Long_2x_Calculation() public pure {
        // Setup: Long 2x, price = 100,000, collateral = 100 (in base token decimals)
        uint128 collateral = 100e6; // 100 USDC (6 decimals)
        uint8 leverage = 2;
        uint256 price = PRICE_1e8;

        PositionLogic.PositionOpeningCalcParams memory params = PositionLogic.PositionOpeningCalcParams({
            price: price,
            leverage: leverage,
            baseCollateralAmount: collateral,
            baseDecimals: DECIMALS_6,
            baseDecimalsPow: DECIMALS_POW_6,
            isShort: false,
            baseToken: BASE_TOKEN,
            quoteToken: QUOTE_TOKEN
        });

        PositionLogic.PositionOpeningCalcResult memory result = PositionLogic.calculatePositionOpening(params);

        // Expected liquidationFloor = price - price/leverage = 100,000 - 50,000 = 50,000
        uint256 expectedLiquidationFloor = price - (price * 10000) / (uint256(leverage) * 10000);
        assertEq(result.liquidationFloor, expectedLiquidationFloor, "Liquidation floor calculation incorrect");

        // Expected totalBorrow = collateral * (leverage-1) * price / baseDecimalsPow
        // = 100e6 * 1 * 100,000e8 / 1e6 = 100e6 * 100,000e8 / 1e6
        uint256 expectedBorrow = (uint256(collateral) * (leverage - 1) * price) / DECIMALS_POW_6;
        assertEq(result.totalBorrow, expectedBorrow, "Total borrow calculation incorrect");

        // Long position should borrow quote token
        assertEq(result.borrowToken, QUOTE_TOKEN, "Long should borrow quote token");
        assertEq(result.liquidityPoolToken, QUOTE_TOKEN, "Long should use quote token for liquidity pool");
    }

    function test_Long_3x_Calculation() public pure {
        uint128 collateral = 100e6;
        uint8 leverage = 3;
        uint256 price = PRICE_1e8;

        PositionLogic.PositionOpeningCalcParams memory params = PositionLogic.PositionOpeningCalcParams({
            price: price,
            leverage: leverage,
            baseCollateralAmount: collateral,
            baseDecimals: DECIMALS_6,
            baseDecimalsPow: DECIMALS_POW_6,
            isShort: false,
            baseToken: BASE_TOKEN,
            quoteToken: QUOTE_TOKEN
        });

        PositionLogic.PositionOpeningCalcResult memory result = PositionLogic.calculatePositionOpening(params);

        // Expected liquidationFloor = price - price/3 = 100,000 - 33,333.33 = 66,666.67
        uint256 expectedLiquidationFloor = price - (price * 10000) / (uint256(leverage) * 10000);
        assertEq(result.liquidationFloor, expectedLiquidationFloor, "Liquidation floor calculation incorrect for 3x");

        // Expected totalBorrow = collateral * (3-1) * price / baseDecimalsPow
        uint256 expectedBorrow = (uint256(collateral) * (leverage - 1) * price) / DECIMALS_POW_6;
        assertEq(result.totalBorrow, expectedBorrow, "Total borrow calculation incorrect for 3x");

        assertEq(result.borrowToken, QUOTE_TOKEN, "Long should borrow quote token");
        assertEq(result.liquidityPoolToken, QUOTE_TOKEN, "Long should use quote token for liquidity pool");
    }

    function test_Long_5x_Calculation() public pure {
        uint128 collateral = 100e6;
        uint8 leverage = 5;
        uint256 price = PRICE_1e8;

        PositionLogic.PositionOpeningCalcParams memory params = PositionLogic.PositionOpeningCalcParams({
            price: price,
            leverage: leverage,
            baseCollateralAmount: collateral,
            baseDecimals: DECIMALS_6,
            baseDecimalsPow: DECIMALS_POW_6,
            isShort: false,
            baseToken: BASE_TOKEN,
            quoteToken: QUOTE_TOKEN
        });

        PositionLogic.PositionOpeningCalcResult memory result = PositionLogic.calculatePositionOpening(params);

        // Expected liquidationFloor = price - price/5 = 100,000 - 20,000 = 80,000
        uint256 expectedLiquidationFloor = price - (price * 10000) / (uint256(leverage) * 10000);
        assertEq(result.liquidationFloor, expectedLiquidationFloor, "Liquidation floor calculation incorrect for 5x");

        // Expected totalBorrow = collateral * (5-1) * price / baseDecimalsPow
        uint256 expectedBorrow = (uint256(collateral) * (leverage - 1) * price) / DECIMALS_POW_6;
        assertEq(result.totalBorrow, expectedBorrow, "Total borrow calculation incorrect for 5x");
    }

    function test_Long_2x_18Decimals() public pure {
        uint128 collateral = 1e18; // 1 WETH (18 decimals)
        uint8 leverage = 2;
        uint256 price = PRICE_1e8;

        PositionLogic.PositionOpeningCalcParams memory params = PositionLogic.PositionOpeningCalcParams({
            price: price,
            leverage: leverage,
            baseCollateralAmount: collateral,
            baseDecimals: DECIMALS_18,
            baseDecimalsPow: DECIMALS_POW_18,
            isShort: false,
            baseToken: BASE_TOKEN,
            quoteToken: QUOTE_TOKEN
        });

        PositionLogic.PositionOpeningCalcResult memory result = PositionLogic.calculatePositionOpening(params);

        uint256 expectedLiquidationFloor = price - (price * 10000) / (uint256(leverage) * 10000);
        assertEq(result.liquidationFloor, expectedLiquidationFloor, "Liquidation floor incorrect for 18 decimals");

        uint256 expectedBorrow = (uint256(collateral) * (leverage - 1) * price) / DECIMALS_POW_18;
        assertEq(result.totalBorrow, expectedBorrow, "Borrow incorrect for 18 decimals");
    }

    // ===================================================================
    // SHORT POSITION TESTS
    // ===================================================================

    function test_Short_2x_Calculation() public pure {
        // Setup: Short 2x, price = 100,000, collateral = 100 (in quote token decimals)
        uint128 collateral = 100e6; // 100 USDC
        uint8 leverage = 2;
        uint256 price = PRICE_1e8;

        PositionLogic.PositionOpeningCalcParams memory params = PositionLogic.PositionOpeningCalcParams({
            price: price,
            leverage: leverage,
            baseCollateralAmount: collateral,
            baseDecimals: DECIMALS_6,
            baseDecimalsPow: DECIMALS_POW_6,
            isShort: true,
            baseToken: BASE_TOKEN,
            quoteToken: QUOTE_TOKEN
        });

        PositionLogic.PositionOpeningCalcResult memory result = PositionLogic.calculatePositionOpening(params);

        // Expected liquidationFloor = price + price/leverage = 100,000 + 50,000 = 150,000
        uint256 expectedLiquidationFloor = price + (price * 10000) / (uint256(leverage) * 10000);
        assertEq(
            result.liquidationFloor, expectedLiquidationFloor, "Liquidation floor calculation incorrect for short 2x"
        );

        // Expected totalBorrow = collateral * leverage * baseDecimalsPow / price
        // = 100e6 * 2 * 1e6 / 100,000e8
        uint256 expectedBorrow = (uint256(collateral) * DECIMALS_POW_6 * leverage) / price;
        assertEq(result.totalBorrow, expectedBorrow, "Total borrow calculation incorrect for short 2x");

        // Short position should borrow base token
        assertEq(result.borrowToken, BASE_TOKEN, "Short should borrow base token");
        assertEq(result.liquidityPoolToken, BASE_TOKEN, "Short should use base token for liquidity pool");
    }

    function test_Short_3x_Calculation() public pure {
        uint128 collateral = 100e6;
        uint8 leverage = 3;
        uint256 price = PRICE_1e8;

        PositionLogic.PositionOpeningCalcParams memory params = PositionLogic.PositionOpeningCalcParams({
            price: price,
            leverage: leverage,
            baseCollateralAmount: collateral,
            baseDecimals: DECIMALS_6,
            baseDecimalsPow: DECIMALS_POW_6,
            isShort: true,
            baseToken: BASE_TOKEN,
            quoteToken: QUOTE_TOKEN
        });

        PositionLogic.PositionOpeningCalcResult memory result = PositionLogic.calculatePositionOpening(params);

        // Expected liquidationFloor = price + price/3 = 100,000 + 33,333.33 = 133,333.33
        uint256 expectedLiquidationFloor = price + (price * 10000) / (uint256(leverage) * 10000);
        assertEq(
            result.liquidationFloor, expectedLiquidationFloor, "Liquidation floor calculation incorrect for short 3x"
        );

        // Expected totalBorrow = collateral * leverage * baseDecimalsPow / price
        uint256 expectedBorrow = (uint256(collateral) * DECIMALS_POW_6 * leverage) / price;
        assertEq(result.totalBorrow, expectedBorrow, "Total borrow calculation incorrect for short 3x");

        assertEq(result.borrowToken, BASE_TOKEN, "Short should borrow base token");
        assertEq(result.liquidityPoolToken, BASE_TOKEN, "Short should use base token for liquidity pool");
    }

    function test_Short_5x_Calculation() public pure {
        uint128 collateral = 100e6;
        uint8 leverage = 5;
        uint256 price = PRICE_1e8;

        PositionLogic.PositionOpeningCalcParams memory params = PositionLogic.PositionOpeningCalcParams({
            price: price,
            leverage: leverage,
            baseCollateralAmount: collateral,
            baseDecimals: DECIMALS_6,
            baseDecimalsPow: DECIMALS_POW_6,
            isShort: true,
            baseToken: BASE_TOKEN,
            quoteToken: QUOTE_TOKEN
        });

        PositionLogic.PositionOpeningCalcResult memory result = PositionLogic.calculatePositionOpening(params);

        // Expected liquidationFloor = price + price/5 = 100,000 + 20,000 = 120,000
        uint256 expectedLiquidationFloor = price + (price * 10000) / (uint256(leverage) * 10000);
        assertEq(
            result.liquidationFloor, expectedLiquidationFloor, "Liquidation floor calculation incorrect for short 5x"
        );

        uint256 expectedBorrow = (uint256(collateral) * DECIMALS_POW_6 * leverage) / price;
        assertEq(result.totalBorrow, expectedBorrow, "Total borrow calculation incorrect for short 5x");
    }

    function test_Short_2x_18Decimals() public pure {
        uint128 collateral = 1e18; // 1 WETH
        uint8 leverage = 2;
        uint256 price = PRICE_1e8;

        PositionLogic.PositionOpeningCalcParams memory params = PositionLogic.PositionOpeningCalcParams({
            price: price,
            leverage: leverage,
            baseCollateralAmount: collateral,
            baseDecimals: DECIMALS_18,
            baseDecimalsPow: DECIMALS_POW_18,
            isShort: true,
            baseToken: BASE_TOKEN,
            quoteToken: QUOTE_TOKEN
        });

        PositionLogic.PositionOpeningCalcResult memory result = PositionLogic.calculatePositionOpening(params);

        uint256 expectedLiquidationFloor = price + (price * 10000) / (uint256(leverage) * 10000);
        assertEq(result.liquidationFloor, expectedLiquidationFloor, "Liquidation floor incorrect for short 18 decimals");

        uint256 expectedBorrow = (uint256(collateral) * DECIMALS_POW_18 * leverage) / price;
        assertEq(result.totalBorrow, expectedBorrow, "Borrow incorrect for short 18 decimals");
    }

    // ===================================================================
    // EDGE CASE TESTS
    // ===================================================================

    function test_Long_SmallCollateral() public pure {
        // Very small collateral amount
        uint128 collateral = 1e6; // 1 USDC
        uint8 leverage = 2;
        uint256 price = PRICE_1e8;

        PositionLogic.PositionOpeningCalcParams memory params = PositionLogic.PositionOpeningCalcParams({
            price: price,
            leverage: leverage,
            baseCollateralAmount: collateral,
            baseDecimals: DECIMALS_6,
            baseDecimalsPow: DECIMALS_POW_6,
            isShort: false,
            baseToken: BASE_TOKEN,
            quoteToken: QUOTE_TOKEN
        });

        PositionLogic.PositionOpeningCalcResult memory result = PositionLogic.calculatePositionOpening(params);

        // Liquidation floor should still be calculated correctly
        uint256 expectedLiquidationFloor = price - (price * 10000) / (uint256(leverage) * 10000);
        assertEq(result.liquidationFloor, expectedLiquidationFloor, "Liquidation floor incorrect for small collateral");

        // Borrow should scale proportionally
        uint256 expectedBorrow = (uint256(collateral) * (leverage - 1) * price) / DECIMALS_POW_6;
        assertEq(result.totalBorrow, expectedBorrow, "Borrow incorrect for small collateral");
    }

    function test_Long_LargeCollateral() public pure {
        // Large collateral amount
        uint128 collateral = 1_000_000e6; // 1M USDC
        uint8 leverage = 2;
        uint256 price = PRICE_1e8;

        PositionLogic.PositionOpeningCalcParams memory params = PositionLogic.PositionOpeningCalcParams({
            price: price,
            leverage: leverage,
            baseCollateralAmount: collateral,
            baseDecimals: DECIMALS_6,
            baseDecimalsPow: DECIMALS_POW_6,
            isShort: false,
            baseToken: BASE_TOKEN,
            quoteToken: QUOTE_TOKEN
        });

        PositionLogic.PositionOpeningCalcResult memory result = PositionLogic.calculatePositionOpening(params);

        uint256 expectedBorrow = (uint256(collateral) * (leverage - 1) * price) / DECIMALS_POW_6;
        assertEq(result.totalBorrow, expectedBorrow, "Borrow incorrect for large collateral");
    }

    function test_DifferentPriceLevels() public pure {
        // Test with different price levels
        uint256[] memory prices = new uint256[](4);
        prices[0] = 1e8; // $1
        prices[1] = 1000e8; // $1,000
        prices[2] = 50000e8; // $50,000
        prices[3] = 100000e8; // $100,000

        for (uint256 i = 0; i < prices.length; i++) {
            uint256 price = prices[i];

            // Long test
            PositionLogic.PositionOpeningCalcParams memory longParams = PositionLogic.PositionOpeningCalcParams({
                price: price,
                leverage: 2,
                baseCollateralAmount: 100e6,
                baseDecimals: DECIMALS_6,
                baseDecimalsPow: DECIMALS_POW_6,
                isShort: false,
                baseToken: BASE_TOKEN,
                quoteToken: QUOTE_TOKEN
            });

            PositionLogic.PositionOpeningCalcResult memory longResult =
                PositionLogic.calculatePositionOpening(longParams);

            uint256 expectedLongBreakEven = price - (price * 10000) / 20000;
            assertEq(
                longResult.liquidationFloor, expectedLongBreakEven, "Long break-even incorrect for different price"
            );

            // Short test
            PositionLogic.PositionOpeningCalcParams memory shortParams = PositionLogic.PositionOpeningCalcParams({
                price: price,
                leverage: 2,
                baseCollateralAmount: 100e6,
                baseDecimals: DECIMALS_6,
                baseDecimalsPow: DECIMALS_POW_6,
                isShort: true,
                baseToken: BASE_TOKEN,
                quoteToken: QUOTE_TOKEN
            });

            PositionLogic.PositionOpeningCalcResult memory shortResult =
                PositionLogic.calculatePositionOpening(shortParams);

            uint256 expectedShortBreakEven = price + (price * 10000) / 20000;
            assertEq(
                shortResult.liquidationFloor, expectedShortBreakEven, "Short break-even incorrect for different price"
            );
        }
    }

    function test_BorrowTokenAssignment() public pure {
        // Test that borrowToken and liquidityPoolToken are assigned correctly

        // Long: should borrow quote token
        PositionLogic.PositionOpeningCalcParams memory longParams = PositionLogic.PositionOpeningCalcParams({
            price: PRICE_1e8,
            leverage: 2,
            baseCollateralAmount: 100e6,
            baseDecimals: DECIMALS_6,
            baseDecimalsPow: DECIMALS_POW_6,
            isShort: false,
            baseToken: BASE_TOKEN,
            quoteToken: QUOTE_TOKEN
        });

        PositionLogic.PositionOpeningCalcResult memory longResult = PositionLogic.calculatePositionOpening(longParams);

        assertEq(longResult.borrowToken, QUOTE_TOKEN, "Long borrowToken should be quoteToken");
        assertEq(longResult.liquidityPoolToken, QUOTE_TOKEN, "Long liquidityPoolToken should be quoteToken");

        // Short: should borrow base token
        PositionLogic.PositionOpeningCalcParams memory shortParams = PositionLogic.PositionOpeningCalcParams({
            price: PRICE_1e8,
            leverage: 2,
            baseCollateralAmount: 100e6,
            baseDecimals: DECIMALS_6,
            baseDecimalsPow: DECIMALS_POW_6,
            isShort: true,
            baseToken: BASE_TOKEN,
            quoteToken: QUOTE_TOKEN
        });

        PositionLogic.PositionOpeningCalcResult memory shortResult = PositionLogic.calculatePositionOpening(shortParams);

        assertEq(shortResult.borrowToken, BASE_TOKEN, "Short borrowToken should be baseToken");
        assertEq(shortResult.liquidityPoolToken, BASE_TOKEN, "Short liquidityPoolToken should be baseToken");
    }

    function test_AllLeverageLevels() public pure {
        // Test all valid leverage levels (2-5)
        for (uint8 leverage = 2; leverage <= 5; leverage++) {
            // Long
            PositionLogic.PositionOpeningCalcParams memory longParams = PositionLogic.PositionOpeningCalcParams({
                price: PRICE_1e8,
                leverage: leverage,
                baseCollateralAmount: 100e6,
                baseDecimals: DECIMALS_6,
                baseDecimalsPow: DECIMALS_POW_6,
                isShort: false,
                baseToken: BASE_TOKEN,
                quoteToken: QUOTE_TOKEN
            });

            PositionLogic.PositionOpeningCalcResult memory longResult =
                PositionLogic.calculatePositionOpening(longParams);

            uint256 expectedLongBreakEven = PRICE_1e8 - (PRICE_1e8 * 10000) / (uint256(leverage) * 10000);
            assertEq(longResult.liquidationFloor, expectedLongBreakEven, "Long break-even incorrect");

            // Short
            PositionLogic.PositionOpeningCalcParams memory shortParams = PositionLogic.PositionOpeningCalcParams({
                price: PRICE_1e8,
                leverage: leverage,
                baseCollateralAmount: 100e6,
                baseDecimals: DECIMALS_6,
                baseDecimalsPow: DECIMALS_POW_6,
                isShort: true,
                baseToken: BASE_TOKEN,
                quoteToken: QUOTE_TOKEN
            });

            PositionLogic.PositionOpeningCalcResult memory shortResult =
                PositionLogic.calculatePositionOpening(shortParams);

            uint256 expectedShortBreakEven = PRICE_1e8 + (PRICE_1e8 * 10000) / (uint256(leverage) * 10000);
            assertEq(shortResult.liquidationFloor, expectedShortBreakEven, "Short break-even incorrect");
        }
    }

    // ===================================================================
    // MATHEMATICAL CORRECTNESS TESTS
    // ===================================================================

    function test_Long_LiquidationFloor_Math() public pure {
        // For a long position with leverage L:
        // Liquidation floor price = initial_price - initial_price/L
        // If price drops by 100/L %, the position reaches liquidation floor

        uint256 price = 100_000e8;
        uint128 collateral = 100e6;

        // Test 2x leverage
        PositionLogic.PositionOpeningCalcParams memory params2x = PositionLogic.PositionOpeningCalcParams({
            price: price,
            leverage: 2,
            baseCollateralAmount: collateral,
            baseDecimals: DECIMALS_6,
            baseDecimalsPow: DECIMALS_POW_6,
            isShort: false,
            baseToken: BASE_TOKEN,
            quoteToken: QUOTE_TOKEN
        });

        PositionLogic.PositionOpeningCalcResult memory result2x = PositionLogic.calculatePositionOpening(params2x);

        // 2x leverage: 50% price drop = liquidation floor
        // Liquidation floor = 100,000 - 50,000 = 50,000
        assertEq(result2x.liquidationFloor, 50_000e8, "2x long liquidation floor should be 50% of price");

        // Test 4x leverage
        PositionLogic.PositionOpeningCalcParams memory params4x = PositionLogic.PositionOpeningCalcParams({
            price: price,
            leverage: 4,
            baseCollateralAmount: collateral,
            baseDecimals: DECIMALS_6,
            baseDecimalsPow: DECIMALS_POW_6,
            isShort: false,
            baseToken: BASE_TOKEN,
            quoteToken: QUOTE_TOKEN
        });

        PositionLogic.PositionOpeningCalcResult memory result4x = PositionLogic.calculatePositionOpening(params4x);

        // 4x leverage: 25% price drop = liquidation floor
        // Liquidation floor = 100,000 - 25,000 = 75,000
        assertEq(result4x.liquidationFloor, 75_000e8, "4x long liquidation floor should be 75% of price");
    }

    function test_Short_LiquidationFloor_Math() public pure {
        // For a short position with leverage L:
        // Liquidation floor price = initial_price + initial_price/L
        // If price increases by 100/L %, the position reaches liquidation floor

        uint256 price = 100_000e8;
        uint128 collateral = 100e6;

        // Test 2x leverage
        PositionLogic.PositionOpeningCalcParams memory params2x = PositionLogic.PositionOpeningCalcParams({
            price: price,
            leverage: 2,
            baseCollateralAmount: collateral,
            baseDecimals: DECIMALS_6,
            baseDecimalsPow: DECIMALS_POW_6,
            isShort: true,
            baseToken: BASE_TOKEN,
            quoteToken: QUOTE_TOKEN
        });

        PositionLogic.PositionOpeningCalcResult memory result2x = PositionLogic.calculatePositionOpening(params2x);

        // 2x leverage: 50% price increase = liquidation floor
        // Liquidation floor = 100,000 + 50,000 = 150,000
        assertEq(result2x.liquidationFloor, 150_000e8, "2x short liquidation floor should be 150% of price");

        // Test 4x leverage
        PositionLogic.PositionOpeningCalcParams memory params4x = PositionLogic.PositionOpeningCalcParams({
            price: price,
            leverage: 4,
            baseCollateralAmount: collateral,
            baseDecimals: DECIMALS_6,
            baseDecimalsPow: DECIMALS_POW_6,
            isShort: true,
            baseToken: BASE_TOKEN,
            quoteToken: QUOTE_TOKEN
        });

        PositionLogic.PositionOpeningCalcResult memory result4x = PositionLogic.calculatePositionOpening(params4x);

        // 4x leverage: 25% price increase = liquidation floor
        // Liquidation floor = 100,000 + 25,000 = 125,000
        assertEq(result4x.liquidationFloor, 125_000e8, "4x short liquidation floor should be 125% of price");
    }

    function test_Long_BorrowAmount_Math() public pure {
        // For a long position:
        // totalBorrow = collateral * (leverage - 1) * price / baseDecimalsPow
        // This gives us the quote token amount to borrow

        uint256 price = 100_000e8; // BTC/USDC price
        uint128 collateral = 1e18; // 1 WETH as collateral
        uint8 leverage = 2;

        PositionLogic.PositionOpeningCalcParams memory params = PositionLogic.PositionOpeningCalcParams({
            price: price,
            leverage: leverage,
            baseCollateralAmount: collateral,
            baseDecimals: DECIMALS_18,
            baseDecimalsPow: DECIMALS_POW_18,
            isShort: false,
            baseToken: BASE_TOKEN,
            quoteToken: QUOTE_TOKEN
        });

        PositionLogic.PositionOpeningCalcResult memory result = PositionLogic.calculatePositionOpening(params);

        // Expected: 1e18 * 1 * 100_000e8 / 1e18 = 100_000e8
        uint256 expectedBorrow = (uint256(collateral) * (leverage - 1) * price) / DECIMALS_POW_18;
        assertEq(result.totalBorrow, expectedBorrow, "Long borrow calculation incorrect");
    }

    function test_Short_BorrowAmount_Math() public pure {
        // For a short position:
        // totalBorrow = collateral * leverage * baseDecimalsPow / price
        // This gives us the base token amount to borrow

        uint256 price = 100_000e8; // BTC/USDC price
        uint128 collateral = 100_000e6; // 100,000 USDC as collateral
        uint8 leverage = 2;

        PositionLogic.PositionOpeningCalcParams memory params = PositionLogic.PositionOpeningCalcParams({
            price: price,
            leverage: leverage,
            baseCollateralAmount: collateral,
            baseDecimals: DECIMALS_6,
            baseDecimalsPow: DECIMALS_POW_6,
            isShort: true,
            baseToken: BASE_TOKEN,
            quoteToken: QUOTE_TOKEN
        });

        PositionLogic.PositionOpeningCalcResult memory result = PositionLogic.calculatePositionOpening(params);

        // Expected: 100_000e6 * 2 * 1e6 / 100_000e8 = 2e6 (2 base tokens with 6 decimals)
        uint256 expectedBorrow = (uint256(collateral) * DECIMALS_POW_6 * leverage) / price;
        assertEq(result.totalBorrow, expectedBorrow, "Short borrow calculation incorrect");
    }
}
