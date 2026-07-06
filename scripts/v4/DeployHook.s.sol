// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "lib/forge-std/src/Script.sol";
import {EswapMarginHook} from "../../src/v4/EswapMarginHook.sol";
import {IPoolManager} from "../../src/v4/interfaces/IPoolManager.sol";

/**
 * @title DeployHook
 * @notice Script to mine for a salt that satisfies V4 hook address requirements and deploy.
 */
contract DeployHook is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address manager = vm.envAddress("POOL_MANAGER_ADDRESS");

        vm.startBroadcast(deployerPrivateKey);

        uint160 flags = EswapMarginHook(address(0)).getHookFlags();
        bytes memory bytecode = abi.encodePacked(type(EswapMarginHook).creationCode, abi.encode(manager));

        address hookAddress;
        bytes32 salt = 0;

        // Simplified salt mining loop for demonstration
        for (uint256 i = 0; i < 1000; i++) {
            salt = bytes32(i);
            hookAddress = address(uint160(uint256(keccak256(abi.encodePacked(
                bytes1(0xff),
                address(this),
                salt,
                keccak256(bytecode)
            )))));

            if (uint160(hookAddress) & flags == flags) {
                new EswapMarginHook{salt: salt}(IPoolManager(manager));
                break;
            }
        }

        vm.stopBroadcast();
    }
}
EOF
