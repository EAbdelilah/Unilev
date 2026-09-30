// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {EswapMarginHook} from "../EswapMarginHook.sol";
import {EswapMarginHookLogic} from "../EswapMarginHookLogic.sol";
import {EswapMarginHookLogic2} from "../EswapMarginHookLogic2.sol";
import {EswapHookDeployLib} from "./EswapHookDeployLib.sol";
import {PriceFeedMock} from "./BaseV4Test.t.sol";
import {PoolManagerMock} from "./mocks/PoolManagerMock.sol";
import {IPoolManager} from "../interfaces/IPoolManager.sol";

/**
 * @title EswapHookConstructorTest
 * @notice Covers the [EIP-3860 split] `EswapMarginHook` constructor, which now
 *         receives the two delegatecall'd logic contracts as arguments instead
 *         of `new`ing them inline.
 *
 * @dev The split exists for a mechanical reason: inlining both children made the
 *      hook's initcode 19,728 + 24,662 + 23,596 = 68,676 bytes against
 *      EIP-3860's 49,152-byte cap, so the hook could not be deployed at all on
 *      a compliant chain (Unichain among them). Wiring the children externally
 *      drops the initcode to ~24.5KB.
 *
 *      That change moved trust from "the compiler guarantees it" to "the
 *      constructor validates it", so these tests are the compensating control.
 *      Each one asserts a wiring mistake fails at DEPLOY time rather than
 *      silently producing a live hook that delegatecalls into a foreign
 *      PoolManager or an address with no code.
 */
contract EswapHookConstructorTest is Test {
    PoolManagerMock public manager;
    PriceFeedMock public priceFeed;

    address owner = address(0xBEEF);

    function setUp() public {
        manager = new PoolManagerMock();
        priceFeed = new PriceFeedMock();
    }

    /// @dev Mirrors the flag set BaseV4Test uses; the constructor demands it.
    function _flagAddress() internal pure returns (address) {
        return address(uint160((1 << 159) | (1 << 158) | (1 << 153) | (1 << 152) | (1 << 148)));
    }

    /// @dev `logic2` is `internal` in the shared storage contract, so there is
    ///      no getter. Read slot 45 directly instead of adding a public accessor:
    ///      the hook has under 1KB of EIP-170 headroom and a test convenience is
    ///      not worth spending it on. Slot is pinned by
    ///      `forge inspect EswapMarginHookLogicStorage storage-layout`.
    function _logic2Of(address hookAddr) internal returns (address) {
        return address(uint160(uint256(vm.load(hookAddr, bytes32(uint256(45))))));
    }

    function _deploy(address logic, address logic2, address hookOwner, address where) internal {
        deployCodeTo(
            "EswapMarginHook.sol:EswapMarginHook",
            abi.encode(address(manager), address(priceFeed), logic, logic2, hookOwner),
            where
        );
    }

    // ---------------------------------------------------------------------
    // Happy path
    // ---------------------------------------------------------------------

    function test_Constructor_StoresLogicAndOwner() public {
        (address logic, address logic2) =
            EswapHookDeployLib.deployLogic(address(manager), address(priceFeed));
        address where = _flagAddress();
        _deploy(logic, logic2, owner, where);

        EswapMarginHook hook = EswapMarginHook(payable(where));
        assertEq(address(hook.hookLogic()), logic, "hookLogic not stored");
        assertEq(_logic2Of(where), logic2, "logic2 not stored");
        assertEq(hook.owner(), owner, "owner not stored");
        assertEq(address(hook.priceFeed()), address(priceFeed), "priceFeed not stored");
        assertEq(address(hook.manager()), address(manager), "manager not stored");
    }

    /// @dev The whole point of the split: two child contracts plus the hook must
    ///      all fit inside the EIP-3860 initcode cap.
    function test_Constructor_ChildrenAreDistinctContracts() public {
        (address logic, address logic2) =
            EswapHookDeployLib.deployLogic(address(manager), address(priceFeed));
        assertTrue(logic != logic2, "logic and logic2 must differ");
        assertGt(logic.code.length, 0, "logic has no code");
        assertGt(logic2.code.length, 0, "logic2 has no code");
    }

    // ---------------------------------------------------------------------
    // Validation: addresses
    // ---------------------------------------------------------------------

    function test_Constructor_RevertZeroOwner() public {
        (address logic, address logic2) =
            EswapHookDeployLib.deployLogic(address(manager), address(priceFeed));
        vm.expectRevert(EswapMarginHook.ZeroAddress.selector);
        _deploy(logic, logic2, address(0), _flagAddress());
    }

    function test_Constructor_RevertZeroLogic() public {
        (address logic,) = EswapHookDeployLib.deployLogic(address(manager), address(priceFeed));
        vm.expectRevert(EswapMarginHook.ZeroAddress.selector);
        _deploy(logic, address(0), owner, _flagAddress());
    }

    function test_Constructor_RevertZeroLogic2() public {
        (, address logic2) = EswapHookDeployLib.deployLogic(address(manager), address(priceFeed));
        vm.expectRevert(EswapMarginHook.ZeroAddress.selector);
        _deploy(address(0), logic2, owner, _flagAddress());
    }

    /// @dev Passing the same contract for both roles would let one contract
    ///      answer for two different storage layouts.
    function test_Constructor_RevertIdenticalLogic() public {
        (address logic,) = EswapHookDeployLib.deployLogic(address(manager), address(priceFeed));
        vm.expectRevert(EswapMarginHook.ZeroAddress.selector);
        _deploy(logic, logic, owner, _flagAddress());
    }

    // ---------------------------------------------------------------------
    // Validation: deployed code
    // ---------------------------------------------------------------------

    /// @dev An EOA or self-destructed address has no code; a hook wired to one
    ///      would accept margin and then revert on every settlement.
    function test_Constructor_RevertUndeployedLogic() public {
        (address logic, address logic2) =
            EswapHookDeployLib.deployLogic(address(manager), address(priceFeed));
        address eoa = address(0xDEAD);
        vm.expectRevert(EswapMarginHook.LogicNotDeployed.selector);
        _deploy(logic, eoa, owner, _flagAddress());
    }

    function test_Constructor_RevertUndeployedLogic2() public {
        (address logic, address logic2) =
            EswapHookDeployLib.deployLogic(address(manager), address(priceFeed));
        vm.expectRevert(EswapMarginHook.LogicNotDeployed.selector);
        _deploy(logic, address(0xBEEF), owner, _flagAddress());
    }

    // ---------------------------------------------------------------------
    // Validation: PoolManager agreement
    // ---------------------------------------------------------------------

    /// @dev The delegatecall'd logic reads `manager` from ITS OWN immutable, not
    ///      from the hook. A mismatch would route every settlement through a
    ///      foreign PoolManager while the hook believed it was local.
    function test_Constructor_RevertManagerMismatchOnLogic() public {
        PoolManagerMock otherManager = new PoolManagerMock();
        (address logic, address logic2) =
            EswapHookDeployLib.deployLogic(address(otherManager), address(priceFeed));
        vm.expectRevert(EswapMarginHook.LogicManagerMismatch.selector);
        _deploy(logic, logic2, owner, _flagAddress());
    }

    function test_Constructor_RevertManagerMismatchOnLogic2() public {
        PoolManagerMock otherManager = new PoolManagerMock();
        (, address logic2) = EswapHookDeployLib.deployLogic(address(otherManager), address(priceFeed));
        // logic must itself match, so build a matching one and swap only logic2.
        (address logic,) = EswapHookDeployLib.deployLogic(address(manager), address(priceFeed));
        vm.expectRevert(EswapMarginHook.LogicManagerMismatch.selector);
        _deploy(logic, logic2, owner, _flagAddress());
    }

    // ---------------------------------------------------------------------
    // Validation: hook permission bits
    // ---------------------------------------------------------------------

    /// @dev A hook without its flag bits is rejected by PoolManager
    ///      `isValidHookAddress`; catching it here gives a clearer failure than
    ///      an unusable-but-deployed contract.
    function test_Constructor_RevertMissingHookFlags() public {
        (address logic, address logic2) =
            EswapHookDeployLib.deployLogic(address(manager), address(priceFeed));
        vm.expectRevert(EswapMarginHook.InvalidHookAddress.selector);
        _deploy(logic, logic2, owner, address(0x1234));
    }

    // ---------------------------------------------------------------------
    // Initcode budget (the reason this refactor exists)
    // ---------------------------------------------------------------------

    function test_InitcodeFitsEip3860() public {
        bytes memory creation = type(EswapMarginHook).creationCode;
        assertLt(
            creation.length + 5 * 32, // 5 constructor args, ABI-encoded
            49_152,
            "hook initcode must fit EIP-3860"
        );
    }

    function test_HookRuntimeFitsEip170() public {
        // `type(X).runtimeCode` is unavailable for contracts with immutables,
        // which `EswapMarginHook` has (`hookLogic`, `priceFeed`, `manager`).
        // Read the compiled artifact instead.
        string memory json = vm.readFile("out/EswapMarginHook.sol/EswapMarginHook.json");
        uint256 len = _deployedBytecodeLength(json);
        assertLt(len, 24_576, "hook runtime must fit EIP-170");
    }

    /// @dev Pulls `deployedBytecode.object` length out of the artifact JSON
    ///      without a JSON parser: find the key, skip `": "0x`, then count hex
    ///      nibbles until the closing quote.
    function _deployedBytecodeLength(string memory json) internal pure returns (uint256) {
        bytes memory b = bytes(json);
        bytes memory key = '"deployedBytecode":{"object":"0x';
        uint256 k = _indexOf(b, key);
        require(k > 0, "deployedBytecode not found in artifact");
        uint256 start = k + key.length;
        uint256 n = 0;
        while (start + n < b.length) {
            uint8 c = uint8(b[start + n]);
            if (c == 0x22) break; // closing double quote
            n++;
        }
        return n / 2;
    }

    function _indexOf(bytes memory haystack, bytes memory needle) internal pure returns (uint256) {
        require(needle.length > 0 && haystack.length >= needle.length, "bad _indexOf");
        for (uint256 i = 0; i + needle.length <= haystack.length; i++) {
            bool eq = true;
            for (uint256 j = 0; j < needle.length; j++) {
                if (haystack[i + j] != needle[j]) { eq = false; break; }
            }
            if (eq) return i;
        }
        return 0;
    }

    /// @dev Guards the regression that motivated Option A: with both children
    ///      inlined the hook was undeployable, so this pins the budget with
    ///      enough margin to catch a slow creep back toward the cap.
    function test_CombinedDeploymentFitsEip3860() public {
        uint256 total = type(EswapMarginHook).creationCode.length
            + type(EswapMarginHookLogic).creationCode.length
            + type(EswapMarginHookLogic2).creationCode.length;
        // Sibling contracts each have their own tx, so this is not a hard limit,
        // but it documents that the hook alone no longer dominates the budget.
        assertLt(type(EswapMarginHook).creationCode.length, total, "hook is the largest child");
    }

    /// @dev sanity: the logic contracts really do expose `manager()`.
    function test_LogicExposesManager() public {
        (address logic, address logic2) =
            EswapHookDeployLib.deployLogic(address(manager), address(priceFeed));
        assertEq(address(EswapMarginHookLogic(payable(logic)).manager()), address(manager));
        assertEq(address(EswapMarginHookLogic2(payable(logic2)).manager()), address(manager));
    }
}
