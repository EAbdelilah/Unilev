// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {PoolId as RealPoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {IPoolManager as RealIPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";

contract ReadPools is Script {
    address constant PM = 0x1F98400000000000000000000000000000000004;

    function run() external {
        RealIPoolManager pm = RealIPoolManager(PM);

        // Env-overridable pool ids (defaults to the pre-redeploy mainnet ids).
        bytes32 hookPool = vm.envOr("HOOK_POOL_ID", bytes32(0xdf200fe2e3f16b9ee695a96c1015d88d4c5602ed8bbff05e4fa535f10e66a879));
        bytes32 stdPool = vm.envOr("STD_POOL_ID", bytes32(0xe453b9d723191918039dd7929f61d7524082886b55a62ff570cf05ba36f616ed));

        (uint160 hookSqrt, int24 hookTick,,) = StateLibrary.getSlot0(pm, RealPoolId.wrap(hookPool));
        uint128 hookLiq = StateLibrary.getLiquidity(pm, RealPoolId.wrap(hookPool));
        console.log("hook pool sqrt:", vm.toString(uint256(hookSqrt)));
        console.log("hook pool tick:", int256(hookTick));
        console.log("hook pool liquidity:", uint256(hookLiq));

        (uint160 stdSqrt, int24 stdTick,,) = StateLibrary.getSlot0(pm, RealPoolId.wrap(stdPool));
        uint128 stdLiq = StateLibrary.getLiquidity(pm, RealPoolId.wrap(stdPool));
        console.log("std  pool sqrt:", vm.toString(uint256(stdSqrt)));
        console.log("std  pool tick:", int256(stdTick));
        console.log("std  pool liquidity:", uint256(stdLiq));
    }
}