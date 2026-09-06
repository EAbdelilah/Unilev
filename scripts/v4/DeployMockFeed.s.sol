// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {MockAggregator} from "../../test/mocks/MockAggregator.sol";

/// @notice Deploys the settable-answer oracle mock used ONLY by the anvil fork
///         simulation to force a deterministic keeper-driven liquidation.
contract DeployMockFeed is Script {
    function run() external {
        uint256 pk = vm.envOr("MOCK_DEPLOY_PK", uint256(0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80));
        vm.startBroadcast(pk);
        MockAggregator mock = new MockAggregator(2600000000000000000000); // $2600 ETH
        console.log("MockAggregator:", address(mock));
        vm.stopBroadcast();
    }
}