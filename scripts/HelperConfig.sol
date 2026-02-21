// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.7;

contract HelperConfig {
    NetworkConfig public activeNetworkConfig;

    struct NetworkConfig {
        address priceFeedEthUsd;
        address priceFeedWbtcUsd;
        address priceFeedUsdcUsd;
        address priceFeedDaiUsd;
        address nonfungiblePositionManager;
        address swapRouter;
        address liquidityPoolFactoryUniswapV3;
        address wbtc;
        address weth;
        address usdc;
        address dai;
        address treasure;
        address quoter;
    }

    mapping(uint256 => NetworkConfig) public chainIdToNetworkConfig;

    constructor() {
        chainIdToNetworkConfig[1] = getMainnetEthereumConfig();
        chainIdToNetworkConfig[137] = getMainnetPolygonConfig();
        activeNetworkConfig = chainIdToNetworkConfig[block.chainid];
    }

    function getActiveNetworkConfig() public view returns (NetworkConfig memory) {
        return activeNetworkConfig;
    }

    function getMainnetEthereumConfig()
        internal
        pure
        returns (NetworkConfig memory mainnetNetworkConfig)
    {
        mainnetNetworkConfig = NetworkConfig({
            // https://data.chain.link/feeds/ethereum/mainnet/eth-usd
            priceFeedEthUsd: 0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419, // ETH/USD Mainnet
            // https://data.chain.link/feeds/ethereum/mainnet/btc-usd
            priceFeedWbtcUsd: 0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c, // BTC/USD Mainnet
            // https://data.chain.link/feeds/ethereum/mainnet/usdc-usd
            priceFeedUsdcUsd: 0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6, // USDC/USD Mainnet
            // https://data.chain.link/feeds/ethereum/mainnet/dai-usd
            priceFeedDaiUsd: 0xAed0c38402a5d19df6E4c03F4E2DceD6e29c1ee9, // DAI/USD Mainnet
            nonfungiblePositionManager: 0xC36442b4a4522E871399CD717aBDD847Ab11FE88,
            swapRouter: 0xE592427A0AEce92De3Edee1F18E0157C05861564,
            liquidityPoolFactoryUniswapV3: 0x1F98431c8aD98523631AE4a59f267346ea31F984,
            wbtc: 0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599,
            weth: 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2,
            usdc: 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48,
            dai: 0x6B175474E89094C44Da98b954EedeAC495271d0F,
            treasure: 0x8626f6940E2eb28930eFb4CeF49B2d1F2C9C1199,
            quoter: 0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6
        });
    }

    function getMainnetPolygonConfig()
        internal
        pure
        returns (NetworkConfig memory mainnetNetworkConfig)
    {
        mainnetNetworkConfig = NetworkConfig({
            // https://data.chain.link/feeds/polygon/mainnet/eth-usd
            priceFeedEthUsd: 0xF9680D99D6C9589e2a93a78A04A279e509205945, // ETH/USD Polygon
            // https://data.chain.link/feeds/polygon/mainnet/wbtc-usd
            priceFeedWbtcUsd: 0xDE31F8bFBD8c84b5360CFACCa3539B938dd78ae6, // BTC/USD Polygon
            // https://data.chain.link/feeds/polygon/mainnet/usdc-usd
            priceFeedUsdcUsd: 0xfE4A8cc5b5B2366C1B58Bea3858e81843581b2F7, // USDC/USD Polygon
            // https://data.chain.link/feeds/polygon/mainnet/dai-usd
            priceFeedDaiUsd: 0x4746DeC9e833A82EC7C2C1356372CcF2cfcD2F3D, // DAI/USD Polygon
            nonfungiblePositionManager: 0xC36442b4a4522E871399CD717aBDD847Ab11FE88,
            swapRouter: 0xE592427A0AEce92De3Edee1F18E0157C05861564,
            liquidityPoolFactoryUniswapV3: 0x1F98431c8aD98523631AE4a59f267346ea31F984,
            wbtc: 0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6,
            weth: 0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619,
            usdc: 0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359,
            dai: 0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063,
            treasure: 0xBB6B5fD8AC1Fa2f4b20Dbd0d4b278b0E64ecA5DA,
            quoter: 0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6
        });
    }
}
