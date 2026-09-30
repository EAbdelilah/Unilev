// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IUniswapV3Pool} from "../interfaces/IUniswapV3.sol";
import {V3TwapMath} from "./libraries/V3TwapMath.sol";

interface IAggregatorV3 {
    function decimals() external view returns (uint8);

    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
}

/**
 * @title EthTwapFeed
 * @notice Chainlink-AggregatorV3Interface-compatible ETH/USD oracle backed by a
 *         Uniswap V3 WETH/USDC TWAP.
 * @dev Why this exists: `PriceFeed.MAX_ORACLE_AGE` is 3600 (1h), but Chainlink
 *      updates its Unichain feeds only on deviation/heartbeat, so the ETH/USD feed
 *      routinely goes over an hour between updates and `_getValidatedPrice`
 *      reverts `StalePrice()`. That stalls every position and, once
 *      `requireTwapOracle` is on, the whole venue. Rather than loosening the
 *      staleness policy, this supplies a continuously-fresh price.
 *
 *      The USD anchor: the answer is USDC-per-WETH taken as USD, i.e. it assumes
 *      USDC trades at $1. That assumption is DELIBERATELY bounded, not trusted --
 *      `PriceFeed.setAnswerBounds(WETH, ...)` must be configured with a band, so
 *      if USDC strays far enough from $1 that ETH/USD leaves the band, every
 *      price read reverts `OraclePriceOutOfBounds()` and the venue halts instead of
 *      liquidating against a pegged-out "USD". Bounds are therefore a hard
 *      prerequisite of deploying this feed, not an optional extra.
 *
 *      A 30-minute TWAP window is used: long enough that a single-block flash swap
 *      or a momentary liquidity withdrawal cannot move it, short enough to track
 *      genuine ETH price moves within a liquidation's lifetime.
 *
 *      The feed is independent of the V4 pool the hook circuit-breaks against,
 *      which is what keeps the V4-spot-vs-TWAP comparison meaningful.
 */
contract EthTwapFeed is IAggregatorV3 {
    /// @notice Uniswap V3 WETH/USDC pool used for the TWAP.
    IUniswapV3Pool public immutable pool;
    /// @notice TWAP window in seconds.
    uint32 public immutable window;
    /// @notice USDC (expected pool token0).
    address public immutable usdc;
    /// @notice WETH (expected pool token1).
    address public immutable weth;

    error BadPool();
    error ZeroAnswer();
    error Unsupported();

    constructor(address pool_, uint32 window_, address usdc_, address weth_) {
        if (pool_ == address(0) || window_ == 0) revert BadPool();
        IUniswapV3Pool p = IUniswapV3Pool(pool_);
        // Fail loudly at deploy time: `consultUsdcPerWeth18` assumes
        // token0 = USDC (6) / token1 = WETH (18).
        if (p.token0() != usdc_ || p.token1() != weth_) revert BadPool();
        pool = p;
        window = window_;
        usdc = usdc_;
        weth = weth_;
    }

    // ─── AggregatorV3Interface ────────────────────────────────────────────────

    function decimals() external pure returns (uint8) {
        return 18;
    }

    function description() external pure returns (string memory) {
        return "ETH/USD (Uniswap V3 TWAP, USDC-anchored)";
    }

    function version() external pure returns (uint256) {
        return 1;
    }

    function getRoundData(uint80) external pure returns (uint80, int256, uint256, uint256, uint80) {
        revert Unsupported();
    }

    /// @inheritdoc IAggregatorV3
    /// @dev `updatedAt` is `block.timestamp` because the answer is derived from the
    ///      pool's current cumulative state, so it is fresh by construction.
    ///      Stamping it with the newest observation's timestamp would report the age
    ///      of the last swap rather than of the answer, and would spuriously trip
    ///      `PriceFeed`'s 1h staleness check on a quiet pool.
    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
    {
        uint256 answer18 = ethPerUsd18();
        if (answer18 == 0) revert ZeroAnswer();

        roundId = uint80(block.number);
        answer = int256(answer18);
        startedAt = block.timestamp;
        updatedAt = block.timestamp;
        answeredInRound = roundId;
    }

    /// @notice ETH price in USD, 18 decimals (USDC per WETH, USDC == $1).
    function ethPerUsd18() public view returns (uint256) {
        return V3TwapMath.consultUsdcPerWeth18(address(pool), window);
    }
}
