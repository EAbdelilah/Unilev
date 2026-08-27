// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BaseV4Test} from "./BaseV4Test.t.sol";
import {BeforeSwapDelta} from "../types/BeforeSwapDelta.sol";
import {Currency} from "../types/Currency.sol";
import {PoolKey} from "../types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "../types/PoolId.sol";
import {IPoolManager} from "../interfaces/IPoolManager.sol";
import {BalanceDeltaLibrary} from "../types/BalanceDelta.sol";

contract EswapSmartCollateralTest is BaseV4Test {
    using PoolIdLibrary for PoolKey;

    function setUp() public override {
        super.setUp();
        hook.setRouterAndMinCollateralUsd(address(this), 0);
    }

    function test_SmartCollateral_Rehypothecation() public {
        uint8 leverage = 5;
        bytes memory data = abi.encode(true, leverage, address(this));

        vm.startPrank(address(manager));
        hook.beforeSwap(address(this), key, IPoolManager.SwapParams(true, -100 ether, 0), data);

        hook.afterSwap(
            address(this),
            key,
            IPoolManager.SwapParams(true, -500 ether, 0),
            BalanceDeltaLibrary.toBalanceDelta(-500 ether, 480 ether),
            data
        );
        vm.stopPrank();
        // Simulate Router minting ERC-6909 collateral claims to the hook
        manager.mint(address(hook), uint256(uint160(address(token1))), 480 ether);

        hook.deployCollateral(key, address(this));

        // Verify position recording
        (
            address trader,
            uint256 collateral,
            uint256 borrow,
            uint8 lev,
            bool isLong,,
            int24 tickLower,
            int24 tickUpper,
            uint128 liquidity
        ) = hook.positions(key.toId(), address(this));

        assertEq(trader, address(this));
        // positionCollateral = 480 ether * 9950/10000 (0.5% fee deducted)
        assertEq(collateral, (480 ether * 9950) / 10000);
        assertEq(borrow, 400 ether); // 100 * (5-1)
        assertEq(lev, 5);
        assertFalse(isLong);
        // Single-sided band below price holding token1 (SHORT collateral).
        assertEq(tickLower, -600);
        assertEq(tickUpper, 0);
        assertTrue(liquidity > 0);

        // Verify manager call
        (, int24 callTickLower, int24 callTickUpper, int128 callLiquidityDelta) = manager.modifyLiquidityCalls(0);
        assertEq(callTickLower, -600);
        assertEq(callTickUpper, 0);
        assertTrue(callLiquidityDelta > 0);
    }

    function test_ModifyLiquidityDelta_Netting_NegativeSettledOnDeploy() public {
        uint8 leverage = 5;
        bytes memory data = abi.encode(true, leverage, address(this));

        vm.startPrank(address(manager));
        hook.beforeSwap(address(this), key, IPoolManager.SwapParams(true, -100 ether, 0), data);
        hook.afterSwap(
            address(this),
            key,
            IPoolManager.SwapParams(true, -500 ether, 0),
            BalanceDeltaLibrary.toBalanceDelta(-500 ether, 480 ether),
            data
        );
        vm.stopPrank();
        // Simulate Router minting ERC-6909 collateral claims to the hook
        manager.mint(address(hook), uint256(uint160(address(token1))), 480 ether);

        // Real V4 returns a negative delta when adding liquidity (the hook must provide
        // tokens). The mock returns 0 by default, which used to mask the missing settle.
        // Verify the hook nets it: negative component -> settle, positive -> take.
        manager.setNextModifyLiquidityDelta(-int128(200 ether), 0);

        uint256 settleBefore = manager.settleCount();
        uint256 takeBefore = manager.takeCount();
        token0.mint(address(hook), 200 ether); // Mint tokens to the hook so it has balance to settle with PM
        hook.deployCollateral(key, address(this));

        assertEq(manager.settleCount(), settleBefore + 1, "negative amount0 delta must be settled");
        assertEq(manager.takeCount(), takeBefore, "zero amount1 delta must not be taken");
        (,,,,,,,, uint128 deployedLiquidity) = hook.positions(key.toId(), address(this));
        assertTrue(deployedLiquidity > 0);
    }

    function test_ModifyLiquidityDelta_Netting_PositiveTakenOnClose() public {
        uint8 leverage = 5;
        bytes memory data = abi.encode(true, leverage, address(this));

        vm.startPrank(address(manager));
        hook.beforeSwap(address(this), key, IPoolManager.SwapParams(true, -100 ether, 0), data);
        hook.afterSwap(
            address(this),
            key,
            IPoolManager.SwapParams(true, -500 ether, 0),
            BalanceDeltaLibrary.toBalanceDelta(-500 ether, 480 ether),
            data
        );
        vm.stopPrank();
        // Simulate Router minting ERC-6909 collateral claims to the hook
        // Double: _settleTransientDebt + _settle each burn up to collateralAmount
        manager.mint(address(hook), uint256(uint160(address(token1))), 480 ether * 2);

        hook.deployCollateral(key, address(this));

        // Closing removes liquidity; real V4 returns a positive delta (the pool returns
        // the position tokens to the hook). Those must be taken, not left unaccounted.
        manager.setCurrencyDelta(address(hook), key.currency0, 0);
        manager.setNextModifyLiquidityDelta(int128(300 ether), int128(100 ether));

        uint256 takeBefore = manager.takeCount();
        uint256 settleBefore = manager.settleCount();
        token0.mint(address(hook), 500 ether); // Mint enough tokens to cover both solver payout and netting
        // The close's unwind swap leaves a transient debt in the COLLATERAL
        // currency (token1). Claims from the removal take cover 100 ether;
        // the remainder must be physically available for the settle fallback.
        token1.mint(address(hook), 500 ether);
        hook.closePosition(key, address(this), address(0), 0);

        // 3 takes: 2 from the positive liquidity-delta netting + 1 unwind-swap take.
        // 1 settle: the collateral-leg fallback (partial claims) covers the old
        // explicit debt-repayment settle.
        assertEq(manager.takeCount(), takeBefore + 3, "2 liquidity-delta takes + 1 unwind-swap take");
        assertEq(manager.settleCount(), settleBefore + 1, "collateral-leg fallback settle");
    }

    function test_RehypothecationYield_PaidToSolverOnClose() public {
        // SHORT (zeroForOne=true): collateral = currency1 (token1), debt = currency0 (token0)
        uint8 leverage = 5;
        address solver = address(0xBEEF);
        bytes memory data = abi.encode(true, leverage, address(this)); // 3rd field = trader

        vm.startPrank(address(manager));
        hook.beforeSwap(address(this), key, IPoolManager.SwapParams(true, -100 ether, 0), data);
        hook.afterSwap(
            address(this),
            key,
            IPoolManager.SwapParams(true, -500 ether, 0),
            BalanceDeltaLibrary.toBalanceDelta(-500 ether, 480 ether),
            data
        );
        vm.stopPrank();
        // Simulate Router minting ERC-6909 collateral claims to the hook
        // Double: _settleTransientDebt + _settle each burn up to collateralAmount
        manager.mint(address(hook), uint256(uint160(address(token1))), 480 ether * 2);

        uint256 collateralAmount = (480 ether * 9950) / 10000; // 477.6 ether

        // Register the solver's debt so close pays the yield to it
        hook.registerSolverDebt(key.toId(), address(this), solver, 400 ether);
        hook.deployCollateral(key, address(this));

        assertEq(hook.positionSolver(key.toId(), address(this)), solver, "solver must back the leveraged position");

        // Closing removes liquidity; the pool returns principal + LP fees. Mock:
        // removeDelta returns 500 ether token1 (collateral), i.e. 500 - 477.6 = 22.4 ether yield.
        manager.setNextModifyLiquidityDelta(0, int128(500 ether));

        // Hook must physically hold the tokens that the mock's take() never moves
        token1.mint(address(hook), 500 ether);
        token0.mint(address(hook), 500 ether); // covers unwind-swap receive (mock take is a no-op)

        uint256 solverToken1Before = token1.balanceOf(solver);
        uint256 solverToken0Before = token0.balanceOf(solver);

        hook.closePosition(key, address(this), solver, 0);

        // Solver receives the rehypothecation yield: recovered collateral beyond principal.
        uint256 yield1 = 500 ether - collateralAmount;
        assertEq(token1.balanceOf(solver) - solverToken1Before, yield1, "solver must receive rehypothecation yield");
        // Principal is repaid in the debt currency when a solver backed the position.
        assertEq(token0.balanceOf(solver) - solverToken0Before, 400 ether, "solver principal repayment");
    }

    function test_RehypothecationYield_NoSolver_ReturnsToTrader() public {
        // Leverage = 1 (no solver): yield on the deployed collateral returns to the trader.
        bytes memory data = abi.encode(true, uint8(1), address(this));

        vm.startPrank(address(manager));
        hook.beforeSwap(address(this), key, IPoolManager.SwapParams(true, -100 ether, 0), data);
        hook.afterSwap(
            address(this),
            key,
            IPoolManager.SwapParams(true, -100 ether, 0),
            BalanceDeltaLibrary.toBalanceDelta(-100 ether, 99.9 ether),
            data
        );
        vm.stopPrank();
        // Double: _settleTransientDebt + _settle each burn up to collateralAmount
        manager.mint(address(hook), uint256(uint160(address(token1))), 99.9 ether * 2);

        uint256 collateralAmount = (99.9 ether * 9950) / 10000;
        hook.deployCollateral(key, address(this));

        manager.setNextModifyLiquidityDelta(0, int128(110 ether));
        token1.mint(address(hook), 110 ether);
        token0.mint(address(hook), 100 ether);

        uint256 traderToken1Before = token1.balanceOf(address(this));
        hook.closePosition(key, address(this), address(0), 0);

        // No solver registered -> the yield (110 - collateral) goes to the trader.
        uint256 yield1 = 110 ether - collateralAmount;
        assertGt(token1.balanceOf(address(this)) - traderToken1Before, yield1 - 1, "trader keeps the leverage-1 yield");
    }

    function test_RehypothecationYield_OutOfRange_NoLeakToSolver() public {
        // Out-of-range LONG/SHORT: the LP returns only the OTHER currency
        // (recovered collateral = 0), which holds the trader's principal, not
        // yield. [FIX V3] It must NOT be paid to the solver.
        uint8 leverage = 5;
        address solver = address(0xBEEF);
        bytes memory data = abi.encode(true, leverage, address(this));

        vm.startPrank(address(manager));
        hook.beforeSwap(address(this), key, IPoolManager.SwapParams(true, -100 ether, 0), data);
        hook.afterSwap(
            address(this),
            key,
            IPoolManager.SwapParams(true, -500 ether, 0),
            BalanceDeltaLibrary.toBalanceDelta(-500 ether, 480 ether),
            data
        );
        vm.stopPrank();
        // Double: _settleTransientDebt + _settle each burn up to collateralAmount
        manager.mint(address(hook), uint256(uint160(address(token1))), 480 ether * 2);

        hook.registerSolverDebt(key.toId(), address(this), solver, 400 ether);
        hook.deployCollateral(key, address(this));

        // removeDelta returns ONLY token0 (the debt/other currency): recovered collateral (token1) = 0.
        manager.setNextModifyLiquidityDelta(int128(300 ether), 0);
        // Fund the hook for the unwind-swap payout (mock take() is a no-op).
        token0.mint(address(hook), 500 ether);
        // The unwind swap's transient COLLATERAL-currency (token1) debt: no PM
        // claims exist in direct-call mode, so physical tokens must cover it.
        token1.mint(address(hook), 477.6 ether);

        uint256 solverToken0Before = token0.balanceOf(solver);
        uint256 solverToken1Before = token1.balanceOf(solver);

        hook.closePosition(key, address(this), solver, 0);

        // The other-currency recovered principal (300 ether token0) is the
        // TRADER's collateral that came back in the wrong currency. [FIX V3] the
        // solver must receive ONLY its principal back via _settle, not this surplus.
        assertEq(
            token0.balanceOf(solver) - solverToken0Before,
            400 ether,
            "solver gets principal only, no other-currency leak"
        );
        // No collateral surplus exists, so no collateral-currency yield either.
        assertEq(token1.balanceOf(solver) - solverToken1Before, 0, "no collateral yield when out of range");
    }
}
