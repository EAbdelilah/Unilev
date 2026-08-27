// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {PoolManager} from "@uniswap/v4-core/src/PoolManager.sol";
import {IPoolManager as RealIPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {AggregatorV3Interface} from "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";
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
import {EswapLiquidationKeeper} from "../../src/v4/EswapLiquidationKeeper.sol";
import {PriceFeed} from "../../src/v4/PriceFeed.sol";
import {HookFlags} from "../../src/v4/libraries/HookFlags.sol";

contract DeployUnichain is Script {
    using PoolIdLibrary for PoolKey;
    using LPFeeLibrary for uint24;

    address constant WETH = 0x4200000000000000000000000000000000000006;
    address constant USDC = 0x078D782b760474a361dDA0AF3839290b0EF57AD6;
    address constant WBTC = 0x927B51f251480a681271180DA4de28D44EC4AfB8;
    address constant UNICHAIN_PM = 0x1F98400000000000000000000000000000000004;

    // Verified live on Unichain Mainnet via latestRoundData() (Alchemy RPC).
    // Note: Unichain feeds report 18-decimal answers, unlike the usual 8.
    address constant ETH_USD_FEED = 0xBcE70e194940a157f3A80566505a7E96f5238CCa;
    address constant USDC_USD_FEED = 0xbd1cD1518eFB92a92100da62D4C488c810dFd75b;
    // Default standard live placeholder for WBTC feed (can be modified in root .env)
    // The feed is loaded dynamically in the run() function.

    // Foundry forge-script routes broadcasted CREATE2 opcodes through this
    // internal Create2Deployer (deployed on-chain at the same address on
    // Unichain Mainnet/Sepolia). All CREATE2 address arithmetic below MUST use
    // this factory as the deployer, NOT the EOA, so simulation matches broadcast.
    address constant CREATE2_DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        vm.startBroadcast(deployerPrivateKey);

        PoolManager pm = PoolManager(UNICHAIN_PM);
        console.log("Using Unichain PoolManager at:", UNICHAIN_PM);

        // Deploy PriceFeed and configure the verified Unichain feeds.
        // Feed decimals are read LIVE from each aggregator (CF-2): canonical
        // USD feeds are 8-dec, Unichain SVR feeds 18-dec — hardcoding either
        // breaks price normalization on the other chain type.
        PriceFeed priceFeed = new PriceFeed();
        console.log("PriceFeed deployed at:", address(priceFeed));

        priceFeed.setPriceFeed(WETH, ETH_USD_FEED, AggregatorV3Interface(ETH_USD_FEED).decimals());
        console.log(string.concat("Configured WETH feed: ", vm.toString(ETH_USD_FEED)));
        priceFeed.setPriceFeed(USDC, USDC_USD_FEED, AggregatorV3Interface(USDC_USD_FEED).decimals());
        console.log(string.concat("Configured USDC feed: ", vm.toString(USDC_USD_FEED)));
        address wbtcUsdFeed = vm.envOr("WBTC_USD_FEED", 0xC13f3E310Dd7436FA24338174acB64254b9A8039);
        priceFeed.setPriceFeed(WBTC, wbtcUsdFeed, AggregatorV3Interface(wbtcUsdFeed).decimals());
        console.log(string.concat("Configured WBTC feed: ", vm.toString(wbtcUsdFeed)));
        // Chainlink has not published an L2 sequencer uptime feed for Unichain,
        // so the sequencer check stays disabled until one is available.

        // Deploy EswapMarginLib deterministically with salt = 0. Foundry's
        // forge-script route compiles EswapMarginHook with this library
        // AUTO-LINKED to create2Address(CREATE2_DEPLOYER, bytes32(0),
        // keccak256(libCreationCode)). Deploying the lib with salt=0 therefore
        // places it at exactly the address the hook's creation code references,
        // so no manual bytecode linking is required.
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

        // Mirror of src/v4/libraries/HookFlags.sol (high-bit scheme) required by the
        // hook's own constructor check.
        uint160 highFlags = HookFlags.AFTER_INITIALIZE_FLAG |
                            HookFlags.BEFORE_SWAP_FLAG |
                            HookFlags.BEFORE_SWAP_RETURNS_DELTA_FLAG |
                            HookFlags.AFTER_SWAP_FLAG;
        // REAL v4-core low-14-bit scheme (lib/v4-core/src/libraries/Hooks.sol).
        // The on-chain Unichain PoolManager validates these EXACTLY: a superset
        // mask is rejected if it carries "orphan" return-delta bits without their
        // corresponding action flag (e.g. AFTER_ADD_LIQUIDITY_RETURNS_DELTA=1<<1
        // without AFTER_ADD_LIQUIDITY=1<<10), so the low 14 bits are constrained
        // to be EXACTLY the bits we claim.
        uint160 lowMask = (1 << 12) | // real AFTER_INITIALIZE
                          (1 << 7) |  // real BEFORE_SWAP
                          (1 << 6) |  // real AFTER_SWAP
                          (1 << 3);   // real BEFORE_SWAP_RETURNS_DELTA
        uint160 allHookMask = (1 << 14) - 1;

        bytes memory initCode = abi.encodePacked(linkedCreation, abi.encode(address(pm), address(priceFeed), deployer));
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

        // Deploy the hook with the LINKED creation code via assembly CREATE2 so the
        // resulting address matches the computed CREATE2 address above.
        address payable hookAddr;
        assembly {
            hookAddr := create2(0, add(initCode, 32), mload(initCode), salt)
        }
        require(hookAddr != address(0), "hook create2 failed");
        require(hookAddr.code.length > 0, "hook not deployed");
        EswapMarginHook hook = EswapMarginHook(hookAddr);
        console.log("Hook deployed at:", address(hook));

        EswapRouter router = new EswapRouter(IPoolManager(address(pm)));
        console.log("Router deployed at:", address(router));

        EswapLiquidationKeeper keeper = new EswapLiquidationKeeper(address(hook), address(router));
        console.log("LiquidationKeeper deployed at:", address(keeper));

        // Configure the hook: treasury, fees, leverage and oracle strictness.
        // requireTwapOracle is off by default for the first live smoke test; flip
        // REQUIRE_TWAP_ORACLE=true in .env once the WBTC feed is verified.
        address treasury = vm.envOr("TREASURY", deployer);
        hook.setConfig(EswapMarginHook.ConfigParams({
            treasury: treasury,
            router: address(router),
            reserveFactor: 50,                 // 0.5% protocol fee
            maxPriceSwingBps: 800,             // 8% V4-spot vs oracle TWAP deviation tolerance
            defaultMaxLeverage: 5,
            requireTwapOracle: vm.envOr("REQUIRE_TWAP_ORACLE", false)
        }));
        // Configure token decimals so the V4-spot vs V3-TWAP circuit breaker can
        // compare like-for-like prices (USDC has 6 decimals, WETH has 18, WBTC has 8).
        hook.setTokenDecimals(WETH, 18);
        hook.setTokenDecimals(USDC, 6);
        hook.setTokenDecimals(WBTC, 8);

        // USD-denominated collateral floor (18-decimals). Defaults to $0.10 (100000)
        // so micro-margin (25-cent-scale) solver test positions can open; override
        // with MIN_COLLATERAL_USD in .env (e.g. 1000000000000000000 = $1). Setting
        // 0 restores the legacy raw-token MIN_COLLATERAL floor.
        hook.setRouterAndMinCollateralUsd(
            address(router),
            vm.envOr("MIN_COLLATERAL_USD", uint256(100000))
        );

        // --- Initialize Pool 1: USDC / WETH ---
        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(USDC),
            currency1: Currency.wrap(WETH),
            fee: 3000,
            tickSpacing: 60,
            hooks: address(hook)
        });

        // Initialize pool1 at ~current WETH/USD market price. tick 200760 → raw
        // P ≈ 5.25e8 → ~$1912 per WETH (live oracle read 1917.34 at deploy time).
        // MUST be within maxPriceSwingBps (8%/800bps) of the Chainlink oracle or
        // the circuit breaker reverts TwapManipulated. (Previous 196260 implied
        // ~$3000/WETH, 36% off market → blocked every checkTwap.)
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

        PoolId poolId = key.toId();
        hook.setAuthorizedPool(poolId, true);
        hook.setBaseCurrency(poolId, Currency.wrap(WETH));

        // --- Initialize Pool 2: USDC / WBTC ---
        // On Unichain: USDC (0x078D..) sorts below WBTC (0x927B..) so USDC is currency0, WBTC is currency1.
        PoolKey memory wbtcKey = PoolKey({
            currency0: Currency.wrap(USDC),
            currency1: Currency.wrap(WBTC),
            fee: 3000,
            tickSpacing: 60,
            hooks: address(hook)
        });

        // 1 WBTC ≈ $95,000 USDC. currency0=USDC(6 dec), currency1=WBTC(8 dec).
        // V4 price = token1_raw/token0_raw = 1e8 / 95000e6 = 0.0010526
        // tick = ln(0.0010526) / ln(1.0001) ≈ -68568 → nearest 60-spacing = -68580
        uint160 wbtcPriceX96 = TickMath.getSqrtRatioAtTick(-68580);
        pm.initialize(
            RealPoolKey({
                currency0: RealCurrency.wrap(USDC),
                currency1: RealCurrency.wrap(WBTC),
                fee: 3000,
                tickSpacing: 60,
                hooks: IHooks(address(hook))
            }),
            wbtcPriceX96
        );

        PoolId wbtcPoolId = wbtcKey.toId();
        hook.setAuthorizedPool(wbtcPoolId, true);
        // WBTC is base currency: long WBTC buys WBTC (isLong = true) and borrows USDC.
        hook.setBaseCurrency(wbtcPoolId, Currency.wrap(WBTC));

        // [FIX M-3] Pin the standard (physical-execution) pool for each hook pool so
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

        PoolKey memory wbtcStandardKey = PoolKey({
            currency0: wbtcKey.currency0,
            currency1: wbtcKey.currency1,
            fee: 500,
            tickSpacing: 60,
            hooks: address(0)
        });
        hook.setStandardPoolKey(wbtcPoolId, wbtcStandardKey);

        vm.stopBroadcast();

        console.log("");
        console.log("=== Deployment Summary ===");
        console.log("Network: Unichain Mainnet (Chain ID 130)");
        console.log(string.concat("PoolManager: ", vm.toString(address(pm))));
        console.log(string.concat("MarginLib:   ", vm.toString(libAddr)));
        console.log(string.concat("Hook:        ", vm.toString(address(hook))));
        console.log(string.concat("Router:      ", vm.toString(address(router))));
        console.log(string.concat("Keeper:      ", vm.toString(address(keeper))));
        console.log(string.concat("PriceFeed:   ", vm.toString(address(priceFeed))));
        console.log(string.concat("Treasury:    ", vm.toString(treasury)));
        console.log("");
        console.log("=== Next Steps ===");
        console.log("1. Set answer circuit-breaker bounds (optional, in raw feed units):");
        console.log(string.concat("   priceFeed.setAnswerBounds(WETH, <min>, <max>)"));
        console.log(string.concat("   priceFeed.setAnswerBounds(USDC, <min>, <max>)"));
        console.log("2. Update treasury / leverage / oracle strictness anytime:");
        console.log("   hook.setConfig(ConfigParams(treasury, router, reserveFactor,");
        console.log("       maxPriceSwingBps, defaultMaxLeverage, requireTwapOracle))");
        console.log("   (Set REQUIRE_TWAP_ORACLE=true in .env once the WBTC feed is verified)");
        console.log("3. Seed insurance fund for bad-debt coverage:");
        console.log(string.concat("   hook.seedInsuranceFund(WETH, amount)"));
        console.log(string.concat("   hook.seedInsuranceFund(USDC, amount)"));
        console.log(string.concat("   hook.seedInsuranceFund(WBTC, amount)"));
        console.log("4. Withdraw protocol fees to the treasury (once positions trade):");
        console.log(string.concat("   hook.withdrawProtocolFee(USDC, amount)"));
        console.log("5. Update .env and run: node javascript/update-dashboard.js");
        console.log(string.concat("   V4_HOOK_ADDRESS=", vm.toString(address(hook))));
        console.log(string.concat("   V4_ROUTER_ADDRESS=", vm.toString(address(router))));
        console.log(string.concat("   V4_KEEPER_ADDRESS=", vm.toString(address(keeper))));
        console.log(string.concat("   V4_PRICEFEED_ADDRESS=", vm.toString(address(priceFeed))));
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