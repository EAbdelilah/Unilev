// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BaseV4Test, PriceFeedMock, ERC20Mock} from "./BaseV4Test.t.sol";
import {PoolManagerCallbackMock} from "./mocks/PoolManagerMock.sol";
import {EswapMarginHook} from "../EswapMarginHook.sol";
import {EswapRouter} from "../EswapRouter.sol";
import {PoolKey} from "../types/PoolKey.sol";
import {PoolIdLibrary} from "../types/PoolId.sol";
import {Currency} from "../types/Currency.sol";
import {IPoolManager} from "../interfaces/IPoolManager.sol";
import {BalanceDeltaLibrary} from "../types/BalanceDelta.sol";

/// @notice Stress simulations for the aggregator-facing OI cap system.
///         All tokens are 18-dec with oracle price 1e18, so raw units == USD.
///
///         Model per open(margin m, leverage L): bought = L*m; collateral
///         c = L*m*9950/10000 (50bps protocol fee); borrowed b = (L-1)*m.
///
///         HEADLINE FINDINGS (drive the deploy recommendation):
///          1. A homogeneous 2x book saturating the LEGACY 1500bps aggregate
///             cap can only put ~29.9% of TVL to work (scenario 1).
///          2. A realistic diversified book (~40% deployment across 2x/3x/5x)
///             is flatly impossible under legacy caps; it fits comfortably
///             under the recommended 200bps-single / 6500bps-total preset
///             (scenario 3).
contract EswapCapStressTest is BaseV4Test {
    using PoolIdLibrary for PoolKey;

    PoolManagerCallbackMock managerMock;
    uint256 traderNonce;

    function setUp() public override {
        managerMock = new PoolManagerCallbackMock();
        manager = managerMock;
        priceFeed = new PriceFeedMock();

        token0 = new ERC20Mock("Token 0", "TK0");
        token1 = new ERC20Mock("Token 1", "TK1");

        address hookAddress = address(uint160((1 << 159) | (1 << 158) | (1 << 153) | (1 << 152) | (1 << 148)));
        deployCodeTo("EswapMarginHook.sol:EswapMarginHook", abi.encode(manager, priceFeed, address(this)), hookAddress);
        hook = EswapMarginHook(payable(hookAddress));

        key = PoolKey({
            currency0: Currency.wrap(address(token0)),
            currency1: Currency.wrap(address(token1)),
            fee: 3000,
            tickSpacing: 60,
            hooks: address(hook)
        });

        hook.setRouterAndMinCollateralUsd(address(new EswapRouter(manager)), 0);
        hook.setAuthorizedPool(key.toId(), true);
        manager.setSlot0(key.toId(), 79228162514264337593543950336, 0);
    }

    function _freshTrader() internal returns (address t) {
        traderNonce++;
        t = makeAddr(string(abi.encodePacked("stressTrader", traderNonce)));
    }

    function _open(address t, uint256 margin, uint8 leverage) internal {
        bytes memory data = abi.encode(true, leverage, t);
        vm.prank(address(manager));
        hook.beforeSwap(address(this), key, IPoolManager.SwapParams(true, -int256(margin), 0), data);
        vm.prank(address(manager));
        hook.afterSwap(
            address(this),
            key,
            IPoolManager.SwapParams(true, -int256(margin * leverage), 0),
            BalanceDeltaLibrary.toBalanceDelta(int128(-int256(margin * leverage)), int128(int256(margin * leverage))),
            data
        );
    }

    function _capacity()
        internal
        view
        returns (bool active, uint256 tvl, uint256 oi, uint256 maxSingle, uint256 remaining)
    {
        return hook.openInterestCapacity();
    }

    /// @dev Reads ONLY the preview views, predicts pass/fail, then asserts
    ///      execution agrees — including exact revert payloads. Any drift
    ///      between advertised capacity and enforcement fails loudly. NOTE:
    ///      callers must size trades UNDER the single cap when they intend
    ///      acceptance; a predicted FAIL is asserted as an exact rejection.
    function _assertViewMatchesExecution(uint256 margin, uint8 leverage) internal {
        address t = _freshTrader();
        (bool capsActive,, uint256 oi, uint256 maxSingle, uint256 remaining) = _capacity();
        (bool fits,) = hook.quoteOpenFit(key, t, key.currency0, leverage, margin, margin * (leverage - 1));

        uint256 tradeOI = margin * (leverage - 1);
        bool predicted = (!capsActive || leverage == 1) || (tradeOI <= maxSingle && tradeOI <= remaining);

        if (predicted) {
            assertTrue(fits, "view predicted PASS");
            _open(t, margin, leverage);
        } else {
            assertFalse(fits, "view predicted FAIL");
            bytes memory expected;
            if (tradeOI > maxSingle) {
                expected = abi.encodeWithSelector(EswapMarginHook.PositionExceedsSingleCap.selector, tradeOI, maxSingle);
            } else {
                // Arg2 reconstructs the absolute aggregate cap: oi + remaining.
                expected = abi.encodeWithSelector(
                    EswapMarginHook.OpenInterestExceedsCapacity.selector, oi + tradeOI, oi + remaining
                );
            }
            vm.prank(address(manager));
            vm.expectRevert(expected);
            hook.beforeSwap(
                address(this), key, IPoolManager.SwapParams(true, -int256(margin), 0), abi.encode(true, leverage, t)
            );
        }
    }

    // ------------------------------------------------------------------
    // Scenario 1: homogeneous 2x book vs DEFAULT caps. Steps are sized
    // under the single cap so the AGGREGATE gate is the binder. At
    // saturation: OI ~= cap (15% of TVL) => only ~29.9% of TVL can be
    // deployed as 2x collateral (deployedCollateral/TVL ~= 0.15/0.5025).
    // ------------------------------------------------------------------

    function test_Stress_2xBook_LegacyCap_DeploysOnly30pctOfTvl() public {
        _open(_freshTrader(), 100_000 ether, 1); // anchor: TVL 99_500e, OI 0

        uint8 L = 2;
        uint256 m = 1_000 ether; // tradeOI 1_000e <= 2% of any post-floor TVL

        uint256 opened;
        while (opened < 1000) {
            (bool capsActive,,, uint256 maxSingle, uint256 remaining) = _capacity();
            uint256 stepOI = m * (L - 1);
            if (!capsActive || (stepOI <= maxSingle && stepOI <= remaining)) {
                _open(_freshTrader(), m, L);
                opened++;
            } else {
                break;
            }
        }
        assertTrue(opened > 0 && opened < 1000, "must saturate in bounded steps");

        (, uint256 tvlEnd, uint256 oiEnd,,) = _capacity();
        uint256 maxTotal = (tvlEnd * hook.maxTotalOIBps()) / 10000;
        assertLe(oiEnd, maxTotal, "cap never exceeded");
        assertLt(maxTotal - oiEnd, m, "stopped within one step of the cap");

        // Utilization pins to the cap itself...
        uint256 utilBps = (oiEnd * 10_000) / tvlEnd;
        assertApproxEqAbs(utilBps, hook.maxTotalOIBps(), 120, "OI pins to the aggregate cap");

        // ...WHICH means only ~29.9% of TVL works as 2x collateral under
        // legacy defaults. This is the saturation quirk, quantified.
        uint256 deployed2xCollateral = (opened * m * L * 9950) / 10000;
        uint256 deployedBps = (deployed2xCollateral * 10_000) / tvlEnd;
        // Analytic steady state: 1500 * (2*0.995) / (1 + 0.15*1.99) = 2603bps
        // of TOTAL TVL, i.e. 2603/9950-of-deployed normalization lands the
        // 2x-collateral share near 29.9%; allow step-granularity slack.
        assertApproxEqAbs(deployedBps, 2985, 250, "legacy cap idles ~70% of TVL at 2x");
    }

    // ------------------------------------------------------------------
    // Scenario 2: mixed-leverage book — running analytic sums match the
    // preview views exactly after every interleaved open (no drift).
    // ------------------------------------------------------------------

    function test_Stress_MixedPortfolio_AnalyticHeadroomExact() public {
        // Legacy cap VALUES; low activation floor so every round is capped.
        hook.setOpenInterestCaps(hook.maxSingleOIBps(), hook.maxTotalOIBps(), 1_000 ether);

        // Anchors lift TVL so even the largest per-trade OI (5x: 48_000e)
        // clears the 2%-of-TVL single gate from the first round on.
        for (uint256 i = 0; i < 15; i++) {
            _open(_freshTrader(), 166_000 ether, 1);
        }
        (, uint256 anchorTvl,, uint256 anchorMaxSingle,) = _capacity();
        assertGe(anchorMaxSingle, 48_000 ether, "single gate must clear the largest step");

        uint256[3] memory margins = [uint256(10_000 ether), 15_000 ether, 12_000 ether];
        uint8[3] memory levs = [uint8(2), 3, 5];
        // Per-group tradeOI: 10k / 30k / 48k — all <= 49.5k single cap.

        uint256 expTvl = anchorTvl;
        uint256 expOi;

        // 5 interleaved rounds stay under the aggregate cap:
        // OI_end = 5*88k = 440k <= 15% of ~3.2M TVL.
        for (uint256 round = 0; round < 5; round++) {
            for (uint256 g = 0; g < 3; g++) {
                address t = _freshTrader();
                uint256 m = margins[g];
                uint8 L = levs[g];

                _open(t, m, L);

                expTvl += (m * L * 9950) / 10000;
                expOi += m * (L - 1);

                (bool capsActive, uint256 tvl, uint256 oi,, uint256 remaining) = _capacity();
                assertTrue(capsActive, "capped regime throughout");
                assertEq(tvl, expTvl, "TVL tracker drifted");
                assertEq(oi, expOi, "OI tracker drifted");
                uint256 maxTotal = (expTvl * hook.maxTotalOIBps()) / 10000;
                assertEq(remaining, maxTotal > expOi ? maxTotal - expOi : 0, "headroom drifted");
                assertGt(remaining, 0, "scenario must stay under aggregate cap");
            }
        }
    }

    // ------------------------------------------------------------------
    // Scenario 3: recommended DEPLOY preset (200bps single / 6500bps total).
    // Realistic diversified book built from single-cap-compliant trades
    // reaches ~39% deployment; legacy 1500bps demonstrably rejects it.
    // Every leveraged open cross-checks views-vs-execution.
    // ------------------------------------------------------------------

    function test_Stress_RecommendedPreset_AcceptsRealisticPortfolio() public {
        hook.setOpenInterestCaps(200, 6500, 100_000 ether);

        // 1x anchors push TVL far past the floor without OI cost.
        for (uint256 i = 0; i < 6; i++) {
            _open(_freshTrader(), 166_000 ether, 1);
        }
        (, uint256 anchorTvl, uint256 anchorOi,,) = _capacity();
        assertEq(anchorOi, 0, "1x adds no OI");
        assertGt(anchorTvl, hook.oiCapTvlFloorUsd());

        // Groups sized so EVERY trade clears the 2% single gate against the
        // ~1M anchor TVL (max allowed OI/trade ~= 19.8k):
        // 2x: 12k margin -> 12k OI; 3x: 9k -> 18k; 5x: 4.5k -> 18k.
        // Smallest leverage first keeps utilization monotone during build.
        for (uint256 i = 0; i < 20; i++) {
            _assertViewMatchesExecution(12_000 ether, 2);
        }
        for (uint256 i = 0; i < 20; i++) {
            _assertViewMatchesExecution(9_000 ether, 3);
        }
        for (uint256 i = 0; i < 20; i++) {
            _assertViewMatchesExecution(4_500 ether, 5);
        }

        (, uint256 tvlEnd, uint256 oiEnd,, uint256 remainingEnd) = _capacity();

        uint256 utilBps = (oiEnd * 10_000) / tvlEnd;
        assertGe(utilBps, 3500, "portfolio must stress beyond legacy capacity (>35%)");
        assertLt(utilBps, 6500, "book fits under the preset with headroom");

        // Legacy ceiling on the SAME TVL is below realized OI: retune needed.
        uint256 legacyMaxTotal = (tvlEnd * 1500) / 10000;
        assertLt(legacyMaxTotal, oiEnd, "legacy cap rejects this realistic book");

        assertGt(remainingEnd, 0);
        assertLe(remainingEnd, (tvlEnd * 6500) / 10000);
    }

    // ------------------------------------------------------------------
    // Scenario 4: single-cap boundary exactness AT the preset — borrowing
    // exactly the advertised per-trade maximum passes; +1wei fails both the
    // view and executionally, with exact revert args.
    // (Aggregate-boundary exactness is covered by EswapOpenInterestCapsTest.)
    // ------------------------------------------------------------------

    function test_Stress_Preset_SingleCapBoundaryExact() public {
        hook.setOpenInterestCaps(200, 6500, 100_000 ether);

        _open(_freshTrader(), 500_000 ether, 1); // deep anchor -> wide aggregate slack

        (bool capsActive,,, uint256 maxSingle, uint256 remaining) = _capacity();
        assertTrue(capsActive);
        assertGt(remaining, maxSingle, "aggregate must be slack so single cap binds alone");

        // Exactly maxSingle passes (2x, borrow == margin).
        address tFit = _freshTrader();
        (bool fitsFit, string memory rFit) = hook.quoteOpenFit(key, tFit, key.currency0, 2, maxSingle, maxSingle);
        assertTrue(fitsFit, "exact single-cap borrow must fit");
        assertEq(bytes(rFit).length, 0);
        _open(tFit, maxSingle, 2);

        // +1wei now breaches the recomputed single cap.
        (,,, uint256 maxSingle2,) = _capacity();
        address tFail = _freshTrader();
        uint256 over = maxSingle2 + 1;
        (bool fitsFail, string memory reasonFail) = hook.quoteOpenFit(key, tFail, key.currency0, 2, over, over);
        assertFalse(fitsFail, "over-cap borrow must not fit");
        assertTrue(bytes(reasonFail).length > 0);

        vm.prank(address(manager));
        vm.expectRevert(abi.encodeWithSelector(EswapMarginHook.PositionExceedsSingleCap.selector, over, maxSingle2));
        hook.beforeSwap(address(this), key, IPoolManager.SwapParams(true, -int256(over), 0), abi.encode(true, 2, tFail));
    }
}
