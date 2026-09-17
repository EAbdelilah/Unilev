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

/// [P2#9] Per-pool maximum-leverage override (closes slither ID-22: the storage
/// comment promised a setter that never existed). Owner writes an override that
/// `_maxLeverageForPool` honors ahead of the default (2..20).
contract EswapMaxLeverageForPoolTest is BaseV4Test {
    using PoolIdLibrary for PoolKey;

    EswapRouter public router;
    PoolKey public otherKey;

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
        otherKey = key;
        otherKey.fee = 500;

        hook.setRouterAndMinCollateralUsd(address(router), 0);
        hook.setAuthorizedPool(key.toId(), true);
        hook.setAuthorizedPool(otherKey.toId(), true);
        manager.setSlot0(key.toId(), 79228162514264337593543950336, 0);
    }

    function _revertOpen(uint8 leverage) internal {
        bytes memory data = abi.encode(true, leverage, address(this));
        vm.prank(address(manager));
        vm.expectRevert(EswapMarginHook.MaxLeverageExceeded.selector);
        hook.beforeSwap(address(this), key, IPoolManager.SwapParams(true, -10 ether, 0), data);
    }

    function _openShort(uint8 leverage) internal {
        bytes memory data = abi.encode(true, leverage, address(this));
        uint256 notional = uint256(leverage) * 10 ether;
        vm.prank(address(manager));
        hook.beforeSwap(address(this), key, IPoolManager.SwapParams(true, -10 ether, 0), data);
        vm.prank(address(manager));
        hook.afterSwap(
            address(this),
            key,
            IPoolManager.SwapParams(true, -int256(notional), 0),
            BalanceDeltaLibrary.toBalanceDelta(-int128(int256(notional)), int128(28 ether)),
            data
        );
        manager.mint(address(hook), uint256(uint160(address(token1))), 28 ether * 2);
    }

    function test_PerPoolOverride_RaisesCap_AboveDefault() public {
        assertEq(hook.maxLeverageByPool(key.toId()), 0, "starts unset -> default");
        assertEq(hook.defaultMaxLeverage(), 5);

        hook.setMaxLeverageForPool(key.toId(), 10);

        _openShort(6); // 6x > default 5, allowed only because of the override
        (address trader, uint256 collateral, uint256 borrowed, uint8 lev, bool isLong,,,,) =
            hook.positions(key.toId(), address(this));
        assertEq(lev, 6);
        assertEq(trader, address(this));
        assertEq(isLong, false);
        assertEq(borrowed, 10 ether * 5, "margin * (lev-1)");
        assertGt(collateral, 27 ether, "collateral = bought minus opening fee");
    }

    function test_PerPoolOverride_LowerThanDefault_RejectsHigher() public {
        hook.setMaxLeverageForPool(key.toId(), 2);

        _revertOpen(3); // 3x rejected by the override even though default is 5
        _openShort(2); // 2x still admitted
        (
            address trader,
            uint256 collateral,
            uint256 borrowed,
            uint8 lev,
            bool isLong,
            uint160 liqSqrt,
            int24 tickLower,
            int24 tickUpper,
            uint128 liquidity
        ) = _readPosition();
        assertEq(trader, address(this));
        assertEq(lev, 2);
        assertEq(isLong, false);
        assertEq(borrowed, 10 ether, "margin * (2-1)");
        assertGt(collateral, 27 ether, "collateral = bought minus opening fee");
    }

    function test_PerPoolOverride_ClearFallsBackToDefault() public {
        hook.setMaxLeverageForPool(key.toId(), 2);
        _revertOpen(3);

        hook.setMaxLeverageForPool(key.toId(), 0); // clear override
        assertEq(hook.maxLeverageByPool(key.toId()), 0);

        _openShort(3); // default 5 applies again
        (
            address trader,
            uint256 collateral,
            uint256 borrowed,
            uint8 lev,
            bool isLong,
            uint160 liqSqrt,
            int24 tickLower,
            int24 tickUpper,
            uint128 liquidity
        ) = _readPosition();
        assertEq(trader, address(this));
        assertEq(lev, 3);
        assertEq(isLong, false);
        assertEq(borrowed, 10 ether * 2, "margin * (3-1)");
        assertGt(collateral, 27 ether, "collateral = bought minus opening fee");
    }

    function test_PerPoolOverride_DoesNotAffectOtherPools() public {
        hook.setMaxLeverageForPool(key.toId(), 10);

        // otherKey has no override -> default 5 still rejects a 6x open.
        bytes memory data = abi.encode(true, uint8(6), address(this));
        vm.prank(address(manager));
        vm.expectRevert(EswapMarginHook.MaxLeverageExceeded.selector);
        hook.beforeSwap(address(this), otherKey, IPoolManager.SwapParams(true, -10 ether, 0), data);
    }

    function test_PerPoolOverride_AccessControlAndBounds() public {
        vm.prank(address(0xBAD));
        vm.expectRevert();
        hook.setMaxLeverageForPool(key.toId(), 10);

        vm.expectRevert(EswapMarginHook.InvalidLeverageRange.selector);
        hook.setMaxLeverageForPool(key.toId(), 1);
        vm.expectRevert(EswapMarginHook.InvalidLeverageRange.selector);
        hook.setMaxLeverageForPool(key.toId(), 21);

        vm.expectEmit(true, true, true, true);
        emit EswapMarginHook.MaxLeverageForPoolSet(key.toId(), 12);
        hook.setMaxLeverageForPool(key.toId(), 12);
        assertEq(hook.maxLeverageByPool(key.toId()), 12);
    }

    function _readPosition()
        internal
        view
        returns (address, uint256, uint256, uint8, bool, uint160, int24, int24, uint128)
    {
        (
            address trader,
            uint256 collateral,
            uint256 borrowed,
            uint8 lev,
            bool isLong,
            uint160 liqSqrt,
            int24 tickLower,
            int24 tickUpper,
            uint128 liquidity
        ) = hook.positions(key.toId(), address(this));
        return (trader, collateral, borrowed, lev, isLong, liqSqrt, tickLower, tickUpper, liquidity);
    }
}
