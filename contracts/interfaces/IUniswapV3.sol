// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title IUniswapV3
 * @notice Minimal Uniswap V3 surface needed to execute an exact-input swap.
 * @dev Deliberately interface-only. Importing the full `uniswap-v3-core`
 *      package would pull in the whole position/liquidity/tick machinery for two
 *      functions, and the periphery interfaces differ between deployments. The
 *      `swap` signature and the callback are canonical and stable across every
 *      V3 fork, so the small surface is the safer dependency.
 */

/// @notice Canonical V3 factory. Used to resolve a pool for a token pair + fee.
interface IUniswapV3Factory {
    function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool);
}

/// @notice A single V3 pool.
interface IUniswapV3Pool {
    /**
     * @param amountSpecified Positive = exact input, negative = exact output.
     * @return amount0 Signed token0 delta for the caller (negative = paid).
     * @return amount1 Signed token1 delta for the caller (positive = received).
     */
    function swap(
        address recipient,
        bool zeroForOne,
        int256 amountSpecified,
        uint160 sqrtPriceLimitX96,
        bytes calldata data
    ) external returns (int256 amount0, int256 amount1);

    function token0() external view returns (address);
    function token1() external view returns (address);
    function fee() external view returns (uint24);
}

/// @notice Callback the pool invokes to collect the input token.
interface IUniswapV3SwapCallback {
    function uniswapV3SwapCallback(int256 amount0Delta, int256 amount1Delta, bytes calldata data) external;
}