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
import {EswapHookDeployLib} from "./EswapHookDeployLib.sol";

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
        (address _hookLogic, address _hookLogic2) = EswapHookDeployLib.deployLogic(address(manager), address(priceFeed));
        deployCodeTo("EswapMarginHook.sol:EswapMarginHook", abi.encode(manager, priceFeed, _hookLogic, _hookLogic2, address(this)), hookAddress);
        hook = EswapMarginHook(payable(hookAddress));

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
        // boughtAmount = 28 ether (delta.amount1()), positionCollateral = 28 - reserve.
        // Need 2× positionCollateral for _settleTransientDebt + _settle burns.
        manager.mint(address(hook), uint256(uint160(address(token1))), 28 ether * 2);
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

        (address trader, uint256 collateral,,,,,,,) = hook.positions(key.toId(), address(this));
        assertEq(trader, address(0), "position should be liquidated");
        assertEq(collateral, 0);
        // [FIX H-5b] The 3% liquidation reward is routed EXCLUSIVELY to the
        // insurance fund, whoever triggers the liquidation. Surplus =
        // 30 received − 20 repaid = 10, reward = 3% = 0.3 ether lands in
        // the insurance fund; the executing keeper is not paid.
        assertEq(token0.balanceOf(address(keeper)), 0, "liquidator is not paid; reward goes to insurance");
        assertEq(token0.balanceOf(address(automation)), 0, "automation (trigger) writes nothing");
        assertEq(hook.insuranceFund(key.currency0), 0.3 ether, "3% liquidation reward lands in the insurance fund");
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

        uint256[] memory liquidated = keeper.liquidateAll();
        assertEq(liquidated.length, keeper.watchesLength(), "array is 1:1 with the watch list");
        assertEq(liquidated[0], 1, "watched slot was liquidated this round");

        (address trader, uint256 collateral,,,,,,,) = hook.positions(key.toId(), address(this));
        assertEq(trader, address(0));
        assertEq(collateral, 0);

        // [P1#4] The watch persists across races (nothing deleted on success):
        // a second call must not double-liquidate, but the slot still reports 0.
        vm.expectRevert(EswapLiquidationKeeper.NoLiquidatablePositions.selector);
        keeper.liquidateAll();
    }

    function test_Keeper_MaxWatches_Cap() public {
        // 200 legal watches fill the list...
        for (uint256 i = 0; i < 200; i++) {
            keeper.addWatch(key, address(uint160(0x1000 + i)));
        }
        assertEq(keeper.watchesLength(), 200);
        // ...the 201st is rejected.
        vm.expectRevert(abi.encodeWithSelector(EswapLiquidationKeeper.MaxWatchesReached.selector, 200));
        keeper.addWatch(key, address(uint160(0x9999)));
        assertEq(keeper.watchesLength(), 200);
    }

    function test_Keeper_Race_DoubleLiquidate_SecondWins() public {
        _openShort();
        _makeLiquidatable();
        keeper.addWatch(key, address(this));

        // Keeper A liquidates the position...
        uint256[] memory first = keeper.liquidateAll();
        assertEq(first[0], 1);

        // Keeper B races the SAME slot afterwards: the position is gone, so the
        // attempt is a reported 0 / NoLiquidatablePositions — never a revert the
        // automation cannot handle, never a double payout.
        vm.expectRevert(EswapLiquidationKeeper.NoLiquidatablePositions.selector);
        keeper.liquidateAll();

        // Single-position entrypoint behaves identically: no splash revert.
        vm.expectRevert(EswapLiquidationKeeper.PositionNotLiquidatable.selector);
        keeper.liquidate(key, address(this));
    }

    function test_Keeper_Watch_Persists_After_Liquidation() public {
        _openShort();
        _makeLiquidatable();
        keeper.addWatch(key, address(this));
        keeper.liquidateAll();
        // [P1#4] The watch survives so the slot can be re-checked / pruned by the
        // owner at leisure; it is NOT an on-chain enumeration, just a flag list.
        assertEq(keeper.watchesLength(), 1, "watch list is not emptied on liquidation");
        assertTrue(keeper.isWatched(keccak256(abi.encode(key.toId(), address(this)))));
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

    // ─── [AUDIT CRIT-09] Quote must track physical collateral ───────────

    /// @dev Deploys the rehypothecation band via the (mock) PoolManager: the
    ///      add delta returns (0, -principal) so the hook records `principal`
    ///      as the deployed LP amount, mimicking a fully deployed band.
    function _deployBand(uint256 principal) internal {
        manager.setNextModifyLiquidityDelta(0, -int128(int256(principal)));
        vm.prank(address(router));
        hook.deployCollateral(key, address(this));
        (,,,,,,,, uint128 liq) = hook.positions(key.toId(), address(this));
        assertGt(liq, 0, "band must be deployed");
        assertEq(hook.rehypPrincipal(key.toId(), address(this)), principal, "band principal recorded");
    }

    function test_Keeper_QuoteUsesPhysicalCollateralForBandedPosition() public {
        _openShort();
        (, uint256 collateral,,,,,,,) = hook.positions(key.toId(), address(this));
        assertGt(collateral, 0);

        uint256 quoteNoBand = keeper.quoteMinAmountOut(key, address(this));
        assertGt(quoteNoBand, 0, "no-band position quotes the full collateral");

        _deployBand(20 ether);

        (, uint256 collateralAfter,,,,,,,) = hook.positions(key.toId(), address(this));
        assertEq(collateralAfter, collateral, "book collateral is unchanged by the band deploy");

        // [AUDIT CRIT-09] The floor must be capped at the PHYSICAL quota the
        // unwind can actually swap: the un-deployed remainder only. The band's
        // collateral leg is recovered as debt-currency bandProceeds by the hook
        // and is conservatively excluded from the floor.
        uint256 physical = collateral - 20 ether;
        uint256 expected = (priceFeed.getAmountInUsd(address(token1), physical) * 1e18);
        expected /= priceFeed.getAmountInUsd(address(token0), 1e18);
        expected = (expected * (10000 - keeper.slippageBps())) / 10000;

        uint256 quoteBanded = keeper.quoteMinAmountOut(key, address(this));
        assertEq(quoteBanded, expected, "quote is capped at the un-deployed (physical) collateral");
        assertLt(quoteBanded, quoteNoBand, "deploying a band must shrink the physical quote");
    }

    function test_Keeper_BandedPosition_Liquidation_PassesWithPhysicalQuote() public {
        _openShort();
        (, uint256 collateral,,,,,,,) = hook.positions(key.toId(), address(this));

        _deployBand(20 ether);

        // Fund the hook so the unwind settlements can net (mirrors _makeLiquidatable).
        token0.mint(address(hook), 50 ether);
        token1.mint(address(hook), 50 ether);

        // Crash the collateral token: the position becomes liquidatable.
        priceFeed.setPrice(address(token1), 0.5e18);
        priceFeed.setPrice(address(token0), 1e18);

        // [AUDIT CRIT-09] Simulate a partially-consumed band: impermanent loss
        // converted the deployed principal to the DEBT currency at a much worse
        // price — the band removal returns 0 collateral and only `bandProceeds`
        // debt, while the un-deployed remainder is swapped at the crashed price.
        uint256 physical = collateral - 20 ether;
        uint256 swapOut = (physical * 0.5e18) / 1e18; // 50% conversion loss
        uint256 bandProceeds = 5 ether;
        uint256 totalSource = swapOut + bandProceeds;

        // Prove the PRE-fix quote (whole book, oracle-priced) overstates the
        // physical recovery and would have reverted this liquidation.
        uint256 oldQuote = (priceFeed.getAmountInUsd(address(token1), collateral) * 1e18)
            / priceFeed.getAmountInUsd(address(token0), 1e18);
        oldQuote = (oldQuote * (10000 - keeper.slippageBps())) / 10000;
        assertTrue(oldQuote > totalSource, "pre-fix quote would have reverted the liquidation (SlippageExceeded)");

        // The post-fix quote is bounded by what the unwind physically returns.
        uint256 newQuote = keeper.quoteMinAmountOut(key, address(this));
        assertTrue(newQuote <= totalSource, "physical quote must not exceed the unwind's total recovery");

        manager.setNextModifyLiquidityDelta(int128(int256(bandProceeds)), 0);
        manager.setNextSwapDelta(int128(int256(swapOut)), -int128(int256(physical)));

        keeper.addWatch(key, address(this));
        uint256[] memory liquidated = keeper.liquidateAll();
        assertEq(liquidated.length, keeper.watchesLength(), "array is 1:1 with the watch list");
        assertEq(liquidated[0], 1, "banded-position liquidation must succeed with the physical quote");

        (address trader, uint256 collateralAfter,,,,,,,) = hook.positions(key.toId(), address(this));
        assertEq(trader, address(0), "position must be liquidated");
        assertEq(collateralAfter, 0);
    }
}
