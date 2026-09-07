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

/// @notice Insurance-fund sizing stress against the REAL settlement waterfall
///         (_settle: carve-out accrual -> solver repayment -> shortfall draw).
///
///         Model (SHORT book: collateral token1, debt token0):
///           open(m): bought = L*m*96/100 (mock fill), recorded collateral
///           c = bought*9950/10000 (50bps fee); borrow b = (L-1)*m.
///           Crash X: recovery injected as R = c*(1-X).
///           surplus = max(0, R-b); shortfall = max(0, b-R);
///           fundDelta = +300bps*surplus - shortfall; trader gets 97% surplus.
///         LIVENESS: if fund < shortfall the whole liquidation reverts and the
///         bag stays stuck (InsufficientInsuranceFundForShortfall) Ã¢â‚¬â€ so the
///         sizing question is a liveness floor, not just solvency.
contract EswapInsuranceStressTest is BaseV4Test {
    using PoolIdLibrary for PoolKey;

    uint256 traderNonce;
    uint256 constant CASCADE_N = 5;

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
        t = makeAddr(string(abi.encodePacked("insTrader", traderNonce)));
    }

    /// @dev Opens a SHORT (zeroForOne=true): collateral token1, debt token0.
    function _openShort(address t, uint256 margin, uint8 L) internal returns (uint256 collateral, uint256 borrow) {
        uint256 bought = (margin * L * 96) / 100;
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
        // Simulate Router minting ERC-6909 collateral claims to the hook.
        // For SHORT (zeroForOne=true): boughtAmount = delta.amount1() = bought.
        // Need 2× positionCollateral for _settleTransientDebt + _settle burns.
        manager.mint(address(hook), uint256(uint160(address(token1))), bought * 2);
        (, collateral, borrow,,,,,,) = hook.positions(key.toId(), t);
    }

    function _fund() internal view returns (uint256) {
        return hook.insuranceFund(key.currency0);
    }

    // ------------------------------------------------------------------
    // Scenario A: accrual-vs-tail grid. Mild crashes ACCRUE (300bps of
    // surplus); deep crashes DRAW. Emits the coverage table.
    // ------------------------------------------------------------------

    /// @dev Resets oracle to 1:1 and pool spot to tick 0 so every open passes
    ///      the V4-spot-vs-TWAP circuit breaker (beforeSwap checks it).
    function _resetPrices() internal {
        priceFeed.setPrice(address(token0), 1e18);
        priceFeed.setPrice(address(token1), 1e18);
        manager.setSlot0(key.toId(), 79228162514264337593543950336, 0);
    }

    function _crashCase(address t, uint256 m, uint8 L, uint256 crashPct) internal returns (int256 delta) {
        _resetPrices();
        (uint256 c, uint256 b) = _openShort(t, m, L);
        uint256 R = (c * (100 - crashPct)) / 100;
        priceFeed.setPrice(address(token1), 0.5e18);
        manager.setNextSwapDelta(int128(uint128(R)), -int128(uint128(R)));
        uint256 before = _fund();
        hook.executeLiquidation(key, t, 0, address(this));
        delta = int256(_fund()) - int256(before);

        int256 expSurplus = int256(R) - int256(b);
        int256 expected = expSurplus > 0 ? (expSurplus * 300) / 10000 : expSurplus;
        assertApproxEqAbs(delta, expected, 2, "fund flow mismatch");

        console2.log("L / crashPct / delta:", L);
        console2.log(crashPct);
        console2.log(uint256(delta));
    }

    function test_Insurance_Grid_AccrualVersusTail() public {
        // Pre-seed so deep-crash (DRAW) cases stay live before any accrual.
        uint256 seed = 1000 ether;
        token0.mint(address(this), seed);
        token0.approve(address(hook), seed);
        hook.seedInsuranceFund(key.currency0, seed);

        uint8[3] memory levs = [uint8(2), uint8(3), uint8(5)];
        console2.log("=== fund flow by (L, crash%): positive=accrual, negative=draw ===");
        for (uint256 i = 0; i < 3; i++) {
            for (uint256 x = 10; x <= 50; x += 20) {
                address t = _freshTrader();
                _crashCase(t, 100 ether, levs[i], x);
            }
        }
    }

    // ------------------------------------------------------------------
    // Scenario B: cascaded crash Ã¢â‚¬â€ N correlated 5x positions hit by a
    // simultaneous 50% gap. Proves: exact-minimum seed keeps EVERY
    // liquidation live (draining to dust), while one wei less strands the
    // final bag behind InsufficientInsuranceFundForShortfall.
    // ------------------------------------------------------------------

    function _cascade(uint256 m, uint8 L) internal returns (address[CASCADE_N] memory traders, uint256 totalShortfall) {
        for (uint256 i = 0; i < CASCADE_N; i++) {
            _resetPrices();
            traders[i] = _freshTrader();
            (uint256 c, uint256 b) = _openShort(traders[i], m, L);
            if (b > (c * 50) / 100) totalShortfall += b - (c * 50) / 100;
        }
    }

    function _liquidateCascade(address[CASCADE_N] memory traders) internal {
        for (uint256 i = 0; i < CASCADE_N; i++) {
            (, uint256 c,,,,,,,) = hook.positions(key.toId(), traders[i]);
            uint256 R = (c * 50) / 100;
            priceFeed.setPrice(address(token1), 0.5e18);
            manager.setNextSwapDelta(int128(uint128(R)), -int128(uint128(R)));
            hook.executeLiquidation(key, traders[i], 0, address(this));
        }
    }

    function test_Insurance_MinSeed_Cascade_Liveness() public {
        // --- Run 1: exact minimum seed -> every bag cleared, fund -> dust. ---
        (address[CASCADE_N] memory tradersA, uint256 seedNeeded) = _cascade(100 ether, 5);
        assertTrue(seedNeeded > 0, "scenario must produce bad debt");

        token0.mint(address(this), seedNeeded);
        token0.approve(address(hook), seedNeeded);
        hook.seedInsuranceFund(key.currency0, seedNeeded);

        _liquidateCascade(tradersA);
        assertLe(_fund(), CASCADE_N, "exact seed fully consumed (dust only)");
        console2.log("minSeed (5x5x@50%, margin 100e each):", seedNeeded);

        // --- Run 2: one wei less -> the LAST liquidation SUCCEEDS by drawing the
        //     remaining fund and booking the uncovered wei as protocol bad debt
        //     [FIX C-7] — previously it reverted and stranded the bag forever. ---
        (address[CASCADE_N] memory tradersB, uint256 seedNeededB) = _cascade(100 ether, 5);
        assertEq(seedNeededB, seedNeeded, "identical economics");

        token0.mint(address(this), seedNeeded - 1);
        token0.approve(address(hook), seedNeeded - 1);
        hook.seedInsuranceFund(key.currency0, seedNeeded - 1);

        for (uint256 i = 0; i < CASCADE_N - 1; i++) {
            (, uint256 c,,,,,,,) = hook.positions(key.toId(), tradersB[i]);
            uint256 R = (c * 50) / 100;
            priceFeed.setPrice(address(token1), 0.5e18);
            manager.setNextSwapDelta(int128(uint128(R)), -int128(uint128(R)));
            hook.executeLiquidation(key, tradersB[i], 0, address(this));
        }

        // Final position: fund is one wei short of its shortfall.
        (, uint256 cLast,,,,,,,) = hook.positions(key.toId(), tradersB[CASCADE_N - 1]);
        uint256 RLast = (cLast * 50) / 100;
        priceFeed.setPrice(address(token1), 0.5e18);
        manager.setNextSwapDelta(int128(uint128(RLast)), -int128(uint128(RLast)));

        hook.executeLiquidation(key, tradersB[CASCADE_N - 1], 0, address(this));

        (, uint256 cFinal,,,,,,,) = hook.positions(key.toId(), tradersB[CASCADE_N - 1]);
        assertEq(cFinal, 0, "final bag cleared despite 1 wei shortfall");
        assertEq(_fund(), 0, "insurance fully consumed");
        assertEq(hook.badDebt(key.currency0), 1 wei, "uncovered shortfall booked as bad debt");
    }

    // ------------------------------------------------------------------
    // Scenario C: steady-state accrual Ã¢â‚¬â€ how many BENIGN liquidations
    // (10% dip, healthy surplus) pre-fund ONE tail event?
    // ------------------------------------------------------------------

    function test_Insurance_SteadyState_AccrualPerBenignEvent() public {
        uint256 m = 100 ether;
        address t = _freshTrader();
        (uint256 c, uint256 b) = _openShort(t, m, 5);

        uint256 R = (c * 90) / 100;
        require(R > b, "model expects surplus at 10%");
        priceFeed.setPrice(address(token1), 0.5e18);
        manager.setNextSwapDelta(int128(uint128(R)), -int128(uint128(R)));
        uint256 before = _fund();
        hook.executeLiquidation(key, t, 0, address(this));
        uint256 accrued = _fund() - before;

        uint256 expectedAccrual = ((R - b) * 300) / 10000;
        assertApproxEqAbs(accrued, expectedAccrual, 2, "benign accrual");

        uint256 tailNeed = b - (c * 50) / 100;
        uint256 benignEventsNeeded = tailNeed / accrued + 1;
        console2.log("tailNeed(50% gap):", tailNeed);
        console2.log("accrual per benign event:", accrued);
        console2.log("benign events to pre-fund one tail:", benignEventsNeeded);

        // Documented expectation: accrual alone is slow; seeding dominates.
        assertGe(benignEventsNeeded, 50, "accrual unexpectedly rich");
        assertLe(benignEventsNeeded, 500, "accrual unexpectedly poor");
    }
}
