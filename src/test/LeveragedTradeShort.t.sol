// SPDX-License-Identifier: MIT
pragma solidity =0.8.19;

import {Utils} from "./utils/Utils.sol";
import "./utils/TestSetup.sol";
import "@uniswapPeriphery/contracts/interfaces/INonfungiblePositionManager.sol";
import "@openzeppelin/contracts/token/ERC721/ERC721.sol";

contract LeveragedTradeShort is TestSetup {
    function test__leveragedTradeToCloseShort1() public {
        uint128 amount = 1000e6;
        uint24 fee = 3000;
        writeTokenBalance(alice, conf.addUSDC, amount);
        setPrice(
            30000e6,
            conf.addWBTC,
            conf.addUSDC,
            fee,
            mockV3AggregatorWBTCETH,
            mockV3AggregatorUSDCETH,
            uniswapV3Helper
        );
        assertEq(amount, ERC20(conf.addUSDC).balanceOf(alice));
        assertEq(0, ERC20(conf.addUSDC).balanceOf(address(positions)));

        vm.startPrank(alice);
        ERC20(conf.addUSDC).approve(address(positions), amount);
        market.openPosition(conf.addUSDC, conf.addWBTC, uint24(fee), true, 2, amount, 0, 0);

        assertEq(0, ERC20(conf.addUSDC).balanceOf(alice));
        assertApproxEqRel(amount * 3, ERC20(conf.addUSDC).balanceOf(address(positions)), 0.05e18);

        assertEq(1, positions.totalNbPos());
        uint256[] memory posAlice = positions.getTraderPositions(alice);
        assertEq(1, posAlice[0]);
        assertEq(alice, positions.ownerOf(posAlice[0]));

        market.closePosition(posAlice[0]);

        assertApproxEqRel(amount, ERC20(conf.addUSDC).balanceOf(alice), 0.05e18);
        assertEq(0, ERC20(conf.addUSDC).balanceOf(address(positions)));
    }

    function test__leveragedTradeStopLossAndCloseLossShort() public {
        uint128 amount = 1000e6;
        uint24 fee = 3000;
        writeTokenBalance(alice, conf.addUSDC, amount);
        setPrice(
            30000e6,
            conf.addWBTC,
            conf.addUSDC,
            fee,
            mockV3AggregatorWBTCETH,
            mockV3AggregatorUSDCETH,
            uniswapV3Helper
        );
        vm.startPrank(alice);
        ERC20(conf.addUSDC).approve(address(positions), amount);
        market.openPosition(conf.addUSDC, conf.addWBTC, uint24(fee), true, 2, amount, 0, 40000e6);

        assertApproxEqRel(amount * 3, ERC20(conf.addUSDC).balanceOf(address(positions)), 0.05e18);

        vm.stopPrank();
        setPrice(
            41000e6,
            conf.addWBTC,
            conf.addUSDC,
            fee,
            mockV3AggregatorWBTCETH,
            mockV3AggregatorUSDCETH,
            uniswapV3Helper
        );

        uint256[] memory posAlice = positions.getTraderPositions(alice);
        assertEq(1, posAlice[0]);
        assertEq(alice, positions.ownerOf(posAlice[0]));

        vm.startPrank(alice);
        market.closePosition(posAlice[0]);

        console.log("balance of alice addWBTC ", ERC20(conf.addUSDC).balanceOf(alice));
        // assertApproxEqRel(aaa, ERC20(conf.addWBTC).balanceOf(alice), 0.05e18); // TODO
        assertEq(0, ERC20(conf.addWBTC).balanceOf(alice));
        assertEq(0, ERC20(conf.addUSDC).balanceOf(address(positions)));
        assertEq(0, ERC20(conf.addWBTC).balanceOf(address(positions)));
    }

    function test__leveragedTradeStopLossAndCloseWinShort() public {
        uint128 amount = 1000e6;
        uint24 fee = 3000;
        writeTokenBalance(alice, conf.addUSDC, amount);
        setPrice(
            30000e6,
            conf.addWBTC,
            conf.addUSDC,
            fee,
            mockV3AggregatorWBTCETH,
            mockV3AggregatorUSDCETH,
            uniswapV3Helper
        );
        vm.startPrank(alice);
        ERC20(conf.addUSDC).approve(address(positions), amount);
        market.openPosition(conf.addUSDC, conf.addWBTC, uint24(fee), true, 3, amount, 0, 40000e6);

        assertApproxEqRel(amount * 4, ERC20(conf.addUSDC).balanceOf(address(positions)), 0.05e18);

        vm.stopPrank();
        setPrice(
            20000e6,
            conf.addWBTC,
            conf.addUSDC,
            fee,
            mockV3AggregatorWBTCETH,
            mockV3AggregatorUSDCETH,
            uniswapV3Helper
        );

        uint256[] memory posAlice = positions.getTraderPositions(alice);
        assertEq(1, posAlice[0]);
        assertEq(alice, positions.ownerOf(posAlice[0]));

        vm.startPrank(alice);
        market.closePosition(posAlice[0]);

        console.log("balance of alice USDC ", ERC20(conf.addUSDC).balanceOf(alice));
        // assertApproxEqRel(aaa, ERC20(conf.addWBTC).balanceOf(alice), 0.05e18); // TODO
        assertEq(0, ERC20(conf.addWBTC).balanceOf(alice));
        assertEq(0, ERC20(conf.addUSDC).balanceOf(address(positions)));
        assertEq(0, ERC20(conf.addWBTC).balanceOf(address(positions)));
    }

    function test__leveragedTradeStopLossAndLiquidateShort() public {
        uint128 amount = 1000e6;
        uint24 fee = 3000;
        writeTokenBalance(alice, conf.addUSDC, amount);
        setPrice(
            30000e6,
            conf.addWBTC,
            conf.addUSDC,
            fee,
            mockV3AggregatorWBTCETH,
            mockV3AggregatorUSDCETH,
            uniswapV3Helper
        );
        vm.startPrank(alice);
        ERC20(conf.addUSDC).approve(address(positions), amount);
        market.openPosition(conf.addUSDC, conf.addWBTC, uint24(fee), true, 2, amount, 0, 40000e6);

        assertApproxEqRel(amount * 3, ERC20(conf.addUSDC).balanceOf(address(positions)), 0.05e18);

        vm.stopPrank();
        setPrice(
            41000e6,
            conf.addWBTC,
            conf.addUSDC,
            fee,
            mockV3AggregatorWBTCETH,
            mockV3AggregatorUSDCETH,
            uniswapV3Helper
        );

        uint256[] memory posAlice = positions.getTraderPositions(alice);
        assertEq(1, posAlice[0]);
        assertEq(alice, positions.ownerOf(posAlice[0]));

        vm.startPrank(bob);
        market.liquidatePosition(posAlice[0]);

        console.log("balance of alice addUSDC ", ERC20(conf.addUSDC).balanceOf(alice));
        // assertApproxEqRel(aaa, ERC20(conf.addWBTC).balanceOf(alice), 0.05e18); // TODO
        assertEq(30003000, ERC20(conf.addUSDC).balanceOf(bob));
        assertEq(0, ERC20(conf.addUSDC).balanceOf(address(positions)));
        assertEq(0, ERC20(conf.addWBTC).balanceOf(address(positions)));
    }

    function test__leveragedTradeWithoutStopLossAndLiquidateShort() public {
        uint128 amount = 1000e6;
        uint24 fee = 3000;
        writeTokenBalance(alice, conf.addUSDC, amount);
        setPrice(
            30000e6,
            conf.addWBTC,
            conf.addUSDC,
            fee,
            mockV3AggregatorWBTCETH,
            mockV3AggregatorUSDCETH,
            uniswapV3Helper
        );
        vm.startPrank(alice);
        ERC20(conf.addUSDC).approve(address(positions), amount);
        market.openPosition(conf.addUSDC, conf.addWBTC, uint24(fee), true, 2, amount, 0, 0);
        assertApproxEqRel(amount * 3, ERC20(conf.addUSDC).balanceOf(address(positions)), 0.05e18);

        vm.stopPrank();
        // Theoretically badDebt = 45000e6 lets set the price to 44000e6
        setPrice(
            44000e6,
            conf.addWBTC,
            conf.addUSDC,
            fee,
            mockV3AggregatorWBTCETH,
            mockV3AggregatorUSDCETH,
            uniswapV3Helper
        );

        uint256[] memory posAlice = positions.getTraderPositions(alice);
        assertEq(1, posAlice[0]);
        assertEq(alice, positions.ownerOf(posAlice[0]));

        vm.startPrank(bob);
        market.liquidatePosition(posAlice[0]);

        console.log("balance of alice addUSDC ", ERC20(conf.addUSDC).balanceOf(alice));
        // assertApproxEqRel(aaa, ERC20(conf.addWBTC).balanceOf(alice), 0.05e18); // TODO
        assertEq(30003000, ERC20(conf.addUSDC).balanceOf(bob));
        assertEq(0, ERC20(conf.addUSDC).balanceOf(address(positions)));
        assertEq(0, ERC20(conf.addWBTC).balanceOf(address(positions)));
    }

    function test__leveragedTradeBadDebtAndLiquidateShort() public {
        uint128 amount = 1000e6;
        uint24 fee = 3000;
        console.log("balance of pool addWBTC ", ERC20(conf.addWBTC).balanceOf(address(lbPoolWBTC)));
        writeTokenBalance(alice, conf.addUSDC, amount);
        setPrice(
            30000e6,
            conf.addWBTC,
            conf.addUSDC,
            fee,
            mockV3AggregatorWBTCETH,
            mockV3AggregatorUSDCETH,
            uniswapV3Helper
        );
        vm.startPrank(alice);
        ERC20(conf.addUSDC).approve(address(positions), amount);
        market.openPosition(conf.addUSDC, conf.addWBTC, uint24(fee), true, 2, amount, 0, 0);
        assertApproxEqRel(amount * 3, ERC20(conf.addUSDC).balanceOf(address(positions)), 0.05e18);

        vm.stopPrank();
        // Theoretically badDebt = 45000e6 lets set the price to 60000e6 to create bad debt
        setPrice(
            60000e6,
            conf.addWBTC,
            conf.addUSDC,
            fee,
            mockV3AggregatorWBTCETH,
            mockV3AggregatorUSDCETH,
            uniswapV3Helper
        );

        uint256[] memory posAlice = positions.getTraderPositions(alice);
        assertEq(1, posAlice[0]);
        assertEq(alice, positions.ownerOf(posAlice[0]));

        vm.startPrank(bob);
        market.liquidatePosition(posAlice[0]);

        console.log("balance of alice addWBTC ", ERC20(conf.addWBTC).balanceOf(alice));
        console.log("balance of pool addWBTC ", ERC20(conf.addWBTC).balanceOf(address(lbPoolWBTC)));
        // assertApproxEqRel(aaa, ERC20(conf.addWBTC).balanceOf(alice), 0.05e18); // TODO
        assertEq(30003000, ERC20(conf.addUSDC).balanceOf(bob));
        assertEq(0, ERC20(conf.addUSDC).balanceOf(address(positions)));
        assertEq(0, ERC20(conf.addWBTC).balanceOf(address(positions)));
    }

    // function test__leveragedLimitOrderAndCloseShort() public {} // TODO
}
