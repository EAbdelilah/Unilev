// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {PoolKey} from "./types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "./types/PoolId.sol";

interface IEswapMarginHook {
    function registerSolverDebt(PoolId poolId, address trader, address solver, uint256 principal) external;
}

/**
 * @title EswapSolverAdapter
 * @notice CoW Swap / URC-4 Intent adapter enabling EIP-712 signed intent settlement & batch position opening.
 */
contract EswapSolverAdapter {
    using PoolIdLibrary for PoolKey;

    bytes32 public immutable DOMAIN_SEPARATOR;
    bytes32 public constant INTENT_TYPEHASH = keccak256(
        "MarginIntent(address trader,uint8 leverage,uint256 amount,uint256 nonce,uint256 deadline)"
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

    constructor(address _hook) {
        require(_hook != address(0), "Zero hook");
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
            abi.encode(
                INTENT_TYPEHASH,
                intent.trader,
                intent.leverage,
                intent.amount,
                intent.nonce,
                intent.deadline
            )
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

    function registerSolverDebt(PoolKey calldata key, address trader, address solver, uint256 principal) external {
        IEswapMarginHook(hook).registerSolverDebt(key.toId(), trader, solver, principal);
    }

    function batchOpenPositions(
        MarginIntent[] calldata intents,
        bytes[] calldata signatures
    ) external returns (uint256 count) {
        require(intents.length == signatures.length, "Length mismatch");
        for (uint256 i = 0; i < intents.length; i++) {
            // Inline the intent processing to avoid internal call issues
            MarginIntent calldata intent = intents[i];
            bytes calldata sig = signatures[i];
            if (block.timestamp > intent.deadline) revert DeadlineExpired();
            if (intent.nonce != nonces[intent.trader]) revert NonceInvalid();

            bytes32 structHash = keccak256(
                abi.encode(
                    INTENT_TYPEHASH,
                    intent.trader,
                    intent.leverage,
                    intent.amount,
                    intent.nonce,
                    intent.deadline
                )
            );
            bytes32 digest = keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash));
            address recovered = recover(digest, sig);
            if (recovered != intent.trader || recovered == address(0)) revert InvalidSignature();

            nonces[intent.trader]++;
            count++;
        }
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
