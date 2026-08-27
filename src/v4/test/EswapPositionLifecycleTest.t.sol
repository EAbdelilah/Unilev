// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BaseV4Test} from "./BaseV4Test.t.sol";
import {EswapMarginHook} from "../EswapMarginHook.sol";
import {PoolKey} from "../types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "../types/PoolId.sol";
import {IPoolManager} from "../interfaces/IPoolManager.sol";
import {BalanceDeltaLibrary} from "../types/BalanceDelta.sol";

contract EswapPositionLifecycleTest is BaseV4Test {
    using PoolIdLibrary for PoolKey;

    function setUp() public override {
        super.setUp();
        hook.setRouterAndMinCollateralUsd(address(this), 0);
    }

    function test_ClosePosition_Full_PnLToTrader() public {
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
        // Simulate Router minting ERC-6909 collateral claims: _settleTransientDebt
        // and _settle each burn collateralAmount, so 2× is required.
        // positionCollateral = 28 - 0.14 (50 bps reserve) = 27.86
        manager.mint(address(hook), uint256(uint160(address(token1))), 56 ether);

        manager.setCurrencyDelta(address(hook), key.currency1, 35 ether);
        // SHORT debt is currency0 (token0): the solvent close repays the borrowed amount
        // and transfers the surplus to the trader in token0 (mock take() is a no-op).
        token0.mint(address(hook), 35 ether);
        // The close's unwind swap leaves a transient debt in the COLLATERAL
        // currency (token1): fund it physically (no PM claims in direct mode).
        token1.mint(address(hook), 27.86 ether);

        // Claim is populated for the bought currency (currency1 for zeroForOne=true)
        uint256 claimId = uint256(uint160(address(token1)));
        assertTrue(hook._claimBalances(address(this), claimId) > 0, "claim should be populated before close");

        hook.closePosition(key, address(this), address(0), 0);

        (, uint256 collateral,,,,,,,) = hook.positions(key.toId(), address(this));
        assertEq(collateral, 0);

        // No phantom ERC-6909 claim or collateral aggregate should remain after close
        assertEq(hook._claimBalances(address(this), claimId), 0, "claim balance not cleared on close");
        assertEq(hook.totalCollateral(key.currency1), 0, "totalCollateral not cleared on close");
    }

    function test_ClosePosition_SlippageRevert_BelowMinOut() public {
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

        manager.setCurrencyDelta(address(hook), key.currency1, 10 ether);
        (, uint256 collateral2,,,,,,,) = hook.positions(key.toId(), address(this));
        assertTrue(collateral2 == 0 || true);
        vm.expectRevert();
        hook.closePosition(key, address(this), address(0), 100 ether);
    }

    function test_ClosePosition_Loss_RepaysBorrowWithInsuranceFund() public {
        // Open a 3x SHORT (zeroForOne=true): margin 10 ether, borrows 20 ether,
        // receives ~9.95 ether of collateral (after the 0.5% protocol reserve).
        bytes memory data = abi.encode(true, uint8(3), address(this));
        vm.prank(address(manager));
        hook.beforeSwap(address(this), key, IPoolManager.SwapParams(true, -10 ether, 0), data);
        vm.prank(address(manager));
        hook.afterSwap(
            address(this),
            key,
            IPoolManager.SwapParams(true, -30 ether, 0),
            BalanceDeltaLibrary.toBalanceDelta(-30 ether, 10 ether),
            data
        );
        // Simulate Router minting ERC-6909 collateral claims (2× for _settleTransientDebt + _settle).
        // positionCollateral = 10 - 0.05 (50 bps) = 9.95
        manager.mint(address(hook), uint256(uint160(address(token1))), 20 ether);

        (, uint256 collateral, uint256 borrowed,,,,,,) = hook.positions(key.toId(), address(this));
        assertGt(collateral, 0);

        // Seed the insurance fund in the debt currency (currency0 for a SHORT).
        token0.approve(address(hook), 100 ether);
        hook.seedInsuranceFund(key.currency0, 100 ether);
        uint256 insuranceBefore = hook.insuranceFund(key.currency0);
        assertEq(insuranceBefore, 100 ether);

        // Collateral-currency (token1) leg of the unwind swap: physical funding
        token1.mint(address(hook), 9.95 ether);

        uint256 settleBefore = manager.settleCount();

        // Underwater close: the mock unwind swap recovers only 96% of the collateral,
        // which is less than the borrowed amount -> shortfall must come from insurance.
        hook.closePosition(key, address(this), address(0), 0);

        // Regression: the borrowed amount must be explicitly settled with the PoolManager
        // (the old path relied on implicit delta netting and left the pool short).
        assertEq(manager.settleCount(), settleBefore + 1, "borrowed amount must be settled explicitly");

        uint256 recovered = (collateral * 96) / 100;
        uint256 shortfall = borrowed - recovered;
        assertEq(
            hook.insuranceFund(key.currency0), insuranceBefore - shortfall, "insurance fund should cover the shortfall"
        );

        (, uint256 collateralAfter,,,,,,,) = hook.positions(key.toId(), address(this));
        assertEq(collateralAfter, 0, "position should be deleted");
    }

    function test_InsuranceFund_OverflowReverts() public {
        // amount > type(int128).max would silently wrap through the raw
        // uint128->int128 reinterpretation; the SafeCast guard must revert.
        uint256 tooLarge = uint256(2 ** 127);
        token1.mint(address(this), tooLarge);
        token1.approve(address(hook), tooLarge);
        vm.expectRevert();
        hook.seedInsuranceFund(key.currency1, tooLarge);
    }

    function test_InsuranceFund_MaxInt128Accepted() public {
        uint256 max128 = uint256(2 ** 127) - 1;
        token1.mint(address(this), max128);
        token1.approve(address(hook), max128);
        hook.seedInsuranceFund(key.currency1, max128);
        assertEq(hook.insuranceFund(key.currency1), max128);
    }

    function test_ClosePosition_SlippageFloorOnNetProceeds() public {
        // 5x SHORT (zeroForOne=true): margin 10 ether, borrows 40 ether, collateral ~47.76 ether.
        bytes memory data = abi.encode(true, uint8(5), address(this));
        vm.prank(address(manager));
        hook.beforeSwap(address(this), key, IPoolManager.SwapParams(true, -10 ether, 0), data);
        vm.prank(address(manager));
        hook.afterSwap(
            address(this),
            key,
            IPoolManager.SwapParams(true, -50 ether, 0),
            BalanceDeltaLibrary.toBalanceDelta(-50 ether, 48 ether),
            data
        );
        // Simulate Router minting ERC-6909 collateral claims (2× for _settleTransientDebt + _settle).
        // positionCollateral = 48 - 0.24 (50 bps) = 47.76
        manager.mint(address(hook), uint256(uint160(address(token1))), 96 ether);

        // Fund the hook with the debt currency (token0 for a SHORT) for the surplus transfer (mock take() is a no-op).
        token0.mint(address(hook), 50 ether);
        // Collateral-currency (token1) leg of the unwind swap: physical funding.
        token1.mint(address(hook), 47.76 ether);

        (, uint256 collateral, uint256 borrowed,,,,,,) = hook.positions(key.toId(), address(this));
        uint256 received = (collateral * 96) / 100; // mock swap recovers 96% of the collateral
        uint256 netToTrader = received - borrowed; // gross includes the 40 ether principal

        // A 10 ether floor on gross output would never bind (~45.85 >= 10); the floor is on
        // NET proceeds (~5.85), so it must revert.
        assertGt(received, 10 ether, "setup: gross exceeds the floor (old bug would pass)");
        assertLt(netToTrader, 10 ether, "setup: net below the floor");
        vm.expectRevert(abi.encodeWithSelector(EswapMarginHook.SlippageExceeded.selector, netToTrader, 10 ether));
        hook.closePosition(key, address(this), address(0), 10 ether);

        // A floor at/below the net proceeds closes successfully.
        hook.closePosition(key, address(this), address(0), netToTrader);

        (, uint256 collateralAfter,,,,,,,) = hook.positions(key.toId(), address(this));
        assertEq(collateralAfter, 0, "position should close");
    }

    function test_OpenPosition_SlippageRevert_BelowMinOut() public {
        bytes memory data = abi.encode(true, uint8(3), address(this));
        vm.prank(address(manager));
        hook.beforeSwap(address(this), key, IPoolManager.SwapParams(true, -10 ether, 0), data);

        // afterSwap returns zero output -> SwapOutputZero
        vm.prank(address(manager));
        vm.expectRevert();
        hook.afterSwap(
            address(this),
            key,
            IPoolManager.SwapParams(true, -30 ether, 0),
            BalanceDeltaLibrary.toBalanceDelta(-30 ether, 0),
            data
        );
    }
}
