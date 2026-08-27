// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {TickMath} from "./TickMath.sol";

/**
 * @title LiquidityAmounts
 * @notice Simplified library to calculate liquidity L from token amounts and price ticks.
 */
library LiquidityAmounts {
    function getSqrtRatioAtTick(int24 tick) internal pure returns (uint160 sqrtPriceX96) {
        return TickMath.getSqrtRatioAtTick(tick);
    }

    function getLiquidityForAmount0(uint160 sqrtRatioAX96, uint160 sqrtRatioBX96, uint256 amount0)
        internal
        pure
        returns (uint128 liquidity)
    {
        if (sqrtRatioAX96 > sqrtRatioBX96) (sqrtRatioAX96, sqrtRatioBX96) = (sqrtRatioBX96, sqrtRatioAX96);
        uint256 intermediate = (uint256(sqrtRatioAX96) * sqrtRatioBX96) / (1 << 96);
        liquidity = uint128((amount0 * intermediate) / (sqrtRatioBX96 - sqrtRatioAX96));
    }

    function getLiquidityForAmount1(uint160 sqrtRatioAX96, uint160 sqrtRatioBX96, uint256 amount1)
        internal
        pure
        returns (uint128 liquidity)
    {
        if (sqrtRatioAX96 > sqrtRatioBX96) (sqrtRatioAX96, sqrtRatioBX96) = (sqrtRatioBX96, sqrtRatioAX96);
        liquidity = uint128((amount1 << 96) / (sqrtRatioBX96 - sqrtRatioAX96));
    }

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
