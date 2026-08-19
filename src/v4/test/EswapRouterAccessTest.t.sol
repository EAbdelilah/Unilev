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
import {BalanceDeltaLibrary} from "../types/BalanceDelta.sol";

contract EswapRouterAccessTest is BaseV4Test {
    using PoolIdLibrary for PoolKey;

    EswapRouter public router;
    address public keeper = address(0xBEEF);

    function setUp() public override {
        // Use a callback-forwarding manager so the router's unlock flow is exercised.
        manager = new PoolManagerCallbackMock();
        priceFeed = new PriceFeedMock();

        token0 = new ERC20Mock("Token 0", "TK0");
        token1 = new ERC20Mock("Token 1", "TK1");

        address hookAddress = address(uint160((1 << 159) | (1 << 158) | (1 << 153) | (1 << 152) | (1 << 148)));
        deployCodeTo("EswapMarginHook.sol:EswapMarginHook", abi.encode(manager, priceFeed, address(this)), hookAddress);
        hook = EswapMarginHook(hookAddress);

        router = new EswapRouter(manager);

        key = PoolKey({
            currency0: Currency.wrap(address(token0)),
            currency1: Currency.wrap(address(token1)),
            fee: 3000,
            tickSpacing: 60,
            hooks: address(hook)
        });

        hook.setRouterAndMinCollateralUsd(address(router), 0);
        hook.setAuthorizedPool(key.toId(), true);
    }

    function test_Permissionless_Liquidation_ByKeeper() public {
        // Open a 3x SHORT (zeroForOne=true): margin 10 ether, borrow 20 ether, collateral ~27.86 ether.
        bytes memory data = abi.encode(true, uint8(3), address(this));
        vm.prank(address(manager));
        hook.beforeSwap(address(this), key, IPoolManager.SwapParams(true, -10 ether, 0), data);
        vm.prank(address(manager));
        hook.afterSwap(address(this), key, IPoolManager.SwapParams(true, -30 ether, 0), BalanceDeltaLibrary.toBalanceDelta(-30 ether, 28 ether), data);

        // Make the position liquidatable per the hook's isLiquidatable convention for a
        // SHORT (collateral priced as currency1, borrow as currency0): drop token1 price.
        priceFeed.setPrice(address(token1), 0.5e18);
        priceFeed.setPrice(address(token0), 1e18);

        // Fund the hook so the unwind's surplus transfer can settle (mock take() is a no-op).
        token0.mint(address(hook), 50 ether);
        token1.mint(address(hook), 50 ether);

        // A non-owner keeper triggers the liquidation through the permissionless router path.
        vm.prank(keeper);
        router.liquidate(address(hook), key, address(this), 0);

        (address trader, uint256 collateral, , , , , , , ) = hook.positions(key.toId(), address(this));
        assertEq(trader, address(0), "position should be liquidated");
        assertEq(collateral, 0);
        // [FIX V4] the liquidation reward goes to the keeper (router.liquidate caller), not the insurance fund
        assertGt(token0.balanceOf(keeper), 0, "liquidator reward should go to the keeper");
    }

    function test_Close_PropagatesHookRevert() public {
        // A close of a non-existent position reverts in the hook ("No active position").
        // The router must not swallow it: the caller should see the failure instead of
        // silently paying gas for a no-op.
        vm.expectRevert(EswapMarginHook.NoActivePosition.selector);
        router.closePosition(address(hook), key, address(this), address(0), 0);
    }

    function test_Permissionless_Rebalance_ByKeeper() public {
        address trader = address(0xABC);

        bytes memory data = abi.encode(true, uint8(5), trader);
        manager.setSlot0(key.toId(), 1 << 96, 0); // Price 1.0, Tick 0

        vm.prank(address(manager));
        hook.beforeSwap(address(0), key, IPoolManager.SwapParams(true, -1 ether, 0), data);
        vm.prank(address(manager));
        hook.afterSwap(address(0), key, IPoolManager.SwapParams(true, -1 ether, 0), BalanceDeltaLibrary.toBalanceDelta(1 ether, 1 ether), data);

        // Price moves out of range (tick 0 -> 200).
        manager.setSlot0(key.toId(), 2 << 96, 200);

        vm.prank(keeper);
        router.rebalance(address(hook), key, trader);

        (,,,,,,int24 newTickLower, int24 newTickUpper,) = hook.positions(key.toId(), trader);
        assertEq(newTickLower, 120);
        assertEq(newTickUpper, 240);
    }
}
