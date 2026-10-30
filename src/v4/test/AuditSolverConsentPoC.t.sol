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
import {EswapHookDeployLib} from "./EswapHookDeployLib.sol";

/// @dev PoolManager double that runs the REAL hook callbacks (beforeSwap /
///      afterSwap) around a scripted fill, so the margin position and
///      solverDebts are recorded exactly as on-chain. Settlement is still
///      mocked (sync/settle/take are no-ops), which is sufficient to exercise
///      the router's authorization logic that moves solver ERC20s.
contract HookDrivenPoolManager is PoolManagerCallbackMock {
    BalanceDelta internal _fill;

    function setFill(int128 amount0, int128 amount1) external {
        _fill = BalanceDeltaLibrary.toBalanceDelta(amount0, amount1);
    }

    function swap(PoolKey calldata key, IPoolManager.SwapParams calldata params, bytes calldata hookData)
        external
        override
        returns (BalanceDelta delta)
    {
        EswapMarginHook(payable(key.hooks)).beforeSwap(msg.sender, key, params, hookData);
        delta = _fill;
        EswapMarginHook(payable(key.hooks)).afterSwap(msg.sender, key, params, delta, hookData);
    }
}

/// @title AuditSolverConsentPoC
/// @notice Finding: EswapRouter._swapCallback (plain `swap` path) lets the
///         TRADER choose `params.solver`. The borrow leg is pulled with
///         `transferFrom(params.solver, ...)` for ANY registered solver,
///         with no solver signature/consent and no `solverNotionalCap` check
///         (the cap is only enforced in the intent / multi-pool paths).
contract AuditSolverConsentPoC is BaseV4Test {
    using PoolIdLibrary for PoolKey;

    EswapRouter public router;
    HookDrivenPoolManager public pm;
    PoolKey public standardPoolKey;

    address public attacker = address(0xA77AC4E4);
    address public victimSolver = address(0xB0D);

    function setUp() public override {
        pm = new HookDrivenPoolManager();
        priceFeed = new PriceFeedMock();

        token0 = new ERC20Mock("Token 0", "TK0");
        token1 = new ERC20Mock("Token 1", "TK1");

        address hookAddress = address(uint160((1 << 159) | (1 << 158) | (1 << 153) | (1 << 152) | (1 << 148)));
        (address _hookLogic, address _hookLogic2) = EswapHookDeployLib.deployLogic(address(pm), address(priceFeed));
        deployCodeTo(
            "EswapMarginHook.sol:EswapMarginHook",
            abi.encode(pm, priceFeed, _hookLogic, _hookLogic2, address(this)),
            hookAddress
        );
        hook = EswapMarginHook(payable(hookAddress));

        router = new EswapRouter(pm);

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
        pm.setSlot0(key.toId(), 1 << 96, 0);
        pm.setSlot0(standardPoolKey.toId(), 1 << 96, 0);

        // Governance registers a bonded solver. The solver pre-approves the
        // router for its own fills; it never agrees to fund a trader it did
        // not sign for.
        router.setSolverWhitelist(victimSolver, true);
        token0.mint(attacker, 100 ether);
        token0.mint(victimSolver, 100 ether);
        token1.mint(address(hook), 100 ether);

        vm.prank(attacker);
        token0.approve(address(router), type(uint256).max);
        vm.prank(victimSolver);
        token0.approve(address(router), type(uint256).max);
    }

    function _params() internal view returns (EswapRouter.SwapParams memory) {
        return EswapRouter.SwapParams({
            key: key,
            standardPoolKey: standardPoolKey,
            zeroForOne: true,
            amountSpecified: -10 ether,
            leverage: 5,
            solver: victimSolver,
            hookData: abi.encode(true, uint8(5), attacker),
            deadline: block.timestamp + 1 hours,
            minAmountOut: 0
        });
    }

    /// @dev Regression for the original exploit: a 40 ether borrow against a
    ///      solver capped at 1 ether must now revert before any solver tokens move.
    function test_ExploitPoC() public {
        router.setSolverNotionalCap(victimSolver, 1 ether);
        pm.setFill(-50 ether, 48 ether);

        uint256 solverBefore = token0.balanceOf(victimSolver);

        vm.prank(attacker);
        vm.expectRevert(
            abi.encodeWithSelector(EswapRouter.BorrowExceedsSolverNotionalCap.selector, 40 ether, 1 ether)
        );
        router.swap(_params());

        assertEq(token0.balanceOf(victimSolver), solverBefore, "no solver funds moved");
    }

    /// @dev Within-cap fills still work: the fix blocks over-cap pulls, not solver lending.
    function test_WithinCapStillFunds() public {
        router.setSolverNotionalCap(victimSolver, 40 ether);
        pm.setFill(-50 ether, 48 ether);

        uint256 solverBefore = token0.balanceOf(victimSolver);
        vm.prank(attacker);
        router.swap(_params());

        assertEq(solverBefore - token0.balanceOf(victimSolver), 40 ether, "borrow leg pulled");
        (address debtSolver, uint256 principal,) = hook.solverDebts(key.toId(), attacker, victimSolver);
        assertEq(debtSolver, victimSolver);
        assertEq(principal, 40 ether);
    }

    /// @dev [AUDIT CRIT-ACT-04] A second open on the SAME (pool, trader) used to
    ///      overwrite the position record and `positionSolver`, orphaning the
    ///      first solver's debt so its principal could never be repaid. It must
    ///      now revert before any solver money moves.
    function test_SecondOpenWithDifferentSolverReverts() public {
        address solverB = address(0xB0B);
        router.setSolverWhitelist(solverB, true);
        router.setSolverNotionalCap(victimSolver, 40 ether);
        router.setSolverNotionalCap(solverB, 40 ether);
        token0.mint(solverB, 100 ether);
        vm.prank(solverB);
        token0.approve(address(router), type(uint256).max);

        pm.setFill(-50 ether, 48 ether);

        // First open: position backed by victimSolver.
        vm.prank(attacker);
        router.swap(_params());

        // Second open on the same pool, naming a different solver.
        EswapRouter.SwapParams memory p = _params();
        p.solver = solverB;
        uint256 solverBBefore = token0.balanceOf(solverB);
        vm.prank(attacker);
        vm.expectRevert(EswapMarginHook.PositionAlreadyOpen.selector);
        router.swap(p);

        assertEq(token0.balanceOf(solverB), solverBBefore, "second solver untouched");
        assertEq(hook.positionSolver(key.toId(), attacker), victimSolver, "original solver preserved");
    }
}
