// SPDX-License-Identifier: MIT
pragma solidity =0.8.19;

import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@solmate/tokens/ERC20.sol";

// Errors
error PriceFeedL1__TOKEN_NOT_SUPPORTED(address token);

contract PriceFeedL1 is Ownable {
    mapping(address => AggregatorV3Interface) public tokenToPriceFeedETH;
    AggregatorV3Interface public ethToUsdPriceFeed;
    ERC20 public immutable weth;

    constructor(address _ethToUsdPriceFeed, address _weth) {
        ethToUsdPriceFeed = AggregatorV3Interface(_ethToUsdPriceFeed);
        weth = ERC20(_weth);
    }

    /**
     * @notice Add a token to the price feed.
     *         Only the owner can add a token
     *         The token must be supported by Chainlink
     *         The price feed must be XXX/USD one (e.g. ETH/USD)
     * @param _token token address
     * @param _priceFeed price feed address
     */
    function addPriceFeed(address _token, address _priceFeed) external onlyOwner {
        tokenToPriceFeedETH[_token] = AggregatorV3Interface(_priceFeed);
    }

    /**
     * @notice Returns the latest price of a token pair
     * @param _token0 token 0 address
     * @param _token1 token 1 address
     * @return int256 price of token 0 in terms of token 1
     */
    function getPairLatestPrice(address _token0, address _token1) public view returns (uint256) {
        return
            (getTokenLatestPriceInETH(_token0) * (10 ** uint256(ERC20(_token1).decimals()))) /
            getTokenLatestPriceInETH(_token1);
    }

    function getTokenLatestPriceInETH(address _token) public view returns (uint256) {
        if (address(tokenToPriceFeedETH[_token]) == address(0)) {
            revert PriceFeedL1__TOKEN_NOT_SUPPORTED(_token);
        }
        if (_token == address(weth)) {
            return 1e18;
        }

        // prettier-ignore
        (
            /* uint80 roundID */,
            int256 priceToken,
            /*uint startedAt*/,
            /*uint timeStamp*/,
            /*uint80 answeredInRound*/
        ) = tokenToPriceFeedETH[_token].latestRoundData();

        return uint256(priceToken);
    }

    function getTokenLatestPriceInUSD(address _token) public view returns (uint256) {
        if (address(tokenToPriceFeedETH[_token]) == address(0)) {
            revert PriceFeedL1__TOKEN_NOT_SUPPORTED(_token);
        }

        // prettier-ignore
        (
            /* uint80 roundID */,
            int256 priceEth,
            /*uint startedAt*/,
            /*uint timeStamp*/,
            /*uint80 answeredInRound*/
        ) = ethToUsdPriceFeed.latestRoundData();

        return ((getTokenLatestPriceInETH(_token) * uint256(priceEth)) / 1e18);
    }

    function isPairSupported(address _token0, address _token1) public view returns (bool) {
        if (address(tokenToPriceFeedETH[_token0]) == address(0)) {
            return false;
        }
        if (address(tokenToPriceFeedETH[_token1]) == address(0)) {
            return false;
        }
        return true;
    }

    function getBlockTimestamp() public view returns (uint256) {
        return block.timestamp;
    }
}
