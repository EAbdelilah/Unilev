// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {EswapV4CoreProofTest} from "./EswapV4CoreProofTest.t.sol";
import {EswapMarginHook} from "../EswapMarginHook.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {IPoolManager as RealIPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolId as RealPoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {PoolId} from "../types/PoolId.sol";
import {PoolKey} from "../types/PoolKey.sol";
import {Currency} from "../types/Currency.sol";
import {IPoolManager} from "../interfaces/IPoolManager.sol";
import {Currency as RealCurrency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolModifyLiquidityTest} from "@uniswap/v4-core/src/test/PoolModifyLiquidityTest.sol";
import {PoolSwapTest} from "@uniswap/v4-core/src/test/PoolSwapTest.sol";

contract EswapRealPoolManagerLifecycleTest is EswapV4CoreProofTest {
    function test_RealPM_Slot0_ReadsRealPoolState() public {
        int24 tick = realManager.initialize(realKey, SQRT_PRICE_1_1);
        assertEq(tick, 0);

        PoolId poolId = _localIdFor(realHookAddr);
        assertTrue(realHook.isAuthorizedPool(poolId));
        assertEq(realHook.lastOraclePrice(poolId), SQRT_PRICE_1_1);

        // Seed concentrated liquidity
        PoolModifyLiquidityTest lq = new PoolModifyLiquidityTest(realManager);
        token0.approve(address(lq), type(uint256).max);
        token1.approve(address(lq), type(uint256).max);
        RealIPoolManager.ModifyLiquidityParams memory lp = RealIPoolManager.ModifyLiquidityParams({
            tickLower: -60,
            tickUpper: 60,
            liquidityDelta: 1e21,
            salt: 0
        });
        lq.modifyLiquidity(realKey, lp, "");

        PoolSwapTest swapper = new PoolSwapTest(realManager);
        token0.approve(address(swapper), type(uint256).max);
        token1.approve(address(swapper), type(uint256).max);

        swapper.swap(
            realKey,
            RealIPoolManager.SwapParams({
                zeroForOne: true,
                amountSpecified: -1 ether,
                sqrtPriceLimitX96: MIN_SQRT_RATIO + 1
            }),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            ""
        );

        // Verify slot0 is read from the real PoolManager slot0 and updated on the hook
        (uint160 postPrice, , , ) = StateLibrary.getSlot0(RealIPoolManager(address(realManager)), RealPoolId.wrap(PoolId.unwrap(poolId)));
        assertEq(realHook.lastOraclePrice(poolId), postPrice);
    }

    function test_RealPM_HookAddress_IsValid() public {
        test_HookAddress_IsValidForRealPoolManager();
    }

    // Confirm the TWAP breaker now behaves: with a price feed within 500bps of spot it passes
    function test_RealPM_TwapBreaker_Passes() public {
        realManager.initialize(realKey, SQRT_PRICE_1_1);
        realHook.setTokenDecimals(address(token0), 18);
        realHook.setTokenDecimals(address(token1), 18);
        priceFeed.setPrice(address(token0), 1e18);
        priceFeed.setPrice(address(token1), 1e18);

        PoolKey memory localRealKey = PoolKey({
            currency0: Currency.wrap(RealCurrency.unwrap(realKey.currency0)),
            currency1: Currency.wrap(RealCurrency.unwrap(realKey.currency1)),
            fee: realKey.fee,
            tickSpacing: realKey.tickSpacing,
            hooks: address(realKey.hooks)
        });

        // Slot0 spot is 1:1, TWAP is 1:1 (deviation 0%) -> passes
        bytes memory data = abi.encode(true, uint8(5), address(this));
        vm.prank(address(realManager));
        realHook.beforeSwap(address(this), localRealKey, IPoolManager.SwapParams(true, -1e18, 0), data);
    }

    // Confirm the TWAP breaker now behaves: and an out-of-band spot price would revert.
    function test_RealPM_TwapBreaker_Reverts() public {
        realManager.initialize(realKey, SQRT_PRICE_1_1);
        realHook.setTokenDecimals(address(token0), 18);
        realHook.setTokenDecimals(address(token1), 18);
        priceFeed.setPrice(address(token0), 1.2e18); // TWAP 1.2:1 (deviation 20% > 5%) -> should revert
        priceFeed.setPrice(address(token1), 1e18);

        PoolKey memory localRealKey = PoolKey({
            currency0: Currency.wrap(RealCurrency.unwrap(realKey.currency0)),
            currency1: Currency.wrap(RealCurrency.unwrap(realKey.currency1)),
            fee: realKey.fee,
            tickSpacing: realKey.tickSpacing,
            hooks: address(realKey.hooks)
        });

        bytes memory data = abi.encode(true, uint8(5), address(this));
        vm.prank(address(realManager));
        vm.expectRevert(EswapMarginHook.TwapManipulated.selector);
        realHook.beforeSwap(address(this), localRealKey, IPoolManager.SwapParams(true, -1e18, 0), data);
    }

    function test_RealPM_MarginPath_MatchesRealV4AbiEncoding() public {
        test_MarginPath_MatchesRealV4AbiEncoding();
    }
}
