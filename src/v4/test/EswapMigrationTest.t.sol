// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BaseV4Test} from "./BaseV4Test.t.sol";
import {EswapMarginHook, IPriceFeed} from "../EswapMarginHook.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {HookFlags} from "../libraries/HookFlags.sol";

contract EswapMigrationTest is BaseV4Test {
    using PoolIdLibrary for PoolKey;

    function setUp() public override {
        super.setUp();
        hook.setRouter(address(this));
        bytes memory data = abi.encode(true, uint8(3), address(this));
        vm.prank(address(manager));
        beforeSwap(address(this), key, true, -100 ether, data);
        vm.prank(address(manager));
        afterSwap(address(this), key, true, -300 ether, -300 ether, 290 ether, data);
    }

    function _deployNewHook() internal returns (EswapMarginHook) {
        uint160 flags = HookFlags.AFTER_INITIALIZE_FLAG |
                       HookFlags.BEFORE_SWAP_FLAG |
                       HookFlags.BEFORE_SWAP_RETURNS_DELTA_FLAG |
                       HookFlags.AFTER_SWAP_FLAG |
                       HookFlags.AFTER_SWAP_RETURNS_DELTA_FLAG;

        bytes memory bytecode = abi.encodePacked(
            type(EswapMarginHook).creationCode,
            abi.encode(manager, priceFeed)
        );

        address hookAddr;
        bytes32 salt;
        bool found = false;

        for (uint256 i = 1000000; i < 2000000; i++) {
            salt = bytes32(i);
            hookAddr = address(uint160(uint256(keccak256(abi.encodePacked(
                bytes1(0xff),
                address(this),
                salt,
                keccak256(bytecode)
            )))));

            if (uint160(hookAddr) & flags == flags) {
                found = true;
                break;
            }
        }

        require(found, "Could not mine valid hook salt");
        return new EswapMarginHook{salt: salt}(IPoolManager(address(manager)), priceFeed);
    }

    function test_SetMigrationTarget() public {
        EswapMarginHook newHook = _deployNewHook();
        hook.setMigrationTarget(address(newHook));
        assertEq(hook.migrationTarget(), address(newHook));
    }

    function test_NonOwnerCannotSetMigrationTarget() public {
        EswapMarginHook newHook = _deployNewHook();
        vm.prank(address(0xBAD));
        vm.expectRevert();
        hook.setMigrationTarget(address(newHook));
    }

    function test_MigratePosition() public {
        EswapMarginHook newHook = _deployNewHook();
        hook.setMigrationTarget(address(newHook));
        newHook.setMigrationSource(address(hook));
        hook.migratePosition(key, address(this));

        (address t, uint256 c, , , , , , , ) = hook.positions(key.toId(), address(this));
        assertEq(t, address(0));
        assertEq(c, 0);

        (address t2, uint256 c2, , , , , , , ) = newHook.positions(key.toId(), address(this));
        assertEq(t2, address(this));
        assertTrue(c2 > 0);
    }

    function test_MigratePosition_NonOwnerReverts() public {
        EswapMarginHook newHook = _deployNewHook();
        vm.prank(address(0xBAD));
        vm.expectRevert();
        hook.migratePosition(key, address(this));
    }

    function test_MigratePosition_NoTargetReverts() public {
        vm.expectRevert("No migration target");
        hook.migratePosition(key, address(this));
    }

    function test_AcceptMigration_UnauthorizedReverts() public {
        EswapMarginHook newHook = _deployNewHook();
        EswapMarginHook.MarginPosition memory pos = _getPosition(hook);
        vm.prank(address(0xBAD));
        vm.expectRevert("Not authorized");
        newHook.acceptMigration(address(this), key, pos);
    }

    function _getPosition(EswapMarginHook h) internal view returns (EswapMarginHook.MarginPosition memory) {
        (address trader, uint256 collateral, uint256 borrowed, uint8 lev, bool isLong, uint160 liqSqrt, int24 tickL, int24 tickU, uint128 liq) = h.positions(key.toId(), address(this));
        return EswapMarginHook.MarginPosition({
            trader: trader,
            collateralAmount: collateral,
            borrowedAmount: borrowed,
            leverage: lev,
            isLong: isLong,
            liquidationSqrtPrice: liqSqrt,
            tickLower: tickL,
            tickUpper: tickU,
            liquidity: liq
        });
    }
}
