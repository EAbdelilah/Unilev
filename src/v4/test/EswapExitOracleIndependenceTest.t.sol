// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {EswapMarginHook, IPriceFeed} from "../EswapMarginHook.sol";
import {PoolKey} from "../types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "../types/PoolId.sol";
import {Currency} from "../types/Currency.sol";
import {IPoolManager} from "../interfaces/IPoolManager.sol";
import {BalanceDeltaLibrary} from "../types/BalanceDelta.sol";
import {ERC20Mock} from "./BaseV4Test.t.sol";
import {PoolManagerMock} from "./mocks/PoolManagerMock.sol";
import {EswapHookDeployLib} from "./EswapHookDeployLib.sol";

/// @dev Mirrors PriceFeed._getValidatedPrice's revert surface: every read reverts
///      once `fail` is set, exactly as StalePrice / OraclePriceOutOfBounds would
///      on mainnet. The shared PriceFeedMock can never revert, so it cannot
///      express the failure mode this suite is about.
contract RevertingPriceFeedMock is IPriceFeed {
    mapping(address => uint256) public prices;
    bool public fail;

    error FeedUnavailable();

    function setPrice(address token, uint256 price) external {
        prices[token] = price;
    }

    function setFail(bool value) external {
        fail = value;
    }

    function getAmountInUsd(address token, uint256 amount) external view returns (uint256) {
        if (fail) revert FeedUnavailable();
        return (amount * (prices[token] > 0 ? prices[token] : 1e18)) / 1e18;
    }

    function getTwapPrice(address token) external view returns (uint256) {
        if (fail) revert FeedUnavailable();
        return prices[token] > 0 ? prices[token] : 1e18;
    }
}

/**
 * @notice Phase 0 exit-reliability audit: can a trader get stuck because the
 *         oracle is stale or out of bounds?
 *
 * Findings encoded as tests:
 *   - OPEN is oracle-gated. `_validateOpen` calls `_checkV4SpotAgainstV3Twap`,
 *     so a stale / manipulated / unconfigured feed blocks ENTRY.
 *   - CLOSE is oracle-INDEPENDENT. `closePosition` never reads the feed: the
 *     unwind swap uses a full-range `sqrtPriceLimit` and `_settle` books bad
 *     debt rather than reverting. A trader can always exit.
 *   - LIQUIDATION is oracle-GATED. `executeLiquidation` calls `isLiquidatable`,
 *     which reads the feed, so the liquidation backstop is unavailable exactly
 *     when the feed is unhealthy. This fails in the safe direction (never
 *     liquidate on an untrusted price) but must be documented, because it means
 *     bad positions cannot be cleaned up during a staleness window.
 */
contract EswapExitOracleIndependenceTest is Test {
    using PoolIdLibrary for PoolKey;

    error FeedUnavailable();

    EswapMarginHook hook;
    PoolManagerMock manager;
    RevertingPriceFeedMock priceFeed;
    PoolKey key;
    ERC20Mock token0;
    ERC20Mock token1;

    address trader = address(0xBEEF);
    address liquidator = address(0xCAFE);

    function setUp() public {
        manager = new PoolManagerMock();
        priceFeed = new RevertingPriceFeedMock();

        token0 = new ERC20Mock("Token 0", "TK0");
        token1 = new ERC20Mock("Token 1", "TK1");

        priceFeed.setPrice(address(token0), 1e18);
        priceFeed.setPrice(address(token1), 1e18);

        address hookAddress = address(uint160((1 << 159) | (1 << 158) | (1 << 153) | (1 << 152) | (1 << 148)));
        (address _hookLogic, address _hookLogic2) = EswapHookDeployLib.deployLogic(address(manager), address(priceFeed));
        deployCodeTo(
            "EswapMarginHook.sol:EswapMarginHook", abi.encode(manager, priceFeed, _hookLogic, _hookLogic2, address(this)), hookAddress
        );
        hook = EswapMarginHook(payable(hookAddress));
        hook.setRouterAndMinCollateralUsd(address(this), 0);

        key = PoolKey({
            currency0: Currency.wrap(address(token0)),
            currency1: Currency.wrap(address(token1)),
            fee: 3000,
            tickSpacing: 60,
            hooks: address(hook)
        });
        hook.setAuthorizedPool(key.toId(), true);
    }

    /// @dev Opens a 3x SHORT (zeroForOne=true) using the proven fixture from
    ///      EswapPositionLifecycleTest: margin 10, borrows 20, ~28 received.
    function _openShort() internal {
        bytes memory data = abi.encode(true, uint8(3), address(this));
        vm.prank(address(manager));
        hook.beforeSwap(address(this), key, IPoolManager.SwapParams(true, -10 ether, 0), data);
        vm.prank(address(manager));
        hook.afterSwap(
            address(this),
            key,
            IPoolManager.SwapParams(true, -30 ether, 0),
            BalanceDeltaLibrary.toBalanceDelta(-30 ether, 28 ether),
            data
        );
        // ERC-6909 claims for _settleTransientDebt + _settle (2x collateral).
        manager.mint(address(hook), uint256(uint160(address(token1))), 56 ether);
        (, uint256 collateral,,,,,,,) = hook.positions(key.toId(), address(this));
        assertGt(collateral, 0, "setup: position should be open");
    }

    /// @dev Funds the physical unwind leg and the debt-currency surplus.
    function _fundClose() internal {
        manager.setCurrencyDelta(address(hook), key.currency1, 35 ether);
        token0.mint(address(hook), 35 ether);
        token1.mint(address(hook), 27.86 ether);
    }

    /// @dev OPEN is oracle-gated: control case proving the mock really fails and
    ///      that entry is blocked by an unhealthy feed.
    function test_Open_Reverts_WhenOracleUnavailable() public {
        priceFeed.setFail(true);
        bytes memory data = abi.encode(true, uint8(3), address(this));

        vm.prank(address(manager));
        vm.expectRevert(RevertingPriceFeedMock.FeedUnavailable.selector);
        hook.beforeSwap(address(this), key, IPoolManager.SwapParams(true, -10 ether, 0), data);
    }

    /// @dev THE HEADLINE RESULT: a trader can always exit. The feed dies after
    ///      the position is open and the close still succeeds, clearing the
    ///      position, the claim balance and the collateral aggregate.
    function test_Close_Succeeds_WhenOracleUnavailable() public {
        _openShort();
        _fundClose();

        priceFeed.setFail(true);

        uint256 claimId = uint256(uint160(address(token1)));
        assertGt(hook._claimBalances(address(this), claimId), 0, "setup: claim populated before close");

        hook.closePosition(key, address(this), address(0), 0);

        (, uint256 collateral,,,,,,,) = hook.positions(key.toId(), address(this));
        assertEq(collateral, 0, "position must be cleared while the oracle is down");
        assertEq(hook._claimBalances(address(this), claimId), 0, "claim balance not cleared");
        assertEq(hook.totalCollateral(key.currency1), 0, "totalCollateral not cleared");
    }

    /// @dev Two independent oracle failure modes on the exit path: the feed
    ///      reverting (stale) and the feed returning a manipulated value. Both
    ///      must leave the trader able to close.
    function test_Close_Succeeds_WhenOracleReturnsManipulatedPrice() public {
        _openShort();
        _fundClose();

        // Simulate a manipulated/depegged read by pricing token0 absurdly.
        priceFeed.setPrice(address(token0), 1);
        priceFeed.setPrice(address(token1), 1e30);

        hook.closePosition(key, address(this), address(0), 0);

        (, uint256 collateral,,,,,,,) = hook.positions(key.toId(), address(this));
        assertEq(collateral, 0, "exit must not depend on the oracle's opinion of price");
    }

    /// @dev Documented asymmetry: the liquidation backstop reads the feed, so it
    ///      is unavailable while the feed is unhealthy. This is the safe direction
    ///      to fail (never liquidate on an untrusted price), but it means bad
    ///      positions cannot be reaped during a staleness window.
    function test_Liquidation_Reverts_WhenOracleUnavailable() public {
        _openShort();

        priceFeed.setFail(true);

        vm.prank(address(this));
        vm.expectRevert(RevertingPriceFeedMock.FeedUnavailable.selector);
        hook.executeLiquidation(key, address(this), 0, liquidator);
    }

    /// @dev Sanity: with a healthy feed the same liquidation proceeds, so the
    ///      revert above is attributable to the feed and not to fixture setup.
    function test_Liquidation_Succeeds_WhenOracleHealthy() public {
        _openShort();

        // Drive the position underwater so isLiquidatable() is true.
        priceFeed.setPrice(address(token1), 1);

        // Sanity: the hook agrees the position is liquidatable.
        assertTrue(hook.isPositionLiquidatable(key, address(this)), "setup: position should be liquidatable");

        token0.mint(address(hook), 40 ether);
        token1.mint(address(hook), 40 ether);
        manager.setCurrencyDelta(address(hook), key.currency1, 40 ether);

        hook.executeLiquidation(key, address(this), 0, liquidator);
    }
}
