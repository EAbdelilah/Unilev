// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IHooks} from "./interfaces/IHooks.sol";
import {IPoolManager} from "./interfaces/IPoolManager.sol";
import {PoolKey} from "./types/PoolKey.sol";
import {PoolId} from "./types/PoolId.sol";
import {Currency} from "./types/Currency.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary} from "./types/BeforeSwapDelta.sol";
import {BalanceDelta} from "./types/BalanceDelta.sol";

abstract contract BaseHook is IHooks {
    IPoolManager public immutable manager;

    constructor(IPoolManager _manager) {
        manager = _manager;
    }

    function beforeInitialize(address, PoolKey calldata, uint160) external virtual returns (bytes4) {
        return IHooks.beforeInitialize.selector;
    }

    function afterInitialize(address, PoolKey calldata, uint160, int24) external virtual returns (bytes4) {
        return IHooks.afterInitialize.selector;
    }

    function beforeAddLiquidity(address, PoolKey calldata, uint128, bytes calldata) external virtual returns (bytes4) {
        return IHooks.beforeAddLiquidity.selector;
    }

    function afterAddLiquidity(address, PoolKey calldata, uint128, uint128, uint128, bytes calldata) external virtual returns (bytes4) {
        return IHooks.afterAddLiquidity.selector;
    }

    function beforeRemoveLiquidity(address, PoolKey calldata, uint128, bytes calldata) external virtual returns (bytes4) {
        return IHooks.beforeRemoveLiquidity.selector;
    }

    function afterRemoveLiquidity(address, PoolKey calldata, uint128, uint128, uint128, bytes calldata) external virtual returns (bytes4) {
        return IHooks.afterRemoveLiquidity.selector;
    }

    function beforeSwap(address, PoolKey calldata, IPoolManager.SwapParams calldata, bytes calldata) external virtual returns (bytes4, BeforeSwapDelta, uint24) {
        return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.toBeforeSwapDelta(0, 0), 0);
    }

    function afterSwap(address, PoolKey calldata, IPoolManager.SwapParams calldata, BalanceDelta, bytes calldata) external virtual returns (bytes4, int128) {
        return (IHooks.afterSwap.selector, 0);
    }

    function beforeDonate(address, PoolKey calldata, uint128, uint128, bytes calldata) external virtual returns (bytes4) {
        return IHooks.beforeDonate.selector;
    }

    function afterDonate(address, PoolKey calldata, uint128, uint128, bytes calldata) external virtual returns (bytes4) {
        return IHooks.afterDonate.selector;
    }
}
