// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BaseV4Test} from "./BaseV4Test.t.sol";
import {EswapSolverAdapter} from "../EswapSolverAdapter.sol";
import {PoolKey} from "../types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "../types/PoolId.sol";
import {IPoolManager} from "../interfaces/IPoolManager.sol";
import {BalanceDeltaLibrary} from "../types/BalanceDelta.sol";

contract EswapSolverAdapterTest is BaseV4Test {
    using PoolIdLibrary for PoolKey;
    EswapSolverAdapter public adapter;

    uint256 internal traderPrivateKey = 0xA11CE;
    address internal traderAddress;

    function setUp() public override {
        super.setUp();
        traderAddress = vm.addr(traderPrivateKey);
        adapter = new EswapSolverAdapter(address(hook));
        hook.setRouterAndMinCollateralUsd(address(adapter), 0);
    }

    function _signIntent(EswapSolverAdapter.MarginIntent memory intent) internal view returns (bytes memory) {
        bytes32 structHash = keccak256(
            abi.encode(
                adapter.INTENT_TYPEHASH(), intent.trader, intent.leverage, intent.amount, intent.nonce, intent.deadline
            )
        );

        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", adapter.DOMAIN_SEPARATOR(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(traderPrivateKey, digest);
        return abi.encodePacked(r, s, v);
    }

    function test_ValidSignature_SubmitsSuccessfully() public {
        EswapSolverAdapter.MarginIntent memory intent = EswapSolverAdapter.MarginIntent({
            trader: traderAddress, leverage: 3, amount: 1 ether, nonce: 0, deadline: block.timestamp + 1000
        });

        bytes memory sig = _signIntent(intent);
        bool success = adapter.submitIntent(intent, sig);
        assertTrue(success);
        assertEq(adapter.nonces(traderAddress), 1);
    }

    function test_InvalidSignature_Reverts() public {
        EswapSolverAdapter.MarginIntent memory intent = EswapSolverAdapter.MarginIntent({
            trader: traderAddress, leverage: 3, amount: 1 ether, nonce: 0, deadline: block.timestamp + 1000
        });

        bytes memory sig = new bytes(65); // Invalid sig (all zeros)
        vm.expectRevert();
        adapter.submitIntent(intent, sig);
    }

    function test_ExpiredDeadline_Reverts() public {
        EswapSolverAdapter.MarginIntent memory intent = EswapSolverAdapter.MarginIntent({
            trader: traderAddress, leverage: 3, amount: 1 ether, nonce: 0, deadline: block.timestamp - 1
        });

        bytes memory sig = _signIntent(intent);
        vm.expectRevert(EswapSolverAdapter.DeadlineExpired.selector);
        adapter.submitIntent(intent, sig);
    }

    function test_InvalidNonce_Reverts() public {
        EswapSolverAdapter.MarginIntent memory intent = EswapSolverAdapter.MarginIntent({
            trader: traderAddress, leverage: 3, amount: 1 ether, nonce: 99, deadline: block.timestamp + 1000
        });

        bytes memory sig = _signIntent(intent);
        vm.expectRevert(EswapSolverAdapter.NonceInvalid.selector);
        adapter.submitIntent(intent, sig);
    }

    function test_SolverDebt_RegisteredAtomically() public {
        // Must open a position first so borrowedAmount > 0 (M-7 fix requires principal <= borrowedAmount)
        bytes memory data = abi.encode(true, uint8(3), traderAddress);
        vm.prank(address(manager));
        hook.beforeSwap(traderAddress, key, IPoolManager.SwapParams(true, -1 ether, 0), data);
        vm.prank(address(manager));
        hook.afterSwap(
            traderAddress,
            key,
            IPoolManager.SwapParams(true, -3 ether, 0),
            BalanceDeltaLibrary.toBalanceDelta(-3 ether, 2.88 ether),
            data
        );
        manager.mint(address(hook), uint256(uint160(address(token1))), 2.88 ether);

        address solver = address(0x5011);
        // The adapter is the configured router here, but the sole authorized
        // path is the hook's own onlyRouter[] registerSolverDebt (the adapter's
        // unauthenticated public forwarder was removed, [FIX M-5]).
        vm.prank(address(adapter));
        hook.registerSolverDebt(key.toId(), traderAddress, solver, 2 ether);
        (address solverOut, uint256 principal,) = hook.solverDebts(key.toId(), traderAddress, solver);
        assertEq(solverOut, solver);
        assertEq(principal, 2 ether);
    }

    function _signSpotIntent(EswapSolverAdapter.SpotIntent memory intent) internal view returns (bytes memory) {
        bytes32 structHash = keccak256(
            abi.encode(
                adapter.SPOT_INTENT_TYPEHASH(),
                intent.swapper,
                intent.amountSpecified,
                intent.minAmountOut,
                intent.nonce,
                intent.deadline
            )
        );

        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", adapter.DOMAIN_SEPARATOR(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(traderPrivateKey, digest);
        return abi.encodePacked(r, s, v);
    }

    function test_SpotIntent_SubmitsSuccessfully() public {
        EswapSolverAdapter.SpotIntent memory intent = EswapSolverAdapter.SpotIntent({
            swapper: traderAddress,
            amountSpecified: -1 ether,
            minAmountOut: 3000 ether,
            nonce: 0,
            deadline: block.timestamp + 1000
        });

        bytes memory sig = _signSpotIntent(intent);
        bool success = adapter.submitSpotIntent(intent, sig);
        assertTrue(success);
        assertEq(adapter.nonces(traderAddress), 1);
    }
}
