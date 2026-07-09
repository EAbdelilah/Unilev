// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AggregatorV3Interface} from "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

/**
 * @title PriceFeed
 * @notice Production-grade Chainlink price feed implementation for ESWAP V4.
 */
contract PriceFeed {
    mapping(address => address) public priceFeeds; // Token -> Chainlink Feed
    address public owner;

    constructor() {
        owner = msg.sender;
    }

    function setPriceFeed(address token, address feed) external {
        require(msg.sender == owner, "Not owner");
        priceFeeds[token] = feed;
    }

    function getAmountInUsd(address token, uint256 amount) external view returns (uint256) {
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
