// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {Positions} from "../../src/Positions.sol";
import {Market} from "../../src/Market.sol";
import {LiquidityPoolFactory} from "../../src/LiquidityPoolFactory.sol";
import {LiquidityPool} from "../../src/LiquidityPool.sol";
import {PriceFeedL1} from "../../src/PriceFeedL1.sol";
import {UniswapV3Helper} from "../../src/UniswapV3Helper.sol";
import {MockV3Aggregator} from "../mocks/MockV3Aggregator.sol";
import {MockUniswapV3Helper} from "../mocks/MockUniswapV3Helper.sol";
import {FeeManager} from "../../src/FeeManager.sol";

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

import {
    ERC20Mock
} from "@chainlink/contracts/src/v0.8/vendor/openzeppelin-solidity/v4.8.3/contracts/mocks/ERC20Mock.sol";

import "forge-std/Test.sol";
import {HelperConfig} from "../../scripts/HelperConfig.sol";
import {Utils} from "./Utils.sol";

contract TestSetupMock is Test, HelperConfig, Utils {
    // Target PNL values to be tested
    uint256 constant TARGET_PNL_1_USDC = 1e6;
    uint256 constant TARGET_PNL_10_USDC = 10e6;
    uint256 constant TARGET_PNL_50_USDC = 50e6;

    uint256 constant TARGET_PNL_0_01_WETH = 0.01e18;
    uint256 constant TARGET_PNL_0_1_WETH = 0.1e18;
    uint256 constant TARGET_PNL_0_5_WETH = 0.5e18;

    MockUniswapV3Helper public uniswapV3Helper;
    LiquidityPoolFactory public liquidityPoolFactory;
    PriceFeedL1 public priceFeedL1;
    Market public market;
    Positions public positions;
    FeeManager public feeManager;

    MockV3Aggregator public mockV3AggregatorWbtcUsd;
    MockV3Aggregator public mockV3AggregatorEthUsd;
    MockV3Aggregator public mockV3AggregatorUsdcUsd;

    ERC20Mock public mockWbtc;
    ERC20Mock public mockWeth;
    ERC20Mock public mockUsdc;
    ERC20Mock public mockDai;

    address public alice;
    address public bob;
    address public carol;
    address public deployer;

    HelperConfig.NetworkConfig public conf;

    mapping(string => address) public tokenBySymbol;

    mapping(string => address) public mockV3AggregatorBySymbol;

    function setUp() public virtual {
        conf = getActiveNetworkConfig();

        // create users
        deployer = address(0x01);
        alice = address(0x11);
        bob = address(0x21);
        carol = address(0x31);

        vm.startPrank(deployer);

        priceFeedL1 = new PriceFeedL1();
        liquidityPoolFactory = new LiquidityPoolFactory();
        feeManager = new FeeManager(5, 3); // 0.05% treasure fee, 0.03% liquidation reward (same as old constants)

        // contracts
        uniswapV3Helper = new MockUniswapV3Helper(address(priceFeedL1));

        positions = new Positions(
            address(priceFeedL1),
            address(liquidityPoolFactory),
            conf.liquidityPoolFactoryUniswapV3,
            address(uniswapV3Helper),
            conf.treasure,
            address(feeManager)
        );
        market = new Market(address(positions), address(liquidityPoolFactory), address(priceFeedL1), deployer);

        /// configurations
        // Set a longer staleness threshold for mock testing (365 days for time limit tests)
        // Must be done BEFORE transferring ownership
        priceFeedL1.setStalenessThreshold(365 days);

        // transfer ownership
        positions.transferOwnership(address(market));
        liquidityPoolFactory.transferOwnership(address(market));
        priceFeedL1.transferOwnership(address(market));

        // initialize tokens (create pools + add price feeds)
        uint256 numTokens = conf.supportedTokens.length;
        address[] memory tokens = new address[](numTokens);
        address[] memory priceFeeds = new address[](numTokens);

        for (uint256 i = 0; i < numTokens; i++) {
            tokens[i] = conf.supportedTokens[i].token;
            string memory symbol = IERC20Metadata(tokens[i]).symbol();

            priceFeeds[i] = address(new MockV3Aggregator(8, 1 * 1e8));

            // Populate mapping
            tokenBySymbol[symbol] = tokens[i];
            mockV3AggregatorBySymbol[symbol] = priceFeeds[i];
        }

        market.initializeTokens(tokens, priceFeeds);

        mockV3AggregatorEthUsd = MockV3Aggregator(mockV3AggregatorBySymbol["WETH"]);
        mockV3AggregatorWbtcUsd = MockV3Aggregator(mockV3AggregatorBySymbol["WBTC"]);
        mockV3AggregatorUsdcUsd = MockV3Aggregator(mockV3AggregatorBySymbol["USDC"]);

        vm.stopPrank();
    }

    function depositLiquidity(address token, uint256 amount) internal {
        vm.startPrank(bob);
        LiquidityPool liquidityPool = LiquidityPool(liquidityPoolFactory.getTokenToLiquidityPools(token));
        writeTokenBalance(bob, token, amount);
        IERC20(token).approve(address(liquidityPool), amount);
        liquidityPool.deposit(amount, bob);
        vm.stopPrank();
    }

    function getUsdcAddress() internal view returns (address) {
        return tokenBySymbol["USDC"];
    }

    function getWbtcAddress() internal view returns (address) {
        return tokenBySymbol["WBTC"];
    }

    function getWethAddress() internal view returns (address) {
        return tokenBySymbol["WETH"];
    }
}
