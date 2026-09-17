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

/// @notice [P2#8] Liquidator incentive: an owner-configured bps share of the
///         post-solver liquidation surplus paid DIRECTLY to the liquidator in
///         the debt currency, before the insurance credit / trader payout.
///         Default 0 preserves the original H-5b insurance-only routing.
contract EswapLiquidatorIncentiveTest is BaseV4Test {
    using PoolIdLibrary for PoolKey;

    EswapRouter public router;
    address public liquidator = address(0x1AA);
    address public solver = address(0x2BB);

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

        hook.setRouterAndMinCollateralUsd(address(router), 0);
        hook.setAuthorizedPool(key.toId(), true);
        manager.setSlot0(key.toId(), 79228162514264337593543950336, 0);
    }

    function _openShort() internal {
        // Open a 3x SHORT (zeroForOne=true): margin 10 ether, borrow 20 ether.
        bytes memory data = abi.encode(true, uint8(3), address(this));
        vm.prank(address(manager));
        hook.beforeSwap(address(this), key, IPoolManager.SwapParams(true, -10 ether, 0), data);
        vm.prank(address(manager));
        hook.afterSwap(
            address(this),
            key,
            IPoolManager.SwapParams(true, -30 ether, 0),
            BalanceDeltaLibrary.toBalanceDelta(-30 ether, 28 ether),
            data
        );
        // Simulate Router minting ERC-6909 collateral claims to the hook (real V4 unlock flow).
        manager.mint(address(hook), uint256(uint160(address(token1))), 28 ether * 2);
        // [P2#8] Mirror the production flow: the solver physically settled the
        // borrowed 20 ether leg, so register its repayment claim.
        vm.prank(address(router));
        hook.registerSolverDebt(key.toId(), address(this), solver, 20 ether);
    }

    function _makeLiquidatable() internal {
        // SHORT collateral is currency1 (token1), debt is currency0 (token0).
        priceFeed.setPrice(address(token1), 0.5e18);
        priceFeed.setPrice(address(token0), 1e18);

        // Fund the hook so the unwind's surplus transfer can settle (mock take() is a no-op).
        token0.mint(address(hook), 50 ether);
        token1.mint(address(hook), 50 ether);

        // Mock the liquidation swap to return 30 ether of token0 (debt currency).
        manager.setNextSwapDelta(30 ether, -28 ether);
    }

    function test_LiquidatorIncentive_DefaultDisabled_InsuranceOnly() public {
        _openShort();
        _makeLiquidatable();

        uint256 liquidatorBefore = token0.balanceOf(liquidator);
        uint256 traderBefore = token0.balanceOf(address(this));

        vm.prank(liquidator);
        router.liquidate(address(hook), key, address(this), 0);

        (address posTrader,,, uint8 lev,) = _readPosition();
        assertEq(posTrader, address(0), "position should be closed");
        assertEq(lev, 0);

        // Default incentive = 0: the liquidator earns nothing, the full 3% of the
        // post-solver surplus (30 received - 20 repaid = 10 => 0.3 ether) is
        // credited to the insurance fund, and the trader gets the remainder.
        assertEq(
            token0.balanceOf(liquidator) - liquidatorBefore, 0, "default: no direct liquidator incentive"
        );
        assertEq(hook.insuranceFund(key.currency0), 0.3 ether, "3% reward lands in the insurance fund");
        // Solver repaid 20, insurance 0.3, trader 9.7 = full 30 ether unwind.
        assertEq(token0.balanceOf(solver), 20 ether, "solver principal repaid");
        assertEq(token0.balanceOf(address(this)) - traderBefore, 9.7 ether, "trader keeps post-reward remainder");
    }

    function test_LiquidatorIncentive_Enabled_FullLiquidation() public {
        hook.setLiquidatorIncentiveBps(200); // 2% of the post-solver surplus
        _openShort();
        _makeLiquidatable();

        uint256 liquidatorBefore = token0.balanceOf(liquidator);
        uint256 traderBefore = token0.balanceOf(address(this));

        vm.prank(liquidator);
        router.liquidate(address(hook), key, address(this), 0);

        // Surplus = 30 - 20 = 10 ether. Liquidator gets 0.2 DIRECTLY, the
        // insurance fund still receives the 3% reward (0.3), solver repaid 20,
        // trader keeps 9.5.
        assertEq(
            token0.balanceOf(liquidator) - liquidatorBefore, 0.2 ether, "direct incentive paid to the liquidator"
        );
        assertEq(hook.insuranceFund(key.currency0), 0.3 ether, "insurance reward unchanged by the split");
        assertEq(token0.balanceOf(solver), 20 ether, "solver principal repaid");
        assertEq(
            token0.balanceOf(address(this)) - traderBefore, 9.5 ether, "trader payout is net of the incentive"
        );
    }

    function test_LiquidatorIncentive_Enabled_PartialLiquidation() public {
        hook.setLiquidatorIncentiveBps(200); // 2% of the post-solver surplus (partial slice too)
        _openShort();
        _makeLiquidatable();

        uint256 liquidatorBefore = token0.balanceOf(liquidator);
        uint256 traderBefore = token0.balanceOf(address(this));

        vm.prank(liquidator);
        router.partialLiquidate(address(hook), key, address(this), 0, 5000); // liquidate 50% of the position

        // 50% of the 20 ether debt = 10 ether repaid to the solver; totalSource
        // 30 => afterSolver = 20. Liquidator incentive = 0.4, insurance = 0.6,
        // trader = 19. Position SURVIVES with the remaining 10 ether of debt.
        assertEq(
            token0.balanceOf(liquidator) - liquidatorBefore, 0.4 ether, "direct incentive paid on the partial slice"
        );
        assertEq(hook.insuranceFund(key.currency0), 0.6 ether, "3% of the partial surplus to insurance");
        assertEq(token0.balanceOf(solver), 10 ether, "proportional solver share repaid");
        assertEq(token0.balanceOf(address(this)) - traderBefore, 19 ether, "remaining partial payout to trader");

        (address survivor, uint256 survivorCollateral, uint256 survivorBorrow,,) = _readPosition();
        assertEq(survivor, address(this), "partial liquidation keeps the position open");
        assertEq(survivorBorrow, 10 ether, "borrowed amount halved");
        assertTrue(survivorCollateral > 0 && survivorCollateral < 28 ether, "collateral reduced but positive");
    }

    function test_LiquidatorIncentive_Setter_OnlyOwner_And_Cap() public {
        // Only the owner may configure the incentive.
        vm.prank(address(0xBAD));
        vm.expectRevert();
        hook.setLiquidatorIncentiveBps(200);

        // The share must be strictly below 100% of the surplus.
        vm.expectRevert();
        hook.setLiquidatorIncentiveBps(10000);

        vm.expectEmit(true, true, true, true);
        emit EswapMarginHook.LiquidatorIncentiveSet(0, 300);
        hook.setLiquidatorIncentiveBps(300);
        assertEq(hook.liquidatorIncentiveBps(), 300);
    }

    function _readPosition() internal returns (address, uint256, uint256, uint8, bool) {
        (address trader, uint256 collateral, uint256 borrowed, uint8 lev, bool isLong,,,,) =
            hook.positions(key.toId(), address(this));
        return (trader, collateral, borrowed, lev, isLong);
    }
}