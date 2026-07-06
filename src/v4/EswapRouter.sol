// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IPoolManager} from "./interfaces/IPoolManager.sol";
import {PoolKey} from "./types/PoolKey.sol";
import {Currency} from "./types/Currency.sol";
import {IERC20} from "../interfaces/IERC20.sol";

/**
 * @title EswapRouter
 * @notice Handles Uniswap V4 unlock flow, pulling margin from users and settling deltas.
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
        return manager.unlock(abi.encode(params, msg.sender));
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        require(msg.sender == address(manager), "Not manager");
        (SwapParams memory params, address trader) = abi.decode(data, (SwapParams, address));

        // 1. Execute the swap
        int128 delta = manager.swap(params.key, params.zeroForOne, params.amountSpecified, params.hookData);

        // 2. Settle the input currency (the trader's initial margin)
        Currency input = params.zeroForOne ? params.key.currency0 : params.key.currency1;

        // In Uniswap V4, the manager.swap return value for the specified currency is the delta.
        // A positive delta means the PM is owed tokens.
        if (delta > 0) {
            uint256 toSettle = uint256(int256(delta));
            // Pull tokens from trader and give to PoolManager
            IERC20(Currency.unwrap(input)).transferFrom(trader, address(manager), toSettle);
            manager.settle(input);
        }

        return abi.encode(delta);
    }
}
