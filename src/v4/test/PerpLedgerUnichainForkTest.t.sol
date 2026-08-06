// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {console} from "forge-std/console.sol";
import {PerpLedger} from "../EswapPerpLedger.sol";
import {PriceFeed} from "../PriceFeed.sol";
import {PoolKey} from "../types/PoolKey.sol";
import {Currency} from "../types/Currency.sol";
import {PoolIdLibrary} from "../types/PoolId.sol";

/**
 * @title PerpLedgerUnichainForkTest
 * @notice Runs the PerpLedger against the REAL Unichain mainnet state:
 *         - the REAL V4 PoolManager (0x1f984...04) slot0 via extsload
 *         - the REAL live Chainlink ETH/USD + USDC/USD feeds
 *         - the REAL WETH + USDC tokens
 *
 * @dev Fork tests on the real chain can have slightly stale prices depending on
 *      the RPC fork block. We explicitly read the live values and assert on
 *      "sane" ranges, not exact numbers, to avoid flakiness.
 */
contract PerpLedgerUnichainForkTest is Test {
    using PoolIdLibrary for PoolKey;

    // --- Unichain Mainnet (Chain ID 130) ---
    address constant UNICHAIN_PM = 0x1F98400000000000000000000000000000000004;
    address constant WETH = 0x4200000000000000000000000000000000000006;
    address constant USDC = 0x078D782b760474a361dDA0AF3839290b0EF57AD6;
    address constant ETH_USD_FEED = 0xBcE70e194940a157f3A80566505a7E96f5238CCa;
    address constant USDC_USD_FEED = 0xbd1cD1518eFB92a92100da62D4C488c810dFd75b;

    PerpLedger ledger;
    PriceFeed priceFeed;
    PoolKey key;

    address trader = address(0xA11CE);
    address keeper = address(0xBEEF);

    function setUp() public {
        vm.createSelectFork(vm.envString("UNICHAIN_RPC_URL"));

        // Real tokens must be live on the fork.
        assertGt(WETH.code.length, 0, "WETH not deployed on fork");
        assertGt(USDC.code.length, 0, "USDC not deployed on fork");
        assertGt(UNICHAIN_PM.code.length, 0, "PoolManager not deployed on fork");
        assertGt(ETH_USD_FEED.code.length, 0, "ETH/USD feed not deployed on fork");
        assertGt(USDC_USD_FEED.code.length, 0, "USDC/USD feed not deployed on fork");

        // Real Chainlink-backed PriceFeed.
        priceFeed = new PriceFeed();
        priceFeed.setPriceFeed(WETH, ETH_USD_FEED, 18);
        priceFeed.setPriceFeed(USDC, USDC_USD_FEED, 18);

        // WETH/USDC pool key (USDC sorts below WETH by address).
        key = PoolKey({
            currency0: Currency.wrap(USDC),
            currency1: Currency.wrap(WETH),
            fee: 3000,
            tickSpacing: 60,
            hooks: address(0)
        });

        ledger = new PerpLedger(USDC, address(priceFeed), UNICHAIN_PM, key, WETH);
        ledger.setOICapUsd(1_000_000e18);
        // Real Unichain feeds update on deviation (often 10h+ apart), not on a
        // fixed heartbeat. Match the live cadence or every trade reverts.
        // The feed cap must stay >= the ledger cap so the ledger's configured
        // age is the binding gate; both are set to 24h for Unichain.
        priceFeed.setMaxOracleAge(24 hours);
        ledger.setMaxOracleAge(24 hours);
        ledger.setWhitelist(trader, true);

        deal(USDC, trader, 100_000e18);
        deal(USDC, keeper, 100_000e18);
        vm.prank(trader);
        IERC20Like(USDC).approve(address(ledger), type(uint256).max);
        vm.prank(keeper);
        IERC20Like(USDC).approve(address(ledger), type(uint256).max);
    }

    function test_RealTwapFeedsAreLive() public view {
        uint256 ethUsd = priceFeed.getTwapPrice(WETH);
        uint256 usdcUsd = priceFeed.getTwapPrice(USDC);
        console.log("ETH/USD:", ethUsd / 1e18);
        console.log("USDC/USD:", usdcUsd / 1e18);
        // WETH must be sane (500..10000 USD) and USDC ~= 1 USD.
        assertGt(ethUsd, 500e18);
        assertLt(ethUsd, 10_000e18);
        assertGt(usdcUsd, 9e17);
        assertLt(usdcUsd, 11e17);
    }

    function test_RealSlot0ReadViaExtsload() public {
        // The ledger derives its spot trigger from the REAL PoolManager slot0.
        // If the pool doesn't exist at this key, extsload returns 0 and the
        // health price reverts with InvalidOracle. We probe the internal
        // trigger through a tiny wrapper by deploying a proxy ledger... but the
        // trigger is internal, so instead we assert that a position CAN be
        // opened+kept alive, which proves the real slot0 read succeeded.
        vm.prank(trader);
        ledger.open(true, 3, 1_000e18); // open() only needs a fresh TWAP.
        assertTrue(ledger.positionOf(trader).active);
        // Now prove the spot read works: isLiquidatable computes min(spot,twap).
        // With a healthy real pool this returns false (not liquidatable).
        assertFalse(ledger.isLiquidatable(trader));
    }

    function test_RealOpenAndSettle() public {
        vm.prank(trader);
        ledger.open(true, 3, 1_000e18); // $3k notional long, $1k margin

        PerpLedger.Position memory pos = ledger.positionOf(trader);
        assertEq(pos.notionalUsd / pos.marginUsd, 3); // 3x
        assertTrue(pos.isLong);

        // Fresh TWAP (not stale) settles fine.
        vm.prank(trader);
        ledger.settle(0, type(uint256).max);
        assertFalse(ledger.positionOf(trader).active);
    }

    function test_RealInsurancePoolFunded() public {
        vm.prank(keeper);
        ledger.depositInsurance(10_000e18);
        assertGt(ledger.insuranceUsd(), 0);
        // Real USDC backing actually transferred into the ledger.
        assertGe(IERC20Like(USDC).balanceOf(address(ledger)), 10_000e18 - 1e6);
    }

    function test_RealPriceIsNotStale() public {
        uint256 updatedAt = priceFeed.getTwapPriceUpdatedAt(WETH);
        assertGt(updatedAt, 0);
        assertLt(block.timestamp - updatedAt, 24 hours);
    }
}

interface IERC20Like {
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address who) external view returns (uint256);
}
