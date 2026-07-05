// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {PoolKey} from "../types/PoolKey.sol";

interface IURC4 {
    struct IndicativeQuote {
        bool liveness;
        int128 amountOut;
        uint256 gasEstimate;
    }

    function getIndicativeQuote(
        PoolKey calldata key,
        bool zeroForOne,
        int128 amountSpecified,
        bytes calldata hookData
    ) external view returns (IndicativeQuote memory quote);

    function swapToPrice(
        PoolKey calldata key,
        uint160 targetSqrtPriceX96,
        bytes calldata hookData
    ) external returns (int128 amount0, int128 amount1);
}
