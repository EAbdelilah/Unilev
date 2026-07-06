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

        // Settle the resulting deltas (simplified for the router)
        if (params.amountSpecified < 0) {
            // Settle input token
            manager.settle(params.zeroForOne ? params.key.currency0 : params.key.currency1);
        }

        return abi.encode(delta);
    }
}
