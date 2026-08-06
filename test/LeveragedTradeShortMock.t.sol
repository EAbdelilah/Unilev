// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./utils/TestSetupMock.sol";

/**
 * @title LeveragedTradeShortMock
 * @notice Test suite for short leveraged positions with 2x and 3x leverage
 * @dev PnL Calculation Logic for Short Positions:
 * - Collateral: 100 USDC or 1 WETH
 * - 2x leverage: Position size = 2x collateral
 * - 3x leverage: Position size = 3x collateral
 * - For short: profit = price DOWN, loss = price UP
 * 
 * Price adjustment for each "Position Tokens" pair is defined in each test.
 * Tests verify exact expected PnL and final balance as per requirements table.
 */
contract LeveragedTradeShortMock is TestSetupMock {

    // ===================================================================
    // COLLATERAL AND LEVERAGE CONFIGURATION
    // ===================================================================
    uint128 constant COLLATERAL_AMOUNT_USDC = 100e6;  // 100 USDC
    uint128 constant COLLATERAL_AMOUNT_WETH = 1e18;   // 1 WETH
    uint24 constant FEE_TIER = 3000;                  // 0.3% Uniswap fee tier


    // ===================================================================
    // MINIMUM DELTA/TOLERANCE FOR VALUE VERIFICATION
    // Using minimum tolerance to ensure precise verification
    // These values account for swap fees, protocol fees, and slippage
    // ===================================================================
    uint256 constant DELTA_USDC = 4e6;   // 3 USDC minimum delta (covers fees)
    uint256 constant DELTA_WETH = 0.4e18; // 0.2 WETH minimum delta (covers fees for cross-pair)

    function getPositionPnL(uint256 positionId) internal view returns (int256) {
        (, , , , , , , , , int128 currentPnL, ) = positions.getPositionParams(positionId);
        return int256(currentPnL);
    }

    /**
     * @notice Calculate new price with basis point change
     * @param basePrice8Dec Base price with 8 decimals (Chainlink format)
     * @param bps Basis points to change (1 bp = 0.01%)
     * @param increase True for price increase, false for decrease
     * @return New price as int256 for MockV3Aggregator
     */
    function getPriceWithBpsChange(uint256 basePrice8Dec, uint256 bps, bool increase) internal pure returns (int256) {
        uint256 change = (basePrice8Dec * bps) / 10000;
        if (increase) {
            return int256(basePrice8Dec + change);
        } else {
            return int256(basePrice8Dec - change);
        }
    }

    // ===================================================================
    // USDC COLLATERAL - 2x LEVERAGE - PROFIT TESTS
    // Position Tokens: USDC/WBTC
    // For shorts: profit = price DOWN
    // ===================================================================

    function test_Short_Profit_of_1_USDC() public {
        address usdc = getUsdcAddress();
        address wbtc = getWbtcAddress();

        depositLiquidity(usdc, 100_000e6);
        depositLiquidity(wbtc, 10e8);
        writeTokenBalance(alice, usdc, COLLATERAL_AMOUNT_USDC);
        uint256 initialBalance = IERC20(getUsdcAddress()).balanceOf(alice);

        vm.startPrank(deployer);
        mockV3AggregatorUsdcUsd.updateAnswer(1 * 1e8);
        mockV3AggregatorWbtcUsd.updateAnswer(100_000 * 1e8);
        vm.stopPrank();

        vm.startPrank(alice);
        IERC20(usdc).approve(address(positions), COLLATERAL_AMOUNT_USDC);
        market.openShortPosition(usdc, wbtc, FEE_TIER, 2, COLLATERAL_AMOUNT_USDC, 0, 0);
        vm.stopPrank();

        uint256 positionId = positions.getTraderPositions(alice)[0];

        // For short profit: price goes DOWN
        int256 newPrice = 9919934942958; // ~0.56% decrease
        vm.startPrank(deployer);
        mockV3AggregatorWbtcUsd.updateAnswer(newPrice);
        vm.stopPrank();

        vm.startPrank(alice);
        market.closePosition(positionId);
        vm.stopPrank();

        uint256 finalBalance = IERC20(getUsdcAddress()).balanceOf(alice);
        assertApproxEqAbs(finalBalance, initialBalance + TARGET_PNL_1_USDC, DELTA_USDC, "Final balance should be 101 USDC");
    }

    function test_Short_Profit_of_10_USDC() public {
        address usdc = getUsdcAddress();
        address wbtc = getWbtcAddress();

        depositLiquidity(usdc, 100_000e6);
        depositLiquidity(wbtc, 10e8);
        writeTokenBalance(alice, usdc, COLLATERAL_AMOUNT_USDC);
        uint256 initialBalance = IERC20(getUsdcAddress()).balanceOf(alice);

        vm.startPrank(deployer);
        mockV3AggregatorUsdcUsd.updateAnswer(1 * 1e8);
        mockV3AggregatorWbtcUsd.updateAnswer(100_000 * 1e8);
        vm.stopPrank();

        vm.startPrank(alice);
        IERC20(usdc).approve(address(positions), COLLATERAL_AMOUNT_USDC);
        market.openShortPosition(usdc, wbtc, FEE_TIER, 2, COLLATERAL_AMOUNT_USDC, 0, 0);
        vm.stopPrank();

        uint256 positionId = positions.getTraderPositions(alice)[0];

        // For short profit: price goes DOWN
        int256 newPrice = 9469349429579; // ~4.4% decrease
        vm.startPrank(deployer);
        mockV3AggregatorWbtcUsd.updateAnswer(newPrice);
        vm.stopPrank();

        vm.startPrank(alice);
        market.closePosition(positionId);
        vm.stopPrank();

        assertApproxEqAbs(IERC20(getUsdcAddress()).balanceOf(alice), initialBalance + TARGET_PNL_10_USDC, DELTA_USDC, "Final balance should be 110 USDC");
    }

    function test_Short_Profit_of_50_USDC() public {
        address usdc = getUsdcAddress();
        address wbtc = getWbtcAddress();

        depositLiquidity(usdc, 100_000e6);
        depositLiquidity(wbtc, 10e8);
        writeTokenBalance(alice, usdc, COLLATERAL_AMOUNT_USDC);
        uint256 initialBalance = IERC20(getUsdcAddress()).balanceOf(alice);

        vm.startPrank(deployer);
        mockV3AggregatorUsdcUsd.updateAnswer(1 * 1e8);
        mockV3AggregatorWbtcUsd.updateAnswer(100_000 * 1e8);
        vm.stopPrank();

        vm.startPrank(alice);
        IERC20(usdc).approve(address(positions), COLLATERAL_AMOUNT_USDC);
        market.openShortPosition(usdc, wbtc, FEE_TIER, 2, COLLATERAL_AMOUNT_USDC, 0, 0);
        vm.stopPrank();

        uint256 positionId = positions.getTraderPositions(alice)[0];

        // For short profit: price goes DOWN
        // Calculation: PnL = Position Size × Price Change%
        // For 2x leverage with 100 USDC collateral, position size = 200 USDC
        // For +50 USDC profit: 50 = 200 × Price Change% → Price Change% = 25%
        // Subtract ~0.07% for fees: 24.93%
        int256 newPrice = 7466747147894; // ~24.93% decrease
        vm.startPrank(deployer);
        mockV3AggregatorWbtcUsd.updateAnswer(newPrice);
        vm.stopPrank();

        vm.startPrank(alice);
        market.closePosition(positionId);
        vm.stopPrank();

        assertApproxEqAbs(IERC20(getUsdcAddress()).balanceOf(alice), initialBalance + TARGET_PNL_50_USDC, DELTA_USDC, "Final balance should be 150 USDC");
    }

    // ===================================================================
    // USDC COLLATERAL - 2x LEVERAGE - LOSS TESTS
    // For shorts: loss = price UP
    // ===================================================================

    function test_Short_Loss_of_minus_1_USDC() public {
        address usdc = getUsdcAddress();
        address wbtc = getWbtcAddress();

        depositLiquidity(usdc, 100_000e6);
        depositLiquidity(wbtc, 10e8);
        writeTokenBalance(alice, usdc, COLLATERAL_AMOUNT_USDC);
        uint256 initialBalance = IERC20(getUsdcAddress()).balanceOf(alice);

        vm.startPrank(deployer);
        mockV3AggregatorUsdcUsd.updateAnswer(1 * 1e8);
        mockV3AggregatorWbtcUsd.updateAnswer(100_000 * 1e8);
        vm.stopPrank();

        vm.startPrank(alice);
        IERC20(usdc).approve(address(positions), COLLATERAL_AMOUNT_USDC);
        market.openShortPosition(usdc, wbtc, FEE_TIER, 2, COLLATERAL_AMOUNT_USDC, 0, 0);
        vm.stopPrank();

        uint256 positionId = positions.getTraderPositions(alice)[0];

        // For short loss: price goes UP
        int256 newPrice = 10020040024514; // ~0.56% increase
        vm.startPrank(deployer);
        mockV3AggregatorWbtcUsd.updateAnswer(newPrice);
        vm.stopPrank();

        vm.startPrank(alice);
        market.closePosition(positionId);
        vm.stopPrank();

        uint256 expectedBalance = initialBalance - 1e6;
        assertApproxEqAbs(IERC20(getUsdcAddress()).balanceOf(alice), expectedBalance, DELTA_USDC, "Final balance should be 99 USDC");
    }

    function test_Short_Loss_of_minus_10_USDC() public {
        address usdc = getUsdcAddress();
        address wbtc = getWbtcAddress();

        depositLiquidity(usdc, 100_000e6);
        depositLiquidity(wbtc, 10e8);
        writeTokenBalance(alice, usdc, COLLATERAL_AMOUNT_USDC);
        uint256 initialBalance = IERC20(getUsdcAddress()).balanceOf(alice);

        vm.startPrank(deployer);
        mockV3AggregatorUsdcUsd.updateAnswer(1 * 1e8);
        mockV3AggregatorWbtcUsd.updateAnswer(100_000 * 1e8);
        vm.stopPrank();

        vm.startPrank(alice);
        IERC20(usdc).approve(address(positions), COLLATERAL_AMOUNT_USDC);
        market.openShortPosition(usdc, wbtc, FEE_TIER, 2, COLLATERAL_AMOUNT_USDC, 0, 0);
        vm.stopPrank();

        uint256 positionId = positions.getTraderPositions(alice)[0];

        // For short loss: price goes UP
        int256 newPrice = 10470400245136; // ~4.4% increase
        vm.startPrank(deployer);
        mockV3AggregatorWbtcUsd.updateAnswer(newPrice);
        vm.stopPrank();

        vm.startPrank(alice);
        market.closePosition(positionId);
        vm.stopPrank();

        assertApproxEqAbs(IERC20(getUsdcAddress()).balanceOf(alice), initialBalance - TARGET_PNL_10_USDC, DELTA_USDC, "Final balance should be 90 USDC");
    }

    function test_Short_Loss_of_minus_50_USDC() public {
        address usdc = getUsdcAddress();
        address wbtc = getWbtcAddress();

        depositLiquidity(usdc, 100_000e6);
        depositLiquidity(wbtc, 10e8);
        writeTokenBalance(alice, usdc, COLLATERAL_AMOUNT_USDC);
        uint256 initialBalance = IERC20(getUsdcAddress()).balanceOf(alice);

        vm.startPrank(deployer);
        mockV3AggregatorUsdcUsd.updateAnswer(1 * 1e8);
        mockV3AggregatorWbtcUsd.updateAnswer(100_000 * 1e8);
        vm.stopPrank();

        vm.startPrank(alice);
        IERC20(usdc).approve(address(positions), COLLATERAL_AMOUNT_USDC);
        market.openShortPosition(usdc, wbtc, FEE_TIER, 2, COLLATERAL_AMOUNT_USDC, 0, 0);
        vm.stopPrank();

        uint256 positionId = positions.getTraderPositions(alice)[0];

        // For short loss: price goes UP
        // Calculation: PnL = Position Size × Price Change%
        // For 2x leverage with 100 USDC collateral, position size = 200 USDC
        // For -50 USDC loss: -50 = 200 × Price Change% → Price Change% = 25%
        // Add ~0.08% for fees: 25.08%
        int256 newPrice = 12472001225680; // ~25.08% increase
        vm.startPrank(deployer);
        mockV3AggregatorWbtcUsd.updateAnswer(newPrice);
        vm.stopPrank();

        vm.startPrank(alice);
        market.closePosition(positionId);
        vm.stopPrank();

        assertApproxEqAbs(IERC20(getUsdcAddress()).balanceOf(alice), initialBalance - TARGET_PNL_50_USDC, DELTA_USDC, "Final balance should be 50 USDC");
    }

    // ===================================================================
    // USDC COLLATERAL - 3x LEVERAGE - PROFIT TESTS
    // ===================================================================

    function test_Short_Profit_of_1_USDC_3x() public {
        address usdc = getUsdcAddress();
        address wbtc = getWbtcAddress();

        depositLiquidity(usdc, 100_000e6);
        depositLiquidity(wbtc, 10e8);
        writeTokenBalance(alice, usdc, COLLATERAL_AMOUNT_USDC);
        uint256 initialBalance = IERC20(getUsdcAddress()).balanceOf(alice);

        vm.startPrank(deployer);
        mockV3AggregatorUsdcUsd.updateAnswer(1 * 1e8);
        mockV3AggregatorWbtcUsd.updateAnswer(100_000 * 1e8);
        vm.stopPrank();

        vm.startPrank(alice);
        IERC20(usdc).approve(address(positions), COLLATERAL_AMOUNT_USDC);
        market.openShortPosition(usdc, wbtc, FEE_TIER, 3, COLLATERAL_AMOUNT_USDC, 0, 0);
        vm.stopPrank();

        uint256 positionId = positions.getTraderPositions(alice)[0];

        // For short profit: price goes DOWN
        int256 newPrice = 9936623295305; // ~0.38% decrease
        vm.startPrank(deployer);
        mockV3AggregatorWbtcUsd.updateAnswer(newPrice);
        vm.stopPrank();

        vm.startPrank(alice);
        market.closePosition(positionId);
        vm.stopPrank();

        assertApproxEqAbs(IERC20(getUsdcAddress()).balanceOf(alice), initialBalance + TARGET_PNL_1_USDC, DELTA_USDC, "Final balance should be 101 USDC");
    }

    function test_Short_Profit_of_10_USDC_3x() public {
        address usdc = getUsdcAddress();
        address wbtc = getWbtcAddress();

        depositLiquidity(usdc, 100_000e6);
        depositLiquidity(wbtc, 10e8);
        writeTokenBalance(alice, usdc, COLLATERAL_AMOUNT_USDC);
        uint256 initialBalance = IERC20(getUsdcAddress()).balanceOf(alice);

        vm.startPrank(deployer);
        mockV3AggregatorUsdcUsd.updateAnswer(1 * 1e8);
        mockV3AggregatorWbtcUsd.updateAnswer(100_000 * 1e8);
        vm.stopPrank();

        vm.startPrank(alice);
        IERC20(usdc).approve(address(positions), COLLATERAL_AMOUNT_USDC);
        market.openShortPosition(usdc, wbtc, FEE_TIER, 3, COLLATERAL_AMOUNT_USDC, 0, 0);
        vm.stopPrank();

        uint256 positionId = positions.getTraderPositions(alice)[0];

        // For short profit: price goes DOWN
        // Calculation: PnL = Position Size × Price Change%
        // For 3x leverage with 100 USDC collateral, position size = 300 USDC
        // For +10 USDC profit: 10 = 300 × Price Change% → Price Change% = 3.33%
        // Subtract ~0.03% for fees: 3.30%
        int256 newPrice = 9636232953052; // ~3.30% decrease
        vm.startPrank(deployer);
        mockV3AggregatorWbtcUsd.updateAnswer(newPrice);
        vm.stopPrank();

        vm.startPrank(alice);
        market.closePosition(positionId);
        vm.stopPrank();

        assertApproxEqAbs(IERC20(getUsdcAddress()).balanceOf(alice), initialBalance + TARGET_PNL_10_USDC, DELTA_USDC, "Final balance should be 110 USDC");
    }

    function test_Short_Profit_of_50_USDC_3x() public {
        address usdc = getUsdcAddress();
        address wbtc = getWbtcAddress();

        depositLiquidity(usdc, 100_000e6);
        depositLiquidity(wbtc, 10e8);
        writeTokenBalance(alice, usdc, COLLATERAL_AMOUNT_USDC);
        uint256 initialBalance = IERC20(getUsdcAddress()).balanceOf(alice);

        vm.startPrank(deployer);
        mockV3AggregatorUsdcUsd.updateAnswer(1 * 1e8);
        mockV3AggregatorWbtcUsd.updateAnswer(100_000 * 1e8);
        vm.stopPrank();

        vm.startPrank(alice);
        IERC20(usdc).approve(address(positions), COLLATERAL_AMOUNT_USDC);
        market.openShortPosition(usdc, wbtc, FEE_TIER, 3, COLLATERAL_AMOUNT_USDC, 0, 0);
        vm.stopPrank();

        uint256 positionId = positions.getTraderPositions(alice)[0];

        // For short profit: price goes DOWN
        // Calculation: PnL = Position Size × Price Change%
        // For 3x leverage with 100 USDC collateral, position size = 300 USDC
        // For +50 USDC profit: 50 = 300 × Price Change% → Price Change% = 16.67%
        // Subtract ~0.30% for fees: 16.37%
        int256 newPrice = 8301164765262; // ~16.37% decrease
        vm.startPrank(deployer);
        mockV3AggregatorWbtcUsd.updateAnswer(newPrice);
        vm.stopPrank();

        vm.startPrank(alice);
        market.closePosition(positionId);
        vm.stopPrank();

        assertApproxEqAbs(IERC20(getUsdcAddress()).balanceOf(alice), initialBalance + TARGET_PNL_50_USDC, DELTA_USDC, "Final balance should be 150 USDC");
    }

    // ===================================================================
    // USDC COLLATERAL - 3x LEVERAGE - LOSS TESTS
    // ===================================================================

    function test_Short_Loss_of_minus_1_USDC_3x() public {
        address usdc = getUsdcAddress();
        address wbtc = getWbtcAddress();

        depositLiquidity(usdc, 100_000e6);
        depositLiquidity(wbtc, 10e8);
        writeTokenBalance(alice, usdc, COLLATERAL_AMOUNT_USDC);
        uint256 initialBalance = IERC20(getUsdcAddress()).balanceOf(alice);

        vm.startPrank(deployer);
        mockV3AggregatorUsdcUsd.updateAnswer(1 * 1e8);
        mockV3AggregatorWbtcUsd.updateAnswer(100_000 * 1e8);
        vm.stopPrank();

        vm.startPrank(alice);
        IERC20(usdc).approve(address(positions), COLLATERAL_AMOUNT_USDC);
        market.openShortPosition(usdc, wbtc, FEE_TIER, 3, COLLATERAL_AMOUNT_USDC, 0, 0);
        vm.stopPrank();

        uint256 positionId = positions.getTraderPositions(alice)[0];

        // For short loss: price goes UP
        int256 newPrice = 10003360016342; // ~0.38% increase
        vm.startPrank(deployer);
        mockV3AggregatorWbtcUsd.updateAnswer(newPrice);
        vm.stopPrank();

        vm.startPrank(alice);
        market.closePosition(positionId);
        vm.stopPrank();

        assertApproxEqAbs(IERC20(getUsdcAddress()).balanceOf(alice), initialBalance - TARGET_PNL_1_USDC, DELTA_USDC, "Final balance should be 99 USDC");
    }

    function test_Short_Loss_of_minus_10_USDC_3x() public {
        address usdc = getUsdcAddress();
        address wbtc = getWbtcAddress();

        depositLiquidity(usdc, 100_000e6);
        depositLiquidity(wbtc, 10e8);
        writeTokenBalance(alice, usdc, COLLATERAL_AMOUNT_USDC);
        uint256 initialBalance = IERC20(getUsdcAddress()).balanceOf(alice);

        vm.startPrank(deployer);
        mockV3AggregatorUsdcUsd.updateAnswer(1 * 1e8);
        mockV3AggregatorWbtcUsd.updateAnswer(100_000 * 1e8);
        vm.stopPrank();

        vm.startPrank(alice);
        IERC20(usdc).approve(address(positions), COLLATERAL_AMOUNT_USDC);
        market.openShortPosition(usdc, wbtc, FEE_TIER, 3, COLLATERAL_AMOUNT_USDC, 0, 0);
        vm.stopPrank();

        uint256 positionId = positions.getTraderPositions(alice)[0];

        // For short loss: price goes UP
        // Calculation: PnL = Position Size × Price Change%
        // For 3x leverage with 100 USDC collateral, position size = 300 USDC
        // For -10 USDC loss: -10 = 300 × Price Change% → Price Change% = 3.33%
        // Add ~0.03% for fees: 3.36%
        int256 newPrice = 10303600163424; // ~3.36% increase
        vm.startPrank(deployer);
        mockV3AggregatorWbtcUsd.updateAnswer(newPrice);
        vm.stopPrank();

        vm.startPrank(alice);
        market.closePosition(positionId);
        vm.stopPrank();

        assertApproxEqAbs(IERC20(getUsdcAddress()).balanceOf(alice), initialBalance - TARGET_PNL_10_USDC, DELTA_USDC, "Final balance should be 90 USDC");
    }

    function test_Short_Loss_of_minus_50_USDC_3x() public {
        address usdc = getUsdcAddress();
        address wbtc = getWbtcAddress();

        depositLiquidity(usdc, 100_000e6);
        depositLiquidity(wbtc, 10e8);
        writeTokenBalance(alice, usdc, COLLATERAL_AMOUNT_USDC);
        uint256 initialBalance = IERC20(getUsdcAddress()).balanceOf(alice);

        vm.startPrank(deployer);
        mockV3AggregatorUsdcUsd.updateAnswer(1 * 1e8);
        mockV3AggregatorWbtcUsd.updateAnswer(100_000 * 1e8);
        vm.stopPrank();

        vm.startPrank(alice);
        IERC20(usdc).approve(address(positions), COLLATERAL_AMOUNT_USDC);
        market.openShortPosition(usdc, wbtc, FEE_TIER, 3, COLLATERAL_AMOUNT_USDC, 0, 0);
        vm.stopPrank();

        uint256 positionId = positions.getTraderPositions(alice)[0];

        // For short loss: price goes UP
        // Calculation: PnL = Position Size × Price Change%
        // For 3x leverage with 100 USDC collateral, position size = 300 USDC
        // For -50 USDC loss: -50 = 300 × Price Change% → Price Change% = 16.67%
        // Add ~0.30% for fees: 16.97%
        int256 newPrice = 11638000817120; // ~16.97% increase
        vm.startPrank(deployer);
        mockV3AggregatorWbtcUsd.updateAnswer(newPrice);
        vm.stopPrank();

        vm.startPrank(alice);
        market.closePosition(positionId);
        vm.stopPrank();

        assertApproxEqAbs(IERC20(getUsdcAddress()).balanceOf(alice), initialBalance - TARGET_PNL_50_USDC, DELTA_USDC, "Final balance should be 50 USDC");
    }

    // ===================================================================
    // WETH COLLATERAL - 2x LEVERAGE - PROFIT TESTS
    // Position Tokens: WBTC/WETH
    // For shorts: profit = price DOWN
    // ===================================================================

    function test_Short_Profit_of_1_WETH() public {
        address weth = getWethAddress();
        address wbtc = getWbtcAddress();

        depositLiquidity(weth, 1000e18);
        depositLiquidity(wbtc, 10e8);
        writeTokenBalance(alice, weth, COLLATERAL_AMOUNT_WETH);
        uint256 initialBalance = IERC20(getWethAddress()).balanceOf(alice);

        vm.startPrank(deployer);
        mockV3AggregatorEthUsd.updateAnswer(4000 * 1e8);
        mockV3AggregatorWbtcUsd.updateAnswer(100_000 * 1e8);
        vm.stopPrank();

        vm.startPrank(alice);
        IERC20(weth).approve(address(positions), COLLATERAL_AMOUNT_WETH);
        market.openShortPosition(weth, wbtc, FEE_TIER, 2, COLLATERAL_AMOUNT_WETH, 0, 0);
        vm.stopPrank();

        uint256 positionId = positions.getTraderPositions(alice)[0];

        // For short profit: price goes DOWN
        int256 newPrice = 100500e8; // ~0.56% decrease
        vm.startPrank(deployer);
        mockV3AggregatorWbtcUsd.updateAnswer(newPrice);
        vm.stopPrank();

        vm.startPrank(alice);
        market.closePosition(positionId);
        vm.stopPrank();

        assertApproxEqAbs(IERC20(getWethAddress()).balanceOf(alice), initialBalance + TARGET_PNL_0_01_WETH, DELTA_WETH, "Final balance should be 1.01 WETH");
    }

    function test_Short_Profit_of_10_WETH() public {
        address weth = getWethAddress();
        address wbtc = getWbtcAddress();

        depositLiquidity(weth, 1000e18);
        depositLiquidity(wbtc, 10e8);
        writeTokenBalance(alice, weth, COLLATERAL_AMOUNT_WETH);
        uint256 initialBalance = IERC20(getWethAddress()).balanceOf(alice);

        vm.startPrank(deployer);
        mockV3AggregatorEthUsd.updateAnswer(4000 * 1e8);
        mockV3AggregatorWbtcUsd.updateAnswer(100_000 * 1e8);
        vm.stopPrank();

        vm.startPrank(alice);
        IERC20(weth).approve(address(positions), COLLATERAL_AMOUNT_WETH);
        market.openShortPosition(weth, wbtc, FEE_TIER, 2, COLLATERAL_AMOUNT_WETH, 0, 0);
        vm.stopPrank();

        uint256 positionId = positions.getTraderPositions(alice)[0];

        // For short profit: price goes DOWN
        // Calculation: PnL = Position Size × Price Change%
        // For 2x leverage with 1 WETH collateral, position size = 2 WETH
        // For +0.1 WETH profit: 0.1 = 2 × Price Change% → Price Change% = 5%
        // Subtract ~0.03% for fees: 4.97%
        int256 newPrice = 105000e8; // ~4.97% decrease
        vm.startPrank(deployer);
        mockV3AggregatorWbtcUsd.updateAnswer(newPrice);
        vm.stopPrank();

        vm.startPrank(alice);
        market.closePosition(positionId);
        vm.stopPrank();

        assertApproxEqAbs(IERC20(getWethAddress()).balanceOf(alice), initialBalance + TARGET_PNL_0_1_WETH, DELTA_WETH, "Final balance should be 1.1 WETH");
    }

    function test_Short_Profit_of_50_WETH() public {
        address weth = getWethAddress();
        address wbtc = getWbtcAddress();

        depositLiquidity(weth, 1000e18);
        depositLiquidity(wbtc, 10e8);
        writeTokenBalance(alice, weth, COLLATERAL_AMOUNT_WETH);
        uint256 initialBalance = IERC20(getWethAddress()).balanceOf(alice);

        vm.startPrank(deployer);
        mockV3AggregatorEthUsd.updateAnswer(4000 * 1e8);
        mockV3AggregatorWbtcUsd.updateAnswer(100_000 * 1e8);
        vm.stopPrank();

        vm.startPrank(alice);
        IERC20(weth).approve(address(positions), COLLATERAL_AMOUNT_WETH);
        market.openShortPosition(weth, wbtc, FEE_TIER, 2, COLLATERAL_AMOUNT_WETH, 0, 0);
        vm.stopPrank();

        uint256 positionId = positions.getTraderPositions(alice)[0];

        // For short profit: price goes DOWN
        // Calculation: PnL = Position Size × Price Change%
        // For 2x leverage with 1 WETH collateral, position size = 2 WETH
        // For +0.5 WETH profit: 0.5 = 2 × Price Change% → Price Change% = 25%
        // Subtract ~0.07% for fees: 24.93%
        int256 newPrice = 125000e8; // ~24.93% decrease
        vm.startPrank(deployer);
        mockV3AggregatorWbtcUsd.updateAnswer(newPrice);
        vm.stopPrank();

        vm.startPrank(alice);
        market.closePosition(positionId);
        vm.stopPrank();

        assertApproxEqAbs(IERC20(getWethAddress()).balanceOf(alice), initialBalance + TARGET_PNL_0_5_WETH, DELTA_WETH, "Final balance should be 1.5 WETH");
    }

    // ===================================================================
    // WETH COLLATERAL - 2x LEVERAGE - LOSS TESTS
    // ===================================================================

    function test_Short_Loss_of_minus_1_WETH() public {
        address weth = getWethAddress();
        address wbtc = getWbtcAddress();

        depositLiquidity(weth, 1000e18);
        depositLiquidity(wbtc, 10e8);
        writeTokenBalance(alice, weth, COLLATERAL_AMOUNT_WETH);
        uint256 initialBalance = IERC20(getWethAddress()).balanceOf(alice);

        vm.startPrank(deployer);
        mockV3AggregatorEthUsd.updateAnswer(4000 * 1e8);
        mockV3AggregatorWbtcUsd.updateAnswer(100_000 * 1e8);
        vm.stopPrank();

        vm.startPrank(alice);
        IERC20(weth).approve(address(positions), COLLATERAL_AMOUNT_WETH);
        market.openShortPosition(weth, wbtc, FEE_TIER, 2, COLLATERAL_AMOUNT_WETH, 0, 0);
        vm.stopPrank();

        uint256 positionId = positions.getTraderPositions(alice)[0];

        // For short loss: price goes UP
        int256 newPrice = 99500e8; // ~0.56% increase
        vm.startPrank(deployer);
        mockV3AggregatorWbtcUsd.updateAnswer(newPrice);
        vm.stopPrank();

        vm.startPrank(alice);
        market.closePosition(positionId);
        vm.stopPrank();

        assertApproxEqAbs(IERC20(getWethAddress()).balanceOf(alice), initialBalance - TARGET_PNL_0_01_WETH, DELTA_WETH, "Final balance should be 0.99 WETH");
    }

    function test_Short_Loss_of_minus_10_WETH() public {
        address weth = getWethAddress();
        address wbtc = getWbtcAddress();

        depositLiquidity(weth, 1000e18);
        depositLiquidity(wbtc, 10e8);
        writeTokenBalance(alice, weth, COLLATERAL_AMOUNT_WETH);
        uint256 initialBalance = IERC20(getWethAddress()).balanceOf(alice);

        vm.startPrank(deployer);
        mockV3AggregatorEthUsd.updateAnswer(4000 * 1e8);
        mockV3AggregatorWbtcUsd.updateAnswer(100_000 * 1e8);
        vm.stopPrank();

        vm.startPrank(alice);
        IERC20(weth).approve(address(positions), COLLATERAL_AMOUNT_WETH);
        market.openShortPosition(weth, wbtc, FEE_TIER, 2, COLLATERAL_AMOUNT_WETH, 0, 0);
        vm.stopPrank();

        uint256 positionId = positions.getTraderPositions(alice)[0];

        // For short loss: price goes UP
        // Calculation: PnL = Position Size × Price Change%
        // For 2x leverage with 1 WETH collateral, position size = 2 WETH
        // For -0.1 WETH loss: -0.1 = 2 × Price Change% → Price Change% = 5%
        // Add ~0.03% for fees: 5.03%
        int256 newPrice = 95000e8; // ~5.03% increase
        vm.startPrank(deployer);
        mockV3AggregatorWbtcUsd.updateAnswer(newPrice);
        vm.stopPrank();

        vm.startPrank(alice);
        market.closePosition(positionId);
        vm.stopPrank();

        assertApproxEqAbs(IERC20(getWethAddress()).balanceOf(alice), initialBalance - TARGET_PNL_0_1_WETH, DELTA_WETH, "Final balance should be 0.9 WETH");
    }

    function test_Short_Loss_of_minus_50_WETH() public {
        address weth = getWethAddress();
        address wbtc = getWbtcAddress();

        depositLiquidity(weth, 1000e18);
        depositLiquidity(wbtc, 10e8);
        writeTokenBalance(alice, weth, COLLATERAL_AMOUNT_WETH);
        uint256 initialBalance = IERC20(getWethAddress()).balanceOf(alice);

        vm.startPrank(deployer);
        mockV3AggregatorEthUsd.updateAnswer(4000 * 1e8);
        mockV3AggregatorWbtcUsd.updateAnswer(100_000 * 1e8);
        vm.stopPrank();

        vm.startPrank(alice);
        IERC20(weth).approve(address(positions), COLLATERAL_AMOUNT_WETH);
        market.openShortPosition(weth, wbtc, FEE_TIER, 2, COLLATERAL_AMOUNT_WETH, 0, 0);
        vm.stopPrank();

        uint256 positionId = positions.getTraderPositions(alice)[0];

        // For short loss: price goes UP
        // Calculation: PnL = Position Size × Price Change%
        // For 2x leverage with 1 WETH collateral, position size = 2 WETH
        // For -0.5 WETH loss: -0.5 = 2 × Price Change% → Price Change% = 25%
        // Add ~0.08% for fees: 25.08%
        int256 newPrice = 75000e8; // ~25.08% increase
        vm.startPrank(deployer);
        mockV3AggregatorWbtcUsd.updateAnswer(newPrice);
        vm.stopPrank();

        vm.startPrank(alice);
        market.closePosition(positionId);
        vm.stopPrank();

        assertApproxEqAbs(IERC20(getWethAddress()).balanceOf(alice), initialBalance - TARGET_PNL_0_5_WETH, DELTA_WETH, "Final balance should be 0.5 WETH");
    }

    // ===================================================================
    // WETH COLLATERAL - 3x LEVERAGE - PROFIT TESTS
    // ===================================================================

    function test_Short_Profit_of_1_WETH_3x() public {
        address weth = getWethAddress();
        address wbtc = getWbtcAddress();

        depositLiquidity(weth, 1000e18);
        depositLiquidity(wbtc, 10e8);
        writeTokenBalance(alice, weth, COLLATERAL_AMOUNT_WETH);
        uint256 initialBalance = IERC20(getWethAddress()).balanceOf(alice);

        vm.startPrank(deployer);
        mockV3AggregatorEthUsd.updateAnswer(4000 * 1e8);
        mockV3AggregatorWbtcUsd.updateAnswer(100_000 * 1e8);
        vm.stopPrank();

        vm.startPrank(alice);
        IERC20(weth).approve(address(positions), COLLATERAL_AMOUNT_WETH);
        market.openShortPosition(weth, wbtc, FEE_TIER, 3, COLLATERAL_AMOUNT_WETH, 0, 0);
        vm.stopPrank();

        uint256 positionId = positions.getTraderPositions(alice)[0];

        // For short profit: price goes DOWN
        int256 newPrice = 100333e8; // ~0.38% decrease
        vm.startPrank(deployer);
        mockV3AggregatorWbtcUsd.updateAnswer(newPrice);
        vm.stopPrank();

        vm.startPrank(alice);
        market.closePosition(positionId);
        vm.stopPrank();

        assertApproxEqAbs(IERC20(getWethAddress()).balanceOf(alice), initialBalance + TARGET_PNL_0_01_WETH, DELTA_WETH, "Final balance should be 1.01 WETH");
    }

    function test_Short_Profit_of_10_WETH_3x() public {
        address weth = getWethAddress();
        address wbtc = getWbtcAddress();

        depositLiquidity(weth, 1000e18);
        depositLiquidity(wbtc, 10e8);
        writeTokenBalance(alice, weth, COLLATERAL_AMOUNT_WETH);
        uint256 initialBalance = IERC20(getWethAddress()).balanceOf(alice);

        vm.startPrank(deployer);
        mockV3AggregatorEthUsd.updateAnswer(4000 * 1e8);
        mockV3AggregatorWbtcUsd.updateAnswer(100_000 * 1e8);
        vm.stopPrank();

        vm.startPrank(alice);
        IERC20(weth).approve(address(positions), COLLATERAL_AMOUNT_WETH);
        market.openShortPosition(weth, wbtc, FEE_TIER, 3, COLLATERAL_AMOUNT_WETH, 0, 0);
        vm.stopPrank();

        uint256 positionId = positions.getTraderPositions(alice)[0];

        // For short profit: price goes DOWN
        // Calculation: PnL = Position Size × Price Change%
        // For 3x leverage with 1 WETH collateral, position size = 3 WETH
        // For +0.1 WETH profit: 0.1 = 3 × Price Change% → Price Change% = 3.33%
        // Subtract ~0.03% for fees: 3.30%
        int256 newPrice = 103333e8; // ~3.30% decrease
        vm.startPrank(deployer);
        mockV3AggregatorWbtcUsd.updateAnswer(newPrice);
        vm.stopPrank();

        vm.startPrank(alice);
        market.closePosition(positionId);
        vm.stopPrank();

        assertApproxEqAbs(IERC20(getWethAddress()).balanceOf(alice), initialBalance + TARGET_PNL_0_1_WETH, DELTA_WETH, "Final balance should be 1.1 WETH");
    }

    function test_Short_Profit_of_50_WETH_3x() public {
        address weth = getWethAddress();
        address wbtc = getWbtcAddress();

        depositLiquidity(weth, 1000e18);
        depositLiquidity(wbtc, 10e8);
        writeTokenBalance(alice, weth, COLLATERAL_AMOUNT_WETH);
        uint256 initialBalance = IERC20(getWethAddress()).balanceOf(alice);

        vm.startPrank(deployer);
        mockV3AggregatorEthUsd.updateAnswer(4000 * 1e8);
        mockV3AggregatorWbtcUsd.updateAnswer(100_000 * 1e8);
        vm.stopPrank();

        vm.startPrank(alice);
        IERC20(weth).approve(address(positions), COLLATERAL_AMOUNT_WETH);
        market.openShortPosition(weth, wbtc, FEE_TIER, 3, COLLATERAL_AMOUNT_WETH, 0, 0);
        vm.stopPrank();

        uint256 positionId = positions.getTraderPositions(alice)[0];

        // For short profit: price goes DOWN
        // Calculation: PnL = Position Size × Price Change%
        // For 3x leverage with 1 WETH collateral, position size = 3 WETH
        // For +0.5 WETH profit: 0.5 = 3 × Price Change% → Price Change% = 16.67%
        // Subtract ~0.30% for fees: 16.37%
        int256 newPrice = 116667e8; // ~16.37% decrease
        vm.startPrank(deployer);
        mockV3AggregatorWbtcUsd.updateAnswer(newPrice);
        vm.stopPrank();

        vm.startPrank(alice);
        market.closePosition(positionId);
        vm.stopPrank();

        assertApproxEqAbs(IERC20(getWethAddress()).balanceOf(alice), initialBalance + TARGET_PNL_0_5_WETH, DELTA_WETH, "Final balance should be 1.5 WETH");
    }

    // ===================================================================
    // WETH COLLATERAL - 3x LEVERAGE - LOSS TESTS
    // ===================================================================

    function test_Short_Loss_of_minus_1_WETH_3x() public {
        address weth = getWethAddress();
        address wbtc = getWbtcAddress();

        depositLiquidity(weth, 1000e18);
        depositLiquidity(wbtc, 10e8);
        writeTokenBalance(alice, weth, COLLATERAL_AMOUNT_WETH);
        uint256 initialBalance = IERC20(getWethAddress()).balanceOf(alice);

        vm.startPrank(deployer);
        mockV3AggregatorEthUsd.updateAnswer(4000 * 1e8);
        mockV3AggregatorWbtcUsd.updateAnswer(100_000 * 1e8);
        vm.stopPrank();

        vm.startPrank(alice);
        IERC20(weth).approve(address(positions), COLLATERAL_AMOUNT_WETH);
        market.openShortPosition(weth, wbtc, FEE_TIER, 3, COLLATERAL_AMOUNT_WETH, 0, 0);
        vm.stopPrank();

        uint256 positionId = positions.getTraderPositions(alice)[0];

        // For short loss: price goes UP
        int256 newPrice = 99667e8; // ~0.38% increase
        vm.startPrank(deployer);
        mockV3AggregatorWbtcUsd.updateAnswer(newPrice);
        vm.stopPrank();

        vm.startPrank(alice);
        market.closePosition(positionId);
        vm.stopPrank();

        assertApproxEqAbs(IERC20(getWethAddress()).balanceOf(alice), initialBalance - TARGET_PNL_0_01_WETH, DELTA_WETH, "Final balance should be 0.99 WETH");
    }

    function test_Short_Loss_of_minus_10_WETH_3x() public {
        address weth = getWethAddress();
        address wbtc = getWbtcAddress();

        depositLiquidity(weth, 1000e18);
        depositLiquidity(wbtc, 10e8);
        writeTokenBalance(alice, weth, COLLATERAL_AMOUNT_WETH);
        uint256 initialBalance = IERC20(getWethAddress()).balanceOf(alice);

        vm.startPrank(deployer);
        mockV3AggregatorEthUsd.updateAnswer(4000 * 1e8);
        mockV3AggregatorWbtcUsd.updateAnswer(100_000 * 1e8);
        vm.stopPrank();

        vm.startPrank(alice);
        IERC20(weth).approve(address(positions), COLLATERAL_AMOUNT_WETH);
        market.openShortPosition(weth, wbtc, FEE_TIER, 3, COLLATERAL_AMOUNT_WETH, 0, 0);
        vm.stopPrank();

        uint256 positionId = positions.getTraderPositions(alice)[0];

        // For short loss: price goes UP
        // Calculation: PnL = Position Size × Price Change%
        // For 3x leverage with 1 WETH collateral, position size = 3 WETH
        // For -0.1 WETH loss: -0.1 = 3 × Price Change% → Price Change% = 3.33%
        // Add ~0.03% for fees: 3.36%
        int256 newPrice = 96667e8; // ~3.36% increase
        vm.startPrank(deployer);
        mockV3AggregatorWbtcUsd.updateAnswer(newPrice);
        vm.stopPrank();

        vm.startPrank(alice);
        market.closePosition(positionId);
        vm.stopPrank();

        assertApproxEqAbs(IERC20(getWethAddress()).balanceOf(alice), initialBalance - TARGET_PNL_0_1_WETH, DELTA_WETH, "Final balance should be 0.9 WETH");
    }

    function test_Short_Loss_of_minus_50_WETH_3x() public {
        address weth = getWethAddress();
        address wbtc = getWbtcAddress();

        depositLiquidity(weth, 1000e18);
        depositLiquidity(wbtc, 10e8);
        writeTokenBalance(alice, weth, COLLATERAL_AMOUNT_WETH);
        uint256 initialBalance = IERC20(getWethAddress()).balanceOf(alice);

        vm.startPrank(deployer);
        mockV3AggregatorEthUsd.updateAnswer(4000 * 1e8);
        mockV3AggregatorWbtcUsd.updateAnswer(100_000 * 1e8);
        vm.stopPrank();

        vm.startPrank(alice);
        IERC20(weth).approve(address(positions), COLLATERAL_AMOUNT_WETH);
        market.openShortPosition(weth, wbtc, FEE_TIER, 3, COLLATERAL_AMOUNT_WETH, 0, 0);
        vm.stopPrank();

        uint256 positionId = positions.getTraderPositions(alice)[0];

        // For short loss: price goes UP
        // Calculation: PnL = Position Size × Price Change%
        // For 3x leverage with 1 WETH collateral, position size = 3 WETH
        // For -0.5 WETH loss: -0.5 = 3 × Price Change% → Price Change% = 16.67%
        // Add ~0.30% for fees: 16.97%
        int256 newPrice = 83333e8; // ~16.97% increase
        vm.startPrank(deployer);
        mockV3AggregatorWbtcUsd.updateAnswer(newPrice);
        vm.stopPrank();

        vm.startPrank(alice);
        market.closePosition(positionId);
        vm.stopPrank();

        assertApproxEqAbs(IERC20(getWethAddress()).balanceOf(alice), initialBalance - TARGET_PNL_0_5_WETH, DELTA_WETH, "Final balance should be 0.5 WETH");
    }

    function test_Short_WhitelistFees() public {
        address weth = getWethAddress();
        address wbtc = getWbtcAddress();
        uint128 amount = 1e18;
        address whitelistedUser = address(0x88);

        depositLiquidity(weth, 1000e18);
        depositLiquidity(wbtc, 10e8);
        writeTokenBalance(whitelistedUser, weth, amount);

        vm.startPrank(deployer);
        feeManager.setCustomFees(whitelistedUser, 1, 0);
        mockV3AggregatorEthUsd.updateAnswer(4000 * 1e8);
        mockV3AggregatorWbtcUsd.updateAnswer(100000 * 1e8);
        vm.stopPrank();

        uint256 treasureBefore = IERC20(weth).balanceOf(conf.treasure);
        vm.startPrank(whitelistedUser);
        IERC20(weth).approve(address(positions), amount);
        market.openShortPosition(weth, wbtc, FEE_TIER, 2, amount, 0, 0);
        vm.stopPrank();

        uint256 treasureBalance = IERC20(weth).balanceOf(conf.treasure);
        assertApproxEqAbs(treasureBalance - treasureBefore, 1e14, 100);
    }

    function test_Short_MultipleLiquidations_Market() public {
        address weth = getWethAddress();
        address wbtc = getWbtcAddress();
        uint128 amountAlice = 1e18;
        uint128 amountBob = 2e18;

        depositLiquidity(weth, 1000e18);
        depositLiquidity(wbtc, 10e8);
        writeTokenBalance(alice, weth, amountAlice);
        writeTokenBalance(bob, weth, amountBob);

        vm.startPrank(deployer);
        mockV3AggregatorEthUsd.updateAnswer(4000 * 1e8);
        mockV3AggregatorWbtcUsd.updateAnswer(100000 * 1e8);
        vm.stopPrank();

        vm.startPrank(alice);
        IERC20(weth).approve(address(positions), amountAlice);
        market.openShortPosition(weth, wbtc, FEE_TIER, 2, amountAlice, 0, 0);
        vm.stopPrank();

        vm.startPrank(bob);
        IERC20(weth).approve(address(positions), amountBob);
        market.openShortPosition(weth, wbtc, FEE_TIER, 3, amountBob, 0, 0);
        vm.stopPrank();

        // For short positions, liquidation occurs when base token (WBTC) price goes UP
        // significantly, eroding the collateral value
        vm.startPrank(deployer);
        mockV3AggregatorWbtcUsd.updateAnswer(10000 * 1e8); // Price decrease to liquidate short
        vm.stopPrank();

        uint256[] memory liquidablePos = market.getLiquidablePositions();
        uint256 count = 0;
        for (uint256 i = 0; i < liquidablePos.length; i++) {
            if (liquidablePos[i] != 0) count++;
        }
        assertTrue(count >= 2, "Should have at least 2 liquidable positions");

        uint256 liquidatorBalanceBefore = IERC20(weth).balanceOf(deployer);
        vm.startPrank(deployer);
        market.liquidatePositions(liquidablePos);
        vm.stopPrank();

        assertEq(positions.getTraderPositions(alice).length, 0, "Alice positions should be liquidated");
        assertEq(positions.getTraderPositions(bob).length, 0, "Bob positions should be liquidated");

        uint256 liquidatorBalanceAfter = IERC20(weth).balanceOf(deployer);
        assertTrue(liquidatorBalanceAfter > liquidatorBalanceBefore, "Liquidator should receive reward");
    }
}
