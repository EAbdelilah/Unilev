// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BaseV4Test} from "./BaseV4Test.t.sol";
import {BeforeSwapDelta} from "../types/BeforeSwapDelta.sol";
import {Currency} from "../types/Currency.sol";

contract EswapSmartCollateralTest is BaseV4Test {
    function test_SmartCollateral_Rehypothecation() public {
        uint8 leverage = 5;
        bytes memory data = abi.encode(true, leverage);

        vm.startPrank(address(manager));
        hook.beforeSwap(address(this), key, true, -100 ether, data);

        hook.afterSwap(
            address(this),
            key,
            true,
            -500 ether,
            500 ether,
            -480 ether,
            ""
        );
        vm.stopPrank();

        // Verify position recording
        (address trader, uint256 collateral, uint256 borrow, uint8 lev, bool isLong,, int24 tickLower, int24 tickUpper, uint128 liquidity) = hook.positions(key.toId(), address(this));

        assertEq(trader, address(this));
        assertEq(collateral, 480 ether);
        assertEq(borrow, 400 ether); // 100 * (5-1)
        assertEq(lev, 5);
        assertTrue(isLong);
        assertEq(tickLower, -60);
        assertEq(tickUpper, 60);
        assertEq(liquidity, 240 ether); // 480 / 2 based on implementation

        // Verify manager call
        (,, int24 callTickLower, int24 callTickUpper, int128 callLiquidityDelta) = manager.modifyLiquidityCalls(0);
        assertEq(callTickLower, -60);
        assertEq(callTickUpper, 60);
        assertEq(callLiquidityDelta, 240 ether);
    }
}
