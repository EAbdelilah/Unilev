// SPDX-License-Identifier: MIT
pragma solidity =0.8.19;

import {Utils} from "./utils/Utils.sol";
import "./utils/TestSetup.sol";
import "@uniswapPeriphery/contracts/interfaces/INonfungiblePositionManager.sol";
import "@openzeppelin/contracts/token/ERC721/ERC721.sol";

contract SimpleTradeLong is TestSetup {
    function test__simpleTradeToCloseLong1() public {
        uint128 amount = 10e8;
        writeTokenBalance(alice, conf.addWBTC, amount);
        setPrice(
            90000e6,
            conf.addWBTC,
            conf.addUSDC,
            3000,
            mockV3AggregatorWBTCETH,
            mockV3AggregatorUSDCETH,
            uniswapV3Helper
        );
        assertEq(amount, ERC20(conf.addWBTC).balanceOf(alice));
        assertEq(0, ERC20(conf.addWBTC).balanceOf(address(positions)));

        vm.startPrank(alice);
        ERC20(conf.addWBTC).approve(address(positions), amount);
        market.openPosition(conf.addWBTC, conf.addUSDC, uint24(3000), false, 1, amount, 0, 0);

        assertEq(0, ERC20(conf.addWBTC).balanceOf(alice));
        assertEq(amount, ERC20(conf.addWBTC).balanceOf(address(positions)));

        assertEq(1, positions.totalNbPos());
        uint256[] memory posAlice = positions.getTraderPositions(alice);
        assertEq(1, posAlice[0]);
        assertEq(alice, positions.ownerOf(posAlice[0]));

        market.closePosition(posAlice[0]);

        assertEq(amount, ERC20(conf.addWBTC).balanceOf(alice));
        assertEq(0, ERC20(conf.addWBTC).balanceOf(address(positions)));
    }

    function test__simpleTradeToCloseLong2() public {
        writeTokenBalance(alice, conf.addWBTC, 10e8);
        setPrice(
            20000e6,
            conf.addWBTC,
            conf.addUSDC,
            3000,
            mockV3AggregatorWBTCETH,
            mockV3AggregatorUSDCETH,
            uniswapV3Helper
        );
        assertEq(10e8, ERC20(conf.addWBTC).balanceOf(alice));
        assertEq(0, ERC20(conf.addWBTC).balanceOf(address(positions)));

        vm.startPrank(alice);
        ERC20(conf.addWBTC).approve(address(positions), 10e8);
        market.openPosition(conf.addWBTC, conf.addUSDC, uint24(3000), false, 1, 10e8, 0, 0);

        assertEq(0, ERC20(conf.addWBTC).balanceOf(alice));
        assertEq(10e8, ERC20(conf.addWBTC).balanceOf(address(positions)));

        assertEq(1, positions.totalNbPos());
        uint256[] memory posAlice = market.getTraderPositions(alice);
        (
            address baseToken_,
            address quoteToken_,
            uint128 positionSize_,
            uint64 timestamp_,
            bool isShort_,
            uint8 leverage_,
            uint256 breakEvenLimit_,
            uint160 limitPrice_,
            uint256 stopLossPrice_,
            int128 pnl,
            int128 currentPnL_
        ) = market.getPositionParams(posAlice[0]);
        assertEq(baseToken_, conf.addWBTC);
        assertEq(quoteToken_, conf.addUSDC);
        assertEq(positionSize_, 999900000);
        assertEq(timestamp_, block.timestamp);
        assertEq(isShort_, false);
        assertEq(leverage_, 1);
        assertEq(breakEvenLimit_, 0);
        assertEq(limitPrice_, 0);
        assertEq(stopLossPrice_, 0);
        assertEq(pnl, -100000);
        assertEq(currentPnL_, int128(999800000));

        assertEq(1, posAlice[0]);
        assertEq(alice, positions.ownerOf(posAlice[0]));

        market.closePosition(posAlice[0]);

        assertEq(10e8, ERC20(conf.addWBTC).balanceOf(alice));
        assertEq(0, ERC20(conf.addWBTC).balanceOf(address(positions)));
    }

    function test__simpleTradeStopLossAndCloseLong() public {
        uint128 amount = 10e8;
        writeTokenBalance(alice, conf.addWBTC, amount);
        setPrice(
            30000e6,
            conf.addWBTC,
            conf.addUSDC,
            3000,
            mockV3AggregatorWBTCETH,
            mockV3AggregatorUSDCETH,
            uniswapV3Helper
        );
        uint256[] memory posAlices = positions.getTraderPositions(alice);
        // assertEq(0, posAlice[0]);
        assertEq(0, posAlices.length);

        vm.startPrank(alice);
        ERC20(conf.addWBTC).approve(address(positions), amount);
        market.openPosition(conf.addWBTC, conf.addUSDC, uint24(3000), false, 1, amount, 0, 20000e6); // ST at 20000$ for 1 BTC

        assertEq(2, positions.getPositionState(1));

        assertEq(1, positions.totalNbPos());
        uint256[] memory posAlice = positions.getTraderPositions(alice);
        assertEq(1, posAlice[0]);
        assertEq(1, posAlice.length);

        assertEq(alice, positions.ownerOf(posAlice[0]));
        vm.stopPrank();

        vm.startPrank(bob);
        vm.expectRevert(abi.encodeWithSelector(Positions__POSITION_NOT_OWNED.selector, bob, 1));
        market.closePosition(posAlice[0]);
        vm.stopPrank();

        setPrice(
            19000e6,
            conf.addWBTC,
            conf.addUSDC,
            3000,
            mockV3AggregatorWBTCETH,
            mockV3AggregatorUSDCETH,
            uniswapV3Helper
        );
        vm.startPrank(alice);

        uint256[] memory liquidablePos = market.getLiquidablePositions();
        assertEq(1, liquidablePos.length);
        assertEq(3, positions.getPositionState(posAlice[0]));
        assertEq(1, liquidablePos[0]);

        market.closePosition(liquidablePos[0]);

        // console.log("balance of alice", ERC20(conf.addUSDC).balanceOf(alice));

        assertApproxEqRel(19000e6 * 10, ERC20(conf.addUSDC).balanceOf(alice), 0.01e18);
        assertEq(0, ERC20(conf.addWBTC).balanceOf(address(positions)));
        assertEq(0, ERC20(conf.addUSDC).balanceOf(address(positions)));

        vm.stopPrank();
    }

    function test__simpleTradeStopLossAndLiquidateLong() public {
        uint128 amount = 10e8;
        writeTokenBalance(alice, conf.addWBTC, amount);
        setPrice(
            30000e6,
            conf.addWBTC,
            conf.addUSDC,
            3000,
            mockV3AggregatorWBTCETH,
            mockV3AggregatorUSDCETH,
            uniswapV3Helper
        );

        vm.startPrank(alice);
        ERC20(conf.addWBTC).approve(address(positions), amount);
        market.openPosition(conf.addWBTC, conf.addUSDC, uint24(3000), false, 1, amount, 0, 20000e6); // ST at 20000$ for 1 BTC

        uint256[] memory posAlice = positions.getTraderPositions(alice);
        assertEq(1, posAlice[0]);
        vm.stopPrank();

        setPrice(
            19000e6,
            conf.addWBTC,
            conf.addUSDC,
            3000,
            mockV3AggregatorWBTCETH,
            mockV3AggregatorUSDCETH,
            uniswapV3Helper
        );
        vm.startPrank(bob);

        uint256[] memory liquidablePos = market.getLiquidablePositions();
        assertEq(1, liquidablePos.length);
        assertEq(3, positions.getPositionState(1));
        assertEq(1, liquidablePos[0]);

        market.liquidatePosition(liquidablePos[0]);

        // console.log("balance of bob reward", ERC20(conf.addWBTC).balanceOf(bob));

        assertApproxEqRel(19000e6 * 10, ERC20(conf.addUSDC).balanceOf(alice), 0.01e18);
        assertApproxEqRel(100000, ERC20(conf.addWBTC).balanceOf(bob), 0.01e18);

        assertEq(0, ERC20(conf.addWBTC).balanceOf(address(positions)));
        assertEq(0, ERC20(conf.addUSDC).balanceOf(address(positions)));

        vm.stopPrank();
    }

    function test__simpleTradeStopLossAndLiquidateBatchLong() public {
        uint128 amount = 10e8;
        writeTokenBalance(alice, conf.addWBTC, amount * 3);
        setPrice(
            30000e6,
            conf.addWBTC,
            conf.addUSDC,
            3000,
            mockV3AggregatorWBTCETH,
            mockV3AggregatorUSDCETH,
            uniswapV3Helper
        );

        vm.startPrank(alice);
        ERC20(conf.addWBTC).approve(address(positions), amount);
        market.openPosition(conf.addWBTC, conf.addUSDC, uint24(3000), false, 1, amount, 0, 20000e6); // ST at 20000$ for 1 BTC
        ERC20(conf.addWBTC).approve(address(positions), amount * 2);
        market.openPosition(
            conf.addWBTC,
            conf.addUSDC,
            uint24(3000),
            false,
            1,
            amount * 2,
            0,
            21000e6
        ); // ST at 20000$ for 1 BTC

        uint256[] memory posAlice = positions.getTraderPositions(alice);
        assertEq(2, posAlice[0]);
        assertEq(1, posAlice[1]);

        vm.stopPrank();

        setPrice(
            19000e6,
            conf.addWBTC,
            conf.addUSDC,
            3000,
            mockV3AggregatorWBTCETH,
            mockV3AggregatorUSDCETH,
            uniswapV3Helper
        );
        vm.startPrank(bob);

        uint256[] memory liquidablePos = market.getLiquidablePositions();
        assertEq(2, liquidablePos.length);
        assertEq(3, positions.getPositionState(2));
        assertEq(2, liquidablePos[0]);
        assertEq(1, liquidablePos[1]);

        market.liquidatePositions(liquidablePos);

        assertApproxEqRel(19000e6 * 10 * 3, ERC20(conf.addUSDC).balanceOf(alice), 0.05e18);
        assertApproxEqRel(100000 * 2, ERC20(conf.addWBTC).balanceOf(bob), 0.01e18);

        assertEq(0, ERC20(conf.addWBTC).balanceOf(address(positions)));
        assertEq(0, ERC20(conf.addUSDC).balanceOf(address(positions)));

        vm.stopPrank();
    }

    function test__simpleLimitOrderAndCloseLong() public {
        uint128 amount = 30000e6;
        uint24 fee = 100;
        address token1 = conf.addWBTC;
        address token2 = conf.addUSDC;

        writeTokenBalance(alice, token1, amount);

        vm.startPrank(alice);
        ERC20(token1).approve(address(positions), amount);
        market.openPosition(token1, token2, uint24(fee), false, 1, amount, 40000e6, 0);

        assertEq(0, ERC20(token2).balanceOf(address(positions)));

        assertEq(1, positions.totalNbPos());
        uint256[] memory posAlice = positions.getTraderPositions(alice);
        assertEq(1, posAlice[0]);
        assertEq(1, posAlice.length);
        assertEq(2, positions.getPositionState(1));

        market.closePosition(posAlice[0]);

        // assertEq(0, ERC20(token1).balanceOf(address(positions))); // TODO check why this is not 0
        assertApproxEqRel(amount, ERC20(token1).balanceOf(address(alice)), 0.01e18);

        vm.stopPrank();
    }

    // function test__simpleLimitOrderAndLiquidate() public {
    //     uint128 amount = 10e8;
    //     uint24 fee = 100;
    //     address token1 = conf.addDAI;
    //     address token2 = conf.addUSDC;

    //     writeTokenBalance(alice, token1, amount);
    //     setPrice(
    //         11e5,
    //         token1,
    //         token2,
    //         fee,
    //         mockV3AggregatorDAIETH,
    //         mockV3AggregatorUSDCETH,
    //         uniswapV3Helper
    //     );

    //     vm.startPrank(alice);
    //     ERC20(token1).approve(address(positions), amount);
    //     market.openPosition(token1, token2, uint24(fee), false, 1, amount, 2e6, 0);

    //     assertEq(0, ERC20(token2).balanceOf(address(positions)));

    //     assertEq(1, positions.totalNbPos());
    //     uint256[] memory posAlice = positions.getTraderPositions(alice);
    //     assertEq(1, posAlice[0]);
    //     assertEq(1, posAlice.length);
    //     assertEq(2, positions.getPositionState(1));

    //     market.closePosition(posAlice[0]);

    //     assertEq(0, ERC20(token1).balanceOf(address(positions)));
    //     assertApproxEqRel(amount, ERC20(token1).balanceOf(address(alice)), 0.01e18);

    //     vm.stopPrank();
    // }
}
