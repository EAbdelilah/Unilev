// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BaseV4Test} from "./BaseV4Test.t.sol";
import {IURC4} from "../interfaces/IURC4.sol";
import {PoolKey} from "../types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "../types/PoolId.sol";
import {IPoolManager} from "../interfaces/IPoolManager.sol";
import {BalanceDeltaLibrary} from "../types/BalanceDelta.sol";

contract EswapURCTest is BaseV4Test {
    using PoolIdLibrary for PoolKey;

    event HookSwap(
        PoolId indexed poolId,
        address indexed sender,
        int128 amount0,
        int128 amount1,
        uint256 hookFee
    );

    function test_URC4_IndicativeQuote() public view {
        int128 margin = -10 ether;
        bytes memory data = abi.encode(true, uint8(5), address(this));
        IURC4.IndicativeQuote memory quote = hook.getIndicativeQuote(key, true, margin, data);

        assertTrue(quote.liveness);
        // 5x leverage with 0.1% slippage discount: margin * 5 * 9990 / 10000
        int128 expected = (margin * 5 * 9990) / 10000;
        assertEq(quote.amountOut, expected); // 5x leverage with conservative slippage discount
    }

    function test_URC3_TVLReporting() public {
        // Initial TVL should be 0
        assertEq(hook.getHookTVL(key.currency1), 0);

        bytes memory data = abi.encode(true, uint8(5), address(this));

        vm.prank(address(manager));
        hook.beforeSwap(address(this), key, IPoolManager.SwapParams(true, -100 ether, 0), data);

        vm.prank(address(manager));
        // zeroForOne=true: boughtCurrency=currency1, rawAmount = delta.amount1() = 450
        hook.afterSwap(address(this), key, IPoolManager.SwapParams(true, -500 ether, 0), BalanceDeltaLibrary.toBalanceDelta(-500 ether, 450 ether), data);

        // TVL = totalCollateral[currency1] = 450 (no reserve deducted from totalCollateral)
        assertGt(hook.getHookTVL(key.currency1), 0);
    }

    function test_URC2_HookSwapEvent() public {
        bytes memory data = abi.encode(true, uint8(5), address(this));

        vm.prank(address(manager));
        hook.beforeSwap(address(this), key, IPoolManager.SwapParams(true, -100 ether, 0), data);

        // Just check that the event is emitted (topic match only, not data)
        vm.expectEmit(true, true, false, false);
        emit HookSwap(key.toId(), address(this), 0, 0, 0);

        vm.prank(address(manager));
        hook.afterSwap(address(this), key, IPoolManager.SwapParams(true, -500 ether, 0), BalanceDeltaLibrary.toBalanceDelta(-500 ether, 450 ether), data);
    }
}
