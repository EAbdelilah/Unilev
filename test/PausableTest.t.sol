// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./utils/TestSetup.sol";

contract PausableTest is TestSetup {
    function setUp() public override {
        vm.selectFork(vm.createFork(vm.envString("POLYGON_RPC_URL")));
        super.setUp();
    }

    function test_OnlyOwnerCanPause() public {
        vm.prank(alice);
        vm.expectRevert();
        market.pause();
    }

    function test_OnlyOwnerCanUnpause() public {
        vm.prank(deployer);
        market.pause();
        vm.prank(alice);
        vm.expectRevert();
        market.unpause();
    }

    function test_Pause_OpenPositionReverts() public {
        address token0 = conf.supportedTokens[0].token;
        address token1 = conf.supportedTokens[1].token;
        deal(token0, alice, 1000e6);
        vm.prank(alice);
        IERC20(token0).approve(address(positions), 1000e6);
        vm.prank(deployer);
        market.pause();
        vm.prank(alice);
        vm.expectRevert();
        market.openLongPosition(token0, token1, 3000, 2, 10e6, 0, 0);
    }

    function test_Pause_ClosePositionReverts() public {
        address token0 = conf.supportedTokens[0].token;
        address token1 = conf.supportedTokens[1].token;
        depositLiquidity(token1, 100_000e18);
        deal(token0, alice, 1000e6);
        vm.prank(alice);
        IERC20(token0).approve(address(positions), 1000e6);
        vm.prank(alice);
        market.openLongPosition(token0, token1, 3000, 2, 1e6, 0, 0);
        vm.prank(deployer);
        market.pause();
        vm.prank(alice);
        vm.expectRevert();
        market.closePosition(1);
    }

    function test_Pause_LiquidatePositionsReverts() public {
        vm.prank(deployer);
        market.pause();
        uint256[] memory ids = new uint256[](1);
        vm.expectRevert();
        market.liquidatePositions(ids);
    }

    function test_Unpause_ReactivatesOperations() public {
        address token0 = conf.supportedTokens[0].token;
        address token1 = conf.supportedTokens[1].token;
        depositLiquidity(token1, 100_000e18);
        deal(token0, alice, 1000e6);
        vm.prank(alice);
        IERC20(token0).approve(address(positions), 1000e6);
        vm.prank(deployer);
        market.pause();
        vm.prank(deployer);
        market.unpause();
        vm.prank(alice);
        market.openLongPosition(token0, token1, 3000, 2, 1e6, 0, 0);
    }

    function test_DoublePause_Idempotent() public {
        vm.prank(deployer);
        market.pause();
        vm.prank(deployer);
        market.pause();
    }

    function test_UnpauseWhenNotPaused_Idempotent() public {
        vm.prank(deployer);
        market.unpause();
    }

    function test_OwnershipTransfer_GrantsPauseRights() public {
        address newOwner = address(0xCAFE);
        vm.prank(deployer);
        market.transferOwnership(newOwner);
        vm.prank(newOwner);
        market.pause();
        assertTrue(market.paused());
    }

    function test_OwnershipTransfer_OldOwnerCannotPause() public {
        address newOwner = address(0xCAFE);
        vm.prank(deployer);
        market.transferOwnership(newOwner);
        vm.prank(deployer);
        vm.expectRevert();
        market.pause();
    }
}
