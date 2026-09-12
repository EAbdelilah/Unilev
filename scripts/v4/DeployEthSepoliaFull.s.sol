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

/// @notice PHASE B - Ethereum Sepolia (11155111) mirror of the live Unichain
///         Sepolia stack. This is the chain where the REAL CoW order-book API
///         (api.cow.fi/sepolia) and the REAL 0x Swap API (sepolia.api.0x.org)
///         run, so deploying here turns the fork-proven full cycles (see
///         EswapSepoliaEthFullCycleForkTest) into live-testnet trading.
///
///         Scope mirrors DeployUnichainSepoliaFull.s.sol:
///            - EswapMarginLib + EswapMarginHook + EswapRouter + SolverAdapter
///              + LiquidationKeeper (fresh full stack, mode 1) OR wiring-mode 2
///            - EswapCoWSettlement (CoW-compatible order fills)
///            - EswapLeverageAdapter + EswapLeverageQuoter (aggregator entry)
///
///         Run modes (driven by .env):
///           MODE 1 - fresh full stack: ETH_SEPOLIA_HOOK/ROUTER_ADDRESS unset.
///           MODE 2 - wire to existing stack: set BOTH
///                    ETH_SEPOLIA_HOOK_ADDRESS + ETH_SEPOLIA_ROUTER_ADDRESS.
///
///         Pool topology (mirrors the Unichain deployment):
///           hook pool      = USDC(6) / WETH(18), fee 3000, tickSpacing 60
///           standard pool  = USDC / WETH,        fee 500,  tickSpacing 60 (no hook)
///
///         Preconditions (verified live):
///           WETH 0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9 (code present)
///           USDC 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238 (code present)
///           PoolManager 0xE03A1074c86CFeDd5C142C4F04F1a1536e203543 (live)
///           CoW GPv2Settlement 0x9008D19f58AAbD9eD0D60971565AA8510560ab41 (live)
///
///         NOTE: deployer address (PRIVATE_KEY in .env) currently has 0 ETH on
///         11155111 — fund it from a Sepolia faucet before broadcasting.
contract DeployEthSepoliaFull is Script {
    using PoolIdLibrary for PoolKey;

    // Ethereum Sepolia testnet addresses (verified live, see header).
    address constant WETH = 0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9;
    address constant USDC = 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238;
    address constant ETH_SEPOLIA_PM = 0xE03A1074c86CFeDd5C142C4F04F1a1536e203543;

    // Canonical CoW Protocol GPv2Settlement - the SAME deterministic CREATE2
    // address on every CoW chain (Ethereum, Sepolia, Gnosis, ...); verified
    // deployed on 11155111. Override with COW_GPv2_SETTLEMENT in .env.
    address constant COW_GPv2_SETTLEMENT = 0x9008D19f58AAbD9eD0D60971565AA8510560ab41;

    // Deterministic Create2Deployer (deployed on-chain at the same address on
    // every EVM chain). All CREATE2 address arithmetic below MUST use this
    // factory as the deployer, NOT the EOA, so simulation matches broadcast.
    address constant CREATE2_DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        address solver = vm.envOr("SOLVER_ADDRESS", deployer);

        // Mode 2 wiring targets (must be set TOGETHER to enter wiring mode).
        address wiringHook = vm.envOr("ETH_SEPOLIA_HOOK_ADDRESS", address(0));
        address wiringRouter = vm.envOr("ETH_SEPOLIA_ROUTER_ADDRESS", address(0));
        bool wireExisting = wiringHook != address(0) || wiringRouter != address(0);
        if (wireExisting) {
            require(wiringHook != address(0) && wiringRouter != address(0),
                "set BOTH ETH_SEPOLIA_HOOK_ADDRESS and ETH_SEPOLIA_ROUTER_ADDRESS");
            require(wiringHook.code.length > 0, "wiring hook address has no code on this chain");
            require(wiringRouter.code.length > 0, "wiring router address has no code on this chain");
        }

        EswapMarginHook hook;
        EswapRouter router;
        address libAddr;
        PoolManager pm = PoolManager(ETH_SEPOLIA_PM);

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

            // 1. Deploy EswapMarginLib deterministically with salt = 0 (auto-link).
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
            // REAL v4-core low-14-bit scheme (validated on the live Unichain
            // Sepolia PoolManager; identical v4-core on 11155111).
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

            // 3. Reject wiring a SECOND router onto an already-live pool.
            RealPoolId hookRealId = RealPoolId.wrap(
                keccak256(abi.encode(USDC, WETH, uint24(3000), int24(60), address(hook)))
            );
            (uint160 currentSqrt,,,) = StateLibrary.getSlot0(pm, hookRealId);
            require(currentSqrt == 0,
                "hook pool already live: set ETH_SEPOLIA_HOOK/ROUTER_ADDRESS (mode 2) to wire the pipeline");

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
            //    0.05% standard fill venue). USDC (0x1c7D..) sorts below WETH
            //    (0x7b79..), so currency0=USDC, currency1=WETH. Both
            //    initializations are IDEMPOTENT for safe reruns.
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
            RealPoolId stdRealId = RealPoolIdLibrary.toId(stdRealKey);
            (uint160 hookSqrt,,,) = StateLibrary.getSlot0(pm, hookRealId);
            if (hookSqrt == 0) {
                pm.initialize(hookRealKey, sqrtPriceX96);
            }
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
        address gpv2 = vm.envOr("COW_GPv2_SETTLEMENT", COW_GPv2_SETTLEMENT);
        require(gpv2.code.length > 0, "CoW GPv2Settlement has no code on 11155111");

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
        if (!router.registeredSolvers(solver)) {
            router.setSolverWhitelist(solver, true);
        }
        console.log(string.concat("DefaultSolver: ", vm.toString(adapter.defaultSolver())));
        console.log(string.concat("SolverWhitelisted: ", vm.toString(router.registeredSolvers(solver))));

        vm.stopBroadcast();

        // ------ Summary / next steps -----------------------------------------
        console.log("");
        console.log("=== Deployment Summary ===");
        console.log("Network: Ethereum Sepolia Testnet (Chain ID 11155111)");
        console.log("  Real-API solvers/aggregators served here:");
        console.log("    CoW order-book  https://api.cow.fi/sepolia/api/v1/");
        console.log("    0x Swap API     https://sepolia.api.0x.org/swap/v1/quote");
        console.log(string.concat("PoolManager:      ", vm.toString(address(pm))));
        console.log(string.concat("Hook:             ", vm.toString(address(hook))));
        console.log(string.concat("Router:           ", vm.toString(address(router))));
        console.log(string.concat("CoWSettlement:    ", vm.toString(address(settlement))));
        console.log(string.concat("LeverageAdapter:  ", vm.toString(address(adapter))));
        console.log(string.concat("LeverageQuoter:   ", vm.toString(address(quoter))));
        console.log("");
        console.log("=== Next Steps ===");
        console.log("1. Update root .env:");
        if (wireExisting) {
            console.log(string.concat("   ETH_SEPOLIA_HOOK_ADDRESS=", vm.toString(address(hook))));
            console.log(string.concat("   ETH_SEPOLIA_ROUTER_ADDRESS=", vm.toString(address(router))));
        }
        console.log(string.concat("   V4_SETTLEMENT_ADDRESS=", vm.toString(address(settlement))));
        console.log(string.concat("   V4_ADAPTER_ADDRESS=", vm.toString(address(adapter))));
        console.log(string.concat("   V4_QUOTER_ADDRESS=", vm.toString(address(quoter))));
        console.log("");
        console.log("2. Sync to dashboard: node javascript/update-dashboard.js");
        console.log("3. Fund Sepolia WETH+USDC liquidity in the 500/60 standard pool,");
        console.log("   then drive fills via EswapCoWSettlement.fillOrder and");
        console.log("   EswapLeverageAdapter.exactInputSingleWithLeverage.");
        console.log("4. When Sepolia DEX depth appears, CoW + 0x return REAL_QUOTE");
        console.log("   and set the fill price through the same contracts.");
    }

    /// @dev CREATE2 address without deploying (mirrors OpenZeppelin Create2
    ///      computeAddress layout; memory-safe, repeated salt-loop friendly).
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