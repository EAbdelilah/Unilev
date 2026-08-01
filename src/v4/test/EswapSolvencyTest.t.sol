// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BaseV4Test} from "./BaseV4Test.t.sol";
import {EswapMarginHook} from "../EswapMarginHook.sol";
import {PoolKey} from "../types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "../types/PoolId.sol";
import {Currency} from "../types/Currency.sol";

contract EswapSolvencyTest is BaseV4Test {
    using PoolIdLibrary for PoolKey;

    // When zeroForOne=true: isLong=false (short)
    //   collateral = currency0 (token0), borrow = currency1 (token1)
    // To make it liquidatable: drop token0 price relative to token1
    // collateral value < borrow value * 115%
    //   (amount0 * p0) < (amount1 * p1 * 1.15)
    //   e.g. p0=0.5, p1=1, collateral=4.8, borrow=4 => 2.4 < 4.6 => YES

    function setUp() public override {
        super.setUp();
    }

    function test_HealthFactor_Above1_NotLiquidatable() public {
        priceFeed.setPrice(address(token0), 1e18);
        priceFeed.setPrice(address(token1), 1e18);

        // isLong=false (zeroForOne=true), collateral=token0, borrow=token1
        EswapMarginHook.Position memory pos = EswapMarginHook.Position({
            trader: address(this),
            collateralAmount: 200 ether,  // $200 token0
            borrowedAmount: 100 ether,    // $100 token1
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
        priceFeed.setPrice(address(token0), 0.5e18); // collateral (token0) dropped 50%
        priceFeed.setPrice(address(token1), 1e18);

        // isLong=false, collateral=token0 @ 0.5, borrow=token1 @ 1
        EswapMarginHook.Position memory pos = EswapMarginHook.Position({
            trader: address(this),
            collateralAmount: 100 ether, // value=$50
            borrowedAmount: 80 ether,    // value=$80
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
        // Also sync PoolManager spot to 1:1 (sqrtPriceX96 = Q96)
        manager.setSlot0(key.toId(), 79228162514264337593543950336, 0);

        // zeroForOne=true => isLong=false; collateral=token0, borrow=token1
        bytes memory data = abi.encode(true, uint8(5), address(this));
        vm.prank(address(manager));
        hook.beforeSwap(address(this), key, true, -1 ether, data);
        vm.prank(address(manager));
        hook.afterSwap(address(this), key, true, -5 ether, 5 ether, -4.8 ether, data);
    }

    function test_Liquidation_InsuranceSplit_ExactAmounts() public {
        _openPosition(); // opens at 1:1

        // Now simulate price crash: token0 drops to 0.5, making position liquidatable
        priceFeed.setPrice(address(token0), 0.5e18);
        priceFeed.setPrice(address(token1), 1e18);
        // pos: isLong=false, collateral=token0 @ $0.5, borrow=token1 @ $1
        // collateral value = 4.8 * 0.5 = 2.4, borrow value = 4 * 1 = 4
        // 2.4*100 < 4*115 => liquidatable ✓

        token0.mint(address(hook), 10 ether);
        token1.mint(address(hook), 10 ether);
        manager.setNextSwapDelta(-5 ether, -5 ether);

        hook.executeLiquidation(key, address(this), 0);

        (address trader, uint256 collateral,,,,,,,) = hook.positions(key.toId(), address(this));
        assertEq(trader, address(0));
        assertEq(collateral, 0);
        assertTrue(hook.insuranceFund(key.currency0) > 0);
    }

    function test_BadDebt_CoveredByInsurance() public {
        _openPosition(); // opens at 1:1

        // Now simulate extreme crash: token0 drops to 0.1 (bad debt scenario)
        priceFeed.setPrice(address(token0), 0.1e18);
        priceFeed.setPrice(address(token1), 1e18);

        // Seed insurance fund for the BORROW currency (currency1 = token1)
        token1.mint(address(this), 100 ether);
        token1.approve(address(hook), 100 ether);
        hook.seedInsuranceFund(key.currency1, 10 ether);

        token0.mint(address(hook), 100 ether);
        token1.mint(address(hook), 100 ether);
        // Negative delta so receivedAmount = 0.3 ether < borrow = 4 ether → bad debt
        manager.setNextSwapDelta(-0.3 ether, -0.3 ether);

        hook.executeLiquidation(key, address(this), 0);

        (address trader, uint256 collateral,,,,,,,) = hook.positions(key.toId(), address(this));
        assertEq(trader, address(0));
        assertEq(collateral, 0);
    }

    function test_BadDebt_RevertsIfInsuranceInsufficient() public {
        _openPosition(); // opens at 1:1

        // Now simulate extreme crash
        priceFeed.setPrice(address(token0), 0.1e18);
        priceFeed.setPrice(address(token1), 1e18);

        token0.mint(address(hook), 100 ether);
        token1.mint(address(hook), 100 ether);
        // receivedAmount = 0.3 ether < borrow = 4 ether → shortfall = 3.7 ether
        // Insurance for currency1 = 0 → should revert
        manager.setNextSwapDelta(-0.3 ether, -0.3 ether);

        vm.expectRevert();
        hook.executeLiquidation(key, address(this), 0);
    }
}
