// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title TickMath
 * @notice Improved TickMath using fixed-point exponentiation.
 * Derived from TwapLibrary.sol to ensure high-precision for Eswap V4.
 */
library TickMath {
    uint160 internal constant MIN_SQRT_RATIO = 4295128739;
    uint160 internal constant MAX_SQRT_RATIO = 1461446703485210103287273052203988822378723970342;

    /// @dev 1.0001 in Q128 fixed-point: floor(1.0001 × 2^128)
    uint256 private constant ONE_0001_Q128 = 340316395157630557309720944892511388277;
    uint256 private constant ONE_Q128 = 0x100000000000000000000000000000000;

    function getSqrtRatioAtTick(int24 tick) internal pure returns (uint160 sqrtPriceX96) {
        if (tick == 0) return uint160(1 << 96);

        bool negative = tick < 0;
        uint256 absTick = negative ? uint256(uint24(-tick)) : uint256(uint24(tick));

        // Compute 1.0001^absTick in Q128
        uint256 priceQ128 = _pow(ONE_0001_Q128, absTick);

        if (negative) {
            priceQ128 = (ONE_Q128 * ONE_Q128) / priceQ128;
        }

        // sqrtPriceX96 = sqrt(price) * 2^96
        // priceQ128 = price * 2^128
        // price = priceQ128 / 2^128
        // sqrt(price) = sqrt(priceQ128) / 2^64
        // sqrtPriceX96 = (sqrt(priceQ128) / 2^64) * 2^96 = sqrt(priceQ128) * 2^32

        uint256 sqrtP = _sqrt(priceQ128);
        return uint160(sqrtP << 32);
    }

    function _pow(uint256 base, uint256 exp) private pure returns (uint256 result) {
        result = ONE_Q128;
        uint256 b = base;
        uint256 e = exp;
        while (e > 0) {
            if (e & 1 == 1) result = _mulDiv(result, b, ONE_Q128);
            b = _mulDiv(b, b, ONE_Q128);
            e >>= 1;
        }
    }

    function _sqrt(uint256 y) private pure returns (uint256 z) {
        if (y > 3) {
            z = y;
            uint256 x = y / 2 + 1;
            while (x < z) {
                z = x;
                x = (y / x + x) / 2;
            }
        } else if (y != 0) {
            z = 1;
        }
    }

    function _mulDiv(uint256 a, uint256 b, uint256 denominator) private pure returns (uint256 result) {
        unchecked {
            uint256 prod0; uint256 prod1;
            assembly {
                let mm := mulmod(a, b, not(0))
                prod0 := mul(a, b)
                prod1 := sub(sub(mm, prod0), lt(mm, prod0))
            }
            if (prod1 == 0) {
                assembly { result := div(prod0, denominator) }
                return result;
            }
            require(denominator > prod1);
            uint256 remainder;
            assembly { remainder := mulmod(a, b, denominator) }
            assembly {
                prod1 := sub(prod1, gt(remainder, prod0))
                prod0 := sub(prod0, remainder)
            }
            uint256 twos = denominator & (~denominator + 1);
            assembly { denominator := div(denominator, twos) }
            assembly { prod0 := div(prod0, twos) }
            assembly { twos := add(div(sub(0, twos), twos), 1) }
            prod0 |= prod1 * twos;
            uint256 inv = (3 * denominator) ^ 2;
            inv *= 2 - denominator * inv;
            inv *= 2 - denominator * inv;
            inv *= 2 - denominator * inv;
            inv *= 2 - denominator * inv;
            inv *= 2 - denominator * inv;
            inv *= 2 - denominator * inv;
            result = prod0 * inv;
        }
    }
}
