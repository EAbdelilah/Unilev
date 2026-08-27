// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {EswapMarginHook} from "../EswapMarginHook.sol";
import {EswapTimelock} from "../EswapTimelock.sol";
import {PriceFeedMock} from "./BaseV4Test.t.sol";
import {PoolKey} from "../types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "../types/PoolId.sol";
import {Currency} from "../types/Currency.sol";
import {IPoolManager} from "../interfaces/IPoolManager.sol";
import {PoolManagerMock} from "./mocks/PoolManagerMock.sol";
import {ERC20Mock} from "./BaseV4Test.t.sol";

contract EswapTimelockTest is Test {
    using PoolIdLibrary for PoolKey;

    EswapMarginHook public hook;
    EswapTimelock public timelock;
    PoolManagerMock public manager;
    PriceFeedMock public priceFeed;
    PoolKey public key;

    address public admin = makeAddr("admin");
    address public stranger = makeAddr("stranger");

    uint256 constant DELAY = 24 hours;

    function setUp() public {
        manager = new PoolManagerMock();
        priceFeed = new PriceFeedMock();

        address hookAddress = address(uint160((1 << 159) | (1 << 158) | (1 << 153) | (1 << 152) | (1 << 148)));
        deployCodeTo("EswapMarginHook.sol:EswapMarginHook", abi.encode(manager, priceFeed, address(this)), hookAddress);
        hook = EswapMarginHook(payable(hookAddress));

        timelock = new EswapTimelock(address(hook), admin, DELAY);

        // Transfer hook ownership to timelock
        hook.transferOwnership(address(timelock));

        ERC20Mock token0 = new ERC20Mock("T0", "T0");
        ERC20Mock token1 = new ERC20Mock("T1", "T1");
        key = PoolKey({
            currency0: Currency.wrap(address(token0)),
            currency1: Currency.wrap(address(token1)),
            fee: 3000,
            tickSpacing: 60,
            hooks: address(hook)
        });
    }

    // ─── Emergency Pause (No Delay) ─────────────────────────────────────

    function test_EmergencyPause_Instant() public {
        vm.prank(admin);
        timelock.emergencyPause(true);
        assertTrue(hook.emergencyPaused());
    }

    function test_EmergencyPause_Unpause() public {
        vm.prank(admin);
        timelock.emergencyPause(true);
        assertTrue(hook.emergencyPaused());

        vm.prank(admin);
        timelock.emergencyPause(false);
        assertFalse(hook.emergencyPaused());
    }

    function test_EmergencyPause_OnlyAdmin() public {
        vm.prank(stranger);
        vm.expectRevert(EswapTimelock.NotAdmin.selector);
        timelock.emergencyPause(true);
    }

    // ─── Queue + Execute ────────────────────────────────────────────────

    function test_QueueAndExecute() public {
        bytes memory data = abi.encodeWithSignature("setEmergencyPause(bool)", true);
        uint256 eta = block.timestamp + DELAY;

        vm.prank(admin);
        timelock.queue(address(hook), data, eta);

        bytes32 txHash = timelock.getTxHash(address(hook), data, eta);
        assertTrue(timelock.isQueued(txHash));

        // Cannot execute before delay
        vm.expectRevert(EswapTimelock.NotReady.selector);
        timelock.execute(address(hook), data, eta);

        // Warp past delay
        vm.warp(block.timestamp + DELAY);
        timelock.execute(address(hook), data, eta);
        assertTrue(hook.emergencyPaused());

        // Tx hash is cleared after execution
        assertFalse(timelock.isQueued(txHash));
    }

    function test_Queue_OnlyAdmin() public {
        bytes memory data = abi.encodeWithSignature("setEmergencyPause(bool)", true);
        uint256 eta = block.timestamp + DELAY;

        vm.prank(stranger);
        vm.expectRevert(EswapTimelock.NotAdmin.selector);
        timelock.queue(address(hook), data, eta);
    }

    function test_Queue_DuplicateReverts() public {
        bytes memory data = abi.encodeWithSignature("setEmergencyPause(bool)", true);
        uint256 eta = block.timestamp + DELAY;

        vm.prank(admin);
        timelock.queue(address(hook), data, eta);

        vm.prank(admin);
        vm.expectRevert(EswapTimelock.TransactionAlreadyQueued.selector);
        timelock.queue(address(hook), data, eta);
    }

    function test_Queue_EtaTooSoon() public {
        bytes memory data = abi.encodeWithSignature("setEmergencyPause(bool)", true);
        uint256 eta = block.timestamp; // must be in the future

        vm.prank(admin);
        vm.expectRevert(EswapTimelock.TransactionTooFresh.selector);
        timelock.queue(address(hook), data, eta);
    }

    // ─── Cancel ─────────────────────────────────────────────────────────

    function test_Cancel() public {
        bytes memory data = abi.encodeWithSignature("setEmergencyPause(bool)", true);
        uint256 eta = block.timestamp + DELAY;

        vm.prank(admin);
        timelock.queue(address(hook), data, eta);

        bytes32 txHash = timelock.getTxHash(address(hook), data, eta);
        assertTrue(timelock.isQueued(txHash));

        vm.prank(admin);
        timelock.cancel(address(hook), data, eta);
        assertFalse(timelock.isQueued(txHash));

        // Cannot execute cancelled tx
        vm.warp(block.timestamp + DELAY);
        vm.expectRevert(EswapTimelock.TransactionNotQueued.selector);
        timelock.execute(address(hook), data, eta);
    }

    function test_Cancel_OnlyAdmin() public {
        bytes memory data = abi.encodeWithSignature("setEmergencyPause(bool)", true);
        uint256 eta = block.timestamp + DELAY;

        vm.prank(admin);
        timelock.queue(address(hook), data, eta);

        vm.prank(stranger);
        vm.expectRevert(EswapTimelock.NotAdmin.selector);
        timelock.cancel(address(hook), data, eta);
    }

    // ─── Full Flow: Timelock-Protected setAuthorizedPool ────────────────

    function test_Timelock_ProtectsSetAuthorizedPool() public {
        PoolKey memory newKey =
            PoolKey({currency0: key.currency0, currency1: key.currency1, fee: 500, tickSpacing: 60, hooks: address(0)});

        bytes memory data = abi.encodeWithSignature("setAuthorizedPool(bytes32,bool)", newKey.toId(), true);
        uint256 eta = block.timestamp + DELAY;

        // Queue the operation
        vm.prank(admin);
        timelock.queue(address(hook), data, eta);

        // Immediately after queue: not yet effective
        assertFalse(hook.isAuthorizedPool(newKey.toId()));

        // Execute after delay
        vm.warp(block.timestamp + DELAY);
        timelock.execute(address(hook), data, eta);

        assertTrue(hook.isAuthorizedPool(newKey.toId()));
    }
}
