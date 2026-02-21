// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "../src/Positions.sol";
import "../src/Market.sol";
import "../src/LiquidityPoolFactory.sol";
import "../src/LiquidityPool.sol";
import "../src/PriceFeedL1.sol";
import {UniswapV3Helper} from "../src/UniswapV3Helper.sol";
import {FeeManager} from "../src/FeeManager.sol";
import {StrategyExecutor} from "../src/StrategyExecutor.sol";

import "forge-std/Script.sol";
import "./HelperConfig.sol";

contract Deployments is Script, HelperConfig {
    UniswapV3Helper public uniswapV3Helper;
    LiquidityPoolFactory public liquidityPoolFactory;
    PriceFeedL1 public priceFeedL1;
    Market public market;
    Positions public positions;
    FeeManager public feeManager;
    StrategyExecutor public strategyExecutor;
    LiquidityPool public lbPoolWBTC;
    LiquidityPool public lbPoolWETH;
    LiquidityPool public lbPoolUSDC;
    LiquidityPool public lbPoolDAI;

    address public alice;
    address public bob;
    address public carol;
    address public deployer;

    HelperConfig.NetworkConfig public conf;

    function run() public {
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
        strategyExecutor = new StrategyExecutor(address(uniswapV3Helper), address(market), msg.sender);

        /// configurations
        // add position address to the factory
        liquidityPoolFactory.addPositionsAddress(address(positions));

        // transfer ownership
        positions.transferOwnership(address(market));
        liquidityPoolFactory.transferOwnership(address(market));
        priceFeedL1.transferOwnership(address(market));

        // create liquidity pools
        address[] memory tokens = new address[](4);
        tokens[0] = conf.wbtc;
        tokens[1] = conf.weth;
        tokens[2] = conf.usdc;
        tokens[3] = conf.dai;
        address[] memory pools = market.createLiquidityPools(tokens);
        lbPoolWBTC = LiquidityPool(pools[0]);
        lbPoolWETH = LiquidityPool(pools[1]);
        lbPoolUSDC = LiquidityPool(pools[2]);
        lbPoolDAI = LiquidityPool(pools[3]);

        // trust pools in executor
        strategyExecutor.setPoolTrust(address(lbPoolWBTC), true);
        strategyExecutor.setPoolTrust(address(lbPoolWETH), true);
        strategyExecutor.setPoolTrust(address(lbPoolUSDC), true);
        strategyExecutor.setPoolTrust(address(lbPoolDAI), true);

        // add price feeds
        address[] memory priceFeeds = new address[](4);
        priceFeeds[0] = conf.priceFeedWbtcUsd;
        priceFeeds[1] = conf.priceFeedEthUsd;
        priceFeeds[2] = conf.priceFeedUsdcUsd;
        priceFeeds[3] = conf.priceFeedDaiUsd;
        market.addPriceFeeds(tokens, priceFeeds);

        vm.stopBroadcast();
    }
}
