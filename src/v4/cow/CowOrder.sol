// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title CowOrder
 * @notice Clean-room reimplementation of the CoW Protocol v2 order data model.
 *
 * @dev Byte-exact compatible with the CoW Protocol's GPv2Order library
 *      (Gnosis Protocol v2) so that orders signed for the canonical CoW Swap
 *      settlement contract verify and fill here without re-signing.
 *
 *      The structure mirrors `GPv2Order.Data` with the token fields typed as
 *      `address` (the hash depends only on the token addresses). All constants
 *      below reproduce the exact on-chain values used by CoW Protocol.
 *
 *      Reference (upstream semantics, LGPL-3.0-or-later source):
 *      https://github.com/cowprotocol/contracts/blob/main/src/contracts/libraries/GPv2Order.sol
 *      This file is an independent implementation that only reproduces the
 *      standardized constants and encodings; it does not copy upstream code.
 */
library CowOrder {
    /// @dev The complete signed data for a CoW Protocol order.
    struct Data {
        address sellToken;
        address buyToken;
        address receiver;
        uint256 sellAmount;
        uint256 buyAmount;
        uint32 validTo;
        bytes32 appData;
        uint256 feeAmount;
        bytes32 kind;
        bool partiallyFillable;
        bytes32 sellTokenBalance;
        bytes32 buyTokenBalance;
    }

    /// @dev EIP-712 type hash of the order struct:
    ///      keccak256("Order(address sellToken,address buyToken,address receiver,uint256 sellAmount,uint256 buyAmount,uint32 validTo,bytes32 appData,uint256 feeAmount,string kind,bool partiallyFillable,string sellTokenBalance,string buyTokenBalance)")
    bytes32 internal constant TYPE_HASH =
        hex"d5a25ba2e97094ad7d83dc28a6572da797d6b3e7fc6663bd93efb789fc17e489";

    /// @dev Order kind marker for a sell order: keccak256("sell").
    bytes32 internal constant KIND_SELL =
        hex"f3b277728b3fee749481eb3e0b3b48980dbbab78658fc419025cb16eee346775";

    /// @dev Order kind marker for a buy order: keccak256("buy").
    bytes32 internal constant KIND_BUY =
        hex"6ed88e868af0a1983e3886d5f3e95a2fafbd6c3450bc229e27342283dc429ccc";

    /// @dev Token balance marker using direct ERC20 balances: keccak256("erc20").
    bytes32 internal constant BALANCE_ERC20 =
        hex"5a28e9363bb942b639270062aa6bb295f434bcdfc42c97267bf003f272060dc9";

    /// @dev Token balance marker using external Balancer Vault balances: keccak256("external").
    bytes32 internal constant BALANCE_EXTERNAL =
        hex"abee3b73373acd583a130924aad6dc38cfdc44ba0555ba94ce2ff63980ea0632";

    /// @dev Token balance marker using internal Balancer Vault balances: keccak256("internal").
    bytes32 internal constant BALANCE_INTERNAL =
        hex"4ac99ace14ee0a5ef932dc609df0943ab7ac16b7583634612f8dc35a4289a6ce";

    /// @dev Marker address meaning "proceeds go to the order owner".
    address internal constant RECEIVER_SAME_AS_OWNER = address(0);

    /// @dev Byte length of an order unique identifier (digest ‖ owner ‖ validTo).
    uint256 internal constant UID_LENGTH = 56;

    /// @dev Resolve the actual receiver: `address(0)` means the order owner.
    function actualReceiver(Data memory order, address owner) internal pure returns (address receiver) {
        receiver = order.receiver == RECEIVER_SAME_AS_OWNER ? owner : order.receiver;
    }

    /// @dev Compute the EIP-712 signing digest for an order bound to
    ///      `domainSeparator` (the CoW Protocol settlement's domain separator).
    ///      Matches the signing digest wallets/libraries produce for CoW orders.
    function hash(Data memory order, bytes32 domainSeparator) internal pure returns (bytes32 orderDigest) {
        bytes32 structHash = keccak256(
            abi.encode(
                TYPE_HASH,
                order.sellToken,
                order.buyToken,
                order.receiver,
                order.sellAmount,
                order.buyAmount,
                order.validTo,
                order.appData,
                order.feeAmount,
                order.kind,
                order.partiallyFillable,
                order.sellTokenBalance,
                order.buyTokenBalance
            )
        );
        orderDigest = keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
    }

    /// @dev Pack an order UID: orderDigest ‖ owner ‖ validTo (56 bytes).
    function packOrderUidParams(bytes32 orderDigest, address owner, uint32 validTo)
        internal
        pure
        returns (bytes memory orderUid)
    {
        orderUid = abi.encodePacked(orderDigest, owner, validTo);
    }

    /// @dev Unpack a CoW order UID.
    function extractOrderUidParams(bytes calldata orderUid)
        internal
        pure
        returns (bytes32 orderDigest, address owner, uint32 validTo)
    {
        require(orderUid.length == UID_LENGTH, "Cow: invalid uid");
        assembly {
            orderDigest := calldataload(orderUid.offset)
            owner := shr(96, calldataload(add(orderUid.offset, 32)))
            validTo := shr(224, calldataload(add(orderUid.offset, 52)))
        }
    }
}