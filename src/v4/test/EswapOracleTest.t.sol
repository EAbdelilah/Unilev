// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {PriceFeed} from "../PriceFeed.sol";
import {AggregatorV3Interface} from "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";

contract ChainlinkFeedMock is AggregatorV3Interface {
    int256 public price;
    uint256 public updatedAt;
    uint80 public answeredInRound = 1;

    function setMockData(int256 _price, uint256 _updatedAt) external {
        price = _price;
        updatedAt = _updatedAt;
    }

    function setAnsweredInRound(uint80 _answeredInRound) external {
        answeredInRound = _answeredInRound;
    }

    function decimals() external pure returns (uint8) {
        return 8;
    }

    function description() external pure returns (string memory) {
        return "Mock Feed";
    }

    function version() external pure returns (uint256) {
        return 1;
    }

    function getRoundData(uint80) external view returns (uint80, int256, uint256, uint256, uint80) {
        return (1, price, updatedAt, updatedAt, answeredInRound);
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (1, price, updatedAt, updatedAt, answeredInRound);
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
        // MAX_ORACLE_AGE is 1 h (3600 s); 90000 s old is past the threshold.
        vm.warp(100_000); // well beyond 90000 so the price is stale
        chainlinkMock.setMockData(2000e8, block.timestamp - 90000);

        vm.expectRevert(PriceFeed.StalePrice.selector);
        priceFeed.getAmountInUsd(TOKEN, 1 ether);
    }

    /// @dev [AUDIT HIGH-8] An incomplete round (answeredInRound < roundId) must
    ///      be rejected as stale instead of trusting a half-published answer.
    function test_UncompletedRound_Reverts() public {
        chainlinkMock.setMockData(2000e8, block.timestamp);
        chainlinkMock.setAnsweredInRound(0); // roundId is 1 → incomplete answer

        vm.expectRevert(PriceFeed.StalePrice.selector);
        priceFeed.getAmountInUsd(TOKEN, 1 ether);
    }

    /// @dev [AUDIT HIGH-8] A future `updatedAt` must never pass silently: it
    ///      would bypass the staleness bound with a bogus timestamp.
    function test_FutureTimestamp_Reverts() public {
        chainlinkMock.setMockData(2000e8, block.timestamp + 7200);

        vm.expectRevert(PriceFeed.StalePrice.selector);
        priceFeed.getAmountInUsd(TOKEN, 1 ether);
    }

    /// @dev [AUDIT HIGH-9] A malformed sequencer answer (not 0/1) must be
    ///      treated as DOWN, never assumed operational.
    function test_SequencerMalformedAnswer_Reverts() public {
        priceFeed.setSequencerUptimeFeed(address(sequencerMock));
        sequencerMock.setMockData(2, block.timestamp - 7200);

        vm.expectRevert(PriceFeed.SequencerDown.selector);
        priceFeed.getAmountInUsd(TOKEN, 1 ether);
    }

    /// @dev [AUDIT HIGH-9] A sequencer feed that never started (startedAt == 0)
    ///      must be rejected: a huge timestamp-0 elapsed would otherwise bypass
    ///      the grace period.
    function test_SequencerUnstarted_Reverts() public {
        priceFeed.setSequencerUptimeFeed(address(sequencerMock));
        sequencerMock.setMockData(0, 0); // UP but never initialized

        vm.expectRevert(PriceFeed.GracePeriodNotMet.selector);
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

    /// @dev [FIX M-2b] A per-feed ceiling must override the global 1h default so
    ///      slow-moving L2 stablecoin feeds (e.g. Base USDC/USD ~24h heartbeat)
    ///      are not rejected as stale while still being bounded.
    function test_PerFeedMaxAge_OverridesDefault() public {
        // Use the native-ETH price key so the decimals path resolves to 18 (the
        // test token has no code, and a successful read would call decimals()).
        address key = priceFeed.NATIVE_ETH_PRICE_KEY();
        priceFeed.setPriceFeed(key, address(chainlinkMock));
        vm.warp(100_000);
        chainlinkMock.setMockData(2000e8, block.timestamp - 20_000); // ~5.5h old

        // Default (1h) rejects it.
        vm.expectRevert(PriceFeed.StalePrice.selector);
        priceFeed.getAmountInUsd(key, 1 ether);

        // Per-feed ceiling of 24h accepts the same answer.
        priceFeed.setMaxOracleAge(key, 86400);
        assertEq(priceFeed.getAmountInUsd(key, 1 ether), 2000e18);
    }

    /// @dev [FIX M-2b] Setting the per-feed ceiling back to zero must restore the
    ///      global MAX_ORACLE_AGE behaviour (backward compatible default).
    function test_PerFeedMaxAge_ZeroRestoresDefault() public {
        address key = priceFeed.NATIVE_ETH_PRICE_KEY();
        priceFeed.setPriceFeed(key, address(chainlinkMock));
        vm.warp(100_000);
        chainlinkMock.setMockData(2000e8, block.timestamp - 20_000);

        priceFeed.setMaxOracleAge(key, 86400);
        assertEq(priceFeed.getAmountInUsd(key, 1 ether), 2000e18);

        priceFeed.setMaxOracleAge(key, 0);
        vm.expectRevert(PriceFeed.StalePrice.selector);
        priceFeed.getAmountInUsd(key, 1 ether);
    }

    /// @dev [FIX M-2b] Governance must not be able to disable the staleness guard:
    ///      the ceiling is bounded to [60s, 7 days].
    function test_SetMaxOracleAge_Bounds() public {
        vm.expectRevert(bytes("bad max age"));
        priceFeed.setMaxOracleAge(TOKEN, 30);

        vm.expectRevert(bytes("bad max age"));
        priceFeed.setMaxOracleAge(TOKEN, 8 days);

        priceFeed.setMaxOracleAge(TOKEN, 7 days);
        assertEq(priceFeed.maxOracleAgeSec(TOKEN), 7 days);
    }
}
