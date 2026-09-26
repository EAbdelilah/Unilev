// SPDX-License-Identifier: MIT
// Vendored from https://github.com/1inch/limit-order-protocol
//   contracts/interfaces/IOrderMixin.sol
//   contracts/interfaces/IPostInteraction.sol
//   contracts/libraries/MakerTraitsLib.sol
//   contracts/libraries/TakerTraitsLib.sol
// Only the Order struct, the user-defined value types and the two entrypoint
// signatures required by the Eswap settler are reproduced. Field order and
// types are byte-identical to upstream, so the EIP-712 struct hash matches.
pragma solidity ^0.8.0;

type MakerTraits is uint256;
type TakerTraits is uint256;

interface IOrderMixin {
    struct Order {
        uint256 salt;
        address maker;
        address receiver;
        address makerAsset;
        address takerAsset;
        uint256 makingAmount;
        uint256 takingAmount;
        MakerTraits makerTraits;
    }

    function fillOrder(
        Order calldata order,
        bytes32 r,
        bytes32 vs,
        uint256 amount,
        TakerTraits takerTraits
    ) external payable returns (uint256 makingAmount, uint256 takingAmount, bytes32 orderHash);

    function fillOrderArgs(
        Order calldata order,
        bytes32 r,
        bytes32 vs,
        uint256 amount,
        TakerTraits takerTraits,
        bytes calldata args
    ) external payable returns (uint256 makingAmount, uint256 takingAmount, bytes32 orderHash);

    function hashOrder(IOrderMixin.Order calldata order) external view returns (bytes32 orderHash);
}

interface IPostInteraction {
    function postInteraction(
        IOrderMixin.Order calldata order,
        bytes calldata extension,
        bytes32 orderHash,
        address taker,
        uint256 makingAmount,
        uint256 takingAmount,
        uint256 remainingMakingAmount,
        bytes calldata extraData
    ) external;
}

/**
 * @dev Verbatim bit layout of upstream TakerTraitsLib, needed to build the
 *      `args` blob that IOrderMixin._parseArgs consumes. `_parseArgs` slices
 *      args in this exact order: [target:20 if argsHasTarget]
 *      [extension:argsExtensionLength] [interaction:argsInteractionLength].
 */
library TakerTraitsLib {
    uint256 private constant _ARGS_HAS_TARGET = 1 << 251;
    uint256 private constant _ARGS_EXTENSION_LENGTH_OFFSET = 224;
    uint256 private constant _ARGS_EXTENSION_LENGTH_MASK = 0xffffff;
    uint256 private constant _ARGS_INTERACTION_LENGTH_OFFSET = 200;
    uint256 private constant _ARGS_INTERACTION_LENGTH_MASK = 0xffffff;

    function argsHasTarget(TakerTraits takerTraits) internal pure returns (bool) {
        return (TakerTraits.unwrap(takerTraits) & _ARGS_HAS_TARGET) != 0;
    }

    function argsExtensionLength(TakerTraits takerTraits) internal pure returns (uint256) {
        return (TakerTraits.unwrap(takerTraits) >> _ARGS_EXTENSION_LENGTH_OFFSET) & _ARGS_EXTENSION_LENGTH_MASK;
    }

    function argsInteractionLength(TakerTraits takerTraits) internal pure returns (uint256) {
        return (TakerTraits.unwrap(takerTraits) >> _ARGS_INTERACTION_LENGTH_OFFSET) & _ARGS_INTERACTION_LENGTH_MASK;
    }
}
