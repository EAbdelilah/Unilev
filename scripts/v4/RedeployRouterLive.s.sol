// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {IPoolManager} from "../../src/v4/interfaces/IPoolManager.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {EswapMarginHook} from "../../src/v4/EswapMarginHook.sol";
import {EswapRouter} from "../../src/v4/EswapRouter.sol";
import {EswapRouterExt} from "../../src/v4/EswapRouterExt.sol";
import {EswapLiquidationKeeper} from "../../src/v4/EswapLiquidationKeeper.sol";

/// @notice Live on Unichain mainnet: redeploy ONLY the EswapRouter (carrying the
///         measured QUOTE_EXECUTION_DISCOUNT_BPS) + a fresh keeper bound to it, and
///         repoint the EXISTING deployed hook at the new router.
///
///         Every hook config field is READ FROM CHAIN and re-applied unchanged;
///         `router` is the only value this script alters. It then asserts the
///         config is bit-identical afterwards. An earlier version hardcoded these
///         values and had drifted from the live hook in ways that would have
///         halved `reserveFactor`, disabled `requireTwapOracle`, and raised
///         `minCollateralUsd` from $0.01 to $0.05.
///
///         The hook, its pools, base currency and standard-pool key are untouched.
contract RedeployRouterLive is Script {
    address constant UNICHAIN_PM = 0x1F98400000000000000000000000000000000004;

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);
        address hookAddr = vm.envAddress("V4_HOOK_ADDRESS");
        address solver = vm.envAddress("SOLVER_ADDRESS");

        // Read the live config and carry it through UNCHANGED.
        //
        // This block used to hardcode the values, which had silently drifted from
        // the deployed hook. Had it run as written it would have:
        //   reserveFactor        10 -> 5      (halved the protocol reserve)
        //   requireTwapOracle  true -> false  (DISABLED the TWAP oracle check)
        //   minCollateralUsd  $0.01 -> $0.05   (made $0.01 canaries revert)
        // The only field this deploy is allowed to change is `router`.
        EswapMarginHook live = EswapMarginHook(payable(hookAddr));

        address treasury = live.treasury();
        uint256 reserveFactor = live.reserveFactor();
        uint160 maxPriceSwingBps = live.maxPriceSwingBps();
        uint8 defaultMaxLeverage = live.defaultMaxLeverage();
        bool requireTwapOracle = live.requireTwapOracle();
        uint256 minCollateralUsd = live.minCollateralUsd();
        address oldRouter = live.router();

        console.log("=== live config carried through ===");
        console.log("  old router            :", oldRouter);
        console.log("  treasury              :", treasury);
        console.log("  reserveFactor         :", reserveFactor);
        console.log("  maxPriceSwingBps      :", maxPriceSwingBps);
        console.log("  defaultMaxLeverage    :", defaultMaxLeverage);
        console.log("  requireTwapOracle     :", requireTwapOracle);
        console.log("  minCollateralUsd      :", minCollateralUsd);
        require(treasury != address(0), "treasury unset on live hook");
        require(minCollateralUsd > 0, "minCollateralUsd unset on live hook");

        vm.startBroadcast(pk);

        EswapRouter router = new EswapRouter(IPoolManager(UNICHAIN_PM));
        console.log("Router deployed at:", address(router));

        // Companion surface holder (ERC-7683, trigger orders, JIT, atomic margin)
        // bound to the fresh core router.
        EswapRouterExt routerExt = new EswapRouterExt(IPoolManager(UNICHAIN_PM), address(router));
        console.log("RouterExt deployed at:", address(routerExt));
        router.setRouterExt(address(routerExt));
        // [AUDIT CRIT-4] The companion relays swapMultiPoolFor on behalf of
        // cross-chain/atomic traders; whitelist it as a router executor.
        router.setExecutorWhitelist(address(routerExt), true);

        EswapLiquidationKeeper keeper = new EswapLiquidationKeeper(hookAddr, address(router));
        console.log("Keeper deployed at:", address(keeper));

        EswapMarginHook hook = EswapMarginHook(payable(hookAddr));
        hook.setConfig(EswapMarginHook.ConfigParams({
            treasury: treasury,
            router: address(router),
            reserveFactor: reserveFactor,
            maxPriceSwingBps: maxPriceSwingBps,
            defaultMaxLeverage: defaultMaxLeverage,
            requireTwapOracle: requireTwapOracle
        }));
        console.log("Hook config repointed -> new router @", address(router));

        hook.setRouterAndMinCollateralUsd(address(router), minCollateralUsd);
        console.log("Hook router/minCollateralUsd repointed:", minCollateralUsd);

        // Post-condition: every field except `router` must be bit-identical, so a
        // silent parameter change cannot pass this script unnoticed.
        require(hook.treasury() == treasury, "treasury drifted");
        require(hook.reserveFactor() == reserveFactor, "reserveFactor drifted");
        require(hook.maxPriceSwingBps() == maxPriceSwingBps, "maxPriceSwingBps drifted");
        require(hook.defaultMaxLeverage() == defaultMaxLeverage, "defaultMaxLeverage drifted");
        require(hook.requireTwapOracle() == requireTwapOracle, "requireTwapOracle drifted");
        require(hook.minCollateralUsd() == minCollateralUsd, "minCollateralUsd drifted");
        require(hook.router() == address(router), "router not repointed");
        console.log("verified: hook config preserved, only router changed");

        router.setSolverWhitelist(solver, true);
        console.log("Solver whitelisted on new router:", solver);

        vm.stopBroadcast();

        console.log("=== Capture these addresses ===");
        console.log(string.concat("V4_ROUTER_ADDRESS=", vm.toString(address(router))));
        console.log(string.concat("V4_ROUTER_EXT_ADDRESS=", vm.toString(address(routerExt))));
        console.log(string.concat("V4_KEEPER_ADDRESS=", vm.toString(address(keeper))));
        console.log("V4_HOOK_ADDRESS unchanged:", hookAddr);
    }
}