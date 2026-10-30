// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IUniswapV3Pool} from "../interfaces/IUniswapV3.sol";
import {FullMath} from "../../lib/v4-core/src/libraries/FullMath.sol";
import {V3TwapMath} from "./libraries/V3TwapMath.sol";

interface IAggregatorV3 {
    function decimals() external view returns (uint8);

    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
}

/// @title UsdcTwapFeed
/// @notice Chainlink-AggregatorV3Interface-compatible adapter that prices USDC/USD
///         from a Uniswap V3 USDC/WETH time-weighted average price, scaled by the
///         Chainlink ETH/USD feed.
/// @dev Why this exists: Unichain's native Chainlink USDC/USD feed is a *Reference*
///      product with a ~1 day heartbeat, so it is routinely 20+ hours old.
///      `PriceFeed.MAX_ORACLE_AGE` is 3600 (1h) -- tightened on purpose as a
///      security fix -- so that feed can essentially never satisfy the staleness
///      bound and `getTwapPrice(USDC)` returns 0, which makes the hook revert
///      `TwapNotConfigured()` for every USDC pair. Rather than loosening the
///      staleness policy or disabling `requireTwapOracle`, this adapter supplies a
///      genuinely fresh, *independent* USDC price:
///
///        USDC/USD = (V3 USDC/WETH TWAP) * (Chainlink ETH/USD)
///
///      The ETH/USD leg keeps a Chainlink anchor, so this is not a pure DEX price.
///      It stays independent of the V4 pool the hook is checking, which is what
///      makes the V4-spot-vs-TWAP circuit breaker in `EswapMarginHook` meaningful
///      (feeding it the V4 spot itself would make the check tautological).
///
///      Safety notes:
///      - The TWAP is windowed (default 30 min) and is the arithmetic mean of the
///        pool's cumulative `sqrtPriceX96` at `windowAgo` and at `now`, following
///        Uniswap's own `consult` convention. A time-weighted average cannot be
///        moved by a single-block flash swap, only sustained flow.
///      - `setAnswerBounds` on the `PriceFeed` is the intended depeg backstop:
///        configure a band (e.g. 0.90 .. 1.10) and a real USDC depeg reverts every
///        read rather than pricing positions off a broken market.
///      - The 0.30% V3 tier is used because it is the deepest USDC/WETH pool on
///        Unichain. Feed the constructor the deepest pool that actually exists on
///        the target chain; a thin pool is manipulable even through a TWAP.
contract UsdcTwapFeed is IAggregatorV3 {
    /// @notice Uniswap V3 USDC/WETH pool used for the TWAP.
    IUniswapV3Pool public immutable pool;
    /// @notice Chainlink ETH/USD feed (fresh; used to anchor the V3 ratio to USD).
    address public immutable ethUsdFeed;
    /// @notice TWAP window in seconds.
    uint32 public immutable window;
    /// @notice USDC (may be token0 or token1 of the pool).
    address public immutable usdc;
    /// @notice WETH (the other pool token).
    address public immutable weth;
    /// @notice Max age (seconds) accepted for the Chainlink ETH/USD answer. Set at
    ///         deploy to at least that feed's heartbeat; a stale answer yields 0.
    uint256 public immutable maxEthFeedAge;

    error BadPool();
    error ZeroAnswer();
    error Unsupported();

    /// @param pool_          Uniswap V3 USDC/WETH pool (token0 = USDC, token1 = WETH).
    /// @param ethUsd_        Chainlink ETH/USD aggregator.
    /// @param window_        TWAP window in seconds (e.g. 1800).
    /// @param usdc_          USDC address, validated against the pool's token0.
    /// @param weth_          WETH address, validated against the pool's token1.
    /// @param maxEthFeedAge_ Max accepted age of the ETH/USD answer, in seconds.
    constructor(
        address pool_,
        address ethUsd_,
        uint32 window_,
        address usdc_,
        address weth_,
        uint256 maxEthFeedAge_
    ) {
        if (pool_ == address(0) || ethUsd_ == address(0) || window_ == 0 || maxEthFeedAge_ == 0) revert BadPool();
        maxEthFeedAge = maxEthFeedAge_;
        IUniswapV3Pool p = IUniswapV3Pool(pool_);
        // Fail loudly at deploy time unless the pool is exactly {USDC, WETH}. Either
        // orientation is accepted so the same adapter serves Unichain (token0=USDC)
        // and Base (token0=WETH), where address sorting flips the pair.
        address t0 = p.token0();
        address t1 = p.token1();
        if (!((t0 == usdc_ && t1 == weth_) || (t0 == weth_ && t1 == usdc_))) revert BadPool();
        pool = p;
        ethUsdFeed = ethUsd_;
        window = window_;
        usdc = usdc_;
        weth = weth_;
    }

    // ─── AggregatorV3Interface ────────────────────────────────────────────────

    function decimals( ) external pure returns (uint8) {
        return 18;
    }

    function description() external pure returns (string memory) {
        return "USDC/USD (Uniswap V3 TWAP x Chainlink ETH/USD)";
    }

    function version() external pure returns (uint256) {
        return 1;
    }

    function getRoundData(uint80 ) external pure returns (uint80, int256, uint256, uint256, uint80) {
        revert Unsupported();
    }

    /// @inheritdoc IAggregatorV3
    /// @dev `updatedAt` is `block.timestamp` on purpose. The answer is derived from
    ///      the pool's *current* cumulative state, so it is fresh by construction;
    ///      stamping it with the newest observation's timestamp would report the age
    ///      of the last swap instead of the age of the answer, and would spuriously
    ///      trip `PriceFeed`'s 1h staleness check on a quiet pool.
    function latestRoundData( ) external view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
    {
        uint256 answer18 = usdcPerUsd18();
        if (answer18 == 0) revert ZeroAnswer();

        roundId = uint80(block.number);
        answer = int256(answer18);
        startedAt = block.timestamp;
        updatedAt = block.timestamp;
        answeredInRound = roundId;
    }

    // ─── Pricing ──────────────────────────────────────────────────────────────

    /// @notice USDC price in USD, 18 decimals.
    /// @dev Returns 0 ("no price") when the ETH/USD leg is stale or incomplete,
    ///      so the failure is fail-closed rather than pricing off an old anchor.
    function usdcPerUsd18() public view returns (uint256) {
        uint256 usdcPerWeth18 = V3TwapMath.consultUsdcPerWeth18(address(pool), window, usdc, weth);
        if (usdcPerWeth18 == 0) return 0;

        (uint80 ethRoundId, int256 ethUsd,, uint256 ethUpdatedAt, uint80 ethAnsweredIn) =
            IAggregatorV3(ethUsdFeed).latestRoundData();
        if (ethUsd <= 0) return 0;
        if (ethAnsweredIn < ethRoundId) return 0;
        // A future `updatedAt` must not underflow into "fresh".
        if (ethUpdatedAt > block.timestamp || block.timestamp - ethUpdatedAt > maxEthFeedAge) return 0;

        // Normalise the Chainlink leg to 18 decimals: Unichain's ETH/USD feed is
        // 18-dec but Base's is 8-dec, so the raw answer must not be assumed 18-dec.
        uint8 d = IAggregatorV3(ethUsdFeed).decimals();
        uint256 ethUsd18 = d <= 18
            ? uint256(ethUsd) * (10 ** (18 - uint256(d)))
            : uint256(ethUsd) / (10 ** (uint256(d) - 18));

        // 1 WETH = usdcPerWeth18 USDC  and  1 WETH = ethUsd18 USD, therefore
        //     USD per USDC = ethUsd18 / usdcPerWeth18.
        // This is a DIVISION, not a product: multiplying would yield ~7.2e24
        // instead of ~1.0e18. Both legs are 18-dec.
        return FullMath.mulDiv(ethUsd18, 1e18, usdcPerWeth18);
    }

}
