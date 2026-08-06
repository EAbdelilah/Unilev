// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AggregatorV3Interface} from "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";

interface ISequencerUptimeFeed {
    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
}

/**
 * @title PriceFeed
 * @notice Production-grade Chainlink price feed for Eswap V4 on Unichain mainnet.
 *
 * @dev Verified Unichain Mainnet Chainlink USD feeds (18-decimal answers, unlike
 *      the usual 8; confirmed live on-chain via latestRoundData()):
 *        ETH/USD  : 0xBcE70e194940a157f3A80566505a7E96f5238CCa  (18 dec, SVR feed)
 *        USDC/USD : 0xbd1cD1518eFB92a92100da62D4C488c810dFd75b  (18 dec)
 *      Chainlink has NOT published an L2 sequencer uptime feed for Unichain, so
 *      setSequencerUptimeFeed() remains unused until one becomes available.
 *
 *      All prices are normalised to 18 decimals internally, regardless of feed decimals.
 */
contract PriceFeed {
    mapping(address => address) public priceFeeds;   // token → Chainlink AggregatorV3
    mapping(address => int256)  public minAnswers;   // circuit-breaker floor (raw feed units)
    mapping(address => int256)  public maxAnswers;   // circuit-breaker ceiling (raw feed units)
    mapping(address => uint8)   public feedDecimals; // decimals of each feed answer
    address public owner;
    address public sequencerUptimeFeed;

    uint256 public constant GRACE_PERIOD_TIME = 3600; // 1 h L2 sequencer grace period
    uint256 public maxOracleAge = 43200; // 12 h staleness threshold (Unichain feeds update on deviation)

    error SequencerDown();
    error GracePeriodNotMet();
    error StalePrice();
    error OraclePriceOutOfBounds();

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    // ─── Admin ────────────────────────────────────────────────────────────────

    function setOwner(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Zero owner");
        owner = newOwner;
    }

    function setSequencerUptimeFeed(address feed) external onlyOwner {
        require(feed != address(0), "Zero feed");
        sequencerUptimeFeed = feed;
    }

    /// @notice Set the maximum acceptable age of a feed answer before it is
    ///         considered stale. Unichain feeds update on deviation (price
    ///         moves), so a fixed 1h cap can block trades for hours.
    function setMaxOracleAge(uint256 age) external onlyOwner {
        maxOracleAge = age;
    }

    /**
     * @notice Register a Chainlink USD feed for a token.
     * @param token     ERC-20 address
     * @param feed      Chainlink AggregatorV3 address
     * @param decimals_ Decimals of the feed answer (8 for most USD feeds)
     */
    function setPriceFeed(address token, address feed, uint8 decimals_) external onlyOwner {
        priceFeeds[token]    = feed;
        feedDecimals[token]  = decimals_ == 0 ? 8 : decimals_;
    }

    /// @notice Legacy 2-param overload – assumes 8-decimal USD feed.
    function setPriceFeed(address token, address feed) external onlyOwner {
        priceFeeds[token]   = feed;
        feedDecimals[token] = 8;
    }

    function setAnswerBounds(address token, int256 min, int256 max) external onlyOwner {
        minAnswers[token] = min;
        maxAnswers[token] = max;
    }

    // ─── Internal ─────────────────────────────────────────────────────────────

    /**
     * @dev Validates the L2 sequencer, checks staleness/bounds, and returns
     *      the feed price normalised to 18 decimals.  Returns 0 if no feed
     *      is registered (caller decides how to handle missing feeds).
     */
    function _getValidatedPrice(address token) internal view returns (uint256 price18) {
        // L2 sequencer uptime check (skipped if feed not configured yet)
        if (sequencerUptimeFeed != address(0)) {
            (, int256 seqAnswer, uint256 startedAt, , ) =
                ISequencerUptimeFeed(sequencerUptimeFeed).latestRoundData();
            // answer == 1 → sequencer is DOWN
            if (seqAnswer == 1) revert SequencerDown();
            if (block.timestamp - startedAt < GRACE_PERIOD_TIME) revert GracePeriodNotMet();
        }

        address feed = priceFeeds[token];
        if (feed == address(0)) return 0; // feed not registered → caller skips

        (, int256 price, , uint256 updatedAt, ) = AggregatorV3Interface(feed).latestRoundData();
        require(price > 0, "PriceFeed: non-positive price");

        if (block.timestamp > updatedAt && block.timestamp - updatedAt > maxOracleAge) {
            revert StalePrice();
        }

        if (minAnswers[token] > 0 && price <= minAnswers[token]) revert OraclePriceOutOfBounds();
        if (maxAnswers[token] > 0 && price >= maxAnswers[token]) revert OraclePriceOutOfBounds();

        // Normalise to 18 decimals
        uint8 dec = feedDecimals[token];
        if (dec == 0) dec = 8; // safe default
        price18 = dec <= 18
            ? uint256(price) * (10 ** (18 - dec))
            : uint256(price) / (10 ** (dec - 18));
    }

    // ─── External view ────────────────────────────────────────────────────────

    /**
     * @notice Returns the USD value of `amount` tokens (18-decimal result).
     * @dev Used by EswapMarginHook.isLiquidatable() and closePosition().
     */
    function getAmountInUsd(address token, uint256 amount) external view returns (uint256) {
        uint256 price18 = _getValidatedPrice(token);
        if (price18 == 0) return 0;
        return (amount * price18) / 1e18;
    }

    /**
     * @notice Returns the latest Chainlink oracle price normalised to 18 decimals.
     * @dev Used by EswapMarginHook as the "TWAP" for the V4-spot circuit-breaker.
     *      Chainlink is already a time-weighted / aggregated price, so no separate
     *      TWAP contract is needed for this purpose.
     */
    function getTwapPrice(address token) external view returns (uint256) {
        return _getValidatedPrice(token);
    }

    /// @notice Timestamp of the latest validated update for `token`, or 0 if
    ///         no feed is registered (caller may then skip staleness gating).
    function getTwapPriceUpdatedAt(address token) external view returns (uint256 updatedAt) {
        address feed = priceFeeds[token];
        if (feed == address(0)) return 0;
        (, , , updatedAt, ) = AggregatorV3Interface(feed).latestRoundData();
    }
}
