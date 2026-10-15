// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {StdCheats} from "forge-std/StdCheats.sol";
import {console} from "forge-std/console.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {EswapRouter} from "../../src/v4/EswapRouter.sol";
import {EswapLeverageQuoter} from "../../src/v4/EswapLeverageQuoter.sol";
import {EswapFlashVault} from "../../src/v4/EswapFlashVault.sol";
import {PoolKey} from "../../src/v4/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "../../src/v4/types/PoolId.sol";
import {Currency} from "../../src/v4/types/Currency.sol";

/// @notice Stage 1 (fork-only): stand up the Eswap Base stack on a forked Base
///         node and deploy the two periphery contracts the pipeline needs that
///         are NOT part of {DeployBase}:
///
///           - EswapFlashVault   (seeded backup liquidity)
///           - EswapLeverageQuoter (registered WETH/USDC route)
///
///         It deliberately does NOT redeploy the hook/router: a Base fork
///         already carries the LIVE deployment, so the correct thing to verify
///         is that those live contracts are present, then wire the periphery to
///         them. Passing `--fork-url` to a Base RPC supplies the state.
///
/// @dev Run (no spend; fork only):
///        forge script scripts/v4/SetupBaseFork.s.sol:SetupBaseFork \
///          --rpc-url https://mainnet.base.org --via-ir
///
///      The task brief specified `0x1F98...0004` as the Base PoolManager. That
///      is the UNICHAIN address; the canonical Base PoolManager is
///      `0x498581fF718922c3f8e6A244956aF099B2652b2b` (used below).
contract SetupBaseFork is Script, StdCheats {
    using PoolIdLibrary for PoolKey;

    // --- Base (8453) canonical addresses ---
    address constant WETH = 0x4200000000000000000000000000000000000006;
    address constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address constant BASE_PM = 0x498581fF718922c3f8e6A244956aF099B2652b2b;

    // LIVE Base deployment (from broadcast/DeployBase.s.sol/8453/run-latest.json).
    address constant LIVE_HOOK = 0x7b38f16A40683457Fa46EcC819103613f47C50C8;
    address constant LIVE_ROUTER = 0xaBDD8e37082D232C331B109bC9Ca3c62A992F10F;
    address constant LIVE_PRICEFEED = 0xc7ADfCd1c3A170881eFFa27946AceF047d4DEB06;

    uint256 constant SEED_USDC = 1_000e6; // $1,000 backup liquidity

    function run() external {
        // ---- 0. Assert we are on Base -------------------------------------
        require(block.chainid == 8453, "not Base (chain 8453)");

        address pm = vm.envOr("BASE_POOL_MANAGER", BASE_PM);
        address hookAddr = vm.envOr("BASE_HOOK_ADDRESS", LIVE_HOOK);
        address routerAddr = vm.envOr("BASE_ROUTER_ADDRESS", LIVE_ROUTER);
        address priceFeedAddr = vm.envOr("BASE_PRICEFEED_ADDRESS", LIVE_PRICEFEED);
        address solver = vm.envOr("BASE_SOLVER_ADDRESS", address(0));
        if (solver == address(0)) {
            uint256 solverPk = vm.envOr("BASE_SOLVER_PRIVATE_KEY", uint256(0));
            if (solverPk != 0) solver = vm.addr(solverPk);
        }

        _requireCode(pm, "PoolManager");
        _requireCode(hookAddr, "EswapMarginHook");
        _requireCode(routerAddr, "EswapRouter");
        _requireCode(priceFeedAddr, "PriceFeed");

        console.log("=== Stage 1: Base fork verified ===");
        console.log("chainId      :", block.chainid);
        console.log("PoolManager  :", pm);
        console.log("Hook         :", hookAddr);
        console.log("Router       :", routerAddr);
        console.log("PriceFeed    :", priceFeedAddr);

        // ---- 1. Deploy EswapFlashVault -----------------------------------
        uint256 pk = vm.envOr("PRIVATE_KEY", uint256(0));
        vm.startBroadcast(pk);

        EswapFlashVault vault = new EswapFlashVault(IERC20(USDC), msg.sender);
        console.log("FlashVault   :", address(vault));

        // ---- 2. Deploy + register EswapLeverageQuoter --------------------
        EswapLeverageQuoter quoter = new EswapLeverageQuoter(EswapRouter(payable(routerAddr)));

        PoolKey memory hookKey = PoolKey({
            currency0: Currency.wrap(WETH),
            currency1: Currency.wrap(USDC),
            fee: 3000,
            tickSpacing: 60,
            hooks: hookAddr
        });
        PoolKey memory standardKey = PoolKey({
            currency0: Currency.wrap(WETH),
            currency1: Currency.wrap(USDC),
            fee: 500,
            tickSpacing: 10,
            hooks: address(0)
        });

        quoter.registerPool(USDC, WETH, 3000, hookKey, standardKey);
        console.log("LeverageQuoter:", address(quoter));
        console.log("  registered USDC/WETH fee=3000");
        console.logBytes32(PoolId.unwrap(hookKey.toId()));

        if (solver != address(0)) {
            vault.setSolver(solver);
            console.log("  vault solver:", solver);
        } else {
            console.log("  [WARN] BASE_SOLVER_ADDRESS unset; vault.solver left unset");
        }

        vm.stopBroadcast();

        // ---- 3. Best-effort seed (fork `deal`, no real funds) ------------
        _seed(vault, vm.envOr("TREASURY", msg.sender));

        console.log("");
        console.log("=== Fork stack ready ===");
        console.log("  BASE_FLASHVAULT_ADDRESS=", address(vault));
        console.log("  BASE_QUOTER_ADDRESS=", address(quoter));
    }

    function _seed(EswapFlashVault vault, address from) internal {
        // forge-std `deal` brute-forces the balance slot. On Base USDC (a
        // FiatTokenV2 proxy) this usually works; if it does not, we log and
        // continue rather than failing the whole setup. `deal` lives in a
        // separate helper because scripts may not reference `address(this)`.
        ForkSeeder seeder = new ForkSeeder();
        try seeder.dealToken(USDC, from, SEED_USDC) {
            vm.startPrank(from);
            IERC20(USDC).approve(address(vault), SEED_USDC);
            vault.fund(SEED_USDC);
            vm.stopPrank();
            console.log("FlashVault seeded with", SEED_USDC, "USDC (raw)");
        } catch {
            console.log("[WARN] USDC deal failed on this node; vault left unseeded");
        }
    }

    function _requireCode(address target, string memory label) internal view {
        require(target.code.length > 0, string.concat(label, ": no code on this fork"));
    }
}

/// @dev Standalone helper so the fork `deal` can be attempted via try/catch.
contract ForkSeeder is StdCheats {
    function dealToken(address token, address to, uint256 amount) external {
        deal(token, to, amount);
    }
}
