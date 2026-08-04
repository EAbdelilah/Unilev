// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BaseV4Test} from "./BaseV4Test.t.sol";
import {PoolKey} from "../types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "../types/PoolId.sol";
import {IPoolManager} from "../interfaces/IPoolManager.sol";
import {BalanceDeltaLibrary} from "../types/BalanceDelta.sol";

contract EswapEdgeCaseTest is BaseV4Test {
    using PoolIdLibrary for PoolKey;

    function setUp() public override {
        super.setUp();
        hook.setRouter(address(this));
    }

    function test_ZeroCollateral_Reverts() public {
        bytes memory data = abi.encode(true, uint8(3), address(this));
        vm.prank(address(manager));
        vm.expectRevert();
        hook.beforeSwap(address(this), key, IPoolManager.SwapParams(true, 0, 0), data);
    }

    function test_MinLeverage_Works() public {
        bytes memory data = abi.encode(true, uint8(1), address(this));
        vm.prank(address(manager));
        hook.beforeSwap(address(this), key, IPoolManager.SwapParams(true, -100 ether, 0), data);
        vm.prank(address(manager));
        hook.afterSwap(address(this), key, IPoolManager.SwapParams(true, -200 ether, 0), BalanceDeltaLibrary.toBalanceDelta(200 ether, 190 ether), data);
        (, uint256 c, , uint8 l, , , , , ) = hook.positions(key.toId(), address(this));
        assertTrue(c > 0);
        assertEq(l, 1);
    }

    function test_MaxLeverage_Reverts() public {
        bytes memory data = abi.encode(true, uint8(11), address(this));
        vm.prank(address(manager));
        vm.expectRevert();
        hook.beforeSwap(address(this), key, IPoolManager.SwapParams(true, -100 ether, 0), data);
    }

    function test_ZeroLeverage_Reverts() public {
        bytes memory data = abi.encode(true, uint8(0), address(this));
        vm.prank(address(manager));
        vm.expectRevert();
        hook.beforeSwap(address(this), key, IPoolManager.SwapParams(true, -100 ether, 0), data);
    }

    function test_EmptyData_BehavesAsNormalSwap() public {
        bytes memory data = "";
        vm.prank(address(manager));
        hook.beforeSwap(address(this), key, IPoolManager.SwapParams(true, -100 ether, 0), data);
    }
}
