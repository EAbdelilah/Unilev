// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {PoolManager} from "@uniswap/v4-core/src/PoolManager.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {TickMath} from "../../src/v4/libraries/TickMath.sol";
import {EswapMarginHook, IPriceFeed} from "../../src/v4/EswapMarginHook.sol";
import {EswapRouter} from "../../src/v4/EswapRouter.sol";
import {PriceFeed} from "../../src/v4/PriceFeed.sol";
import {HookFlags} from "../../src/v4/libraries/HookFlags.sol";

contract DeployUnichain is Script {
    using PoolIdLibrary for PoolKey;
    using LPFeeLibrary for uint24;

    address constant WETH = 0x4200000000000000000000000000000000000006;
    address constant USDC = 0x078D782b760474a361dDA0AF3839290b0EF57AD6;
    address constant UNICHAIN_PM = 0x1F98400000000000000000000000000000000004;

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        vm.startBroadcast(deployerPrivateKey);

        PoolManager pm = PoolManager(UNICHAIN_PM);
        console.log("Using Unichain PoolManager at:", UNICHAIN_PM);

        // Deploy PriceFeed (feeds must be configured post-deployment)
        PriceFeed priceFeed = new PriceFeed();
        console.log("PriceFeed deployed at:", address(priceFeed));

        uint160 flags = HookFlags.AFTER_INITIALIZE_FLAG |
                        HookFlags.BEFORE_SWAP_FLAG |
                        HookFlags.BEFORE_SWAP_RETURNS_DELTA_FLAG |
                        HookFlags.AFTER_SWAP_FLAG |
                        HookFlags.AFTER_SWAP_RETURNS_DELTA_FLAG;

        bytes memory bytecode = abi.encodePacked(
            type(EswapMarginHook).creationCode,
            abi.encode(pm, address(priceFeed))
        );
        bytes32 bytecodeHash = keccak256(bytecode);

        bytes32 salt;
        bool found = false;
        for (uint256 i = 0; i < 1_000_000; i++) {
            salt = bytes32(i);
            address computed = address(uint160(uint256(keccak256(abi.encodePacked(
                bytes1(0xff), deployer, salt, bytecodeHash
            )))));
            if (uint160(computed) & flags == flags) {
                found = true;
                break;
            }
        }
        require(found, "Could not mine hook salt");

        EswapMarginHook hook = new EswapMarginHook{salt: salt}(IPoolManager(address(pm)), IPriceFeed(address(priceFeed)));
        console.log("Hook deployed at:", address(hook));

        EswapRouter router = new EswapRouter(IPoolManager(address(pm)));
        console.log("Router deployed at:", address(router));

        hook.setRouter(address(router));

        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(WETH),
            currency1: Currency.wrap(USDC),
            fee: 3000,
            tickSpacing: 60,
            hooks: IHooks(address(hook))
        });

        uint160 sqrtPriceX96 = TickMath.getSqrtRatioAtTick(-263813);
        pm.initialize(key, sqrtPriceX96);

        PoolId poolId = key.toId();
        hook.setAuthorizedPool(poolId, true);

        vm.stopBroadcast();

        console.log("");
        console.log("=== Deployment Summary ===");
        console.log("Network: Unichain Mainnet (Chain ID 130)");
        console.log(string.concat("PoolManager: ", vm.toString(address(pm))));
        console.log(string.concat("Hook:        ", vm.toString(address(hook))));
        console.log(string.concat("Router:      ", vm.toString(address(router))));
        console.log(string.concat("PriceFeed:   ", vm.toString(address(priceFeed))));
        console.log("");
        console.log("=== Next Steps ===");
        console.log("1. Configure Chainlink price feeds on PriceFeed (required for liquidations):");
        console.log(string.concat("   priceFeed.setPriceFeed(WETH, <WETH/USD feed>)"));
        console.log(string.concat("   priceFeed.setPriceFeed(USDC, <USDC/USD feed>)"));
        console.log("2. Set treasury address for protocol fee withdrawal:");
        console.log(string.concat("   hook.setTreasury(<treasury address>)"));
        console.log("3. (Optional) Seed insurance fund for bad-debt coverage:");
        console.log(string.concat("   hook.seedInsuranceFund(WETH, amount)"));
        console.log(string.concat("   hook.seedInsuranceFund(USDC, amount)"));
        console.log("4. Update .env and run: node javascript/update-dashboard.js");
        console.log(string.concat("   V4_HOOK_ADDRESS=", vm.toString(address(hook))));
        console.log(string.concat("   V4_ROUTER_ADDRESS=", vm.toString(address(router))));
    }
}
