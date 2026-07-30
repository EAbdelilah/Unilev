// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "forge-std/Test.sol";
import "./mocks/MockV3Aggregator.sol";
import {PriceFeedL1} from "../src/PriceFeedL1.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract TestToken18 is ERC20("Test18", "TST18") {
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

contract TestToken6 is ERC20("Test6", "TST6") {
    uint8 private _decimals = 6;
    function decimals() public view override returns (uint8) { return _decimals; }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

contract PriceFeedL1Test is Test {
    PriceFeedL1 public priceFeed;
    MockV3Aggregator public mockFeed;

    TestToken18 public token18;
    TestToken6 public token6;

    function setUp() public {
        token18 = new TestToken18();
        token6 = new TestToken6();

        priceFeed = new PriceFeedL1();
        mockFeed = new MockV3Aggregator(8, 1000e8);
        priceFeed.addPriceFeed(address(token18), address(mockFeed));
        priceFeed.setStalenessThreshold(1 hours);
    }

    function test_StalePrice_Reverts() public {
        vm.warp(7 days);
        mockFeed.updateRoundData(2, 1000e8, block.timestamp - 2 hours, block.timestamp - 2 hours);
        vm.expectRevert(
            abi.encodeWithSignature("PriceFeedL1__PRICE_TOO_OLD(address,uint256)", address(token18), 2 hours)
        );
        priceFeed.getTokenLatestPriceInUsd(address(token18));
    }

    function test_StalenessThreshold_Updated() public {
        vm.warp(7 days);
        priceFeed.setStalenessThreshold(2 hours);
        mockFeed.updateRoundData(2, 1000e8, block.timestamp - 90 minutes, block.timestamp - 90 minutes);
        priceFeed.getTokenLatestPriceInUsd(address(token18));
    }

    function test_InvalidPrice_Zero_Reverts() public {
        mockFeed.updateAnswer(0);
        vm.expectRevert(
            abi.encodeWithSignature("PriceFeedL1__INVALID_PRICE(address,int256)", address(token18), 0)
        );
        priceFeed.getTokenLatestPriceInUsd(address(token18));
    }

    function test_InvalidPrice_Negative_Reverts() public {
        mockFeed.updateAnswer(-100);
        vm.expectRevert(
            abi.encodeWithSignature("PriceFeedL1__INVALID_PRICE(address,int256)", address(token18), -100)
        );
        priceFeed.getTokenLatestPriceInUsd(address(token18));
    }

    function test_UnsupportedToken_Reverts() public {
        vm.expectRevert(
            abi.encodeWithSignature("PriceFeedL1__TOKEN_NOT_SUPPORTED(address)", address(0xDEAD))
        );
        priceFeed.getTokenLatestPriceInUsd(address(0xDEAD));
    }

    function test_ZeroAddressFeed_Reverts() public {
        vm.expectRevert(
            abi.encodeWithSignature("PriceFeedL1__INVALID_PRICE_FEED(address)", address(0))
        );
        priceFeed.addPriceFeed(address(token18), address(0));
    }

    function test_DuplicatePriceFeed_Overwrites() public {
        MockV3Aggregator newFeed = new MockV3Aggregator(8, 2000e8);
        priceFeed.addPriceFeed(address(token18), address(newFeed));
        uint256 price = priceFeed.getTokenLatestPriceInUsd(address(token18));
        assertEq(price, 2000e18);
    }



    function test_OnlyOwnerCanSetStaleness() public {
        vm.prank(address(0xBAD));
        vm.expectRevert();
        priceFeed.setStalenessThreshold(2 hours);
    }

    function test_OnlyOwnerCanAddPriceFeed() public {
        vm.prank(address(0xBAD));
        vm.expectRevert();
        priceFeed.addPriceFeed(address(token18), address(0xDEAD));
    }

    function test_GetAmountInUsd_18Decimals() public {
        mockFeed.updateAnswer(1000e8);
        uint256 usdValue = priceFeed.getAmountInUsd(address(token18), 1e18);
        assertEq(usdValue, 1000e18);
    }

    function test_GetAmountInUsd_6Decimals() public {
        priceFeed.addPriceFeed(address(token6), address(mockFeed));
        mockFeed.updateAnswer(1000e8);
        uint256 usdValue = priceFeed.getAmountInUsd(address(token6), 1e6);
        assertEq(usdValue, 1000e18);
    }
}
