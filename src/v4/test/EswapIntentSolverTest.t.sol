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
import {BalanceDelta, BalanceDeltaLibrary} from "../types/BalanceDelta.sol";

/// @title EswapIntentSolverTest
/// @notice [P0#1] Permissionless solver tests:
///         1. A LendingIntent EIP-712 signature replaces the governance
///            whitelist — any solver the trader signed for can fill.
///         2. The ERC20 borrow escrow lets solvers pre-fund borrow legs without
///            per-trade approvals.
///         3. The governance-set notional cap bounds a permissionless solver's
///            single-fill borrow, even when traders sign for it.
contract EswapIntentSolverTest is BaseV4Test {
    using PoolIdLibrary for PoolKey;

    EswapRouter public router;
    PoolKey public standardPoolKey;

    uint256 public traderPrivateKey = 0xA11CE;
    address public trader;
    address public solver = address(0xB0D);
    address public relayer = address(0xABC123);

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

        standardPoolKey =
            PoolKey({currency0: key.currency0, currency1: key.currency1, fee: 0, tickSpacing: 60, hooks: address(0)});

        hook.setRouterAndMinCollateralUsd(address(router), 0);
        hook.setAuthorizedPool(key.toId(), true);
        // DELIBERATELY NOT whitelisting `solver`: the intent must authorize it.

        manager.setSlot0(key.toId(), 1 << 96, 0);
        manager.setSlot0(standardPoolKey.toId(), 1 << 96, 0);

        trader = vm.addr(traderPrivateKey);
        token0.mint(trader, 100 ether);
        token0.mint(solver, 100 ether);
        token1.mint(address(hook), 100 ether); // collateral for rehypothecation
    }

    function _intent(uint256 nonce, uint256 deadline, address solver_) internal view returns (EswapRouter.LendingIntent memory) {
        return EswapRouter.LendingIntent({
            poolId: PoolId.unwrap(key.toId()),
            standardPoolId: PoolId.unwrap(standardPoolKey.toId()),
            zeroForOne: true,
            amountSpecified: -10 ether, // margin
            leverage: 5, // borrow = 10 ether * 4 = 40 ether
            solver: solver_,
            deadline: deadline,
            minAmountOut: 45 ether,
            nonce: nonce
        });
    }

    function _sign(EswapRouter.LendingIntent memory intent, uint256 pk) internal view returns (bytes memory) {
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", router.DOMAIN_SEPARATOR(), router.hashIntent(intent)));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _params(EswapRouter.LendingIntent memory intent) internal view returns (EswapRouter.SwapParams memory) {
        return EswapRouter.SwapParams({
            key: key,
            standardPoolKey: standardPoolKey,
            zeroForOne: intent.zeroForOne,
            amountSpecified: intent.amountSpecified,
            leverage: intent.leverage,
            solver: intent.solver,
            hookData: abi.encode(true, uint8(intent.leverage), trader),
            deadline: intent.deadline,
            minAmountOut: intent.minAmountOut
        });
    }

    /// @dev Margin 10 ether, leverage 5 -> notional 50 ether. Mock fills at 96%
    ///      (48 ether of token1 output), which satisfies the 45 ether signed
    ///      minAmountOut floor.
    function _mockFill() internal {
        manager.setNextSwapDelta(-50 ether, 48 ether);
    }

    // --- Permissionless solver: the intent replaces the whitelist -------------

    function test_IntentSolver_UnwhitelistedSolver_OpensPosition() public {
        assertFalse(router.registeredSolvers(solver), "solver must NOT be whitelisted");

        EswapRouter.LendingIntent memory intent = _intent(1, block.timestamp + 1 hours, solver);
        bytes memory sig = _sign(intent, traderPrivateKey);

        vm.startPrank(trader);
        token0.approve(address(router), type(uint256).max);
        vm.stopPrank();
        vm.startPrank(solver);
        token0.approve(address(router), type(uint256).max);
        vm.stopPrank();

        _mockFill();

        // Anyone can RELAY the fill; the recovered intent signer is `trader`.
        vm.prank(relayer);
        router.swapWithIntent(_params(intent), trader, intent, sig);

        (address posTrader, uint256 collateral, uint256 borrowed, uint8 posLeverage,,,,, uint128 liquidity) =
            hook.positions(key.toId(), trader);
        assertEq(posTrader, trader, "position credited to the signing trader");
        assertEq(posLeverage, 5);
        assertEq(borrowed, 40 ether);
        assertEq(collateral, (48 ether * 9950) / 10000); // 0.5% protocol fee
        assertGt(liquidity, 0, "collateral rehypothecation deployed");
        assertEq(hook.positionSolver(key.toId(), trader), solver, "signed solver recorded");
    }

    function test_IntentSolver_WhitelistedSolver_StillAuthorizesViaIntent() public {
        // Whitelisting stays one authorization leg; the intent path must also
        // work for a whitelisted solver (no double-gating surprises).
        router.setSolverWhitelist(solver, true);
        EswapRouter.LendingIntent memory intent = _intent(2, block.timestamp + 1 hours, solver);
        bytes memory sig = _sign(intent, traderPrivateKey);

        vm.startPrank(trader);
        token0.approve(address(router), type(uint256).max);
        vm.stopPrank();
        vm.startPrank(solver);
        token0.approve(address(router), type(uint256).max);
        vm.stopPrank();

        _mockFill();
        vm.prank(relayer);
        router.swapWithIntent(_params(intent), trader, intent, sig);

        (address posTrader,,,,,,,,) = hook.positions(key.toId(), trader);
        assertEq(posTrader, trader);
    }

    // --- Trader signed exactly this fill: tampering reverts -------------------

    function test_IntentSolver_WrongSolverReverts() public {
        EswapRouter.LendingIntent memory intent = _intent(3, block.timestamp + 1 hours, solver);
        bytes memory sig = _sign(intent, traderPrivateKey);

        EswapRouter.SwapParams memory params = _params(intent);
        params.solver = address(0xDEAD); // replace the solver
        vm.expectRevert(EswapRouter.IntentSolverMismatch.selector);
        router.swapWithIntent(params, trader, intent, sig);
    }

    function test_IntentSolver_WrongLeverageReverts() public {
        EswapRouter.LendingIntent memory intent = _intent(4, block.timestamp + 1 hours, solver);
        bytes memory sig = _sign(intent, traderPrivateKey);

        EswapRouter.SwapParams memory params = _params(intent);
        params.leverage = 10; // replace the leverage
        vm.expectRevert(EswapRouter.IntentLeverageMismatch.selector);
        router.swapWithIntent(params, trader, intent, sig);
    }

    function test_IntentSolver_WrongDirectionReverts() public {
        EswapRouter.LendingIntent memory intent = _intent(5, block.timestamp + 1 hours, solver);
        bytes memory sig = _sign(intent, traderPrivateKey);

        EswapRouter.SwapParams memory params = _params(intent);
        params.zeroForOne = false; // flip direction
        vm.expectRevert(EswapRouter.IntentDirectionMismatch.selector);
        router.swapWithIntent(params, trader, intent, sig);
    }

    function test_IntentSolver_InvalidSignatureReverts() public {
        EswapRouter.LendingIntent memory intent = _intent(6, block.timestamp + 1 hours, solver);
        bytes memory sig = _sign(intent, 0xBADD); // wrong signer
        vm.expectRevert(EswapRouter.InvalidIntentSignature.selector);
        router.swapWithIntent(_params(intent), trader, intent, sig);
    }

    function test_IntentSolver_ExpiredReverts() public {
        EswapRouter.LendingIntent memory intent = _intent(7, block.timestamp - 1, solver);
        bytes memory sig = _sign(intent, traderPrivateKey);
        vm.expectRevert(EswapRouter.DeadlineExpired.selector);
        router.swapWithIntent(_params(intent), trader, intent, sig);
    }

    function test_IntentSolver_ReplayReverts() public {
        EswapRouter.LendingIntent memory intent = _intent(8, block.timestamp + 1 hours, solver);
        bytes memory sig = _sign(intent, traderPrivateKey);

        vm.startPrank(trader);
        token0.approve(address(router), type(uint256).max);
        vm.stopPrank();
        vm.startPrank(solver);
        token0.approve(address(router), type(uint256).max);
        vm.stopPrank();

        _mockFill();
        vm.prank(relayer);
        router.swapWithIntent(_params(intent), trader, intent, sig);

        // Identical intent + signature cannot fill twice (nonce consumed).
        _mockFill();
        vm.expectRevert(EswapRouter.IntentAlreadyFilled.selector);
        vm.prank(relayer);
        router.swapWithIntent(_params(intent), trader, intent, sig);
    }

    // --- ERC20 borrow escrow --------------------------------------------------

    function test_IntentSolver_Erc20EscrowFundsBorrow() public {
        // Solver pre-funds the borrow leg (token0) via escrow; NO router
        // approval is needed at fill time for the borrow leg.
        vm.startPrank(solver);
        token0.approve(address(router), type(uint256).max);
        router.depositBorrowEscrow(address(token0), 40 ether);
        vm.stopPrank();
        assertEq(router.erc20BorrowEscrow(solver, address(token0)), 40 ether, "escrow credited");

        EswapRouter.LendingIntent memory intent = _intent(9, block.timestamp + 1 hours, solver);
        bytes memory sig = _sign(intent, traderPrivateKey);

        vm.startPrank(trader);
        token0.approve(address(router), type(uint256).max);
        vm.stopPrank();

        _mockFill();
        vm.prank(relayer);
        router.swapWithIntent(_params(intent), trader, intent, sig);

        // The whole borrow leg (40 ether) came from escrow; nothing drawn from
        // the solver's wallet balance beyond escrow.
        assertEq(router.erc20BorrowEscrow(solver, address(token0)), 0, "escrow fully consumed for borrow leg");
        (,, uint256 borrowed,,,,,,) = hook.positions(key.toId(), trader);
        assertEq(borrowed, 40 ether);
        assertEq(hook.positionSolver(key.toId(), trader), solver);
    }

    function test_Intentsolver_Erc20Escrow_TopUpFromTransferFrom() public {
        // Escrow covers HALF the borrow; the rest comes from a direct transferFrom.
        vm.startPrank(solver);
        token0.approve(address(router), type(uint256).max);
        router.depositBorrowEscrow(address(token0), 20 ether);
        vm.stopPrank();

        EswapRouter.LendingIntent memory intent = _intent(10, block.timestamp + 1 hours, solver);
        bytes memory sig = _sign(intent, traderPrivateKey);

        vm.startPrank(trader);
        token0.approve(address(router), type(uint256).max);
        vm.stopPrank();

        _mockFill();
        vm.prank(relayer);
        router.swapWithIntent(_params(intent), trader, intent, sig);

        assertEq(router.erc20BorrowEscrow(solver, address(token0)), 0, "escrow drained");
        assertEq(token0.balanceOf(solver), 60 ether, "the 20 ether shortfall came from the solver wallet");
    }

    function test_Erc20BorrowEscrow_DepositWithdraw_RoundTrip() public {
        vm.startPrank(solver);
        token0.approve(address(router), type(uint256).max);
        router.depositBorrowEscrow(address(token0), 25 ether);
        assertEq(router.erc20BorrowEscrow(solver, address(token0)), 25 ether);
        assertEq(token0.balanceOf(address(router)), 25 ether, "escrow tokens held by the router");

        router.withdrawBorrowEscrow(address(token0), 10 ether);
        assertEq(router.erc20BorrowEscrow(solver, address(token0)), 15 ether);
        assertEq(token0.balanceOf(solver), 85 ether, "withdrawn funds returned");

        // Over-draw reverts.
        vm.expectRevert(
            abi.encodeWithSelector(EswapRouter.InsufficientBorrowEscrow.selector, 15 ether, 16 ether)
        );
        router.withdrawBorrowEscrow(address(token0), 16 ether);
        vm.stopPrank();
    }

    // --- Notional cap ---------------------------------------------------------

    function test_IntentSolver_NotionalCap_Enforced() public {
        // Cap the solver at 30 ether borrow per fill (below the 40 ether borrow
        // this 10 ether @ 5x intent requires) — even a signed intent can't.
        router.setSolverNotionalCap(solver, 30 ether);
        EswapRouter.LendingIntent memory intent = _intent(11, block.timestamp + 1 hours, solver);
        bytes memory sig = _sign(intent, traderPrivateKey);

        vm.expectRevert(abi.encodeWithSelector(EswapRouter.BorrowExceedsSolverNotionalCap.selector, 40 ether, 30 ether));
        router.swapWithIntent(_params(intent), trader, intent, sig);
    }

    function test_IntentSolver_NotionalCap_ZeroUnlimited() public {
        router.setSolverNotionalCap(solver, 0); // 0 = unlimited (default)
        EswapRouter.LendingIntent memory intent = _intent(12, block.timestamp + 1 hours, solver);
        bytes memory sig = _sign(intent, traderPrivateKey);

        vm.startPrank(trader);
        token0.approve(address(router), type(uint256).max);
        vm.stopPrank();
        vm.startPrank(solver);
        token0.approve(address(router), type(uint256).max);
        vm.stopPrank();

        _mockFill();
        vm.prank(relayer);
        router.swapWithIntent(_params(intent), trader, intent, sig);

        (address posTrader,,,,,,,,) = hook.positions(key.toId(), trader);
        assertEq(posTrader, trader);
    }

    // --- Slippage floor is the trader's signed floor --------------------------

    function test_IntentSolver_RelayerCantLoosenSignedMinAmountOut() public {
        EswapRouter.LendingIntent memory intent = _intent(13, block.timestamp + 1 hours, solver);
        bytes memory sig = _sign(intent, traderPrivateKey);

        EswapRouter.SwapParams memory params = _params(intent);
        params.minAmountOut = 44 ether; // looser than the signed 45 ether floor
        vm.expectRevert(EswapRouter.IntentSlippageBelowSignedFloor.selector);
        router.swapWithIntent(params, trader, intent, sig);
    }
}