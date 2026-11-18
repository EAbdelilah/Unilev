// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {AggregatorV3Interface} from "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";
import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IPoolManager as RealIPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey as RealPoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency as RealCurrency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolId as RealPoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {TickMath as CoreTickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";

import {PoolKey} from "../types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "../types/PoolId.sol";
import {Currency} from "../types/Currency.sol";
import {TickMath as EswapTickMath} from "../libraries/TickMath.sol";
import {EswapMarginHook} from "../EswapMarginHook.sol";
import {EswapTimelock} from "../EswapTimelock.sol";
import {PriceFeed} from "../PriceFeed.sol";
import {EswapLeverageAdapter} from "../EswapLeverageAdapter.sol";
import {EswapLeverageQuoter} from "../EswapLeverageQuoter.sol";

/// @notice Base mainnet fork coverage for adding cbBTC/USDC as a first-class
///         v4 spot-margin pair, mirroring the live WETH/USDC registration.
///
/// @dev Uses the REAL deployed hook / timelock / oracle / adapter / quoter and
///      real USDC + cbBTC contracts. No mock ERC-20s are created. Owner calls
///      are impersonated with vm.prank; nothing is broadcast.
contract EswapBaseCbBtcUsdcForkTest is Test {
    using PoolIdLibrary for PoolKey;

    address constant BASE_PM = 0x498581fF718922c3f8e6A244956aF099B2652b2b;
    address constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address constant CBBTC = 0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf;
    address constant CBBTC_USD_FEED = 0x07DA0E54543a844a80ABE69c8A12F22B3aA59f9D;

    address constant HOOK = 0x7b3F232BB5a0346fADb8B92B31B3e7bC60bD90c8;
    address constant PRICE_FEED = 0x91d75C7f750510C04516fC4dcEB5737E5B170c02;
    address constant ADAPTER = 0xC622558e9145dbe0Bc37Db5311e70f3F9Fa8cc48;
    address constant QUOTER = 0xb1228De759119088D9aCEf20b80dD4ED93Dd2ba5;
    address constant TIMELOCK = 0x9aA2e9e2FB4cfC71a89F03b88Abf6116d8B1138e;

    uint8 constant USDC_DECIMALS = 6;
    uint8 constant CBBTC_DECIMALS = 8;
    uint8 constant CBBTC_FEED_DECIMALS = 8;
    uint24 constant HOOK_FEE = 3000;
    int24 constant HOOK_SPACING = 60;
    uint24 constant STANDARD_FEE = 500;
    int24 constant STANDARD_SPACING = 10;

    bool forkReady;

    EswapMarginHook hook;
    EswapTimelock timelock;
    PriceFeed priceFeed;
    EswapLeverageAdapter adapter;
    EswapLeverageQuoter quoter;
    RealIPoolManager pm;

    PoolKey hookKey;
    PoolKey standardKey;

    function setUp() public {
        string memory rpcUrl = vm.envOr("BASE_RPC_URL", string(""));
        if (bytes(rpcUrl).length == 0) return;

        vm.createSelectFork(rpcUrl);
        if (block.chainid != 8453) return;
        if (HOOK.code.length == 0 || PRICE_FEED.code.length == 0 || BASE_PM.code.length == 0) return;

        hook = EswapMarginHook(payable(HOOK));
        timelock = EswapTimelock(TIMELOCK);
        priceFeed = PriceFeed(PRICE_FEED);
        adapter = EswapLeverageAdapter(ADAPTER);
        quoter = EswapLeverageQuoter(QUOTER);
        pm = RealIPoolManager(BASE_PM);

        hookKey = PoolKey({
            currency0: Currency.wrap(USDC),
            currency1: Currency.wrap(CBBTC),
            fee: HOOK_FEE,
            tickSpacing: HOOK_SPACING,
            hooks: HOOK
        });
        standardKey = PoolKey({
            currency0: Currency.wrap(USDC),
            currency1: Currency.wrap(CBBTC),
            fee: STANDARD_FEE,
            tickSpacing: STANDARD_SPACING,
            hooks: address(0)
        });

        forkReady = true;
    }

    function test_CbBtcUsdcRegistrationMirrorsWethUsdc() public {
        if (!forkReady) return;
        _ensureRegistered();

        PoolId poolId = hookKey.toId();

        // Address sorting and the unusual 6/8 decimal combination that makes
        // this pair the mirror image of WETH/currency0 on Base.
        assertLt(uint256(uint160(USDC)), uint256(uint160(CBBTC)), "USDC must be currency0");
        assertEq(Currency.unwrap(hookKey.currency0), USDC);
        assertEq(Currency.unwrap(hookKey.currency1), CBBTC);
        assertEq(PoolId.unwrap(poolId), keccak256(abi.encode(USDC, CBBTC, HOOK_FEE, HOOK_SPACING, HOOK)));

        assertTrue(hook.isAuthorizedPool(poolId), "hook pool not authorized");
        assertEq(Currency.unwrap(hook.baseCurrency(poolId)), CBBTC, "base must be cbBTC");
        assertEq(hook.tokenDecimals(USDC), USDC_DECIMALS);
        assertEq(hook.tokenDecimals(CBBTC), CBBTC_DECIMALS);

        (Currency c0, Currency c1, uint24 fee, int24 spacing, address hooks) = hook.standardPoolKeys(poolId);
        assertEq(Currency.unwrap(c0), USDC);
        assertEq(Currency.unwrap(c1), CBBTC);
        assertEq(fee, STANDARD_FEE);
        assertEq(spacing, STANDARD_SPACING);
        assertEq(hooks, address(0));

        assertEq(priceFeed.priceFeeds(CBBTC), CBBTC_USD_FEED);
        assertEq(priceFeed.feedDecimals(CBBTC), CBBTC_FEED_DECIMALS);
        // Read the feed directly: PriceFeed.getTwapPrice() enforces a 1h
        // staleness window, and the timelock execution above advances the fork
        // clock past that window.
        (, int256 cbBtcAnswer,, uint256 cbBtcUpdatedAt,) = AggregatorV3Interface(CBBTC_USD_FEED).latestRoundData();
        assertGt(cbBtcAnswer, 0, "cbBTC oracle not answering");
        assertGt(cbBtcUpdatedAt, 0, "cbBTC oracle has no update timestamp");

        (PoolKey memory adapterKey,) = adapter.poolRegistry(USDC, CBBTC, HOOK_FEE);
        assertEq(adapterKey.hooks, HOOK, "adapter USDC->cbBTC not registered");
        (adapterKey,) = adapter.poolRegistry(CBBTC, USDC, HOOK_FEE);
        assertEq(adapterKey.hooks, HOOK, "adapter cbBTC->USDC not registered");

        (PoolKey memory quoterKey,) = quoter.poolRegistry(USDC, CBBTC, HOOK_FEE);
        assertEq(quoterKey.hooks, HOOK, "quoter USDC->cbBTC not registered");
        (quoterKey,) = quoter.poolRegistry(CBBTC, USDC, HOOK_FEE);
        assertEq(quoterKey.hooks, HOOK, "quoter cbBTC->USDC not registered");

        assertGt(_slot0(_realKey(HOOK_FEE, HOOK_SPACING, HOOK)), 0, "hook pool uninitialized");
        assertGt(_slot0(_realKey(STANDARD_FEE, STANDARD_SPACING, address(0))), 0, "standard pool uninitialized");
    }

    function test_CbBtcUsdcQuoteUsesCurrency0Input() public {
        if (!forkReady) return;
        _ensureRegistered();

        // USDC is currency0 for cbBTC/USDC, so a long (USDC in) is zeroForOne.
        (PoolKey memory regKey,) = quoter.poolRegistry(USDC, CBBTC, HOOK_FEE);
        assertEq(Currency.unwrap(regKey.currency0), USDC);

        int128 out = quoter.quoteExactInputSingleWithLeverage(USDC, CBBTC, HOOK_FEE, 5, -int128(int256(100e6)));
        assertGt(out, 0, "cbBTC/USDC quote failed after registration");
    }

    // ---------------------------------------------------------------- helpers

    function _ensureRegistered() internal {
        uint160 sqrtPriceX96 = _oracleSqrtPriceX96();

        _initializeIfNeeded(_realKey(HOOK_FEE, HOOK_SPACING, HOOK), sqrtPriceX96);
        _initializeIfNeeded(_realKey(STANDARD_FEE, STANDARD_SPACING, address(0)), sqrtPriceX96);

        if (priceFeed.priceFeeds(CBBTC) != CBBTC_USD_FEED) {
            vm.prank(priceFeed.owner());
            priceFeed.setPriceFeed(CBBTC, CBBTC_USD_FEED, CBBTC_FEED_DECIMALS);
        }

        (PoolKey memory adapterKey,) = adapter.poolRegistry(USDC, CBBTC, HOOK_FEE);
        if (adapterKey.hooks == address(0)) {
            vm.prank(adapter.owner());
            adapter.registerPool(USDC, CBBTC, HOOK_FEE, hookKey, standardKey);
            vm.prank(adapter.owner());
            adapter.registerPool(CBBTC, USDC, HOOK_FEE, hookKey, standardKey);
        }

        (PoolKey memory quoterKey,) = quoter.poolRegistry(USDC, CBBTC, HOOK_FEE);
        if (quoterKey.hooks == address(0)) {
            vm.prank(quoter.owner());
            quoter.registerPool(USDC, CBBTC, HOOK_FEE, hookKey, standardKey);
            vm.prank(quoter.owner());
            quoter.registerPool(CBBTC, USDC, HOOK_FEE, hookKey, standardKey);
        }

        if (!hook.isAuthorizedPool(hookKey.toId())) {
            bytes memory data = abi.encodeCall(
                EswapMarginHook.registerTradingPair,
                (hookKey, standardKey, Currency.wrap(CBBTC), USDC_DECIMALS, CBBTC_DECIMALS)
            );
            uint256 eta = block.timestamp + timelock.delay() + 1 hours;
            bytes32 txHash = timelock.getTxHash(HOOK, data, eta);

            vm.prank(timelock.admin());
            timelock.queue(HOOK, data, eta);
            vm.warp(eta);
            vm.prank(timelock.admin());
            timelock.execute(HOOK, data, eta);
            assertTrue(timelock.isQueued(txHash) == false, "timelock entry not consumed");
        }
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

    function _realId(RealPoolKey memory key) internal pure returns (RealPoolId) {
        return RealPoolId.wrap(
            keccak256(abi.encode(key.currency0, key.currency1, key.fee, key.tickSpacing, key.hooks))
        );
    }

    function _slot0(RealPoolKey memory key) internal view returns (uint160 sqrtPriceX96) {
        (sqrtPriceX96,,,) = StateLibrary.getSlot0(pm, _realId(key));
    }

    function _initializeIfNeeded(RealPoolKey memory key, uint160 sqrtPriceX96) internal {
        if (_slot0(key) == 0) {
            pm.initialize(key, sqrtPriceX96);
        }
    }

    /// @dev Mirrors AddBaseCbBtcUsdc._oracleSqrtPriceX96 so the test validates
    ///      the same 6dp/8dp raw-price conversion used by the bootstrap script.
    function _oracleSqrtPriceX96() internal view returns (uint160) {
        uint256 price0 = priceFeed.getTwapPrice(USDC);
        (, int256 answer,, uint256 updatedAt,) = AggregatorV3Interface(CBBTC_USD_FEED).latestRoundData();
        uint8 feedDecimals = AggregatorV3Interface(CBBTC_USD_FEED).decimals();
        require(feedDecimals == CBBTC_FEED_DECIMALS, "feed decimals changed");
        require(price0 > 0 && answer > 0 && updatedAt > 0, "bad oracle answer");
        uint256 price1 = uint256(answer) * (10 ** (18 - feedDecimals));

        uint256 targetX192 = FullMath.mulDiv(
            price0 * (10 ** CBBTC_DECIMALS),
            uint256(1) << 192,
            price1 * (10 ** USDC_DECIMALS)
        );
        uint160 rawSqrt = uint160(Math.sqrt(targetX192));
        return EswapTickMath.getSqrtRatioAtTick(CoreTickMath.getTickAtSqrtPrice(rawSqrt));
    }
}
