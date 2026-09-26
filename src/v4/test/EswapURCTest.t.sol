// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BaseV4Test} from "./BaseV4Test.t.sol";
import {Vm} from "forge-std/Vm.sol";
import {IURC4} from "../interfaces/IURC4.sol";
import {PoolKey} from "../types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "../types/PoolId.sol";
import {IPoolManager} from "../interfaces/IPoolManager.sol";
import {BalanceDeltaLibrary} from "../types/BalanceDelta.sol";

contract EswapURCTest is BaseV4Test {
    using PoolIdLibrary for PoolKey;

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
        hook.afterSwap(
            address(this),
            key,
            IPoolManager.SwapParams(true, -500 ether, 0),
            BalanceDeltaLibrary.toBalanceDelta(-500 ether, 450 ether),
            data
        );

        // TVL = totalCollateral[currency1] = 450 (no reserve deducted from totalCollateral)
        assertGt(hook.getHookTVL(key.currency1), 0);
    }

    function test_URC2_HookSwapEvent() public {
        bytes memory data = abi.encode(true, uint8(5), address(this));

        vm.prank(address(manager));
        hook.beforeSwap(address(this), key, IPoolManager.SwapParams(true, -100 ether, 0), data);

        // Verify topic0 (event signature), topic1 (poolId) and topic2 (trader,
        // the first data param decoded from `data`) of the HookSwap log. Using
        // recordLogs rather than expectEmit because afterSwap is now routed as
        // a delegatecall through EswapMarginHookLogic2, which Foundry's
        // expectEmit comparator treats inconsistently across versions.
        vm.prank(address(manager));
        vm.recordLogs();
        hook.afterSwap(
            address(this),
            key,
            IPoolManager.SwapParams(true, -500 ether, 0),
            BalanceDeltaLibrary.toBalanceDelta(-500 ether, 450 ether),
            data
        );
        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertEq(logs.length, 1, "expected exactly one HookSwap log");
        assertEq(
            logs[0].topics[0],
            keccak256("HookSwap(bytes32,address,int128,int128,uint128)"),
            "topic0 must be the HookSwap signature"
        );
        assertEq(logs[0].topics[1], PoolId.unwrap(key.toId()), "poolId topic");
        assertEq(logs[0].topics[2], bytes32(uint256(uint160(address(this)))), "trader topic");
    }
}
