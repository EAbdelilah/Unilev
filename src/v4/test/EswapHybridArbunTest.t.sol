// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BaseV4Test} from "./BaseV4Test.t.sol";
import {PoolKey} from "../types/PoolKey.sol";
import {EswapRouter} from "../EswapRouter.sol";
import {EswapMarginHook} from "../EswapMarginHook.sol";
import {PoolId, PoolIdLibrary} from "../types/PoolId.sol";
import {Currency} from "../types/Currency.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {PoolManagerRealTokenMock} from "./mocks/PoolManagerMock.sol";
import {IPoolManager} from "../interfaces/IPoolManager.sol";
import {BalanceDeltaLibrary} from "../types/BalanceDelta.sol";

contract EswapHybridArbunTest is BaseV4Test {
    using PoolIdLibrary for PoolKey;

    address trader = address(0x1111);
    address solver = address(0x2222);
    EswapRouter public router;

    function setUp() public override {
        super.setUp();

        router = new EswapRouter(manager);
        hook.setRouterAndMinCollateralUsd(address(router), 0);

        // Fund trader & solver
        deal(Currency.unwrap(key.currency0), trader, 100 ether);
        deal(Currency.unwrap(key.currency0), solver, 500 ether);
        deal(Currency.unwrap(key.currency1), address(manager), 1000 ether);

        vm.prank(trader);
        IERC20(Currency.unwrap(key.currency0)).approve(address(router), type(uint256).max);

        vm.prank(solver);
        IERC20(Currency.unwrap(key.currency0)).approve(address(router), type(uint256).max);
    }

    function test_HybridArbun_PositionExecutionAndPhysicalDelivery() public {
        uint256 marginAmount = 1 ether;
        uint8 leverage = 3;

        bytes memory hookData = abi.encode(true, leverage, trader);
        int128 totalSize = -int128(uint128(marginAmount * leverage));
        int128 bought = int128(uint128((marginAmount * leverage * 96) / 100));

        priceFeed.setPrice(address(token0), 1e18);
        priceFeed.setPrice(address(token1), 1e18);
        manager.setSlot0(key.toId(), 79228162514264337593543950336, 0);

        // Execute beforeSwap and afterSwap as manager
        vm.prank(address(manager));
        hook.beforeSwap(address(this), key, IPoolManager.SwapParams(false, int128(uint128(marginAmount)), 0), hookData);

        vm.prank(address(manager));
        hook.afterSwap(
            address(this),
            key,
            IPoolManager.SwapParams(false, totalSize, 0),
            BalanceDeltaLibrary.toBalanceDelta(-totalSize, -bought),
            hookData
        );

        // Verify position was opened
        (address posTrader, uint256 collateral, uint256 borrow, uint8 posLev, bool isLong,,,,) =
            hook.positions(key.toId(), trader);

        assertEq(posTrader, trader, "Trader mismatch");
        assertGt(collateral, 0, "Collateral should be positive");
        assertEq(borrow, 2 ether, "Borrow should be 2x margin");
        assertEq(posLev, leverage, "Leverage mismatch");
        assertFalse(hook.isSyntheticArbun(key.toId(), trader), "Standard swap initially physical");

        // Exercise physical Arbun delivery option via Router
        vm.prank(address(router));
        hook.executeArbunDelivery(key, trader);

        assertFalse(hook.isSyntheticArbun(key.toId(), trader), "Position delivered physically");
    }

    function test_0PercentFundingRate_InvariantAcrossTime() public {
        // Shariah Riba Invariant: Time passage must NOT increase debt principal or charge interest
        uint256 marginAmount = 1 ether;
        uint8 leverage = 4;

        bytes memory hookData = abi.encode(true, leverage, trader);

        EswapRouter.SwapParams memory params = EswapRouter.SwapParams({
            key: key,
            standardPoolKey: key,
            zeroForOne: true,
            amountSpecified: -int256(marginAmount),
            leverage: leverage,
            solver: solver,
            hookData: hookData
        });

        vm.prank(trader);
        router.swap(params);

        (,, uint256 borrowBefore,,,,,,) = hook.positions(key.toId(), trader);

        // Fast forward 30 days
        vm.warp(block.timestamp + 30 days);

        (,, uint256 borrowAfter,,,,,,) = hook.positions(key.toId(), trader);

        // Debt remains identical (0% Riba, 0% variable funding fee)
        assertEq(borrowBefore, borrowAfter, "Riba Invariant Violated: Borrow principal must remain 0% interest");
    }
}
