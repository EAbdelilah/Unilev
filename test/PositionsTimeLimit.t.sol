// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {PositionState} from "../src/libraries/PositionTypes.sol";
import "./utils/TestSetupMock.sol";

contract PositionsTimeLimitTest is TestSetupMock {
    function test_DefaultTimeLimit_30Days() public {
        address usdc = getUsdcAddress();
        address wbtc = getWbtcAddress();
        uint128 amount = 2e6; // 2 USDC
        uint24 fee = 3000;

        depositLiquidity(usdc, 1000_000e6);

        // 1. Initial State
        writeTokenBalance(alice, usdc, amount);

        vm.startPrank(deployer);
        mockV3AggregatorEthUsd.updateAnswer(4000 * 1e8); // ETH = $4,000
        mockV3AggregatorWbtcUsd.updateAnswer(100000 * 1e8); // WBTC = $100,000
        vm.stopPrank();

        // 2. Open Position
        vm.startPrank(alice);
        IERC20(usdc).approve(address(positions), amount);
        market.openLongPosition(usdc, wbtc, fee, 2, amount, 0, 0);
        vm.stopPrank();

        uint256[] memory posAlice = positions.getTraderPositions(alice);
        uint256 posId = posAlice[0];

        // 3. Check State before time limit (e.g. 29 days)
        vm.warp(block.timestamp + 29 days);
        vm.roll(block.number + (29 days / 2 seconds) - 100); // Not enough blocks to expire
        PositionState state = positions.getPositionState(posId);
        assertEq(uint256(state), uint256(PositionState.ACTIVE), "State should be ACTIVE before 30 days");

        // 4. Check State after time limit (e.g. 30 days + 1 second and enough blocks)
        vm.warp(block.timestamp + 1 days + 1);
        vm.roll(block.number + (1 days / 2 seconds) + 100 + 1); // Add extra 100+1 blocks to ensure expiration
        state = positions.getPositionState(posId);
        assertEq(uint256(state), uint256(PositionState.EXPIRED), "State should be EXPIRED after 30 days");

        // 5. Liquidate
        vm.startPrank(deployer); // Liquidator
        market.liquidatePosition(posId);
        vm.stopPrank();

        // Position should be closed
        uint256[] memory posAliceAfter = positions.getTraderPositions(alice);
        assertEq(posAliceAfter.length, 0, "Position should be closed after liquidation");
    }

    function test_CustomTimeLimit_SpecificUser() public {
        address usdc = getUsdcAddress();
        address wbtc = getWbtcAddress();
        uint128 amount = 2e6; // 2 USDC
        uint24 fee = 3000;

        depositLiquidity(usdc, 1000_000e6);

        // 1. Setup
        writeTokenBalance(alice, usdc, amount);
        writeTokenBalance(bob, usdc, amount);

        vm.startPrank(deployer);
        mockV3AggregatorEthUsd.updateAnswer(4000 * 1e8);
        mockV3AggregatorWbtcUsd.updateAnswer(100000 * 1e8);

        // Set custom time limit only for Alice: 1 day
        feeManager.setCustomPositionLifeTime(alice, 1 days);
        feeManager.setCustomPositionLifeBlocks(alice, 1 days / 12 seconds);
        vm.stopPrank();

        // 2. Open Positions (Alice and Bob)
        vm.startPrank(alice);
        IERC20(usdc).approve(address(positions), amount);
        market.openLongPosition(usdc, wbtc, fee, 2, amount, 0, 0);
        vm.stopPrank();

        vm.startPrank(bob);
        IERC20(usdc).approve(address(positions), amount);
        market.openLongPosition(usdc, wbtc, fee, 2, amount, 0, 0);
        vm.stopPrank();

        uint256 posIdAlice = positions.getTraderPositions(alice)[0];
        uint256 posIdBob = positions.getTraderPositions(bob)[0];

        // 3. Forward time (Alice should expire, Bob should not)
        // Alice needs both time AND blocks to pass her custom 1-day limit
        vm.warp(block.timestamp + 1 days + 1 hours);
        vm.roll(block.number + (1 days / 12 seconds) + 100 + 1); // Add extra 100+1 blocks to ensure expiration

        // Alice: State 6
        PositionState stateAlice = positions.getPositionState(posIdAlice);
        assertEq(uint256(stateAlice), uint256(PositionState.EXPIRED), "Alice should be expired (1 day limit)");

        // Bob: State 2 (using default 30 days)
        PositionState stateBob = positions.getPositionState(posIdBob);
        assertEq(uint256(stateBob), uint256(PositionState.ACTIVE), "Bob should still be active (default 30 days)");

        // 4. Liquidate Alice
        vm.startPrank(deployer);
        market.liquidatePosition(posIdAlice);

        // Try to liquidate Bob (should fail)
        vm.expectRevert();
        market.liquidatePosition(posIdBob);
        vm.stopPrank();
    }
}
