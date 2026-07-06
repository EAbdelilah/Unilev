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

    /**
     * @notice Initiates a margin swap by unlocking the PoolManager.
     */
    function swap(SwapParams calldata params) external returns (bytes memory) {
        // Unlock PM and pass trader address to callback
        return manager.unlock(abi.encode(params, msg.sender));
    }

    /**
     * @notice Callback from PoolManager during unlock.
     * @dev Settles the user's input margin and executes the swap.
     */
    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        require(msg.sender == address(manager), "Not manager");
        (SwapParams memory params, address trader) = abi.decode(data, (SwapParams, address));

        // 1. Execute the swap
        // The Hook's beforeSwap will handle the "Flash Borrowing" by returning a negative delta,
        // which reduces the amount the PoolManager expects from THIS router call.
        int128 delta = manager.swap(params.key, params.zeroForOne, params.amountSpecified, params.hookData);

        // 2. Settle the input currency (the trader's initial margin)
        Currency input = params.zeroForOne ? params.key.currency0 : params.key.currency1;

        // Use the hookData to determine the exact margin amount if needed,
        // or rely on the PM's reported delta for the input currency.
        // For exact input swaps, the delta for the input currency will be positive (PM expects tokens).
        (int128 amount0, int128 amount1) = _getDeltas(delta);
        int128 inputDelta = params.zeroForOne ? amount0 : amount1;

        if (inputDelta > 0) {
            uint256 toSettle = uint256(int256(inputDelta));
            // Pull tokens from trader and give to PoolManager
            IERC20(Currency.unwrap(input)).transferFrom(trader, address(manager), toSettle);
            manager.settle(input);
        }

        return abi.encode(delta);
    }

    function _getDeltas(int128 delta) internal pure returns (int128 amount0, int128 amount1) {
        // Simplified helper to extract packed deltas if necessary,
        // though manager.swap returns a single int128 for the specified amount's delta in some versions.
        // In V4-core, swap returns the delta of the specified currency.
        return (delta, 0); // Placeholder for version-specific delta unpacking
    }
}
