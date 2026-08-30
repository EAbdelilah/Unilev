// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {PoolSwapTest} from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import {IPoolManager as RealIPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";

/// @notice Broadcasts ONLY the deployment of PoolSwapTest so the address can be
///         captured and reused by FundDeployer2 (avoids the "IO error: not a
///         terminal" crash forge hits when a broadcast script both deploys a
///         test helper and calls the fresh address in one run).
contract DeploySwapper is Script {
    address constant PM = 0x1F98400000000000000000000000000000000004;

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(pk);
        PoolSwapTest swapper = new PoolSwapTest(RealIPoolManager(PM));
        vm.stopBroadcast();
        console.log("PoolSwapTest deployed at:", address(swapper));
    }
}
