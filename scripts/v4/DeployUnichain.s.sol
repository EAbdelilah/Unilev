// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {PoolManager} from "@uniswap/v4-core/src/PoolManager.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {TickMath} from "../../src/v4/libraries/TickMath.sol";
import {EswapMarginHook, IPriceFeed} from "../../src/v4/EswapMarginHook.sol";
import {EswapRouter} from "../../src/v4/EswapRouter.sol";
import {EswapLiquidationKeeper} from "../../src/v4/EswapLiquidationKeeper.sol";
import {PriceFeed} from "../../src/v4/PriceFeed.sol";
import {HookFlags} from "../../src/v4/libraries/HookFlags.sol";

contract DeployUnichain is Script {
    using PoolIdLibrary for PoolKey;
    using LPFeeLibrary for uint24;

    address constant WETH = 0x4200000000000000000000000000000000000006;
    address constant USDC = 0x078D782b760474a361dDA0AF3839290b0EF57AD6;
    address constant WBTC = 0x0555e30da8f98308edb960aa94c0db47230d2b9c;
    address constant UNICHAIN_PM = 0x1F98400000000000000000000000000000000004;

    // Verified live on Unichain Mainnet via latestRoundData() (Alchemy RPC).
    // Note: Unichain feeds report 18-decimal answers, unlike the usual 8.
    address constant ETH_USD_FEED = 0xBcE70e194940a157f3A80566505a7E96f5238CCa;
    address constant USDC_USD_FEED = 0xbd1cD1518eFB92a92100da62D4C488c810dFd75b;
    // Default standard live placeholder for WBTC feed (can be modified in root .env)
    address constant WBTC_USD_FEED = 0x2774C32f05B48cEcb40AFE625b1b7E7C6702e86D;

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        vm.startBroadcast(deployerPrivateKey);

        PoolManager pm = PoolManager(UNICHAIN_PM);
        console.log("Using Unichain PoolManager at:", UNICHAIN_PM);

        // Deploy PriceFeed and configure the verified Unichain feeds
        PriceFeed priceFeed = new PriceFeed();
        console.log("PriceFeed deployed at:", address(priceFeed));

        priceFeed.setPriceFeed(WETH, ETH_USD_FEED, 18);
        console.log(string.concat("Configured WETH feed: ", vm.toString(ETH_USD_FEED)));
        priceFeed.setPriceFeed(USDC, USDC_USD_FEED, 18);
        console.log(string.concat("Configured USDC feed: ", vm.toString(USDC_USD_FEED)));
        priceFeed.setPriceFeed(WBTC, WBTC_USD_FEED, 8);
        console.log(string.concat("Configured WBTC feed: ", vm.toString(WBTC_USD_FEED)));
        // Chainlink has not published an L2 sequencer uptime feed for Unichain,
        // so the sequencer check stays disabled until one is available.

        uint160 flags = HookFlags.AFTER_INITIALIZE_FLAG |
                        HookFlags.BEFORE_SWAP_FLAG |
                        HookFlags.BEFORE_SWAP_RETURNS_DELTA_FLAG |
                        HookFlags.AFTER_SWAP_FLAG;

        bytes memory bytecode = abi.encodePacked(
            type(EswapMarginHook).creationCode,
            abi.encode(pm, address(priceFeed))
        );
        bytes32 bytecodeHash = keccak256(bytecode);

        bytes32 salt;
        bool found = false;
        for (uint256 i = 0; i < 1_000_000; i++) {
            salt = bytes32(i);
            address computed = address(uint160(uint256(keccak256(abi.encodePacked(
                bytes1(0xff), deployer, salt, bytecodeHash
            )))));
            if (uint160(computed) & flags == flags) {
                found = true;
                break;
            }
        }
        require(found, "Could not mine hook salt");

        EswapMarginHook hook = new EswapMarginHook{salt: salt}(IPoolManager(address(pm)), IPriceFeed(address(priceFeed)));
        console.log("Hook deployed at:", address(hook));

        EswapRouter router = new EswapRouter(IPoolManager(address(pm)));
        console.log("Router deployed at:", address(router));

        EswapLiquidationKeeper keeper = new EswapLiquidationKeeper(address(hook), address(router));
        console.log("LiquidationKeeper deployed at:", address(keeper));

        hook.setRouter(address(router));
        // Configure token decimals so the V4-spot vs V3-TWAP circuit breaker can
        // compare like-for-like prices (USDC has 6 decimals, WETH has 18, WBTC has 8).
        hook.setTokenDecimals(WETH, 18);
        hook.setTokenDecimals(USDC, 6);
        hook.setTokenDecimals(WBTC, 8);

        // --- Initialize Pool 1: USDC / WETH ---
        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(USDC),
            currency1: Currency.wrap(WETH),
            fee: 3000,
            tickSpacing: 60,
            hooks: IHooks(address(hook))
        });

        uint160 sqrtPriceX96 = TickMath.getSqrtRatioAtTick(196260);
        pm.initialize(key, sqrtPriceX96);

        PoolId poolId = key.toId();
        hook.setAuthorizedPool(poolId, true);
        hook.setBaseCurrency(poolId, Currency.wrap(WETH));

        // --- Initialize Pool 2: WBTC / USDC ---
        // WBTC (0x0555..) sorts below USDC (0x078D..) so WBTC is currency0, USDC is currency1.
        PoolKey memory wbtcKey = PoolKey({
            currency0: Currency.wrap(WBTC),
            currency1: Currency.wrap(USDC),
            fee: 3000,
            tickSpacing: 60,
            hooks: IHooks(address(hook))
        });

        // Price ratio = USDC per WBTC = 100000. Raw units ratio = 100000 * 1e6 / 1e8 = 1000.
        // Tick is log_1.0001(1000) = 69080. Multiples of 60 tick spacing = 69060.
        uint160 wbtcPriceX96 = TickMath.getSqrtRatioAtTick(69060);
        pm.initialize(wbtcKey, wbtcPriceX96);

        PoolId wbtcPoolId = wbtcKey.toId();
        hook.setAuthorizedPool(wbtcPoolId, true);
        // WBTC is base currency: long WBTC buys WBTC (isLong = true) and borrows USDC.
        hook.setBaseCurrency(wbtcPoolId, Currency.wrap(WBTC));

        vm.stopBroadcast();

        console.log("");
        console.log("=== Deployment Summary ===");
        console.log("Network: Unichain Mainnet (Chain ID 130)");
        console.log(string.concat("PoolManager: ", vm.toString(address(pm))));
        console.log(string.concat("Hook:        ", vm.toString(address(hook))));
        console.log(string.concat("Router:      ", vm.toString(address(router))));
        console.log(string.concat("Keeper:      ", vm.toString(address(keeper))));
        console.log(string.concat("PriceFeed:   ", vm.toString(address(priceFeed))));
        console.log("");
        console.log("=== Next Steps ===");
        console.log("1. Set answer circuit-breaker bounds (optional, in raw feed units):");
        console.log(string.concat("   priceFeed.setAnswerBounds(WETH, <min>, <max>)"));
        console.log(string.concat("   priceFeed.setAnswerBounds(USDC, <min>, <max>)"));
        console.log("2. Set treasury address for protocol fee withdrawal:");
        console.log(string.concat("   hook.setTreasury(<treasury address>)"));
        console.log("3. (Optional) Seed insurance fund for bad-debt coverage:");
        console.log(string.concat("   hook.seedInsuranceFund(WETH, amount)"));
        console.log(string.concat("   hook.seedInsuranceFund(USDC, amount)"));
        console.log("4. Update .env and run: node javascript/update-dashboard.js");
        console.log(string.concat("   V4_HOOK_ADDRESS=", vm.toString(address(hook))));
        console.log(string.concat("   V4_ROUTER_ADDRESS=", vm.toString(address(router))));
        console.log(string.concat("   V4_KEEPER_ADDRESS=", vm.toString(address(keeper))));
    }
}
