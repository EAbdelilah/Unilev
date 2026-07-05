// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {PoolKey} from "../types/PoolKey.sol";
import {BeforeSwapDelta} from "../types/BeforeSwapDelta.sol";

interface IHooks {
    function beforeInitialize(address sender, PoolKey calldata key, uint160 sqrtPriceX96) external returns (bytes4);
    function afterInitialize(address sender, PoolKey calldata key, uint160 sqrtPriceX96, int24 tick) external returns (bytes4);
    function beforeAddLiquidity(address sender, PoolKey calldata key, uint128 liquidity, bytes calldata data) external returns (bytes4);
    function afterAddLiquidity(address sender, PoolKey calldata key, uint128 liquidity, uint128 amount0, uint128 amount1, bytes calldata data) external returns (bytes4);
    function beforeRemoveLiquidity(address sender, PoolKey calldata key, uint128 liquidity, bytes calldata data) external returns (bytes4);
    function afterRemoveLiquidity(address sender, PoolKey calldata key, uint128 liquidity, uint128 amount0, uint128 amount1, bytes calldata data) external returns (bytes4);
    function beforeSwap(address sender, PoolKey calldata key, bool zeroForOne, int128 amountSpecified, bytes calldata data) external returns (bytes4, BeforeSwapDelta, uint24);
    function afterSwap(address sender, PoolKey calldata key, bool zeroForOne, int128 amountSpecified, int128 amount0, int128 amount1, bytes calldata data) external returns (bytes4, int128);
    function beforeDonate(address sender, PoolKey calldata key, uint128 amount0, uint128 amount1, bytes calldata data) external returns (bytes4);
    function afterDonate(address sender, PoolKey calldata key, uint128 amount0, uint128 amount1, bytes calldata data) external returns (bytes4);
}
