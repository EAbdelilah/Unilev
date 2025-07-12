// SPDX-License-Identifier: MIT
pragma solidity =0.8.19;

import "../Positions.sol";
import "../Market.sol";
import "../LiquidityPoolFactory.sol";
import "../LiquidityPool.sol";
import "../PriceFeedL1.sol";
import "@solmate/tokens/ERC20.sol";
import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

import "@uniswapCore/contracts/UniswapV3Pool.sol";
import {SwapRouter} from "@uniswapPeriphery/contracts/SwapRouter.sol";

import "forge-std/Test.sol";
import "../test/utils/HelperConfig.sol";
import "../test/mocks/MockV3Aggregator.sol";
import {Utils} from "../test/utils/Utils.sol";

contract Deployments is Test, HelperConfig, Utils {
    UniswapV3Helper public uniswapV3Helper;
    LiquidityPoolFactory public liquidityPoolFactory;
    PriceFeedL1 public priceFeedL1;
    Market public market;
    Positions public positions;
    MockV3Aggregator public mockV3AggregatorWBTCETH;
    MockV3Aggregator public mockV3AggregatorUSDCETH;
    MockV3Aggregator public mockV3AggregatorETHUSD;
    LiquidityPool public lbPoolWBTC;
    LiquidityPool public lbPoolWETH;
    LiquidityPool public lbPoolUSDC;
    SwapRouter public swapRouter;
    address public alice;
    address public bob;
    address public carol;
    address public deployer;

    HelperConfig.NetworkConfig public conf;

    function setUp() public {}

    function run() public {
        vm.startBroadcast();

        conf = getActiveNetworkConfig();

        // mainnet context
        swapRouter = SwapRouter(payable(conf.swapRouter));

        /// deployments
        // mocks
        mockV3AggregatorWBTCETH = new MockV3Aggregator(18, 14 ether); // 1 WBTC = 14 ETH
        mockV3AggregatorUSDCETH = new MockV3Aggregator(18, 1e15); // 1 USDC = 0,0001 ETH
        mockV3AggregatorETHUSD = new MockV3Aggregator(8, 1000e8); // 1 ETH = 1000 USD

        // contracts
        uniswapV3Helper = new UniswapV3Helper(conf.nonfungiblePositionManager, conf.swapRouter);
        priceFeedL1 = new PriceFeedL1(address(mockV3AggregatorETHUSD), conf.addWETH);
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
        market.addPriceFeed(conf.addWBTC, address(mockV3AggregatorWBTCETH));
        market.addPriceFeed(conf.addUSDC, address(mockV3AggregatorUSDCETH));

        // // add liquidity to a pool to be able to open a short position
        // writeTokenBalance(msg.sender, conf.addWBTC, 100e8);
        // writeTokenBalance(msg.sender, conf.addWETH, 1000e18);
        // writeTokenBalance(msg.sender, conf.addUSDC, 100000000e6);

        // ERC20(conf.addWBTC).approve(address(lbPoolWBTC), 10e8);
        // ERC20(conf.addWETH).approve(address(lbPoolWETH), 100e18);
        // ERC20(conf.addUSDC).approve(address(lbPoolUSDC), 10000000e6);

        // lbPoolWBTC.deposit(10e8, msg.sender);
        // lbPoolWETH.deposit(100e18, msg.sender);
        // lbPoolUSDC.deposit(10000000e6, msg.sender);

        vm.stopBroadcast();
    }
}
