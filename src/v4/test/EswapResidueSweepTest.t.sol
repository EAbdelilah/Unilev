// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BaseV4Test, PriceFeedMock, ERC20Mock} from "./BaseV4Test.t.sol";
import {EswapMarginHook} from "../EswapMarginHook.sol";
import {PoolKey} from "../types/PoolKey.sol";
import {PoolIdLibrary} from "../types/PoolId.sol";
import {Currency} from "../types/Currency.sol";
import {IPoolManager} from "../interfaces/IPoolManager.sol";
import {BalanceDeltaLibrary} from "../types/BalanceDelta.sol";
import {console2} from "forge-std/console2.sol";

/// @notice Protocol-owned residue sweep: proves the obligation floor
///         (totalCollateral + insuranceFund + protocolFees) is never sweepable.
///
///         Residue sources exercised here:
///           1. the 50bps open fee retained on swap output (bought - principal),
///           2. direct donations to the hook's PM claim balance.
contract EswapResidueSweepTest is BaseV4Test {
    using PoolIdLibrary for PoolKey;

    uint256 traderNonce;

    function setUp() public override {
        super.setUp();
        priceFeed.setPrice(address(token0), 1e18);
        priceFeed.setPrice(address(token1), 1e18);
        manager.setSlot0(key.toId(), 79228162514264337593543950336, 0); // 1:1

        // Custody float: base PoolManagerMock.take() only credits claims, so
        // every physical safeTransfer out of the hook draws on this float.
        token0.mint(address(hook), 1_000_000 ether);
        token1.mint(address(hook), 1_000_000 ether);
    }

    function _freshTrader() internal returns (address t) {
        traderNonce++;
        t = makeAddr(string(abi.encodePacked("sweepTrader", traderNonce)));
    }

    /// @dev Opens a SHORT (zeroForOne=true): collateral token1, debt token0.
    function _openShort(address t, uint256 margin, uint8 L) internal returns (uint256 bought, uint256 principal) {
        bought = (margin * L * 96) / 100;
        bytes memory data = abi.encode(true, L, t);
        vm.prank(address(manager));
        hook.beforeSwap(t, key, IPoolManager.SwapParams(true, -int256(margin), 0), data);
        vm.prank(address(manager));
        hook.afterSwap(
            t,
            key,
            IPoolManager.SwapParams(true, -int256(margin * L), 0),
            BalanceDeltaLibrary.toBalanceDelta(int128(-int256(margin * L)), int128(int256(bought))),
            data
        );
        (, principal,,,,,,,) = hook.positions(key.toId(), t);
    }

    function _held(Currency c) internal view returns (uint256) {
        return hook.heldReserve(c);
    }

    function _sweepable(Currency c) internal view returns (uint256) {
        return hook.sweepableResidue(c);
    }

    // ------------------------------------------------------------------
    // Fresh deployment: nothing held, nothing sweepable; donations are
    // fully recoverable by the owner and NEVER anyone else.
    // ------------------------------------------------------------------

    function test_Sweep_DonationsRecoverable_AccessControlled() public {
        assertEq(_held(key.currency0), 0, "fresh hook holds nothing");
        assertEq(_sweepable(key.currency0), 0);

        // Donation simulation: PM claims-style credit straight to the hook.
        manager.take(key.currency0, address(hook), 5 ether);

        vm.prank(makeAddr("random"));
        vm.expectRevert(EswapMarginHook.NotOwner.selector);
        hook.sweepResidue(key.currency0, makeAddr("treasury"), 1 wei);

        address recipient = makeAddr("treasury");
        vm.expectEmit(true, true, false, true, address(hook));
        emit EswapMarginHook.ResidueSwept(key.currency0, recipient, 5 ether);
        hook.sweepResidue(key.currency0, recipient, 5 ether);
        assertEq(token0.balanceOf(recipient), 5 ether, "residue delivered");

        uint256 avail = _sweepable(key.currency0);
        manager.take(key.currency0, address(hook), 1);
        vm.expectRevert(abi.encodeWithSelector(EswapMarginHook.InsufficientResidue.selector, avail + 2, avail + 1));
        hook.sweepResidue(key.currency0, recipient, avail + 2);

        vm.expectRevert(EswapMarginHook.ZeroSweepRecipient.selector);
        hook.sweepResidue(key.currency0, address(0), 1);
    }

    // ------------------------------------------------------------------
    // ------------------------------------------------------------------
    // Open-fee accounting: the retained 50bps is fully ledgered as
    // protocolFees (owner-recoverable via withdrawProtocolFee), so a live
    // position leaves ZERO untracked residue — only wei-level rounding
    // dust can ever accumulate, and that is exactly what sweeps.
    // ------------------------------------------------------------------

    function test_Sweep_OpenFeeIsExactResidue_FloorProtectsCollateral() public {
        address t = _freshTrader();
        (uint256 bought, uint256 principal) = _openShort(t, 100 ether, 3);

        // Simulate PM custody of the swap output: in production the bought
        // tokens land inside the PoolManager as the hook's claim; this mock
        // only moves claims on explicit take().
        manager.take(key.currency1, address(hook), bought);

        // The open fee is fully accounted for as protocol revenue.
        assertEq(hook.protocolFees(key.currency1), bought - principal, "fee ledgered");
        assertEq(_sweepable(key.currency1), 0, "no untracked residue after open");

        // Wei-level dust (rounding/donation) is the ONLY sweepable class.
        manager.take(key.currency1, address(hook), 7);
        assertEq(_sweepable(key.currency1), 7, "dust exact");

        vm.expectRevert(abi.encodeWithSelector(EswapMarginHook.InsufficientResidue.selector, 8, 7));
        hook.sweepResidue(key.currency1, makeAddr("treasury"), 8);

        address recipient = makeAddr("treasury");
        vm.expectEmit(true, true, false, true, address(hook));
        emit EswapMarginHook.ResidueSwept(key.currency1, recipient, 7);
        hook.sweepResidue(key.currency1, recipient, 7);
        assertEq(token1.balanceOf(recipient), 7, "dust delivered");
        // [mock artifact] the payout's internal take() re-credits hook claims,
        // so sweepable does not drop here as it would against the real PM.
    }

    // ------------------------------------------------------------------
    // Insurance backing can never be swept out from under liquidation
    // liveness: seeding raises the floor one-for-one.
    // ------------------------------------------------------------------

    function test_Sweep_InsuranceSeedRaisesFloor() public {
        token0.mint(address(this), 10 ether);
        token0.approve(address(hook), 10 ether);
        hook.seedInsuranceFund(key.currency0, 10 ether);
        // Simulate PM custody backing the seed (mock settle() is a stub).
        manager.take(key.currency0, address(hook), 10 ether);
        assertEq(_sweepable(key.currency0), 0, "seeded fund is not residue");

        manager.take(key.currency0, address(hook), 3 ether);

        // Only the donation is sweepable; the 10e insurance seed is walled off.
        vm.expectRevert(abi.encodeWithSelector(EswapMarginHook.InsufficientResidue.selector, 11 ether, 3 ether));
        hook.sweepResidue(key.currency0, makeAddr("treasury"), 11 ether);

        hook.sweepResidue(key.currency0, makeAddr("treasury"), 3 ether);
        assertEq(hook.insuranceFund(key.currency0), 10 ether, "insurance intact");
    }
}
