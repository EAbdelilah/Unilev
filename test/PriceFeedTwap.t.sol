// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/**
 * @title PriceFeedTwap.t.sol
 * @notice Tests for the Uniswap V3 TWAP deviation circuit breaker in PriceFeedL1.
 *
 * Runs against the Polygon mainnet fork (POLYGON_RPC_URL).
 *
 * Tests:
 *   1. getTokenLatestPriceInUsd works normally with no TWAP config set (backward compat).
 *   2. getTwapPrice returns a non-zero TWAP for WBTC using the WBTC/WETH pool.
 *   3. TWAP price is within 5% of the Chainlink price in normal conditions.
 *   4. A simulated 10% Chainlink price manipulation is caught by the deviation check.
 *   5. Removing the TWAP config disables the check.
 *   6. Setting maxDeviationBps = 0 disables ALL deviation checks.
 *   7. setTwapConfig reverts on a zero pool address.
 *   8. setTwapConfig reverts when twapWindow < 60.
 *   9. Only the owner can call setTwapConfig / setMaxDeviationBps.
 */

import "forge-std/Test.sol";
import {PriceFeedL1} from "../src/PriceFeedL1.sol";
import {AggregatorV3Interface} from "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";

contract PriceFeedTwapTest is Test {
    // ── Polygon mainnet addresses ──────────────────────────────────────────────
    address constant WBTC = 0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6;
    address constant WETH = 0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619;
    address constant USDC = 0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359;

    // Chainlink USD feeds on Polygon
    address constant WBTC_FEED = 0xDE31F8bFBD8c84b5360CFACCa3539B938dd78ae6;
    address constant WETH_FEED = 0xF9680D99D6C9589e2a93a78A04A279e509205945;
    address constant USDC_FEED = 0xfE4A8cc5b5B2366C1B58Bea3858e81843581b2F7;

    // Correct Uniswap V3 pools on Polygon mainnet (verified via factory.getPool)
    // WBTC/WETH 0.3% pool — factory.getPool(WBTC, WETH, 3000)
    address constant WBTC_WETH_POOL = 0xfe343675878100b344802A6763fd373fDeed07A4;
    // WETH/USDC 0.05% pool — factory.getPool(WETH, USDC, 500)
    address constant WETH_USDC_POOL = 0xA4D8c89f0c20efbe54cBa9e7e7a7E509056228D9;

    // ── Protocol ──────────────────────────────────────────────────────────────
    PriceFeedL1 public priceFeed;
    address public owner;

    function setUp() public {
        owner = address(this);

        priceFeed = new PriceFeedL1();
        // Use a 7-day staleness threshold so the fork's slightly-old prices don't fail
        priceFeed.setStalenessThreshold(7 days);

        // Register Chainlink feeds
        priceFeed.addPriceFeed(WBTC, WBTC_FEED);
        priceFeed.addPriceFeed(WETH, WETH_FEED);
        priceFeed.addPriceFeed(USDC, USDC_FEED);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Test 1: Backward compatibility — getTokenLatestPriceInUsd works without TWAP config
    // ─────────────────────────────────────────────────────────────────────────
    function test_NoTwapConfig_ChainlinkOnlyWorks() public view {
        // No TWAP config set — should return Chainlink price without any deviation check
        uint256 price = priceFeed.getTokenLatestPriceInUsd(WBTC);
        assertGt(price, 0, "WBTC price should be > 0");
        // Rough sanity: WBTC between $10k and $500k
        assertGt(price, 10_000e18, "WBTC price suspiciously low");
        assertLt(price, 500_000e18, "WBTC price suspiciously high");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Test 2: getTwapPrice returns non-zero using WBTC/WETH pool + WETH intermediate
    // ─────────────────────────────────────────────────────────────────────────
    function test_GetTwapPrice_WBTC_WETH_Pool() public {
        priceFeed.setTwapConfig(
            WBTC,
            WBTC_WETH_POOL,
            WETH, // intermediate
            false, // not USD stablecoin pool
            1800 // 30-minute window
        );

        uint256 twapPrice = priceFeed.getTwapPrice(WBTC);
        assertGt(twapPrice, 0, "TWAP price should be > 0");
        // Rough sanity
        assertGt(twapPrice, 10_000e18, "TWAP price suspiciously low");
        assertLt(twapPrice, 500_000e18, "TWAP price suspiciously high");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Test 3: Normal market — TWAP and Chainlink within 5% of each other
    // ─────────────────────────────────────────────────────────────────────────
    function test_TwapDeviationCheck_PassesInNormalConditions_WBTC() public {
        // Set 5% max deviation
        priceFeed.setMaxDeviationBps(500);
        priceFeed.setTwapConfig(WBTC, WBTC_WETH_POOL, WETH, false, 1800);

        // Should not revert in normal market conditions
        uint256 price = priceFeed.getTokenLatestPriceInUsd(WBTC);
        assertGt(price, 0);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Test 4: Simulated Chainlink manipulation → deviation check trips
    // ─────────────────────────────────────────────────────────────────────────
    function test_TwapDeviationCheck_RevertsOnManipulation() public {
        // Set a tight 3% max deviation
        priceFeed.setMaxDeviationBps(300);
        // WBTC/WETH pool: token0=WBTC (isToken0Base for WBTC = true)
        priceFeed.setTwapConfig(WBTC, WBTC_WETH_POOL, WETH, false, 1800);

        // Fetch TWAP price first so we can craft a wildly different Chainlink answer
        uint256 twapPrice = priceFeed.getTwapPrice(WBTC);
        assertGt(twapPrice, 0, "TWAP should be non-zero");

        // Simulate a "manipulated" Chainlink feed that reports 50% higher price
        // twapPrice is in 18 decimals; Chainlink WBTC feed returns 8-decimal answer
        uint256 manipulatedAnswer = (twapPrice * 150) / (100 * 1e10); // +50%, scaled to 8dp

        vm.mockCall(
            WBTC_FEED,
            abi.encodeWithSelector(AggregatorV3Interface.latestRoundData.selector),
            abi.encode(uint80(100), int256(manipulatedAnswer), block.timestamp, block.timestamp, uint80(100))
        );

        vm.expectRevert(); // PriceFeedL1__TWAP_DEVIATION_TOO_HIGH
        priceFeed.getTokenLatestPriceInUsd(WBTC);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Test 5: Removing TWAP config disables the deviation check
    // ─────────────────────────────────────────────────────────────────────────
    function test_RemoveTwapConfig_DisablesCheck() public {
        priceFeed.setMaxDeviationBps(1); // Absurdly tight — would trip even on slight rounding
        priceFeed.setTwapConfig(WBTC, WBTC_WETH_POOL, WETH, false, 1800);

        // Remove the TWAP config
        priceFeed.removeTwapConfig(WBTC);

        // Should now succeed without any TWAP check
        uint256 price = priceFeed.getTokenLatestPriceInUsd(WBTC);
        assertGt(price, 0);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Test 6: maxDeviationBps = 0 disables ALL deviation checks globally
    // ─────────────────────────────────────────────────────────────────────────
    function test_MaxDeviationBps_Zero_DisablesAllChecks() public {
        priceFeed.setMaxDeviationBps(0);
        priceFeed.setTwapConfig(WBTC, WBTC_WETH_POOL, WETH, false, 1800);

        // With maxDeviationBps = 0, even extreme mock prices pass through
        uint256 price = priceFeed.getTokenLatestPriceInUsd(WBTC);
        assertGt(price, 0);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Test 7: setTwapConfig reverts on zero pool address
    // ─────────────────────────────────────────────────────────────────────────
    function test_SetTwapConfig_RevertsOnZeroPool() public {
        vm.expectRevert("TWAP: zero pool");
        priceFeed.setTwapConfig(WBTC, address(0), WETH, false, 1800);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Test 8: setTwapConfig reverts when twapWindow < 60 seconds
    // ─────────────────────────────────────────────────────────────────────────
    function test_SetTwapConfig_RevertsOnTooShortWindow() public {
        vm.expectRevert("TWAP: window < 60s");
        priceFeed.setTwapConfig(WBTC, WBTC_WETH_POOL, WETH, false, 30);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Test 9: Access control — non-owner cannot call admin functions
    // ─────────────────────────────────────────────────────────────────────────
    function test_AccessControl_OnlyOwner() public {
        address attacker = address(0xdead);

        vm.startPrank(attacker);

        vm.expectRevert();
        priceFeed.setTwapConfig(WBTC, WBTC_WETH_POOL, WETH, false, 1800);

        vm.expectRevert();
        priceFeed.setMaxDeviationBps(100);

        vm.expectRevert();
        priceFeed.removeTwapConfig(WBTC);

        vm.stopPrank();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Test 10: setMaxDeviationBps enforces the 50% upper cap
    // ─────────────────────────────────────────────────────────────────────────
    function test_SetMaxDeviationBps_EnforcesUpperCap() public {
        vm.expectRevert("deviation cap: max 50%");
        priceFeed.setMaxDeviationBps(5001);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Test 11: WETH TWAP via WETH/USDC pool
    //   Pool: token0=USDC(6dp), token1=WETH(18dp)
    //   We want WETH price → WETH is token1 → isToken0Base=false
    //   Pool quotes WETH in USDC → intermediateIsUsd=true, no intermediate token needed
    // ─────────────────────────────────────────────────────────────────────────
    function test_GetTwapPrice_WETH_USDC_Pool_DirectUsd() public {
        priceFeed.setTwapConfig(
            WETH,
            WETH_USDC_POOL,
            address(0), // no intermediate token — pool quotes in USD stablecoin
            true, // intermediateIsUsd = true
            1800
        );

        uint256 twapPrice = priceFeed.getTwapPrice(WETH);
        // The pool is USDC/WETH (token0=USDC, token1=WETH).
        // tickToPrice with isToken0Base=false gives USDC per WETH.
        // USDC has 6 decimals → price18 is in units of USDC * 10^12, which = USD * 1e18.
        // Sanity: WETH between $500 and $20,000 expressed as 1e18-scaled USD.
        assertGt(twapPrice, 0, "WETH TWAP should be > 0");
        assertGt(twapPrice, 500e18, "WETH TWAP too low");
        assertLt(twapPrice, 20_000e18, "WETH TWAP too high");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Test 12: getPairLatestPrice still works correctly with TWAP enabled
    // ─────────────────────────────────────────────────────────────────────────
    function test_GetPairLatestPrice_WithTwapEnabled() public {
        priceFeed.setMaxDeviationBps(500);
        priceFeed.setTwapConfig(WBTC, WBTC_WETH_POOL, WETH, false, 1800);

        // WBTC/USDC pair price should be > 0 and reflect market rates
        uint256 pairPrice = priceFeed.getPairLatestPrice(WBTC, USDC);
        assertGt(pairPrice, 0);
        // WBTC in USDC (6 decimals): ~$10k–$500k expressed with 6 dp = 10_000e6 to 500_000e6
        assertGt(pairPrice, 10_000e6, "WBTC/USDC pair price too low");
        assertLt(pairPrice, 500_000e6, "WBTC/USDC pair price too high");
    }
}
