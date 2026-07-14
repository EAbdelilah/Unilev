// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "../src/Positions.sol";
import "../src/Market.sol";
import "../src/LiquidityPoolFactory.sol";
import "../src/LiquidityPool.sol";
import "../src/PriceFeedL1.sol";
import {UniswapV3Helper} from "../src/UniswapV3Helper.sol";
import {FeeManager} from "../src/FeeManager.sol";

import "forge-std/Script.sol";
import "./HelperConfig.sol";

contract Deployments is Script, HelperConfig {
    UniswapV3Helper public uniswapV3Helper;
    LiquidityPoolFactory public liquidityPoolFactory;
    PriceFeedL1 public priceFeedL1;
    Market public market;
    Positions public positions;
    FeeManager public feeManager;

    HelperConfig.NetworkConfig public conf;

    function run() public returns (address wrapperAddress) {
        conf = getActiveNetworkConfig();

        vm.startBroadcast();

        /// deployments
        // contracts
        uniswapV3Helper = new UniswapV3Helper(conf.swapRouter);
        priceFeedL1 = new PriceFeedL1();
        liquidityPoolFactory = new LiquidityPoolFactory();
        feeManager = new FeeManager(5, 3);
        positions = new Positions(
            address(priceFeedL1),
            address(liquidityPoolFactory),
            conf.liquidityPoolFactoryUniswapV3,
            address(uniswapV3Helper),
            conf.treasure,
            address(feeManager)
        );
        market = new Market(
            address(positions),
            address(liquidityPoolFactory),
            address(priceFeedL1),
            msg.sender
        );

        // configure TWAP circuit breakers (must be done BEFORE transferring ownership)
        priceFeedL1.setMaxDeviationBps(500); // 5% deviation threshold
        uint256 numTokens = conf.supportedTokens.length;
        address[] memory tokens = new address[](numTokens);
        address[] memory priceFeeds = new address[](numTokens);

        for (uint256 i = 0; i < numTokens; i++) {
            tokens[i] = conf.supportedTokens[i].token;
            priceFeeds[i] = conf.supportedTokens[i].priceFeed;
            
            HelperConfig.TokenInfo memory tInfo = conf.supportedTokens[i];
            if (tInfo.twapPool != address(0)) {
                priceFeedL1.setTwapConfig(
                    tInfo.token,
                    tInfo.twapPool,
                    tInfo.twapIntermediateToken,
                    tInfo.twapIntermediateIsUsd,
                    1800 // 30-minute TWAP window
                );
            }
        }

        // transfer ownership
        positions.transferOwnership(address(market));
        liquidityPoolFactory.transferOwnership(address(market));
        priceFeedL1.transferOwnership(address(market));

        // initialize tokens (create pools + add price feeds)
        market.initializeTokens(tokens, priceFeeds);

        vm.stopBroadcast();

        wrapperAddress = conf.wrapper.token;
    }
}
