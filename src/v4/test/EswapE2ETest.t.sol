// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BaseV4Test} from "./BaseV4Test.t.sol";
import {BeforeSwapDelta} from "../types/BeforeSwapDelta.sol";
import {Currency} from "../types/Currency.sol";
import {PoolId, PoolIdLibrary} from "../types/PoolId.sol";
import {PoolKey} from "../types/PoolKey.sol";
import {IPoolManager} from "../interfaces/IPoolManager.sol";
import {BalanceDeltaLibrary} from "../types/BalanceDelta.sol";

contract EswapE2ETest is BaseV4Test {
    using PoolIdLibrary for PoolKey;

    function test_EndToEnd_MarginTrade_Success() public {
        uint8 leverage = 5;
        int128 margin = -100 ether;
        bytes memory data = abi.encode(true, leverage, address(this));

        // 1. Set Router
        hook.setRouterAndMinCollateralUsd(address(this), 0);

        // 2. BeforeSwap Trigger
        vm.prank(address(manager));
        hook.beforeSwap(address(this), key, IPoolManager.SwapParams(true, margin, 0), data);

        // 3. AfterSwap Trigger
        vm.startPrank(address(manager));
        hook.afterSwap(
            address(this),
            key,
            IPoolManager.SwapParams(true, -500 ether, 0),
            BalanceDeltaLibrary.toBalanceDelta(-500 ether, 480 ether),
            data
        );
        vm.stopPrank();

        // 4. Deploy Collateral (Called by Router/this)
        hook.deployCollateral(key, address(this));

        // 5. Verify Position
        (address trader, uint256 collateral,,,,,,, uint128 liq) = hook.positions(key.toId(), address(this));
        assertEq(trader, address(this));
        // positionCollateral = 480 ether * 9950/10000 (0.5% fee deducted)
        assertEq(collateral, (480 ether * 9950) / 10000);
        assertTrue(liq > 0);
    }
}
