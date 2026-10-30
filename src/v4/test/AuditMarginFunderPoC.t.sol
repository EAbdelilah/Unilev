// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {EswapMarginHook} from "../EswapMarginHook.sol";
import {EswapRouter} from "../EswapRouter.sol";
import {PoolKey} from "../types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "../types/PoolId.sol";
import {Currency} from "../types/Currency.sol";
import {IPoolManager} from "../interfaces/IPoolManager.sol";
import {BaseV4Test, ERC20Mock, PriceFeedMock} from "./BaseV4Test.t.sol";
import {PoolManagerCallbackMock} from "./mocks/PoolManagerMock.sol";
import {EswapHookDeployLib} from "./EswapHookDeployLib.sol";

/// @title AuditMarginFunderPoC
/// @notice Finding (CRITICAL): `EswapRouter.swapMultiPoolForSolverFunded` has NO
///         caller gate. It pulls the MARGIN leg from an arbitrary
///         `marginFunder` (line ~976: `safeTransferFrom(marginFunder, ...)`) and
///         credits the resulting position to an arbitrary `trader`. Any address
///         can therefore pass `marginFunder = <any trader who approved the
///         router>` and `trader = <attacker>` to convert that trader's router
///         allowance into an attacker-owned leveraged position.
///
///         Leverage 1 is used so `borrowAmount == 0`: the solver is zero and
///         none of the solver-authorization gates (whitelist / intent / escrow /
///         notional cap) are reachable, leaving only the unguarded margin pull.
contract AuditMarginFunderPoC is BaseV4Test {
    using PoolIdLibrary for PoolKey;

    EswapRouter public router;
    PoolManagerCallbackMock public pm;
    PoolKey public standardPoolKey;

    address public attacker = address(0xA77AC4E4);
    address public victim = address(0xB1C71);

    function setUp() public override {
        pm = new PoolManagerCallbackMock();
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

        // A normal trader funds its wallet and approves the router, exactly as
        // the UI flow requires for any margin trade.
        token0.mint(victim, 1_000 ether);
        vm.prank(victim);
        token0.approve(address(router), type(uint256).max);

        // The attacker has NOTHING and approves nothing.
        token1.mint(address(hook), 1_000 ether);
    }

    function _attackParams() internal view returns (EswapRouter.SwapParams memory) {
        return EswapRouter.SwapParams({
            key: key,
            standardPoolKey: standardPoolKey,
            zeroForOne: true,
            amountSpecified: -100 ether,
            leverage: 1, // no borrow => no solver gate is reachable
            solver: address(0),
            // isMargin=false skips LP deployment; registration still happens
            // unconditionally in _multiPoolOpen.
            hookData: abi.encode(false, uint8(1), attacker),
            deadline: block.timestamp + 1 hours,
            minAmountOut: 0
        });
    }

    /// @dev Post-fix: the unguarded pull is gone. A caller that names a third
    ///      party as `marginFunder` is rejected before any tokens move.
    function test_MarginFunderDrainReverts() public {
        uint256 victimBefore = token0.balanceOf(victim);

        vm.prank(attacker);
        vm.expectRevert(EswapRouter.ExecutorUnauthorized.selector);
        router.swapMultiPoolForSolverFunded(_attackParams(), attacker, victim);

        assertEq(token0.balanceOf(victim), victimBefore, "victim margin untouched");
        (address posTrader,,,,,,,,) = hook.positions(key.toId(), attacker);
        assertEq(posTrader, address(0), "no position was opened for the attacker");
    }

    /// @dev A caller may still fund its OWN margin (msg.sender == marginFunder),
    ///      which is the honest direct-trader path and must keep working.
    function test_OwnMarginStillWorks() public {
        token0.mint(attacker, 100 ether);
        vm.prank(attacker);
        token0.approve(address(router), type(uint256).max);

        vm.prank(attacker);
        router.swapMultiPoolForSolverFunded(_attackParams(), attacker, attacker);

        (address posTrader,,,,,,,,) = hook.positions(key.toId(), attacker);
        assertEq(posTrader, attacker, "own-margin open still works");
    }

    /// @dev Even a governance-whitelisted relay cannot pick a third-party funder:
    ///      the funder must be the caller. Relays that fund on someone else's
    ///      behalf pull the margin themselves and pass themselves (see
    ///      EswapSettlement / EswapCoWSettlement).
    function test_WhitelistedExecutorCannotDrain() public {
        address executor = address(0xEEEE);
        router.setExecutorWhitelist(executor, true);
        uint256 victimBefore = token0.balanceOf(victim);

        vm.prank(executor);
        vm.expectRevert(EswapRouter.ExecutorUnauthorized.selector);
        router.swapMultiPoolForSolverFunded(_attackParams(), attacker, victim);

        assertEq(token0.balanceOf(victim), victimBefore, "victim margin untouched");
    }
}
