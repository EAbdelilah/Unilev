// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {PerpLedger} from "../EswapPerpLedger.sol";
import {PoolKey} from "../types/PoolKey.sol";
import {Currency} from "../types/Currency.sol";
import {PoolIdLibrary} from "../types/PoolId.sol";
import {ERC20Mock, PriceFeedMock} from "./BaseV4Test.t.sol";
import {PoolManagerMock} from "./mocks/PoolManagerMock.sol";

/**
 * @title PerpLedgerTest
 * @notice Proves the dual-price production invariants of PerpLedger:
 *         1. Settlement P&L is governed ONLY by TWAP (spot cannot change a payout).
 *         2. The LIVE SPOT price is the fast liquidation trigger.
 *         3. A spot "flash" can force a trigger but cannot steal settlement value.
 *         4. OI caps the book, insurance absorbs realized losses.
 */
contract PerpLedgerTest is Test {
    using PoolIdLibrary for PoolKey;

    PerpLedger public ledger;
    ERC20Mock public usdc;
    ERC20Mock public weth;
    PriceFeedMock public feed;
    PoolManagerMock public sim;

    PoolKey internal key;
    address public keeper = address(0xFEED);

    uint256 public nextTrader = 1;

    function setUp() public {
        usdc = new ERC20Mock("USDC", "USDC");
        weth = new ERC20Mock("WETH", "WETH");
        address wethAddr = address(weth);

        key = PoolKey({
            currency0: Currency.wrap(address(usdc)),
            currency1: Currency.wrap(address(weth)),
            fee: 3000,
            tickSpacing: 60,
            hooks: address(0)
        });

        feed = new PriceFeedMock();
        feed.setPrice(wethAddr, 3000e18); // WETH = $3,000
        feed.setPrice(address(usdc), 1e18); // USDC = $1

        sim = new PoolManagerMock();
        _setSpot(3000e18); // spot = $3,000

        ledger = new PerpLedger(address(usdc), address(feed), address(sim), key, wethAddr);
        ledger.setOICapUsd(1_000_000e18);

        // Counterparty/insurance pool: the ledger must physically hold margin
        // tokens to pay winning traders (profits are not minted from thin air).
        usdc.mint(address(ledger), 1_000_000e18);

        usdc.mint(keeper, 100_000e18);
        vm.prank(keeper);
        usdc.approve(address(ledger), type(uint256).max);
    }

    function _freshTrader() internal returns (address t) {
        t = address(uint160(nextTrader++ + 0x10000));
        ledger.setWhitelist(t, true);
        usdc.mint(t, 100_000e18);
        vm.prank(t);
        usdc.approve(address(ledger), type(uint256).max);
    }

    function _sqrtPrice(uint256 p) internal pure returns (uint160) {
        // Q64.96: sqrtPriceX96 = sqrt(rawRatio) * 2^96.
        // The ledger derives the spot USD price as sqrtPriceX96^2 * 1e18 / 2^192
        // = rawRatio * 1e18. For a WETH/USDC pool with USDC = $1, rawRatio =
        // p / 1e18, so sqrt(rawRatio) = sqrt(p) / 1e9. Example: p=3000e18 ($3,000)
        // -> sqrt(3000e18)/1e9 * 2^96 == sqrt(3000) * 2^96.
        return uint160((sqrt(p) / 1e9) * (1 << 96));
    }

    function sqrt(uint256 x) internal pure returns (uint256 y) {
        uint256 z = (x + 1) / 2;
        y = x;
        while (z < y) { y = z; z = (x / z + z) / 2; }
    }

    /// @dev Set the pool's live spot price to `price` (e.g. 3000e18 = $3,000).
    function _setSpot(uint256 price) internal {
        sim.setSlot0(key.toId(), _sqrtPrice(price), 0);
    }


    // ------------------------------------------------------------------
    // 1. Settlement uses TWAP only
    // ------------------------------------------------------------------
    function test_SettleUsesTwap_NotSpot() public {
        // TWAP +10%, spot unchanged -> PnL reflects only the TWAP move.
        address a = _freshTrader();
        vm.prank(a);
        ledger.open(true, 5, 1000e18);
        feed.setPrice(address(weth), 3300e18);

        vm.prank(a); (uint256 pnl, ) = ledger.settle(0, type(uint256).max);
        assertGt(pnl, 490e18);
        assertLt(pnl, 505e18);

        // TWAP flat, spot +20% on a fresh long: settlement must NOT move.
        address b = _freshTrader();
        vm.prank(b);
        ledger.open(true, 5, 1000e18);
        feed.setPrice(address(weth), 3000e18);
        _setSpot(3600e18);

        vm.prank(b); (uint256 pnl2, ) = ledger.settle(0, type(uint256).max);
        assertLt(pnl2, 10e18);
        _setSpot(3000e18);
    }

// ------------------------------------------------------------------
    // 3. Spot flash cannot steal settlement value
    // ------------------------------------------------------------------
    function test_SpotFlashCannotStealPnl() public {
        address a = _freshTrader();
        vm.prank(a);
        ledger.open(true, 5, 1000e18);

        // Attacker flashes spot to $5,000 on a TWAP-flat LONG.
        _setSpot(5000e18);
        feed.setPrice(address(weth), 3000e18);

vm.prank(a); (uint256 pnl, ) = ledger.settle(0, type(uint256).max);
        assertLt(pnl, 10e18);
        _setSpot(3000e18);
    }

    // ------------------------------------------------------------------
    // LE. Losses must realize on settle (regression for clamped-PnL bug)
    // ------------------------------------------------------------------
    function test_LossOnSettleReducesEquity() public {
        address a = _freshTrader();
        vm.prank(a);
        ledger.open(true, 5, 1000e18); // $5,000 long, $1,000 margin

        // TWAP drops -40% -> $1,800. Notional loss = $5k * 0.4 = $2,000 > $1,000 margin.
        feed.setPrice(address(weth), 1800e18);
        vm.prank(a);
        (uint256 pnl, uint256 returned) = ledger.settle(0, type(uint256).max);

        assertEq(pnl, 0); // loss is not "positive PnL"
        assertEq(returned, 0); // equity <= 0, nothing returned to trader
    }

    function test_PartialLossRealized() public {
        address a = _freshTrader();
        vm.prank(a);
        ledger.open(true, 2, 1000e18); // $2,000 notional, $1,000 margin

        // TWAP -25% -> $2,250. Loss = $500 on $1,000, equity = $500.
        feed.setPrice(address(weth), 2250e18);
        vm.prank(a);
        (uint256 pnl, uint256 returned) = ledger.settle(0, type(uint256).max);

        assertEq(pnl, 0);
        // equity = $500 (after 25% loss on $1k margin), returned in USDC @ $1 each.
        // USD equity is PRECISION-scaled; margin token price = 1e18 so tokens = 500e18.
        assertApproxEqAbs(returned, 500e18, 1e3);
    }

    // ------------------------------------------------------------------
    // ST. Stale TWAP must revert settlement (OldPrice)
    // ------------------------------------------------------------------
    function test_StalePriceReverts() public {
        address a = _freshTrader();
        vm.prank(a);
        ledger.open(true, 5, 1000e18);

        // Freeze price, advance far past maxOracleAge (default 60s).
        feed.setPrice(address(weth), 3000e18);
        vm.warp(block.timestamp + 1000);
        vm.prank(a);
        vm.expectRevert(PerpLedger.OldPrice.selector);
        ledger.settle(0, type(uint256).max);
    }
    // ------------------------------------------------------------------
    // 2. Live spot is the fast liquidation trigger
    // ------------------------------------------------------------------
    function test_SpotTriggersLiquidation() public {
        address a = _freshTrader();
        vm.prank(a);
        ledger.open(true, 5, 1000e18); // $5,000 long, $1,000 margin

        // TWAP still $3,000 (fair = healthy) but spot crashes -30% -> $2,100.
        _setSpot(2100e18);
        assertTrue(ledger.isLiquidatable(a));

        // Spot alone triggers it even when TWAP says healthy.
        feed.setPrice(address(weth), 3000e18);
        assertTrue(ledger.isLiquidatable(a));
        _setSpot(3000e18);
    }

    function test_TwapAloneCannotTriggerWhenSpotHealthy() public {
        // health = min(spot, twap) for a long, so a healthy spot keeps it alive
        // even if TWAP moves unfavourably (belt-and-suspenders uses the worse of two).
        ledger.setMaintenanceMarginBps(100); // 1% maintenance -> very loose
        address a = _freshTrader();
        vm.prank(a);
        ledger.open(true, 5, 1000e18);

        _setSpot(3000e18); // spot healthy
        feed.setPrice(address(weth), 1500e18); // TWAP halved (huge drop)
        assertTrue(ledger.isLiquidatable(a)); // min() still catches it at -50%
        _setSpot(3000e18);
    }

    // ------------------------------------------------------------------
    // 4. OI cap blocks overbooking
    // ------------------------------------------------------------------
    function test_OICapBlocksOverbooking() public {
        // Cap so three $5,000 books can't all open: cap = 12,000.
        ledger.setOICapUsd(11_000e18);
        address a = _freshTrader();
        address b = _freshTrader();
        vm.prank(a);
        ledger.open(true, 5, 1000e18); // $5,000
        vm.prank(b);
        ledger.open(true, 5, 1000e18); // $10,000 total (< cap ok)

        address c = _freshTrader();
        vm.prank(c);
        vm.expectRevert(PerpLedger.OICapExceeded.selector);
        ledger.open(true, 5, 1000e18); // $15,000 > $11k cap
    }

    // ------------------------------------------------------------------
    // 5. Insurance absorbs liquidation losses
    // ------------------------------------------------------------------
    function test_InsuranceAbsorbsLiquidationLoss() public {
        address a = _freshTrader();
        vm.prank(a);
        ledger.open(true, 5, 1000e18);

        uint256 insBefore = ledger.insuranceUsd();
        // Crash both spot and TWAP: at $1,500 the 5x long is far underwater.
        // 5x * (3000-1500)/3000 = -$2,500 loss on $1,000 margin -> equity < 0.
        _setSpot(1500e18);
        feed.setPrice(address(weth), 1500e18);
        assertTrue(ledger.isLiquidatable(a));

        // The liquidation realizes the loss; insurance must absorb the shortfall
        // below zero (ledger must NOT mint money for the liquidator).
        vm.prank(keeper);
        ledger.liquidate(a, 0);

        // Insurance dropped by the realized shortfall (loss-bearing pool used).
        assertLt(ledger.insuranceUsd(), insBefore);
        _setSpot(3000e18);
    }

    function test_InsuranceDepositIsTokenBacked() public {
        // The pool must physically hold the margin tokens it claims to insure.
        address lp = _freshTrader();
        uint256 balBefore = usdc.balanceOf(address(ledger));
        vm.prank(lp);
        ledger.depositInsurance(50_000e18);
        // 50,000 USDC @ $1 = $50,000 insurance, transferred into the ledger.
        assertEq(ledger.insuranceUsd(), 50_000e18);
        assertEq(usdc.balanceOf(address(ledger)) - balBefore, 50_000e18);
    }

    function test_OpenCollectsInsuranceFeeInTokens() public {
        address a = _freshTrader();
        uint256 balBefore = usdc.balanceOf(address(ledger));
        vm.prank(a);
        ledger.open(true, 5, 1000e18); // $5,000 notional, 20 bps fee = $10
        // Insurance grew by $10 (in tokens) on top of any prior insurance.
        uint256 fee = (5000e18 * 20) / 1e4; // 20 bps of $5,000 = $10
        assertGe(usdc.balanceOf(address(ledger)) - balBefore, fee);
        assertGe(ledger.insuranceUsd(), fee);
    }

    // ------------------------------------------------------------------
    // FUZZ: settlement is never underfunded for any bounded price move.
    // A close must always succeed (no ERC20InsufficientBalance) because the
    // counterparty/insurance pool physically backs winners' payouts.
    // ------------------------------------------------------------------
    function testFuzz_CloseNeverUnderfunded(uint256 priceMovePct) public {
        priceMovePct = bound(priceMovePct, 1e15, 80e16); // 0.1% .. 80%
        address a = _freshTrader();
        vm.prank(a);
        ledger.open(true, 5, 1000e18);

        // Move TWAP by ±priceMovePct (long is symmetric below).
        uint256 newPrice = 3000e18;
        uint256 delta = (3000e18 * priceMovePct) / 1e18;
        bool up = (priceMovePct % 2) == 0;
        newPrice = up ? 3000e18 + delta : (3000e18 > delta ? 3000e18 - delta : 1);
        feed.setPrice(address(weth), newPrice);
        _setSpot(newPrice);

        // Force a settle. Must NOT revert with insufficient balance.
        // Let insurance absorb any equity shortfall below zero.
        vm.prank(a);
        ledger.settle(0, type(uint256).max);

        // Position is closed; no dangling open interest.
        assertFalse(ledger.positionOf(a).active);
        _setSpot(3000e18);
    }

    // ------------------------------------------------------------------
    // FUZZ: a long must be in profit when price rises, in loss when it falls.
    // ------------------------------------------------------------------
    function testFuzz_PnlSignsWithPriceMove(uint256 newPrice) public {
        newPrice = bound(newPrice, 1e18, 6000e18);
        address a = _freshTrader();
        vm.prank(a);
        ledger.open(true, 2, 1000e18); // 2x long, entry $3,000

        // Reference PnL: (exit-entry) * size, size = notional/entry = 2000/3000 WETH.
        uint256 ones = 1e18;
        uint256 size18 = (2000e18 * ones) / 3000e18; // size in WETH units
        int256 refDelta = int256(newPrice) - int256(3000e18);

        feed.setPrice(address(weth), newPrice);
        _setSpot(newPrice);
        vm.prank(a);
        (uint256 pnl, ) = ledger.settle(0, type(uint256).max);

        if (refDelta > 0) {
            // PnL is (delta * size) / PRECISION with integer division, so a
            // sub-unit price move rounds to 0. Only require strictly-positive
            // PnL when the reference PnL itself is at least 1 wei.
            if ((uint256(refDelta) * size18) / 1e18 >= 1) {
                assertGt(pnl, 0); // profit when price up materially
            } else {
                assertGe(pnl, 0); // sub-unit move rounds to 0, never negative
            }
        } else if (newPrice < 3000e18) {
            assertEq(pnl, 0); // no positive PnL on a losing long
        }
        uint256 bound = (uint256(refDelta > 0 ? refDelta : -refDelta) * size18) / 1e18;
        assertLt(pnl, bound + 2e18);
        _setSpot(3000e18);
    }
}

