// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {PoolManager} from "@uniswap/v4-core/src/PoolManager.sol";
import {IPoolManager as RealIPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey as RealPoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency as RealCurrency} from "@uniswap/v4-core/src/types/Currency.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {PoolId as RealPoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {PoolIdLibrary as RealPoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
// Mirrored local types - used by the EswapMarginHook/Router ABI surface.
import {PoolKey} from "../../src/v4/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "../../src/v4/types/PoolId.sol";
import {Currency} from "../../src/v4/types/Currency.sol";
import {IPoolManager} from "../../src/v4/interfaces/IPoolManager.sol";
import {TickMath} from "../../src/v4/libraries/TickMath.sol";
import {EswapMarginHook, IPriceFeed} from "../../src/v4/EswapMarginHook.sol";
import {EswapMarginLib} from "../../src/v4/EswapMarginLib.sol";
import {EswapRouter} from "../../src/v4/EswapRouter.sol";
import {EswapSolverAdapter} from "../../src/v4/EswapSolverAdapter.sol";
import {EswapLiquidationKeeper} from "../../src/v4/EswapLiquidationKeeper.sol";
import {EswapCoWSettlement} from "../../src/v4/EswapCoWSettlement.sol";
import {EswapLeverageAdapter} from "../../src/v4/EswapLeverageAdapter.sol";
import {EswapLeverageQuoter} from "../../src/v4/EswapLeverageQuoter.sol";
import {HookFlags} from "../../src/v4/libraries/HookFlags.sol";

/// @notice FULL-STACK Unichain Sepolia deployment scope for the solver /
///         aggregator pipeline. Extends DeployUnichainSepolia.s.sol with the
///         three contracts that the live protocol did not deploy anywhere:
///
///            - EswapCoWSettlement      (CoW-compatible order fills)
///            - EswapLeverageAdapter    (ODOS / Enso aggregator entry point)
///            - EswapLeverageQuoter     (pre-routing quote helper)
///
///         Two run modes, driven by .env:
///
///           MODE 1 - fresh full stack (default):
///             UNICHAIN_SEPOLIA_HOOK_ADDRESS / UNICHAIN_SEPOLIA_ROUTER_ADDRESS
///             NOT set. Deploys lib + hook + router + solver adapter + keeper,
///             initializes the WETH/USDC hook pool, then the pipeline trio.
///             Reverts if the hook pool already exists (keeps a second,
///             mismatched stack from ever being wired onto a live pool).
///
///           MODE 2 - wire to existing Sepolia stack (set the two env vars):
///             Only deploys the pipeline trio and registers the existing
///             hook/router in their pool registries. Idempotent: reruns are
///             no-ops (CREATE2 targets skip when already deployed).
///
///         Pool topology mirrors the earlier Sepolia deployment:
///           hook pool      = USDC(6) / WETH(18), fee 3000, tickSpacing 60
///           standard pool  = USDC / WETH,        fee 500,  tickSpacing 60 (no hook)
///         Both directions are registered so LONG (margin USDC -> collateral
///         WETH) and SHORT (margin WETH -> collateral USDC) route through the
///         adapter/quoter.
contract DeployUnichainSepoliaFull is Script {
    using PoolIdLibrary for PoolKey;

    // Unichain Sepolia testnet addresses
    address constant WETH = 0x4200000000000000000000000000000000000006;
    address constant USDC = 0x31d0220469e10c4E71834a79b1f276d740d3768F;

    // Unichain Sepolia V4 PoolManager (already deployed)
    address constant UNICHAIN_SEPOLIA_PM = 0x00B036B58a818B1BC34d502D3fE730Db729e62AC;

    // Canonical CoW Protocol GPv2Settlement - the SAME deterministic CREATE2
    // address on every CoW chain (Ethereum, Sepolia, Gnosis, ...). Domain
    // separators in EswapCoWSettlement bind to this verifyingContract; orders
    // signed for the CoW order book on chainId 1301 must be signed against this
    // address + chainId 1301. Override with COW_GPv2_SETTLEMENT in .env.
    address constant COW_GPv2_SETTLEMENT = 0x9008D19f58AAbD9eD0D60971565AA8510560ab41;

    // Foundry forge-script routes broadcasted CREATE2 opcodes through this
    // internal Create2Deployer (deployed on-chain at the same address on
    // Unichain Mainnet/Sepolia). All CREATE2 address arithmetic below MUST use
    // this factory as the deployer, NOT the EOA, so simulation matches broadcast.
    address constant CREATE2_DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        address solver = vm.envOr("SOLVER_ADDRESS", deployer);

        // Mode 2 wiring targets (must be set TOGETHER to enter wiring mode).
        address wiringHook = vm.envOr("UNICHAIN_SEPOLIA_HOOK_ADDRESS", address(0));
        address wiringRouter = vm.envOr("UNICHAIN_SEPOLIA_ROUTER_ADDRESS", address(0));
        bool wireExisting = wiringHook != address(0) || wiringRouter != address(0);
        if (wireExisting) {
            require(wiringHook != address(0) && wiringRouter != address(0),
                "set BOTH UNICHAIN_SEPOLIA_HOOK_ADDRESS and UNICHAIN_SEPOLIA_ROUTER_ADDRESS");
            require(wiringHook.code.length > 0, "wiring hook address has no code on this chain");
            require(wiringRouter.code.length > 0, "wiring router address has no code on this chain");
        }

        EswapMarginHook hook;
        EswapRouter router;
        address libAddr;
        PoolManager pm = PoolManager(UNICHAIN_SEPOLIA_PM);

        vm.startBroadcast(deployerPrivateKey);

        if (wireExisting) {
            // ------ MODE 2: wire pipeline contracts to the existing stack -----
            hook = EswapMarginHook(payable(wiringHook));
            router = EswapRouter(payable(wiringRouter));
            console.log("Wiring pipeline to EXISTING stack (mode 2)");
            console.log(string.concat("  Hook:   ", vm.toString(address(hook))));
            console.log(string.concat("  Router: ", vm.toString(address(router))));
        } else {
            // ------ MODE 1: fresh full-stack deployment -----------------------
            console.log("Deploying FRESH full stack (mode 1)");

            // 1. Deploy EswapMarginLib deterministically with salt = 0. Foundry's
            //    forge-script route compiles EswapMarginHook with this library
            //    AUTO-LINKED to create2Address(CREATE2_DEPLOYER, bytes32(0),
            //    keccak256(libCreationCode)). Salt 0 therefore places it exactly
            //    where the hook's creation code references, so no manual linking.
            bytes32 libSalt = bytes32(0);
            libAddr = create2Address(CREATE2_DEPLOYER, libSalt, keccak256(type(EswapMarginLib).creationCode));
            if (libAddr.code.length == 0) {
                bytes memory libInit = type(EswapMarginLib).creationCode;
                address deployedLib;
                assembly {
                    deployedLib := create2(0, add(libInit, 32), mload(libInit), libSalt)
                }
                require(deployedLib != address(0), "lib create2 failed");
            }
            require(libAddr.code.length > 0, "lib not deployed");
            console.log(string.concat("EswapMarginLib: ", vm.toString(libAddr)));

            // The hook's creation code is auto-linked by Foundry to libAddr;
            // verify that invariant so a compiler/build change fails loudly.
            bytes memory linkedCreation = type(EswapMarginHook).creationCode;
            uint256 linkCount;
            for (uint256 i = 0; i + 20 <= linkedCreation.length; i++) {
                bool eq = true;
                for (uint256 j = 0; j < 20; j++) {
                    if (linkedCreation[i + j] != bytes20(libAddr)[j]) { eq = false; break; }
                }
                if (eq) linkCount++;
            }
            require(linkCount >= 8, "hook lib auto-link mismatch (re-derive salt=0 lib address)");

            // 2. Mine a hook address that advertises exactly our flags.
            uint160 highFlags = HookFlags.AFTER_INITIALIZE_FLAG |
                            HookFlags.BEFORE_SWAP_FLAG |
                            HookFlags.BEFORE_SWAP_RETURNS_DELTA_FLAG |
                            HookFlags.AFTER_SWAP_FLAG;
            // REAL v4-core low-14-bit scheme. Constrained to be EXACTLY the claimed
            // bits so the on-chain PoolManager's isValidHookAddress accepts it.
            uint160 lowMask = (1 << 12) | // real AFTER_INITIALIZE
                              (1 << 7) |  // real BEFORE_SWAP
                              (1 << 6) |  // real AFTER_SWAP
                              (1 << 3);   // real BEFORE_SWAP_RETURNS_DELTA
            uint160 allHookMask = (1 << 14) - 1;

            bytes memory initCode = abi.encodePacked(linkedCreation, abi.encode(address(pm), address(0), deployer));
            bytes32 initCodeHash = keccak256(initCode);

            bytes32 salt;
            bool found = false;
            for (uint256 i = 0; i < 5_000_000; i++) {
                salt = bytes32(i);
                address computed = create2Address(CREATE2_DEPLOYER, salt, initCodeHash);
                if ((uint160(computed) & highFlags) == highFlags && (uint160(computed) & allHookMask) == lowMask) {
                    found = true;
                    break;
                }
            }
            require(found, "Could not mine hook salt");

            address payable hookAddr;
            assembly {
                hookAddr := create2(0, add(initCode, 32), mload(initCode), salt)
            }
            require(hookAddr != address(0), "hook create2 failed");
            require(hookAddr.code.length > 0, "hook not deployed");
            hook = EswapMarginHook(payable(hookAddr));
            console.log(string.concat("Hook:   ", vm.toString(address(hook))));

            // 3. Reject wiring a SECOND router onto an already-live pool. If the
            //    hook pool is initialized the operator MUST use mode-2 env wiring
            //    against the existing router instead of silently deploying a
            //    mismatched stack.
            RealPoolId hookRealId = RealPoolId.wrap(
                keccak256(abi.encode(USDC, WETH, uint24(3000), int24(60), address(hook)))
            );
            (uint160 currentSqrt,,,) = StateLibrary.getSlot0(pm, hookRealId);
            require(currentSqrt == 0,
                "hook pool already live: set UNICHAIN_SEPOLIA_HOOK/ROUTER_ADDRESS (mode 2) to wire the pipeline");

            // 4. Deploy router + auxiliary stack.
            router = new EswapRouter(IPoolManager(address(pm)));
            console.log(string.concat("Router: ", vm.toString(address(router))));
            EswapSolverAdapter solverAdapter = new EswapSolverAdapter(address(router));
            console.log(string.concat("SolverAdapter: ", vm.toString(address(solverAdapter))));
            EswapLiquidationKeeper keeper = new EswapLiquidationKeeper(address(hook), address(router));
            console.log(string.concat("LiquidationKeeper: ", vm.toString(address(keeper))));

            // 5. Configure hook: treasury, fees, leverage, TWAP-only oracle.
            address treasury = vm.envOr("TREASURY", deployer);
            hook.setConfig(EswapMarginHook.ConfigParams({
                treasury: treasury,
                router: address(router),
                reserveFactor: 50,
                maxPriceSwingBps: 800,
                defaultMaxLeverage: 5,
                requireTwapOracle: false // TWAP-only oracle; no Chainlink feeds on Sepolia
            }));
            hook.setTokenDecimals(WETH, 18);
            hook.setTokenDecimals(USDC, 6);

            // 6. Initialize the WETH/USDC pools (0.30% hook accounting pool and
            //    0.05% standard fill venue). USDC (0x31d0..) sorts below WETH
            //    (0x4200..), so currency0=USDC, currency1=WETH. Initial price ~
            //    $1912/WETH -> tick 200760 (see DeployUnichainSepolia).
            //    Both initializations are IDEMPOTENT: the standard venue
            //    (500/60, no hook) is shared across stacks, so a rerun must not
            //    revert on an already-initialized pool.
            PoolKey memory key = PoolKey({
                currency0: Currency.wrap(USDC),
                currency1: Currency.wrap(WETH),
                fee: 3000,
                tickSpacing: 60,
                hooks: address(hook)
            });
            uint160 sqrtPriceX96 = TickMath.getSqrtRatioAtTick(200760);
            RealPoolKey memory hookRealKey = RealPoolKey({
                currency0: RealCurrency.wrap(USDC),
                currency1: RealCurrency.wrap(WETH),
                fee: 3000,
                tickSpacing: 60,
                hooks: IHooks(address(hook))
            });
            RealPoolKey memory stdRealKey = RealPoolKey({
                currency0: RealCurrency.wrap(USDC),
                currency1: RealCurrency.wrap(WETH),
                fee: 500,
                tickSpacing: 60,
                hooks: IHooks(address(0))
            });
            // hookRealId is already declared above (step 3) via keccak256 of the
            // same ABI-encoded key; reuse it instead of redeclaring.
            RealPoolId stdRealId = RealPoolIdLibrary.toId(stdRealKey);
            (uint160 hookSqrt,,,) = StateLibrary.getSlot0(pm, hookRealId);
            if (hookSqrt == 0) {
                pm.initialize(hookRealKey, sqrtPriceX96);
            }
            // 6b. Also initialize the STANDARD fill venue (500/60, no hook).
            //     Every physical swap (adapter-routed and CoW settlement fills)
            //     executes on this pool; an uninitialized standard pool reverts
            //     every quote and fill with "Pool not initialized".
            (uint160 stdSqrt,,,) = StateLibrary.getSlot0(pm, stdRealId);
            if (stdSqrt == 0) {
                pm.initialize(stdRealKey, sqrtPriceX96);
            }
            PoolId poolId = key.toId();
            hook.setAuthorizedPool(poolId, true);
            hook.setBaseCurrency(poolId, Currency.wrap(WETH)); // anchor isLong to WETH
            hook.setStandardPoolKey(poolId, PoolKey({
                currency0: key.currency0,
                currency1: key.currency1,
                fee: 500,
                tickSpacing: 60,
                hooks: address(0)
            }));
            console.log("Pool: WETH/USDC hook 3000/60, standard 500/60");
        }

        // ------ Pipeline contracts (both modes) -----------------------------
        // NOTE: deployed via plain `new` (NOT CREATE2 through the deterministic
        // Create2Deployer): those factories execute the constructor with
        // msg.sender = factory, which would pin Ownable(msg.sender) ownership to
        // the factory and brick registerPool/setDefaultSolver. This matches how
        // the existing router/keeper/solver-adapter are deployed. Reruns deploy
        // fresh copies (same tradeoff the repo already accepts).
        address gpv2 = vm.envOr("COW_GPv2_SETTLEMENT", COW_GPv2_SETTLEMENT);

        EswapCoWSettlement settlement = new EswapCoWSettlement(router, gpv2);
        console.log(string.concat("CoWSettlement: ", vm.toString(address(settlement))));
        console.log(string.concat("  gpv2Settlement: ", vm.toString(address(settlement.gpv2Settlement()))));

        EswapLeverageAdapter adapter = new EswapLeverageAdapter(router);
        console.log(string.concat("LeverageAdapter: ", vm.toString(address(adapter))));

        EswapLeverageQuoter quoter = new EswapLeverageQuoter(router);
        console.log(string.concat("LeverageQuoter: ", vm.toString(address(quoter))));

        // ------ Register pools + default solver (both modes, idempotent) -----
        PoolKey memory hookPoolKey = PoolKey({
            currency0: Currency.wrap(USDC),
            currency1: Currency.wrap(WETH),
            fee: 3000,
            tickSpacing: 60,
            hooks: address(hook)
        });
        PoolKey memory standardKey = PoolKey({
            currency0: Currency.wrap(USDC),
            currency1: Currency.wrap(WETH),
            fee: 500,
            tickSpacing: 60,
            hooks: address(0)
        });

        // LONG:  margin USDC -> collateral WETH   (zeroForOne=true  on the hook key)
        // SHORT: margin WETH  -> collateral USDC  (zeroForOne=false on the hook key)
        adapter.registerPool(USDC, WETH, 3000, hookPoolKey, standardKey);
        adapter.registerPool(WETH, USDC, 3000, hookPoolKey, standardKey);
        quoter.registerPool(USDC, WETH, 3000, hookPoolKey, standardKey);
        quoter.registerPool(WETH, USDC, 3000, hookPoolKey, standardKey);

        if (adapter.defaultSolver() != solver) {
            adapter.setDefaultSolver(solver);
        }
        // Leveraged opens (both aggregator and CoW paths) gate on the router's
        // solver whitelist; register the solver so fills don't revert.
        if (!router.registeredSolvers(solver)) {
            router.setSolverWhitelist(solver, true);
        }
        console.log(string.concat("DefaultSolver: ", vm.toString(adapter.defaultSolver())));
        console.log(string.concat("SolverWhitelisted: ", vm.toString(router.registeredSolvers(solver))));

        vm.stopBroadcast();

        // ------ Summary / next steps -----------------------------------------
        console.log("");
        console.log("=== Deployment Summary ===");
        console.log("Network: Unichain Sepolia Testnet (Chain ID 1301)");
        console.log(string.concat("PoolManager:      ", vm.toString(address(pm))));
        console.log(string.concat("Hook:             ", vm.toString(address(hook))));
        console.log(string.concat("Router:           ", vm.toString(address(router))));
        console.log(string.concat("CoWSettlement:    ", vm.toString(address(settlement))));
        console.log(string.concat("LeverageAdapter:  ", vm.toString(address(adapter))));
        console.log(string.concat("LeverageQuoter:   ", vm.toString(address(quoter))));
        console.log("");
        console.log("=== Next Steps ===");
        console.log("1. Update root .env (separate from mainnet V4_* keys):");
        if (wireExisting) {
            console.log(string.concat("   UNICHAIN_SEPOLIA_HOOK_ADDRESS=", vm.toString(address(hook))));
            console.log(string.concat("   UNICHAIN_SEPOLIA_ROUTER_ADDRESS=", vm.toString(address(router))));
        }
        console.log(string.concat("   V4_SETTLEMENT_ADDRESS=", vm.toString(address(settlement))));
        console.log(string.concat("   V4_ADAPTER_ADDRESS=", vm.toString(address(adapter))));
        console.log(string.concat("   V4_QUOTER_ADDRESS=", vm.toString(address(quoter))));
        console.log("");
        console.log("2. Sync to dashboard: node javascript/update-dashboard.js");
        console.log("3. Whitelist solver liquidity / fund test traders with testnet WETH + USDC,");
        console.log("   then drive fills via EswapCoWSettlement.fillOrder and");
        console.log("   EswapLeverageAdapter.exactInputSingleWithLeverage.");
    }

    /// @dev CREATE2 address without deploying. Mirrors OpenZeppelin's
    ///      {Create2.computeAddress} layout (writes above the free-memory ptr),
    ///      so repeated calls in the salt-mining loop neither clobber scratch
    ///      memory nor grow the arena per iteration => no MemoryOOG.
    function create2Address(address deployer, bytes32 salt, bytes32 initCodeHash)
        internal
        pure
        returns (address addr)
    {
        assembly ("memory-safe") {
            let ptr := mload(0x40)
            mstore(add(ptr, 0x40), initCodeHash)
            mstore(add(ptr, 0x20), salt)
            mstore(ptr, deployer)
            let start := add(ptr, 0x0b)
            mstore8(start, 0xff)
            addr := and(keccak256(start, 85), 0xffffffffffffffffffffffffffffffffffffffff)
        }
    }
}