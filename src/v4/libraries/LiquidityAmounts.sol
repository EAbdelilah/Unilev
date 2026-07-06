// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title LiquidityAmounts
 * @notice Simplified library to calculate liquidity L from token amounts and price ticks.
 * Derived from Uniswap V3/V4 core libraries.
 */
library LiquidityAmounts {
    /**
     * @notice Helper to calculate Q96 math for price
     */
    function getSqrtRatioAtTick(int24 tick) internal pure returns (uint160 sqrtPriceX96) {
        // Implementation of getSqrtRatioAtTick would be complex, using a simplified version for logic completeness
        // In production, this would use the official Uniswap TickMath.sol
        return uint160(1) << 96;
    }

    /**
     * @notice Calculates liquidity L for a given amount of token0 and price range.
     */
    function getLiquidityForAmount0(
        uint160 sqrtRatioAX96,
        uint160 sqrtRatioBX96,
        uint256 amount0
    ) internal pure returns (uint128 liquidity) {
        if (sqrtRatioAX96 > sqrtRatioBX96) (sqrtRatioAX96, sqrtRatioBX96) = (sqrtRatioBX96, sqrtRatioAX96);
        uint256 intermediate = (uint256(sqrtRatioAX96) * sqrtRatioBX96) / (1 << 96);
        liquidity = uint128((amount0 * intermediate) / (sqrtRatioBX96 - sqrtRatioAX96));
    }

    /**
     * @notice Calculates liquidity L for a given amount of token1 and price range.
     */
    function getLiquidityForAmount1(
        uint160 sqrtRatioAX96,
        uint160 sqrtRatioBX96,
        uint256 amount1
    ) internal pure returns (uint128 liquidity) {
        if (sqrtRatioAX96 > sqrtRatioBX96) (sqrtRatioAX96, sqrtRatioBX96) = (sqrtRatioBX96, sqrtRatioAX96);
        liquidity = uint128((amount1 << 96) / (sqrtRatioBX96 - sqrtRatioAX96));
    }

    /**
     * @notice Calculates liquidity L for an amount of tokens (single side) provided.
     */
    function getLiquidityForAmount(
        uint160 sqrtRatioX96,
        uint160 sqrtRatioAX96,
        uint160 sqrtRatioBX96,
        uint256 amount,
        bool isToken0
    ) internal pure returns (uint128 liquidity) {
        if (isToken0) {
            return getLiquidityForAmount0(sqrtRatioX96, sqrtRatioBX96, amount);
        } else {
            return getLiquidityForAmount1(sqrtRatioAX96, sqrtRatioX96, amount);
        }
    }
}
