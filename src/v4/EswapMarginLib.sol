// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {PoolKey} from "./types/PoolKey.sol";
import {Currency} from "./types/Currency.sol";
import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";
import {LiquidityAmounts} from "./libraries/LiquidityAmounts.sol";
import {TickMath} from "./libraries/TickMath.sol";

interface IPriceFeedLib {
    function getAmountInUsd(address token, uint256 amount) external view returns (uint256);
    function getTwapPrice(address token) external view returns (uint256);
}

/**
 * @title EswapMarginLib
 * @notice Stateless pure/view logic extracted from EswapMarginHook to reduce its
 *         bytecode size below the EIP-170 24,576-byte deployment limit.
 */
library EswapMarginLib {

    error TwapNotConfigured();
    error TwapManipulated();

    // ─── Liquidation Math ─────────────────────────────────────────────────────

    function liquidationThresholdBps(uint8 leverage) public pure returns (uint256) {
        uint256 reduction = uint256(leverage) * 200;
        return reduction < 12000 ? 12000 - reduction : 10000;
    }

    function isLiquidatable(
        uint256 collateralValueUsd,
        uint256 borrowedValueUsd,
        uint8 leverage
    ) public pure returns (bool) {
        if (collateralValueUsd == 0 && borrowedValueUsd == 0) return false;
        uint256 threshold = liquidationThresholdBps(leverage);
        return collateralValueUsd * 10000 < borrowedValueUsd * threshold;
    }

    // ─── TWAP Circuit Breaker ─────────────────────────────────────────────────

    function checkTwap(
        address priceFeed,
        PoolKey calldata key,
        uint160 sqrtPriceX96,
        uint8 decimals0,
        uint8 decimals1,
        uint160 maxPriceSwingBps,
        bool requireTwapOracle
    ) public view {
        uint256 twap0 = IPriceFeedLib(priceFeed).getTwapPrice(Currency.unwrap(key.currency0));
        uint256 twap1 = IPriceFeedLib(priceFeed).getTwapPrice(Currency.unwrap(key.currency1));

        if (twap0 == 0 || twap1 == 0) {
            if (requireTwapOracle) revert TwapNotConfigured();
            return;
        }

        uint256 twapRatio18 = (twap0 * 1e18) / twap1;

        if (sqrtPriceX96 == 0) return;

        uint256 spotRatio18 = FullMath.mulDiv(
            uint256(sqrtPriceX96) * 1e18,
            uint256(sqrtPriceX96),
            1 << 192
        );
        if (spotRatio18 == 0) revert TwapManipulated();

        uint8 d0 = decimals0 == 0 ? 18 : decimals0;
        uint8 d1 = decimals1 == 0 ? 18 : decimals1;
        if (d0 > d1) {
            spotRatio18 = FullMath.mulDiv(spotRatio18, uint256(10) ** (d0 - d1), 1);
        } else if (d1 > d0) {
            spotRatio18 = spotRatio18 / (uint256(10) ** (d1 - d0));
        }

        uint256 deviation;
        if (spotRatio18 >= twapRatio18) {
            deviation = ((spotRatio18 - twapRatio18) * 10000) / twapRatio18;
        } else {
            deviation = ((twapRatio18 - spotRatio18) * 10000) / spotRatio18;
        }

        if (deviation > maxPriceSwingBps) revert TwapManipulated();
    }

    // ─── Saturating Math ──────────────────────────────────────────────────────

    function saturatingSub(uint256 a, uint256 b) public pure returns (uint256) {
        return a >= b ? a - b : 0;
    }

    function computeLiquidity(
        uint160 sqrtPriceX96,
        int24 tickLower,
        int24 tickUpper,
        uint256 amount,
        bool useAmount0
    ) public pure returns (uint128) {
        return LiquidityAmounts.getLiquidityForAmount(
            sqrtPriceX96,
            TickMath.getSqrtRatioAtTick(tickLower),
            TickMath.getSqrtRatioAtTick(tickUpper),
            amount,
            useAmount0
        );
    }
}
