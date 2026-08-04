// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BaseV4Test} from "./BaseV4Test.t.sol";
import {BeforeSwapDelta} from "../types/BeforeSwapDelta.sol";
import {Currency} from "../types/Currency.sol";
import {IHooks} from "../interfaces/IHooks.sol";
import {IPoolManager} from "../interfaces/IPoolManager.sol";

contract EswapMarginPositionTest is BaseV4Test {
    function test_OpenLongPosition_Success() public {
        uint8 leverage = 5;
        int128 marginAmount = -100 ether;
        bytes memory data = abi.encode(true, leverage, address(this));

        vm.prank(address(manager));
        (bytes4 selector, BeforeSwapDelta delta, ) = hook.beforeSwap(
            address(this),
            key,
            IPoolManager.SwapParams(true, marginAmount, 0),
            data
        );

        assertEq(selector, IHooks.beforeSwap.selector);

        int256 deltaValue = BeforeSwapDelta.unwrap(delta);
        int128 delta0 = int128(deltaValue >> 128);
        assertEq(delta0, -400 ether); // margin * (5 - 1)
    }

    function test_OpenShortPosition_Success() public {
        uint8 leverage = 3;
        int128 marginAmount = -50 ether;
        bytes memory data = abi.encode(true, leverage, address(this));

        vm.prank(address(manager));
        (bytes4 selector, BeforeSwapDelta delta, ) = hook.beforeSwap(
            address(this),
            key,
            IPoolManager.SwapParams(false, marginAmount, 0), // zeroForOne = false for short (selling currency1)
            data
        );

        assertEq(selector, IHooks.beforeSwap.selector);

        // Real v4-core BeforeSwapDelta packs (specified, unspecified): the upper
        // 128 bits hold the delta on the swap's input leg. For a short
        // (zeroForOne = false, selling currency1) the flash borrow is supplied on
        // that input leg, so the upper (specified) half carries the borrow.
        int256 deltaValue = BeforeSwapDelta.unwrap(delta);
        int128 specified = int128(deltaValue >> 128);
        assertEq(specified, -100 ether); // margin * (3 - 1)
    }

    function test_NormalSwap_ReturnsZeroDelta() public {
        int128 amount = -10 ether;
        bytes memory data = ""; // No margin data

        vm.prank(address(manager));
        (bytes4 selector, BeforeSwapDelta delta, ) = hook.beforeSwap(
            address(this),
            key,
            IPoolManager.SwapParams(true, amount, 0),
            data
        );

        assertEq(selector, IHooks.beforeSwap.selector);
        assertEq(BeforeSwapDelta.unwrap(delta), 0);
    }
}
