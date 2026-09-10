// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @dev ERC-1271 isValidSignature magic value: bytes4(keccak256("isValidSignature(bytes32,bytes)")).
library CowEIP1271 {
    bytes4 internal constant MAGICVALUE = 0x1626ba7e;
}

/// @notice EIP-1271 signature verifier interface (identical semantics to the
///         EIP-1271 standard as used by CoW Protocol).
interface EIP1271Verifier {
    function isValidSignature(bytes32 hash, bytes calldata signature) external view returns (bytes4 magicValue);
}