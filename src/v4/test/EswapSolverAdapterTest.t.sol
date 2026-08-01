// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BaseV4Test} from "./BaseV4Test.t.sol";
import {EswapSolverAdapter} from "../EswapSolverAdapter.sol";
import {PoolKey} from "../types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "../types/PoolId.sol";

contract EswapSolverAdapterTest is BaseV4Test {
    using PoolIdLibrary for PoolKey;
    EswapSolverAdapter public adapter;

    uint256 internal traderPrivateKey = 0xA11CE;
    address internal traderAddress;

    function setUp() public override {
        super.setUp();
        traderAddress = vm.addr(traderPrivateKey);
        adapter = new EswapSolverAdapter(address(hook));
        hook.setRouter(address(adapter));
    }

    function _signIntent(EswapSolverAdapter.MarginIntent memory intent) internal view returns (bytes memory) {
        bytes32 structHash = keccak256(
            abi.encode(
                adapter.INTENT_TYPEHASH(),
                intent.trader,
                intent.leverage,
                intent.amount,
                intent.nonce,
                intent.deadline
            )
        );

        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", adapter.DOMAIN_SEPARATOR(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(traderPrivateKey, digest);
        return abi.encodePacked(r, s, v);
    }

    function test_ValidSignature_SubmitsSuccessfully() public {
        EswapSolverAdapter.MarginIntent memory intent = EswapSolverAdapter.MarginIntent({
            trader: traderAddress,
            leverage: 3,
            amount: 1 ether,
            nonce: 0,
            deadline: block.timestamp + 1000
        });

        bytes memory sig = _signIntent(intent);
        bool success = adapter.submitIntent(intent, sig);
        assertTrue(success);
        assertEq(adapter.nonces(traderAddress), 1);
    }

    function test_InvalidSignature_Reverts() public {
        EswapSolverAdapter.MarginIntent memory intent = EswapSolverAdapter.MarginIntent({
            trader: traderAddress,
            leverage: 3,
            amount: 1 ether,
            nonce: 0,
            deadline: block.timestamp + 1000
        });

        bytes memory sig = new bytes(65); // Invalid sig (all zeros)
        vm.expectRevert();
        adapter.submitIntent(intent, sig);
    }

    function test_ExpiredDeadline_Reverts() public {
        EswapSolverAdapter.MarginIntent memory intent = EswapSolverAdapter.MarginIntent({
            trader: traderAddress,
            leverage: 3,
            amount: 1 ether,
            nonce: 0,
            deadline: block.timestamp - 1
        });

        bytes memory sig = _signIntent(intent);
        vm.expectRevert(EswapSolverAdapter.DeadlineExpired.selector);
        adapter.submitIntent(intent, sig);
    }

    function test_InvalidNonce_Reverts() public {
        EswapSolverAdapter.MarginIntent memory intent = EswapSolverAdapter.MarginIntent({
            trader: traderAddress,
            leverage: 3,
            amount: 1 ether,
            nonce: 99,
            deadline: block.timestamp + 1000
        });

        bytes memory sig = _signIntent(intent);
        vm.expectRevert(EswapSolverAdapter.NonceInvalid.selector);
        adapter.submitIntent(intent, sig);
    }

    function test_SolverDebt_RegisteredAtomically() public {
        address solver = address(0x5011);
        adapter.registerSolverDebt(key, traderAddress, solver, 10 ether);
        (address solverOut, uint256 principal,) = hook.solverDebts(key.toId(), traderAddress, solver);
        assertEq(solverOut, solver);
        assertEq(principal, 10 ether);
    }

    function test_BatchOpen_3Positions_AllMapped() public {
        EswapSolverAdapter.MarginIntent[] memory intents = new EswapSolverAdapter.MarginIntent[](3);
        bytes[] memory sigs = new bytes[](3);

        for (uint256 i = 0; i < 3; i++) {
            intents[i] = EswapSolverAdapter.MarginIntent({
                trader: traderAddress,
                leverage: 2,
                amount: 1 ether,
                nonce: i,
                deadline: block.timestamp + 1000
            });
            sigs[i] = _signIntent(intents[i]);
        }

        uint256 count = adapter.batchOpenPositions(intents, sigs);
        assertEq(count, 3);
        assertEq(adapter.nonces(traderAddress), 3);
    }
}
