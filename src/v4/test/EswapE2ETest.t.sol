// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BaseV4Test} from "./BaseV4Test.t.sol";
import {BeforeSwapDelta} from "../types/BeforeSwapDelta.sol";
import {Currency} from "../types/Currency.sol";
import {PoolId, PoolIdLibrary} from "../types/PoolId.sol";
import {PoolKey} from "../types/PoolKey.sol";

contract EswapE2ETest is BaseV4Test {
    using PoolIdLibrary for PoolKey;
    function test_EndToEnd_MarginTrade_Success() public {
        uint8 leverage = 5;
        int128 margin = -100 ether;
        bytes memory data = abi.encode(true, leverage, address(this));

        // 1. Set Router
        hook.setRouter(address(this));

        // 2. BeforeSwap Trigger
        vm.prank(address(manager));
        hook.beforeSwap(address(this), key, true, margin, data);

        // 3. AfterSwap Trigger
        vm.startPrank(address(manager));
        hook.afterSwap(address(this), key, true, -500 ether, 500 ether, -480 ether, data);
        vm.stopPrank();

        // 4. Deploy Collateral (Called by Router/this)
        hook.deployCollateral(key, address(this));

        // 5. Verify Position
        (address trader, uint256 collateral, , , , , , , uint128 liq) = hook.positions(key.toId(), address(this));
        assertEq(trader, address(this));
        assertEq(collateral, 480 ether);
        assertTrue(liq > 0);
    }
}
