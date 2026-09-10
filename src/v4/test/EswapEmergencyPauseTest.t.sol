// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BaseV4Test, PriceFeedMock, ERC20Mock} from "./BaseV4Test.t.sol";
import {PoolManagerCallbackMock} from "./mocks/PoolManagerMock.sol";
import {EswapMarginHook} from "../EswapMarginHook.sol";
import {EswapRouter} from "../EswapRouter.sol";
import {PoolKey} from "../types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "../types/PoolId.sol";
import {Currency} from "../types/Currency.sol";

contract EswapEmergencyPauseTest is BaseV4Test {
    using PoolIdLibrary for PoolKey;

    EswapRouter public router;
    PoolKey public standardPoolKey;
    address public trader;
    address public solver;

    function setUp() public override {
        manager = new PoolManagerCallbackMock();
        priceFeed = new PriceFeedMock();

        token0 = new ERC20Mock("Token 0", "TK0");
        token1 = new ERC20Mock("Token 1", "TK1");

        address hookAddress = address(uint160((1 << 159) | (1 << 158) | (1 << 153) | (1 << 152) | (1 << 148)));
        deployCodeTo("EswapMarginHook.sol:EswapMarginHook", abi.encode(manager, priceFeed, address(this)), hookAddress);
        hook = EswapMarginHook(payable(hookAddress));

        router = new EswapRouter(manager);

        key = PoolKey({
            currency0: Currency.wrap(address(token0)),
            currency1: Currency.wrap(address(token1)),
            fee: 3000,
            tickSpacing: 60,
            hooks: address(hook)
        });

        standardPoolKey =
            PoolKey({currency0: key.currency0, currency1: key.currency1, fee: 500, tickSpacing: 60, hooks: address(0)});

        hook.setRouterAndMinCollateralUsd(address(router), 0);
        hook.setAuthorizedPool(key.toId(), true);

        manager.setSlot0(key.toId(), 1 << 96, 0);
        manager.setSlot0(standardPoolKey.toId(), 1 << 96, 0);

        trader = makeAddr("trader");
        solver = makeAddr("solver");
        router.setSolverWhitelist(solver, true);
        token0.mint(trader, 100 ether);
        token0.mint(solver, 100 ether);
        token1.mint(address(hook), 100 ether);

        vm.startPrank(trader);
        token0.approve(address(router), type(uint256).max);
        vm.stopPrank();

        vm.startPrank(solver);
        token0.approve(address(router), type(uint256).max);
        vm.stopPrank();
    }

    function test_Pause_BlocksMultiPoolSwap() public {
        hook.setEmergencyPause(true);
        manager.setNextSwapDelta(-50 ether, 48 ether);

        vm.prank(trader);
        vm.expectRevert(EswapMarginHook.EmergencyPaused.selector);
        router.swapMultiPool(
            EswapRouter.SwapParams({
                key: key,
                standardPoolKey: standardPoolKey,
                zeroForOne: true,
                amountSpecified: -10 ether,
                leverage: 5,
                solver: solver,
                hookData: abi.encode(true, uint8(5), trader),
                deadline: block.timestamp + 15 minutes,
                minAmountOut: 0
            })
        );
    }

    function test_Pause_Toggle() public {
        assertFalse(hook.emergencyPaused());
        hook.setEmergencyPause(true);
        assertTrue(hook.emergencyPaused());
        hook.setEmergencyPause(false);
        assertFalse(hook.emergencyPaused());
    }

    function test_Pause_OnlyOwner() public {
        vm.prank(makeAddr("stranger"));
        vm.expectRevert(EswapMarginHook.NotOwner.selector);
        hook.setEmergencyPause(true);
    }

    function test_Pause_UnpauseRestoresTrading() public {
        hook.setEmergencyPause(true);
        manager.setNextSwapDelta(-50 ether, 48 ether);
        vm.prank(trader);
        vm.expectRevert(EswapMarginHook.EmergencyPaused.selector);
        router.swapMultiPool(
            EswapRouter.SwapParams({
                key: key,
                standardPoolKey: standardPoolKey,
                zeroForOne: true,
                amountSpecified: -10 ether,
                leverage: 5,
                solver: solver,
                hookData: abi.encode(true, uint8(5), trader),
                deadline: block.timestamp + 15 minutes,
                minAmountOut: 0
            })
        );

        hook.setEmergencyPause(false);
        manager.setNextSwapDelta(-50 ether, 48 ether);
        vm.prank(trader);
        router.swapMultiPool(
            EswapRouter.SwapParams({
                key: key,
                standardPoolKey: standardPoolKey,
                zeroForOne: true,
                amountSpecified: -10 ether,
                leverage: 5,
                solver: solver,
                hookData: abi.encode(true, uint8(5), trader),
                deadline: block.timestamp + 15 minutes,
                minAmountOut: 0
            })
        );

        (, uint256 collateral,,,,,,,) = hook.positions(key.toId(), trader);
        assertGt(collateral, 0, "position opened after unpause");
    }
}
