// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BaseV4Test} from "./BaseV4Test.t.sol";
import {BeforeSwapDelta} from "../types/BeforeSwapDelta.sol";
import {Currency} from "../types/Currency.sol";
import {IHooks} from "../interfaces/IHooks.sol";

contract EswapLogicTest is BaseV4Test {
    function test_BeforeSwap_LeveragedDelta() public {
        uint8 leverage = 5;
        int128 margin = -10 ether;
        bytes memory data = abi.encode(true, leverage);

        vm.prank(address(manager));
        (bytes4 selector, BeforeSwapDelta delta, ) = hook.beforeSwap(address(this), key, true, margin, data);

        assertEq(selector, IHooks.beforeSwap.selector);

        int128 delta0 = int128(BeforeSwapDelta.unwrap(delta) >> 128);
        assertEq(delta0, 50 ether); // 10 * 5
    }

    function test_AfterSwap_SmartCollateral() public {
        vm.startPrank(address(manager));
        hook.beforeSwap(address(this), key, true, -10 ether, abi.encode(true, 5));

        hook.afterSwap(address(this), key, true, -50 ether, 50 ether, -45 ether, "");
        vm.stopPrank();

        (address trader, uint256 collateral, uint256 borrow, uint8 lev,,,, uint128 liq) = hook.positions(key.toId(), address(this));

        assertEq(trader, address(this));
        assertEq(collateral, 45 ether);
        assertEq(borrow, 40 ether); // 10 * (5-1)
        assertEq(lev, 5);
        assertEq(liq, 10 ether); // margin rehypothecated
    }

    function test_ERC6909_FunctionalTransfer() public {
        vm.startPrank(address(manager));
        hook.beforeSwap(address(this), key, true, -10 ether, abi.encode(true, 5));
        hook.afterSwap(address(this), key, true, -50 ether, 50 ether, -45 ether, "");
        vm.stopPrank();

        uint256 id = uint256(uint160(Currency.unwrap(key.currency1)));
        assertEq(hook.balanceOf(address(this), id), 45 ether);

        address bob = address(0xBOB);
        vm.prank(address(this));
        hook.transfer(bob, id, 5 ether);

        assertEq(hook.balanceOf(address(this), id), 40 ether);
        assertEq(hook.balanceOf(bob, id), 5 ether);
    }
}
