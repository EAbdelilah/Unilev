// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BaseV4Test} from "./BaseV4Test.t.sol";
import {PoolKey} from "../types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "../types/PoolId.sol";

contract EswapTransientTest is BaseV4Test {
    using PoolIdLibrary for PoolKey;

    function setUp() public override {
        super.setUp();
        hook.setRouter(address(this));
    }

    function test_DeltaSettlement_ZeroBalance() public {
        bytes memory data = abi.encode(true, uint8(2), address(this));
        vm.prank(address(manager));
        hook.beforeSwap(address(this), key, true, -1 ether, data);

        vm.prank(address(manager));
        hook.afterSwap(address(this), key, true, -2 ether, 2 ether, -1.9 ether, data);

        assertEq(hook.getTransientLockState(), 0);
    }

    function test_TStore_ClearedAfterAfterSwap() public {
        bytes memory data = abi.encode(true, uint8(4), address(this));
        vm.prank(address(manager));
        hook.beforeSwap(address(this), key, true, -1 ether, data);

        vm.prank(address(manager));
        hook.afterSwap(address(this), key, true, -4 ether, 4 ether, -3.8 ether, data);

        assertEq(hook.getTransientLockState(), 0);
    }

    function test_Reentrancy_BeforeSwap_Reverts() public {
        bytes memory data = abi.encode(true, uint8(2), address(this));
        vm.startPrank(address(manager));
        hook.beforeSwap(address(this), key, true, -1 ether, data);

        vm.expectRevert();
        hook.beforeSwap(address(this), key, true, -1 ether, data);
        vm.stopPrank();
    }
}
