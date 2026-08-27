// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {PoolManager} from "@uniswap/v4-core/src/PoolManager.sol";
import {IPoolManager as RealIPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey as RealPoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency as RealCurrency} from "@uniswap/v4-core/src/types/Currency.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
// Mirrored local types — used by the EswapMarginHook/Router ABI surface.
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
import {HookFlags} from "../../src/v4/libraries/HookFlags.sol";

contract DeployUnichainSepolia is Script {
    using PoolIdLibrary for PoolKey;
    using LPFeeLibrary for uint24;

    // Unichain Sepolia testnet addresses
    address constant WETH = 0x4200000000000000000000000000000000000006;
    address constant USDC = 0x31d0220469e10c4E71834a79b1f276d740d3768F;

    // Unichain Sepolia V4 PoolManager (already deployed)
    address constant UNICHAIN_SEPOLIA_PM = 0x00B036B58a818B1BC34d502D3fE730Db729e62AC;

    // Foundry forge-script routes broadcasted CREATE2 opcodes through this
    // internal Create2Deployer (deployed on-chain at the same address on
    // Unichain Mainnet/Sepolia). All CREATE2 address arithmetic below MUST use
    // this factory as the deployer, NOT the EOA, so simulation matches broadcast.
    address constant CREATE2_DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        vm.startBroadcast(deployerPrivateKey);

        // 1. Use existing Unichain Sepolia PoolManager
        PoolManager pm = PoolManager(UNICHAIN_SEPOLIA_PM);
        console.log("Using Unichain Sepolia PoolManager at:", UNICHAIN_SEPOLIA_PM);

        // 2. Deploy EswapMarginLib deterministically with salt = 0. Foundry's
        //    forge-script route compiles EswapMarginHook with this library
        //    AUTO-LINKED to create2Address(CREATE2_DEPLOYER, bytes32(0),
        //    keccak256(libCreationCode)). Deploying the lib with salt=0
        //    therefore places it exactly where the hook's creation code
        //    references, so no manual bytecode linking is required.
        bytes32 libSalt = bytes32(0);
        address libAddr = create2Address(CREATE2_DEPLOYER, libSalt, keccak256(type(EswapMarginLib).creationCode));
        if (libAddr.code.length == 0) {
            bytes memory libInit = type(EswapMarginLib).creationCode;
            address deployedLib;
            assembly {
                deployedLib := create2(0, add(libInit, 32), mload(libInit), libSalt)
            }
            require(deployedLib != address(0), "lib create2 failed");
        }
        require(libAddr.code.length > 0, "lib not deployed");
        console.log("EswapMarginLib deployed at:", libAddr);

        // The hook's creation code is auto-linked by Foundry to libAddr; verify
        // that invariant so a compiler/build change fails loudly instead of
        // silently deploying a hook that DELEGATECALLs into an empty address.
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

        uint160 highFlags = HookFlags.AFTER_INITIALIZE_FLAG |
                        HookFlags.BEFORE_SWAP_FLAG |
                        HookFlags.BEFORE_SWAP_RETURNS_DELTA_FLAG |
                        HookFlags.AFTER_SWAP_FLAG;
        // REAL v4-core low-14-bit scheme. Constrained to be EXACTLY the claimed
        // bits so the on-chain PoolManager's isValidHookAddress accepts it (a
        // superset carrying orphan return-delta bits is rejected).
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

        // 4. Deploy hook (TWAP-only oracle, no Chainlink dependency) with LINKED bytecode
        address payable hookAddr;
        assembly {
            hookAddr := create2(0, add(initCode, 32), mload(initCode), salt)
        }
        require(hookAddr != address(0), "hook create2 failed");
        require(hookAddr.code.length > 0, "hook not deployed");
        EswapMarginHook hook = EswapMarginHook(hookAddr);
        console.log("Hook deployed at:", address(hook));

        // 5. Deploy router
        EswapRouter router = new EswapRouter(IPoolManager(address(pm)));
        console.log("Router deployed at:", address(router));

        // 6. Deploy solver adapter (aggregator convenience wrapper)
        EswapSolverAdapter adapter = new EswapSolverAdapter(address(router));
        console.log("SolverAdapter deployed at:", address(adapter));

        // 6b. Deploy liquidation keeper (automation bot)
        EswapLiquidationKeeper keeper = new EswapLiquidationKeeper(address(hook), address(router));
        console.log("LiquidationKeeper deployed at:", address(keeper));

        // 7. Configure hook: treasury, fees, leverage, oracle strictness.
        address treasury = vm.envOr("TREASURY", deployer);
        hook.setConfig(EswapMarginHook.ConfigParams({
            treasury: treasury,
            router: address(router),
            reserveFactor: 50,
            maxPriceSwingBps: 800,
            defaultMaxLeverage: 5,
            requireTwapOracle: false // TWAP-only oracle; no Chainlink feeds on Sepolia
        }));
        // Configure token decimals so the V4-spot vs V3-TWAP circuit breaker can
        // compare like-for-like prices (USDC has 6 decimals, WETH defaults to 18).
        hook.setTokenDecimals(WETH, 18);
        hook.setTokenDecimals(USDC, 6);

        // 8. Initialize the WETH/USDC pool (0.30% fee).
        //    Uniswap V4 orders currencies ascending by address: on Unichain Sepolia
        //    USDC (0x31d0..) sorts below WETH (0x4200..), so currency0=USDC and
        //    currency1=WETH (the reverse would revert CurrenciesOutOfOrderOrEqual).
        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(USDC),
            currency1: Currency.wrap(WETH),
            fee: 3000,
            tickSpacing: 60,
            hooks: address(hook)
        });

        // Initial price ≈ current WETH/USD market (~$1912). With currency0=USDC(6)/
        // currency1=WETH(18) the raw pool price is 1e18/(1912e6) = 5.23e8 → tick
        // ≈ 200733 (rounded to the 60 tick spacing => 200760). The previous tick
        // 196260 implied ~$3000/WETH (fine at deploy time) and -263813 implied
        // ~0.00035 USDC/WETH (off by ~9 orders of magnitude).
        uint160 sqrtPriceX96 = TickMath.getSqrtRatioAtTick(200760);
        pm.initialize(
            RealPoolKey({
                currency0: RealCurrency.wrap(USDC),
                currency1: RealCurrency.wrap(WETH),
                fee: 3000,
                tickSpacing: 60,
                hooks: IHooks(address(hook))
            }),
            sqrtPriceX96
        );

        // 9. Authorize the pool and anchor isLong to WETH (base token)
        PoolId poolId = key.toId();
        hook.setAuthorizedPool(poolId, true);
        hook.setBaseCurrency(poolId, Currency.wrap(WETH));

        // [FIX M-3] Pin the standard (physical-execution) pool for the hook pool so
        // close/liquidation unwind swaps route through deep standard liquidity instead
        // of the thin hook pool. The standard pool is the canonical no-hook 0.05% pool
        // for the same currency pair (owner-set at deploy; user-supplied keys can never
        // poison liquidation routing — see EswapRouter._swapCallback).
        PoolKey memory standardKey = PoolKey({
            currency0: key.currency0,
            currency1: key.currency1,
            fee: 500,
            tickSpacing: 60,
            hooks: address(0)
        });
        hook.setStandardPoolKey(poolId, standardKey);

        vm.stopBroadcast();

        // 10. Print deployment summary
        console.log("");
        console.log("=== Deployment Summary ===");
        console.log("Network: Unichain Sepolia Testnet (Chain ID 1301)");
        console.log(string.concat("PoolManager: ", vm.toString(address(pm))));
        console.log(string.concat("MarginLib:   ", vm.toString(libAddr)));
        console.log(string.concat("Hook:        ", vm.toString(address(hook))));
        console.log(string.concat("Router:      ", vm.toString(address(router))));
        console.log(string.concat("Adapter:     ", vm.toString(address(adapter))));
        console.log(string.concat("Keeper:      ", vm.toString(address(keeper))));
        console.log(string.concat("Treasury:    ", vm.toString(treasury)));
        console.log("Oracle:      TWAP-only (no Chainlink dependency)");
        console.log("Pool:        WETH/USDC 0.30%");
        console.log("");
        console.log("=== Next Steps ===");
        console.log("1. Seed insurance fund (covers bad debt on liquidation):");
        console.log(string.concat("   hook.seedInsuranceFund(WETH, amount)"));
        console.log(string.concat("   hook.seedInsuranceFund(USDC, amount)"));
        console.log("2. Fund test traders with testnet WETH + USDC for collateral");
        console.log("3. Update .env and run: node javascript/update-dashboard.js");
        console.log(string.concat("   V4_HOOK_ADDRESS=", vm.toString(address(hook))));
        console.log(string.concat("   V4_ROUTER_ADDRESS=", vm.toString(address(router))));
        console.log(string.concat("   V4_ADAPTER_ADDRESS=", vm.toString(address(adapter))));
        console.log(string.concat("   V4_KEEPER_ADDRESS=", vm.toString(address(keeper))));
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