// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BaseV4Test} from "./BaseV4Test.t.sol";
import {Currency} from "../types/Currency.sol";

contract EswapRebalanceTest is BaseV4Test {
    function test_AutomatedRebalancing() public {
        address trader = address(0xABC);
        uint256 margin = 1 ether;

        // 1. Open Position
        bytes memory data = abi.encode(true, 5, trader);
        manager.setSlot0(key.toId(), 1 << 96, 0); // Price 1.0, Tick 0

        vm.prank(address(manager));
        hook.beforeSwap(address(0), key, true, -1 ether, data);

        vm.prank(address(manager));
        hook.afterSwap(address(0), key, true, -1 ether, -1 ether, 1 ether, data);

        (,,,,,,int24 tickLower, int24 tickUpper,) = hook.positions(key.toId(), trader);
        assertEq(tickLower, -60);
        assertEq(tickUpper, 60);

        // 2. Price moves out of range (Tick 0 -> Tick 200)
        manager.setSlot0(key.toId(), 2 << 96, 200);

        // 3. Trigger rebalance via a standard (non-margin) swap
        vm.prank(address(manager));
        hook.beforeSwap(address(0), key, true, -0.1 ether, "");

        (,,,,,,int24 newTickLower, int24 newTickUpper,) = hook.positions(key.toId(), trader);
        // Expect new range around 200 (tickSpacing 60) -> (180, 300)
        assertEq(newTickLower, 180);
        assertEq(newTickUpper, 300);
    }
}
