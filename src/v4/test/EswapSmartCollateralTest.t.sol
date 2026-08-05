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
        hook.setRouter(address(this));
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

        hook.deployCollateral(key, address(this));

        // Verify position recording
        (address trader, uint256 collateral, uint256 borrow, uint8 lev, bool isLong,, int24 tickLower, int24 tickUpper, uint128 liquidity) = hook.positions(key.toId(), address(this));

        assertEq(trader, address(this));
        // positionCollateral = 480 ether * 9950/10000 (0.5% fee deducted)
        assertEq(collateral, (480 ether * 9950) / 10000);
        assertEq(borrow, 400 ether); // 100 * (5-1)
        assertEq(lev, 5);
        assertFalse(isLong);
        assertEq(tickLower, -60);
        assertEq(tickUpper, 60);
        assertTrue(liquidity > 0);

        // Verify manager call
        (,int24 callTickLower, int24 callTickUpper, int128 callLiquidityDelta) = manager.modifyLiquidityCalls(0);
        assertEq(callTickLower, -60);
        assertEq(callTickUpper, 60);
        assertTrue(callLiquidityDelta > 0);
    }

    function test_ModifyLiquidityDelta_Netting_NegativeSettledOnDeploy() public {
        uint8 leverage = 5;
        bytes memory data = abi.encode(true, leverage, address(this));

        vm.startPrank(address(manager));
        hook.beforeSwap(address(this), key, IPoolManager.SwapParams(true, -100 ether, 0), data);
        hook.afterSwap(address(this), key, IPoolManager.SwapParams(true, -500 ether, 0), BalanceDeltaLibrary.toBalanceDelta(-500 ether, 480 ether), data);
        vm.stopPrank();

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
        hook.afterSwap(address(this), key, IPoolManager.SwapParams(true, -500 ether, 0), BalanceDeltaLibrary.toBalanceDelta(-500 ether, 480 ether), data);
        vm.stopPrank();

        hook.deployCollateral(key, address(this));

        // Closing removes liquidity; real V4 returns a positive delta (the pool returns
        // the position tokens to the hook). Those must be taken, not left unaccounted.
        manager.setCurrencyDelta(address(hook), key.currency0, 0);
        manager.setNextModifyLiquidityDelta(int128(300 ether), int128(100 ether));

        uint256 takeBefore = manager.takeCount();
        uint256 settleBefore = manager.settleCount();
        token0.mint(address(hook), 500 ether); // Mint enough tokens to cover both solver payout and netting
        token1.mint(address(hook), 100 ether);
        hook.closePosition(key, address(this), address(0), 0);

        // 3 takes: 2 from the positive liquidity-delta netting + 1 unwind-swap take.
        // 1 settle: the explicit debt repayment (no negative liquidity delta to settle).
        assertEq(manager.takeCount(), takeBefore + 3, "2 liquidity-delta takes + 1 unwind-swap take");
        assertEq(manager.settleCount(), settleBefore + 1, "only the debt repayment settle");
    }
}
