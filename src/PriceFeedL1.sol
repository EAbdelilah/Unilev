// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@solmate/tokens/ERC20.sol";

// Errors
error PriceFeedL1__TOKEN_NOT_SUPPORTED(address token);
error PriceFeedL1__STALE_PRICE_DATA(uint256 updatedAt, uint256 maxPriceAge);
error PriceFeedL1__PRICE_FEEDS_MISMATCH(address token);
error PriceFeedL1__NO_VALID_PRICE_FEEDS_FOUND();
error PriceFeedL1__INVALID_PRICE(int256 price);

contract PriceFeedL1 is Ownable {
    // --- START OF ABI-MODIFYING CHANGES ---
    // To support multi-oracle security, the mapping now points to an array of price feeds.
    // This changes the return type of the public getter function for this variable.
    mapping(address => AggregatorV3Interface[]) public tokenToPriceFeedsETH;

    // This is now an array to support multiple ETH/USD price feeds for better security.
    AggregatorV3Interface[] public ethToUsdPriceFeeds;
    // --- END OF ABI-MODIFYING CHANGES ---

    ERC20 public immutable weth;

    // --- NEW SECURITY CONSTANTS ---
    uint256 public constant MAX_PRICE_AGE = 1 hours; // Maximum age for price data
    uint256 public constant PRICE_DEVIATION_THRESHOLD = 100; // 1% max deviation (100 = 1%)

    /**
     * @notice The constructor now initializes with the first ETH/USD price feed.
     * @dev The Owner should add more feeds using `addEthToUsdPriceFeed` for redundancy.
     */
    constructor(address _ethToUsdPriceFeed, address _weth) {
        require(_ethToUsdPriceFeed != address(0), "Invalid ETH/USD price feed");
        require(_weth != address(0), "Invalid WETH address");
        ethToUsdPriceFeeds.push(AggregatorV3Interface(_ethToUsdPriceFeed));
        weth = ERC20(_weth);
    }

    /**
     * @notice Add a token price feed. Can be called multiple times for the same token to add redundant oracles.
     * @dev This function keeps the original name but now appends feeds to a list.
     * @param _token token address
     * @param _priceFeed price feed address to add
     */
    function addPriceFeed(address _token, address _priceFeed) external onlyOwner {
        require(_priceFeed != address(0), "Invalid price feed address");
        tokenToPriceFeedsETH[_token].push(AggregatorV3Interface(_priceFeed));
    }

    /**
     * @notice Adds an additional ETH/USD price feed for security.
     * @dev This is a new function required to support the multi-oracle model for the base currency.
     * @param _priceFeed The ETH/USD price feed address to add
     */
    function addEthToUsdPriceFeed(address _priceFeed) external onlyOwner {
        require(_priceFeed != address(0), "Invalid price feed address");
        ethToUsdPriceFeeds.push(AggregatorV3Interface(_priceFeed));
    }

    /**
     * @notice Returns the latest price of a token pair, aggregated from multiple oracles.
     * @param _token0 token 0 address
     * @param _token1 token 1 address
     * @return uint256 price of token 0 in terms of token 1
     */
    function getPairLatestPrice(address _token0, address _token1) public view returns (uint256) {
        uint256 price0 = getTokenLatestPriceInETH(_token0);
        uint256 price1 = getTokenLatestPriceInETH(_token1);
        return (price0 * (10 ** uint256(ERC20(_token1).decimals()))) / price1;
    }

    /**
     * @notice Returns the latest ETH price of a token, aggregated from available oracles.
     * @dev Includes stale price and price deviation checks.
     * @param _token The token address
     * @return uint256 The aggregated price in ETH (1e18)
     */
    function getTokenLatestPriceInETH(address _token) public view returns (uint256) {
        if (_token == address(weth)) {
            return 1e18; // WETH is always 1-to-1 with ETH
        }

        AggregatorV3Interface[] memory priceFeeds = tokenToPriceFeedsETH[_token];
        if (priceFeeds.length == 0) {
            revert PriceFeedL1__TOKEN_NOT_SUPPORTED(_token);
        }

        return _getAggregatedPrice(priceFeeds, _token);
    }

    /**
     * @notice Returns the latest USD price of a token, aggregated from available oracles.
     * @dev Includes stale price and price deviation checks on both the token and ETH price feeds.
     * @param _token The token address
     * @return uint256 The aggregated price in USD
     */
    function getTokenLatestPriceInUSD(address _token) public view returns (uint256) {
        uint256 tokenPriceInEth = getTokenLatestPriceInETH(_token);
        uint256 ethPriceInUsd = _getAggregatedPrice(ethToUsdPriceFeeds, address(weth)); // Using WETH address as a placeholder for ETH

        return (tokenPriceInEth * ethPriceInUsd) / 1e18;
    }

    /**
     * @notice Checks if a pair has at least one price feed for each token.
     * @param _token0 token 0 address
     * @param _token1 token 1 address
     * @return bool True if both tokens are supported
     */
    function isPairSupported(address _token0, address _token1) public view returns (bool) {
        bool isToken0Supported = tokenToPriceFeedsETH[_token0].length > 0 || _token0 == address(weth);
        bool isToken1Supported = tokenToPriceFeedsETH[_token1].length > 0 || _token1 == address(weth);
        return isToken0Supported && isToken1Supported;
    }

    /**
     * @dev Internal function to aggregate prices from a list of oracles.
     *      Includes stale price and price deviation checks.
     */
    function _getAggregatedPrice(AggregatorV3Interface[] memory priceFeeds, address _tokenForError)
        internal
        view
        returns (uint256)
    {
        uint256 totalPrice;
        uint256 validPricesCount;
        int256[] memory validPrices = new int256[](priceFeeds.length);

        for (uint256 i = 0; i < priceFeeds.length; i++) {
            (
                /*uint80 roundId*/,
                int256 price,
                /*uint256 startedAt*/,
                uint256 updatedAt,
                /*uint80 answeredInRound*/
            ) = priceFeeds[i].latestRoundData();

            if (block.timestamp - updatedAt > MAX_PRICE_AGE) {
                // Instead of reverting immediately, we can choose to ignore this price feed
                // and continue with other, more recent ones. This makes the system more
                // resilient to a single oracle failing to update.
                // However, for maximum security, reverting is often the safest choice.
                // We will stick to the original logic of reverting on stale data.
                revert PriceFeedL1__STALE_PRICE_DATA(updatedAt, MAX_PRICE_AGE);
            }

            if (price <= 0) {
                // A price of zero or less is invalid and should be rejected.
                revert PriceFeedL1__INVALID_PRICE(price);
            }
            
            validPrices[validPricesCount] = price;
            totalPrice += uint256(price);
            validPricesCount++;
        }

        if (validPricesCount == 0) {
            revert PriceFeedL1__NO_VALID_PRICE_FEEDS_FOUND();
        }

        uint256 averagePrice = totalPrice / validPricesCount;

        // Check for price deviation only if more than one oracle provided a valid price
        if (validPricesCount > 1) {
            for (uint256 i = 0; i < validPricesCount; i++) {
                uint256 deviation = validPrices[i] > int256(averagePrice)
                    ? (uint256(validPrices[i]) - averagePrice) * 10000 / averagePrice
                    : (averagePrice - uint256(validPrices[i])) * 10000 / averagePrice;
                if (deviation > PRICE_DEVIATION_THRESHOLD) {
                    revert PriceFeedL1__PRICE_FEEDS_MISMATCH(_tokenForError);
                }
            }
        }

        return averagePrice;
    }
}