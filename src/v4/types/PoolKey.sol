// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Currency} from "./Currency.sol";

struct PoolKey {
    Currency currency0;
    Currency currency1;
    uint24 fee;
    int24 tickSpacing;
    address hooks;
}

library PoolIdLibrary {
    function toId(PoolKey memory key) internal pure returns (bytes32 id) {
        assembly {
            id := keccak256(key, 160)
        }
    }
}

type PoolId is bytes32;
using PoolIdLibrary for PoolKey global;
