// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title HookFlags
 * @notice Flags required for Uniswap V4 Hook permissions.
 */
library HookFlags {
    uint160 public constant BEFORE_INITIALIZE_FLAG = 1 << 159;
    uint160 public constant AFTER_INITIALIZE_FLAG = 1 << 158;
    uint160 public constant BEFORE_SWAP_FLAG = 1 << 153;
    uint160 public constant AFTER_SWAP_FLAG = 1 << 152;
    uint160 public constant BEFORE_SWAP_RETURNS_DELTA_FLAG = 1 << 148;
}
