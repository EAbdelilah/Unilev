// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Settable-answer AggregatorV3Interface mock used ONLY in local/anvil
///         fork simulation to force deterministic oracle-driven liquidations.
///         The live deployment keeps the real Chainlink feed; this substitutes
///         the oracle leg in the Unichain fork sim because the deep ETH/USDC
///         pool cannot be moved with dust-level capital.
contract MockAggregator {
    int256 public answer;
    uint256 public updatedAt;

    address public owner;

    constructor(int256 _answer) {
        answer = _answer;
        updatedAt = block.timestamp;
        owner = msg.sender;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    function setAnswer(int256 _answer) external onlyOwner {
        answer = _answer;
        updatedAt = block.timestamp;
    }

    function decimals() external pure returns (uint8) {
        return 18;
    }

    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 _answer, uint256 startedAt, uint256 _updatedAt, uint80 answeredInRound)
    {
        return (1, answer, updatedAt, updatedAt, 1);
    }
}