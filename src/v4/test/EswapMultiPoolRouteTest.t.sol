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

/**
 * @title EswapMultiPoolRouteTest
 * @notice Proves the router's multi-pool routing: the leverage-accounting swap
 *         lands on the hook pool (`key`) while the physical swap (full
 *         margin*leverage size) lands on a separate seeded standard pool
 *         (`standardPoolKey`, $0 fees, no hook). A leveraged position must open
 *         even though the hook pool itself carries no physical liquidity.
 */
contract EswapMultiPoolRouteTest is BaseV4Test {
    using PoolIdLibrary for PoolKey;

    EswapRouter public router;
    PoolKey public standardPoolKey;

    function setUp() public override {
        // Callback-forwarding manager so the router's unlock flow is exercised.
        manager = new PoolManagerCallbackMock();
        priceFeed = new PriceFeedMock();

        token0 = new ERC20Mock("Token 0", "TK0");
        token1 = new ERC20Mock("Token 1", "TK1");

        address hookAddress = address(uint160((1 << 159) | (1 << 158) | (1 << 153) | (1 << 152) | (1 << 148)));
        deployCodeTo("EswapMarginHook.sol:EswapMarginHook", abi.encode(manager, priceFeed), hookAddress);
        hook = EswapMarginHook(hookAddress);

        router = new EswapRouter(manager);

        key = PoolKey({
            currency0: Currency.wrap(address(token0)),
            currency1: Currency.wrap(address(token1)),
            fee: 3000,
            tickSpacing: 60,
            hooks: address(hook)
        });

        // Standard (physical execution) pool: same currency ordering, $0 fees,
        // NO hook. This is where the real token exchange happens.
        standardPoolKey = PoolKey({
            currency0: key.currency0,
            currency1: key.currency1,
            fee: 0,
            tickSpacing: 60,
            hooks: address(0)
        });

        hook.setRouter(address(router));
        hook.setAuthorizedPool(key.toId(), true);

        // Both pools initialized at a 1:1 price. The hook pool is intentionally
        // UNSEEDED (no liquidity/reserves); the standard pool is seeded.
        manager.setSlot0(key.toId(), 1 << 96, 0);
        manager.setSlot0(standardPoolKey.toId(), 1 << 96, 0);
        token0.mint(address(manager), 1000 ether);
        token1.mint(address(manager), 1000 ether);
        manager.mint(address(manager), uint256(uint160(address(token0))), 1000 ether);
        manager.mint(address(manager), uint256(uint160(address(token1))), 1000 ether);
    }

    /// @dev Simulates the hook invocation the real PoolManager performs inside
    ///      manager.swap (the mock does not route swaps to hooks).
    function _primeHookPosition(address trader, bool zeroForOne, uint256 margin, uint8 leverage, int128 output) internal {
        bytes memory data = abi.encode(true, leverage, trader);
        vm.prank(address(manager));
        hook.beforeSwap(address(this), key, IPoolManager.SwapParams(zeroForOne, -int128(uint128(margin)), 0), data);
        // Swapper-perspective delta: input leg negative, output leg positive.
        int128 inputDelta = -int128(uint128(margin * leverage));
        vm.prank(address(manager));
        if (zeroForOne) {
            hook.afterSwap(
                address(this),
                key,
                IPoolManager.SwapParams(true, -int128(uint128(margin * leverage)), 0),
                BalanceDeltaLibrary.toBalanceDelta(inputDelta, output),
                data
            );
        } else {
            hook.afterSwap(
                address(this),
                key,
                IPoolManager.SwapParams(false, -int128(uint128(margin * leverage)), 0),
                BalanceDeltaLibrary.toBalanceDelta(output, inputDelta),
                data
            );
        }
    }

    /// @dev Reconstructs the PoolKey recorded by a mock swap call from the
    ///      public getter and returns its pool id.
    function _swapCallPoolId(uint256 i) internal view returns (PoolId) {
        (PoolKey memory k, , , ) = manager.swapCalls(i);
        return k.toId();
    }

    function test_Swap_RoutesAccountingToHookPool_PhysicalToStandardPool() public {
        address trader = address(0xABC);
        uint256 margin = 10 ether;
        uint8 leverage = 3;

        _primeHookPosition(trader, true, margin, leverage, 28 ether);

        EswapRouter.SwapParams memory params = EswapRouter.SwapParams({
            key: key,
            standardPoolKey: standardPoolKey,
            zeroForOne: true,
            amountSpecified: -int128(uint128(margin)),
            leverage: leverage,
            hookData: abi.encode(true, leverage, trader)
        });

        token0.mint(trader, 100 ether);
        vm.startPrank(trader);
        token0.approve(address(router), type(uint256).max);
        router.swap(params);
        vm.stopPrank();

        // Position opened on the UNSEEDED hook pool with the expected accounting.
        (address posTrader, uint256 collateral, uint256 borrowed, uint8 posLeverage, , , , , uint128 liquidity) =
            hook.positions(key.toId(), trader);
        assertEq(posTrader, trader);
        assertEq(posLeverage, leverage);
        assertEq(borrowed, margin * (leverage - 1));
        assertEq(collateral, (28 ether * 9950) / 10000);
        assertGt(liquidity, 0, "deployCollateral should deploy the position liquidity");

        // Exactly two swaps: (0) hook-pool accounting swap with hookData,
        // (1) physical swap on the standard pool at full leverage size, no hookData.
        assertEq(manager.swapCallsLength(), 2, "router must perform exactly two swaps");
        assertEq(PoolId.unwrap(_swapCallPoolId(0)), PoolId.unwrap(key.toId()), "first swap must land on the hook pool");
        assertEq(PoolId.unwrap(_swapCallPoolId(1)), PoolId.unwrap(standardPoolKey.toId()), "physical swap must land on the standard pool");
        (, , int128 accountingAmount, bytes memory accountingHookData) = manager.swapCalls(0);
        (, , int128 physicalAmount, bytes memory physicalHookData) = manager.swapCalls(1);
        assertEq(accountingAmount, -int128(uint128(margin)));
        assertGt(accountingHookData.length, 0, "hook-pool swap must carry hookData");
        assertEq(physicalAmount, -int128(uint128(margin * leverage)), "physical swap must be full leverage size");
        assertEq(physicalHookData.length, 0, "standard pool swap must be plain");
    }

    function test_Swap_ReverseDirection_RoutesToStandardPool() public {
        address trader = address(0xDEF);
        uint256 margin = 10 ether;
        uint8 leverage = 3;

        // zeroForOne=false (LONG, buys currency0): margin 10, borrow 20, out 28.
        _primeHookPosition(trader, false, margin, leverage, 28 ether);

        EswapRouter.SwapParams memory params = EswapRouter.SwapParams({
            key: key,
            standardPoolKey: standardPoolKey,
            zeroForOne: false,
            amountSpecified: -int128(uint128(margin)),
            leverage: leverage,
            hookData: abi.encode(true, leverage, trader)
        });

        token1.mint(trader, 100 ether);
        vm.startPrank(trader);
        token1.approve(address(router), type(uint256).max);
        router.swap(params);
        vm.stopPrank();

        (address posTrader, uint256 collateral, uint256 borrowed, , bool isLong, , , , uint128 liquidity) =
            hook.positions(key.toId(), trader);
        assertEq(posTrader, trader);
        assertTrue(isLong, "base currency unset -> currency0 buy must be a LONG");
        assertEq(borrowed, margin * (leverage - 1));
        assertEq(collateral, (28 ether * 9950) / 10000);
        assertGt(liquidity, 0);

        assertEq(manager.swapCallsLength(), 2);
        assertEq(PoolId.unwrap(_swapCallPoolId(0)), PoolId.unwrap(key.toId()));
        assertEq(PoolId.unwrap(_swapCallPoolId(1)), PoolId.unwrap(standardPoolKey.toId()));
        (, , int128 physicalAmount, bytes memory physicalHookData) = manager.swapCalls(1);
        assertEq(physicalAmount, -int128(uint128(margin * leverage)));
        assertEq(physicalHookData.length, 0);
    }
}
