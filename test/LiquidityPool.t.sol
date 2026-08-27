// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {TestSetup} from "./utils/TestSetup.sol";
import {LiquidityPool} from "../src/LiquidityPool.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";

contract LiquidityPoolTest is TestSetup {
    LiquidityPool public pool;
    IERC20 public asset;

    function setUp() public override {
        super.setUp();
        pool = LiquidityPool(liquidityPoolFactory.getTokenToLiquidityPools(conf.supportedTokens[0].token));
        asset = IERC20(conf.supportedTokens[0].token);

        // Ensure bob deposits 10e8 for initial pool liquidity
        depositLiquidity(address(asset), 10e8);

        // Ensure alice has some funds and approves the pool for her tests
        vm.startPrank(alice);
        writeTokenBalance(alice, address(asset), 100e8);
        asset.approve(address(pool), 100e8);
        vm.stopPrank();
    }

    function testDeposit() public {
        vm.startPrank(alice);
        uint256 depositAmount = 10e8;

        uint256 balanceBefore = asset.balanceOf(alice);
        uint256 shares = pool.deposit(depositAmount, alice);
        uint256 balanceAfter = asset.balanceOf(alice);

        // Check shares received
        // Since it's 1:1 initially
        assertEq(shares, depositAmount, "Shares should equal deposit amount initially");
        assertEq(balanceBefore - balanceAfter, depositAmount, "User balance should decrease by deposit amount");

        // Check user balance
        assertEq(pool.balanceOf(alice), shares, "User should have shares");

        // Check pool asset balance
        // Note: bob already deposited 10e8 in setup
        assertEq(asset.balanceOf(address(pool)), 10e8 + depositAmount, "Pool should have assets");
        vm.stopPrank();
    }

    function testWithdraw() public {
        vm.startPrank(alice);
        uint256 depositAmount = 10e8;

        pool.deposit(depositAmount, alice);

        uint256 withdrawAmount = 5e8;
        uint256 balanceBefore = asset.balanceOf(alice);
        uint256 sharesBurned = pool.withdraw(withdrawAmount, alice, alice);
        uint256 balanceAfter = asset.balanceOf(alice);

        assertEq(sharesBurned, withdrawAmount, "Shares burned should equal withdraw amount");
        assertEq(balanceAfter - balanceBefore, withdrawAmount, "User balance should increase by withdraw amount");
        assertEq(pool.balanceOf(alice), depositAmount - sharesBurned, "User should have remaining shares");

        vm.stopPrank();
    }

    function testWithdrawNoDeposit() public {
        vm.startPrank(alice);
        uint256 depositAmount = 10e8;

        pool.deposit(depositAmount, alice);

        vm.stopPrank();

        vm.startPrank(carol);
        vm.expectRevert();
        pool.withdraw(1e8, carol, carol);
        vm.stopPrank();
    }

    function testRedeem() public {
        vm.startPrank(alice);
        uint256 depositAmount = 10e8;
        uint256 shares = pool.deposit(depositAmount, alice);

        uint256 redeemShares = 5e8;
        uint256 balanceBefore = asset.balanceOf(alice);
        uint256 assetsReceived = pool.redeem(redeemShares, alice, alice);
        uint256 balanceAfter = asset.balanceOf(alice);

        assertEq(assetsReceived, redeemShares, "Assets received should equal shares redeemed");
        assertEq(balanceAfter - balanceBefore, assetsReceived, "User balance should increase by assets received");
        assertEq(pool.balanceOf(alice), shares - redeemShares, "User should have remaining shares");
        vm.stopPrank();
    }

    function testShares() public view {
        uint256 assets = 100e8;
        uint256 expectedShares = pool.previewDeposit(assets);
        assertEq(expectedShares, assets, "Preview deposit should match assets 1:1 initially");

        uint256 shares = 100e8;
        uint256 expectedAssets = pool.previewRedeem(shares);
        assertEq(expectedAssets, shares, "Preview redeem should match shares 1:1 initially");
    }

    function testBorrow() public {
        address positionsAddr = address(positions);

        vm.startPrank(positionsAddr);
        uint256 borrowAmount = 1e8;

        uint256 balanceBefore = asset.balanceOf(positionsAddr);
        pool.borrow(borrowAmount);
        uint256 balanceAfter = asset.balanceOf(positionsAddr);

        assertEq(pool.getBorrowedFund(), borrowAmount, "Borrowed funds should increase");
        assertEq(balanceAfter - balanceBefore, borrowAmount, "Positions contract should receive borrowed funds");
        assertEq(pool.totalAssets(), pool.rawTotalAsset() + borrowAmount, "Total assets should include borrowed funds");
        vm.stopPrank();
    }

    function testBorrowRevertIfNotOwner() public {
        vm.startPrank(alice);
        vm.expectRevert(); // OwnableUnauthorizedAccount
        pool.borrow(1e8);
        vm.stopPrank();
    }

    function testBorrowRevertIfNotEnoughLiquidity() public {
        address positionsAddr = address(positions);
        vm.startPrank(positionsAddr);

        uint256 maxBorrow = pool.borrowCapacityLeft();
        vm.expectRevert(); // LiquidityPool__NOT_ENOUGH_LIQUIDITY
        pool.borrow(maxBorrow + 1);

        vm.stopPrank();
    }

    function testRefund() public {
        address positionsAddr = address(positions);

        // First borrow
        vm.startPrank(positionsAddr);
        uint256 borrowAmount = 1e8;
        pool.borrow(borrowAmount);

        // Approve pool to take back funds (refund transfers from msg.sender)
        asset.approve(address(pool), borrowAmount * 2); // ample approval

        // Refund full amount
        uint256 balanceBefore = asset.balanceOf(positionsAddr);
        pool.refund(borrowAmount, 0, 0);
        uint256 balanceAfter = asset.balanceOf(positionsAddr);

        assertEq(pool.getBorrowedFund(), 0, "Borrowed funds should be zero after full refund");
        assertEq(balanceBefore - balanceAfter, borrowAmount, "Positions balance should decrease by refunded amount");
        vm.stopPrank();
    }

    function testRefundWithInterest() public {
        address positionsAddr = address(positions);

        // First borrow
        vm.startPrank(positionsAddr);
        uint256 borrowAmount = 1e8;
        pool.borrow(borrowAmount);

        // Simulate gaining interest
        uint256 interest = 0.1e8;
        writeTokenBalance(positionsAddr, address(asset), 1000e8); // Ensure positions has enough
        asset.approve(address(pool), borrowAmount + interest);

        pool.refund(borrowAmount, interest, 0);

        assertEq(pool.getBorrowedFund(), 0, "Borrowed funds should be zero");
        // Total assets should increase by interest
        // Initial assets (Bob 10e8) + Interest (0.1e8) -> actually Bob deposited 10e8 in SetUp
        // Check totalAssets()
        assertEq(pool.totalAssets(), 10e8 + interest, "Total assets should include interest");
        vm.stopPrank();
    }

    function testRefundWithLoss() public {
        address positionsAddr = address(positions);

        // First borrow
        vm.startPrank(positionsAddr);
        uint256 borrowAmount = 1e8;
        pool.borrow(borrowAmount);

        // Simulate loss
        uint256 loss = 0.5e8;
        asset.approve(address(pool), borrowAmount - loss);

        pool.refund(borrowAmount, 0, loss);

        assertEq(pool.getBorrowedFund(), 0, "Borrowed funds should be zero");
        // Total assets should decrease by loss
        assertEq(pool.totalAssets(), 10e8 - loss, "Total assets should reflect loss");
        vm.stopPrank();
    }

    function testSecurityWithdrawOtherUserFunds() public {
        // Alice deposits
        vm.startPrank(alice);
        pool.deposit(10e8, alice);
        vm.stopPrank();

        // Carol tries to withdraw Alice's funds
        vm.startPrank(carol);
        vm.expectRevert(); // ERC20InsufficientAllowance or similar
        pool.withdraw(10e8, carol, alice);
        vm.stopPrank();

        // Carol tries to redeem Alice's shares
        vm.startPrank(carol);
        vm.expectRevert();
        pool.redeem(10e8, carol, alice);
        vm.stopPrank();
    }

    function testSecurityApproveWithdraw() public {
        // Alice deposits
        vm.startPrank(alice);
        pool.deposit(10e8, alice);
        // Alice approves Carol
        pool.approve(carol, 5e8); // Approval is for shares
        vm.stopPrank();

        // Carol withdraws from Alice
        vm.startPrank(carol);
        pool.withdraw(5e8, carol, alice);
        vm.stopPrank();

        assertEq(pool.balanceOf(alice), 5e8, "Alice should have remaining shares");
    }
}
