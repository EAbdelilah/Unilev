// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BaseV4Test} from "./BaseV4Test.t.sol";
import {BeforeSwapDelta} from "../types/BeforeSwapDelta.sol";
import {Currency} from "../types/Currency.sol";
import {PoolKey} from "../types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "../types/PoolId.sol";
import {IPoolManager} from "../interfaces/IPoolManager.sol";
import {BalanceDeltaLibrary} from "../types/BalanceDelta.sol";

contract EswapLogicTest is BaseV4Test {
    using PoolIdLibrary for PoolKey;

    function test_Trade_1x_Long() public {
        uint8 leverage = 1;
        int128 margin = -10 ether;
        bytes memory data = abi.encode(true, leverage, address(this));

        vm.prank(address(manager));
        hook.beforeSwap(address(this), key, IPoolManager.SwapParams(true, margin, 0), data);

        vm.startPrank(address(manager));
        hook.afterSwap(
            address(this),
            key,
            IPoolManager.SwapParams(true, -10 ether, 0),
            BalanceDeltaLibrary.toBalanceDelta(-10 ether, 9.5 ether),
            data
        );
        vm.stopPrank();

        (address trader, uint256 collateral, uint256 borrow, uint8 lev,,,,,) = hook.positions(key.toId(), address(this));
        assertEq(trader, address(this));
        // positionCollateral = boughtAmount * (1 - 0.5% fee) = 9.5 ether * 9950/10000
        assertEq(collateral, (9.5 ether * 9950) / 10000);
        assertEq(borrow, 0);
        assertEq(lev, 1);
    }

    function test_Trade_5x_Short() public {
        uint8 leverage = 5;
        int128 margin = -10 ether;
        bytes memory data = abi.encode(true, leverage, address(this));

        vm.prank(address(manager));
        hook.beforeSwap(address(this), key, IPoolManager.SwapParams(false, margin, 0), data);

        vm.startPrank(address(manager));
        hook.afterSwap(
            address(this),
            key,
            IPoolManager.SwapParams(false, -50 ether, 0),
            BalanceDeltaLibrary.toBalanceDelta(48 ether, -50 ether),
            data
        );
        vm.stopPrank();

        (address trader, uint256 collateral, uint256 borrow, uint8 lev,,,,,) = hook.positions(key.toId(), address(this));
        assertEq(trader, address(this));
        // positionCollateral = boughtAmount * (1 - 0.5% fee) = 48 ether * 9950/10000
        assertEq(collateral, (48 ether * 9950) / 10000);
        assertEq(borrow, 40 ether);
        assertEq(lev, 5);
    }
}
