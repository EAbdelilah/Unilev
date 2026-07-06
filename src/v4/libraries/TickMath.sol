// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title TickMath
 * @notice Simplified TickMath for logic-completeness.
 * In production, use the official Uniswap V4 TickMath.
 */
library TickMath {
    uint160 internal constant MIN_SQRT_RATIO = 4295128739;
    uint160 internal constant MAX_SQRT_RATIO = 1461446703485210103287273052203988822378723970342;

    function getSqrtRatioAtTick(int24 tick) internal pure returns (uint160 sqrtPriceX96) {
        // Simple mock: 1.0001^tick * 2^96
        // For tick 0, price is 1.0 (1 << 96)
        if (tick == 0) return 1 << 96;
        if (tick > 0) return uint160((1 << 96) + uint160(uint24(tick)) * 1000000);
        return uint160((1 << 96) - uint160(uint24(-tick)) * 1000000);
    }
}
