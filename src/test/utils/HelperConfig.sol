// SPDX-License-Identifier: UNLICENSED
pragma solidity =0.8.19;

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
        // chainIdToNetworkConfig[11155111] = getSepoliaEthConfig();
        chainIdToNetworkConfig[1] = getMainnetForkConfig();
        // chainIdToNetworkConfig[31337] = getAnvilConfig();

        activeNetworkConfig = chainIdToNetworkConfig[block.chainid];
    }

    function getActiveNetworkConfig() public view returns (NetworkConfig memory) {
        return activeNetworkConfig;
    }

    // // georli in reality
    // function getSepoliaEthConfig()
    //     internal
    //     pure
    //     returns (NetworkConfig memory sepoliaNetworkConfig)
    // {
    //     sepoliaNetworkConfig = NetworkConfig({
    //         oracle: 0x6090149792dAAeE9D1D568c9f9a6F6B46AA29eFD,
    //         priceFeedETHUSD: 0x694AA1769357215DE4FAC081bf1f309aDC325306, // ETH / USD
    //         priceFeedBTCETH: 0x5fb1616F78dA7aFC9FF79e0371741a747D2a7F22,
    //         nonfungiblePositionManager: 0xC36442b4a4522E871399CD717aBDD847Ab11FE88,
    //         swapRouter: 0xE592427A0AEce92De3Edee1F18E0157C05861564,
    //         liquidityPoolFactoryUniswapV3: 0x1F98431c8aD98523631AE4a59f267346ea31F984,
    //         liquidationReward: 10
    //     });
    // }

    function getMainnetForkConfig()
        internal
        pure
        returns (NetworkConfig memory mainnetNetworkConfig)
    {
        mainnetNetworkConfig = NetworkConfig({
            oracle: address(0), // This is a mock
            priceFeedETHUSD: address(0), // This is a mock
            priceFeedBTCETH: address(0),
            priceFeedUSDCETH: address(0),
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
}
