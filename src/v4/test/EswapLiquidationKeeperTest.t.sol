// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BaseV4Test, PriceFeedMock, ERC20Mock} from "./BaseV4Test.t.sol";
import {PoolManagerCallbackMock} from "./mocks/PoolManagerMock.sol";
import {EswapMarginHook} from "../EswapMarginHook.sol";
import {EswapRouter} from "../EswapRouter.sol";
import {EswapLiquidationKeeper} from "../EswapLiquidationKeeper.sol";
import {PoolKey} from "../types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "../types/PoolId.sol";
import {Currency} from "../types/Currency.sol";
import {IPoolManager} from "../interfaces/IPoolManager.sol";
import {BalanceDeltaLibrary} from "../types/BalanceDelta.sol";

contract EswapLiquidationKeeperTest is BaseV4Test {
    using PoolIdLibrary for PoolKey;

    EswapRouter public router;
    EswapLiquidationKeeper public keeper;
    address public automation = address(0xCAFE);

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
        keeper = new EswapLiquidationKeeper(address(hook), address(router));

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

    function _openShort() internal {
        // Open a 3x SHORT (zeroForOne=true): margin 10 ether, borrow 20 ether.
        bytes memory data = abi.encode(true, uint8(3), address(this));
        vm.prank(address(manager));
        hook.beforeSwap(address(this), key, IPoolManager.SwapParams(true, -10 ether, 0), data);
        vm.prank(address(manager));
        hook.afterSwap(address(this), key, IPoolManager.SwapParams(true, -30 ether, 0), BalanceDeltaLibrary.toBalanceDelta(-30 ether, 28 ether), data);
    }

    function _makeLiquidatable() internal {
        // SHORT collateral is currency1 (token1), debt is currency0 (token0).
        // Drop token1 price to make the position liquidatable per isLiquidatable.
        priceFeed.setPrice(address(token1), 0.5e18);
        priceFeed.setPrice(address(token0), 1e18);

        // Fund the hook so the unwind's surplus transfer can settle (mock take() is a no-op).
        token0.mint(address(hook), 50 ether);
        token1.mint(address(hook), 50 ether);
        
        // Mock the liquidation swap to return 30 ether of token0 (debt currency) to satisfy the receivedAmount > totalPayout check
        manager.setNextSwapDelta(30 ether, -28 ether);
    }

    function test_Keeper_WatchList_Automation() public {
        _openShort();
        _makeLiquidatable();
        keeper.addWatch(key, address(this));

        (bool upkeepNeeded, bytes memory performData) = keeper.checkUpkeep("");
        assertTrue(upkeepNeeded, "position should be flagged for liquidation");
        assertTrue(performData.length > 0);

        vm.prank(automation);
        keeper.performUpkeep(performData);

        (address trader, uint256 collateral, , , , , , , ) = hook.positions(key.toId(), address(this));
        assertEq(trader, address(0), "position should be liquidated");
        assertEq(collateral, 0);
        // Keeper earns NOTHING: nobody profits from a trader's penalty.
        assertEq(token0.balanceOf(address(keeper)), 0, "keeper must not profit from penalties");
        assertEq(token0.balanceOf(address(automation)), 0, "automation must not profit from penalties");
        // Recovered 30, repaid the 20 borrow → surplus 10 → 3% = 0.3 ether to insurance
        assertEq(hook.insuranceFund(key.currency0), 0.3 ether, "3% recovery routed to insurance fund");
    }

    function test_Keeper_CheckData_OffChainCandidates() public {
        _openShort();
        _makeLiquidatable();

        PoolKey[] memory scanKeys = new PoolKey[](2);
        address[] memory scanTraders = new address[](2);
        scanKeys[0] = key;
        scanTraders[0] = address(this);
        scanKeys[1] = key;
        scanTraders[1] = address(0xDEAD); // no position → not liquidatable

        (bool upkeepNeeded, bytes memory performData) = keeper.checkUpkeep(abi.encode(scanKeys, scanTraders));
        assertTrue(upkeepNeeded);

        (PoolKey[] memory liqKeys, address[] memory liqTraders, uint256[] memory minOuts) =
            abi.decode(performData, (PoolKey[], address[], uint256[]));
        assertEq(liqKeys.length, 1, "only the real position should be reported");
        assertEq(liqTraders[0], address(this));
        assertTrue(minOuts[0] > 0, "oracle-derived minAmountOut should be non-zero");
    }

    function test_Keeper_LiquidateAll_Permissionless() public {
        _openShort();
        _makeLiquidatable();
        keeper.addWatch(key, address(this));

        uint256 count = keeper.liquidateAll();
        assertEq(count, 1);

        (address trader, uint256 collateral, , , , , , , ) = hook.positions(key.toId(), address(this));
        assertEq(trader, address(0));
        assertEq(collateral, 0);
    }

    function test_Keeper_NoLiquidatablePositions_Reverts() public {
        _openShort();
        _makeLiquidatable();
        keeper.addWatch(key, address(this));

        // Restore token1 price so the position is healthy again.
        priceFeed.setPrice(address(token1), 1.5e18);

        (bool upkeepNeeded, bytes memory performData) = keeper.checkUpkeep("");
        assertFalse(upkeepNeeded, "healthy position should not be flagged");
        assertEq(performData.length, 0);

        vm.expectRevert(EswapLiquidationKeeper.NoLiquidatablePositions.selector);
        keeper.liquidateAll();
    }

    function test_Keeper_OnlyOwner_CanAddWatch() public {
        vm.prank(address(0xBAD));
        vm.expectRevert();
        keeper.addWatch(key, address(this));

        keeper.addWatch(key, address(this));
        assertEq(keeper.watchesLength(), 1);
    }
}
