// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {CowOrder} from "./CowOrder.sol";
import {CowEIP1271, EIP1271Verifier} from "./CowEIP1271.sol";

/**
 * @title CowSigning
 * @notice Clean-room reimplementation of the CoW Protocol v2 order signing and
 *         signature verification layer.
 *
 * @dev Signature schemes, domains and verification semantics exactly match the
 *      canonical CoW Protocol `GPv2Signing` mixin so orders signed for a real
 *      CoW Swap settlement contract verify on-chain identically:
 *        - EIP-712 typed-data signatures over the "Gnosis Protocol"/"v2" domain
 *        - eth_sign (EIP-191) signatures over the order digest
 *        - EIP-1271 contract signatures (owner address ‖ inner signature)
 *        - Pre-signatures keyed by the 56-byte order UID
 *
 *      Reference (upstream semantics, LGPL-3.0-or-later source):
 *      https://github.com/cowprotocol/contracts/blob/main/src/contracts/mixins/GPv2Signing.sol
 *      This file is an independent implementation that only reproduces the
 *      standardized constants and encodings; it does not copy upstream code.
 *
 * @dev IMPORTANT: the verifying contract for the EIP-712 domain is set to the
 *      CoW Protocol settlement contract, NOT this contract, so that trader
 *      signatures produced for the canonical CoW order book verify here.
 */
abstract contract CowSigning {
    /// @dev Signing scheme used for signature recovery.
    enum Scheme {
        Eip712,
        EthSign,
        Eip1271,
        PreSign
    }

    /// @dev EIP-712 domain type hash: EIP712Domain(...).
    bytes32 private constant DOMAIN_TYPE_HASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");

    /// @dev EIP-712 domain name of the CoW order book.
    bytes32 private constant DOMAIN_NAME = keccak256("Gnosis Protocol");

    /// @dev EIP-712 domain version of the CoW order book.
    bytes32 private constant DOMAIN_VERSION = keccak256("v2");

    /// @dev Marker value indicating an order is pre-signed.
    uint256 private constant PRE_SIGNED = uint256(keccak256("GPv2Signing.Scheme.PreSign"));

    /// @dev The EIP-712 domain separator mixed into every order digest. Computed
    ///      over the canonical CoW settlement address it binds every recovered
    ///      signature to that specific settlement deployment.
    bytes32 public immutable domainSeparator;

    /// @dev Storage flagging that an order UID has been pre-signed by its owner.
    mapping(bytes => uint256) public preSignature;

    /// @dev Emitted when an account pre-signs or revokes an order UID.
    event PreSignature(address indexed owner, bytes orderUid, bool signed);

    /// @param verifyingContract The canonical CoW Protocol settlement contract
    ///        address whose signed orders this contract is compatible with.
    constructor(address verifyingContract) {
        domainSeparator = keccak256(
            abi.encode(DOMAIN_TYPE_HASH, DOMAIN_NAME, DOMAIN_VERSION, block.chainid, verifyingContract)
        );
    }

    /// @dev Pre-sign (or revoke) an order UID. Only the owner named in the UID
    ///      may pre-sign. Mirrors CoW Protocol's `setPreSignature`.
    function setPreSignature(bytes calldata orderUid, bool signed) external {
        (, address owner, ) = CowOrder.extractOrderUidParams(orderUid);
        require(owner == msg.sender, "Cow: cannot presign order");
        preSignature[orderUid] = signed ? PRE_SIGNED : 0;
        emit PreSignature(owner, orderUid, signed);
    }

    /// @dev Recover the order owner from the supplied signature for the given
    ///      scheme. Returns the EIP-712 digest and the recovered owner.
    function recoverOrderSigner(CowOrder.Data memory order, Scheme signingScheme, bytes memory signature)
        internal
        view
        returns (bytes32 orderDigest, address owner)
    {
        orderDigest = CowOrder.hash(order, domainSeparator);
        if (signingScheme == Scheme.Eip712) {
            owner = recoverEip712Signer(orderDigest, signature);
        } else if (signingScheme == Scheme.EthSign) {
            owner = recoverEthsignSigner(orderDigest, signature);
        } else if (signingScheme == Scheme.Eip1271) {
            owner = recoverEip1271Signer(orderDigest, signature);
        } else {
            owner = recoverPreSigner(orderDigest, signature, order.validTo);
        }
    }

    /// @dev ECDSA recovery from a tightly-packed 65-byte `(r, s, v)` signature.
    function ecdsaRecover(bytes32 message, bytes memory encodedSignature) internal pure returns (address signer) {
        require(encodedSignature.length == 65, "Cow: malformed ecdsa signature");

        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            // bytes memory layout: data starts at offset 32.
            r := mload(add(encodedSignature, 32))
            s := mload(add(encodedSignature, 64))
            v := byte(0, mload(add(encodedSignature, 96)))
        }

        signer = ecrecover(message, v, r, s);
        require(signer != address(0), "Cow: invalid ecdsa signature");
    }

    /// @dev EIP-712 signature: plain 65-byte ECDSA over the order digest.
    function recoverEip712Signer(bytes32 orderDigest, bytes memory encodedSignature)
        internal
        pure
        returns (address owner)
    {
        owner = ecdsaRecover(orderDigest, encodedSignature);
    }

    /// @dev eth_sign (EIP-191 personal message) signature over the digest:
    ///      keccak256("\x19Ethereum Signed Message:\n32" ‖ orderDigest).
    function recoverEthsignSigner(bytes32 orderDigest, bytes memory encodedSignature)
        internal
        pure
        returns (address owner)
    {
        bytes32 ethsignDigest = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", orderDigest));
        owner = ecdsaRecover(ethsignDigest, encodedSignature);
    }

    /// @dev EIP-1271 contract signature: `abi.encodePacked(owner, innerSignature)`.
    function recoverEip1271Signer(bytes32 orderDigest, bytes memory encodedSignature)
        internal
        view
        returns (address owner)
    {
        require(encodedSignature.length >= 20, "Cow: malformed eip1271 signature");
        assembly {
            owner := shr(96, mload(add(encodedSignature, 32)))
        }

        bytes memory signature = new bytes(encodedSignature.length - 20);
        for (uint256 i = 0; i < signature.length; i++) {
            signature[i] = encodedSignature[i + 20];
        }
        require(
            EIP1271Verifier(owner).isValidSignature(orderDigest, signature) == CowEIP1271.MAGICVALUE,
            "Cow: invalid eip1271 signature"
        );
    }

    /// @dev Pre-sign signature: the 20-byte order owner address; requires
    ///      `preSignature[uid] == PRE_SIGNED`.
    function recoverPreSigner(bytes32 orderDigest, bytes memory encodedSignature, uint32 validTo)
        internal
        view
        returns (address owner)
    {
        require(encodedSignature.length == 20, "Cow: malformed presignature");
        assembly {
            owner := shr(96, mload(add(encodedSignature, 32)))
        }

        bytes memory orderUid = abi.encodePacked(orderDigest, owner, validTo);
        require(preSignature[orderUid] == PRE_SIGNED, "Cow: order not presigned");
    }
}