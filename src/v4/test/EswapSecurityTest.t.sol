// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BaseV4Test} from "./BaseV4Test.t.sol";
import {BeforeSwapDelta} from "../types/BeforeSwapDelta.sol";
import {IPoolManager} from "../interfaces/IPoolManager.sol";
import {BalanceDeltaLibrary} from "../types/BalanceDelta.sol";

contract EswapSecurityTest is BaseV4Test {
    function test_DirectHookCall_Reverts() public {
        // Attempt to call beforeSwap directly (not from manager)
        vm.expectRevert();
        hook.beforeSwap(
            address(this), key, IPoolManager.SwapParams(true, -10 ether, 0), abi.encode(true, uint8(5), address(this))
        );
    }

    function test_UnauthorizedPool_Reverts() public {
        // PoolKey with random data (not authorized)
        key.fee = 100;

        vm.prank(address(manager));
        vm.expectRevert();
        hook.beforeSwap(
            address(this), key, IPoolManager.SwapParams(true, -10 ether, 0), abi.encode(true, uint8(5), address(this))
        );
    }

    function test_ERC6909_BalanceCheck() public {
        bytes memory data = abi.encode(true, uint8(5), address(this));

        // Setup initial state via manager
        vm.startPrank(address(manager));
        hook.beforeSwap(address(this), key, IPoolManager.SwapParams(true, -100 ether, 0), data);
        // Simulate delta settlement and collateral mapping
        hook.afterSwap(
            address(this),
            key,
            IPoolManager.SwapParams(true, -500 ether, 0),
            BalanceDeltaLibrary.toBalanceDelta(-500 ether, 480 ether),
            data
        );
        vm.stopPrank();

        uint256 claimId = uint256(uint160(address(token1)));
        assertEq(hook._claimBalances(address(this), claimId), 477.6 ether);

        // bob attempts to transfer alice's funds
        address bob = address(0xBAD);
        vm.prank(bob);
        vm.expectRevert();
        hook.transferFrom(address(this), bob, claimId, 100 ether);
    }
}
