// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {IUniswapV3Pool} from "../../interfaces/IUniswapV3.sol";
import {V3TwapMath} from "../libraries/V3TwapMath.sol";
import {EthTwapFeed} from "../EthTwapFeed.sol";
import {UsdcTwapFeed} from "../UsdcTwapFeed.sol";

interface IAggregatorV3View {
    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80);
}

/// @dev Fork coverage for the Uniswap V3 TWAP oracles that back the live Unichain
///      PriceFeed, whose staleness bound (3600s) Chainlink's Unichain feeds
///      routinely exceed.
///
///      The maths here has silently returned plausible-looking garbage twice:
///      multiplying instead of dividing produced 7.2e24 instead of ~1.0e18, and
///      reading `secondsPerLiquidityCumulativeX128s` out of `observe()` as a price
///      produced 2.98e38. Both pass a naive "non-zero" assertion, so these tests
///      assert the answer is *plausible* (magnitude AND pegged to Chainlink),
///      which is what actually catches the failure mode.
contract TwapFeedForkTest is Test {
    /// @dev Uniswap V3 USDC/WETH 0.30% pool on Unichain (deepest USDC/WETH tier).
    address constant POOL = 0x8927058918e3CFf6F55EfE45A58db1be1F069E49;
    address constant USDC = 0x078D782b760474a361dDA0AF3839290b0EF57AD6;
    address constant WETH = 0x4200000000000000000000000000000000000006;
    address constant ETH_USD = 0xBcE70e194940a157f3A80566505a7E96f5238CCa;
    uint32 constant WINDOW = 1800;

    bool rpcAvailable;
    EthTwapFeed ethFeed;
    UsdcTwapFeed usdcFeed;

    function setUp() public {
        string memory rpcUrl = vm.envOr("UNICHAIN_RPC_URL", string(""));
        if (bytes(rpcUrl).length == 0) {
            rpcAvailable = false;
            return;
        }
        rpcAvailable = true;
        vm.createSelectFork(rpcUrl);

        ethFeed = new EthTwapFeed(POOL, WINDOW, USDC, WETH);
        usdcFeed = new UsdcTwapFeed(POOL, ETH_USD, WINDOW, USDC, WETH);
    }

    // ─── Plumbing ─────────────────────────────────────────────────────────────

    function test_ConstantsAndDecimals() public {
        if (!rpcAvailable) { vm.skip(true); return; }
        assertEq(ethFeed.decimals(), 18, "ETH feed decimals");
        assertEq(usdcFeed.decimals(), 18, "USDC feed decimals");
        assertEq(ethFeed.window(), WINDOW, "ETH feed window");
        assertEq(usdcFeed.window(), WINDOW, "USDC feed window");
        assertEq(address(ethFeed.pool()), POOL, "ETH feed pool");
        assertEq(address(usdcFeed.pool()), POOL, "USDC feed pool");
    }

    /// @dev Rejects a pool whose token ordering is reversed, which would silently
    ///      invert the price by a factor of ~1e24.
    function test_RejectsReversedPoolOrdering() public {
        vm.expectRevert(EthTwapFeed.BadPool.selector);
        new EthTwapFeed(POOL, WINDOW, WETH, USDC); // usdc/weth swapped

        vm.expectRevert(UsdcTwapFeed.BadPool.selector);
        new UsdcTwapFeed(POOL, ETH_USD, WINDOW, WETH, USDC);
    }

    function test_RejectsZeroWindowAndZeroPool() public {
        vm.expectRevert(EthTwapFeed.BadPool.selector);
        new EthTwapFeed(POOL, 0, USDC, WETH);

        vm.expectRevert(EthTwapFeed.BadPool.selector);
        new EthTwapFeed(address(0), WINDOW, USDC, WETH);
    }

    function test_GetRoundDataUnsupported() public {
        vm.expectRevert(EthTwapFeed.Unsupported.selector);
        ethFeed.getRoundData(0);
    }

    // ─── The maths that actually matters ───────────────────────────────────────

    /// @dev ETH/USD is USDC-per-WETH taken as USD. It must land within 10% of
    ///      Chainlink's ETH/USD, otherwise the venue is valuing collateral off a
    ///      pool that has diverged from the real market.
    function test_EthUsd_TwapTracksChainlink() public {
        if (!rpcAvailable) { vm.skip(true); return; }

        uint256 twap = ethFeed.ethPerUsd18();
        (, int256 chainlink,,,) = IAggregatorV3View(ETH_USD).latestRoundData();
        require(chainlink > 0, "chainlink feed unavailable");

        // Order-of-magnitude guard first: catches the 1e24 inversion instantly.
        assertGt(twap, 1, "ETH TWAP must be non-zero");
        assertLt(twap, 1e30, "ETH TWAP magnitude sane (rules out decimal inversion)");

        uint256 ref = uint256(chainlink);
        uint256 diff = twap > ref ? twap - ref : ref - twap;
        assertLe(diff * 100 / ref, 10, "ETH TWAP within 10% of Chainlink");

        console2.log("ETH/USD twap     :", twap / 1e18);
        console2.log("ETH/USD chainlink:", uint256(chainlink) / 1e18);
    }

    /// @dev USDC/USD must be ~$1. This is the assertion that would have caught
    ///      both historical bugs (7.2e24 and 2.98e38).
    function test_UsdcUsd_TwapIsPeggedToDollar() public {
        if (!rpcAvailable) { vm.skip(true); return; }

        uint256 twap = usdcFeed.usdcPerUsd18();
        assertGt(twap, 95e16, "USDC/USD above $0.95 (catches 7.2e24 / 2.98e38 garbage)");
        assertLt(twap, 105e16, "USDC/USD below $1.05");
    }

    /// @dev The two adapters must share the WETH/USDC leg byte-for-byte, otherwise
    ///      a future edit to one silently desynchronises the pair.
    function test_BothFeedsShareIdenticalWethUsdcLeg() public {
        if (!rpcAvailable) { vm.skip(true); return; }

        uint256 leg = V3TwapMath.consultUsdcPerWeth18(POOL, WINDOW);
        assertGt(leg, 1, "shared leg non-zero");
        // ETH/USD IS the shared leg (USDC == $1).
        assertEq(ethFeed.ethPerUsd18(), leg, "ETH feed == shared leg");
        // usdcPerUsd18 (18dec ratio) * leg (18dec USDC/WETH) / 1e18 == ethUsd (18dec
        // USD/WETH). The /1e18 is required: both operands carry their own 1e18.
        (, int256 ethUsd,,,) = IAggregatorV3View(ETH_USD).latestRoundData();
        require(ethUsd > 0, "chainlink feed unavailable");
        assertApproxEqRel(usdcFeed.usdcPerUsd18() * leg / 1e18, uint256(ethUsd), 1e15, "legs reconstruct Chainlink");
    }

    /// @dev `updatedAt` must be `block.timestamp`; stamping it with the newest
    ///      observation would report the age of the last swap instead of the age
    ///      of the answer and spuriously trip PriceFeed's 1h staleness check.
    function test_LatestRoundDataIsFreshByConstruction() public {
        if (!rpcAvailable) { vm.skip(true); return; }

        (uint80 roundId,,, uint256 updatedAt, uint80 answeredInRound) = ethFeed.latestRoundData();
        assertEq(updatedAt, block.timestamp, "updatedAt == block.timestamp");
        assertEq(answeredInRound, roundId, "round complete");
        assertGt(roundId, 0, "roundId set");
    }

    /// @dev `observe` exposes `secondsPerLiquidityCumulativeX128s` as its second
    ///      return value. It is a liquidity-weighted TIME counter, not a price --
    ///      reading a price out of it is the bug that produced 2.98e38. Assert the
    ///      shape of both arrays so the interface stays understood.
    function test_ObserveReturnsTickCumulativesNotPrices() public {
        if (!rpcAvailable) { vm.skip(true); return; }

        uint32[] memory ago = new uint32[](2);
        ago[0] = WINDOW;
        ago[1] = 0;
        (int56[] memory tickCumulatives, uint160[] memory secondsPerLiq) = IUniswapV3Pool(POOL).observe(ago);

        // Tick cumulatives: tiny numbers, growing with elapsed time.
        assertTrue(tickCumulatives[0] > -1e15 && tickCumulatives[0] < 1e15, "tickCumulative in tick units");
        assertTrue(tickCumulatives[1] > -1e15 && tickCumulatives[1] < 1e15, "tickCumulative in tick units");
        // Seconds-per-liquidity cumulatives: huge and Q128.128-scaled (uint160).
        // This is the trap: a real value is ~1e45, so treating it as a price is
        // off by ~1e42 -- which is exactly how the 2.98e38 USDC/USD arose.
        assertGt(secondsPerLiq[0], 1e30, "secondsPerLiq is Q128.128 scaled, not a price");
        assertLt(secondsPerLiq[0], type(uint160).max, "secondsPerLiq fits uint160");
    }
}
