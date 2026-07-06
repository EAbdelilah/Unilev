// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IPoolManager} from "./interfaces/IPoolManager.sol";
import {PoolKey} from "./types/PoolKey.sol";
import {Currency} from "./types/Currency.sol";

/**
 * @title EswapRouter
 * @notice Handles Uniswap V4 unlock flow to facilitate margin trading.
 */
contract EswapRouter {
    IPoolManager public immutable manager;

    constructor(IPoolManager _manager) {
        manager = _manager;
    }

    struct SwapParams {
        PoolKey key;
        bool zeroForOne;
        int128 amountSpecified;
        bytes hookData;
    }

    function swap(SwapParams calldata params) external returns (bytes memory) {
        return manager.unlock(abi.encode(params));
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        require(msg.sender == address(manager), "Not manager");
        SwapParams memory params = abi.decode(data, (SwapParams));

        // Execute the swap within the unlocked context
        int128 delta = manager.swap(params.key, params.zeroForOne, params.amountSpecified, params.hookData);

        // Settle the resulting deltas
        // 1. Settle the user's input margin
        manager.settle(params.zeroForOne ? params.key.currency0 : params.key.currency1);

        // 2. The hook handles 'take' of output tokens and 'modifyLiquidity' internally.
        // Any remaining positive deltas (e.g. if the hook borrowed less than swapped)
        // are settled by the router to keep the singleton balanced.

        return abi.encode(delta);
    }
}
