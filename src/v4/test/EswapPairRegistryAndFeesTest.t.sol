// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BaseV4Test, ERC20Mock} from "./BaseV4Test.t.sol";
import {EswapMarginHook} from "../EswapMarginHook.sol";
import {PoolKey} from "../types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "../types/PoolId.sol";
import {Currency} from "../types/Currency.sol";
import {IPoolManager} from "../interfaces/IPoolManager.sol";
import {BalanceDeltaLibrary} from "../types/BalanceDelta.sol";

/// @notice Covers two runtime-admin features:
///  1. Per-address protocol fee: one default fee for everyone (reserveFactor),
///     specific addresses get specific fees via setAddressProtocolFee.
///  2. Adding NEW trading pairs at runtime with registerTradingPair — no redeploy.
contract EswapPairRegistryAndFeesTest is BaseV4Test {
    using PoolIdLibrary for PoolKey;

    ERC20Mock public tokenA;
    ERC20Mock public tokenB;
    PoolKey public pairKey;

    function setUp() public override {
        super.setUp();

        tokenA = new ERC20Mock("Token A", "TKA");
        tokenB = new ERC20Mock("Token B", "TKB");

        pairKey = PoolKey({
            currency0: Currency.wrap(address(tokenA)),
            currency1: Currency.wrap(address(tokenB)),
            fee: 3000,
            tickSpacing: 60,
            hooks: address(hook)
        });
    }

    // ─── Change: runtime pair registration ────────────────────────────────────

    function test_RegisterTradingPair_NoRedeploy() public {
        assertFalse(hook.isAuthorizedPool(pairKey.toId()), "pair must start unauthorized");

        PoolKey memory standardKey = PoolKey({
            currency0: pairKey.currency0,
            currency1: pairKey.currency1,
            fee: 500,
            tickSpacing: 10,
            hooks: address(0)
        });

        hook.registerTradingPair(pairKey, standardKey, Currency.wrap(address(tokenA)), 18, 18);

        assertTrue(hook.isAuthorizedPool(pairKey.toId()), "pair authorized at runtime");
        assertEq(Currency.unwrap(hook.baseCurrency(pairKey.toId())), address(tokenA), "base anchored");
        (Currency sC0, Currency sC1, uint24 sFee, int24 sSpacing, address sHooks) = hook.standardPoolKeys(pairKey.toId());
        assertEq(Currency.unwrap(sC0), address(tokenA), "standard currencies match");
        assertEq(Currency.unwrap(sC1), address(tokenB), "standard currencies match");
        assertEq(sFee, 500, "standard fee pinned");
        assertEq(sSpacing, 10, "standard spacing pinned");
        assertEq(sHooks, address(0), "standard pool has no hook");
        assertEq(hook.tokenDecimals(address(tokenA)), 18, "decimals recorded");
        assertEq(hook.tokenDecimals(address(tokenB)), 18, "decimals recorded");

        // The new pair is immediately tradable: open a 2x long on it.
        // Long (zeroForOne=false): amount0 = +bought output (tokenA), amount1 = -input (tokenB).
        priceFeed.setPrice(address(tokenA), 1e18);
        priceFeed.setPrice(address(tokenB), 1e18);
        bytes memory data = abi.encode(true, uint8(2), address(this));
        vm.prank(address(manager));
        hook.beforeSwap(address(this), pairKey, IPoolManager.SwapParams(false, -1 ether, 0), data);
        vm.prank(address(manager));
        hook.afterSwap(
            address(this),
            pairKey,
            IPoolManager.SwapParams(false, -2 ether, 0),
            BalanceDeltaLibrary.toBalanceDelta(1.92 ether, -2 ether),
            data
        );

        (address trader, uint256 collateral, uint256 borrow, uint8 leverage,,,,,) = hook.positions(pairKey.toId(), address(this));
        assertEq(trader, address(this), "position opened on the new pair");
        assertGt(collateral, 0);
        assertEq(borrow, 1 ether);
        assertEq(leverage, 2);
    }

    function test_RegisterTradingPair_RevertsForForeignHook() public {
        PoolKey memory foreign = pairKey;
        foreign.hooks = address(0xBAD);
        vm.expectRevert(EswapMarginHook.InvalidHookAddress.selector);
        hook.registerTradingPair(foreign, foreign, Currency.wrap(address(tokenA)), 18, 18);
    }

    function test_RegisterTradingPair_RevertsForMismatchedStandardKey() public {
        PoolKey memory mismatched = pairKey;
        mismatched.currency0 = Currency.wrap(address(token0));
        vm.expectRevert(EswapMarginHook.InvalidStandardPoolKey.selector);
        hook.registerTradingPair(pairKey, mismatched, Currency.wrap(address(tokenA)), 18, 18);
    }

    function test_RegisterTradingPair_OnlyOwner() public {
        vm.prank(address(0xBAD));
        vm.expectRevert(EswapMarginHook.NotOwner.selector);
        hook.registerTradingPair(pairKey, pairKey, Currency.wrap(address(tokenA)), 18, 18);
    }

    // ─── Change: per-address protocol fee ─────────────────────────────────────

    /// @dev Opens a 2x SHORT on the default pool and returns the bought (gross) amount.
    function _openShort2x(address trader) internal returns (uint256 boughtGross) {
        priceFeed.setPrice(address(token0), 1e18);
        priceFeed.setPrice(address(token1), 1e18);
        boughtGross = (2 ether * 96) / 100; // mock swap output for a 2x open
        bytes memory data = abi.encode(true, uint8(2), trader);
        vm.prank(address(manager));
        hook.beforeSwap(address(this), key, IPoolManager.SwapParams(true, -1 ether, 0), data);
        vm.prank(address(manager));
        hook.afterSwap(
            address(this),
            key,
            IPoolManager.SwapParams(true, -2 ether, 0),
            BalanceDeltaLibrary.toBalanceDelta(-2 ether, int128(uint128(boughtGross))),
            data
        );
    }

    function test_ProtocolFee_DefaultForEveryone() public {
        // Default reserveFactor = 50 bps (0.5%) applies to any trader without an override.
        assertEq(hook.protocolFeeFor(address(0x1111)), 50, "default fee for everyone");
        assertEq(hook.protocolFeeFor(address(0x2222)), 50, "default fee for everyone");

        _openShort2x(address(0x1111));

        // boughtGross 1.92 ether × 0.5% = 0.0096 ether of protocol fees
        assertEq(
            hook.protocolFees(key.currency1),
            (1.92 ether * 50) / 10000,
            "default 50 bps charged"
        );
    }

    function test_ProtocolFee_SpecificAddressGetsSpecificFee() public {
        address vip = address(0xA11CE);
        hook.setAddressProtocolFee(vip, 100); // 1% for this address only

        assertEq(hook.protocolFeeFor(vip), 100, "override applies to the specific address");
        assertEq(hook.protocolFeeFor(address(0x3333)), 50, "everyone else keeps the default");

        _openShort2x(vip);

        // boughtGross 1.92 ether × 1% = 0.0192 ether of protocol fees
        assertEq(
            hook.protocolFees(key.currency1),
            (1.92 ether * 100) / 10000,
            "custom 100 bps charged for the specific address"
        );
    }

    function test_ProtocolFee_ResetToZeroFallsBackToDefault() public {
        address vip = address(0xA11CE);
        hook.setAddressProtocolFee(vip, 100);
        assertEq(hook.protocolFeeFor(vip), 100);

        hook.setAddressProtocolFee(vip, 0);
        assertEq(hook.protocolFeeFor(vip), 50, "bps=0 clears the override");
    }

    function test_ProtocolFee_RevertsAboveCap() public {
        vm.expectRevert(EswapMarginHook.FeeTooHigh.selector);
        hook.setAddressProtocolFee(address(0x4444), 101);
    }

    function test_ProtocolFee_RevertsForZeroAddress() public {
        vm.expectRevert(EswapMarginHook.ZeroAddress.selector);
        hook.setAddressProtocolFee(address(0), 10);
    }

    function test_ProtocolFee_OnlyOwner() public {
        vm.prank(address(0xBAD));
        vm.expectRevert(EswapMarginHook.NotOwner.selector);
        hook.setAddressProtocolFee(address(0x4444), 10);
    }
}
