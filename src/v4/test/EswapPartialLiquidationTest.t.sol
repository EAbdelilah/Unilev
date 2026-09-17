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
import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";

/// @notice [P1#3] Partial-liquidation coverage: a proportional slice of an
///         underwater position is liquidated while the remainder stays open.
contract EswapPartialLiquidationTest is BaseV4Test {
    using PoolIdLibrary for PoolKey;

    EswapRouter public router;

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
    }

    function _makeLiquidatable() internal {
        priceFeed.setPrice(address(token1), 0.5e18);
        priceFeed.setPrice(address(token0), 1e18);
        token0.mint(address(hook), 50 ether);
        token1.mint(address(hook), 50 ether);
        manager.setNextSwapDelta(30 ether, -28 ether);
    }

    // `positions` returns a 9-tuple:
    // (trader, collateralAmount, borrowedAmount, leverage, isLong,
    //  liquidationSqrtPrice, tickLower, tickUpper, liquidity)
    function _collateral() internal view returns (uint256) {
        (,uint256 c,,,,,,,) = hook.positions(key.toId(), address(this));
        return c;
    }

    function _borrowed() internal view returns (uint256) {
        (,,uint256 b,,,,,,) = hook.positions(key.toId(), address(this));
        return b;
    }

    function _trader() internal view returns (address) {
        (address t,,,,,,,,) = hook.positions(key.toId(), address(this));
        return t;
    }

    function test_PartialLiquidate_ShrinksInPlace() public {
        _openShort();
        uint256 c0 = _collateral(); // 28 ether net of the 50-bps protocol reserve
        _makeLiquidatable();

        router.partialLiquidate(address(hook), key, address(this), 0, 5000);

        // 5000 bps slice + 500 bps cover: seized = c0 * 0.5 * 1.05.
        uint256 liqCollateral = FullMath.mulDiv(FullMath.mulDiv(c0, 5000, 10000), 10500, 10000);
        assertEq(_collateral(), c0 - liqCollateral, "collateral should slim to remaining stake");
        assertEq(_borrowed(), 10 ether, "debt should be sliced by exactly the requested bps");
        // Position survives.
        address trader = _trader();
        assertEq(trader, address(this), "position must remain open after a partial");
        // Reward (300 bps of post-solver surplus = 0.3 * (30-10) = 0.6) to insurance.
        assertEq(hook.insuranceFund(key.currency0), 0.6 ether, "insurance accrues the liquidation reward");
    }

    function test_PartialLiquidate_TwoSlices_ThenFullLiquidation() public {
        _openShort();
        uint256 c0 = _collateral();
        _makeLiquidatable();

        router.partialLiquidate(address(hook), key, address(this), 0, 5000);
        uint256 c1 = _collateral();
        router.partialLiquidate(address(hook), key, address(this), 0, 5000);

        uint256 liq1 = FullMath.mulDiv(FullMath.mulDiv(c0, 5000, 10000), 10500, 10000);
        uint256 liq2 = FullMath.mulDiv(FullMath.mulDiv(c1, 5000, 10000), 10500, 10000);
        assertEq(_collateral(), c0 - liq1 - liq2, "two slices leave only the residual stake");
        assertEq(_borrowed(), 5 ether, "two slices halve the debt");
        assertTrue(hook.isPositionLiquidatable(key, address(this)), "residual position is still underwater");

        // Repeated partial-liquidation is safe because full liquidation re-checks.
        _makeLiquidatable();
        router.liquidate(address(hook), key, address(this), 0);

        address trader = _trader();
        assertEq(trader, address(0), "full liquidation clears the residual position");
        assertEq(_collateral(), 0);
        assertEq(_borrowed(), 0);
    }

    function test_PartialLiquidate_HealthyPosition_Reverts() public {
        _openShort();
        _makeLiquidatable();
        priceFeed.setPrice(address(token1), 1.5e18); // healthy again
        vm.expectRevert(abi.encodeWithSignature("PositionNotLiquidatable()"));
        router.partialLiquidate(address(hook), key, address(this), 0, 5000);
    }

    function test_PartialLiquidate_InvalidBps_Reverts() public {
        _openShort();
        _makeLiquidatable();
        vm.expectRevert(abi.encodeWithSignature("InvalidLiquidationBps()"));
        router.partialLiquidate(address(hook), key, address(this), 0, 0);
        vm.expectRevert(abi.encodeWithSignature("InvalidLiquidationBps()"));
        router.partialLiquidate(address(hook), key, address(this), 0, 10000);
    }

    function test_PartialLiquidate_MinAmountOut_Enforced() public {
        _openShort();
        _makeLiquidatable();
        // The unwind yields 30 ether of debt currency; demand 31 ether → revert.
        vm.expectRevert(abi.encodeWithSignature("SlippageExceeded(uint256,uint256)", 30 ether, 31 ether));
        router.partialLiquidate(address(hook), key, address(this), 31 ether, 5000);
    }

    function test_PartialLiquidate_OnlyRouter() public {
        _openShort();
        _makeLiquidatable();
        vm.expectRevert(abi.encodeWithSignature("Unauthorized()"));
        hook.partialLiquidation(key, address(this), 0, address(this), 5000);
    }

    function test_PartialLiquidate_CloseRemainderAfterPartial() public {
        _openShort();
        _makeLiquidatable();
        router.partialLiquidate(address(hook), key, address(this), 0, 5000);

        // Trader closes the surviving stake via the normal close path.
        router.closePosition(address(hook), key, address(this), address(0), 0);

        address trader = _trader();
        assertEq(trader, address(0), "remainder closes through the standard path");
    }
}
