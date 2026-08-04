// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BaseV4Test} from "./BaseV4Test.t.sol";
import {PoolKey} from "../types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "../types/PoolId.sol";
import {IPoolManager} from "../interfaces/IPoolManager.sol";
import {BalanceDeltaLibrary} from "../types/BalanceDelta.sol";

contract EswapLiquidationTest is BaseV4Test {
    using PoolIdLibrary for PoolKey;

    function test_TruncatedOracle_PriceCapping() public {
        priceFeed.setPrice(address(token0), 1e18);
        priceFeed.setPrice(address(token1), 1e18);

        // Set a real sqrtPriceX96 so lastOraclePrice gets recorded
        uint160 sqrtP = 79228162514264337593543950336; // Q96 = 1.0 price
        manager.setSlot0(key.toId(), sqrtP, 0);

        bytes memory data = abi.encode(true, uint8(5), address(this));
        vm.prank(address(manager));
        hook.beforeSwap(address(this), key, IPoolManager.SwapParams(true, -10 ether, 0), data);

        vm.prank(address(manager));
        hook.afterSwap(address(this), key, IPoolManager.SwapParams(true, -50 ether, 0), BalanceDeltaLibrary.toBalanceDelta(-50 ether, 48 ether), data);

        // Verify initial price saved
        assertGt(hook.lastOraclePrice(key.toId()), 0);
    }
}
