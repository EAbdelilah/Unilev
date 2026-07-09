// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AggregatorV3Interface} from "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

interface ISequencerUptimeFeed {
    function latestRoundData() external view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
}

/**
 * @title PriceFeed
 * @notice Production-grade Chainlink price feed implementation for ESWAP V4 with L2 Sequencer uptime validation.
 */
contract PriceFeed {
    mapping(address => address) public priceFeeds; // Token -> Chainlink Feed
    address public owner;
    address public sequencerUptimeFeed;
    uint256 public constant GRACE_PERIOD_TIME = 3600; // 1 hour grace period

    error SequencerDown();
    error GracePeriodNotMet();

    constructor() {
        owner = msg.sender;
    }

    function setSequencerUptimeFeed(address feed) external {
        require(msg.sender == owner, "Not owner");
        sequencerUptimeFeed = feed;
    }

    function setPriceFeed(address token, address feed) external {
        require(msg.sender == owner, "Not owner");
        priceFeeds[token] = feed;
    }

    function getAmountInUsd(address token, uint256 amount) external view returns (uint256) {
        if (sequencerUptimeFeed != address(0)) {
            (, int256 answer, uint256 startedAt, , ) = ISequencerUptimeFeed(sequencerUptimeFeed).latestRoundData();
            // answer == 0 means Sequencer is UP, answer == 1 means Sequencer is DOWN
            if (answer == 1) revert SequencerDown();
            if (block.timestamp - startedAt < GRACE_PERIOD_TIME) revert GracePeriodNotMet();
        }

        address feed = priceFeeds[token];
        if (feed == address(0)) return 0;

        (, int256 price, , , ) = AggregatorV3Interface(feed).latestRoundData();
        require(price > 0, "Invalid price");

        // Chainlink prices usually have 8 decimals. Adjust to 18.
        uint256 price18 = uint256(price) * 10**10;

        // Return value in 18 decimals (USD)
        return (amount * price18) / 1e18;
    }
}
