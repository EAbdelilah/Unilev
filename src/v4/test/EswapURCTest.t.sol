// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BaseV4Test} from "./BaseV4Test.t.sol";
import {IURC4} from "../interfaces/IURC4.sol";
import {PoolId} from "../types/PoolId.sol";

contract EswapURCTest is BaseV4Test {
    event HookSwap(
        PoolId indexed id,
        address indexed sender,
        int128 amount0,
        int128 amount1,
        uint24 swapFee
    );

    function test_URC4_IndicativeQuote() public {
        int128 margin = -10 ether;
        IURC4.IndicativeQuote memory quote = hook.getIndicativeQuote(key, true, margin, "");

        assertTrue(quote.liveness);
        assertEq(quote.amountOut, margin * 5); // 5x leverage simulation
        assertEq(quote.gasEstimate, 350000);
    }

    function test_URC3_TVLReporting() public {
        // Initial TVL should be 0
        assertEq(hook.getHookTVL(key.currency1), 0);

        // Perform a margin swap to increase TVL
        vm.prank(address(this));
        hook.beforeSwap(address(this), key, true, -100 ether, abi.encode(true, 5));
        hook.afterSwap(address(this), key, true, -500 ether, 100 ether, -450 ether, "");

        // TVL should now reflect the collateral held
        assertEq(hook.getHookTVL(key.currency1), 450 ether);
    }

    function test_URC2_HookSwapEvent() public {
        vm.expectEmit(true, true, false, true);
        emit HookSwap(key.toId(), address(this), 100 ether, -450 ether, 0);

        vm.prank(address(this));
        hook.beforeSwap(address(this), key, true, -100 ether, abi.encode(true, 5));
        hook.afterSwap(address(this), key, true, -500 ether, 100 ether, -450 ether, "");
    }
}
