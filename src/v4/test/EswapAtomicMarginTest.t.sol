// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BaseV4Test, PriceFeedMock, ERC20Mock} from "./BaseV4Test.t.sol";
import {PoolManagerCallbackMock} from "./mocks/PoolManagerMock.sol";
import {EswapMarginHook} from "../EswapMarginHook.sol";
import {EswapRouter} from "../EswapRouter.sol";
import {PoolKey} from "../types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "../types/PoolId.sol";
import {Currency} from "../types/Currency.sol";
import {IPoolManager} from "../interfaces/IPoolManager.sol";
import {BalanceDelta, BalanceDeltaLibrary} from "../types/BalanceDelta.sol";

contract EswapAtomicMarginTestManager is PoolManagerCallbackMock {
    BalanceDelta[] public nextDeltas;
    uint256 public nextDeltaIndex;

    function pushNextSwapDelta(int128 delta0, int128 delta1) external {
        nextDeltas.push(BalanceDeltaLibrary.toBalanceDelta(delta0, delta1));
    }

    function clearSwapDeltas() external {
        delete nextDeltas;
        nextDeltaIndex = 0;
    }

    function swap(PoolKey calldata key, IPoolManager.SwapParams calldata params, bytes calldata hookData)
        external
        override
        returns (BalanceDelta delta)
    {
        swapCalls.push(
            SwapCall({
                key: key,
                zeroForOne: params.zeroForOne,
                amountSpecified: int128(params.amountSpecified),
                hookData: hookData
            })
        );
        if (nextDeltaIndex < nextDeltas.length) {
            delta = nextDeltas[nextDeltaIndex];
            nextDeltaIndex++;
            return delta;
        }

        uint256 absIn = uint256(int256(params.amountSpecified < 0 ? -params.amountSpecified : params.amountSpecified));
        int128 output = int128(uint128((absIn * 96) / 100));
        int128 input = -int128(uint128(absIn));
        if (params.zeroForOne) {
            delta = BalanceDeltaLibrary.toBalanceDelta(input, output);
        } else {
            delta = BalanceDeltaLibrary.toBalanceDelta(output, input);
        }
    }
}

contract EswapAtomicMarginTest is BaseV4Test {
    using PoolIdLibrary for PoolKey;

    EswapRouter public router;
    PoolKey public standardPoolKey;
    EswapAtomicMarginTestManager public atomicManager;

    function setUp() public override {
        // Create custom callback manager to simulate multi-swap atomic execution outputs
        atomicManager = new EswapAtomicMarginTestManager();
        priceFeed = new PriceFeedMock();

        token0 = new ERC20Mock("Token 0", "TK0");
        token1 = new ERC20Mock("Token 1", "TK1");

        address hookAddress = address(uint160((1 << 159) | (1 << 158) | (1 << 153) | (1 << 152) | (1 << 148)));
        deployCodeTo(
            "EswapMarginHook.sol:EswapMarginHook", abi.encode(atomicManager, priceFeed, address(this)), hookAddress
        );
        hook = EswapMarginHook(payable(hookAddress));

        router = new EswapRouter(atomicManager);

        key = PoolKey({
            currency0: Currency.wrap(address(token0)),
            currency1: Currency.wrap(address(token1)),
            fee: 3000,
            tickSpacing: 60,
            hooks: address(hook)
        });

        standardPoolKey =
            PoolKey({currency0: key.currency0, currency1: key.currency1, fee: 0, tickSpacing: 60, hooks: address(0)});

        hook.setRouterAndMinCollateralUsd(address(router), 0);
        hook.setAuthorizedPool(key.toId(), true);

        atomicManager.setSlot0(key.toId(), 1 << 96, 0);
        atomicManager.setSlot0(standardPoolKey.toId(), 1 << 96, 0);

        // Pre-fund the mock PoolManager balances with mock tokens so transfer calls do not revert
        token0.mint(address(atomicManager), 10000 ether);
        token1.mint(address(atomicManager), 10000 ether);
    }

    function test_AtomicMarginTrade_Profitable_5xLeverage() public {
        address trader = address(0xABC);
        uint256 borrowAmount = 10 ether; // 5x leverage on a 2 ether trade equivalent with 0 upfront capital

        // Leg 1 (Standard Pool): Swapping 10 ether of token0 -> returns 12 ether of token1
        atomicManager.pushNextSwapDelta(-10 ether, 12 ether);
        // Leg 2 (Hook Pool): Swapping 12 ether of token1 back -> returns 13 ether of token0
        atomicManager.pushNextSwapDelta(13 ether, -12 ether);

        // Pre-fund the router and hook with token0/token1 for intermediate transfers
        token0.mint(address(router), 1000 ether);
        token1.mint(address(router), 1000 ether);
        token0.mint(address(hook), 1000 ether);
        token1.mint(address(hook), 1000 ether);

        EswapRouter.AtomicMarginParams memory params = EswapRouter.AtomicMarginParams({
            key: key, standardPoolKey: standardPoolKey, zeroForOne: true, borrowAmount: borrowAmount, minProfit: 1 ether
        });

        uint256 balanceBefore = token0.balanceOf(trader);

        vm.prank(trader);
        uint256 profit = router.atomicMarginTrade(params);

        uint256 balanceAfter = token0.balanceOf(trader);

        // Trader started with 0 capital, ended with exactly 3 ether profit!
        assertEq(profit, 3 ether);
        assertEq(balanceAfter - balanceBefore, 3 ether);
    }

    function test_AtomicMarginTrade_Profitable_10xLeverage() public {
        address trader = address(0xDEF);
        uint256 borrowAmount = 100 ether; // 10x leverage on a 10 ether trade equivalent with 0 upfront capital

        // Leg 1 (Standard Pool): Swapping 100 ether of token0 -> returns 120 ether of token1
        atomicManager.pushNextSwapDelta(-100 ether, 120 ether);
        // Leg 2 (Hook Pool): Swapping 120 ether of token1 back -> returns 135 ether of token0
        atomicManager.pushNextSwapDelta(135 ether, -120 ether);

        // Pre-fund router/hook
        token0.mint(address(router), 1000 ether);
        token1.mint(address(router), 1000 ether);
        token0.mint(address(hook), 1000 ether);
        token1.mint(address(hook), 1000 ether);

        EswapRouter.AtomicMarginParams memory params = EswapRouter.AtomicMarginParams({
            key: key, standardPoolKey: standardPoolKey, zeroForOne: true, borrowAmount: borrowAmount, minProfit: 5 ether
        });

        uint256 balanceBefore = token0.balanceOf(trader);

        vm.prank(trader);
        uint256 profit = router.atomicMarginTrade(params);

        uint256 balanceAfter = token0.balanceOf(trader);

        // Trader ended with exactly 35 ether profit with absolutely 0 capital!
        assertEq(profit, 35 ether);
        assertEq(balanceAfter - balanceBefore, 35 ether);
    }

    function test_AtomicMarginTrade_RevertsWhenUnprofitable() public {
        address trader = address(0x999);
        uint256 borrowAmount = 10 ether;

        // Leg 1 (Standard Pool): Swapping 10 ether of token0 -> returns 11 ether of token1
        atomicManager.pushNextSwapDelta(-10 ether, 11 ether);
        // Leg 2 (Hook Pool): Swapping 11 ether of token1 back -> only returns 9.5 ether of token0 (unprofitable)
        atomicManager.pushNextSwapDelta(9.5 ether, -11 ether);

        // Pre-fund router/hook
        token0.mint(address(router), 1000 ether);
        token1.mint(address(router), 1000 ether);
        token0.mint(address(hook), 1000 ether);
        token1.mint(address(hook), 1000 ether);

        EswapRouter.AtomicMarginParams memory params = EswapRouter.AtomicMarginParams({
            key: key,
            standardPoolKey: standardPoolKey,
            zeroForOne: true,
            borrowAmount: borrowAmount,
            minProfit: 0.1 ether
        });

        // The transaction must revert to fully protect the trader from any loss or balance reduction
        vm.prank(trader);
        vm.expectRevert("Atomic margin trade unprofitable");
        router.atomicMarginTrade(params);
    }
}
