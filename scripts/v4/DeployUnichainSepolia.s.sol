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
import {EswapSolverAdapter} from "../../src/v4/EswapSolverAdapter.sol";
import {HookFlags} from "../../src/v4/libraries/HookFlags.sol";

contract DeployUnichainSepolia is Script {
    using PoolIdLibrary for PoolKey;
    using LPFeeLibrary for uint24;

    // Unichain Sepolia testnet addresses
    address constant WETH = 0x4200000000000000000000000000000000000006;
    address constant USDC = 0x31d0220469e10c4e71834a79b1f276d740d3768f;

    // Unichain Sepolia V4 PoolManager (already deployed)
    address constant UNICHAIN_SEPOLIA_PM = 0x00b036b58a818b1bc34d502d3fe730db729e62ac;

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        vm.startBroadcast(deployerPrivateKey);

        // 1. Use existing Unichain Sepolia PoolManager
        PoolManager pm = PoolManager(UNICHAIN_SEPOLIA_PM);
        console.log("Using Unichain Sepolia PoolManager at:", UNICHAIN_SEPOLIA_PM);

        // 2. Compute CREATE2 hook address (priceFeed = address(0), TWAP-only oracle)
        uint160 flags = HookFlags.AFTER_INITIALIZE_FLAG |
                        HookFlags.BEFORE_SWAP_FLAG |
                        HookFlags.BEFORE_SWAP_RETURNS_DELTA_FLAG |
                        HookFlags.AFTER_SWAP_FLAG |
                        HookFlags.AFTER_SWAP_RETURNS_DELTA_FLAG;

        bytes memory bytecode = abi.encodePacked(
            type(EswapMarginHook).creationCode,
            abi.encode(pm, address(0))
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

        // 3. Deploy hook (TWAP-only oracle, no Chainlink dependency)
        EswapMarginHook hook = new EswapMarginHook{salt: salt}(IPoolManager(address(pm)), IPriceFeed(address(0)));
        console.log("Hook deployed at:", address(hook));

        // 4. Deploy router
        EswapRouter router = new EswapRouter(IPoolManager(address(pm)));
        console.log("Router deployed at:", address(router));

        // 5. Deploy solver adapter (aggregator convenience wrapper)
        EswapSolverAdapter adapter = new EswapSolverAdapter(address(router));
        console.log("SolverAdapter deployed at:", address(adapter));

        // 6. Configure hook
        hook.setRouter(address(router));

        // 7. Initialize the WETH/USDC pool (0.30% fee)
        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(WETH),
            currency1: Currency.wrap(USDC),
            fee: 3000,
            tickSpacing: 60,
            hooks: IHooks(address(hook))
        });

        // sqrtPriceX96 for ~$3500 ETH/USDC on testnet (price is arbitrary on testnet)
        uint160 sqrtPriceX96 = TickMath.getSqrtRatioAtTick(-263813);
        pm.initialize(key, sqrtPriceX96);

        // 8. Authorize the pool
        PoolId poolId = key.toId();
        hook.setAuthorizedPool(poolId, true);

        vm.stopBroadcast();

        // 9. Print deployment summary
        console.log("");
        console.log("=== Deployment Summary ===");
        console.log("Network: Unichain Sepolia Testnet (Chain ID 1301)");
        console.log(string.concat("PoolManager: ", vm.toString(address(pm))));
        console.log(string.concat("Hook:        ", vm.toString(address(hook))));
        console.log(string.concat("Router:      ", vm.toString(address(router))));
        console.log(string.concat("Adapter:     ", vm.toString(address(adapter))));
        console.log("Oracle:      TWAP-only (no Chainlink dependency)");
        console.log("Pool:        WETH/USDC 0.30%");
        console.log("");
        console.log("=== Next Steps ===");
        console.log("1. Seed leverage capacity (covers bad debt on liquidation):");
        console.log(string.concat("   hook.seedLeverageCapacity(WETH, amount)"));
        console.log(string.concat("   hook.seedLeverageCapacity(USDC, amount)"));
        console.log("2. Fund test traders with testnet WETH + USDC for collateral");
        console.log("3. Update .env and run: node javascript/update-dashboard.js");
        console.log(string.concat("   V4_HOOK_ADDRESS=", vm.toString(address(hook))));
        console.log(string.concat("   V4_ROUTER_ADDRESS=", vm.toString(address(router))));
        console.log(string.concat("   V4_ADAPTER_ADDRESS=", vm.toString(address(adapter))));
    }
}
