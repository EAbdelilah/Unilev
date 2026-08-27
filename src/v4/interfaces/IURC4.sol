// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {PoolId} from "../types/PoolId.sol";
import {PoolKey} from "../types/PoolKey.sol";
import {Currency} from "../types/Currency.sol";

/**
 * @title IURC4: Active Liquidity Framework (IALFHook)
 * @notice Standardized interface for hooks to provide indicative quotes and solver-friendly routing.
 */
interface IURC4 {
    struct IndicativeQuote {
        bool liveness;
        int128 amountOut;
        uint160 sqrtPriceX96After;
        uint256 feeAmount;
    }

    /**
     * @notice Provides an indicative quote for a swap through the hook's custom accounting.
     */
    function getIndicativeQuote(PoolKey calldata key, bool zeroForOne, int128 amountSpecified, bytes calldata data)
        external
        view
        returns (IndicativeQuote memory quote);

    /**
     * @notice Allows solvers to compute the exact routing path by simulating a swap to a target price.
     */
    function swapToPrice(PoolKey calldata key, uint160 targetSqrtPriceX96, bytes calldata data)
        external
        returns (int128 delta0, int128 delta1);
}
