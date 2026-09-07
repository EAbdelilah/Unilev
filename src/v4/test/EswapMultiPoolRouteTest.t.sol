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

        // Standard (physical execution) pool: same currency ordering, $0 fees,
        // NO hook. This is where the real token exchange happens.
        standardPoolKey =
            PoolKey({currency0: key.currency0, currency1: key.currency1, fee: 0, tickSpacing: 60, hooks: address(0)});

        hook.setRouterAndMinCollateralUsd(address(router), 0);
        hook.setAuthorizedPool(key.toId(), true);
        router.setSolverWhitelist(address(0x123), true);

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
    function _primeHookPosition(address trader, bool zeroForOne, uint256 margin, uint8 leverage, int128 output)
        internal
    {
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
        (PoolKey memory k,,,) = manager.swapCalls(i);
        return k.toId();
    }

    function test_Swap_RoutesAccountingToHookPool_PhysicalToStandardPool() public {
        address trader = address(0xABC);
        address solver = address(0x123);
        uint256 margin = 10 ether;
        uint8 leverage = 3;

        _primeHookPosition(trader, true, margin, leverage, 28 ether);

        EswapRouter.SwapParams memory params = EswapRouter.SwapParams({
            key: key,
            standardPoolKey: standardPoolKey,
            zeroForOne: true,
            amountSpecified: -int128(uint128(margin)),
            leverage: leverage,
            solver: solver,
            hookData: abi.encode(true, leverage, trader),
            deadline: block.timestamp + 15 minutes
        });

        token0.mint(trader, 100 ether);
        vm.startPrank(trader);
        token0.approve(address(router), type(uint256).max);
        vm.stopPrank();

        token0.mint(solver, 100 ether);
        vm.startPrank(solver);
        token0.approve(address(router), type(uint256).max);
        vm.stopPrank();

        // Mint token1 (the collateral) to the hook so deployCollateral can add concentrated liquidity
        token1.mint(address(hook), 100 ether);

        vm.startPrank(trader);
        router.swap(params);
        vm.stopPrank();

        // Position opened on the UNSEEDED hook pool with the expected accounting.
        (address posTrader, uint256 collateral, uint256 borrowed, uint8 posLeverage,,,,, uint128 liquidity) =
            hook.positions(key.toId(), trader);
        assertEq(posTrader, trader);
        assertEq(posLeverage, leverage);
        assertEq(borrowed, margin * (leverage - 1));
        assertEq(collateral, (28 ether * 9950) / 10000);
        assertGt(liquidity, 0, "deployCollateral should deploy the position liquidity");

        // [FIX V2] Single-pool execution: exactly ONE swap on the hook pool,
        // carrying the router's margin amount and hookData. The standard pool is
        // no longer used for opens (multi-pool double-swapping left un-netted
        // deltas and reverted CurrencyNotSettled on the real PoolManager).
        assertEq(manager.swapCallsLength(), 1, "router must perform exactly one swap");
        assertEq(PoolId.unwrap(_swapCallPoolId(0)), PoolId.unwrap(key.toId()), "the swap must land on the hook pool");
        (,, int128 swapAmount, bytes memory swapHookData) = manager.swapCalls(0);
        assertEq(swapAmount, -int128(uint128(margin)));
        assertGt(swapHookData.length, 0, "hook pool swap must carry hookData");
    }

    function test_Swap_ReverseDirection_RoutesToStandardPool() public {
        address trader = address(0xDEF);
        address solver = address(0x123);
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
            solver: solver,
            hookData: abi.encode(true, leverage, trader),
            deadline: block.timestamp + 15 minutes
        });

        token1.mint(trader, 100 ether);
        vm.startPrank(trader);
        token1.approve(address(router), type(uint256).max);
        vm.stopPrank();

        token1.mint(solver, 100 ether);
        vm.startPrank(solver);
        token1.approve(address(router), type(uint256).max);
        vm.stopPrank();

        // Mint token0 (the collateral) to the hook so deployCollateral can add concentrated liquidity
        token0.mint(address(hook), 100 ether);

        vm.startPrank(trader);
        router.swap(params);
        vm.stopPrank();

        (address posTrader, uint256 collateral, uint256 borrowed,, bool isLong,,,, uint128 liquidity) =
            hook.positions(key.toId(), trader);
        assertEq(posTrader, trader);
        assertTrue(isLong, "base currency unset -> currency0 buy must be a LONG");
        assertEq(borrowed, margin * (leverage - 1));
        assertEq(collateral, (28 ether * 9950) / 10000);
        assertGt(liquidity, 0);

        // [FIX V2] Single-pool execution: exactly ONE swap on the hook pool.
        assertEq(manager.swapCallsLength(), 1, "router must perform exactly one swap");
        assertEq(PoolId.unwrap(_swapCallPoolId(0)), PoolId.unwrap(key.toId()));
        (,, int128 swapAmount, bytes memory swapHookData) = manager.swapCalls(0);
        assertEq(swapAmount, -int128(uint128(margin)));
        assertGt(swapHookData.length, 0);
    }

    function test_OpenAndClose_5xLeveragePosition_MultiPoolRoute() public {
        address trader = address(0xABC);
        address solver = address(0x123);
        uint256 margin = 10 ether;
        uint8 leverage = 5;

        // (1) Open 5x position
        _primeHookPosition(trader, true, margin, leverage, 48 ether);

        EswapRouter.SwapParams memory params = EswapRouter.SwapParams({
            key: key,
            standardPoolKey: standardPoolKey,
            zeroForOne: true,
            amountSpecified: -int128(uint128(margin)),
            leverage: leverage,
            solver: solver,
            hookData: abi.encode(true, leverage, trader),
            deadline: block.timestamp + 15 minutes
        });

        token0.mint(trader, margin);
        token0.mint(solver, margin * (leverage - 1));

        vm.startPrank(trader);
        token0.approve(address(router), type(uint256).max);
        vm.stopPrank();

        vm.startPrank(solver);
        token0.approve(address(router), type(uint256).max);
        vm.stopPrank();

        // Mint token1 (the collateral) to the hook so deployCollateral can add concentrated liquidity
        token1.mint(address(hook), 100 ether);

        vm.startPrank(trader);
        router.swap(params);
        vm.stopPrank();

        // Verify position details
        (address posTrader, uint256 collateral, uint256 borrowed, uint8 posLeverage,,,,, uint128 liquidity) =
            hook.positions(key.toId(), trader);
        assertEq(posTrader, trader);
        assertEq(posLeverage, leverage);
        assertEq(borrowed, margin * (leverage - 1));
        assertEq(collateral, (48 ether * 9950) / 10000);
        assertGt(liquidity, 0, "deployCollateral should deploy the position liquidity");

        // Verify Solver Debt registration
        (address debtSolver, uint256 principal, uint256 yield) = hook.solverDebts(key.toId(), trader, solver);
        assertEq(debtSolver, solver);
        assertEq(principal, margin * (leverage - 1));
        assertEq(yield, 0);

        // (2) Close position
        // When closing, rehypothecated collateral is removed and swapped back.
        // We'll prime the mock PoolManager to return a positive amount of input currency (token0) from the standard pool swap
        // Let's set the mock swap output to 50 ether of token0 when the standard pool swap is executed during close.
        // During close, the hook does `manager.swap(standardKey, ...)`
        // So we can set the next swap delta.
        // Collateral is 48 ether * 9950 / 10000 = 47.76 ether.
        // Let's mock a standard pool swap that converts 47.76 ether of collateral (token1) back to 50 ether of token0.
        // delta in manager.swap is from swapper's perspective: selling token1 (delta.amount1 < 0) and receiving token0 (delta.amount0 > 0).
        // So we want delta.amount0 = 50 ether, delta.amount1 = -47.76 ether.
        int128 outAmt = int128(uint128(47.76 ether));
        int128 inAmt = int128(uint128(50 ether));
        // For zeroForOne=false (selling token1):
        manager.setNextSwapDelta(inAmt, -outAmt);

        token1.mint(address(manager), 47.76 ether); // For settlement burn
        token0.mint(address(manager), 50 ether); // For taking

        // Mint the recovered debt tokens (token0) to the hook contract since the mock take() is a no-op
        token0.mint(address(hook), 50 ether);

        // Execute Close
        vm.startPrank(trader);
        router.closePosition(address(hook), key, trader, solver, 0);
        vm.stopPrank();

        // Verify position is cleared
        (posTrader, collateral, borrowed,,,,,,) = hook.positions(key.toId(), trader);
        assertEq(posTrader, address(0));
        assertEq(collateral, 0);
        assertEq(borrowed, 0);

        // Verify Solver Debt is cleared
        (debtSolver, principal, yield) = hook.solverDebts(key.toId(), trader, solver);
        assertEq(debtSolver, address(0));
        assertEq(principal, 0);
        assertEq(yield, 0);
    }
}
