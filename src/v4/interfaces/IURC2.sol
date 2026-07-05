// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {PoolId} from "../types/PoolId.sol";

interface IURC2 {
    event HookSwap(
        PoolId indexed id,
        address indexed sender,
        int128 amount0,
        int128 amount1,
        uint24 swapFee
    );
}
