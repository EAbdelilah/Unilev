// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BaseV4Test, PriceFeedMock, ERC20Mock} from "./BaseV4Test.t.sol";
import {PoolManagerCallbackMock, PoolManagerRealTokenMock} from "./mocks/PoolManagerMock.sol";
import {EswapMarginHook} from "../EswapMarginHook.sol";
import {EswapRouter} from "../EswapRouter.sol";
import {EswapRouterExt} from "../EswapRouterExt.sol";
import {IPriceFeedForTrigger} from "../EswapRouterExt.sol";
import {EswapSettlement} from "../EswapSettlement.sol";
import {EswapLeverageAdapter} from "../EswapLeverageAdapter.sol";
import {EswapMarginHookLogic} from "../EswapMarginHookLogic.sol";
import {PoolKey} from "../types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "../types/PoolId.sol";
import {Currency} from "../types/Currency.sol";
import {EswapHookDeployLib} from "./EswapHookDeployLib.sol";
import {Test} from "forge-std/Test.sol";

/// @notice Third-audit (adversarial economic / multi-block MEV) PoCs.
///         All tests run on the mock PoolManager: no fork / RPC required.
contract AuditThirdAdversarialPoC is BaseV4Test {
    using PoolIdLibrary for PoolKey;

    EswapRouter public router;
    EswapLeverageAdapter public adapter;
    EswapSettlement public settlement;
    PoolKey public standardPoolKey;

    address public solver;

    function setUp() public override {
        manager = new PoolManagerCallbackMock();
        priceFeed = new PriceFeedMock();

        token0 = new ERC20Mock("Token 0", "TK0");
        token1 = new ERC20Mock("Token 1", "TK1");

        address hookAddress = address(uint160((1 << 159) | (1 << 158) | (1 << 153) | (1 << 152) | (1 << 148)));
        (address _hookLogic, address _hookLogic2) = EswapHookDeployLib.deployLogic(address(manager), address(priceFeed));
        deployCodeTo(
            "EswapMarginHook.sol:EswapMarginHook",
            abi.encode(manager, priceFeed, _hookLogic, _hookLogic2, address(this)),
            hookAddress
        );
        hook = EswapMarginHook(payable(hookAddress));

        router = new EswapRouter(manager);
        adapter = new EswapLeverageAdapter(router);
        settlement = new EswapSettlement(router);

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
        EswapMarginHookLogic(payable(address(hook))).setAuthorizedPool(key.toId(), true);
        EswapMarginHookLogic(payable(address(hook))).setStandardPoolKey(key.toId(), standardPoolKey);

        manager.setSlot0(key.toId(), 1 << 96, 0);
        manager.setSlot0(standardPoolKey.toId(), 1 << 96, 0);

        router.setExecutorWhitelist(address(adapter), true);
        router.setSolverWhitelist(address(settlement), true);

        solver = makeAddr("solver");
        router.setSolverWhitelist(solver, true);
        adapter.registerPool(address(token0), address(token1), 3000, key, standardPoolKey);
        adapter.setDefaultSolver(solver);

        token0.mint(solver, 10_000 ether);
        vm.startPrank(solver);
        token0.approve(address(router), type(uint256).max);
        vm.stopPrank();

        token0.mint(address(hook), 10_000 ether);
        token1.mint(address(hook), 10_000 ether);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PoC 1 — third-party forced open is now blocked (F-02)
    // ─────────────────────────────────────────────────────────────────────────

    function test_PoC_Adapter_ThirdPartyForcedOpen_Blocked() public {
        address victim = makeAddr("victim");
        address attacker = makeAddr("attacker");

        token0.mint(victim, 1_000 ether);
        vm.prank(victim);
        token0.approve(address(router), type(uint256).max);

        uint8 leverage = 5;
        uint256 margin = 10 ether;
        manager.setNextSwapDelta(-int128(int256(margin * leverage)), 47 ether);

        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(EswapLeverageAdapter.ExecutorNotApproved.selector, victim, attacker));
        adapter.exactInputSingleWithLeverage(address(token0), address(token1), 3000, leverage, margin, 0, victim);

        // Victim untouched.
        assertEq(token0.balanceOf(victim), 1_000 ether, "victim balance untouched");
        (address posTrader,,,,,,,,) = hook.positions(key.toId(), victim);
        assertEq(posTrader, address(0), "no position opened for victim");

        // After the victim approves the executor, a third party may act on their
        // behalf.
        vm.prank(victim);
        adapter.setExecutorApproval(attacker, true);
        token0.mint(address(hook), 10_000 ether);
        token1.mint(address(hook), 10_000 ether);
        manager.setNextSwapDelta(-int128(int256(margin * leverage)), 47 ether);
        vm.prank(attacker);
        adapter.exactInputSingleWithLeverage(address(token0), address(token1), 3000, leverage, margin, 0, victim);
        (posTrader,,,,,,, ,) = hook.positions(key.toId(), victim);
        assertEq(posTrader, victim, "position opens only after approval");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PoC 2 — settlement repayment is now pro-rata (F-04)
    // ─────────────────────────────────────────────────────────────────────────

    function _originDataFor(uint256 margin, uint8 leverage, address recipient) internal view returns (bytes memory) {
        return abi.encode(
            key,
            standardPoolKey,
            true,
            int256(margin),
            leverage,
            address(0),
            abi.encode(true, leverage, recipient),
            uint256(0)
        );
    }

    function _fill(bytes32 orderId, address filler, address recipient) internal {
        token0.mint(filler, 1_000 ether);
        vm.startPrank(filler);
        token0.approve(address(settlement), type(uint256).max);
        settlement.fill(orderId, _originDataFor(10 ether, 5, recipient), "");
        vm.stopPrank();
    }

    function test_PoC_Settlement_ProRataRepayment() public {
        address alice = makeAddr("alice");
        address mallory = makeAddr("mallory");

        bytes32 aliceOrder = keccak256("alice-order");
        bytes32 malloryOrder = keccak256("mallory-order");

        manager.setNextSwapDelta(-50 ether, 48 ether);
        _fill(aliceOrder, alice, makeAddr("aliceRecipient"));
        manager.setNextSwapDelta(-50 ether, 48 ether);
        _fill(malloryOrder, mallory, makeAddr("malloryRecipient"));

        assertEq(settlement.fillerPrincipal(aliceOrder), 40 ether, "alice principal recorded");
        assertEq(settlement.fillerPrincipal(malloryOrder), 40 ether, "mallory principal recorded");

        address aliceRecipient = settlement.orderRecipient(aliceOrder);
        address malloryRecipient = settlement.orderRecipient(malloryOrder);

        manager.setNextSwapDelta(48 ether, -47952000000000000000);
        vm.prank(aliceRecipient);
        router.closePosition(address(hook), key, aliceRecipient, address(settlement), 0);

        manager.setNextSwapDelta(15 ether, -47952000000000000000);
        vm.prank(malloryRecipient);
        router.closePosition(address(hook), key, malloryRecipient, address(settlement), 0);

        uint256 parked = token0.balanceOf(address(settlement));
        assertEq(parked, 55 ether, "settlement holds 40 (alice) + 15 (mallory)");

        // Pro-rata entitlement is a share of the RECEIPTS this settlement has
        // ever taken in for the token (55), not of whatever balance is left, so
        // the split cannot depend on who claims first. Only CLOSED orders form
        // the denominator: an open order's capital sits in a live position and
        // is not in this balance.
        vm.prank(mallory);
        uint256 malloryGot = settlement.claimRepayment(malloryOrder);
        assertEq(malloryGot, 27.5 ether, "mallory pro-rata share");

        vm.prank(alice);
        uint256 aliceGot = settlement.claimRepayment(aliceOrder);
        assertEq(aliceGot, 27.5 ether, "alice pro-rata share (claim order must not matter)");

        assertEq(token0.balanceOf(address(settlement)), 0, "settlement drained");
        assertEq(malloryGot + aliceGot, parked, "nothing created, nothing stranded");

        // The 12.5 ether shortfall on each order is not "forgotten": principal is
        // kept, and the paid part is tracked so it can never be claimed twice.
        assertEq(settlement.fillerPrincipal(malloryOrder), 40 ether, "principal retained");
        assertEq(settlement.fillerClaimed(malloryOrder), 27.5 ether, "paid part tracked");
        vm.prank(mallory);
        vm.expectRevert(EswapSettlement.NothingToClaim.selector);
        settlement.claimRepayment(malloryOrder);
    }

    /// @dev The same shortfall with the claims made in the OPPOSITE order yields
    ///      the identical split, proving the entitlement is a share of receipts
    ///      rather than of the shrinking balance.
    function test_PoC_Settlement_ProRataRepayment_ReverseClaimOrder() public {
        address alice = makeAddr("alice");
        address mallory = makeAddr("mallory");

        bytes32 aliceOrder = keccak256("alice-order-r");
        bytes32 malloryOrder = keccak256("mallory-order-r");

        manager.setNextSwapDelta(-50 ether, 48 ether);
        _fill(aliceOrder, alice, makeAddr("aliceRecipientR"));
        manager.setNextSwapDelta(-50 ether, 48 ether);
        _fill(malloryOrder, mallory, makeAddr("malloryRecipientR"));

        address aliceRecipient = settlement.orderRecipient(aliceOrder);
        address malloryRecipient = settlement.orderRecipient(malloryOrder);

        manager.setNextSwapDelta(48 ether, -47952000000000000000);
        vm.prank(aliceRecipient);
        router.closePosition(address(hook), key, aliceRecipient, address(settlement), 0);

        manager.setNextSwapDelta(15 ether, -47952000000000000000);
        vm.prank(malloryRecipient);
        router.closePosition(address(hook), key, malloryRecipient, address(settlement), 0);

        assertEq(token0.balanceOf(address(settlement)), 55 ether, "settlement holds 55");

        vm.prank(alice);
        assertEq(settlement.claimRepayment(aliceOrder), 27.5 ether, "alice first: pro-rata share");
        vm.prank(mallory);
        assertEq(settlement.claimRepayment(malloryOrder), 27.5 ether, "mallory second: pro-rata share");
        assertEq(token0.balanceOf(address(settlement)), 0, "settlement drained");
    }
}

/// @notice PoC 3 — JIT spot RFQ oracle bounds now fail-closed (F-01)
contract AuditThirdJITDrainPoC is Test {
    using PoolIdLibrary for PoolKey;

    EswapMarginHook public hook;
    PoolManagerRealTokenMock public manager;
    EswapRouter public router;
    EswapRouterExt public ext;
    ERC20Mock public token0;
    ERC20Mock public token1;
    PoolKey public key;

    address public swapper = address(0xAAAA);
    address public solver = address(0xBBBB);

    function setUp() public {
        manager = new PoolManagerRealTokenMock();
        PriceFeedMock priceFeed = new PriceFeedMock();

        token0 = new ERC20Mock("Token 0", "TK0");
        token1 = new ERC20Mock("Token 1", "TK1");

        address hookAddress = address(uint160((1 << 159) | (1 << 158) | (1 << 153) | (1 << 152) | (1 << 148)));
        (address _hookLogic, address _hookLogic2) = EswapHookDeployLib.deployLogic(address(manager), address(priceFeed));
        deployCodeTo(
            "EswapMarginHook.sol:EswapMarginHook",
            abi.encode(manager, priceFeed, _hookLogic, _hookLogic2, address(this)),
            hookAddress
        );
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

        hook.setRouterAndMinCollateralUsd(address(router), 0);
        EswapMarginHookLogic(payable(address(hook))).setAuthorizedPool(key.toId(), true);
        ext.setJitApprovedSwapper(swapper, true);
        router.setSolverWhitelist(solver, true);

        token0.mint(swapper, 1_000 ether);
        token1.mint(solver, 1_000 ether);
        token1.mint(address(manager), 1_000 ether);

        vm.prank(swapper);
        token0.approve(address(ext), type(uint256).max);
        vm.prank(solver);
        token1.approve(address(ext), type(uint256).max);
    }

    function test_PoC_JIT_UnsetFeed_Reverts() public {
        // Floor armed by default; an unset triggerPriceFeed must FAIL CLOSED.
        assertEq(ext.jitOracleFloorLeniencyBps(), 200, "floor armed by default");
        assertEq(address(ext.triggerPriceFeed()), address(0), "feed unset");

        EswapRouterExt.JITSpotParams memory params = EswapRouterExt.JITSpotParams({
            key: key,
            zeroForOne: true,
            amountSpecified: -int256(1 ether),
            solver: solver,
            solverOutput: 900 ether,
            minSolverOutput: 0,
            swapper: swapper
        });

        vm.prank(swapper);
        vm.expectRevert(EswapRouterExt.JitOraclePriceUnavailable.selector);
        ext.executeJITSpotSwap(params);
    }

    function test_PoC_JIT_AboveCeiling_Reverts() public {
        // Set a fair price feed (1:1) → oracle band is 0.98..1.02 ether.
        PriceFeedMock feed = new PriceFeedMock();
        feed.setPrice(address(token0), 1e18);
        feed.setPrice(address(token1), 1e18);
        ext.setTriggerPriceFeed(IPriceFeedForTrigger(address(feed)));

        EswapRouterExt.JITSpotParams memory params = EswapRouterExt.JITSpotParams({
            key: key,
            zeroForOne: true,
            amountSpecified: -int256(1 ether),
            solver: solver,
            solverOutput: 900 ether,
            minSolverOutput: 0,
            swapper: swapper
        });

        vm.prank(swapper);
        vm.expectRevert(); // JitFillAboveOracleCeiling
        ext.executeJITSpotSwap(params);
    }

    function test_PoC_JIT_FairFill_Succeeds() public {
        PriceFeedMock feed = new PriceFeedMock();
        feed.setPrice(address(token0), 1e18);
        feed.setPrice(address(token1), 1e18);
        ext.setTriggerPriceFeed(IPriceFeedForTrigger(address(feed)));

        uint256 swapperBefore = token1.balanceOf(swapper);
        uint256 solverBefore = token1.balanceOf(solver);

        EswapRouterExt.JITSpotParams memory params = EswapRouterExt.JITSpotParams({
            key: key,
            zeroForOne: true,
            amountSpecified: -int256(1 ether),
            solver: solver,
            solverOutput: 1 ether,
            minSolverOutput: 0,
            swapper: swapper
        });

        vm.prank(swapper);
        ext.executeJITSpotSwap(params);

        assertEq(token1.balanceOf(swapper) - swapperBefore, 1 ether, "swapper receives fair output");
        assertEq(solverBefore - token1.balanceOf(solver), 1 ether, "solver pays fair output");
    }
}
