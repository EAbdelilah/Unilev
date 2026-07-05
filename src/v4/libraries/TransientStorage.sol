// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

library TransientStorage {
    function tstore(bytes32 slot, bytes32 value) internal {
        assembly {
            tstore(slot, value)
        }
    }

    function tload(bytes32 slot) internal view returns (bytes32 value) {
        assembly {
            value := tload(slot)
        }
    }

    function tstore(bytes32 slot, uint256 value) internal {
        tstore(slot, bytes32(value));
    }

    function tloadUint(bytes32 slot) internal view returns (uint256) {
        return uint256(tload(slot));
    }
}
