// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BaseV4Test} from "./BaseV4Test.t.sol";
import {Currency} from "../types/Currency.sol";
import {PoolKey} from "../types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "../types/PoolId.sol";
import {IPoolManager} from "../interfaces/IPoolManager.sol";
import {BalanceDeltaLibrary} from "../types/BalanceDelta.sol";

contract EswapRebalanceTest is BaseV4Test {
    using PoolIdLibrary for PoolKey;

    function test_AutomatedRebalancing() public {
        address trader = address(0xABC);

        // 1. Open Position
        bytes memory data = abi.encode(true, 5, trader);
        manager.setSlot0(key.toId(), 1 << 96, 0); // Price 1.0, Tick 0

        vm.prank(address(manager));
        hook.beforeSwap(address(this), key, IPoolManager.SwapParams(true, -1 ether, 0), data);

        vm.prank(address(manager));
        hook.afterSwap(
            address(this),
            key,
            IPoolManager.SwapParams(true, -1 ether, 0),
            BalanceDeltaLibrary.toBalanceDelta(1 ether, 1 ether),
            data
        );

        // 2. Price moves out of range (Tick 0 -> Tick 200)
        manager.setSlot0(key.toId(), 2 << 96, 200);

        // 3. Trigger rebalance
        hook.rebalancePosition(key, trader);

        (,,,,,, int24 newTickLower, int24 newTickUpper,) = hook.positions(key.toId(), trader);
        // SHORT collateral (token1): single-sided band BELOW the new price.
        // Tick 200, spacing 60 -> floor grid 180 -> [180 - 600, 180].
        assertEq(newTickLower, -420);
        assertEq(newTickUpper, 180);
    }

    /// @dev [AUDIT FIX] A rebalance must not silently erase collateral the
    ///      position still owns when the LP band returns nothing. The previous
    ///      implementation overwrote `collateralAmount` with the recovered LP
    ///      amount only, leaving the trader's ERC-6909 claim unbacked and
    ///      bricking the position (`collateralAmount == 0` makes close and
    ///      liquidation revert `NoActivePosition` forever).
    function test_Rebalance_PreservesRetainedCollateral_NoBandProceeds() public {
        address trader = address(0xABC);
        bytes memory data = abi.encode(true, 5, trader);

        vm.prank(address(manager));
        hook.beforeSwap(address(this), key, IPoolManager.SwapParams(true, -1 ether, 0), data);

        vm.prank(address(manager));
        hook.afterSwap(
            address(this),
            key,
            IPoolManager.SwapParams(true, -1 ether, 0),
            BalanceDeltaLibrary.toBalanceDelta(1 ether, 1 ether),
            data
        );

        (, uint256 collateralBefore,,,,,,,) = hook.positions(key.toId(), trader);
        assertGt(collateralBefore, 0, "setup: position has no collateral");

        // Collateral is held as a token1 ERC-6909 claim (mock returns no LP deltas).
        uint256 claimId = uint256(uint160(address(token1)));
        uint256 claimBefore = hook._claimBalances(trader, claimId);
        uint256 totalBefore = hook.totalCollateral(Currency.wrap(address(token1)));
        assertGt(claimBefore, 0, "setup: no claim backing");

        // Band consumed (tick 200 is outside the deployment band) while the LP
        // contributes zero proceeds.
        manager.setSlot0(key.toId(), 2 << 96, 200);
        hook.rebalancePosition(key, trader);

        (, uint256 collateralAfter,,,,,,,) = hook.positions(key.toId(), trader);
        assertEq(collateralAfter, collateralBefore, "rebalance erased retained collateral");
        assertEq(hook._claimBalances(trader, claimId), claimBefore, "claim shrank without a realised loss");
        assertEq(hook.totalCollateral(Currency.wrap(address(token1))), totalBefore, "totalCollateral drifted");
    }
}
