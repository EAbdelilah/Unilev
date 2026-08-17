// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BaseV4Test} from "./BaseV4Test.t.sol";
import {EswapMarginHook} from "../EswapMarginHook.sol";
import {PoolKey} from "../types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "../types/PoolId.sol";
import {Currency} from "../types/Currency.sol";
import {BalanceDelta, BalanceDeltaLibrary} from "../types/BalanceDelta.sol";
import {IPoolManager} from "../interfaces/IPoolManager.sol";
import {IHooks} from "../interfaces/IHooks.sol";

// Real v4-core artifacts used to prove ABI compatibility.
import {PoolManager} from "@uniswap/v4-core/src/PoolManager.sol";
import {PoolKey as RealPoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency as RealCurrency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta as RealBalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {IHooks as RealIHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager as RealIPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {
    BeforeSwapDelta as RealBeforeSwapDelta,
    BeforeSwapDeltaLibrary as RealBeforeSwapDeltaLibrary
} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {PoolModifyLiquidityTest} from "@uniswap/v4-core/src/test/PoolModifyLiquidityTest.sol";
import {PoolSwapTest} from "@uniswap/v4-core/src/test/PoolSwapTest.sol";

/**
 * @title EswapV4CoreProofTest
 * @notice Proves the migrated hook is compatible with the REAL lib/v4-core
 *         PoolManager:
 *         1. Full lifecycle against the real PoolManager (initialize + a real
 *            non-margin swap through abi.encodeCall-based hook invocation).
 *         2. The margin path's beforeSwap/afterSwap ABI is byte-for-byte what the
 *            real PoolManager produces (abi.encodeCall with real v4-core types),
 *            the BeforeSwapDelta uses the real (specified, unspecified) packing,
 *            and afterSwap reads the swapper-perspective BalanceDelta.
 */
contract EswapV4CoreProofTest is BaseV4Test {
    using PoolIdLibrary for PoolKey;
    using RealBeforeSwapDeltaLibrary for RealBeforeSwapDelta;
    using Hooks for RealIHooks;

    uint160 constant HIGH_FLAGS = (1 << 159) | (1 << 158) | (1 << 153) | (1 << 152) | (1 << 148);
    uint160 constant LOW_FLAGS = (1 << 13) | (1 << 12) | (1 << 7) | (1 << 6) | (1 << 3);
    uint160 constant SQRT_PRICE_1_1 = 79228162514264337593543950336;
    uint160 constant MIN_SQRT_RATIO = 4295128739;

    PoolManager public realManager;
    EswapMarginHook public realHook;
    address public realHookAddr;
    RealPoolKey public realKey;

    function setUp() public override {
        super.setUp();

        // token0 must sort before token1 for the real PoolManager's initialize.
        assertLt(uint256(uint160(address(token0))), uint256(uint160(address(token1))));

        // Real PoolManager (constructor takes the protocol-fees owner).
        realManager = new PoolManager(address(this));

        // Deploy the hook at an address carrying BOTH the legacy high-bit flags
        // (required by the hook's own constructor check) AND the real v4-core
        // low-bit flags (BEFORE_INITIALIZE=1<<13, AFTER_INITIALIZE=1<<12,
        // BEFORE_SWAP=1<<7, AFTER_SWAP=1<<6, BEFORE_SWAP_RETURNS_DELTA=1<<3)
        // that the real PoolManager inspects.
        realHookAddr = address(uint160(HIGH_FLAGS | LOW_FLAGS));
        deployCodeTo("EswapMarginHook.sol:EswapMarginHook", abi.encode(address(realManager), address(priceFeed)), realHookAddr);
        realHook = EswapMarginHook(realHookAddr);
        realHook.setRouter(address(this));
        // Note: RealPoolId must be cast to the local mock PoolId type to call the hook's setAuthorizedPool
        realHook.setAuthorizedPool(_localIdFor(realHookAddr), true);

        realKey = RealPoolKey({
            currency0: RealCurrency.wrap(address(token0)),
            currency1: RealCurrency.wrap(address(token1)),
            fee: 3000,
            tickSpacing: 60,
            hooks: RealIHooks(realHookAddr)
        });
    }

    /// @dev Local PoolId for a pool key on the real hook address (encodings are
    ///      identical between the local and real PoolKey ABI layouts).
    function _localIdFor(address hookAddr) internal view returns (PoolId) {
        PoolKey memory k = PoolKey({
            currency0: Currency.wrap(address(token0)),
            currency1: Currency.wrap(address(token1)),
            fee: 3000,
            tickSpacing: 60,
            hooks: hookAddr
        });
        return k.toId();
    }

    /// @dev Proves the hook deployment address is valid for the REAL PoolManager:
    ///      the low-bit flags the real Hooks library reads are present and no
    ///      flags are set without their prerequisite action flag.
    function test_HookAddress_IsValidForRealPoolManager() public {
        RealIHooks h = RealIHooks(realHookAddr);
        assertTrue(Hooks.hasPermission(h, 1 << 13)); // BEFORE_INITIALIZE
        assertTrue(Hooks.hasPermission(h, 1 << 12)); // AFTER_INITIALIZE
        assertTrue(Hooks.hasPermission(h, 1 << 7)); // BEFORE_SWAP
        assertTrue(Hooks.hasPermission(h, 1 << 6)); // AFTER_SWAP
        assertTrue(Hooks.hasPermission(h, 1 << 3)); // BEFORE_SWAP_RETURNS_DELTA
        assertFalse(Hooks.hasPermission(h, 1 << 2)); // AFTER_SWAP_RETURNS_DELTA (unused)
        // Hook does not advertise add/remove/donate liquidity hooks.
        assertFalse(Hooks.hasPermission(h, 1 << 11));
        assertFalse(Hooks.hasPermission(h, 1 << 10));
        assertFalse(Hooks.hasPermission(h, 1 << 9));
        assertFalse(Hooks.hasPermission(h, 1 << 8));
        assertTrue(realKey.hooks.isValidHookAddress(realKey.fee));
    }

    /// @dev Proves the hook's own constructor accepted the deployment address.
    function test_Hook_ConstructorFlagsPresent() public {
        assertEq(uint160(realHookAddr) & realHook.getHookFlags(), realHook.getHookFlags());
    }

    /**
     * @notice End-to-end against the REAL PoolManager: initialize the pool (real
     *         PM invokes beforeInitialize/afterInitialize via abi.encodeCall),
     *         seed liquidity, then run a non-margin swap (real PM invokes
     *         beforeSwap/afterSwap). Proves the migrated hook ABI surface is
     *         accepted by the real PoolManager.
     */
    function test_RealPoolManager_InitializeAndNonMarginSwap() public {
        int24 tick = realManager.initialize(realKey, SQRT_PRICE_1_1);
        assertEq(tick, 0);

        // afterInitialize ran -> pool is authorized inside the hook.
        PoolId poolId = _localIdFor(realHookAddr);
        assertTrue(realHook.isAuthorizedPool(poolId));
        assertEq(realHook.lastOraclePrice(poolId), SQRT_PRICE_1_1);

        // Seed concentrated liquidity in [-60, 60] around the 1:1 price.
        PoolModifyLiquidityTest lq = new PoolModifyLiquidityTest(realManager);
        token0.approve(address(lq), type(uint256).max);
        token1.approve(address(lq), type(uint256).max);
        RealIPoolManager.ModifyLiquidityParams memory lp = RealIPoolManager.ModifyLiquidityParams({
            tickLower: -60,
            tickUpper: 60,
            liquidityDelta: 1e21,
            salt: 0
        });
        lq.modifyLiquidity(realKey, lp, "");

        // Non-margin swap with empty hookData. The real PM calls the hook's
        // beforeSwap (expects 96-byte return) and afterSwap (expects 64-byte
        // return); both must pass selector/return-length validation.
        PoolSwapTest swapper = new PoolSwapTest(realManager);
        token0.approve(address(swapper), type(uint256).max);
        token1.approve(address(swapper), type(uint256).max);

        uint256 balBefore = token1.balanceOf(address(this));
        RealBalanceDelta rawDelta = swapper.swap(
            realKey,
            RealIPoolManager.SwapParams({
                zeroForOne: true,
                amountSpecified: -1 ether,
                sqrtPriceLimitX96: MIN_SQRT_RATIO + 1
            }),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            ""
        );
        BalanceDelta delta = BalanceDelta.wrap(RealBalanceDelta.unwrap(rawDelta));
        assertLt(delta.amount0(), 0);
        assertGt(delta.amount1(), 0);
        assertGt(token1.balanceOf(address(this)) - balBefore, 0);

        // No margin hookData -> no position created.
        (address posTrader, uint256 posCollateral,,,,,,,) = realHook.positions(poolId, address(this));
        assertEq(posTrader, address(0));
        assertEq(posCollateral, 0);
    }

    /**
     * @notice Proves the margin path's ABI is byte-for-byte what the real
     *         PoolManager produces. Builds beforeSwap/afterSwap calldata with
     *         abi.encodeCall against the REAL v4-core IHooks/IPoolManager types,
     *         then feeds it to the hook exactly as the real PM's Hooks library
     *         would. Also verifies the BeforeSwapDelta return uses the real
     *         (specified, unspecified) packing for BOTH swap directions.
     */
    function test_MarginPath_MatchesRealV4AbiEncoding() public {
        RealPoolKey memory mockRealKey = RealPoolKey({
            currency0: RealCurrency.wrap(address(token0)),
            currency1: RealCurrency.wrap(address(token1)),
            fee: 3000,
            tickSpacing: 60,
            hooks: RealIHooks(address(hook))
        });
        bytes memory hookData = abi.encode(true, uint8(5), address(this));

        // LONG: zeroForOne=true, exact input 100 ETH -> flash borrow 400 ETH on
        // the specified (input) leg.
        bytes memory callData = abi.encodeCall(
            RealIHooks.beforeSwap,
            (
                address(this),
                mockRealKey,
                RealIPoolManager.SwapParams({zeroForOne: true, amountSpecified: -100 ether, sqrtPriceLimitX96: 0}),
                hookData
            )
        );
        assertEq(bytes4(callData), IHooks.beforeSwap.selector);

        vm.prank(address(manager));
        (bool ok, bytes memory ret) = address(hook).call(callData);
        assertTrue(ok);

        (bytes4 sel, int256 bsdValue, ) = abi.decode(ret, (bytes4, int256, uint24));
        RealBeforeSwapDelta bsd = RealBeforeSwapDelta.wrap(bsdValue);
        assertEq(sel, IHooks.beforeSwap.selector);
        assertEq(bsd.getSpecifiedDelta(), -400 ether);
        assertEq(bsd.getUnspecifiedDelta(), 0);

        // SHORT: zeroForOne=false, exact input 50 ETH -> flash borrow 100 ETH on
        // the specified (input) leg. This direction was broken under the old
        // (delta0, delta1) packing that put the borrow on the unspecified leg.
        // A distinct trader is used because the transient reentrancy guard is
        // only cleared by an afterSwap in the real unlock flow.
        bytes memory hookDataShort = abi.encode(true, uint8(3), address(0xBEeF));
        callData = abi.encodeCall(
            RealIHooks.beforeSwap,
            (
                address(0xBEeF),
                mockRealKey,
                RealIPoolManager.SwapParams({zeroForOne: false, amountSpecified: -50 ether, sqrtPriceLimitX96: 0}),
                hookDataShort
            )
        );
        assertEq(bytes4(callData), IHooks.beforeSwap.selector);

        vm.prank(address(manager));
        (ok, ret) = address(hook).call(callData);
        assertTrue(ok);

        (sel, bsdValue, ) = abi.decode(ret, (bytes4, int256, uint24));
        bsd = RealBeforeSwapDelta.wrap(bsdValue);
        assertEq(sel, IHooks.beforeSwap.selector);
        assertEq(bsd.getSpecifiedDelta(), -100 ether);
        assertEq(bsd.getUnspecifiedDelta(), 0);

        // afterSwap selector must also match what the real PM abi.encodeCall's.
        bytes memory afterCallData = abi.encodeCall(
            RealIHooks.afterSwap,
            (
                address(this),
                mockRealKey,
                RealIPoolManager.SwapParams({zeroForOne: true, amountSpecified: -100 ether, sqrtPriceLimitX96: 0}),
                RealBalanceDelta.wrap(int256(0)),
                hookData
            )
        );
        assertEq(bytes4(afterCallData), IHooks.afterSwap.selector);
    }

    /**
     * @notice Proves the afterSwap sign fix: the returned BalanceDelta is read
     *         from the swapper's perspective (received leg positive), so the
     *         position's collateral/borrow accounting is identical for both
     *         zeroForOne directions and zero output reverts.
     */
    function test_MarginPath_AfterSwap_SwapperPerspective_SignFix() public {
        // Anchor LONG to token1 (base currency), as on Unichain (USDC/WETH).
        hook.setBaseCurrency(key.toId(), Currency.wrap(address(token1)));
        bytes memory data = abi.encode(true, uint8(5), address(this));

        // LONG: zeroForOne=true. Swapper perspective: paid -100 (token0),
        // received +480 (token1). The positive leg is amount1.
        vm.prank(address(manager));
        hook.beforeSwap(address(this), key, IPoolManager.SwapParams(true, -100 ether, 0), data);
        vm.prank(address(manager));
        hook.afterSwap(
            address(this),
            key,
            IPoolManager.SwapParams(true, -100 ether, 0),
            BalanceDeltaLibrary.toBalanceDelta(-100 ether, 480 ether),
            data
        );
        (address longTrader, uint256 longCollateral, uint256 longBorrow, , bool longIsLong,,,,) =
            hook.positions(key.toId(), address(this));
        assertEq(longTrader, address(this));
        assertTrue(longIsLong);
        assertEq(longBorrow, 400 ether);
        assertEq(longCollateral, (480 ether * 9950) / 10000);

        // SHORT: zeroForOne=false. Swapper perspective: paid -100 (token1),
        // received +480 (token0). The positive leg is amount0.
        bytes memory shortData = abi.encode(true, uint8(5), address(1));
        vm.prank(address(manager));
        hook.beforeSwap(address(1), key, IPoolManager.SwapParams(false, -100 ether, 0), shortData);
        vm.prank(address(manager));
        hook.afterSwap(
            address(1),
            key,
            IPoolManager.SwapParams(false, -100 ether, 0),
            BalanceDeltaLibrary.toBalanceDelta(480 ether, -100 ether),
            shortData
        );
        (address shortTrader, uint256 shortCollateral, uint256 shortBorrow, , bool shortIsLong,,,,) =
            hook.positions(key.toId(), address(1));
        assertEq(shortTrader, address(1));
        assertFalse(shortIsLong);
        assertEq(shortBorrow, 400 ether);
        assertEq(shortCollateral, (480 ether * 9950) / 10000);

        // Zero received output on the bought leg must revert (SwapOutputZero).
        bytes memory data2 = abi.encode(true, uint8(5), address(2));
        vm.prank(address(manager));
        hook.beforeSwap(address(2), key, IPoolManager.SwapParams(true, -100 ether, 0), data2);
        vm.expectRevert(EswapMarginHook.SwapOutputZero.selector);
        vm.prank(address(manager));
        hook.afterSwap(
            address(2),
            key,
            IPoolManager.SwapParams(true, -100 ether, 0),
            BalanceDeltaLibrary.toBalanceDelta(-100 ether, 0),
            data2
        );
    }
}
