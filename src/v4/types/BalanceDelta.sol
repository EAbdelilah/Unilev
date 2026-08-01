// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

type BalanceDelta is int256;

using BalanceDeltaLibrary for BalanceDelta global;

library BalanceDeltaLibrary {
    function toBalanceDelta(int128 delta0, int128 delta1) internal pure returns (BalanceDelta delta) {
        assembly {
            delta := or(shl(128, delta0), and(0xffffffffffffffffffffffffffffffff, delta1))
        }
    }

    function amount0(BalanceDelta delta) internal pure returns (int128 _amount0) {
        assembly {
            _amount0 := sar(128, delta)
        }
    }

    function amount1(BalanceDelta delta) internal pure returns (int128 _amount1) {
        assembly {
            _amount1 := signextend(15, delta)
        }
    }
}
