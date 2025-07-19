// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.7;

contract HelperConfig {
    NetworkConfig public activeNetworkConfig;

    struct NetworkConfig {
        address oracle;
        address priceFeedETHUSD;
        address priceFeedBTCETH;
        address priceFeedUSDCETH;
        address priceFeedDAIETH;
        address nonfungiblePositionManager;
        address swapRouter;
        address liquidityPoolFactoryUniswapV3;
        uint256 liquidationReward;
        address addWBTC;
        address addWETH;
        address addUSDC;
        address addDAI;
    }

    mapping(uint256 => NetworkConfig) public chainIdToNetworkConfig;

    constructor() {
        chainIdToNetworkConfig[1] = getMainnetForkConfig();
        chainIdToNetworkConfig[137] = getPolygonMainnetConfig();
        activeNetworkConfig = chainIdToNetworkConfig[block.chainid];
    }

    function getActiveNetworkConfig() public view returns (NetworkConfig memory) {
        return activeNetworkConfig;
    }

    function getMainnetForkConfig()
        internal
        pure
        returns (NetworkConfig memory mainnetNetworkConfig)
    {
        mainnetNetworkConfig = NetworkConfig({
            oracle: address(0), // This is a mock
            priceFeedETHUSD: 0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419, // ETH/USD
            priceFeedBTCETH: 0xF4030086522a5BEEa4988F8cA5b36db827beE88C, // BTC/ETH (fixed checksum)
            priceFeedUSDCETH: 0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6, // USDC/ETH
            priceFeedDAIETH: address(0),
            nonfungiblePositionManager: 0xC36442b4a4522E871399CD717aBDD847Ab11FE88,
            swapRouter: 0xE592427A0AEce92De3Edee1F18E0157C05861564,
            liquidityPoolFactoryUniswapV3: 0x1F98431c8aD98523631AE4a59f267346ea31F984,
            liquidationReward: 10,
            addWBTC: 0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599,
            addWETH: 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2,
            addUSDC: 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48,
            addDAI: 0x6B175474E89094C44Da98b954EedeAC495271d0F
        });
    }

    function getPolygonMainnetConfig()
        internal
        pure
        returns (NetworkConfig memory polygonNetworkConfig)
    {
        polygonNetworkConfig = NetworkConfig({
            oracle: address(0), // Mock
            priceFeedETHUSD: 0xAB594600376Ec9fD91F8e885dADF0CE036862dE0, // MATIC/USD
            priceFeedBTCETH: 0x6135b13325bfC4B00278B4abC5e20bbce2D6580e, // BTC/ETH on Polygon
            priceFeedUSDCETH: 0x0BdA00F417509e267aaDf37f1D500059672a7C8f, // USDC/ETH (fixed checksum)
            priceFeedDAIETH: address(0),
            nonfungiblePositionManager: 0xC36442b4a4522E871399CD717aBDD847Ab11FE88,
            swapRouter: 0xE592427A0AEce92De3Edee1F18E0157C05861564,
            liquidityPoolFactoryUniswapV3: 0x1F98431c8aD98523631AE4a59f267346ea31F984,
            liquidationReward: 10,
            addWBTC: 0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6,
            addWETH: 0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619,
            addUSDC: 0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174,
            addDAI: 0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063 // Added proper DAI address
        });
    }
}
