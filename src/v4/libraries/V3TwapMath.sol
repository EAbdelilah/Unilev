// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IUniswapV3Pool} from "../../interfaces/IUniswapV3.sol";
import {FullMath} from "../../../lib/v4-core/src/libraries/FullMath.sol";
import {TickMath} from "./TickMath.sol";

/**
 * @title V3TwapMath
 * @notice Uniswap V3 TWAP pricing helpers shared by the Unichain DEX-TWAP oracles.
 * @dev Extracted so the USDC/USD and ETH/USD adapters cannot drift apart: both
 *      must derive the WETH/USDC ratio with byte-identical arithmetic, otherwise a
 *      change to one silently desynchronises the pair.
 *
 *      The price is recovered the way Uniswap's periphery `consult` does it:
 *      `observe` returns *tick cumulatives* (its second return value is a
 *      liquidity-weighted time counter, NOT a price), so the mean tick over the
 *      window is differenced, divided by elapsed seconds, and converted back to a
 *      sqrt ratio with TickMath.
 */
library V3TwapMath {
    /// @dev Q64.96 fixed-point constant used by Uniswap V3.
    uint256 internal constant Q96 = 1 << 96;

    /// @notice Amount of USDC (18-dec) per 1 WETH, from the pool's TWAP.
    /// @dev Assumes token0 = USDC (6 decimals) and token1 = WETH (18 decimals),
    ///      which is the ordering Uniswap V3 derives from sorting by address.
    /// @return 0 if the observation window is unavailable or degenerate.
    function consultUsdcPerWeth18(address pool, uint32 window) internal view returns (uint256) {
        IUniswapV3Pool p = IUniswapV3Pool(pool);

        uint32[] memory ago = new uint32[](2);
        ago[0] = window;
        ago[1] = 0;
        (int56[] memory tickCumulatives,) = p.observe(ago);

        uint56 elapsed = uint56(window);
        if (elapsed == 0) return 0;

        int56 tickCumulative = tickCumulatives[1] - tickCumulatives[0];
        int24 meanTick = int24(tickCumulative / int56(elapsed));
        if (meanTick == type(int24).min || meanTick == type(int24).max) return 0;

        uint256 sqrtPriceX96 = uint256(TickMath.getSqrtRatioAtTick(meanTick));
        if (sqrtPriceX96 == 0) return 0;

        // The V3 invariant gives S^2 = WETH-per-USDC * 10^(dec1 - dec0) = * 1e12,
        // so USDC-per-WETH = 1e12 / S^2, i.e. 1e30 / S^2 as an 18-dec quantity.
        //
        // Do NOT normalise with `sqrtPriceX96 / Q96` first: that floors the Q64.96
        // value and discards significant digits, injecting a real error straight
        // into collateral valuation. Folding both Q96 divisions into two mulDiv
        // steps keeps full 256-bit precision; each intermediate stays well under
        // 2^256 (7.9e58 and 4.1e54 respectively).
        uint256 inner = FullMath.mulDiv(1e30, Q96, sqrtPriceX96);
        if (inner == 0) return 0;
        return FullMath.mulDiv(inner, Q96, sqrtPriceX96);
    }
}
