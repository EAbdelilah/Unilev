// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BaseV4Test} from "./BaseV4Test.t.sol";
import {BeforeSwapDelta} from "../types/BeforeSwapDelta.sol";
import {PoolKey} from "../types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "../types/PoolId.sol";

contract EswapLeverageTest is BaseV4Test {
    using PoolIdLibrary for PoolKey;

    function setUp() public override {
        super.setUp();
        hook.setRouter(address(this));
    }

    function test_Leverage_1x_Succeeds() public {
        bytes memory data = abi.encode(true, uint8(1), address(this));
        vm.prank(address(manager));
        hook.beforeSwap(address(this), key, true, -1 ether, data);

        vm.prank(address(manager));
        hook.afterSwap(address(this), key, true, -1 ether, 1 ether, -0.95 ether, data);

        (address trader, uint256 collateral, uint256 borrow, uint8 lev,,,,,) = hook.positions(key.toId(), address(this));
        assertEq(trader, address(this));
        assertEq(borrow, 0);
        assertEq(lev, 1);
        assertTrue(collateral > 0);
    }

    function test_Leverage_2x_Succeeds() public {
        bytes memory data = abi.encode(true, uint8(2), address(this));
        vm.prank(address(manager));
        hook.beforeSwap(address(this), key, true, -1 ether, data);

        vm.prank(address(manager));
        hook.afterSwap(address(this), key, true, -2 ether, 2 ether, -1.9 ether, data);

        (, uint256 collateral, uint256 borrow, uint8 lev,,,,,) = hook.positions(key.toId(), address(this));
        assertEq(borrow, 1 ether);
        assertEq(lev, 2);
        assertTrue(collateral > 0);
    }

    function test_Leverage_5x_Succeeds() public {
        bytes memory data = abi.encode(true, uint8(5), address(this));
        vm.prank(address(manager));
        hook.beforeSwap(address(this), key, true, -1 ether, data);

        vm.prank(address(manager));
        hook.afterSwap(address(this), key, true, -5 ether, 5 ether, -4.8 ether, data);

        (, uint256 collateral, uint256 borrow, uint8 lev,,,,,) = hook.positions(key.toId(), address(this));
        assertEq(borrow, 4 ether);
        assertEq(lev, 5);
        assertTrue(collateral > 0);
    }

    function test_Leverage_10x_Reverts() public {
        bytes memory data = abi.encode(true, uint8(10), address(this));
        vm.prank(address(manager));
        vm.expectRevert();
        hook.beforeSwap(address(this), key, true, -1 ether, data);
    }

    // Boundary test: 6x is the smallest integer above MAX_LEVERAGE (5x)
    // This represents the "5.01x" boundary from the checklist
    function test_Leverage_6x_BoundaryReverts() public {
        bytes memory data = abi.encode(true, uint8(6), address(this));
        vm.prank(address(manager));
        vm.expectRevert(abi.encodeWithSignature("MaxLeverageExceeded()"));
        hook.beforeSwap(address(this), key, true, -1 ether, data);
    }

    function test_MinCollateral_Floor_Reverts() public {
        bytes memory data = abi.encode(true, uint8(2), address(this));
        vm.prank(address(manager));
        vm.expectRevert();
        hook.beforeSwap(address(this), key, true, -0.001 ether, data);
    }

    function test_ERC6909_Backing_ExactWei() public {
        bytes memory data = abi.encode(true, uint8(3), address(this));
        vm.prank(address(manager));
        hook.beforeSwap(address(this), key, true, -1 ether, data);

        vm.prank(address(manager));
        hook.afterSwap(address(this), key, true, -3 ether, 3 ether, -2.8 ether, data);

        uint256 claimId = uint256(uint160(address(token1)));
        assertEq(manager.balanceOf(address(hook), claimId), 2.8 ether);
    }
}
