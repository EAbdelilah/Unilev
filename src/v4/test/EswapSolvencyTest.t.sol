// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BaseV4Test} from "./BaseV4Test.t.sol";
import {EswapMarginHook} from "../EswapMarginHook.sol";
import {PoolKey} from "../types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "../types/PoolId.sol";
import {Currency} from "../types/Currency.sol";
import {IPoolManager} from "../interfaces/IPoolManager.sol";
import {BalanceDeltaLibrary} from "../types/BalanceDelta.sol";

contract EswapSolvencyTest is BaseV4Test {
    using PoolIdLibrary for PoolKey;

    // When zeroForOne=true: isLong=false (short)
    //   collateral = currency1 (token1, the bought asset), borrow = currency0 (token0)
    // To make it liquidatable: drop token1 price relative to token0
    // collateral value < borrow value * 115%
    //   (amount1 * p1) < (amount0 * p0 * 1.15)
    //   e.g. p1=0.5, p0=1, collateral=4.8, borrow=4 => 2.4 < 4.6 => YES

    function setUp() public override {
        super.setUp();
    }

    function test_HealthFactor_Above1_NotLiquidatable() public {
        priceFeed.setPrice(address(token0), 1e18);
        priceFeed.setPrice(address(token1), 1e18);

        // isLong=false (zeroForOne=true), collateral=token1, borrow=token0
        EswapMarginHook.Position memory pos = EswapMarginHook.Position({
            trader: address(this),
            collateralAmount: 200 ether, // $200 token0
            borrowedAmount: 100 ether, // $100 token1
            leverage: 2,
            isLong: false,
            liquidationSqrtPrice: 0,
            tickLower: -60,
            tickUpper: 60,
            liquidity: 0
        });

        assertFalse(hook.isLiquidatable(pos, key));
    }

    function test_HealthFactor_Below1_Liquidatable() public {
        priceFeed.setPrice(address(token1), 0.5e18); // collateral (token1) dropped 50%
        priceFeed.setPrice(address(token0), 1e18);

        // isLong=false, collateral=token1 @ 0.5, borrow=token0 @ 1
        EswapMarginHook.Position memory pos = EswapMarginHook.Position({
            trader: address(this),
            collateralAmount: 100 ether, // value=$50
            borrowedAmount: 80 ether, // value=$80
            leverage: 5,
            isLong: false,
            liquidationSqrtPrice: 0,
            tickLower: -60,
            tickUpper: 60,
            liquidity: 0
        });

        // 50 * 100 < 80 * 115 => 5000 < 9200 => liquidatable
        assertTrue(hook.isLiquidatable(pos, key));
    }

    function _openPosition() internal {
        // Open at neutral 1:1 prices so TWAP circuit breaker doesn't fire
        priceFeed.setPrice(address(token0), 1e18);
        priceFeed.setPrice(address(token1), 1e18);

        // zeroForOne=true => isLong=false; collateral=token1, borrow=token0
        bytes memory data = abi.encode(true, uint8(5), address(this));
        vm.prank(address(manager));
        hook.beforeSwap(address(this), key, IPoolManager.SwapParams(true, -1 ether, 0), data);
        vm.prank(address(manager));
        hook.afterSwap(
            address(this),
            key,
            IPoolManager.SwapParams(true, -5 ether, 0),
            BalanceDeltaLibrary.toBalanceDelta(-5 ether, 4.8 ether),
            data
        );
        // Simulate Router minting ERC-6909 collateral claims to the hook (real V4 unlock flow)
        // Double amount: _settleTransientDebt burns up to collateralAmount, then _settle burns again
        manager.mint(address(hook), uint256(uint160(address(token1))), 4.8 ether * 2);
    }

    function test_Liquidation_InsuranceSplit_ExactAmounts() public {
        _openPosition(); // opens at 1:1

        // Now simulate price crash: token1 drops to 0.5, making position liquidatable
        priceFeed.setPrice(address(token1), 0.5e18);
        priceFeed.setPrice(address(token0), 1e18);
        // pos: isLong=false, collateral=token1 @ $0.5, borrow=token0 @ $1
        // collateral value = 4.8 * 0.5 = 2.4, borrow value = 4 * 1 = 4
        // 2.4*100 < 4*115 => liquidatable ✓

        // SHORT liquidation: zeroForOne=false → sell currency1 (collateral) → receive currency0 (debt)
        // New directional mock: amount0=+5 ether (received), amount1=-5 ether (sold)
        // receivedAmount comes from amount0 (positive) = 5 ether
        // Surplus after repaying the 4 ether borrow = 1 ether → 3% = 0.03 to insurance
        token0.mint(address(hook), 10 ether);
        token1.mint(address(hook), 10 ether);
        // Override with explicit directional delta: selling token1, receiving token0
        manager.setNextSwapDelta(5 ether, -5 ether);

        // Verify the claim is populated before liquidation (makes the clear assertion meaningful).
        // SHORT (zeroForOne=true) collateral = currency1 (token1), the bought asset
        uint256 claimId = uint256(uint160(address(token1)));
        assertTrue(hook._claimBalances(address(this), claimId) > 0, "claim should be populated before liquidation");

        uint256 traderBalBefore = token0.balanceOf(address(this));
        hook.executeLiquidation(key, address(this), 0, address(this));

        (address trader, uint256 collateral,,,,,,,) = hook.positions(key.toId(), address(this));
        assertEq(trader, address(0));
        assertEq(collateral, 0);
        // Nobody profits from a penalty: the liquidator earns 0; the trader receives
        // the surplus minus the insurance carve-out (1 - 0.03 = 0.97 ether).
        assertEq(
            token0.balanceOf(address(this)) - traderBalBefore, 0.97 ether, "trader receives surplus minus carve-out"
        );
        assertEq(hook.insuranceFund(key.currency0), 0.03 ether, "reward routed to the insurance fund");

        // No phantom ERC-6909 claim or collateral aggregate should remain after liquidation
        assertEq(hook._claimBalances(address(this), claimId), 0, "claim balance not cleared on liquidation");
        assertEq(hook.totalCollateral(key.currency1), 0, "totalCollateral not cleared on liquidation");
    }

    function test_BadDebt_CoveredByInsurance() public {
        _openPosition(); // opens at 1:1

        // Now simulate extreme crash: token1 drops to 0.1 (bad debt scenario)
        priceFeed.setPrice(address(token1), 0.1e18);
        priceFeed.setPrice(address(token0), 1e18);

        // Seed insurance fund for the BORROW currency (currency0 = token0)
        token0.mint(address(this), 100 ether);
        token0.approve(address(hook), 100 ether);
        hook.seedInsuranceFund(key.currency0, 10 ether);

        // SHORT liquidation bad-debt: sell token1, receive tiny amount of token0
        // Override delta: amount0=+0.3 ether (received), borrow=4 ether → shortfall=3.7 ether
        token0.mint(address(hook), 100 ether);
        token1.mint(address(hook), 100 ether);
        manager.setNextSwapDelta(0.3 ether, -0.3 ether);

        hook.executeLiquidation(key, address(this), 0, address(this));

        (address trader, uint256 collateral,,,,,,,) = hook.positions(key.toId(), address(this));
        assertEq(trader, address(0));
        assertEq(collateral, 0);
    }

    function test_BadDebt_RecordedWhenInsuranceInsufficient() public {
        _openPosition(); // opens at 1:1

        // Now simulate extreme crash
        priceFeed.setPrice(address(token1), 0.1e18);
        priceFeed.setPrice(address(token0), 1e18);

        token0.mint(address(hook), 100 ether);
        token1.mint(address(hook), 100 ether);
        // SHORT liquidation: receives token0 = 0.3 ether < borrow 4 ether → shortfall 3.7.
        // Insurance for currency0 = 0 → the whole 3.7 ether is recorded as bad debt
        // [FIX C-7] instead of reverting and stranding the position forever.
        manager.setNextSwapDelta(0.3 ether, -0.3 ether);

        hook.executeLiquidation(key, address(this), 0, address(this));

        (address trader, uint256 collateral,,,,,,,) = hook.positions(key.toId(), address(this));
        assertEq(trader, address(0), "position cleared despite insufficient insurance");
        assertEq(collateral, 0, "position collateral cleared");
        assertEq(hook.badDebt(key.currency0), 3.7 ether, "uncovered shortfall booked as protocol bad debt");
    }
}
