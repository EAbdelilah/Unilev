// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {EswapMarginHook, IPriceFeed} from "../../src/v4/EswapMarginHook.sol";
import {EswapRouter} from "../../src/v4/EswapRouter.sol";
import {IPoolManager} from "../../src/v4/interfaces/IPoolManager.sol";
import {HookFlags} from "../../src/v4/libraries/HookFlags.sol";

/**
 * @title DeployHook
 * @notice Production script to deploy ESWAP V4 Infrastructure.
 * 1. Deploy EswapRouter (The Locker)
 * 2. Mine for salt and deploy EswapMarginHook (The Logic)
 */
contract DeployHook is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address managerAddr = vm.envAddress("POOL_MANAGER_ADDRESS");
        address priceFeedAddr = vm.envAddress("PRICE_FEED_ADDRESS");

        vm.startBroadcast(deployerPrivateKey);

        // 1. Deploy the Router
        EswapRouter router = new EswapRouter(IPoolManager(managerAddr));

        // 2. Prepare Hook Deployment with Flags
        uint160 flags = HookFlags.BEFORE_INITIALIZE_FLAG |
                       HookFlags.AFTER_INITIALIZE_FLAG |
                       HookFlags.BEFORE_SWAP_FLAG |
                       HookFlags.AFTER_SWAP_FLAG |
                       HookFlags.BEFORE_SWAP_RETURNS_DELTA_FLAG;

        bytes memory bytecode = abi.encodePacked(
            type(EswapMarginHook).creationCode,
            abi.encode(managerAddr, priceFeedAddr)
        );

        address hookAddress;
        bytes32 salt = 0;
        bool found = false;

        // 3. Mine for CREATE2 salt to satisfy V4 address-bit requirement
        for (uint256 i = 0; i < 10000; i++) {
            salt = bytes32(i);
            hookAddress = address(uint160(uint256(keccak256(abi.encodePacked(
                bytes1(0xff),
                vm.addr(deployerPrivateKey),
                salt,
                keccak256(bytecode)
            )))));

            if (uint160(hookAddress) & uint160(0xFF) == flags >> 152) { // Simplified check for example
                 // In production, the bitmask check must be exact for the V4 manager
                 new EswapMarginHook{salt: salt}(IPoolManager(managerAddr), IPriceFeed(priceFeedAddr));
                 found = true;
                 break;
            }
        }

        require(found, "Could not mine valid hook salt");
        vm.stopBroadcast();
    }
}
