// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {EswapRouter} from "../../src/v4/EswapRouter.sol";

contract SetupPostDeploy is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address solver = vm.envAddress("SOLVER_ADDRESS");
        address routerAddr = vm.envAddress("V4_ROUTER_ADDRESS");

        vm.startBroadcast(pk);

        EswapRouter router = EswapRouter(payable(routerAddr));

        // 1. Whitelist the solver on the router
        if (!router.registeredSolvers(solver)) {
            router.setSolverWhitelist(solver, true);
            console.log("Solver registered:", solver);
        } else {
            console.log("Solver already registered:", solver);
        }

        vm.stopBroadcast();
    }
}
