// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {AggregatorV3Interface} from "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {IUniswapV3Pool} from "./interfaces/IUniswapV3.sol";
import {TwapLibrary} from "./libraries/TwapLibrary.sol";

interface IAggregatorMinMax {
    function minAnswer() external view returns (int192);
    function maxAnswer() external view returns (int192);
    function aggregator() external view returns (address);
}

// Errors
error PriceFeedL1__TOKEN_NOT_SUPPORTED(address token);
error PriceFeedL1__STALE_PRICE(address token);
error PriceFeedL1__PRICE_TOO_OLD(address token, uint256 age);
error PriceFeedL1__INVALID_PRICE(address token, int256 price);
error PriceFeedL1__ANSWER_IN_ROUND_INVALID(address token);
// [FIX INFO-1] New errors for zero-address feed and sequencer checks
error PriceFeedL1__INVALID_PRICE_FEED(address feed);
error PriceFeedL1__SEQUENCER_DOWN();
error PriceFeedL1__SEQUENCER_GRACE_PERIOD_NOT_OVER(uint256 secondsSinceUp, uint256 gracePeriod);
// [TWAP] TWAP deviation circuit breaker
error PriceFeedL1__TWAP_DEVIATION_TOO_HIGH(
    address token, uint256 chainlinkPrice, uint256 twapPrice, uint256 deviationBps
);

contract PriceFeedL1 is Ownable {
    // ─── Chainlink ─────────────────────────────────────────────────────────────
    mapping(address => AggregatorV3Interface) public tokenToPriceFeedUsd;

    uint256 public stalenessThreshold = 1 hours;

    // [FIX LOW-4] Optional Chainlink L2 Sequencer Uptime Feed.
    AggregatorV3Interface public sequencerUptimeFeed;

    // [FIX LOW-4] Grace period after sequencer restart
    uint256 public constant GRACE_PERIOD = 1 hours;

    // ─── Uniswap V3 TWAP ───────────────────────────────────────────────────────

    /// @notice Configuration for a Uniswap V3 TWAP source for a given token.
    struct TwapConfig {
        /// The Uniswap V3 pool to observe (e.g. WBTC/WETH 0.3% pool on Polygon).
        address pool;
        /// The address of the intermediate base token (e.g. WETH).
        /// If set to address(0), the pool directly gives the USD price (e.g. TOKEN/USDC pool).
        address intermediateToken;
        /// Whether to query the Chainlink feed for the intermediate token too.
        bool intermediateIsUsd; // true = pool quotes against a USD stablecoin (USDC/DAI)
        /// TWAP window in seconds. Default 1800 = 30 minutes.
        uint32 twapWindow;
    }

    mapping(address => TwapConfig) public tokenToTwapConfig;

    /// @notice Maximum allowed deviation between Chainlink and TWAP (in basis points, 1% = 100 bps).
    ///         If the prices differ by more than this, the transaction reverts.
    ///         Set to 0 to disable TWAP check for all tokens (not recommended).
    uint256 public maxDeviationBps = 500; // 5% default

    /// @notice Default TWAP window used when registering a new config without specifying one.
    uint32 public constant DEFAULT_TWAP_WINDOW = 1800; // 30 minutes

    // ─── Events ────────────────────────────────────────────────────────────────
    event SequencerFeedUpdated(address indexed oldFeed, address indexed newFeed);
    event StalenessThresholdUpdated(uint256 oldThreshold, uint256 newThreshold);
    event TwapConfigSet(address indexed token, address indexed pool, address intermediateToken, uint32 twapWindow);
    event TwapConfigRemoved(address indexed token);
    event MaxDeviationBpsUpdated(uint256 oldBps, uint256 newBps);

    constructor() Ownable(msg.sender) {}

    // ─── Owner configuration ───────────────────────────────────────────────────

    /**
     * @notice Set the Chainlink L2 Sequencer Uptime feed address.
     * @dev Set to address(0) to disable the check (default, for L1 deployments).
     */
    function setSequencerFeed(address _feed) external onlyOwner {
        address old = address(sequencerUptimeFeed);
        sequencerUptimeFeed = AggregatorV3Interface(_feed);
        emit SequencerFeedUpdated(old, _feed);
    }

    /**
     * @notice Set the staleness threshold for price feeds (owner only).
     */
    function setStalenessThreshold(uint256 _newThreshold) external onlyOwner {
        uint256 old = stalenessThreshold;
        stalenessThreshold = _newThreshold;
        emit StalenessThresholdUpdated(old, _newThreshold);
    }

    /**
     * @notice Set the maximum allowed Chainlink-vs-TWAP deviation in basis points.
     * @param _bps  New threshold. Use 0 to disable all TWAP checks (not recommended).
     */
    function setMaxDeviationBps(uint256 _bps) external onlyOwner {
        require(_bps <= 5000, "deviation cap: max 50%");
        uint256 old = maxDeviationBps;
        maxDeviationBps = _bps;
        emit MaxDeviationBpsUpdated(old, _bps);
    }

    /**
     * @notice Register or update a Uniswap V3 TWAP source for a token.
     * @param _token           Token whose price we want to validate (e.g. WBTC).
     * @param _pool            Address of the Uniswap V3 pool to observe.
     * @param _intermediateToken  If the pool quotes in WETH, provide the WETH address so we
     *                            can convert WETH -> USD via its Chainlink feed.
     *                            If the pool quotes directly in a USD stablecoin, set this
     *                            to address(0) and set _intermediateIsUsd = true.
     * @param _intermediateIsUsd  True when the pool's quote token is a USD stablecoin.
     * @param _twapWindow      TWAP window in seconds (recommended: 1800 = 30 min).
     */
    function setTwapConfig(
        address _token,
        address _pool,
        address _intermediateToken,
        bool _intermediateIsUsd,
        uint32 _twapWindow
    ) external onlyOwner {
        require(_pool != address(0), "TWAP: zero pool");
        require(_twapWindow >= 60, "TWAP: window < 60s");
        tokenToTwapConfig[_token] = TwapConfig({
            pool: _pool,
            intermediateToken: _intermediateToken,
            intermediateIsUsd: _intermediateIsUsd,
            twapWindow: _twapWindow
        });
        emit TwapConfigSet(_token, _pool, _intermediateToken, _twapWindow);
    }

    /**
     * @notice Remove the TWAP config for a token (disables TWAP check for that token).
     */
    function removeTwapConfig(address _token) external onlyOwner {
        delete tokenToTwapConfig[_token];
        emit TwapConfigRemoved(_token);
    }

    /**
     * @notice Add a Chainlink price feed for a token.
     */
    function addPriceFeed(address _token, address _priceFeed) external onlyOwner {
        // [FIX INFO-1] Prevent zero-address feed
        if (_priceFeed == address(0)) revert PriceFeedL1__INVALID_PRICE_FEED(_priceFeed);
        tokenToPriceFeedUsd[_token] = AggregatorV3Interface(_priceFeed);
    }

    // ─── Public price queries ──────────────────────────────────────────────────

    /**
     * @notice Returns the latest price of a token pair.
     */
    function getPairLatestPrice(address _token0, address _token1) public view returns (uint256) {
        return (getTokenLatestPriceInUsd(_token0) * (10 ** uint256(IERC20Metadata(_token1).decimals())))
            / getTokenLatestPriceInUsd(_token1);
    }

    /**
     * @notice Returns the latest price of a token in USD, normalized to 18 decimals.
     *         Performs:
     *           1. L2 sequencer uptime check
     *           2. Chainlink staleness / validity checks
     *           3. Chainlink min/max circuit breaker
     *           4. Uniswap V3 TWAP deviation check (if config registered for token)
     * @param _token The token address.
     * @return uint256 The price in USD with 18 decimals.
     */
    function getTokenLatestPriceInUsd(address _token) public view returns (uint256) {
        // 1. Check sequencer uptime
        _checkSequencerUptime();

        // 2. Resolve Chainlink feed
        AggregatorV3Interface priceFeed = tokenToPriceFeedUsd[_token];
        if (address(priceFeed) == address(0)) {
            revert PriceFeedL1__TOKEN_NOT_SUPPORTED(_token);
        }
        (uint80 roundId, int256 price,, uint256 updatedAt, uint80 answeredInRound) = priceFeed.latestRoundData();

        if (price <= 0) {
            revert PriceFeedL1__INVALID_PRICE(_token, price);
        }

        // 3. Chainlink min/max circuit breaker
        address aggregatorAddress;
        try IAggregatorMinMax(address(priceFeed)).aggregator() returns (address agg) {
            aggregatorAddress = agg;
        } catch {
            aggregatorAddress = address(priceFeed);
        }

        try IAggregatorMinMax(aggregatorAddress).minAnswer() returns (int192 min) {
            if (price <= int256(min)) revert PriceFeedL1__INVALID_PRICE(_token, price);
        } catch {}

        try IAggregatorMinMax(aggregatorAddress).maxAnswer() returns (int192 max) {
            if (price >= int256(max)) revert PriceFeedL1__INVALID_PRICE(_token, price);
        } catch {}

        if (updatedAt == 0) {
            revert PriceFeedL1__STALE_PRICE(_token);
        }
        if (answeredInRound < roundId) {
            revert PriceFeedL1__ANSWER_IN_ROUND_INVALID(_token);
        }

        uint256 priceAge = block.timestamp - updatedAt;
        if (priceAge > stalenessThreshold) {
            revert PriceFeedL1__PRICE_TOO_OLD(_token, priceAge);
        }

        uint8 decimals = priceFeed.decimals();
        uint256 chainlinkPrice =
            decimals <= 18 ? uint256(price) * 10 ** (18 - decimals) : uint256(price) / 10 ** (decimals - 18);

        // 4. Uniswap V3 TWAP deviation check
        _checkTwapDeviation(_token, chainlinkPrice);

        return chainlinkPrice;
    }

    /**
     * @notice Returns the USD value of a given token amount, normalized to 18 decimals.
     */
    function getAmountInUsd(address _token, uint256 _amount) public view returns (uint256) {
        uint256 priceInUsd = getTokenLatestPriceInUsd(_token);
        uint8 tokenDecimals = IERC20Metadata(_token).decimals();
        return (_amount * priceInUsd) / (10 ** tokenDecimals);
    }

    /**
     * @notice Returns true if both tokens have Chainlink USD feeds registered.
     */
    function isPairSupported(address _token0, address _token1) public view returns (bool) {
        return
            address(tokenToPriceFeedUsd[_token0]) != address(0) && address(tokenToPriceFeedUsd[_token1]) != address(0);
    }

    /**
     * @notice Read the TWAP price for a token without the deviation check.
     *         Useful for off-chain monitoring and dashboards.
     * @param _token The token to query.
     * @return twapPrice18 The TWAP price in USD with 18 decimals, or 0 if no config is set.
     */
    function getTwapPrice(address _token) external view returns (uint256 twapPrice18) {
        TwapConfig memory cfg = tokenToTwapConfig[_token];
        if (cfg.pool == address(0)) return 0;
        twapPrice18 = _computeTwapUsd(_token, cfg);
    }

    // ─── Internal helpers ──────────────────────────────────────────────────────

    /**
     * @dev [FIX LOW-4] Validate the Chainlink L2 sequencer uptime feed.
     */
    function _checkSequencerUptime() internal view {
        AggregatorV3Interface feed = sequencerUptimeFeed;
        if (address(feed) == address(0)) return;

        (, int256 answer, uint256 startedAt,,) = feed.latestRoundData();

        if (answer != 0) {
            revert PriceFeedL1__SEQUENCER_DOWN();
        }

        uint256 secondsSinceUp = block.timestamp - startedAt;
        if (secondsSinceUp < GRACE_PERIOD) {
            revert PriceFeedL1__SEQUENCER_GRACE_PERIOD_NOT_OVER(secondsSinceUp, GRACE_PERIOD);
        }
    }

    /**
     * @dev Compare the Chainlink price against the Uniswap V3 TWAP.
     *      Reverts if the deviation exceeds `maxDeviationBps`.
     *      If no TWAP config is registered for the token, this is a no-op.
     */
    function _checkTwapDeviation(address _token, uint256 chainlinkPrice) internal view {
        if (maxDeviationBps == 0) return;

        TwapConfig memory cfg = tokenToTwapConfig[_token];
        if (cfg.pool == address(0)) return; // TWAP not configured for this token — skip

        uint256 twapPrice = _computeTwapUsd(_token, cfg);
        if (twapPrice == 0) return; // TWAP not yet available (pool too new) — skip gracefully

        // Calculate absolute deviation in bps
        uint256 deviation;
        if (chainlinkPrice >= twapPrice) {
            deviation = ((chainlinkPrice - twapPrice) * 10_000) / twapPrice;
        } else {
            deviation = ((twapPrice - chainlinkPrice) * 10_000) / chainlinkPrice;
        }

        if (deviation > maxDeviationBps) {
            revert PriceFeedL1__TWAP_DEVIATION_TOO_HIGH(_token, chainlinkPrice, twapPrice, deviation);
        }
    }

    /**
     * @dev Compute the USD price of `_token` using its Uniswap V3 TWAP config.
     *
     *      Two modes:
     *      A) intermediateIsUsd = true:  pool is TOKEN/USDC (or similar stablecoin)
     *         → tickToPrice() gives USD price directly.
     *      B) intermediateIsUsd = false: pool is TOKEN/WETH
     *         → tickToPrice() gives WETH per TOKEN, then multiply by WETH/USD Chainlink price.
     *
     * @return price18 Price in USD with 18 decimals, or 0 if observation window not available.
     */
    function _computeTwapUsd(address _token, TwapConfig memory cfg) internal view returns (uint256 price18) {
        IUniswapV3Pool pool = IUniswapV3Pool(cfg.pool);

        // Determine token order in the pool
        address poolToken0 = pool.token0();
        address poolToken1 = pool.token1();
        bool isToken0 = (poolToken0 == _token);

        uint8 t0Dec = IERC20Metadata(poolToken0).decimals();
        uint8 t1Dec = IERC20Metadata(poolToken1).decimals();

        // Fetch cumulative ticks for [twapWindow seconds ago, now]
        uint32[] memory secondsAgos = new uint32[](2);
        secondsAgos[0] = cfg.twapWindow;
        secondsAgos[1] = 0;

        // Gracefully handle pools with insufficient observation history
        int56[] memory tickCumulatives;
        try pool.observe(secondsAgos) returns (int56[] memory tc, uint160[] memory) {
            tickCumulatives = tc;
        } catch {
            return 0; // Pool too young — caller skips deviation check
        }

        int56 tickCumulativeDelta = tickCumulatives[1] - tickCumulatives[0];
        int24 arithmeticMeanTick = int24(tickCumulativeDelta / int56(uint56(cfg.twapWindow)));
        // Round towards negative infinity for consistent rounding
        if (tickCumulativeDelta < 0 && (tickCumulativeDelta % int56(uint56(cfg.twapWindow)) != 0)) {
            arithmeticMeanTick--;
        }

        // price18 here = "pool's quote token per _token" with 18 decimal precision
        // isToken0Base = true if _token is token0 in the pool
        uint256 poolPrice18 = TwapLibrary.tickToPrice(arithmeticMeanTick, t0Dec, t1Dec, isToken0);

        if (cfg.intermediateIsUsd) {
            // Pool quotes directly in USD stablecoin (e.g. USDC with 6 decimals)
            // tickToPrice() already handles decimal normalization → result is in USD with 18 dp
            price18 = poolPrice18;
        } else {
            // Pool quotes in an intermediate volatile token (e.g. WETH)
            // poolPrice18 = WETH per TOKEN (18 dp)
            // We need WETH/USD price from Chainlink to finalize
            AggregatorV3Interface intermediateFeed = tokenToPriceFeedUsd[cfg.intermediateToken];
            if (address(intermediateFeed) == address(0)) return 0; // intermediate not registered

            (, int256 intermediatePrice,,,) = intermediateFeed.latestRoundData();
            if (intermediatePrice <= 0) return 0;

            uint8 intDecimals = intermediateFeed.decimals();
            uint256 intermediateUsd18 = intDecimals <= 18
                ? uint256(intermediatePrice) * 10 ** (18 - intDecimals)
                : uint256(intermediatePrice) / 10 ** (intDecimals - 18);

            // TOKEN/USD = (WETH per TOKEN) * (USD per WETH) / 1e18
            price18 = (poolPrice18 * intermediateUsd18) / 1e18;
        }
    }
}
