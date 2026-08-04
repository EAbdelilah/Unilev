// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BaseV4Test} from "./BaseV4Test.t.sol";
import {Currency} from "../types/Currency.sol";
import {PoolKey} from "../types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "../types/PoolId.sol";
import {IPoolManager} from "../interfaces/IPoolManager.sol";
import {BalanceDeltaLibrary} from "../types/BalanceDelta.sol";

contract EswapRebalanceTest is BaseV4Test {
    using PoolIdLibrary for PoolKey;

    function test_AutomatedRebalancing() public {
        address trader = address(0xABC);

        // 1. Open Position
        bytes memory data = abi.encode(true, 5, trader);
        manager.setSlot0(key.toId(), 1 << 96, 0); // Price 1.0, Tick 0

        vm.prank(address(manager));
        hook.beforeSwap(address(0), key, IPoolManager.SwapParams(true, -1 ether, 0), data);

        vm.prank(address(manager));
        hook.afterSwap(address(0), key, IPoolManager.SwapParams(true, -1 ether, 0), BalanceDeltaLibrary.toBalanceDelta(1 ether, 1 ether), data);

        // 2. Price moves out of range (Tick 0 -> Tick 200)
        manager.setSlot0(key.toId(), 2 << 96, 200);

        // 3. Trigger rebalance
        hook.rebalancePosition(key, trader);

        (,,,,,,int24 newTickLower, int24 newTickUpper,) = hook.positions(key.toId(), trader);
        // Center around 200 (tickSpacing 60): 180 - 60 = 120, 180 + 60 = 240
        assertEq(newTickLower, 120);
        assertEq(newTickUpper, 240);
    }
}
