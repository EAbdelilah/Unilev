// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./utils/TestSetup.sol";

contract EdgeCaseTest is TestSetup {
    function setUp() public override {
        vm.selectFork(vm.createFork(vm.envString("POLYGON_RPC_URL")));
        super.setUp();
    }

    function test_ZeroCollateral_Long_Reverts() public {
        address token0 = conf.supportedTokens[0].token;
        address token1 = conf.supportedTokens[1].token;
        deal(token0, alice, 1000e6);
        vm.prank(alice);
        IERC20(token0).approve(address(market), 1000e6);
        vm.prank(alice);
        vm.expectRevert();
        market.openLongPosition(token0, token1, 3000, 2, 0, 0, 0);
    }

    function test_ZeroLeverage_Reverts() public {
        address token0 = conf.supportedTokens[0].token;
        address token1 = conf.supportedTokens[1].token;
        deal(token0, alice, 1000e6);
        vm.prank(alice);
        IERC20(token0).approve(address(market), 1000e6);
        vm.prank(alice);
        vm.expectRevert();
        market.openLongPosition(token0, token1, 3000, 0, 10e6, 0, 0);
    }

    function test_LeverageAboveMax_Reverts() public {
        address token0 = conf.supportedTokens[0].token;
        address token1 = conf.supportedTokens[1].token;
        deal(token0, alice, 1000e6);
        vm.prank(alice);
        IERC20(token0).approve(address(market), 1000e6);
        vm.prank(alice);
        vm.expectRevert();
        market.openLongPosition(token0, token1, 3000, 11, 10e6, 0, 0);
    }
}
