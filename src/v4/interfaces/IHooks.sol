// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {PoolKey} from "../types/PoolKey.sol";
import {IPoolManager} from "./IPoolManager.sol";
import {BeforeSwapDelta} from "../types/BeforeSwapDelta.sol";
import {BalanceDelta} from "../types/BalanceDelta.sol";

interface IHooks {
    function beforeInitialize(address sender, PoolKey calldata key, uint160 sqrtPriceX96) external returns (bytes4);
    function afterInitialize(address sender, PoolKey calldata key, uint160 sqrtPriceX96, int24 tick) external returns (bytes4);
    function beforeAddLiquidity(address sender, PoolKey calldata key, uint128 liquidity, bytes calldata data) external returns (bytes4);
    function afterAddLiquidity(address sender, PoolKey calldata key, uint128 liquidity, uint128 amount0, uint128 amount1, bytes calldata data) external returns (bytes4);
    function beforeRemoveLiquidity(address sender, PoolKey calldata key, uint128 liquidity, bytes calldata data) external returns (bytes4);
    function afterRemoveLiquidity(address sender, PoolKey calldata key, uint128 liquidity, uint128 amount0, uint128 amount1, bytes calldata data) external returns (bytes4);
    function beforeSwap(address sender, PoolKey calldata key, IPoolManager.SwapParams calldata params, bytes calldata data) external returns (bytes4, BeforeSwapDelta, uint24);
    function afterSwap(address sender, PoolKey calldata key, IPoolManager.SwapParams calldata params, BalanceDelta delta, bytes calldata data) external returns (bytes4, int128);
    function beforeDonate(address sender, PoolKey calldata key, uint128 amount0, uint128 amount1, bytes calldata data) external returns (bytes4);
    function afterDonate(address sender, PoolKey calldata key, uint128 amount0, uint128 amount1, bytes calldata data) external returns (bytes4);
}
