// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title EswapTradingScenariosTest
 * @notice Full matrix of trading scenarios:
 *   - LONG  1x / 2x / 3x / 4x / 5x  × { WIN | LOSE | LIQUIDATED }
 *   - SHORT 1x / 2x / 3x / 4x / 5x  × { WIN | LOSE | LIQUIDATED }
 *   = 30 scenarios
 *
 * Sign Convention (V4 afterSwap):
 *   zeroForOne = false → isLong = true  (paying token1, receiving/buying token0 → LONG token0)
 *   zeroForOne = true  → isLong = false (paying token0, receiving/buying token1 → SHORT token0)
 *
 *   amount0: negative = token0 left the pool (hook consumed)
 *   amount1: positive = token1 received by the pool (zeroForOne=true bought amount)
 *
 * Collateral is the bought asset (see afterSwap):
 *   LONG  → collateral = currency0 (token0), borrow = currency1 (token1)
 *   SHORT → collateral = currency1 (token1), borrow = currency0 (token0)
 *
 * Price oracle (PriceFeedMock): prices set relative to 1e18 baseline.
 *   LONG  WINS  → token0 price RISES  (collateral appreciates, token1 stays)
 *   LONG  LOSES → token0 price FALLS
 *   SHORT WINS  → token1 price RISES  (collateral appreciates vs the token0 debt)
 *   SHORT LOSES → token1 price FALLS
 *
 * Liquidation threshold: collateralValueUSD * 100 < borrowValueUSD * 115  (115% collat ratio)
 */

import {BaseV4Test} from "./BaseV4Test.t.sol";
import {EswapMarginHook} from "../EswapMarginHook.sol";
import {PoolKey} from "../types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "../types/PoolId.sol";
import {Currency} from "../types/Currency.sol";
import {IPoolManager} from "../interfaces/IPoolManager.sol";
import {BalanceDeltaLibrary} from "../types/BalanceDelta.sol";

contract EswapTradingScenariosTest is BaseV4Test {
    using PoolIdLibrary for PoolKey;

    // sqrtPriceX96 for 1:1 ratio (Q96)
    uint160 constant SQRT_PRICE_1_1 = 79228162514264337593543950336;

    // ─── Internal helpers ──────────────────────────────────────────────────────

    /**
     * @dev Open a LONG position (zeroForOne = false → isLong = true)
     *      Trader provides `marginEth` as token1 input.
     *      Hook borrows `marginEth * (lev - 1)` of token1 from flash reserves and
     *      swaps the combined `marginEth * lev` into token0 (the bought asset,
     *      which becomes the position's collateral).
     *
     *      afterSwap params for long (zeroForOne=false):
     *        amountSpecified = -marginEth * lev (we sold that much token1)
     *        amount0 = -(marginEth * lev)       token0 left pool (hook received the output)
     *        amount1 = +(marginEth * lev * 0.96) token1 consumed (input, 4% slippage)
     */
    function _openLong(uint8 lev, uint256 marginEth, address trader) internal {
        // Neutral 1:1 prices so TWAP circuit breaker stays quiet
        priceFeed.setPrice(address(token0), 1e18);
        priceFeed.setPrice(address(token1), 1e18);
        manager.setSlot0(key.toId(), SQRT_PRICE_1_1, 0);

        bytes memory data = abi.encode(true, lev, trader);
        int128 totalSize = -int128(uint128(marginEth * lev));
        int128 bought    =  int128(uint128((marginEth * lev * 96) / 100)); // 4% slippage

        vm.prank(address(manager));
        hook.beforeSwap(address(this), key, IPoolManager.SwapParams(false, int128(uint128(marginEth)), 0), data);

        vm.prank(address(manager));
        hook.afterSwap(address(this), key, IPoolManager.SwapParams(false, totalSize, 0), BalanceDeltaLibrary.toBalanceDelta(-totalSize, -bought), data);
    }

    /**
     * @dev Open a SHORT position (zeroForOne = true → isLong = false)
     *      Trader provides `marginEth` as token0 input.
     *      Hook borrows `marginEth * (lev - 1)` of token0 and swaps it all into token1
     *      (the bought asset, which becomes the position's collateral).
     *
     *      afterSwap params for short (zeroForOne=true):
     *        amountSpecified = -marginEth * lev
     *        amount0 =  +(marginEth * lev * 0.96)  token0 output the hook received (as input back)
     *        amount1 = -(marginEth * lev)           token1 left pool
     */
    function _openShort(uint8 lev, uint256 marginEth, address trader) internal {
        // Neutral 1:1 prices so TWAP circuit breaker stays quiet
        priceFeed.setPrice(address(token0), 1e18);
        priceFeed.setPrice(address(token1), 1e18);
        manager.setSlot0(key.toId(), SQRT_PRICE_1_1, 0);

        bytes memory data = abi.encode(true, lev, trader);
        int128 totalSize = -int128(uint128(marginEth * lev));
        int128 bought    =  int128(uint128((marginEth * lev * 96) / 100));

        vm.prank(address(manager));
        hook.beforeSwap(address(this), key, IPoolManager.SwapParams(true, int128(uint128(marginEth)), 0), data);

        vm.prank(address(manager));
        hook.afterSwap(address(this), key, IPoolManager.SwapParams(true, totalSize, 0), BalanceDeltaLibrary.toBalanceDelta(-bought, -totalSize), data);
    }

    /// @dev Simulate a liquidation (seeds hook with tokens, sets swap delta, executes)
    function _liquidate(address trader, bool isLong, int128 recoveredDelta) internal {
        // Seed insurance so bad-debt path doesn't revert in WIN/LOSE scenarios
        token1.mint(address(this), 50 ether);
        token1.approve(address(hook), 50 ether);
        hook.seedInsuranceFund(key.currency1, 10 ether);
        token0.mint(address(this), 50 ether);
        token0.approve(address(hook), 50 ether);
        hook.seedInsuranceFund(key.currency0, 10 ether);

        int128 posDelta = recoveredDelta > 0 ? recoveredDelta : -recoveredDelta;
        manager.setNextSwapDelta(posDelta, posDelta);
        hook.executeLiquidation(key, trader, 0, address(this));
    }

    /// @dev Assert position is fully zeroed out after close/liquidation
    function _assertPositionGone(address trader) internal view {
        (address t, uint256 col,,,,,,,) = hook.positions(key.toId(), trader);
        assertEq(t,   address(0), "trader not zeroed");
        assertEq(col, 0,          "collateral not zeroed");
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  LONG SCENARIOS
    //
    //  For a LONG:
    //    isLong  = true
    //    collateral currency = token0 (the bought asset, stored as boughtAmount)
    //    borrow   currency   = token1 (what was borrowed to lever up)
    //
    //  isLiquidatable: collateralValueUSD * 100 < borrowValueUSD * 115
    //    → token0.price * collateralAmount * 100 < token1.price * borrowedAmount * 115
    //
    //  LONG WINS  → set token0 price high (e.g. 2x)
    //  LONG LOSES → set token0 price low  (e.g. 0.5x), above liquidation threshold
    //  LIQUIDATED → set token0 price very low so health factor < 1
    // ══════════════════════════════════════════════════════════════════════════

    // ─── LONG 1x ──────────────────────────────────────────────────────────────

    function test_Long_1x_Win() public {
        _openLong(1, 1 ether, address(this));

        // Price of token0 doubles: collateral now worth 2x entry
        priceFeed.setPrice(address(token0), 2e18);
        priceFeed.setPrice(address(token1), 1e18);

        (, uint256 collateral, uint256 borrow, uint8 lev, bool isLong,,,,) = hook.positions(key.toId(), address(this));
        assertTrue(isLong,     "should be long");
        assertEq(lev,    1,    "leverage should be 1");
        assertEq(borrow, 0,    "1x has no borrow");
        assertTrue(collateral > 0, "collateral recorded");

        // With 1x leverage, no borrow → never liquidatable regardless of price
        EswapMarginHook.Position memory pos = _buildPos(collateral, borrow, lev, true);
        assertFalse(hook.isLiquidatable(pos, key), "1x long should not be liquidatable");
    }

    function test_Long_1x_Lose() public {
        _openLong(1, 1 ether, address(this));

        // Price of token0 halves: position is underwater on paper
        priceFeed.setPrice(address(token0), 0.5e18);
        priceFeed.setPrice(address(token1), 1e18);

        (, uint256 collateral, uint256 borrow, uint8 lev, bool isLong,,,,) = hook.positions(key.toId(), address(this));
        assertTrue(isLong);
        assertEq(lev, 1);
        assertEq(borrow, 0, "1x: no borrow, so cannot be liquidated even at loss");

        EswapMarginHook.Position memory pos = _buildPos(collateral, borrow, lev, true);
        assertFalse(hook.isLiquidatable(pos, key), "1x long: no borrow, cannot be liquidated");
    }

    function test_Long_1x_NotLiquidatable() public {
        _openLong(1, 1 ether, address(this));

        // Even at extreme price drop: 1x long with no borrow is NEVER liquidatable
        priceFeed.setPrice(address(token0), 0.01e18);
        priceFeed.setPrice(address(token1), 100e18);

        (, uint256 collateral, uint256 borrow, uint8 lev, bool isLong,,,,) = hook.positions(key.toId(), address(this));
        EswapMarginHook.Position memory pos = _buildPos(collateral, borrow, lev, true);
        // borrow = 0, so borrowedValueUSD = 0, threshold never crossed
        assertFalse(hook.isLiquidatable(pos, key), "1x: no leverage = no liquidation risk");
    }

    // ─── LONG 2x ──────────────────────────────────────────────────────────────

    function test_Long_2x_Win() public {
        _openLong(2, 1 ether, address(this));

        // token0 pumps 50%: collateral worth 1.5x, borrow (token1) unchanged
        priceFeed.setPrice(address(token0), 1.5e18);
        priceFeed.setPrice(address(token1), 1e18);

        (, uint256 collateral, uint256 borrow, uint8 lev, bool isLong,,,,) = hook.positions(key.toId(), address(this));
        assertTrue(isLong);
        assertEq(lev, 2);
        assertTrue(borrow > 0, "2x has borrow");

        // Health: collateralUSD * 100 >= borrowUSD * 115 → NOT liquidatable
        EswapMarginHook.Position memory pos = _buildPos(collateral, borrow, lev, true);
        assertFalse(hook.isLiquidatable(pos, key), "2x long winning: not liquidatable");
    }

    function test_Long_2x_Lose() public {
        _openLong(2, 1 ether, address(this));

        // token0 drops 20%: still above liquidation threshold for 2x
        priceFeed.setPrice(address(token0), 0.8e18);
        priceFeed.setPrice(address(token1), 1e18);

        (, uint256 collateral, uint256 borrow, uint8 lev, bool isLong,,,,) = hook.positions(key.toId(), address(this));
        assertTrue(isLong);
        EswapMarginHook.Position memory pos = _buildPos(collateral, borrow, lev, true);
        // 2x: collateral ~1.99e, borrow ~1e. At 0.8 price: collValue=1.592, borrowValue=1 => 159.2 > 115 → safe
        assertFalse(hook.isLiquidatable(pos, key), "2x losing but not yet liquidatable");
    }

    function test_Long_2x_Liquidated() public {
        _openLong(2, 1 ether, address(this));

        // token0 crashes 60%: health factor drops below 1
        // collateral ~1.99 * 0.4 = 0.796, borrow ~1.0: 79.6 < 115 → liquidatable
        priceFeed.setPrice(address(token0), 0.4e18);
        priceFeed.setPrice(address(token1), 1e18);

        (, uint256 collateral, uint256 borrow, uint8 lev, bool isLong,,,,) = hook.positions(key.toId(), address(this));
        EswapMarginHook.Position memory pos = _buildPos(collateral, borrow, lev, true);
        assertTrue(hook.isLiquidatable(pos, key), "2x long: should be liquidatable after 60% drop");

        _liquidate(address(this), true, -2 ether);
        _assertPositionGone(address(this));
    }

    // ─── LONG 3x ──────────────────────────────────────────────────────────────

    function test_Long_3x_Win() public {
        _openLong(3, 1 ether, address(this));

        // token0 pumps 40%
        priceFeed.setPrice(address(token0), 1.4e18);
        priceFeed.setPrice(address(token1), 1e18);

        (, uint256 collateral, uint256 borrow, uint8 lev, bool isLong,,,,) = hook.positions(key.toId(), address(this));
        assertTrue(isLong);
        assertEq(lev, 3);
        EswapMarginHook.Position memory pos = _buildPos(collateral, borrow, lev, true);
        assertFalse(hook.isLiquidatable(pos, key), "3x long winning: not liquidatable");
    }

    function test_Long_3x_Lose() public {
        _openLong(3, 1 ether, address(this));

        // token0 drops 15%: still above threshold for 3x
        priceFeed.setPrice(address(token0), 0.85e18);
        priceFeed.setPrice(address(token1), 1e18);

        (, uint256 collateral, uint256 borrow, uint8 lev, bool isLong,,,,) = hook.positions(key.toId(), address(this));
        assertTrue(isLong);
        EswapMarginHook.Position memory pos = _buildPos(collateral, borrow, lev, true);
        // collateral ~2.985 @ 0.85 = 2.537, borrow ~2: 253.7 > 230 → safe
        assertFalse(hook.isLiquidatable(pos, key), "3x losing but above liquidation threshold");
    }

    function test_Long_3x_Liquidated() public {
        _openLong(3, 1 ether, address(this));

        // token0 crashes 50%: collateral ~2.985 * 0.5 = 1.4925, borrow ~2: 149.25 < 230 → liquidatable
        priceFeed.setPrice(address(token0), 0.5e18);
        priceFeed.setPrice(address(token1), 1e18);

        (, uint256 collateral, uint256 borrow, uint8 lev, bool isLong,,,,) = hook.positions(key.toId(), address(this));
        EswapMarginHook.Position memory pos = _buildPos(collateral, borrow, lev, true);
        assertTrue(hook.isLiquidatable(pos, key), "3x long: liquidatable after 50% drop");

        _liquidate(address(this), true, -3 ether);
        _assertPositionGone(address(this));
    }

    // ─── LONG 4x ──────────────────────────────────────────────────────────────

    function test_Long_4x_Win() public {
        _openLong(4, 1 ether, address(this));

        // token0 pumps 30%
        priceFeed.setPrice(address(token0), 1.3e18);
        priceFeed.setPrice(address(token1), 1e18);

        (, uint256 collateral, uint256 borrow, uint8 lev, bool isLong,,,,) = hook.positions(key.toId(), address(this));
        assertTrue(isLong);
        assertEq(lev, 4);
        EswapMarginHook.Position memory pos = _buildPos(collateral, borrow, lev, true);
        assertFalse(hook.isLiquidatable(pos, key), "4x long winning: not liquidatable");
    }

    function test_Long_4x_Lose() public {
        _openLong(4, 1 ether, address(this));

        // token0 drops 10%: still within safe zone for 4x
        priceFeed.setPrice(address(token0), 0.9e18);
        priceFeed.setPrice(address(token1), 1e18);

        (, uint256 collateral, uint256 borrow, uint8 lev, bool isLong,,,,) = hook.positions(key.toId(), address(this));
        assertTrue(isLong);
        EswapMarginHook.Position memory pos = _buildPos(collateral, borrow, lev, true);
        assertFalse(hook.isLiquidatable(pos, key), "4x losing but not yet at liquidation");
    }

    function test_Long_4x_Liquidated() public {
        _openLong(4, 1 ether, address(this));

        // token0 crashes 40%: collateral ~3.98 * 0.6 = 2.388, borrow ~3: 238.8 < 345 → liquidatable
        priceFeed.setPrice(address(token0), 0.6e18);
        priceFeed.setPrice(address(token1), 1e18);

        (, uint256 collateral, uint256 borrow, uint8 lev, bool isLong,,,,) = hook.positions(key.toId(), address(this));
        EswapMarginHook.Position memory pos = _buildPos(collateral, borrow, lev, true);
        assertTrue(hook.isLiquidatable(pos, key), "4x long: liquidatable after 40% drop");

        _liquidate(address(this), true, -4 ether);
        _assertPositionGone(address(this));
    }

    // ─── LONG 5x ──────────────────────────────────────────────────────────────

    function test_Long_5x_Win() public {
        _openLong(5, 1 ether, address(this));

        // token0 pumps 25%
        priceFeed.setPrice(address(token0), 1.25e18);
        priceFeed.setPrice(address(token1), 1e18);

        (, uint256 collateral, uint256 borrow, uint8 lev, bool isLong,,,,) = hook.positions(key.toId(), address(this));
        assertTrue(isLong);
        assertEq(lev, 5);
        EswapMarginHook.Position memory pos = _buildPos(collateral, borrow, lev, true);
        assertFalse(hook.isLiquidatable(pos, key), "5x long winning: not liquidatable");
    }

    function test_Long_5x_Lose() public {
        _openLong(5, 1 ether, address(this));

        // token0 drops 5%: at 5x this still keeps position above threshold
        priceFeed.setPrice(address(token0), 0.95e18);
        priceFeed.setPrice(address(token1), 1e18);

        (, uint256 collateral, uint256 borrow, uint8 lev, bool isLong,,,,) = hook.positions(key.toId(), address(this));
        assertTrue(isLong);
        EswapMarginHook.Position memory pos = _buildPos(collateral, borrow, lev, true);
        // collateral ~4.975 * 0.95 = 4.726, borrow ~4: 472.6 > 460 — tight, but above threshold
        assertFalse(hook.isLiquidatable(pos, key), "5x long: small loss, not liquidatable yet");
    }

    function test_Long_5x_Liquidated() public {
        _openLong(5, 1 ether, address(this));

        // token0 crashes 30%: collateral ~4.975 * 0.7 = 3.4825, borrow ~4: 348.25 < 460 → liquidatable
        priceFeed.setPrice(address(token0), 0.7e18);
        priceFeed.setPrice(address(token1), 1e18);

        (, uint256 collateral, uint256 borrow, uint8 lev, bool isLong,,,,) = hook.positions(key.toId(), address(this));
        EswapMarginHook.Position memory pos = _buildPos(collateral, borrow, lev, true);
        assertTrue(hook.isLiquidatable(pos, key), "5x long: liquidatable after 30% drop");

        _liquidate(address(this), true, -5 ether);
        _assertPositionGone(address(this));
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  SHORT SCENARIOS
    //
    //  For a SHORT (zeroForOne = true → isLong = false):
    //    collateral currency = token1 (the bought asset after selling borrowed token0)
    //    borrow   currency   = token0 (what was borrowed to lever up)
    //
    //  isLiquidatable: collateralValueUSD * 100 < borrowValueUSD * 115
    //    → token1.price * collateralAmount * 100 < token0.price * borrowedAmount * 115
    //
    //  SHORT WINS  → token1 price RISES (collateral appreciates vs the token0 debt)
    //  SHORT LOSES → token1 price FALLS slightly (collateral devalues, still above threshold)
    //  LIQUIDATED  → token1 price crashes so collateral value < borrow value * 115%
    //
    //  NOTE: _openShort sells borrowed token0 to buy token1 (zeroForOne=true).
    //        boughtAmount = token1 received (collateral), borrowedAmount = token0 borrowed.
    //        collateral = currency1 = token1, borrow = currency0 = token0.
    // ══════════════════════════════════════════════════════════════════════════

    // ─── SHORT 1x ─────────────────────────────────────────────────────────────

    function test_Short_1x_Win() public {
        _openShort(1, 1 ether, address(this));

        // token1 price rises: collateral appreciates
        priceFeed.setPrice(address(token1), 1.5e18);
        priceFeed.setPrice(address(token0), 1e18);

        (, uint256 collateral, uint256 borrow, uint8 lev, bool isLong,,,,) = hook.positions(key.toId(), address(this));
        assertFalse(isLong, "should be short");
        assertEq(lev, 1);
        assertEq(borrow, 0, "1x: no borrow");
        assertTrue(collateral > 0);

        EswapMarginHook.Position memory pos = _buildPos(collateral, borrow, lev, false);
        assertFalse(hook.isLiquidatable(pos, key), "1x short winning: not liquidatable");
    }

    function test_Short_1x_Lose() public {
        _openShort(1, 1 ether, address(this));

        // token1 drops: collateral loses value (but no borrow so no liquidation)
        priceFeed.setPrice(address(token1), 0.7e18);
        priceFeed.setPrice(address(token0), 1e18);

        (, uint256 collateral, uint256 borrow, uint8 lev, bool isLong,,,,) = hook.positions(key.toId(), address(this));
        assertFalse(isLong);
        assertEq(borrow, 0, "1x: no borrow, loss is unrealized only");

        EswapMarginHook.Position memory pos = _buildPos(collateral, borrow, lev, false);
        assertFalse(hook.isLiquidatable(pos, key), "1x short: no borrow, cannot be liquidated");
    }

    function test_Short_1x_NotLiquidatable() public {
        _openShort(1, 1 ether, address(this));

        // Even extreme adverse move: 1x has zero borrow, so health factor never breaks
        priceFeed.setPrice(address(token1), 0.01e18);
        priceFeed.setPrice(address(token0), 100e18);

        (, uint256 collateral, uint256 borrow, uint8 lev,,,,,) = hook.positions(key.toId(), address(this));
        EswapMarginHook.Position memory pos = _buildPos(collateral, borrow, lev, false);
        assertFalse(hook.isLiquidatable(pos, key), "1x short: no leverage = no liquidation");
    }

    // ─── SHORT 2x ─────────────────────────────────────────────────────────────

    function test_Short_2x_Win() public {
        _openShort(2, 1 ether, address(this));

        // token1 rises: collateral value increases (good for short holder)
        priceFeed.setPrice(address(token1), 1.5e18);
        priceFeed.setPrice(address(token0), 1e18);

        (, uint256 collateral, uint256 borrow, uint8 lev, bool isLong,,,,) = hook.positions(key.toId(), address(this));
        assertFalse(isLong);
        assertEq(lev, 2);
        assertTrue(borrow > 0);

        EswapMarginHook.Position memory pos = _buildPos(collateral, borrow, lev, false);
        assertFalse(hook.isLiquidatable(pos, key), "2x short winning: not liquidatable");
    }

    function test_Short_2x_Lose() public {
        _openShort(2, 1 ether, address(this));

        // token1 drops 20%: collateral ~1.99 * 0.8 = 1.592, borrow ~1: 159.2 > 115 → safe
        priceFeed.setPrice(address(token1), 0.8e18);
        priceFeed.setPrice(address(token0), 1e18);

        (, uint256 collateral, uint256 borrow, uint8 lev, bool isLong,,,,) = hook.positions(key.toId(), address(this));
        assertFalse(isLong);
        EswapMarginHook.Position memory pos = _buildPos(collateral, borrow, lev, false);
        assertFalse(hook.isLiquidatable(pos, key), "2x short: small loss, not liquidatable");
    }

    function test_Short_2x_Liquidated() public {
        _openShort(2, 1 ether, address(this));

        // token1 crashes 60%: collateral ~1.99 * 0.4 = 0.796, borrow ~1 @ 1e18: 79.6 < 115 → liquidatable
        priceFeed.setPrice(address(token1), 0.4e18);
        priceFeed.setPrice(address(token0), 1e18);

        (, uint256 collateral, uint256 borrow, uint8 lev, bool isLong,,,,) = hook.positions(key.toId(), address(this));
        EswapMarginHook.Position memory pos = _buildPos(collateral, borrow, lev, false);
        assertTrue(hook.isLiquidatable(pos, key), "2x short: liquidatable after 60% token1 drop");

        _liquidate(address(this), false, -2 ether);
        _assertPositionGone(address(this));
    }

    // ─── SHORT 3x ─────────────────────────────────────────────────────────────

    function test_Short_3x_Win() public {
        _openShort(3, 1 ether, address(this));

        priceFeed.setPrice(address(token1), 1.4e18);
        priceFeed.setPrice(address(token0), 1e18);

        (, uint256 collateral, uint256 borrow, uint8 lev, bool isLong,,,,) = hook.positions(key.toId(), address(this));
        assertFalse(isLong);
        assertEq(lev, 3);
        EswapMarginHook.Position memory pos = _buildPos(collateral, borrow, lev, false);
        assertFalse(hook.isLiquidatable(pos, key), "3x short winning: not liquidatable");
    }

    function test_Short_3x_Lose() public {
        _openShort(3, 1 ether, address(this));

        // token1 drops 15%: collateral ~2.985 * 0.85 = 2.537, borrow ~2: 253.7 > 230 → safe
        priceFeed.setPrice(address(token1), 0.85e18);
        priceFeed.setPrice(address(token0), 1e18);

        (, uint256 collateral, uint256 borrow, uint8 lev, bool isLong,,,,) = hook.positions(key.toId(), address(this));
        assertFalse(isLong);
        EswapMarginHook.Position memory pos = _buildPos(collateral, borrow, lev, false);
        assertFalse(hook.isLiquidatable(pos, key), "3x short: losing but still safe");
    }

    function test_Short_3x_Liquidated() public {
        _openShort(3, 1 ether, address(this));

        // token1 crashes 50%: collateral ~2.985 * 0.5 = 1.4925, borrow ~2: 149.25 < 230 → liquidatable
        priceFeed.setPrice(address(token1), 0.5e18);
        priceFeed.setPrice(address(token0), 1e18);

        (, uint256 collateral, uint256 borrow, uint8 lev, bool isLong,,,,) = hook.positions(key.toId(), address(this));
        EswapMarginHook.Position memory pos = _buildPos(collateral, borrow, lev, false);
        assertTrue(hook.isLiquidatable(pos, key), "3x short: liquidatable after 50% drop");

        _liquidate(address(this), false, -3 ether);
        _assertPositionGone(address(this));
    }

    // ─── SHORT 4x ─────────────────────────────────────────────────────────────

    function test_Short_4x_Win() public {
        _openShort(4, 1 ether, address(this));

        priceFeed.setPrice(address(token1), 1.3e18);
        priceFeed.setPrice(address(token0), 1e18);

        (, uint256 collateral, uint256 borrow, uint8 lev, bool isLong,,,,) = hook.positions(key.toId(), address(this));
        assertFalse(isLong);
        assertEq(lev, 4);
        EswapMarginHook.Position memory pos = _buildPos(collateral, borrow, lev, false);
        assertFalse(hook.isLiquidatable(pos, key), "4x short winning: not liquidatable");
    }

    function test_Short_4x_Lose() public {
        _openShort(4, 1 ether, address(this));

        // token1 drops 10%: collateral ~3.98 * 0.9 = 3.582, borrow ~3: 358.2 > 345 → safe (barely)
        priceFeed.setPrice(address(token1), 0.9e18);
        priceFeed.setPrice(address(token0), 1e18);

        (, uint256 collateral, uint256 borrow, uint8 lev, bool isLong,,,,) = hook.positions(key.toId(), address(this));
        assertFalse(isLong);
        EswapMarginHook.Position memory pos = _buildPos(collateral, borrow, lev, false);
        assertFalse(hook.isLiquidatable(pos, key), "4x short: 10% loss, borderline but safe");
    }

    function test_Short_4x_Liquidated() public {
        _openShort(4, 1 ether, address(this));

        // token1 crashes 40%: collateral ~3.98 * 0.6 = 2.388, borrow ~3: 238.8 < 345 → liquidatable
        priceFeed.setPrice(address(token1), 0.6e18);
        priceFeed.setPrice(address(token0), 1e18);

        (, uint256 collateral, uint256 borrow, uint8 lev, bool isLong,,,,) = hook.positions(key.toId(), address(this));
        EswapMarginHook.Position memory pos = _buildPos(collateral, borrow, lev, false);
        assertTrue(hook.isLiquidatable(pos, key), "4x short: liquidatable after 40% drop");

        _liquidate(address(this), false, -4 ether);
        _assertPositionGone(address(this));
    }

    // ─── SHORT 5x ─────────────────────────────────────────────────────────────

    function test_Short_5x_Win() public {
        _openShort(5, 1 ether, address(this));

        priceFeed.setPrice(address(token1), 1.25e18);
        priceFeed.setPrice(address(token0), 1e18);

        (, uint256 collateral, uint256 borrow, uint8 lev, bool isLong,,,,) = hook.positions(key.toId(), address(this));
        assertFalse(isLong);
        assertEq(lev, 5);
        EswapMarginHook.Position memory pos = _buildPos(collateral, borrow, lev, false);
        assertFalse(hook.isLiquidatable(pos, key), "5x short winning: not liquidatable");
    }

    function test_Short_5x_Lose() public {
        _openShort(5, 1 ether, address(this));

        // token1 drops 5%: tight but above threshold
        priceFeed.setPrice(address(token1), 0.95e18);
        priceFeed.setPrice(address(token0), 1e18);

        (, uint256 collateral, uint256 borrow, uint8 lev, bool isLong,,,,) = hook.positions(key.toId(), address(this));
        assertFalse(isLong);
        EswapMarginHook.Position memory pos = _buildPos(collateral, borrow, lev, false);
        assertFalse(hook.isLiquidatable(pos, key), "5x short: 5% loss, not yet liquidatable");
    }

    function test_Short_5x_Liquidated() public {
        _openShort(5, 1 ether, address(this));

        // token1 crashes 30%: collateral ~4.975 * 0.7 = 3.4825, borrow ~4: 348.25 < 460 → liquidatable
        priceFeed.setPrice(address(token1), 0.7e18);
        priceFeed.setPrice(address(token0), 1e18);

        (, uint256 collateral, uint256 borrow, uint8 lev, bool isLong,,,,) = hook.positions(key.toId(), address(this));
        EswapMarginHook.Position memory pos = _buildPos(collateral, borrow, lev, false);
        assertTrue(hook.isLiquidatable(pos, key), "5x short: liquidatable after 30% drop");

        _liquidate(address(this), false, -5 ether);
        _assertPositionGone(address(this));
    }

    // ─── Helper: build a Position struct from on-chain state ──────────────────

    function _buildPos(
        uint256 collateral,
        uint256 borrow,
        uint8 lev,
        bool isLong
    ) internal pure returns (EswapMarginHook.Position memory) {
        return EswapMarginHook.Position({
            trader:              address(0), // unused in isLiquidatable
            collateralAmount:    collateral,
            borrowedAmount:      borrow,
            leverage:            lev,
            isLong:              isLong,
            liquidationSqrtPrice:0,
            tickLower:           -60,
            tickUpper:            60,
            liquidity:            0
        });
    }
}
