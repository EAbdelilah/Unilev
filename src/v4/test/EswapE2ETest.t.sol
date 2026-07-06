// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BaseV4Test} from "./BaseV4Test.t.sol";
import {BeforeSwapDelta} from "../types/BeforeSwapDelta.sol";
import {Currency} from "../types/Currency.sol";

contract EswapE2ETest is BaseV4Test {
    function test_EndToEnd_MarginTrade_Success() public {
        uint8 leverage = 5;
        int128 margin = -100 ether;
        bytes memory data = abi.encode(true, leverage);

        // 1. BeforeSwap Trigger
        vm.prank(address(manager));
        hook.beforeSwap(address(this), key, true, margin, data);

        // 2. AfterSwap Trigger (Liquidity deployment)
        vm.startPrank(address(manager));
        hook.afterSwap(address(this), key, true, -500 ether, 500 ether, -480 ether, "");
        vm.stopPrank();

        // 3. Verify Position
        (address trader, uint256 collateral, uint128 liq,,,,bool isLong) = hook.positions(key.toId(), address(this));
        assertEq(trader, address(this));
        assertEq(collateral, 480 ether);
        assertEq(liq, 100 ether * 1e9); // Based on our stub
        assertTrue(isLong);
    }
}
