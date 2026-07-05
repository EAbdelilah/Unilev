// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

type BeforeSwapDelta is int256;

library BeforeSwapDeltaLibrary {
    function toBeforeSwapDelta(int128 delta0, int128 delta1) internal pure returns (BeforeSwapDelta delta) {
        assembly {
            delta := or(shl(128, delta0), and(0xffffffffffffffffffffffffffffffff, delta1))
        }
    }
}
