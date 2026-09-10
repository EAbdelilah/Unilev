// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title EswapSolverAdapter
 * @notice Bespoke EIP-712 intent adapter (NOT CoW Protocol / GPv2) enabling
 *         signed intent submission & batch position opening.
 *
 * @dev This contract uses its OWN EIP-712 domain and `MarginIntent`/`SpotIntent`
 *      type hashes, and the intent submit functions only validate signatures and
 *      bump nonces — they do not open positions or move funds. The former
 *      `batchOpenPositions` stub was REMOVED ([FIX M-1]): it never executed
 *      trades, yet read as if it did, so a signed intent could be consumed by a
 *      front-runner without the trader's position ever opening. For genuine CoW
 *      Swap compatibility see `EswapCoWSettlement` and the `cow/` library, which
 *      verify canonical CoW order digests (bound to the real GPv2Settlement).
 */
contract EswapSolverAdapter {

    bytes32 public immutable DOMAIN_SEPARATOR;
    bytes32 public constant INTENT_TYPEHASH =
        keccak256("MarginIntent(address trader,uint8 leverage,uint256 amount,uint256 nonce,uint256 deadline)");
    bytes32 public constant SPOT_INTENT_TYPEHASH = keccak256(
        "SpotIntent(address swapper,int256 amountSpecified,uint256 minAmountOut,uint256 nonce,uint256 deadline)"
    );

    mapping(address => uint256) public nonces;
    address public immutable hook;

    error InvalidSignature();
    error DeadlineExpired();
    error NonceInvalid();

    struct MarginIntent {
        address trader;
        uint8 leverage;
        uint256 amount;
        uint256 nonce;
        uint256 deadline;
    }

    struct SpotIntent {
        address swapper;
        int256 amountSpecified;
        uint256 minAmountOut;
        uint256 nonce;
        uint256 deadline;
    }

    constructor(address _hook) {
        hook = _hook;
        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes("EswapSolverAdapter")),
                keccak256(bytes("1")),
                block.chainid,
                address(this)
            )
        );
    }

    function verifyIntent(MarginIntent calldata intent, bytes calldata signature) public view returns (bool) {
        if (block.timestamp > intent.deadline) revert DeadlineExpired();
        if (intent.nonce != nonces[intent.trader]) revert NonceInvalid();

        bytes32 structHash = keccak256(
            abi.encode(INTENT_TYPEHASH, intent.trader, intent.leverage, intent.amount, intent.nonce, intent.deadline)
        );

        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash));
        address recovered = recover(digest, signature);
        if (recovered != intent.trader || recovered == address(0)) revert InvalidSignature();

        return true;
    }

    function submitIntent(MarginIntent calldata intent, bytes calldata signature) external returns (bool) {
        verifyIntent(intent, signature);
        nonces[intent.trader]++;
        return true;
    }

    function verifySpotIntent(SpotIntent calldata intent, bytes calldata signature) public view returns (bool) {
        if (block.timestamp > intent.deadline) revert DeadlineExpired();
        if (intent.nonce != nonces[intent.swapper]) revert NonceInvalid();

        bytes32 structHash = keccak256(
            abi.encode(
                SPOT_INTENT_TYPEHASH,
                intent.swapper,
                intent.amountSpecified,
                intent.minAmountOut,
                intent.nonce,
                intent.deadline
            )
        );

        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash));
        address recovered = recover(digest, signature);
        if (recovered != intent.swapper || recovered == address(0)) revert InvalidSignature();

        return true;
    }

    function submitSpotIntent(SpotIntent calldata intent, bytes calldata signature) external returns (bool) {
        verifySpotIntent(intent, signature);
        nonces[intent.swapper]++;
        return true;
    }

    function recover(bytes32 hash, bytes memory signature) internal pure returns (address) {
        if (signature.length != 65) return address(0);
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := mload(add(signature, 32))
            s := mload(add(signature, 64))
            v := byte(0, mload(add(signature, 96)))
        }
        if (v < 27) v += 27;
        if (v != 27 && v != 28) return address(0);
        return ecrecover(hash, v, r, s);
    }
}
