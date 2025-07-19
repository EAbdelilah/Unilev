// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "../Positions.sol";
import "../Market.sol";
import "../LiquidityPoolFactory.sol";
import "../LiquidityPool.sol";
import "../PriceFeedL1.sol";
import "@solmate/tokens/ERC20.sol";
import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

import "@uniswapCore/contracts/UniswapV3Pool.sol";
import {SwapRouter} from "@uniswapPeriphery/contracts/SwapRouter.sol";

import "forge-std/Script.sol";
import "forge-std/console.sol"; // Added for logging
import "../test/utils/HelperConfig.sol";

contract Deployments is Script, HelperConfig {
    UniswapV3Helper public uniswapV3Helper;
    LiquidityPoolFactory public liquidityPoolFactory;
    PriceFeedL1 public priceFeedL1;
    Market public market;
    Positions public positions;
    LiquidityPool public lbPoolWBTC;
    LiquidityPool public lbPoolWETH;
    LiquidityPool public lbPoolUSDC;
    SwapRouter public swapRouter;
    address public alice;
    address public bob;
    address public carol;
    address public deployer;

    HelperConfig.NetworkConfig public conf;

    function run() public {
        conf = getActiveNetworkConfig(); // Assign conf first

        // Logging statements to debug configuration
        console.log("--- Debug Logs ---");
        
        console.log("Using priceFeedETHUSD (MATIC/USD on Polygon):", conf.priceFeedETHUSD);
        console.log("Using addWBTC:", conf.addWBTC);
        console.log("Using addWETH:", conf.addWETH);
        console.log("Using addUSDC:", conf.addUSDC);
        console.log("--- End Debug Logs ---");

        vm.startBroadcast();

        // mainnet context (swapRouter should be fine for Polygon too)
        swapRouter = SwapRouter(payable(conf.swapRouter));

        /// deployments
        // contracts
        uniswapV3Helper = new UniswapV3Helper(conf.nonfungiblePositionManager, conf.swapRouter);
        priceFeedL1 = new PriceFeedL1(conf.priceFeedETHUSD, conf.addWETH); // Uses MATIC/USD and WETH on Polygon
        liquidityPoolFactory = new LiquidityPoolFactory();
        positions = new Positions(
            address(priceFeedL1),
            address(liquidityPoolFactory),
            conf.liquidityPoolFactoryUniswapV3,
            conf.nonfungiblePositionManager,
            address(uniswapV3Helper),
            conf.liquidationReward
        );
        market = new Market(
            address(positions),
            address(liquidityPoolFactory),
            address(priceFeedL1),
            msg.sender
        );

        /// configurations
        // add position addres to the factory
        liquidityPoolFactory.addPositionsAddress(address(positions));

        // transfer ownership
        positions.transferOwnership(address(market));
        liquidityPoolFactory.transferOwnership(address(market));
        priceFeedL1.transferOwnership(address(market));

        // create liquidity pools
        lbPoolWBTC = LiquidityPool(market.createLiquidityPool(conf.addWBTC));
        lbPoolWETH = LiquidityPool(market.createLiquidityPool(conf.addWETH));
        lbPoolUSDC = LiquidityPool(market.createLiquidityPool(conf.addUSDC));

        // add price feeds
        market.addPriceFeed(conf.addWBTC, conf.priceFeedBTCETH);
        market.addPriceFeed(conf.addUSDC, conf.priceFeedUSDCETH);

        vm.stopBroadcast();
    }
}
