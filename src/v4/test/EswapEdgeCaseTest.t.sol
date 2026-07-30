// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BaseV4Test} from "./BaseV4Test.t.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";

contract EswapEdgeCaseTest is BaseV4Test {
    function setUp() public override {
        super.setUp();
        hook.setRouter(address(this));
    }

    function test_ZeroCollateral_Reverts() public {
        bytes memory data = abi.encode(true, uint8(3), address(this));
        vm.prank(address(manager));
        vm.expectRevert();
        beforeSwap(address(this), key, true, 0, data);
    }

    function test_MinLeverage_Works() public {
        bytes memory data = abi.encode(true, uint8(1), address(this));
        vm.prank(address(manager));
        beforeSwap(address(this), key, true, -100 ether, data);
        vm.prank(address(manager));
        afterSwap(address(this), key, true, -200 ether, -200 ether, 190 ether, data);
        (, uint256 c, , uint8 l, , , , , ) = hook.positions(key.toId(), address(this));
        assertTrue(c > 0);
        assertEq(l, 1);
    }

    function test_MaxLeverage_Reverts() public {
        bytes memory data = abi.encode(true, uint8(11), address(this));
        vm.prank(address(manager));
        vm.expectRevert();
        beforeSwap(address(this), key, true, -100 ether, data);
    }

    function test_ZeroLeverage_Reverts() public {
        bytes memory data = abi.encode(true, uint8(0), address(this));
        vm.prank(address(manager));
        vm.expectRevert();
        beforeSwap(address(this), key, true, -100 ether, data);
    }

    function test_EmptyData_BehavesAsNormalSwap() public {
        bytes memory data = "";
        vm.prank(address(manager));
        beforeSwap(address(this), key, true, -100 ether, data);
    }
}
