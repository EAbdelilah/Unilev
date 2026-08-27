// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BaseV4Test, PriceFeedMock, ERC20Mock} from "./BaseV4Test.t.sol";
import {PoolManagerCallbackMock} from "./mocks/PoolManagerMock.sol";
import {EswapMarginHook} from "../EswapMarginHook.sol";
import {EswapRouter} from "../EswapRouter.sol";
import {PoolKey} from "../types/PoolKey.sol";
import {PoolIdLibrary} from "../types/PoolId.sol";
import {Currency} from "../types/Currency.sol";
import {IPoolManager} from "../interfaces/IPoolManager.sol";
import {BalanceDeltaLibrary} from "../types/BalanceDelta.sol";

/// @notice Aggregator-friendly risk caps: configurable OI limits + preview views.
///         Mock tokens are 18-dec with default oracle price 1e18, so raw units
///         and USD values coincide exactly.
contract EswapOpenInterestCapsTest is BaseV4Test {
    using PoolIdLibrary for PoolKey;

    PoolManagerCallbackMock managerMock;
    address traderA = makeAddr("oiTraderA");
    address traderB = makeAddr("oiTraderB");
    address traderC = makeAddr("oiTraderC");

    function setUp() public override {
        managerMock = new PoolManagerCallbackMock();
        manager = managerMock;
        priceFeed = new PriceFeedMock();

        token0 = new ERC20Mock("Token 0", "TK0");
        token1 = new ERC20Mock("Token 1", "TK1");

        address hookAddress = address(uint160((1 << 159) | (1 << 158) | (1 << 153) | (1 << 152) | (1 << 148)));
        deployCodeTo("EswapMarginHook.sol:EswapMarginHook", abi.encode(manager, priceFeed, address(this)), hookAddress);
        hook = EswapMarginHook(payable(hookAddress));

        key = PoolKey({
            currency0: Currency.wrap(address(token0)),
            currency1: Currency.wrap(address(token1)),
            fee: 3000,
            tickSpacing: 60,
            hooks: address(hook)
        });

        hook.setRouterAndMinCollateralUsd(address(new EswapRouter(manager)), 0);
        hook.setAuthorizedPool(key.toId(), true);
        // Initialize slot0 so sqrtPriceX96 is non-zero (prevents TwapManipulated revert)
        manager.setSlot0(key.toId(), 79228162514264337593543950336, 0);
    }

    /// @dev Direct open through beforeSwap + afterSwap (mock manager), exact
    ///      fill at margin*leverage so collateral accounting is deterministic.
    function _open(address trader, uint256 margin, uint8 leverage) internal {
        bytes memory data = abi.encode(true, leverage, trader);
        vm.prank(address(manager));
        hook.beforeSwap(address(this), key, IPoolManager.SwapParams(true, -int256(margin), 0), data);
        vm.prank(address(manager));
        hook.afterSwap(
            address(this),
            key,
            IPoolManager.SwapParams(true, -int256(margin * leverage), 0),
            BalanceDeltaLibrary.toBalanceDelta(int128(-int256(margin * leverage)), int128(int256(margin * leverage))),
            data
        );
    }

    function _expectOpenRevert(address trader, uint256 margin, uint8 leverage, bytes4 selector) internal {
        bytes memory data = abi.encode(true, leverage, trader);
        vm.prank(address(manager));
        vm.expectRevert(selector);
        hook.beforeSwap(address(this), key, IPoolManager.SwapParams(true, -int256(margin), 0), data);
    }

    function test_Caps_InactiveBelowTvlFloor() public view {
        (bool active,,,,) = hook.openInterestCapacity();
        assertFalse(active, "caps must be off below the TVL floor");
        assertEq(hook.maxOpenBorrowRaw(key.currency0), 0, "0 means uncapped, not empty");
    }

    function test_Defaults_PreserveOriginalCaps() public {
        assertEq(hook.maxSingleOIBps(), 200);
        assertEq(hook.maxTotalOIBps(), 1500);
        assertEq(hook.oiCapTvlFloorUsd(), 100000 ether);

        // Build TVL past the floor while caps are inactive. Note: a 3x position
        // carries OI == 2/3 of its own collateral, which ALONE exceeds the 15%
        // aggregate cap -- preserved original semantics saturate immediately.
        _open(traderA, 51_000 ether, 3);

        uint256 tvlExpected = (153_000 ether * 9950) / 10000; // 50bps open fee shaves collateral
        (bool active, uint256 tvl, uint256 oi, uint256 maxSingle, uint256 remaining) = hook.openInterestCapacity();
        assertTrue(active, "caps activate past the floor");
        assertEq(tvl, tvlExpected);
        assertEq(oi, 102_000 ether, "borrow leg is fee-exempt");
        assertEq(maxSingle, (tvlExpected * 200) / 10000, "single cap == 2% TVL");
        assertEq(remaining, 0, "aggregate headroom already consumed by A");

        // Single-cap check fires first for an oversized trade...
        vm.prank(address(manager));
        vm.expectRevert(
            abi.encodeWithSelector(
                EswapMarginHook.PositionExceedsSingleCap.selector, 4_000 ether, (tvlExpected * 200) / 10000
            )
        );
        hook.beforeSwap(
            address(this), key, IPoolManager.SwapParams(true, -int256(4_000 ether), 0), abi.encode(true, 2, traderC)
        );
        // ...and even a small one is blocked by the saturated aggregate cap.
        uint256 maxTotalExpected = (tvlExpected * 1500) / 10000;
        vm.prank(address(manager));
        vm.expectRevert(
            abi.encodeWithSelector(
                EswapMarginHook.OpenInterestExceedsCapacity.selector,
                102_000 ether + 1 ether,
                maxTotalExpected < 102_000 ether ? 102_000 ether : maxTotalExpected
            )
        );
        hook.beforeSwap(
            address(this), key, IPoolManager.SwapParams(true, -int256(1 ether), 0), abi.encode(true, 2, traderB)
        );
    }

    function test_Setter_AuthAndBounds() public {
        vm.prank(makeAddr("notOwner"));
        vm.expectRevert();
        hook.setOpenInterestCaps(100, 1500, 1 ether);

        vm.expectRevert("single cap out of range");
        hook.setOpenInterestCaps(0, 1500, 1 ether);

        vm.expectRevert("single cap out of range");
        hook.setOpenInterestCaps(10_000, 1500, 1 ether);

        vm.expectRevert("total cap out of range");
        hook.setOpenInterestCaps(200, 199, 1 ether);

        vm.expectRevert("total cap out of range");
        hook.setOpenInterestCaps(200, 10_000, 1 ether);

        hook.setOpenInterestCaps(500, 2500, 5 ether);
        assertEq(hook.maxSingleOIBps(), 500);
        assertEq(hook.maxTotalOIBps(), 2500);
        assertEq(hook.oiCapTvlFloorUsd(), 5 ether);
    }

    function test_ConfigurableCaps_MultiPositionHeadroom() public {
        // Wide aggregate cap (60% TVL) so several 2x positions coexist.
        hook.setOpenInterestCaps(1000, 6000, 10_000 ether);

        _open(traderA, 20_000 ether, 2); // TVL 39.8k (fee-shaved), OI 20k

        (,,, uint256 maxSingle, uint256 remaining) = hook.openInterestCapacity();
        assertEq(maxSingle, 3_980 ether, "10% of TVL");
        assertEq(remaining, (39_800 ether * 6000) / 10000 - 20_000 ether);

        // Consumes part of the headroom...
        _open(traderB, 2_000 ether, 2); // TVL 43.78k, OI 22k
        (,,, maxSingle, remaining) = hook.openInterestCapacity();
        assertEq(maxSingle, 4_378 ether);
        assertEq(remaining, (43_780 ether * 6000) / 10000 - 22_000 ether);

        // Over single cap -> SINGLE_TRADE_CAP; over headroom -> OPEN_INTEREST_CAP.
        vm.prank(address(manager));
        vm.expectRevert(
            abi.encodeWithSelector(EswapMarginHook.PositionExceedsSingleCap.selector, 5_000 ether, 4_378 ether)
        );
        hook.beforeSwap(
            address(this), key, IPoolManager.SwapParams(true, -int256(5_000 ether), 0), abi.encode(true, 2, traderC)
        );

        uint256 remAfterB = (43_780 ether * 6000) / 10000 - 22_000 ether; // 4268
        vm.prank(address(manager));
        vm.expectRevert(
            abi.encodeWithSelector(
                EswapMarginHook.OpenInterestExceedsCapacity.selector,
                22_000 ether + 4_300 ether,
                22_000 ether + remAfterB
            )
        );
        hook.beforeSwap(
            address(this), key, IPoolManager.SwapParams(true, -int256(4_300 ether), 0), abi.encode(true, 2, traderC)
        );
    }

    function test_MaxOpenBorrowRaw_Boundary() public {
        // Configure BEFORE building TVL so the seed position bypasses the caps.
        hook.setOpenInterestCaps(1000, 7000, 10_000 ether);
        _open(traderA, 20_000 ether, 2); // TVL 39.8k, OI 20k -> single 3.98k, remaining ~7.86k

        uint256 capRaw = hook.maxOpenBorrowRaw(key.currency0);
        (,,, uint256 maxSingle, uint256 remaining) = hook.openInterestCapacity();
        assertEq(capRaw, maxSingle < remaining ? maxSingle : remaining, "raw == min(single, remaining)");
        assertEq(capRaw, 3_980 ether);

        // View-level boundary: exactly the advertised capacity fits, one more doesn't.
        address probe = makeAddr("oiProbe");
        (bool fits,) = hook.quoteOpenFit(key, probe, key.currency0, 2, capRaw, capRaw);
        assertTrue(fits, "boundary borrow fits");
        (fits,) = hook.quoteOpenFit(key, probe, key.currency0, 2, capRaw + 1 ether, capRaw + 1 ether);
        assertFalse(fits, "one unit over the advertised cap does not fit");

        // Executional check: opening AT the advertised capacity succeeds.
        _open(makeAddr("oiFit"), capRaw, 2);
    }

    function test_QuoteOpenFit_MirrorsValidation() public {
        _open(traderA, 51_000 ether, 3);

        // Saturated aggregate headroom blocks even tiny leveraged orders.
        (bool fits, string memory reason) = hook.quoteOpenFit(key, traderB, key.currency0, 2, 2_000 ether, 2_000 ether);
        assertFalse(fits);
        assertEq(reason, "OPEN_INTEREST_CAP");

        (fits, reason) = hook.quoteOpenFit(key, traderA, key.currency0, 2, 1 ether, 1 ether);
        assertFalse(fits);
        assertEq(reason, "POSITION_ALREADY_OPEN");

        (fits, reason) = hook.quoteOpenFit(key, traderB, key.currency0, 25, 1 ether, 24 ether);
        assertFalse(fits);
        assertEq(reason, "LEVERAGE_EXCEEDED");

        (fits, reason) = hook.quoteOpenFit(key, traderB, key.currency0, 1, 300_000 ether, 0);
        assertTrue(fits, "1x exempt from OI caps");
    }

    function test_OneX_ExemptFromCaps() public {
        _open(traderA, 51_000 ether, 3);
        (bool active,,,,) = hook.openInterestCapacity();
        assertTrue(active);

        // 1x => zero borrow, no OI: any margin size passes regardless of caps.
        _open(traderB, 500_000 ether, 1);
    }
}
