// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BaseV4Test} from "./BaseV4Test.t.sol";
import {BeforeSwapDelta} from "../types/BeforeSwapDelta.sol";
import {Currency} from "../types/Currency.sol";
import {IHooks} from "../interfaces/IHooks.sol";

contract EswapMarginPositionTest is BaseV4Test {
    function test_OpenLongPosition_Success() public {
        uint8 leverage = 5;
        int128 marginAmount = -100 ether;
        bytes memory data = abi.encode(true, leverage);

        vm.prank(address(manager));
        (bytes4 selector, BeforeSwapDelta delta, ) = hook.beforeSwap(
            address(this),
            key,
            true, // zeroForOne
            marginAmount,
            data
        );

        assertEq(selector, IHooks.beforeSwap.selector);

        int256 deltaValue = BeforeSwapDelta.unwrap(delta);
        int128 delta0 = int128(deltaValue >> 128);
        assertEq(delta0, 500 ether); // 100 * 5
    }

    function test_OpenShortPosition_Success() public {
        uint8 leverage = 3;
        int128 marginAmount = -50 ether;
        bytes memory data = abi.encode(true, leverage);

        vm.prank(address(manager));
        (bytes4 selector, BeforeSwapDelta delta, ) = hook.beforeSwap(
            address(this),
            key,
            false, // zeroForOne = false for short (selling currency1)
            marginAmount,
            data
        );

        assertEq(selector, IHooks.beforeSwap.selector);

        int256 deltaValue = BeforeSwapDelta.unwrap(delta);
        int128 delta1 = int128(deltaValue);
        assertEq(delta1, 150 ether); // 50 * 3
    }

    function test_NormalSwap_ReturnsZeroDelta() public {
        int128 amount = -10 ether;
        bytes memory data = ""; // No margin data

        vm.prank(address(manager));
        (bytes4 selector, BeforeSwapDelta delta, ) = hook.beforeSwap(
            address(this),
            key,
            true,
            amount,
            data
        );

        assertEq(selector, IHooks.beforeSwap.selector);
        assertEq(BeforeSwapDelta.unwrap(delta), 0);
    }
}
