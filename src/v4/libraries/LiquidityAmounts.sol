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

    // ─── Inverse direction (liquidity → token amounts) ────────────────────────

    /// @dev Token0 side of `liquidity` held between `sqrtRatioAX96` and
    ///      `sqrtRatioBX96`, mirroring Uniswap's `LiquidityAmounts`. Integer
    ///      overflow is possible only for liquidity that cannot exist on a real
    ///      PoolManager.
    function getAmount0ForLiquidity(uint160 sqrtRatioAX96, uint160 sqrtRatioBX96, uint128 liquidity)
        internal
        pure
        returns (uint256 amount0)
    {
        if (sqrtRatioAX96 > sqrtRatioBX96) (sqrtRatioAX96, sqrtRatioBX96) = (sqrtRatioBX96, sqrtRatioAX96);
        if (sqrtRatioBX96 == sqrtRatioAX96) return 0;
        uint256 numerator = uint256(liquidity) << 96;
        amount0 = ((numerator * (uint256(sqrtRatioBX96) - sqrtRatioAX96)) / sqrtRatioBX96) / sqrtRatioAX96;
    }

    /// @dev Token1 side of `liquidity` held between the same bounds.
    function getAmount1ForLiquidity(uint160 sqrtRatioAX96, uint160 sqrtRatioBX96, uint128 liquidity)
        internal
        pure
        returns (uint256 amount1)
    {
        if (sqrtRatioAX96 > sqrtRatioBX96) (sqrtRatioAX96, sqrtRatioBX96) = (sqrtRatioBX96, sqrtRatioAX96);
        amount1 = (uint256(liquidity) * (uint256(sqrtRatioBX96) - sqrtRatioAX96)) / (1 << 96);
    }

    /// @notice [AUDIT F-06] Mark-to-market of an LP band: the token0/token1
    ///         amounts a given `liquidity` position actually holds at
    ///         `sqrtRatioX96`. Used by the liquidation health check so it values
    ///         the assets the hook really holds instead of a stale book value.
    function getAmountsForLiquidity(
        uint160 sqrtRatioX96,
        uint160 sqrtRatioAX96,
        uint160 sqrtRatioBX96,
        uint128 liquidity
    ) internal pure returns (uint256 amount0, uint256 amount1) {
        if (sqrtRatioAX96 > sqrtRatioBX96) (sqrtRatioAX96, sqrtRatioBX96) = (sqrtRatioBX96, sqrtRatioAX96);
        if (sqrtRatioX96 <= sqrtRatioAX96) {
            amount0 = getAmount0ForLiquidity(sqrtRatioAX96, sqrtRatioBX96, liquidity);
        } else if (sqrtRatioX96 < sqrtRatioBX96) {
            amount0 = getAmount0ForLiquidity(sqrtRatioX96, sqrtRatioBX96, liquidity);
            amount1 = getAmount1ForLiquidity(sqrtRatioAX96, sqrtRatioX96, liquidity);
        } else {
            amount1 = getAmount1ForLiquidity(sqrtRatioAX96, sqrtRatioBX96, liquidity);
        }
    }
}
