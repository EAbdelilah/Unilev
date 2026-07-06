// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BaseV4Test} from "./BaseV4Test.t.sol";
import {BeforeSwapDelta} from "../types/BeforeSwapDelta.sol";
import {Currency} from "../types/Currency.sol";

contract EswapLogicTest is BaseV4Test {
    function test_Trade_1x_Long() public {
        uint8 leverage = 1;
        int128 margin = -10 ether;
        bytes memory data = abi.encode(true, leverage, address(this));

        vm.prank(address(manager));
        (,,) = hook.beforeSwap(address(this), key, true, margin, data);

        vm.startPrank(address(manager));
        hook.afterSwap(address(this), key, true, -10 ether, 10 ether, -9.5 ether, "");
        vm.stopPrank();

        (address trader, uint256 collateral, uint256 borrow, uint8 lev,,,, uint128 liq) = hook.positions(key.toId(), address(this));
        assertEq(trader, address(this));
        assertEq(collateral, 9.5 ether);
        assertEq(borrow, 0);
        assertEq(lev, 1);
        assertEq(liq, 10 ether);
    }

    function test_Trade_5x_Short() public {
        uint8 leverage = 5;
        int128 margin = -10 ether;
        bytes memory data = abi.encode(true, leverage, address(this));

        vm.prank(address(manager));
        (,,) = hook.beforeSwap(address(this), key, false, margin, data);

        vm.startPrank(address(manager));
        hook.afterSwap(address(this), key, false, -50 ether, 50 ether, -48 ether, "");
        vm.stopPrank();

        (address trader, uint256 collateral, uint256 borrow, uint8 lev,,,, uint128 liq) = hook.positions(key.toId(), address(this));
        assertEq(trader, address(this));
        assertEq(collateral, 48 ether);
        assertEq(borrow, 40 ether);
        assertEq(lev, 5);
        assertEq(liq, 10 ether);
    }
}
