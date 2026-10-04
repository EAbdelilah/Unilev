// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {PoolKey} from "../../src/v4/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "../../src/v4/types/PoolId.sol";
import {Currency} from "../../src/v4/types/Currency.sol";
import {EswapMarginHook} from "../../src/v4/EswapMarginHook.sol";
import {EswapRouter} from "../../src/v4/EswapRouter.sol";
import {EswapLeverageAdapter} from "../../src/v4/EswapLeverageAdapter.sol";
import {EswapLeverageQuoter} from "../../src/v4/EswapLeverageQuoter.sol";
import {
    EswapArbitrageExecutor,
    IFlashLoanProvider,
    IEswapLeverageAdapter,
    IEswapRouter
} from "../../contracts/EswapArbitrageExecutor.sol";
import {InventoryFlashProvider} from "../../contracts/InventoryFlashProvider.sol";
import {UniswapV3Venue} from "../../contracts/UniswapV3Venue.sol";

/// @notice Deploy the ARBITRAGE EXECUTOR together with its zero-premium funding
///         source, then hand the independent V3 unwind venue over to it.
///
///         Funding: `InventoryFlashProvider` -- a Balancer-V2-shaped
///         `Vault.flashLoan` provider that lends its own inventory for one
///         transaction. It charges NO premium and NO interest, so the round trip's
///         cost floor has no flash leg at all.
///
///         Why not the alternatives:
///           - Balancer V2 is not deployed on Unichain. The canonical
///             0xBA12222222228d8Ba445958a75a0704d566BF2C8 is an unrelated 1.5KB
///             contract with no `flashLoan` / `getPoolTokens` and no proxy slot.
///           - Morpho Blue is not deployed on Unichain.
///           - Aave charges a premium and is explicitly out of scope.
///           - A Uniswap V4 `flash()` source is structurally impossible: it would
///             hold the PoolManager lock across `receiveFlashLoan`, while the
///             executor's own router leg must enter `PoolManager.unlock` for its V4
///             swap, and `unlock` reverts `AlreadyUnlocked` when already unlocked.
///
///         `_flashProvider` is IMMUTABLE, so the provider is deployed first and the
///         executor is bound to it in one transaction. Every pool key used to
///         configure the canary is read back from the hook's `standardPoolKeys`
///         registry rather than trusted from config.
contract DeployExecutorLive is Script {
    using PoolIdLibrary for PoolKey;

    address constant USDC = 0x078D782b760474a361dDA0AF3839290b0EF57AD6;
    address constant NATIVE = 0x0000000000000000000000000000000000000000;
    uint24 constant HOOK_POOL_FEE = 3000;
    int24 constant HOOK_POOL_TS = 60;

    /// @dev Executor caps. The flash cap is a hard ceiling on a single loan; the
    ///      provider's actual balance is the real limit, so funding is the risk knob.
    uint256 constant MAX_FLASH_AMOUNT = 5_000_000_000; // 5,000 USDC (6dp)
    uint8 constant MAX_LEVERAGE = 5;
    /// @dev Structurally zero: `InventoryFlashProvider` has no fee field at all.
    uint16 constant MAX_PREMIUM_BPS = 0;
    /// @dev `EswapArbitrageExecutor.FlashMode.Balancer` == 1, i.e. the Balancer V2
    ///      `Vault.flashLoan` INTERFACE SHAPE, which the provider implements.
    uint8 constant FLASH_MODE_BALANCER = 1;

    /// @dev Inventory seeded into the provider. 0.05 USDC = 50,000 (6dp), which is
    ///      5x the $0.01 (10,000) production margin. The owner can `withdraw` it or
    ///      `fund` more at any time.
    uint256 constant PROVIDER_SEED = 50_000;

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);
        address hookAddr = vm.envAddress("V4_HOOK_ADDRESS");
        address routerAddr = vm.envAddress("V4_ROUTER_ADDRESS");
        address adapterAddr = vm.envAddress("V4_ADAPTER_ADDRESS");
        address quoterAddr = vm.envAddress("V4_QUOTER_ADDRESS");
        address venueAddr = vm.envAddress("ARBITRAGE_VENUE_ADDRESS");

        EswapMarginHook hook = EswapMarginHook(payable(hookAddr));
        require(hook.router() == routerAddr, "hook is not bound to V4_ROUTER_ADDRESS");
        require(hook.owner() == deployer, "deployer is not the hook owner");

        EswapLeverageAdapter adapter = EswapLeverageAdapter(adapterAddr);
        require(address(adapter.router()) == routerAddr, "adapter router mismatch");
        require(EswapRouter(payable(routerAddr)).executorWhitelist(adapterAddr), "adapter not whitelisted");

        EswapLeverageQuoter quoter = EswapLeverageQuoter(quoterAddr);
        require(address(quoter.router()) == routerAddr, "quoter router mismatch");

        UniswapV3Venue venue = UniswapV3Venue(payable(venueAddr));
        require(venue.owner() == deployer, "venue is not owned by the deployer");

        require(IERC20(USDC).balanceOf(deployer) >= PROVIDER_SEED, "deployer needs USDC to seed the provider");

        PoolKey memory hookKey = PoolKey({
            currency0: Currency.wrap(NATIVE),
            currency1: Currency.wrap(USDC),
            fee: HOOK_POOL_FEE,
            tickSpacing: HOOK_POOL_TS,
            hooks: hookAddr
        });
        PoolId hookPoolId = hookKey.toId();

        // Source of truth = the hook's own registry, not our config.
        (Currency r0, Currency r1, uint24 sFee, int24 sTs, address sHooks) = hook.standardPoolKeys(hookPoolId);
        address s1 = Currency.unwrap(r1);
        require(s1 == USDC, "hook has no standard pool registered for this hook pool");
        require(Currency.unwrap(r0) == NATIVE, "registry currency pair mismatch");
        require(sHooks == address(0), "standard pool must be a hookless pool");
        require(sFee != 0 && sFee != HOOK_POOL_FEE, "standard pool fee mismatch");

        PoolKey memory stdKey = PoolKey({
            currency0: r0,
            currency1: r1,
            fee: sFee,
            tickSpacing: sTs,
            hooks: sHooks
        });

        vm.startBroadcast(pk);

        // 1. Funding source. No fee is configured because there is no fee field.
        InventoryFlashProvider provider = new InventoryFlashProvider();
        console.log("InventoryFlashProvider deployed:", address(provider));

        IERC20(USDC).approve(address(provider), PROVIDER_SEED);
        provider.fund(USDC, PROVIDER_SEED);
        console.log("Provider seeded with (6dp USDC):", PROVIDER_SEED);

        // 2. Executor, bound to the provider.
        EswapArbitrageExecutor executor = new EswapArbitrageExecutor(
            IFlashLoanProvider(address(provider)),
            IEswapLeverageAdapter(adapterAddr),
            IEswapRouter(payable(routerAddr)),
            MAX_FLASH_AMOUNT,
            MAX_LEVERAGE,
            uint256(MAX_PREMIUM_BPS),
            EswapArbitrageExecutor.FlashMode(FLASH_MODE_BALANCER)
        );
        console.log("EswapArbitrageExecutor deployed:", address(executor));

        // 3. Only the executor may drive the independent unwind venue.
        venue.transferOwnership(address(executor));
        console.log("V3 venue ownership transferred to the executor");

        vm.stopBroadcast();

        // ---- post-conditions -------------------------------------------------
        require(address(provider.owner()) == deployer, "provider owner mismatch");
        require(IERC20(USDC).balanceOf(address(provider)) == PROVIDER_SEED, "provider seed mismatch");
        require(address(executor.flashProvider()) == address(provider), "executor provider mismatch");
        require(address(executor.adapter()) == adapterAddr, "executor adapter mismatch");
        require(address(executor.router()) == routerAddr, "executor router mismatch");
        require(executor.flashMode() == EswapArbitrageExecutor.FlashMode(FLASH_MODE_BALANCER), "executor flash mode mismatch");
        require(executor.maxPremiumBps() == MAX_PREMIUM_BPS, "executor premium ceiling mismatch");
        require(venue.owner() == address(executor), "venue should be owned by the executor");

        // Cross-check the registry the canary will be configured against.
        (PoolKey memory regHookKey, PoolKey memory regStdKey) = adapter.poolRegistry(USDC, NATIVE, HOOK_POOL_FEE);
        require(Currency.unwrap(regHookKey.currency0) == NATIVE, "adapter reg tokenIn");
        require(Currency.unwrap(regHookKey.currency1) == USDC, "adapter reg tokenOut");
        require(regHookKey.fee == HOOK_POOL_FEE && regHookKey.hooks == hookAddr, "adapter reg hook key");
        require(regStdKey.fee == sFee && regStdKey.hooks == address(0), "adapter reg std key");

        console.log("");
        console.log("=== addresses to record in .env ===");
        console.log("  FLASH_PROVIDER_ADDRESS     =", address(provider));
        console.log("  ARBITRAGE_EXECUTOR_ADDRESS =", address(executor));
        console.log("");
        console.log("  NOTE: `setCanaryRoute` is NOT called here. It needs live quoter");
        console.log("        outputs for the slippage floors, so it is set off-chain after");
        console.log("        the market state is sampled.");
    }
}