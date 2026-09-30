// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BaseV4Test, PriceFeedMock, ERC20Mock} from "./BaseV4Test.t.sol";
import {PoolManagerCallbackMock} from "./mocks/PoolManagerMock.sol";
import {EswapMarginHook} from "../EswapMarginHook.sol";
import {EswapRouter} from "../EswapRouter.sol";
import {EswapRouterExt, IPriceFeedForTrigger} from "../EswapRouterExt.sol";
import {EswapSettlement} from "../EswapSettlement.sol";
import {PoolKey} from "../types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "../types/PoolId.sol";
import {Currency} from "../types/Currency.sol";
import {EswapHookDeployLib} from "./EswapHookDeployLib.sol";

/// @title EswapTriggerOrderTest
/// @notice [P0#2] Signed limit / stop-loss `TriggerOrder` tests.
///
///         The trader signs an EIP-712 conditional close pinning the exact pool,
///         trigger price, direction, payout floor, nonce and expiry. Anyone may
///         arm/cancel (arm requires the trader's own signature) and ANY keeper may
///         execute once the pool's Chainlink-anchored market price crosses the
///         signed trigger — provided the position is not liquidatable (liquidation
///         always wins).
contract EswapTriggerOrderTest is BaseV4Test {
    using PoolIdLibrary for PoolKey;

    EswapRouter public router;
    EswapRouterExt public ext;
    EswapSettlement public settlement;
    PoolKey public standardPoolKey;

    uint256 public constant TRADER_PK = 0xA11CE;
    address public trader;
    address public filler;
    address public keeper = address(0xCAFE);

    function setUp() public override {
        manager = new PoolManagerCallbackMock();
        priceFeed = new PriceFeedMock();

        token0 = new ERC20Mock("Token 0", "TK0");
        token1 = new ERC20Mock("Token 1", "TK1");

        address hookAddress = address(uint160((1 << 159) | (1 << 158) | (1 << 153) | (1 << 152) | (1 << 148)));
        (address _hookLogic, address _hookLogic2) = EswapHookDeployLib.deployLogic(address(manager), address(priceFeed));
        deployCodeTo("EswapMarginHook.sol:EswapMarginHook", abi.encode(manager, priceFeed, _hookLogic, _hookLogic2, address(this)), hookAddress);
        hook = EswapMarginHook(payable(hookAddress));

        router = new EswapRouter(manager);
        ext = new EswapRouterExt(manager, address(router));
        router.setRouterExt(address(ext));

        key = PoolKey({
            currency0: Currency.wrap(address(token0)),
            currency1: Currency.wrap(address(token1)),
            fee: 3000,
            tickSpacing: 60,
            hooks: address(hook)
        });

        standardPoolKey =
            PoolKey({currency0: key.currency0, currency1: key.currency1, fee: 500, tickSpacing: 60, hooks: address(0)});

        hook.setRouterAndMinCollateralUsd(address(router), 0);
        hook.setAuthorizedPool(key.toId(), true);
        hook.setStandardPoolKey(key.toId(), standardPoolKey);

        manager.setSlot0(key.toId(), 1 << 96, 0);
        manager.setSlot0(standardPoolKey.toId(), 1 << 96, 0);

        settlement = new EswapSettlement(router);
        router.setSolverWhitelist(address(settlement), true);
        ext.setTriggerPriceFeed(IPriceFeedForTrigger(address(priceFeed)));

        trader = vm.addr(TRADER_PK);
        filler = makeAddr("filler");

        // Filler funds the whole notional (margin + borrow) of each open.
        token0.mint(filler, 1_000 ether);
        // The hook must physically pay solver + trader on the close unwind.
        token0.mint(address(hook), 1_000 ether);
        token1.mint(address(hook), 1_000 ether);

        vm.startPrank(filler);
        token0.approve(address(settlement), type(uint256).max);
        vm.stopPrank();
    }

    // ─── Helpers ──────────────────────────────────────────────────────────────

    /// @dev Opens a 10 ether margin, 2x SHORT-token1 position for `trader`.
    ///      Borrow = 10 ether token0, collateral = 19.104 ether token1 (after the
    ///      0.5% protocol fee on the mock's 19.2 ether fill output).
    function _open() internal {
        bytes memory originData = abi.encode(
            key,
            standardPoolKey,
            true,
            int256(10 ether),
            uint8(2),
            address(0),
            abi.encode(true, uint8(2), trader),
            uint256(0)
        );
        vm.prank(filler);
        settlement.fill(keccak256(abi.encode("trigger-order", block.timestamp, trader)), originData, "");
    }

    function _order(uint256 nonce, uint256 triggerPrice18, bool aboveOrBelow, uint256 minAmountOut, uint256 deadline)
        internal
        view
        returns (EswapRouterExt.TriggerOrder memory)
    {
        return EswapRouterExt.TriggerOrder({
            poolId: PoolId.unwrap(key.toId()),
            triggerPrice18: triggerPrice18,
            aboveOrBelow: aboveOrBelow,
            minAmountOut: minAmountOut,
            closeDeadline: deadline,
            nonce: nonce,
            executorTipBps: 100
        });
    }

    function _sign(EswapRouterExt.TriggerOrder memory order, uint256 pk) internal view returns (bytes memory) {
        bytes32 digest =
            keccak256(abi.encodePacked("\x19\x01", ext.DOMAIN_SEPARATOR(), ext.hashTriggerOrder(order)));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _arm(EswapRouterExt.TriggerOrder memory order) internal {
        bytes memory sig = _sign(order, TRADER_PK);
        vm.prank(trader);
        ext.armTriggerOrder(key, order, sig);
    }

    function _setMarket(uint256 price0, uint256 price1) internal {
        priceFeed.setPrice(address(token0), price0);
        priceFeed.setPrice(address(token1), price1);
    }

    function _collateral() internal view returns (uint256 c) {
        (, c,,,,,,,) = hook.positions(key.toId(), trader);
    }

    /// @dev Returns the armed order's expiry (0 = no armed order). The public
    ///      mapping getter destructures the struct to a 7-tuple.
    function _armedDeadline() internal view returns (uint256 d) {
        (,,,, d,,) = ext.armedTriggerOrders(trader, PoolId.unwrap(key.toId()));
    }

    // ─── Arming ───────────────────────────────────────────────────────────────

    function test_TriggerOrder_Arm_StoresSignedOrder() public {
        _open();
        EswapRouterExt.TriggerOrder memory order = _order(1, 1.4e18, true, 0, block.timestamp + 1 days);
        _arm(order);

        (bytes32 poolId, uint256 trigger, bool above,,, uint256 nonce,) = ext.armedTriggerOrders(
            trader, PoolId.unwrap(key.toId())
        );
        assertEq(poolId, PoolId.unwrap(key.toId()));
        assertEq(trigger, 1.4e18);
        assertTrue(above);
        assertEq(nonce, 1);
    }

    function test_TriggerOrder_Arm_OnlyTraderSignature() public {
        _open();
        EswapRouterExt.TriggerOrder memory order = _order(2, 1.4e18, true, 0, block.timestamp + 1 days);
        bytes memory sig = _sign(order, TRADER_PK);
        vm.prank(makeAddr("stranger"));
        vm.expectRevert(EswapRouterExt.InvalidTriggerOrderSignature.selector);
        ext.armTriggerOrder(key, order, sig);
    }

    function test_TriggerOrder_Arm_InvalidSignatureReverts() public {
        _open();
        EswapRouterExt.TriggerOrder memory order = _order(3, 1.4e18, true, 0, block.timestamp + 1 days);
        bytes memory sig = _sign(order, 0xBADD);
        vm.prank(trader);
        vm.expectRevert(EswapRouterExt.InvalidTriggerOrderSignature.selector);
        ext.armTriggerOrder(key, order, sig);
    }

    function test_TriggerOrder_Arm_PoolMismatchReverts() public {
        _open();
        EswapRouterExt.TriggerOrder memory order = _order(4, 1.4e18, true, 0, block.timestamp + 1 days);
        order.poolId = keccak256("wrong-pool");
        bytes memory sig = _sign(order, TRADER_PK);
        vm.prank(trader);
        vm.expectRevert(EswapRouterExt.TriggerOrderPoolMismatch.selector);
        ext.armTriggerOrder(key, order, sig);
    }

    function test_TriggerOrder_Arm_ExpiredReverts() public {
        _open();
        EswapRouterExt.TriggerOrder memory order = _order(5, 1.4e18, true, 0, block.timestamp - 1);
        bytes memory sig = _sign(order, TRADER_PK);
        vm.prank(trader);
        vm.expectRevert(EswapRouterExt.TriggerOrderExpired.selector);
        ext.armTriggerOrder(key, order, sig);
    }

    // ─── Execution ────────────────────────────────────────────────────────────

    function test_TriggerOrder_Execute_AboveTrigger() public {
        _open();
        assertGt(_collateral(), 0, "position must exist");

        // market = p0 / p1 = 1.4. Trigger at 1.4 (>=) fires; 2x position's
        // liquidation boundary is ~1.647, so it stays healthy.
        _setMarket(1.4e18, 1e18);
        EswapRouterExt.TriggerOrder memory order = _order(10, 1.4e18, true, 0, block.timestamp + 1 days);
        _arm(order);

        uint256 solverBefore = token0.balanceOf(address(settlement));
        vm.prank(keeper);
        ext.executeTriggerOrder(address(hook), key, trader);

        assertEq(_collateral(), 0, "position must be closed by the trigger");
        // Solver repaid the 10 ether borrow principal.
        assertEq(token0.balanceOf(address(settlement)), solverBefore + 10 ether, "solver repaid");
        assertEq(_armedDeadline(), 0, "order cleared");
    }

    function test_TriggerOrder_Execute_BelowTrigger() public {
        _open();

        // Default market = 1.0; trigger at 0.8 going below -> not initially the
        // case, but p1 rising to 1.4 pushes market to ~0.714 < 0.8.
        _setMarket(1e18, 1.4e18);
        EswapRouterExt.TriggerOrder memory order = _order(11, 0.8e18, false, 0, block.timestamp + 1 days);
        _arm(order);

        vm.prank(keeper);
        ext.executeTriggerOrder(address(hook), key, trader);
        assertEq(_collateral(), 0, "position must be closed by the stop-below trigger");
    }

    function test_TriggerOrder_NotHit_RevertsAndStaysArmed() public {
        _open();
        _setMarket(1e18, 1e18); // market = 1.0
        EswapRouterExt.TriggerOrder memory order = _order(12, 2e18, true, 0, block.timestamp + 1 days);
        _arm(order);

        vm.prank(keeper);
        vm.expectRevert(EswapRouterExt.TriggerNotHit.selector);
        ext.executeTriggerOrder(address(hook), key, trader);

        assertGt(_collateral(), 0, "position untouched");
        assertGt(_armedDeadline(), 0, "order still armed after a no-op");
    }

    function test_TriggerOrder_NoArmedOrder_Reverts() public {
        _open();
        vm.expectRevert(EswapRouterExt.NoArmedTriggerOrder.selector);
        vm.prank(keeper);
        ext.executeTriggerOrder(address(hook), key, trader);
    }

    function test_TriggerOrder_NoPosition_Reverts() public {
        _setMarket(1.4e18, 1e18);
        EswapRouterExt.TriggerOrder memory order = _order(13, 1.4e18, true, 0, block.timestamp + 1 days);
        _arm(order); // arming does not require an open position

        vm.prank(keeper);
        vm.expectRevert(EswapRouterExt.NoActivePosition.selector);
        ext.executeTriggerOrder(address(hook), key, trader);
    }

    function test_TriggerOrder_Expired_Reverts() public {
        _open();
        _setMarket(1.4e18, 1e18);
        EswapRouterExt.TriggerOrder memory order = _order(14, 1.4e18, true, 0, block.timestamp + 1 hours);
        _arm(order);

        vm.warp(block.timestamp + 2 hours);
        vm.prank(keeper);
        vm.expectRevert(EswapRouterExt.TriggerOrderExpired.selector);
        ext.executeTriggerOrder(address(hook), key, trader);
    }

    function test_TriggerOrder_Replay_Reverts() public {
        _open();
        _setMarket(1.4e18, 1e18);
        EswapRouterExt.TriggerOrder memory order = _order(15, 1.4e18, true, 0, block.timestamp + 1 days);
        _arm(order);

        vm.prank(keeper);
        ext.executeTriggerOrder(address(hook), key, trader);

        // Re-arm the SAME nonce: execution must be impossible to replay.
        _arm(order);
        vm.prank(keeper);
        vm.expectRevert(EswapRouterExt.TriggerOrderAlreadyExecuted.selector);
        ext.executeTriggerOrder(address(hook), key, trader);
    }

    function test_TriggerOrder_PriceFeedNotSet_Reverts() public {
        _open();
        _setMarket(1.4e18, 1e18);
        EswapRouterExt.TriggerOrder memory order = _order(16, 1.4e18, true, 0, block.timestamp + 1 days);
        _arm(order);

        ext.setTriggerPriceFeed(IPriceFeedForTrigger(address(0)));
        vm.prank(keeper);
        vm.expectRevert(EswapRouterExt.TriggerPriceFeedNotSet.selector);
        ext.executeTriggerOrder(address(hook), key, trader);
    }

    // ─── HIGH-02: a signed stop-loss wins over liquidation preemption ─────────

    /// @dev [AUDIT HIGH-02] Regression: a trigger close must execute even while
    ///      the position is liquidatable. The trigger is the trader's own signed
    ///      exit (still enforcing their minAmountOut floor); blocking it in
    ///      exactly the crash window hands the trader to a liquidator's fee and
    ///      collateral seizure despite their stop-loss protection.
    function test_TriggerOrder_ExecutesEvenWhenLiquidatable() public {
        _open();
        // market = 2.0 is well past the 2x liquidation boundary (~1.647), so the
        // position IS liquidatable — yet the signed trigger must still fire.
        _setMarket(2e18, 1e18);
        assertTrue(hook.isPositionLiquidatable(key, trader), "position must be liquidatable");

        EswapRouterExt.TriggerOrder memory order = _order(17, 1.5e18, true, 0, block.timestamp + 1 days);
        _arm(order);

        uint256 solverBefore = token0.balanceOf(address(settlement));
        vm.prank(keeper);
        ext.executeTriggerOrder(address(hook), key, trader);

        assertEq(_collateral(), 0, "trigger close executed inside the liquidation window");
        assertEq(token0.balanceOf(address(settlement)), solverBefore + 10 ether, "solver repaid");
        assertEq(_armedDeadline(), 0, "order cleared");
    }

    /// @dev [AUDIT HIGH-02] A trigger that has NOT crossed the market must still
    ///      revert even if the position became liquidatable in between — only a
    ///      price that actually crossed the signed level may fire the close.
    function test_TriggerOrder_Liquidatable_NotHitStillReverts() public {
        _open();
        _setMarket(2e18, 1e18);
        assertTrue(hook.isPositionLiquidatable(key, trader), "position must be liquidatable");

        // Trigger at 3.0 (market 2.0 < 3.0): not hit, though the position is
        // liquidatable. Must not close.
        EswapRouterExt.TriggerOrder memory order = _order(21, 3e18, true, 0, block.timestamp + 1 days);
        _arm(order);

        vm.prank(keeper);
        vm.expectRevert(EswapRouterExt.TriggerNotHit.selector);
        ext.executeTriggerOrder(address(hook), key, trader);

        assertGt(_collateral(), 0, "position untouched until the trigger is hit");
    }

    // ─── Cancel ───────────────────────────────────────────────────────────────

    function test_TriggerOrder_Cancel_ByTrader() public {
        _open();
        EswapRouterExt.TriggerOrder memory order = _order(18, 1.4e18, true, 0, block.timestamp + 1 days);
        _arm(order);

        vm.prank(trader);
        ext.cancelTriggerOrder(trader, key);
        assertEq(_armedDeadline(), 0, "order cleared");

        vm.prank(keeper);
        vm.expectRevert(EswapRouterExt.NoArmedTriggerOrder.selector);
        ext.executeTriggerOrder(address(hook), key, trader);
    }

    function test_TriggerOrder_Cancel_UnauthorizedReverts() public {
        _open();
        EswapRouterExt.TriggerOrder memory order = _order(19, 1.4e18, true, 0, block.timestamp + 1 days);
        _arm(order);

        vm.prank(makeAddr("stranger"));
        vm.expectRevert(EswapRouterExt.NotOwner.selector);
        ext.cancelTriggerOrder(trader, key);
    }

    // ─── The trader's signed payout floor is enforced ─────────────────────────

    function test_TriggerOrder_MinAmountOutEnforced() public {
        _open();
        _setMarket(1.4e18, 1e18);
        // Mock close unwind pays ~18.3 ether token0, minus 10 borrow = ~8.3 net.
        // An 100 ether floor can never be met.
        EswapRouterExt.TriggerOrder memory order = _order(20, 1.4e18, true, 100 ether, block.timestamp + 1 days);
        _arm(order);

        vm.prank(keeper);
        vm.expectRevert();
        ext.executeTriggerOrder(address(hook), key, trader);
        assertGt(_collateral(), 0, "reverted close leaves the position intact");
    }
}
