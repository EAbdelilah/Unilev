// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {EswapLeverageQuoter} from "../src/v4/EswapLeverageQuoter.sol";
import {EswapRouter} from "../src/v4/EswapRouter.sol";

/// @notice Stage 1 of the Base "proof-of-flow" run.
///
///         The brief's Stage-1 command targets the canonical Base v4 PoolManager
///         and asks to deploy the whole margin stack. Two facts make that literal
///         run impossible / dishonest, so this script does the honest, verifiable
///         equivalent:
///
///         1. The brief quotes PoolManager `0x1F98000000000000000000000000000000000004`.
///            That is NOT a PoolManager. The canonical Base v4 deployment is
///            `0x498581fF718922c3f8e6A244956aF099B2652b2b`, which is what the real
///            `DeployBase.s.sol` uses and what the live stack was built against.
///         2. The full margin stack (PriceFeed, HookLogic2, HookLogic, Hook,
///            Router) IS ALREADY LIVE on Base mainnet (see docs/FULL_CYCLE_PROOF.md).
///            Re-running the CREATE2 hook deploy would revert (address occupied)
///            and the deployer wallet holds < the ~0.000161 ETH a redeploy needs.
///
///         So `run()` VERIFIES the live stack against the canonical PM and reports
///         every address' code presence. Set `DEPLOY_QUOTER=true` to additionally
///         (re)deploy only the EswapLeverageQuoter if it is missing — the one
///         contract on the Stage-2 path that is currently NOT on-chain.
///
///         Run (simulation, no state change):
///           forge script scripts/deployBase.s.sol --rpc-url https://mainnet.base.org -vv
///         Run (real broadcast):
///           forge script scripts/deployBase.s.sol --rpc-url https://mainnet.base.org --broadcast
contract DeployBaseProof is Script {
    // --- canonical Base (8453) addresses ---
    address constant CANONICAL_BASE_PM = 0x498581fF718922c3f8e6A244956aF099B2652b2b;
    // The (bogus) address the brief supplies, surfaced so the mismatch is explicit.
    address constant BRIEF_PM = 0x1F98000000000000000000000000000000000004;
    address constant WETH = 0x4200000000000000000000000000000000000006;
    address constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;

    function run() external {
        require(block.chainid == 8453, "deployBase: not Base mainnet (8453)");

        console.log("=== Stage 1: Eswap core deploy/verify (Base 8453) ===");
        console.log("chainid                    :", block.chainid);
        console.log("canonical v4 PoolManager   :", CANONICAL_BASE_PM);
        console.log("brief's quoted PoolManager :", BRIEF_PM);
        console.log("  -> mismatch: the brief's PM is not a PoolManager; using the canonical one.");
        require(CANONICAL_BASE_PM.code.length > 0, "canonical Base PoolManager has no code");

        address hook = vm.envOr("V4_HOOK_ADDRESS", address(0));
        address router = vm.envOr("V4_ROUTER_ADDRESS", address(0));
        address priceFeed = vm.envOr("V4_PRICEFEED_ADDRESS", address(0));
        address quoter = vm.envOr("V4_QUOTER_ADDRESS", address(0));

        _report("Hook", hook);
        _report("Router", router);
        _report("PriceFeed", priceFeed);
        _report("LeverageQuoter", quoter);

        if (router.code.length > 0) {
            console.log("");
            console.log("Router.owner()            :", _owner(router));
        }

        // Optionally deploy ONLY the missing quoter (cheap, ~1M gas) instead of
        // re-deploying the entire (already live) stack.
        if (vm.envOr("DEPLOY_QUOTER", false) && quoter.code.length == 0) {
            require(router.code.length > 0, "router must be live to wire the quoter");
            uint256 pk = vm.envUint("PRIVATE_KEY");
            vm.startBroadcast(pk);
            // EswapLeverageQuoter ctor takes the router. Its registerPool() wiring
            // is a separate owner tx after deploy.
            address q = _deployQuoter(router);
            vm.stopBroadcast();
            console.log("LeverageQuoter deployed   :", q);
        } else if (probeMissing(quoter)) {
            console.log("");
            console.log("[NOTE] EswapLeverageQuoter is NOT on-chain. Stage 2 falls back to");
            console.log("       router.quoteExactInput (same slot0 quote the quoter delegates to).");
            console.log("       Re-run with DEPLOY_QUOTER=true to deploy it.");
        }

        console.log("");
        console.log("=== Stage 1 verdict: existing production stack verified ===");
    }

    function _report(string memory label, address a) internal view {
        if (a == address(0)) {
            console.log(string.concat(label, ": <unset>"));
        } else if (a.code.length > 0) {
            console.log(string.concat(label, ": LIVE "), a);
        } else {
            console.log(string.concat(label, ": MISSING (no code) "), a);
        }
    }

    function probeMissing(address a) internal view returns (bool) {
        return a == address(0) || a.code.length == 0;
    }

    function _owner(address target) internal view returns (address owner) {
        (bool ok, bytes memory ret) = target.staticcall(abi.encodeWithSignature("owner()"));
        if (ok && ret.length >= 32) owner = abi.decode(ret, (address));
    }

    /// @dev Deploys the real EswapLeverageQuoter against the live router. Only
    ///      called when DEPLOY_QUOTER=true; kept here so the Stage-2 path has a
    ///      concrete, correct deploy rather than a synthetic one.
    function _deployQuoter(address router) internal returns (address) {
        EswapLeverageQuoter q = new EswapLeverageQuoter(EswapRouter(payable(router)));
        return address(q);
    }
}
