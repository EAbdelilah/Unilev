// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {PoolId as RealPoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
contract ProbeIds is Test {
    using StateLibrary for IPoolManager;

    IPoolManager constant PM = IPoolManager(0x1F98400000000000000000000000000000000004);

    function test_ProbeIds() public {
        vm.createSelectFork(vm.envString("UNICHAIN_RPC_URL"));
        bytes32[3] memory ids = [
            bytes32(0x9bdd72519ad7e2b5f0d5441d7af389771cc04a8406cd577fac0c68a8b6b396bd),
            bytes32(0x4cc809036c68e41c8759b975baca4311b6b5b6e71821d4c04a39310b4d2c7d02),
            bytes32(0x157eb602201b74835a3d91fb36d5d376a56174a1207d919331b5243d998c7fbf) // ETH/WBTC V4
        ];
        for (uint256 i = 0; i < ids.length; i++) {
            (uint160 sqrt, int24 tick, uint24 pf, uint24 lf) = PM.getSlot0(RealPoolId.wrap(ids[i]));
            uint128 liq = PM.getLiquidity(RealPoolId.wrap(ids[i]));
            uint256 p2 = (uint256(sqrt) * uint256(sqrt)) >> (2 * 96);
            emit log_named_uint(string(abi.encodePacked("id", vm.toString(i + 1), " sqrtX96")), uint256(sqrt));
            emit log_named_int(string(abi.encodePacked("id", vm.toString(i + 1), " tick")), tick);
            emit log_named_uint(string(abi.encodePacked("id", vm.toString(i + 1), " lpFee")), uint256(lf));
            emit log_named_uint(string(abi.encodePacked("id", vm.toString(i + 1), " liq")), uint256(liq));
            emit log_named_uint(string(abi.encodePacked("id", vm.toString(i + 1), " price0")), p2);
        }
    }
}