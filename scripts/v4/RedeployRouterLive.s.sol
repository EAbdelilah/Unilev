// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {IPoolManager} from "../../src/v4/interfaces/IPoolManager.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {EswapMarginHook} from "../../src/v4/EswapMarginHook.sol";
import {EswapRouter} from "../../src/v4/EswapRouter.sol";
import {EswapLiquidationKeeper} from "../../src/v4/EswapLiquidationKeeper.sol";

/// @notice Live on Unichain mainnet: redeploy ONLY the stale EswapRouter (predates
///         swap/swapMultiPool) + a fresh keeper bound to it, and repoint the
///         EXISTING deployed hook at the new router while preserving the live
///         hook config (read on-chain before this deploy):
///           treasury          0x5186...
///           reserveFactor     5
///           maxPriceSwingBps  800
///           defaultMaxLeverage 5
///           requireTwapOracle false
///           minCollateralUsd  50000000000000000 ($0.05)
///         The hook, its pools, base currency and standard-pool key are untouched.
contract RedeployRouterLive is Script {
    address constant UNICHAIN_PM = 0x1F98400000000000000000000000000000000004;

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);
        address hookAddr = vm.envAddress("V4_HOOK_ADDRESS");
        address solver = vm.envAddress("SOLVER_ADDRESS");

        // Preserve the live config values.
        uint256 reserveFactor = 5;
        uint160 maxPriceSwingBps = 800;
        uint8 defaultMaxLeverage = 5;
        bool requireTwapOracle = false;
        uint256 minCollateralUsd = 50000000000000000;

        vm.startBroadcast(pk);

        EswapRouter router = new EswapRouter(IPoolManager(UNICHAIN_PM));
        console.log("Router deployed at:", address(router));

        EswapLiquidationKeeper keeper = new EswapLiquidationKeeper(hookAddr, address(router));
        console.log("Keeper deployed at:", address(keeper));

        EswapMarginHook hook = EswapMarginHook(payable(hookAddr));
        hook.setConfig(EswapMarginHook.ConfigParams({
            treasury: deployer,
            router: address(router),
            reserveFactor: reserveFactor,
            maxPriceSwingBps: maxPriceSwingBps,
            defaultMaxLeverage: defaultMaxLeverage,
            requireTwapOracle: requireTwapOracle
        }));
        console.log("Hook config repointed -> new router @", address(router));

        hook.setRouterAndMinCollateralUsd(address(router), minCollateralUsd);
        console.log("Hook router/minCollateralUsd repointed:", minCollateralUsd);

        router.setSolverWhitelist(solver, true);
        console.log("Solver whitelisted on new router:", solver);

        vm.stopBroadcast();

        console.log("=== Capture these addresses ===");
        console.log(string.concat("V4_ROUTER_ADDRESS=", vm.toString(address(router))));
        console.log(string.concat("V4_KEEPER_ADDRESS=", vm.toString(address(keeper))));
        console.log("V4_HOOK_ADDRESS unchanged:", hookAddr);
    }
}