// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {PriceFeed} from "../PriceFeed.sol";
import {AggregatorV3Interface} from "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";

contract ChainlinkFeedMock is AggregatorV3Interface {
    int256 public price;
    uint256 public updatedAt;

    function setMockData(int256 _price, uint256 _updatedAt) external {
        price = _price;
        updatedAt = _updatedAt;
    }

    function decimals() external pure returns (uint8) { return 8; }
    function description() external pure returns (string memory) { return "Mock Feed"; }
    function version() external pure returns (uint256) { return 1; }

    function getRoundData(uint80) external view returns (uint80, int256, uint256, uint256, uint80) {
        return (1, price, updatedAt, updatedAt, 1);
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (1, price, updatedAt, updatedAt, 1);
    }
}

contract SequencerFeedMock {
    int256 public answer;
    uint256 public startedAt;

    function setMockData(int256 _answer, uint256 _startedAt) external {
        answer = _answer;
        startedAt = _startedAt;
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (1, answer, startedAt, startedAt, 1);
    }
}

contract EswapOracleTest is Test {
    PriceFeed public priceFeed;
    ChainlinkFeedMock public chainlinkMock;
    SequencerFeedMock public sequencerMock;
    address public constant TOKEN = address(0x123);

    function setUp() public {
        vm.warp(10_000); // Set timestamp > 3600 to prevent underflow
        priceFeed = new PriceFeed();
        chainlinkMock = new ChainlinkFeedMock();
        sequencerMock = new SequencerFeedMock();

        priceFeed.setPriceFeed(TOKEN, address(chainlinkMock));
    }

    function test_SequencerDown_RevertsOnOpen() public {
        priceFeed.setSequencerUptimeFeed(address(sequencerMock));
        sequencerMock.setMockData(1, block.timestamp); // 1 = DOWN

        vm.expectRevert(PriceFeed.SequencerDown.selector);
        priceFeed.getAmountInUsd(TOKEN, 1 ether);
    }

    function test_SequencerGracePeriod_RevertsOnOpen() public {
        priceFeed.setSequencerUptimeFeed(address(sequencerMock));
        sequencerMock.setMockData(0, block.timestamp - 100); // UP, but grace period (<3600s) not met

        vm.expectRevert(PriceFeed.GracePeriodNotMet.selector);
        priceFeed.getAmountInUsd(TOKEN, 1 ether);
    }

    function test_StalePrice_Reverts() public {
        chainlinkMock.setMockData(2000e8, block.timestamp - 4000); // older than MAX_ORACLE_AGE (3600s)

        vm.expectRevert(PriceFeed.StalePrice.selector);
        priceFeed.getAmountInUsd(TOKEN, 1 ether);
    }

    function test_OracleMinAnswer_Reverts() public {
        priceFeed.setAnswerBounds(TOKEN, 100e8, 10000e8);
        chainlinkMock.setMockData(50e8, block.timestamp); // Below min 100e8

        vm.expectRevert(PriceFeed.OraclePriceOutOfBounds.selector);
        priceFeed.getAmountInUsd(TOKEN, 1 ether);
    }

    function test_OracleMaxAnswer_Reverts() public {
        priceFeed.setAnswerBounds(TOKEN, 100e8, 10000e8);
        chainlinkMock.setMockData(15000e8, block.timestamp); // Above max 10000e8

        vm.expectRevert(PriceFeed.OraclePriceOutOfBounds.selector);
        priceFeed.getAmountInUsd(TOKEN, 1 ether);
    }
}
