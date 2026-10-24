// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {EswapRouter} from "../../src/v4/EswapRouter.sol";
import {EswapLeverageQuoter} from "../../src/v4/EswapLeverageQuoter.sol";
import {PoolKey} from "../../src/v4/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "../../src/v4/types/PoolId.sol";
import {Currency} from "../../src/v4/types/Currency.sol";

/// @notice Deploys ONLY {EswapLeverageQuoter} against an ALREADY-LIVE
///         EswapRouter, then registers the WETH/USDC route so aggregators can
///         pre-route leveraged opens. This is the "router exists, quoter is
///         missing/stale" path (e.g. Base mainnet, where `.env`
///         `V4_QUOTER_ADDRESS` had no code).
///
///         The quoter holds no funds: it only reads the pool registry and
///         delegates to {EswapRouter.quoteExactInput}. Registration is owner-only
///         and the deployer must be the router owner's EOA (== quoter owner).
///
///         Required env:
///           PRIVATE_KEY           deployer (== router owner for registration)
///           V4_ROUTER_ADDRESS     live EswapRouter on the target chain
///         Optional env (route defaults are Base WETH/USDC):
///           QUOTER_HOOK_POOL_HOOK, QUOTER_HOOK_POOL_FEE, QUOTER_HOOK_POOL_TICK_SPACING,
///           QUOTER_STD_POOL_FEE, QUOTER_STD_POOL_TICK_SPACING,
///           QUOTER_TOKEN_IN, QUOTER_TOKEN_OUT
///
///         Run:
///           forge script scripts/v4/DeployQuoter.s.sol:DeployQuoter \
///             --rpc-url https://mainnet.base.org --via-ir --broadcast --slow
contract DeployQuoter is Script {
    using PoolIdLibrary for PoolKey;

    // --- Base (8453) canonical tokens ---
    address constant WETH = 0x4200000000000000000000000000000000000006;
    address constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);

        address routerAddr = vm.envAddress("V4_ROUTER_ADDRESS");
        require(routerAddr.code.length > 0, "V4_ROUTER_ADDRESS has no code on this chain");
        EswapRouter router = EswapRouter(payable(routerAddr));

        address hook = vm.envOr("QUOTER_HOOK_POOL_HOOK", vm.envOr("V4_HOOK_ADDRESS", address(0)));
        require(hook.code.length > 0, "QUOTER_HOOK_POOL_HOOK/V4_HOOK_ADDRESS has no code");

        address tokenIn = vm.envOr("QUOTER_TOKEN_IN", USDC);
        address tokenOut = vm.envOr("QUOTER_TOKEN_OUT", WETH);

        console.log("=== Eswap Leverage Quoter Deploy ===");
        console.log("Deployer:", deployer);
        console.log("Router:  ", routerAddr);
        console.log("Hook:    ", hook);
        console.log("");

        vm.startBroadcast(pk);

        EswapLeverageQuoter quoter = new EswapLeverageQuoter(router);
        require(address(quoter.router()) == routerAddr, "quoter.router mismatch");

        PoolKey memory hookKey = PoolKey({
            currency0: Currency.wrap(WETH),
            currency1: Currency.wrap(USDC),
            fee: uint24(vm.envOr("QUOTER_HOOK_POOL_FEE", uint256(3000))),
            tickSpacing: int24(int256(vm.envOr("QUOTER_HOOK_POOL_TICK_SPACING", uint256(60)))),
            hooks: hook
        });
        PoolKey memory standardKey = PoolKey({
            currency0: Currency.wrap(WETH),
            currency1: Currency.wrap(USDC),
            fee: uint24(vm.envOr("QUOTER_STD_POOL_FEE", uint256(500))),
            tickSpacing: int24(int256(vm.envOr("QUOTER_STD_POOL_TICK_SPACING", uint256(10)))),
            hooks: address(0)
        });

        quoter.registerPool(tokenIn, tokenOut, hookKey.fee, hookKey, standardKey);

        (PoolKey memory rH, PoolKey memory rS) = quoter.getPoolKey(tokenIn, tokenOut, hookKey.fee);
        require(rH.hooks == hook && rS.fee == standardKey.fee, "registration readback mismatch");

        vm.stopBroadcast();

        console.log(string.concat("LeverageQuoter:   ", vm.toString(address(quoter))));
        console.log(string.concat("  owner:          ", vm.toString(quoter.owner())));
        console.log(string.concat("  registered:     ", vm.toString(tokenIn), "/", vm.toString(tokenOut)));
        console.log(string.concat("  hookPool fee/ts:", vm.toString(uint256(hookKey.fee)), "/", vm.toString(int256(hookKey.tickSpacing))));
        console.log(string.concat("  stdPool fee/ts: ", vm.toString(uint256(standardKey.fee)), "/", vm.toString(int256(standardKey.tickSpacing))));
        console.log(string.concat("  hookPoolId:     ", vm.toString(PoolId.unwrap(hookKey.toId()))));
        console.log("");
        console.log("=== Next Steps ===");
        console.log("1. Add to .env, then: node javascript/update-dashboard.js");
        console.log(string.concat("   V4_QUOTER_ADDRESS=", vm.toString(address(quoter))));
    }
}
