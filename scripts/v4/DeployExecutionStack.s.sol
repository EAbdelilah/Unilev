// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {PoolKey} from "../../src/v4/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "../../src/v4/types/PoolId.sol";
import {Currency} from "../../src/v4/types/Currency.sol";
import {EswapMarginHook} from "../../src/v4/EswapMarginHook.sol";
import {EswapRouter} from "../../src/v4/EswapRouter.sol";
import {EswapLeverageAdapter} from "../../src/v4/EswapLeverageAdapter.sol";
import {EswapLeverageQuoter} from "../../src/v4/EswapLeverageQuoter.sol";
import {UniswapV3Venue} from "../../contracts/UniswapV3Venue.sol";

/// @notice Deploy the pieces of the execution stack that are safe to deploy
///         today: the leveraged ADAPTER, the leveraged QUOTER and the independent
///         Uniswap V3 unwind VENUE.
///
///         The EXECUTOR is deliberately NOT deployed here. Its `_flashProvider`
///         is an immutable constructor argument and `FlashMode.Balancer` calls
///         `IBalancerVault.flashLoan` / `receiveFlashLoan`. Unichain has no
///         Balancer V2 Vault: the canonical address
///         0xBA12222222228d8Ba445958a75a0704d566BF2C8 is a Uniswap-style router
///         on this chain (1.5KB, no `flashLoan`, no `getPoolTokens`), so pointing
///         the executor there would mint a permanently reverting contract that
///         cannot be repaired without redeploying. The fork harness only ever
///         worked because it used `TestBalancerVault`, a mock.
///
///         Every pool key is cross-checked against the hook's own
///         `standardPoolKeys` registry instead of being trusted from config --
///         hardcoded config is what silently broke the router redeploy.
contract DeployExecutionStack is Script {
    using PoolIdLibrary for PoolKey;

    address constant USDC = 0x078D782b760474a361dDA0AF3839290b0EF57AD6;
    address constant NATIVE = 0x0000000000000000000000000000000000000000;
    address constant WETH = 0x4200000000000000000000000000000000000006;
    address constant V3_FACTORY = 0x1F98400000000000000000000000000000000003;
    uint24 constant HOOK_POOL_FEE = 3000;
    int24 constant HOOK_POOL_TS = 60;

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);
        address hookAddr = vm.envAddress("V4_HOOK_ADDRESS");
        address routerAddr = vm.envAddress("V4_ROUTER_ADDRESS");
        address solver = vm.envAddress("SOLVER_ADDRESS");

        EswapMarginHook hook = EswapMarginHook(payable(hookAddr));
        require(hook.router() == routerAddr, "hook is not bound to V4_ROUTER_ADDRESS");
        require(hook.owner() == deployer, "deployer is not the hook owner");

        PoolKey memory hookKey = PoolKey({
            currency0: Currency.wrap(NATIVE),
            currency1: Currency.wrap(USDC),
            fee: HOOK_POOL_FEE,
            tickSpacing: HOOK_POOL_TS,
            hooks: hookAddr
        });
        PoolId hookPoolId = hookKey.toId();

        // Source of truth = the hook's own registry, not our config.
        (Currency r0, Currency r1, uint24 sFee, int24 sTs, address sHooks) =
            hook.standardPoolKeys(hookPoolId);
        address s0 = Currency.unwrap(r0);
        address s1 = Currency.unwrap(r1);
// `currency0 == address(0)` is native ETH, so it CANNOT be used as an
        // "is it registered" sentinel -- a registered native pair and an
        // unregistered (all-zero) entry look identical on that field alone.
        // `currency1`/`fee` are used instead.
        require(s1 == USDC, "hook has no standard pool registered for this hook pool");
        require(s0 == NATIVE, "registry currency pair mismatch");
        // The standard pool is a separate, HOOKLESS deep pool -- the hook's fills
        // route into it. It must NOT be the hook pool itself.
        require(sHooks == address(0), "standard pool must be a hookless pool");
        require(sFee != 0 && sFee != HOOK_POOL_FEE, "standard pool fee mismatch");

        PoolKey memory stdKey = PoolKey({
            currency0: r0,
            currency1: r1,
            fee: sFee,
            tickSpacing: sTs,
            hooks: sHooks
        });

        console.log("=== source of truth (hook registry) ===");
        console.log("  hook pool     fee", uint256(HOOK_POOL_FEE), "ts", uint256(int256(HOOK_POOL_TS)));
        console.log("  standard pool fee", uint256(sFee), "ts", uint256(int256(sTs)));

        vm.startBroadcast(pk);

        EswapLeverageAdapter adapter = new EswapLeverageAdapter(EswapRouter(payable(routerAddr)));
        adapter.registerPool(USDC, NATIVE, HOOK_POOL_FEE, hookKey, stdKey);
        console.log("Adapter deployed:", address(adapter));

        // The adapter -- not the trader -- is what calls `swapMultiPoolFor`, so the
        // router only accepts it once whitelisted as an executor.
        EswapRouter(payable(routerAddr)).setExecutorWhitelist(address(adapter), true);
        console.log("Adapter whitelisted as router executor");

        EswapLeverageQuoter quoter = new EswapLeverageQuoter(EswapRouter(payable(routerAddr)));
        quoter.registerPool(USDC, NATIVE, HOOK_POOL_FEE, hookKey, stdKey);
        console.log("Quoter deployed:", address(quoter));

        UniswapV3Venue venue = new UniswapV3Venue(V3_FACTORY, WETH);
        console.log("UniswapV3Venue deployed:", address(venue));

        vm.stopBroadcast();

        // ---- post-conditions -------------------------------------------------
        require(address(adapter.router()) == routerAddr, "adapter router mismatch");
        require(address(quoter.router()) == routerAddr, "quoter router mismatch");
        require(EswapRouter(payable(routerAddr)).executorWhitelist(address(adapter)), "adapter not whitelisted");
        require(address(venue.factory()) == V3_FACTORY, "venue factory mismatch");
        require(address(venue.weth()) == WETH, "venue weth mismatch");
        require(venue.owner() == deployer, "venue owner should stay the deployer");

(PoolKey memory regHookKey, PoolKey memory regStdKey) =
            adapter.poolRegistry(USDC, NATIVE, HOOK_POOL_FEE);
        require(Currency.unwrap(regHookKey.currency0) == NATIVE, "adapter reg tokenIn");
        require(Currency.unwrap(regHookKey.currency1) == USDC, "adapter reg tokenOut");
        require(regHookKey.fee == HOOK_POOL_FEE && regHookKey.hooks == hookAddr, "adapter reg hook key");
        require(regStdKey.fee == sFee && regStdKey.hooks == address(0), "adapter reg std key");

        console.log("");
        console.log("=== addresses to record in .env ===");
        console.log("  V4_ADAPTER_ADDRESS        =", address(adapter));
        console.log("  V4_QUOTER_ADDRESS         =", address(quoter));
        console.log("  ARBITRAGE_VENUE_ADDRESS   =", address(venue));
        console.log("");
        console.log("  NOTE: venue ownership intentionally LEFT with the deployer.");
        console.log("        Transfer it to the executor only once a real executor exists.");
    }
}
