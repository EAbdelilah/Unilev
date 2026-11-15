// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import {EswapMarginHook} from "../EswapMarginHook.sol";
import {EswapMarginHookLogic} from "../EswapMarginHookLogic.sol";
import {PoolKey} from "../types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "../types/PoolId.sol";
import {Currency} from "../types/Currency.sol";
import {IPoolManager} from "../interfaces/IPoolManager.sol";
import {BalanceDeltaLibrary} from "../types/BalanceDelta.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {PriceFeedMock} from "./BaseV4Test.t.sol";
import {PoolManagerMock} from "./mocks/PoolManagerMock.sol";
import {EswapHookDeployLib} from "./EswapHookDeployLib.sol";

/// @title Probes the $0.01 margin boundary on a real Base MAINNET fork.
/// @notice Answers one question empirically: with a $0.01 USD floor configured,
///         does a $0.01 margin clear the gate, and does $0.0001 revert?
///
/// @dev FORK TEST. Nothing is broadcast, no funds move. Real Base USDC/WETH
///      (6 and 18 decimals, read on-chain) back the arithmetic; the pool manager
///      and oracle are mocks because no v4 stack is deployed on mainnet.
contract EswapMainnetOneCentMarginForkTest is Test {
    using PoolIdLibrary for PoolKey;

    // Base mainnet (chain 8453) — the protocol's target chain.
    address constant BASE_WETH = 0x4200000000000000000000000000000000000006;
    address constant BASE_USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;

    // $0.01 margin in raw 6-decimal USDC units.
    uint256 constant ONE_CENT = 10_000;
    // $0.0001 margin in raw 6-decimal USDC units.
    uint256 constant ONE_THOUSANDTH_CENT = 100;

    PoolManagerMock manager;
    EswapMarginHook hook;
    PriceFeedMock priceFeed;
    PoolKey key;

    IERC20 usdc = IERC20(BASE_USDC);
    address trader = address(0xC0FFEE);
    address router = address(0x5678);

    bool rpcAvailable;

    function setUp() public {
        string memory rpcUrl = vm.envOr("BASE_RPC_URL", string("https://mainnet.base.org"));
        vm.createSelectFork(rpcUrl);
        if (block.chainid != 8453) {
            rpcAvailable = false;
            vm.skip(true);
            return;
        }
        rpcAvailable = true;
        require(BASE_USDC.code.length > 0, "no real USDC");
        require(BASE_WETH.code.length > 0, "no real WETH");

        manager = new PoolManagerMock();
        priceFeed = new PriceFeedMock();
        priceFeed.setPrice(BASE_WETH, 3000e18);
        // PriceFeedMock.getAmountInUsd is (amount * price) / 1e18, i.e. it treats
        // `amount` as 18-decimal and performs NO decimals normalization. The real
        // Chainlink path does normalize. To make the mock value a 6-decimal USDC
        // amount the way the real oracle would, the price must be quoted per raw
        // unit: $1 == 1e18 scaled by 10^(18-6) == 1e30.
        priceFeed.setPrice(BASE_USDC, 1e30);

        address hookAddress = address(uint160((1 << 159) | (1 << 158) | (1 << 153) | (1 << 152) | (1 << 148)));
        (address _hookLogic, address _hookLogic2) = EswapHookDeployLib.deployLogic(address(manager), address(priceFeed));
        deployCodeTo("EswapMarginHook.sol:EswapMarginHook", abi.encode(manager, priceFeed, _hookLogic, _hookLogic2, address(this)), hookAddress);
        hook = EswapMarginHook(payable(hookAddress));

        // THE VARIABLE UNDER TEST: a $0.01 USD-denominated floor, which is what
        // a production deployment sets. It replaces the legacy raw 18-decimal
        // MIN_COLLATERAL constant, which no 6-decimal token can ever clear.
        hook.setRouterAndMinCollateralUsd(router, 0.01 ether);

        (address token0, address token1) =
            BASE_WETH < BASE_USDC ? (BASE_WETH, BASE_USDC) : (BASE_USDC, BASE_WETH);

        key = PoolKey({
            currency0: Currency.wrap(token0),
            currency1: Currency.wrap(token1),
            fee: 3000,
            tickSpacing: 60,
            hooks: address(hook)
        });

        EswapMarginHookLogic(payable(address(hook))).setAuthorizedPool(key.toId(), true);
        EswapMarginHookLogic(payable(address(hook))).setBaseCurrency(key.toId(), Currency.wrap(BASE_WETH));
        EswapMarginHookLogic(payable(address(hook))).setTokenDecimals(BASE_WETH, 18);
        EswapMarginHookLogic(payable(address(hook))).setTokenDecimals(BASE_USDC, 6);

        // 3000 USDC/WETH. sqrtPriceX96 is orientation-dependent: on Base WETH
        // (0x4200…0006) sorts BELOW USDC (0x8335…2913), so WETH is currency0 and
        // the price is the reciprocal of the USDC-as-currency0 encoding.
        uint160 sqrtPriceX96 = Currency.unwrap(key.currency0) == BASE_USDC
            ? uint160(1446501726624926496477173928747177)
            : uint160(4339505179874779489431521);
        manager.setSlot0(key.toId(), sqrtPriceX96, 0);

        deal(BASE_USDC, trader, 1_000_000); // 1e6 raw = $1, plenty
        deal(BASE_WETH, trader, 1 ether);
        vm.prank(trader);
        usdc.approve(address(hook), type(uint256).max);

        vm.deal(trader, 10 ether);
    }

    /// @dev beforeSwap only STAGES a position; afterSwap commits it. Without the
    ///      afterSwap leg the position read back is all zeros, which looks
    ///      identical to "no position" and silently invalidates assertions.
    function _openPosition(uint256 marginRaw) internal {
        bool zeroForOne = Currency.unwrap(key.currency0) == BASE_USDC;
        bytes memory hookData = abi.encode(true, uint8(1), trader);

        // 3000 USDC/WETH, decimals-aware: $margin buys margin/3000 WETH.
        int128 amount0 = -int128(int256(marginRaw));
        int128 amount1 = int128(int256((uint256(marginRaw) * 1e18) / (3000 * 1e6)));

        vm.startPrank(address(manager));
        hook.beforeSwap(address(this), key, IPoolManager.SwapParams(zeroForOne, -int256(marginRaw), 0), hookData);
        hook.afterSwap(
            address(this),
            key,
            IPoolManager.SwapParams(zeroForOne, -int256(marginRaw), 0),
            BalanceDeltaLibrary.toBalanceDelta(amount0, amount1),
            hookData
        );
        vm.stopPrank();
    }

    /// @dev $0.01 margin must clear a $0.01 floor and open a real position.
    function test_OneCent_Clears_Floor_And_Opens() public {
        if (!rpcAvailable) { vm.skip(true); return; }

        _openPosition(ONE_CENT);

        (, uint256 collateral, uint256 borrowed, uint8 leverage, bool isLong,,,,) = hook.positions(key.toId(), trader);
        assertEq(leverage, 1, "leverage not recorded");
        assertTrue(isLong, "expected a LONG WETH position");
        assertEq(borrowed, 0, "1x must not borrow");

        // The $0.01 USDC margin is swapped into the base asset, so collateral is
        // denominated in WETH: 10_000 raw USDC / 3000 USDC-per-WETH ~= 3.33e12
        // wei, less the pool fee. Value it back to 18-decimal USD and require
        // ~one cent (0.01e18), NOT the 6-decimal raw amount.
        (Currency collateralCcy,) = hook.positionCurrencies(key, trader);
        assertEq(Currency.unwrap(collateralCcy), BASE_WETH, "collateral must be WETH");
        assertGt(collateral, 0, "position has no collateral");
        uint256 collateralUsd = (collateral * 3000e18) / 1e18;
        assertApproxEqRel(collateralUsd, 0.01 ether, 0.01e18, "collateral must be worth ~$0.01");
    }

    /// @dev $0.0001 is 100x below the $0.01 floor and must revert.
    function test_OneThousandthCent_Reverts() public {
        if (!rpcAvailable) { vm.skip(true); return; }

        bool zeroForOne = Currency.unwrap(key.currency0) == BASE_USDC;
        bytes memory hookData = abi.encode(true, uint8(1), trader);

        vm.prank(address(manager));
        vm.expectRevert(EswapMarginHook.CollateralTooLow.selector);
        hook.beforeSwap(address(this), key, IPoolManager.SwapParams(zeroForOne, -int256(ONE_THOUSANDTH_CENT), 0), hookData);
    }

    /// @dev The legacy raw floor DOES normalize token decimals, so MIN_COLLATERAL
    ///      is reachable for a 6-decimal token. 10_000 raw USDC normalizes to
    ///      1e16 (=$0.01 at 18 dec) and meets the 1e16 raw floor exactly.
    function test_RawFloor_Normalizes_Decimals_And_Accepts_OneCent() public {
        if (!rpcAvailable) { vm.skip(true); return; }

        hook.setRouterAndMinCollateralUsd(router, 0); // fall back to MIN_COLLATERAL

        _openPosition(ONE_CENT);

        (, uint256 collateral, uint256 borrowed,,,,,,) = hook.positions(key.toId(), trader);
        assertEq(borrowed, 0, "1x must not borrow");
        assertGt(collateral, 0, "raw floor must also open a $0.01 position");
        uint256 collateralUsd = (collateral * 3000e18) / 1e18;
        assertApproxEqRel(collateralUsd, 0.01 ether, 0.01e18, "raw floor must also accept $0.01");
    }

    /// @dev Guards the decimals normalization: a 6-decimal token is scaled up to
    ///      18 decimals before the raw floor comparison, so a naive raw compare
    ///      (which would demand 1e16 raw = $10 billion of USDC) cannot creep back in.
    function test_RawFloor_Scales_Usdc_By_Twelve_Decimals() public {
        if (!rpcAvailable) { vm.skip(true); return; }

        hook.setRouterAndMinCollateralUsd(router, 0);
        bool zeroForOne = Currency.unwrap(key.currency0) == BASE_USDC;
        bytes memory hookData = abi.encode(true, uint8(1), trader);

        // 9_999 raw is $0.009999: one wei-unit below the 10_000 boundary.
        vm.prank(address(manager));
        vm.expectRevert(EswapMarginHook.CollateralTooLow.selector);
        hook.beforeSwap(address(this), key, IPoolManager.SwapParams(zeroForOne, -int256(ONE_CENT - 1), 0), hookData);

        // Exactly 10_000 raw is $0.01 and must clear it.
        vm.prank(address(manager));
        hook.beforeSwap(address(this), key, IPoolManager.SwapParams(zeroForOne, -int256(ONE_CENT), 0), hookData);
    }
}
