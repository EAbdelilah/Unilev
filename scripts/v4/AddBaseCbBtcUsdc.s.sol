// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {PoolManager} from "@uniswap/v4-core/src/PoolManager.sol";
import {IPoolManager as RealIPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey as RealPoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency as RealCurrency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolId as RealPoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {PoolModifyLiquidityTest} from "@uniswap/v4-core/src/test/PoolModifyLiquidityTest.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";
import {TickMath as CoreTickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {AggregatorV3Interface} from "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {PoolKey} from "../../src/v4/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "../../src/v4/types/PoolId.sol";
import {Currency} from "../../src/v4/types/Currency.sol";
import {TickMath as EswapTickMath} from "../../src/v4/libraries/TickMath.sol";
import {EswapMarginHook} from "../../src/v4/EswapMarginHook.sol";
import {EswapTimelock} from "../../src/v4/EswapTimelock.sol";
import {PriceFeed} from "../../src/v4/PriceFeed.sol";
import {EswapLeverageAdapter} from "../../src/v4/EswapLeverageAdapter.sol";
import {EswapLeverageQuoter} from "../../src/v4/EswapLeverageQuoter.sol";

/// @notice Adds cbBTC/USDC as a first-class v4 spot-margin pair on LIVE Base.
///
/// @dev Mirrors the production WETH/USDC wiring:
///       - hook pool:       USDC/cbBTC, fee 3000, tickSpacing 60, Eswap hook
///       - standard pool:   USDC/cbBTC, fee 500,  tickSpacing 10, no hooks
///       - base currency:   cbBTC (long buys cbBTC)
///       - decimals:        USDC 6, cbBTC 8 (currency0 = USDC, currency1 = cbBTC)
///       - oracle:          Chainlink cbBTC/USD, 8-decimal proxy 0x07DA...9f9D
///
///      The hook owner is `V4_TIMELOCK_ADDRESS`, NOT the deployer EOA, so
///      `registerTradingPair` is scheduled through queue -> delay -> execute.
///      PriceFeed, adapter and quoter owners are the deployer EOA and are wired
///      directly in phase 1.
///
/// @dev Usage (dry-run first; NO --broadcast until reviewed):
///
///        forge script scripts/v4/AddBaseCbBtcUsdc.s.sol:AddBaseCbBtcUsdc \
///          --rpc-url $BASE_RPC_URL --via-ir
///
///      Phase 1 (broadcast): initialize both pools, register the oracle, adapter
///      and quoter, and QUEUE the hook registration. Prints CBBTC_REGISTER_ETA
///      and CBBTC_REGISTER_TX_HASH.
///
///        forge script scripts/v4/AddBaseCbBtcUsdc.s.sol:AddBaseCbBtcUsdc \
///          --rpc-url $BASE_RPC_URL --private-key $PRIVATE_KEY \
///          --broadcast --slow --via-ir
///
///      Phase 2 (broadcast, after the timelock delay):
///
///        forge script scripts/v4/AddBaseCbBtcUsdc.s.sol:AddBaseCbBtcUsdc \
///          --sig "executeRegister(uint256)" <CBBTC_REGISTER_ETA> \
///          --rpc-url $BASE_RPC_URL --private-key $PRIVATE_KEY \
///          --broadcast --slow --via-ir
///
///      Liquidity (optional, requires the broadcaster to hold USDC + cbBTC):
///
///        SEED_CBBTC_LIQUIDITY_DELTA=<liquidity> \
///        forge script scripts/v4/AddBaseCbBtcUsdc.s.sol:AddBaseCbBtcUsdc \
///          --sig "seedLiquidity()" --rpc-url $BASE_RPC_URL \
///          --private-key $PRIVATE_KEY --broadcast --slow --via-ir
///
///      Env:
///        PRIVATE_KEY                 owner of PriceFeed / adapter / quoter and
///                                    admin of the hook timelock
///        V4_HOOK_ADDRESS             live EswapMarginHook
///        V4_PRICEFEED_ADDRESS        live PriceFeed
///        V4_ADAPTER_ADDRESS          live EswapLeverageAdapter
///        V4_QUOTER_ADDRESS           live EswapLeverageQuoter
///        V4_TIMELOCK_ADDRESS         timelock that owns the hook
///        POOL_MANAGER_ADDRESS        optional, defaults to the canonical Base PM
///        CBBTC_USD_FEED              optional, defaults to the verified feed
///        CBBTC_REGISTER_ETA          optional override for the timelock eta
///        SEED_CBBTC_LIQUIDITY_DELTA  raw v4 liquidity for seedLiquidity()
///        SEED_CBBTC_TICK_SPREAD      optional half-width, default 600 ticks
contract AddBaseCbBtcUsdc is Script {
    using PoolIdLibrary for PoolKey;

    // --- Base (8453) well-known addresses ---------------------------------
    address constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address constant CBBTC = 0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf;
    address constant BASE_PM = 0x498581fF718922c3f8e6A244956aF099B2652b2b;
    /// @dev Chainlink Base mainnet `cbbtc-usd`, reference-data-directory proxy.
    address constant CBBTC_USD_FEED = 0x07DA0E54543a844a80ABE69c8A12F22B3aA59f9D;

    uint8 constant USDC_DECIMALS = 6;
    uint8 constant CBBTC_DECIMALS = 8;
    uint8 constant CBBTC_FEED_DECIMALS = 8;
    uint24 constant HOOK_FEE = 3000;
    int24 constant HOOK_SPACING = 60;
    uint24 constant STANDARD_FEE = 500;
    int24 constant STANDARD_SPACING = 10;
    uint256 constant ETA_BUFFER = 10 minutes;

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);

        address hookAddr = vm.envAddress("V4_HOOK_ADDRESS");
        address priceFeedAddr = vm.envAddress("V4_PRICEFEED_ADDRESS");
        address adapterAddr = vm.envAddress("V4_ADAPTER_ADDRESS");
        address quoterAddr = vm.envAddress("V4_QUOTER_ADDRESS");
        address timelockAddr = vm.envAddress("V4_TIMELOCK_ADDRESS");
        address pmAddr = vm.envOr("POOL_MANAGER_ADDRESS", BASE_PM);
        address cbBtcFeed = vm.envOr("CBBTC_USD_FEED", CBBTC_USD_FEED);

        // Uniswap v4 sorts by numeric address. On Base USDC (0x83...) is
        // currency0 and cbBTC (0xcb...) is currency1 — the opposite of WETH.
        require(USDC < CBBTC, "unexpected cbBTC/USDC address ordering");
        require(AggregatorV3Interface(cbBtcFeed).decimals() == CBBTC_FEED_DECIMALS, "unexpected cbBTC feed decimals");

        EswapMarginHook hook = EswapMarginHook(payable(hookAddr));
        EswapTimelock timelock = EswapTimelock(timelockAddr);
        PriceFeed priceFeed = PriceFeed(priceFeedAddr);
        EswapLeverageAdapter adapter = EswapLeverageAdapter(adapterAddr);
        EswapLeverageQuoter quoter = EswapLeverageQuoter(quoterAddr);

        require(hook.owner() == timelockAddr, "hook owner is not the configured timelock");
        require(timelock.hook() == hookAddr, "timelock bound to a different hook");
        require(timelock.admin() == deployer, "broadcaster is not the timelock admin");
        require(priceFeed.owner() == deployer, "broadcaster is not the PriceFeed owner");
        require(adapter.owner() == deployer, "broadcaster is not the adapter owner");
        require(quoter.owner() == deployer, "broadcaster is not the quoter owner");

        (PoolKey memory hookKey, PoolKey memory standardKey) = _localKeys(hookAddr);
        PoolId poolId = hookKey.toId();
        uint160 sqrtPriceX96 = _oracleSqrtPriceX96(priceFeed, cbBtcFeed);

        vm.startBroadcast(pk);

        // 1. Initialize both accounting + execution pools at the live oracle
        //    price. Permissionless and idempotent: slot0 == 0 means uninitialized.
        _initializeIfNeeded(pmAddr, _realKey(HOOK_FEE, HOOK_SPACING, hookAddr), sqrtPriceX96);
        _initializeIfNeeded(pmAddr, _realKey(STANDARD_FEE, STANDARD_SPACING, address(0)), sqrtPriceX96);

        // 2. Register the 8-decimal Chainlink feed under the cbBTC token key.
        if (priceFeed.priceFeeds(CBBTC) != cbBtcFeed) {
            priceFeed.setPriceFeed(CBBTC, cbBtcFeed, CBBTC_FEED_DECIMALS);
        }

        // 3. Adapter + quoter registry, both swap directions. fee is the HOOK
        //    tier (3000), matching the WETH/USDC registration.
        _registerAdapterQuoter(adapter, quoter, hookKey, standardKey);

        // 4. Schedule the hook registration behind the timelock. Skip when the
        //    pair is already authorized so a rerun cannot queue a stale action.
        if (!hook.isAuthorizedPool(poolId)) {
            bytes memory data = abi.encodeCall(
                EswapMarginHook.registerTradingPair,
                (hookKey, standardKey, Currency.wrap(CBBTC), USDC_DECIMALS, CBBTC_DECIMALS)
            );
            uint256 delay = timelock.delay();
            uint256 eta = vm.envOr("CBBTC_REGISTER_ETA", block.timestamp + delay + ETA_BUFFER);
            require(eta >= block.timestamp + delay, "CBBTC_REGISTER_ETA too soon");
            bytes32 txHash = timelock.getTxHash(hookAddr, data, eta);
            require(!timelock.isQueued(txHash), "registration already queued for this eta");
            timelock.queue(hookAddr, data, eta);
            console.log("");
            console.log("=== Hook registration QUEUED ===");
            console.log("CBBTC_REGISTER_ETA:", eta);
            console.log("CBBTC_REGISTER_TX_HASH:", vm.toString(txHash));
            console.log("Execute after ETA with --sig \"executeRegister(uint256)\" <ETA>");
        } else {
            console.log("cbBTC/USDC already authorized on the hook; skipping timelock queue");
        }

        vm.stopBroadcast();

        console.log("");
        console.log("=== cbBTC/USDC pair wiring (phase 1) ===");
        console.log("currency0 (USDC):", USDC);
        console.log("currency1 (cbBTC):", CBBTC);
        console.log("base currency:", CBBTC);
        console.log("PoolId:", vm.toString(PoolId.unwrap(poolId)));
        console.log("Oracle price sqrtPriceX96:", vm.toString(sqrtPriceX96));
        console.log("cbBTC feed:", cbBtcFeed);
    }

    /// @notice Executes the queued `registerTradingPair` call after its eta.
    function executeRegister(uint256 eta) external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);

        address hookAddr = vm.envAddress("V4_HOOK_ADDRESS");
        address timelockAddr = vm.envAddress("V4_TIMELOCK_ADDRESS");

        EswapMarginHook hook = EswapMarginHook(payable(hookAddr));
        EswapTimelock timelock = EswapTimelock(timelockAddr);
        require(timelock.admin() == deployer, "broadcaster is not the timelock admin");

        (PoolKey memory hookKey, PoolKey memory standardKey) = _localKeys(hookAddr);
        bytes memory data = abi.encodeCall(
            EswapMarginHook.registerTradingPair,
            (hookKey, standardKey, Currency.wrap(CBBTC), USDC_DECIMALS, CBBTC_DECIMALS)
        );
        bytes32 txHash = timelock.getTxHash(hookAddr, data, eta);
        require(timelock.isQueued(txHash), "registration is not queued for this eta");

        vm.startBroadcast(pk);
        timelock.execute(hookAddr, data, eta);
        vm.stopBroadcast();

        require(hook.isAuthorizedPool(hookKey.toId()), "hook registration did not take effect");
        console.log("cbBTC/USDC registered. PoolId:", vm.toString(PoolId.unwrap(hookKey.toId())));
    }

    /// @notice Optionally seed the new v4 pools. Requires real Base USDC/cbBTC
    ///         in the broadcasting wallet; no mock ERC-20s are used.
    function seedLiquidity() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address hookAddr = vm.envAddress("V4_HOOK_ADDRESS");
        address priceFeedAddr = vm.envAddress("V4_PRICEFEED_ADDRESS");
        address pmAddr = vm.envOr("POOL_MANAGER_ADDRESS", BASE_PM);
        address cbBtcFeed = vm.envOr("CBBTC_USD_FEED", CBBTC_USD_FEED);

        uint256 deltaRaw = vm.envUint("SEED_CBBTC_LIQUIDITY_DELTA");
        require(deltaRaw > 0 && deltaRaw <= uint256(int256(type(int128).max)), "bad liquidity delta");
        int128 delta = int128(int256(deltaRaw));
        int24 spread = int24(int256(vm.envOr("SEED_CBBTC_TICK_SPREAD", uint256(600))));

        uint160 sqrtPriceX96 = _oracleSqrtPriceX96(PriceFeed(priceFeedAddr), cbBtcFeed);
        int24 tick = CoreTickMath.getTickAtSqrtPrice(sqrtPriceX96);

        vm.startBroadcast(pk);

        PoolModifyLiquidityTest seeder = new PoolModifyLiquidityTest(RealIPoolManager(pmAddr));
        IERC20(USDC).approve(address(seeder), type(uint256).max);
        IERC20(CBBTC).approve(address(seeder), type(uint256).max);

        RealPoolKey memory hookReal = _realKey(HOOK_FEE, HOOK_SPACING, hookAddr);
        RealPoolKey memory standardReal = _realKey(STANDARD_FEE, STANDARD_SPACING, address(0));
        _initializeIfNeeded(pmAddr, hookReal, sqrtPriceX96);
        _initializeIfNeeded(pmAddr, standardReal, sqrtPriceX96);

        _addLiquidity(seeder, hookReal, tick, spread, HOOK_SPACING, delta);
        _addLiquidity(seeder, standardReal, tick, spread, STANDARD_SPACING, delta);

        vm.stopBroadcast();

        console.log("Seeder:", address(seeder));
        console.log("Center tick:", vm.toString(tick));
        console.log("Liquidity delta:", vm.toString(deltaRaw));
    }

    // --------------------------------------------------------------- helpers

    function _localKeys(address hookAddr)
        internal
        pure
        returns (PoolKey memory hookKey, PoolKey memory standardKey)
    {
        hookKey = PoolKey({
            currency0: Currency.wrap(USDC),
            currency1: Currency.wrap(CBBTC),
            fee: HOOK_FEE,
            tickSpacing: HOOK_SPACING,
            hooks: hookAddr
        });
        standardKey = PoolKey({
            currency0: Currency.wrap(USDC),
            currency1: Currency.wrap(CBBTC),
            fee: STANDARD_FEE,
            tickSpacing: STANDARD_SPACING,
            hooks: address(0)
        });
    }

    function _realKey(uint24 fee, int24 spacing, address hooks) internal pure returns (RealPoolKey memory) {
        return RealPoolKey({
            currency0: RealCurrency.wrap(USDC),
            currency1: RealCurrency.wrap(CBBTC),
            fee: fee,
            tickSpacing: spacing,
            hooks: IHooks(hooks)
        });
    }

    function _initializeIfNeeded(address pmAddr, RealPoolKey memory key, uint160 sqrtPriceX96) internal {
        bytes32 poolId = keccak256(abi.encode(key.currency0, key.currency1, key.fee, key.tickSpacing, key.hooks));
        (uint160 currentSqrt,,,) =
            StateLibrary.getSlot0(RealIPoolManager(pmAddr), RealPoolId.wrap(poolId));
        if (currentSqrt == 0) {
            PoolManager(pmAddr).initialize(key, sqrtPriceX96);
            console.log("Initialized v4 pool, fee:", vm.toString(key.fee));
        } else {
            console.log("v4 pool already initialized, fee:", vm.toString(key.fee));
        }
    }

    function _oracleSqrtPriceX96(PriceFeed priceFeed, address cbBtcFeed) internal view returns (uint160) {
        // currency0 = USDC (6dp), currency1 = cbBTC (8dp). v4's sqrtPriceX96 is
        // sqrt(raw currency1 / raw currency0). Both oracle prices are already
        // normalised to 18 decimals, so the token-decimal exponent decides the
        // raw-unit ratio:
        //
        //   rawC1 / rawC0 = priceC0 / priceC1 * 10^(decC1 - decC0)
        uint256 price0 = priceFeed.getTwapPrice(USDC);
        (, int256 answer,, uint256 updatedAt,) = AggregatorV3Interface(cbBtcFeed).latestRoundData();
        require(price0 > 0 && answer > 0 && updatedAt > 0, "invalid oracle answer");
        uint8 feedDecimals = AggregatorV3Interface(cbBtcFeed).decimals();
        require(feedDecimals == CBBTC_FEED_DECIMALS, "unexpected cbBTC feed decimals");
        uint256 price1 = uint256(answer) * (10 ** (18 - feedDecimals));

        uint256 targetX192 = FullMath.mulDiv(
            price0 * (10 ** CBBTC_DECIMALS),
            uint256(1) << 192,
            price1 * (10 ** USDC_DECIMALS)
        );
        require(targetX192 > 0, "oracle price too small");

        uint160 rawSqrt = uint160(Math.sqrt(targetX192));
        int24 tick = CoreTickMath.getTickAtSqrtPrice(rawSqrt);
        return EswapTickMath.getSqrtRatioAtTick(tick);
    }

    function _registerAdapterQuoter(
        EswapLeverageAdapter adapter,
        EswapLeverageQuoter quoter,
        PoolKey memory hookKey,
        PoolKey memory standardKey
    ) internal {
        // Read through the auto-generated registry getter: hooks == 0 means the
        // direction is not registered yet.
        (PoolKey memory registeredHookKey,) = adapter.poolRegistry(USDC, CBBTC, HOOK_FEE);
        if (registeredHookKey.hooks == address(0)) {
            adapter.registerPool(USDC, CBBTC, HOOK_FEE, hookKey, standardKey);
            adapter.registerPool(CBBTC, USDC, HOOK_FEE, hookKey, standardKey);
        }
        (registeredHookKey,) = quoter.poolRegistry(USDC, CBBTC, HOOK_FEE);
        if (registeredHookKey.hooks == address(0)) {
            quoter.registerPool(USDC, CBBTC, HOOK_FEE, hookKey, standardKey);
            quoter.registerPool(CBBTC, USDC, HOOK_FEE, hookKey, standardKey);
        }
    }

    function _addLiquidity(
        PoolModifyLiquidityTest seeder,
        RealPoolKey memory key,
        int24 centerTick,
        int24 spread,
        int24 spacing,
        int128 delta
    ) internal {
        int24 lower = ((centerTick - spread) / spacing) * spacing;
        int24 upper = ((centerTick + spread) / spacing) * spacing;
        seeder.modifyLiquidity(
            key,
            RealIPoolManager.ModifyLiquidityParams({
                tickLower: lower,
                tickUpper: upper,
                liquidityDelta: delta,
                salt: bytes32(0)
            }),
            ""
        );
        console.log("Seeded fee:", vm.toString(key.fee));
        console.log("Ticks:", vm.toString(lower), "/", vm.toString(upper));
    }
}
