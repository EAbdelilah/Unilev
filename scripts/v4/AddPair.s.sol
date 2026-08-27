// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {PoolManager} from "@uniswap/v4-core/src/PoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {AggregatorV3Interface} from "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";
import {PoolKey as RealPoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency as RealCurrency} from "@uniswap/v4-core/src/types/Currency.sol";
import {TickMath} from "../../src/v4/libraries/TickMath.sol";
// Mirrored local types — used by the EswapMarginHook ABI surface.
import {PoolKey} from "../../src/v4/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "../../src/v4/types/PoolId.sol";
import {Currency} from "../../src/v4/types/Currency.sol";
import {EswapMarginHook} from "../../src/v4/EswapMarginHook.sol";
import {PriceFeed} from "../../src/v4/PriceFeed.sol";

/// @notice Adds a NEW trading pair to the LIVE V4 protocol — no redeploy needed.
///
/// Usage:
///   forge script scripts/v4/AddPair.s.sol:AddPair --via-ir \
///     --rpc-url $UNICHAIN_RPC_URL --private-key $PRIVATE_KEY --broadcast --slow
///
/// Required env:
///   V4_HOOK_ADDRESS        deployed EswapMarginHook
///   V4_PRICEFEED_ADDRESS   deployed PriceFeed
///   TOKEN0 / TOKEN1        pair tokens (TOKEN0 must sort BELOW TOKEN1)
///   TOKEN0_FEED            Chainlink USD aggregator for TOKEN0
///   TOKEN1_FEED            Chainlink USD aggregator for TOKEN1
///   BASE_TOKEN             TOKEN0 or TOKEN1 — what "long" buys (e.g. WETH)
/// Optional env:
///   POOL_MANAGER_ADDRESS   default Unichain PM 0x1F98400000000000000000000000000000000004
///   TOKEN0_DECIMALS        default 18
///   TOKEN1_DECIMALS        default 18
///   POOL_FEE               default 3000
///   TICK_SPACING           default 60
///   STANDARD_POOL_FEE      default 500 (deep no-hook pool for unwind swaps)
///   STANDARD_TICK_SPACING  default 60
///   INIT_TICK              default 0 (1:1) — set near the market price so the
///                          TWAP circuit breaker (maxPriceSwingBps) does not block trades
contract AddPair is Script {
    using PoolIdLibrary for PoolKey;

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address hookAddr = vm.envAddress("V4_HOOK_ADDRESS");
        address priceFeedAddr = vm.envAddress("V4_PRICEFEED_ADDRESS");
        address pmAddr = vm.envOr("POOL_MANAGER_ADDRESS", 0x1F98400000000000000000000000000000000004);

        address token0 = vm.envAddress("TOKEN0");
        address token1 = vm.envAddress("TOKEN1");
        require(token0 < token1, "TOKEN0 must sort below TOKEN1");
        uint8 dec0 = uint8(vm.envOr("TOKEN0_DECIMALS", uint256(18)));
        uint8 dec1 = uint8(vm.envOr("TOKEN1_DECIMALS", uint256(18)));
        address feed0 = vm.envAddress("TOKEN0_FEED");
        address feed1 = vm.envAddress("TOKEN1_FEED");
        address baseToken = vm.envAddress("BASE_TOKEN");
        require(baseToken == token0 || baseToken == token1, "BASE_TOKEN must be TOKEN0 or TOKEN1");

        uint24 poolFee = uint24(vm.envOr("POOL_FEE", uint256(3000)));
        int24 tickSpacing = int24(int256(vm.envOr("TICK_SPACING", uint256(60))));
        uint24 stdFee = uint24(vm.envOr("STANDARD_POOL_FEE", uint256(500)));
        int24 stdTickSpacing = int24(int256(vm.envOr("STANDARD_TICK_SPACING", uint256(60))));
        int24 initTick = int24(int256(vm.envOr("INIT_TICK", uint256(0))));

        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(token0),
            currency1: Currency.wrap(token1),
            fee: poolFee,
            tickSpacing: tickSpacing,
            hooks: hookAddr
        });
        PoolKey memory standardKey = PoolKey({
            currency0: Currency.wrap(token0),
            currency1: Currency.wrap(token1),
            fee: stdFee,
            tickSpacing: stdTickSpacing,
            hooks: address(0)
        });

        vm.startBroadcast(deployerPrivateKey);

        // 1. Initialize the hook pool on the PoolManager at the starting tick.
        //    Permissionless step; idempotent — skipped if the pool already exists.
        try PoolManager(pmAddr).initialize(
            RealPoolKey({
                currency0: RealCurrency.wrap(token0),
                currency1: RealCurrency.wrap(token1),
                fee: poolFee,
                tickSpacing: tickSpacing,
                hooks: IHooks(hookAddr)
            }),
            TickMath.getSqrtRatioAtTick(initTick)
        ) {
            console.log("Hook pool initialized at INIT_TICK:", uint256(int256(initTick)));
        } catch {
            console.log("Hook pool already initialized; skipping initialize");
        }

        // 2. Register everything the protocol needs for the pair — single tx:
        //    authorization + standard pool key + base currency + token decimals.
        EswapMarginHook hook = EswapMarginHook(payable(hookAddr));
        hook.registerTradingPair(key, standardKey, Currency.wrap(baseToken), dec0, dec1);
        console.log("registerTradingPair done");

        // 3. Register the oracle feeds for both tokens. Feed decimals are read
        //    LIVE from each aggregator: canonical USD feeds are 8-dec while
        //    Unichain's SVR feeds are 18-dec — a hardcoded 18 understates
        //    prices by 10**(18-feedDecimals) on 8-dec chains (CF-2).
        PriceFeed priceFeed = PriceFeed(priceFeedAddr);
        priceFeed.setPriceFeed(token0, feed0, AggregatorV3Interface(feed0).decimals());
        priceFeed.setPriceFeed(token1, feed1, AggregatorV3Interface(feed1).decimals());
        console.log("Price feeds registered (decimals read from aggregators)");

        vm.stopBroadcast();

        console.log("");
        console.log("=== Pair Added (no redeploy) ===");
        console.log(string.concat("Token0:     ", vm.toString(token0)));
        console.log(string.concat("Token1:     ", vm.toString(token1)));
        console.log(string.concat("Base token: ", vm.toString(baseToken)));
        console.log(string.concat("PoolId:     ", vm.toString(PoolId.unwrap(key.toId()))));
        console.log("Next: run node javascript/update-dashboard.js and add the pair to dashboard/src/config/supported_tokens.json");
    }
}
