// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {EswapMarginHook, IPriceFeed} from "../../src/v4/EswapMarginHook.sol";
import {IPoolManager} from "../../src/v4/interfaces/IPoolManager.sol";
import {IPriceFeed as IPriceFeedInterface} from "../../src/v4/EswapMarginHook.sol";

/**
 * @title DeployHook
 * @notice Production script to mine for a salt that satisfies V4 hook address requirements and deploy.
 */
contract DeployHook is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address manager = vm.envAddress("POOL_MANAGER_ADDRESS");
        address priceFeed = vm.envAddress("PRICE_FEED_ADDRESS");

        // 1. Get Flags
        uint160 flags =
            0x01 << 159 | // BEFORE_INITIALIZE
            0x01 << 158 | // AFTER_INITIALIZE
            0x01 << 153 | // BEFORE_SWAP
            0x01 << 152 | // AFTER_SWAP
            0x01 << 148;  // BEFORE_SWAP_RETURNS_DELTA

        bytes memory bytecode = abi.encodePacked(
            type(EswapMarginHook).creationCode,
            abi.encode(manager, priceFeed)
        );

        vm.startBroadcast(deployerPrivateKey);

        address hookAddress;
        bytes32 salt = 0;

        // 2. Mine for salt
        for (uint256 i = 0; i < 5000; i++) {
            salt = bytes32(i);
            hookAddress = address(uint160(uint256(keccak256(abi.encodePacked(
                bytes1(0xff),
                msg.sender, // The broadcaster
                salt,
                keccak256(bytecode)
            )))));

            if ((uint160(hookAddress) & 0x3FFF << 146) == flags) {
                 new EswapMarginHook{salt: salt}(IPoolManager(manager), IPriceFeed(priceFeed));
                 break;
            }
        }

        vm.stopBroadcast();
    }
}
EOF
