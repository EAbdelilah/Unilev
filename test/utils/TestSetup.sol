// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {Positions} from "../../src/Positions.sol";
import {Market} from "../../src/Market.sol";
import {LiquidityPoolFactory} from "../../src/LiquidityPoolFactory.sol";
import {LiquidityPool} from "../../src/LiquidityPool.sol";
import {PriceFeedL1} from "../../src/PriceFeedL1.sol";
import {UniswapV3Helper} from "../../src/UniswapV3Helper.sol";
import {MockV3Aggregator} from "../mocks/MockV3Aggregator.sol";
import {FeeManager} from "../../src/FeeManager.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

import "forge-std/Test.sol";
import {HelperConfig} from "../../scripts/HelperConfig.sol";
import {Utils} from "./Utils.sol";

contract TestSetup is Test, HelperConfig, Utils {
    UniswapV3Helper public uniswapV3Helper;
    LiquidityPoolFactory public liquidityPoolFactory;
    PriceFeedL1 public priceFeedL1;
    Market public market;
    Positions public positions;
    FeeManager public feeManager;

    address public alice;
    address public bob;
    address public carol;
    address public deployer;

    HelperConfig.NetworkConfig public conf;

    mapping(string => address) public tokenBySymbol;

    function setUp() public virtual {
        conf = getActiveNetworkConfig();

        // create users
        deployer = address(0x01);
        alice = address(0x11);
        bob = address(0x21);
        carol = address(0x31);

        vm.startPrank(deployer);

        // contracts
        uniswapV3Helper = new UniswapV3Helper(conf.swapRouter);
        priceFeedL1 = new PriceFeedL1();
        liquidityPoolFactory = new LiquidityPoolFactory();
        feeManager = new FeeManager(5, 3); // 0.05% treasure fee, 0.03% liquidation reward
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
        // Set a longer staleness threshold for fork testing (7 days to account for mainnet fork age)
        // Must be done before transferring ownership
        priceFeedL1.setStalenessThreshold(7 days);

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
            priceFeeds[i] = conf.supportedTokens[i].priceFeed;

            // Populate mapping
            string memory symbol = IERC20Metadata(tokens[i]).symbol();
            tokenBySymbol[symbol] = tokens[i];
        }

        market.initializeTokens(tokens, priceFeeds);

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
}
