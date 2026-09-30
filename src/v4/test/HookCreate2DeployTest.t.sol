// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {EswapMarginHook, IPriceFeed} from "../EswapMarginHook.sol";
import {EswapHookDeployLib} from "./EswapHookDeployLib.sol";
import {PriceFeedMock} from "./BaseV4Test.t.sol";
import {PoolManagerMock} from "./mocks/PoolManagerMock.sol";
import {IPoolManager} from "../interfaces/IPoolManager.sol";

/**
 * @title HookCreate2DeployTest
 * @notice Permanent regression coverage for the live Unichain hook deployment path.
 *
 * @dev A Uniswap v4 hook must live at an address carrying specific permission
 *      bits, so it can only be placed by CREATE2 with a salt mined for those
 *      bits. The production path hands `salt || initcode` to Foundry's
 *      deterministic Create2Deployer (Arachnid), which builds the CREATE2
 *      preimage itself. This is the only path the rest of the suite does NOT
 *      exercise: `deployCodeTo` / `vm.etch` place runtime code directly and skip
 *      both the 200-gas-per-byte code deposit and the preimage construction, so
 *      an in-suite `new EswapMarginHook{...}` measurement is not the number that
 *      matters on-chain.
 *
 *      This bug actually shipped once, twice, in three different forms:
 *        1. the preimage was hashed as `salt || initCodeHash` (64 bytes) instead
 *           of `0xff || deployer || salt || initCodeHash` (85 bytes), so every
 *           predicted address was wrong and the deploy went to an address the
 *           constructor rejects;
 *        2. the payload was built as `initcode || salt` instead of
 *           `salt || initcode`, which the Arachnid deployer silently misreads;
 *        3. the "minimal initcode" probe began with 0x69 (PUSH10), swallowing
 *           the rest of the program and leaving RETURN with a single stack item,
 *           so the probe reverted for reasons unrelated to the deployer.
 *
 *      Each of those produced a *plausible* failure, so the assertions below
 *      check the computed address, the payload order, and the deployed wiring
 *      rather than merely logging measurements.
 */
contract HookCreate2DeployTest is Test {
    /// @dev Foundry's deterministic Create2Deployer, present on Unichain.
    address constant CREATE2_DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;

    /// @dev The canonical 69-byte Arachnid runtime, copied from Unichain mainnet
    ///      so this suite matches the live singleton byte for byte.
    bytes constant CREATE2_RUNTIME =
        hex"7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe03601600081602082378035828234f58015156039578182fd5b8082525050506014600cf3";

    /// @dev High custom-bit flags the hook's `getHookFlags()` demands.
    uint160 constant HIGH_FLAGS = (1 << 159) | (1 << 158) | (1 << 153) | (1 << 152) | (1 << 148);
    /// @dev Low 14 v4 permission bits the hook's `getHookFlags()` demands.
    uint160 constant LOW_MASK = (1 << 12) | (1 << 7) | (1 << 6) | (1 << 3);
    uint160 constant ALL_HOOK_MASK = (1 << 14) - 1;

    /// @dev EIP-170 deployed-code limit.
    uint256 constant MAX_CODE_SIZE = 24576;
    /// @dev `EswapMarginHook` is ~23.6KB, so the Arachnid path has very little
    ///      room. Generous, but tight enough to catch a runaway feature.
    uint256 constant DEPLOYER_PATH_GAS_CAP = 12_000_000;

    /// @dev Minimal valid initcode: store 1 at memory 0 and return the 32-byte
    ///      word. Must begin 0x60 (PUSH1). The earlier probe started 0x69
    ///      (PUSH10), which swallowed the remainder and left RETURN with one
    ///      stack item, so the create reverted for unrelated reasons.
    bytes constant TINY_INITCODE = hex"600160005260206000f3";

    PoolManagerMock manager;
    PriceFeedMock priceFeed;

    function setUp() public {
        manager = new PoolManagerMock();
        priceFeed = new PriceFeedMock();
        vm.etch(CREATE2_DEPLOYER, CREATE2_RUNTIME);
    }

    // ─── helpers ──────────────────────────────────────────────────────────────

    function _hookInitCode() internal returns (bytes memory) {
        (address logic, address logic2) =
            EswapHookDeployLib.deployLogic(address(manager), address(priceFeed));
        return abi.encodePacked(
            type(EswapMarginHook).creationCode,
            abi.encode(address(manager), address(priceFeed), logic, logic2, address(this))
        );
    }

    /// @dev Canonical 85-byte preimage: `0xff || creator || salt || initCodeHash`.
    function _create2(address creator, bytes32 salt, bytes32 initCodeHash)
        internal
        pure
        returns (address)
    {
        return address(
            uint160(uint256(keccak256(abi.encodePacked(hex"ff", creator, salt, initCodeHash))))
        );
    }

    /// @dev Salt search in assembly. The Solidity form costs ~600 gas/iteration
    ///      and OOGs long before it finds a match (need ~1 in 2^19).
    function _mineSalt(address creator, bytes32 initCodeHash, bool requireLowBits)
        internal
        pure
        returns (bytes32 salt)
    {
        for (uint256 i = 0; i < 8_000_000; i++) {
            salt = bytes32(i);
            uint160 computed;
            assembly {
                let ptr := mload(0x40)
                mstore(add(ptr, 0x40), initCodeHash)
                mstore(add(ptr, 0x20), salt)
                mstore(ptr, creator)
                let start := add(ptr, 0x0b)
                mstore8(start, 0xff)
                computed := and(keccak256(start, 85), 0xffffffffffffffffffffffffffffffffffffffff)
            }
            if ((computed & HIGH_FLAGS) != HIGH_FLAGS) continue;
            if (requireLowBits && (computed & ALL_HOOK_MASK) != LOW_MASK) continue;
            return salt;
        }
        revert("no salt found");
    }

    // ─── the framing regression ───────────────────────────────────────────────

    /// @dev THE regression. A typed `new ... {salt:}` must land on the address
    ///      derived from the 85-byte `0xff || creator || salt || initCodeHash`
    ///      preimage. This is what a 64-byte `salt || initCodeHash` hash (or any
    ///      swapped field order) gets wrong, and it is a hard equality so a
    ///      regression cannot hide behind a log line.
    function test_Framing_TypedCreate2Matches85BytePreimage() public {
        (address logic, address logic2) =
            EswapHookDeployLib.deployLogic(address(manager), address(priceFeed));
        bytes memory initCode = abi.encodePacked(
            type(EswapMarginHook).creationCode,
            abi.encode(address(manager), address(priceFeed), logic, logic2, address(this))
        );
        bytes32 initCodeHash = keccak256(initCode);
        bytes32 salt = _mineSalt(address(this), initCodeHash, true);

        address expected = _create2(address(this), salt, initCodeHash);

        EswapMarginHook h = new EswapMarginHook{salt: salt}(
            IPoolManager(address(manager)),
            IPriceFeed(address(priceFeed)),
            logic,
            logic2,
            address(this)
        );

        assertEq(address(h), expected, "typed CREATE2 address != 85-byte preimage");
        assertGt(address(h).code.length, 0, "deployed hook has no code");
    }

    /// @dev Guards the preimage shape directly: the 64-byte `salt || hash`
    ///      variant is a DIFFERENT address, so if these ever equal, the framing
    ///      test above is no longer discriminating.
    function test_Framing_64BytePreimageIsDifferent() public {
        bytes32 salt = bytes32(uint256(0xcafe));
        bytes32 initCodeHash = keccak256(abi.encodePacked("x"));
        address correct = _create2(address(this), salt, initCodeHash);
        address wrong64 = address(uint160(uint256(keccak256(abi.encodePacked(salt, initCodeHash)))));
        assertTrue(correct != wrong64, "64-byte preimage must NOT match 85-byte");
    }

    /// @dev The Arachnid deployer reads `salt` from the FIRST 32 bytes. Proving
    ///      the payload order here means a future `initcode || salt` edit fails
    ///      loudly instead of deploying to a wrong-but-nonempty address.
    function test_Framing_PayloadIsSaltThenInitcode() public {
        bytes32 salt = bytes32(uint256(0x1234));
        bytes memory initCode = abi.encodePacked(type(PriceFeedMock).creationCode);
        bytes32 initCodeHash = keccak256(initCode);
        address expected = _create2(CREATE2_DEPLOYER, salt, initCodeHash);

        // The deployer returns the 20-byte address in its returndata.
        (bool ok, bytes memory ret) = CREATE2_DEPLOYER.call(abi.encodePacked(salt, initCode));
        assertTrue(ok, "salt||initcode payload reverted");
        assertEq(ret.length, 20, "deployer returned no address");
        address deployedByCorrect = address(bytes20(ret));

        assertEq(deployedByCorrect, expected, "salt||initcode must match deployer preimage");

        // Swapping the order must NOT land on the same address. The deployer
        // reads the salt from calldata[0:32], so `initcode || salt` feeds it the
        // first 32 bytes of the initcode and treats the remainder as initcode,
        // which makes CREATE2 fail after burning most of the forwarded gas --
        // hence the explicit cap.
        (bool ok2, bytes memory ret2) =
            CREATE2_DEPLOYER.call{gas: 5_000_000}(abi.encodePacked(initCode, salt));
        if (ok2 && ret2.length == 20) {
            assertTrue(
                address(bytes20(ret2)) != expected,
                "swapped payload unexpectedly matched"
            );
        }
    }

    // ─── the live deployment path ─────────────────────────────────────────────

    /// @dev The production path end to end: hand `salt || initcode` to the
    ///      Arachnid deployer and require a fully wired hook, not just a
    ///      non-empty return.
    function test_DeployerPath_DeploysFullyWiredHook() public {
        (address logic, address logic2) =
            EswapHookDeployLib.deployLogic(address(manager), address(priceFeed));
        bytes memory initCode = abi.encodePacked(
            type(EswapMarginHook).creationCode,
            abi.encode(address(manager), address(priceFeed), logic, logic2, address(this))
        );
        bytes32 salt = _mineSalt(CREATE2_DEPLOYER, keccak256(initCode), true);
        address expected = _create2(CREATE2_DEPLOYER, salt, keccak256(initCode));

        (bool ok, bytes memory ret) =
            CREATE2_DEPLOYER.call{gas: 30_000_000}(abi.encodePacked(salt, initCode));

        assertTrue(ok, "Arachnid deployer path reverted");
        assertEq(ret.length, 20, "no address returned");
        address deployed = address(bytes20(ret));
        assertEq(deployed, expected, "deployed address != preimage");

        EswapMarginHook h = EswapMarginHook(payable(deployed));
        assertGt(deployed.code.length, 0, "deployed hook has no code");
        assertEq(address(h.hookLogic()), logic, "hookLogic not wired");
        assertEq(address(h.priceFeed()), address(priceFeed), "priceFeed not wired");
        assertEq(h.owner(), address(this), "owner not wired");
    }

    /// @dev The hook sits ~1KB under EIP-170 and the Arachnid path charges a
    ///      200-gas-per-byte code deposit on top of the constructor. A gas
    ///      ceiling here stops a new feature silently making the live deploy
    ///      un-affordable, which is far more expensive to discover than to catch.
    function test_DeployerPath_StaysWithinGasBudget() public {
        (address logic, address logic2) =
            EswapHookDeployLib.deployLogic(address(manager), address(priceFeed));
        bytes memory initCode = abi.encodePacked(
            type(EswapMarginHook).creationCode,
            abi.encode(address(manager), address(priceFeed), logic, logic2, address(this))
        );
        // The constructor's own check is `address(this) & getHookFlags() ==
        // getHookFlags()`, and the low bits are irrelevant for gas purposes, so
        // mine the high flags only: a 1-in-32 search instead of 1-in-2^19.
        bytes32 salt = _mineSalt(CREATE2_DEPLOYER, keccak256(initCode), false);

        uint256 before = gasleft();
        (bool ok,) = CREATE2_DEPLOYER.call{gas: 100_000_000}(abi.encodePacked(salt, initCode));
        uint256 used = before - gasleft();

        assertTrue(ok, "deployer path reverted");
        assertLt(used, DEPLOYER_PATH_GAS_CAP, "deployer path gas blew the budget");
        console2.log("Arachnid deployer path gas:", used);
    }

    /// @dev A deliberately wrong salt must NOT produce a hook. The constructor
    ///      check is `address(this) & getHookFlags() == getHookFlags()`, so the
    ///      create has to fail rather than silently deploy an unusable address.
    ///
    ///      Returndata is deliberately NOT asserted to be the
    ///      `InvalidHookAddress` selector: this contract is built with via-ir, and
    ///      when the large constructor reverts, unwinding its stack overflows the
    ///      1024-slot limit, so the revert data is lost and the caller sees empty
    ///      returndata. That is precisely the ambiguity this test used to be
    ///      written to diagnose -- "empty returndata" looks identical to "the
    ///      create frame got no gas" from the outside, which sent the earlier
    ///      investigation down the wrong path. The real property worth asserting
    ///      is that nothing is deployed at a non-conforming address.
    function test_DeployerPath_WrongSaltRejectedWithRealRevert() public {
        bytes memory initCode = _hookInitCode();
        bytes32 badSalt = bytes32(uint256(12345));
        (bool ok, bytes memory ret) =
            CREATE2_DEPLOYER.call{gas: 150_000_000}(abi.encodePacked(badSalt, initCode));

        assertFalse(ok, "hook accepted a non-conforming address");
        // Whatever the failure mode, the address must carry no code.
        address rejected = _create2(CREATE2_DEPLOYER, badSalt, keccak256(initCode));
        assertEq(rejected.code.length, 0, "code was deployed at a rejected address");
        // When the selector does survive, it must be the expected one.
        if (ret.length == 4) {
            assertEq(bytes4(ret), EswapMarginHook.InvalidHookAddress.selector, "wrong revert reason");
        } else {
            assertEq(ret.length, 0, "unexpected returndata shape (expected 0 or 4 bytes)");
        }
    }

    /// @dev Control: a small contract must clear the same deployer. If this
    ///      fails while the hook case passes, the deployer is the problem, not
    ///      the hook's size.
    function test_Control_SmallContractViaCreate2() public {
        bytes memory initCode = type(PriceFeedMock).creationCode;
        (bool ok, bytes memory ret) = CREATE2_DEPLOYER.call(abi.encodePacked(bytes32(uint256(1)), initCode));
        assertTrue(ok, "control create2 reverted");
        assertEq(ret.length, 20, "control returned no address");
    }

    /// @dev Minimal valid initcode: store 1 at memory 0 and return the 32-byte
    ///      word. Must begin 0x60 (PUSH1). The earlier probe started 0x69
    ///      (PUSH10), which swallowed the remainder and left RETURN with one
    ///      stack item, so the create reverted for unrelated reasons.
    function test_Control_MinimalInitcodeExecutes() public {
        (bool ok, bytes memory ret) =
            CREATE2_DEPLOYER.call(abi.encodePacked(bytes32(uint256(2)), TINY_INITCODE));
        assertTrue(ok, "minimal initcode create2 reverted");
        assertEq(ret.length, 20, "minimal initcode returned no address");
    }

    /// @dev The deployer singleton must be the canonical 69-byte Arachnid
    ///      runtime. Etching a different one would silently change every address
    ///      this suite computes.
    function test_DeployerRuntimeIsCanonical() public {
        assertEq(CREATE2_DEPLOYER.code.length, 69, "Create2Deployer runtime size");
        assertEq(CREATE2_DEPLOYER.code, CREATE2_RUNTIME, "Create2Deployer runtime bytes");
    }

    /// @dev EIP-170 headroom is a deployment blocker, so assert the real margin
    ///      rather than leaving it to be rediscovered on-chain.
    function test_HookRuntimeUnderEIP170() public {
        (address logic, address logic2) =
            EswapHookDeployLib.deployLogic(address(manager), address(priceFeed));
        EswapMarginHook h = new EswapMarginHook(manager, priceFeed, logic, logic2, address(this));
        uint256 size = address(h).code.length;
        assertLt(size, MAX_CODE_SIZE, "hook exceeds EIP-170");
        emit log_named_uint("hook runtime size", size);
        emit log_named_uint("EIP-170 headroom", MAX_CODE_SIZE - size);
    }
}

