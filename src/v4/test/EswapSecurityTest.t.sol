// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BaseV4Test} from "./BaseV4Test.t.sol";
import {BeforeSwapDelta} from "../types/BeforeSwapDelta.sol";

contract EswapSecurityTest is BaseV4Test {
    function test_DirectHookCall_Reverts() public {
        // Attempt to call beforeSwap directly (not from manager)
        vm.expectRevert();
        hook.beforeSwap(address(this), key, true, -10 ether, abi.encode(true, 5));
    }

    function test_UnauthorizedPool_Reverts() public {
        // PoolKey with random data (not authorized)
        key.fee = 100;

        vm.prank(address(manager));
        vm.expectRevert();
        hook.beforeSwap(address(this), key, true, -10 ether, abi.encode(true, 5));
    }

    function test_ERC6909_BalanceCheck() public {
        // Setup initial state via manager
        vm.startPrank(address(manager));
        hook.beforeSwap(address(this), key, true, -100 ether, abi.encode(true, 5));
        // Simulate delta settlement and collateral mapping
        hook.afterSwap(address(this), key, true, -500 ether, 500 ether, -480 ether, "");
        vm.stopPrank();

        uint256 claimId = uint256(uint160(address(0x2))); // currency1
        assertEq(hook.balanceOf(address(this), claimId), 480 ether);

        // bob attempts to transfer alice's funds
        address bob = address(0xBAD);
        vm.prank(bob);
        vm.expectRevert();
        hook.transferFrom(address(this), bob, claimId, 100 ether);
    }
}
