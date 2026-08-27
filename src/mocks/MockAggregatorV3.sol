// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/// @notice A minimal mock of a Chainlink AggregatorV3Interface.
/// Used to rescue positions stuck due to slippage constraints on old deployed contracts.
/// @dev This mock satisfies PriceFeedL1's validation checks:
///   - latestRoundData returns fresh data (updatedAt = block.timestamp)
///   - answeredInRound == roundId (passes round check)
///   - decimals() returns 8 (standard for USD feeds)
///   - aggregator() returns self (so min/max circuit breaker tries self but fails gracefully)
///   - minAnswer and maxAnswer are NOT implemented, so the try/catch in PriceFeedL1 skips them
contract MockAggregatorV3 {
    int256 public immutable answer;

    constructor(int256 _answer) {
        answer = _answer;
    }

    function decimals() external pure returns (uint8) {
        return 8;
    }

    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer_, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
    {
        roundId = 1;
        answer_ = answer;
        startedAt = block.timestamp;
        updatedAt = block.timestamp;
        answeredInRound = 1;
    }

    // Required by AggregatorV3Interface
    function description() external pure returns (string memory) {
        return "MockAggregatorV3";
    }

    function version() external pure returns (uint256) {
        return 1;
    }

    function getRoundData(uint80)
        external
        view
        returns (uint80 roundId, int256 answer_, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
    {
        return this.latestRoundData();
    }
}
