// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {PoolId} from "../types/PoolId.sol";

/**
 * @title IURC2: HookSwap Events
 * @notice Standardized event reporting for custom-accounting hooks.
 */
interface IURC2 {
    /**
     * @notice Emitted when a hook-facilitated swap occurs.
     * @param poolId The ID of the pool.
     * @param sender The address that triggered the swap.
     * @param amount0 The delta of token0.
     * @param amount1 The delta of token1.
     * @param hookFee The fee collected by the hook.
     */
    event HookSwap(PoolId indexed poolId, address indexed sender, int128 amount0, int128 amount1, uint256 hookFee);
}
