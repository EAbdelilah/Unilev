// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./utils/TestSetup.sol";

contract LeveragedTradeShort is TestSetup {
    function test__leveragedTradeToCloseShort1() public {
        address wbtc = getWbtcAddress();
        address usdc = getUsdcAddress();

        uint128 amount = 2e6;
        uint24 fee = 3000;

        depositLiquidity(wbtc, 10e8);

        writeTokenBalance(alice, usdc, amount);

        assertEq(amount, IERC20(usdc).balanceOf(alice));
        assertEq(0, IERC20(usdc).balanceOf(address(positions)));

        uint256 wbtcBalanceBefore = IERC20(wbtc).balanceOf(address(liquidityPoolFactory.getTokenToLiquidityPools(wbtc)));
        console.log("WBTC balance in lbPool BEFORE open: ", wbtcBalanceBefore);

        vm.startPrank(alice);
        IERC20(usdc).approve(address(positions), amount);
        console.log("Open position");
        market.openShortPosition(usdc, wbtc, uint24(fee), 5, amount, 0, 0);

        assertEq(0, IERC20(usdc).balanceOf(alice));

        uint256 wbtcBalanceAfter = IERC20(wbtc).balanceOf(address(liquidityPoolFactory.getTokenToLiquidityPools(wbtc)));
        assertLt(wbtcBalanceAfter, wbtcBalanceBefore);

        uint256 usdcBalance = IERC20(usdc).balanceOf(address(positions));
        assertGt(usdcBalance, 0);

        assertEq(1, positions.totalNbPos());
        uint256[] memory posAlice = positions.getTraderPositions(alice);

        assertEq(1, posAlice[0]);
        assertEq(alice, positions.ownerOf(posAlice[0]));

        (,,,, bool isShort_, uint8 leverage_,,,,,) = positions.getPositionParams(posAlice[0]);
        assertEq(isShort_, true);
        assertEq(leverage_, 5);

        console.log("Close position");
        market.closePosition(posAlice[0]);

        assertGt(IERC20(usdc).balanceOf(alice), 0);
        assertEq(0, IERC20(usdc).balanceOf(address(positions)));

        uint256 wbtcBalanceAfterClose =
            IERC20(wbtc).balanceOf(address(liquidityPoolFactory.getTokenToLiquidityPools(wbtc)));
        console.log("WBTC balance in lbPool AFTER close: ", wbtcBalanceAfterClose);
    }
}
