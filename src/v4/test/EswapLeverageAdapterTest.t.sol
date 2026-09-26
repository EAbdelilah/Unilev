// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BaseV4Test, PriceFeedMock, ERC20Mock} from "./BaseV4Test.t.sol";
import {PoolManagerCallbackMock} from "./mocks/PoolManagerMock.sol";
import {EswapMarginHook} from "../EswapMarginHook.sol";
import {EswapRouter} from "../EswapRouter.sol";
import {EswapLeverageAdapter, IERC20Permit} from "../EswapLeverageAdapter.sol";
import {EswapLeverageQuoter} from "../EswapLeverageQuoter.sol";
import {PoolKey} from "../types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "../types/PoolId.sol";
import {Currency} from "../types/Currency.sol";

/// @dev [AUDIT CRIT-6] Minimal permit-capable token recording the call, used to
///      prove `multicall` routes ONLY selfPermit payloads through delegatecall.
contract PermitTracker is IERC20Permit {
    address public recordedOwner;
    address public recordedSpender;
    uint256 public recordedValue;

    function permit(address owner, address spender, uint256 value, uint256, uint8, bytes32, bytes32) external {
        recordedOwner = owner;
        recordedSpender = spender;
        recordedValue = value;
    }
}

contract EswapLeverageAdapterTest is BaseV4Test {
    using PoolIdLibrary for PoolKey;

    EswapRouter public router;
    EswapLeverageAdapter public adapter;
    EswapLeverageQuoter public quoter;
    PoolKey public standardPoolKey;

    address public solver;
    address public user;
    uint256 constant MARGIN = 10 ether;

    function setUp() public override {
        manager = new PoolManagerCallbackMock();
        priceFeed = new PriceFeedMock();

        token0 = new ERC20Mock("Token 0", "TK0");
        token1 = new ERC20Mock("Token 1", "TK1");

        address hookAddress = address(uint160((1 << 159) | (1 << 158) | (1 << 153) | (1 << 152) | (1 << 148)));
        deployCodeTo("EswapMarginHook.sol:EswapMarginHook", abi.encode(manager, priceFeed, address(this)), hookAddress);
        hook = EswapMarginHook(payable(hookAddress));

        router = new EswapRouter(manager);
        adapter = new EswapLeverageAdapter(router);
        quoter = new EswapLeverageQuoter(router);
        // [AUDIT CRIT-4] The adapter relays swapMultiPoolFor for its recipient.
        router.setExecutorWhitelist(address(adapter), true);

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

        solver = makeAddr("solver");
        user = makeAddr("user");
        router.setSolverWhitelist(solver, true);

        token0.mint(user, 100 ether);
        token0.mint(solver, 100 ether);

        vm.startPrank(user);
        token0.approve(address(router), type(uint256).max);
        vm.stopPrank();

        vm.startPrank(solver);
        token0.approve(address(router), type(uint256).max);
        vm.stopPrank();

        token1.mint(address(hook), 100 ether);

        adapter.registerPool(address(token0), address(token1), 3000, key, standardPoolKey);
        adapter.setDefaultSolver(solver);

        quoter.registerPool(address(token0), address(token1), 3000, key, standardPoolKey);
    }

    // ─── Adapter: Leveraged Swap ────────────────────────────────────────

    function test_Adapter_LeveragedSwap() public {
        // Mock: 10 ether margin + 40 ether borrow = 50 ether swapped → 48 ether output
        manager.setNextSwapDelta(-50 ether, 48 ether);

        uint256 amountOut =
            adapter.exactInputSingleWithLeverage(address(token0), address(token1), 3000, 5, MARGIN, 0, user);

        assertEq(amountOut, 48 ether);

        (address posTrader, uint256 collateral, uint256 borrowed, uint8 posLeverage,,,,, uint128 liquidity) =
            hook.positions(key.toId(), user);
        assertEq(posTrader, user);
        assertEq(posLeverage, 5);
        assertEq(borrowed, 40 ether);
        assertEq(collateral, (48 ether * 9950) / 10000); // 0.5% fee
        assertGt(liquidity, 0, "collateral rehypothecation deployed");
    }

    function test_Adapter_LeveragedSwap_2x() public {
        manager.setNextSwapDelta(-20 ether, 19 ether);

        uint256 amountOut =
            adapter.exactInputSingleWithLeverage(address(token0), address(token1), 3000, 2, MARGIN, 0, user);

        assertEq(amountOut, 19 ether);

        (, uint256 collateral, uint256 borrowed, uint8 posLeverage,,,,,) = hook.positions(key.toId(), user);
        assertEq(posLeverage, 2);
        assertEq(borrowed, 10 ether);
        assertEq(collateral, (19 ether * 9950) / 10000);
    }

    /// @dev [FIX H-3] The minAmountOut is now forwarded into the router and
    ///      enforced atomically INSIDE the swap — the router's error fires and
    ///      backs out the whole open (the adapter's post-swap check is now
    ///      unreachable defence-in-depth).
    function test_Adapter_SlippageGuard_Reverts() public {
        manager.setNextSwapDelta(-50 ether, 48 ether);

        vm.expectRevert(abi.encodeWithSelector(EswapRouter.SwapOutputBelowMinimum.selector, 48 ether, 49 ether));
        adapter.exactInputSingleWithLeverage(address(token0), address(token1), 3000, 5, MARGIN, 49 ether, user);
    }

    // ─── Adapter: Access Control ─────────────────────────────────────────

    function test_Adapter_OnlyOwner_RegisterPool() public {
        address stranger = makeAddr("stranger");
        PoolKey memory dummyKey = PoolKey({
            currency0: Currency.wrap(address(token0)),
            currency1: Currency.wrap(address(token1)),
            fee: 100,
            tickSpacing: 60,
            hooks: address(0)
        });

        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", stranger));
        adapter.registerPool(address(token0), address(token1), 100, dummyKey, dummyKey);
    }

    function test_Adapter_OnlyOwner_SetDefaultSolver() public {
        vm.prank(makeAddr("stranger"));
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", makeAddr("stranger")));
        adapter.setDefaultSolver(makeAddr("newSolver"));
    }

    function test_Adapter_ZeroSolver_Reverts() public {
        vm.expectRevert(EswapLeverageAdapter.ZeroAddress.selector);
        adapter.setDefaultSolver(address(0));
    }

    // ─── [AUDIT HIGH-7] defaultSolver SPOF → backup fallback ────────────

    function test_Adapter_BackupSolver_OnlyOwner_And_Zero() public {
        vm.prank(makeAddr("stranger"));
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", makeAddr("stranger")));
        adapter.setBackupSolver(makeAddr("evilBackup"));

        vm.expectRevert(EswapLeverageAdapter.ZeroAddress.selector);
        adapter.setBackupSolver(address(0));
    }

    function test_Adapter_FallsBackToBackupSolverWhenDefaultUnwhitelisted() public {
        // [AUDIT HIGH-7] The default solver is REMOVED from the router whitelist
        // (its failure mode): the adapter must transparently route through the
        // backup instead of halting 100% of aggregator trading.
        address backup = makeAddr("backupSolver");
        router.setSolverWhitelist(backup, true);
        token0.mint(backup, 100 ether);
        vm.startPrank(backup);
        token0.approve(address(router), type(uint256).max);
        vm.stopPrank();
        adapter.setBackupSolver(backup);
        router.setSolverWhitelist(solver, false);

        manager.setNextSwapDelta(-50 ether, 48 ether);
        uint256 amountOut =
            adapter.exactInputSingleWithLeverage(address(token0), address(token1), 3000, 5, MARGIN, 0, user);
        assertEq(amountOut, 48 ether, "backup solver must service the leveraged swap");

        (, uint256 collateral, uint256 borrowed, uint8 posLeverage,,,,,) = hook.positions(key.toId(), user);
        assertGt(collateral, 0);
        assertEq(borrowed, 40 ether, "borrow leg routed through the backup solver");
        assertEq(posLeverage, 5);
    }

    function test_Adapter_NoSolverConfigured_RouterReverts() public {
        // Default de-whitelisted and no backup registered: the router rejects
        // loudly rather than the adapter silently routing capital (fail-closed).
        router.setSolverWhitelist(solver, false);
        manager.setNextSwapDelta(-50 ether, 48 ether);
        vm.expectRevert(bytes("Solver required for leverage"));
        adapter.exactInputSingleWithLeverage(address(token0), address(token1), 3000, 5, MARGIN, 0, user);
    }

    function test_Adapter_PoolNotRegistered_Reverts() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                EswapLeverageAdapter.PoolNotRegistered.selector, address(token1), address(token0), 3000
            )
        );
        adapter.exactInputSingleWithLeverage(address(token1), address(token0), 3000, 5, MARGIN, 0, user);
    }

    function test_Adapter_ZeroRecipient_Reverts() public {
        vm.expectRevert(EswapLeverageAdapter.ZeroAddress.selector);
        adapter.exactInputSingleWithLeverage(address(token0), address(token1), 3000, 5, MARGIN, 0, address(0));
    }

    // ─── Adapter: View Helpers ──────────────────────────────────────────

    function test_Adapter_GetPoolKey() public view {
        (PoolKey memory hk, PoolKey memory sk) = adapter.getPoolKey(address(token0), address(token1), 3000);
        assertEq(hk.hooks, address(hook));
        assertEq(hk.fee, 3000);
        assertEq(sk.hooks, address(0));
        assertEq(sk.fee, 500);
    }

    // ─── [AUDIT CRIT-6] Multicall restricted to selfPermit ─────────────

    function test_Adapter_Multicall_RejectsArbitrarySelector() public {
        // Swaps delegatecalled through the adapter could bind a caller-controlled
        // route/exchangeProxy — must be unreachable via multicall.
        bytes[] memory data = new bytes[](1);
        data[0] = abi.encodeWithSelector(
            adapter.exactInputSingleWithLeverage.selector, address(token0), address(token1), 3000, 5, MARGIN, 0, user
        );
        vm.expectRevert(bytes("unauthorized delegatecall"));
        adapter.multicall(data);
    }

    function test_Adapter_Multicall_RejectsOwnerActions() public {
        // Admin actions must NOT be reachable via delegatecall from any caller.
        bytes[] memory data = new bytes[](1);
        data[0] = abi.encodeWithSelector(adapter.setDefaultSolver.selector, makeAddr("evilSolver"));
        vm.expectRevert(bytes("unauthorized delegatecall"));
        adapter.multicall(data);

        data[0] = abi.encodeWithSelector(
            adapter.registerPool.selector, address(token0), address(token1), 100, standardPoolKey, standardPoolKey
        );
        vm.expectRevert(bytes("unauthorized delegatecall"));
        adapter.multicall(data);
    }

    function test_Adapter_Multicall_AllowsSelfPermitOnly() public {
        PermitTracker permitToken = new PermitTracker();

        bytes[] memory data = new bytes[](1);
        data[0] = abi.encodeWithSelector(
            adapter.selfPermit.selector, address(permitToken), 1234, block.timestamp + 1, 27, bytes32(0), bytes32(0)
        );
        adapter.multicall(data);

        assertEq(permitToken.recordedSpender(), address(router), "router must be the permitted spender");
        assertEq(permitToken.recordedOwner(), address(this), "owner is the multicall initiator (delegatecall)");
        assertEq(permitToken.recordedValue(), 1234);
    }

    // ─── Quoter: Indicative Quote ───────────────────────────────────────

    function test_Quoter_ExactInputSingleWithLeverage() public view {
        int128 amountOut =
            quoter.quoteExactInputSingleWithLeverage(address(token0), address(token1), 3000, 5, -int256(MARGIN));

        // Pool at 1:1, leveraged amount = 50 ether, 0.1% discount
        assertEq(uint256(int256(amountOut)), (50 ether * 9990) / 10000); // 49950 ether
    }

    function test_Quoter_PoolNotRegistered_Reverts() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                EswapLeverageQuoter.PoolNotRegistered.selector, address(token1), address(token0), 3000
            )
        );
        quoter.quoteExactInputSingleWithLeverage(address(token1), address(token0), 3000, 5, -int256(MARGIN));
    }

    function test_Quoter_GetPoolKey() public view {
        (PoolKey memory hk, PoolKey memory sk) = quoter.getPoolKey(address(token0), address(token1), 3000);
        assertEq(hk.hooks, address(hook));
        assertEq(sk.hooks, address(0));
    }

    // ─── Quoter: Access Control ─────────────────────────────────────────

    function test_Quoter_OnlyOwner_RegisterPool() public {
        vm.prank(makeAddr("stranger"));
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", makeAddr("stranger")));
        quoter.registerPool(address(token0), address(token1), 3000, key, standardPoolKey);
    }
}
