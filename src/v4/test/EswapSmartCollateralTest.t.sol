// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BaseV4Test} from "./BaseV4Test.t.sol";
import {BeforeSwapDelta} from "../types/BeforeSwapDelta.sol";
import {Currency} from "../types/Currency.sol";
import {PoolKey} from "../types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "../types/PoolId.sol";

contract EswapSmartCollateralTest is BaseV4Test {
    using PoolIdLibrary for PoolKey;

    function setUp() public override {
        super.setUp();
        hook.setRouter(address(this));
    }

    function test_SmartCollateral_Rehypothecation() public {
        uint8 leverage = 5;
        bytes memory data = abi.encode(true, leverage, address(this));

        vm.startPrank(address(manager));
        hook.beforeSwap(address(this), key, true, -100 ether, data);

        hook.afterSwap(
            address(this),
            key,
            true,
            -500 ether,
            500 ether,
            -480 ether,
            data
        );
        vm.stopPrank();

        hook.deployCollateral(key, address(this));

        // Verify position recording
        (address trader, uint256 collateral, uint256 borrow, uint8 lev, bool isLong,, int24 tickLower, int24 tickUpper, uint128 liquidity) = hook.positions(key.toId(), address(this));

        assertEq(trader, address(this));
        assertEq(collateral, 480 ether);
        assertEq(borrow, 400 ether); // 100 * (5-1)
        assertEq(lev, 5);
        assertFalse(isLong);
        assertEq(tickLower, -60);
        assertEq(tickUpper, 60);
        assertTrue(liquidity > 0);

        // Verify manager call
        (,int24 callTickLower, int24 callTickUpper, int128 callLiquidityDelta) = manager.modifyLiquidityCalls(0);
        assertEq(callTickLower, -60);
        assertEq(callTickUpper, 60);
        assertTrue(callLiquidityDelta > 0);
    }
}
