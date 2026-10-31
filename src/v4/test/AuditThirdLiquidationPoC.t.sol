// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BaseV4Test, PriceFeedMock, ERC20Mock} from "./BaseV4Test.t.sol";
import {PoolManagerCallbackMock} from "./mocks/PoolManagerMock.sol";
import {EswapMarginHook} from "../EswapMarginHook.sol";
import {IPriceFeed} from "../EswapMarginHook.sol";
import {EswapRouter} from "../EswapRouter.sol";
import {EswapMarginHookLogic} from "../EswapMarginHookLogic.sol";
import {EswapMarginHookLogicStorage} from "../EswapMarginHookLogicStorage.sol";
import {PoolKey} from "../types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "../types/PoolId.sol";
import {Currency} from "../types/Currency.sol";
import {IPoolManager} from "../interfaces/IPoolManager.sol";
import {BalanceDelta, BalanceDeltaLibrary} from "../types/BalanceDelta.sol";
import {EswapHookDeployLib} from "./EswapHookDeployLib.sol";
import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract FlakyFeed is IPriceFeed {
    mapping(address => uint256) public prices;
    bool public down;
    function setPrice(address token, uint256 price) external { prices[token] = price; }
    function setDown(bool d) external { down = d; }
    function getAmountInUsd(address token, uint256 amount) external view override returns (uint256) {
        if (down) revert("feed down");
        uint256 p = prices[token];
        if (p == 0) p = 1e18;
        return (amount * p) / 1e18;
    }
    function getTwapPrice(address token) external view override returns (uint256) {
        if (down) revert("feed down");
        uint256 p = prices[token];
        if (p == 0) p = 1e18;
        return p;
    }
}

contract BlocklistERC20 is ERC20 {
    address public blocked;
    constructor(string memory n, string memory s) ERC20(n, s) { _mint(msg.sender, 1_000_000 ether); }
    function setBlocked(address a) external { blocked = a; }
    function _update(address from, address to, uint256 value) internal override {
        if (to == blocked) revert("blocked");
        super._update(from, to, value);
    }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

/// @notice Third-audit liquidation PoCs (F-03, F-05, F-08).
contract AuditThirdLiquidationPoC is BaseV4Test {
    using PoolIdLibrary for PoolKey;

    EswapRouter public router;
    address public liquidator = address(0x1AA);
    address public solver = address(0x2BB);

    function setUp() public override {
        manager = new PoolManagerCallbackMock();
        priceFeed = new PriceFeedMock();

        token0 = new ERC20Mock("Token 0", "TK0");
        token1 = new ERC20Mock("Token 1", "TK1");

        address hookAddress = address(uint160((1 << 159) | (1 << 158) | (1 << 153) | (1 << 152) | (1 << 148)));
        (address _hookLogic, address _hookLogic2) = EswapHookDeployLib.deployLogic(address(manager), address(priceFeed));
        deployCodeTo("EswapMarginHook.sol:EswapMarginHook", abi.encode(manager, priceFeed, _hookLogic, _hookLogic2, address(this)), hookAddress);
        hook = EswapMarginHook(payable(hookAddress));

        router = new EswapRouter(manager);

        key = PoolKey({
            currency0: Currency.wrap(address(token0)),
            currency1: Currency.wrap(address(token1)),
            fee: 3000,
            tickSpacing: 60,
            hooks: address(hook)
        });

        hook.setRouterAndMinCollateralUsd(address(router), 0);
        EswapMarginHookLogic(payable(address(hook))).setAuthorizedPool(key.toId(), true);
        manager.setSlot0(key.toId(), 79228162514264337593543950336, 0);
    }

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
        manager.mint(address(hook), uint256(uint160(address(token1))), 28 ether * 2);
        vm.prank(address(router));
        hook.registerSolverDebt(key.toId(), address(this), solver, 20 ether);
    }

    function _makeLiquidatable() internal {
        priceFeed.setPrice(address(token1), 0.5e18);
        priceFeed.setPrice(address(token0), 1e18);

        token0.mint(address(hook), 50 ether);
        token1.mint(address(hook), 50 ether);

        manager.setNextSwapDelta(30 ether, -28 ether);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // F-03: unwind below oracle floor reverts
    // ─────────────────────────────────────────────────────────────────────────
    function test_F03_UnwindBelowOracleFloor_Reverts() public {
        _openShort();
        priceFeed.setPrice(address(token1), 0.5e18);
        priceFeed.setPrice(address(token0), 1e18);

        token0.mint(address(hook), 50 ether);
        token1.mint(address(hook), 50 ether);

        manager.setNextSwapDelta(1 ether, -28 ether);

        vm.prank(liquidator);
        vm.expectRevert();
        router.liquidate(address(hook), key, address(this), 0);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // F-05: cached oracle mark keeps liquidation live during outage
    // ─────────────────────────────────────────────────────────────────────────
    function test_F05_CachedOracleKeepsLiquidationLive() public {
        FlakyFeed ff = new FlakyFeed();
        address hookAddr2 = address(uint160((1 << 159) | (1 << 158) | (1 << 153) | (1 << 152) | (1 << 148) | 1));
        (address l1, address l2) = EswapHookDeployLib.deployLogic(address(manager), address(ff));
        deployCodeTo("EswapMarginHook.sol:EswapMarginHook", abi.encode(manager, ff, l1, l2, address(this)), hookAddr2);
        EswapMarginHook hook2 = EswapMarginHook(payable(hookAddr2));

        PoolKey memory key2 = PoolKey({
            currency0: Currency.wrap(address(token0)),
            currency1: Currency.wrap(address(token1)),
            fee: 3000,
            tickSpacing: 60,
            hooks: address(hook2)
        });
        hook2.setRouterAndMinCollateralUsd(address(router), 0);
        EswapMarginHookLogic(payable(address(hook2))).setAuthorizedPool(key2.toId(), true);
        manager.setSlot0(key2.toId(), 79228162514264337593543950336, 0);

        ff.setPrice(address(token0), 1e18);
        ff.setPrice(address(token1), 1e18);

        bytes memory data = abi.encode(true, uint8(3), address(this));
        vm.prank(address(manager));
        hook2.beforeSwap(address(this), key2, IPoolManager.SwapParams(true, -10 ether, 0), data);
        vm.prank(address(manager));
        hook2.afterSwap(
            address(this), key2, IPoolManager.SwapParams(true, -30 ether, 0),
            BalanceDeltaLibrary.toBalanceDelta(-30 ether, 28 ether), data
        );
        manager.mint(address(hook2), uint256(uint160(address(token1))), 28 ether * 2);
        vm.prank(address(router));
        hook2.registerSolverDebt(key2.toId(), address(this), solver, 20 ether);

        // Crash price
        ff.setPrice(address(token0), 1e18);
        ff.setPrice(address(token1), 0.5e18);

        // 2nd trader opens at crashed price to cache the mark
        address t2 = makeAddr("trader2");
        bytes memory data2 = abi.encode(true, uint8(3), t2);
        vm.prank(address(manager));
        hook2.beforeSwap(t2, key2, IPoolManager.SwapParams(false, -10 ether, 0), data2);
        vm.prank(address(manager));
        hook2.afterSwap(
            t2, key2, IPoolManager.SwapParams(false, -20 ether, 0),
            BalanceDeltaLibrary.toBalanceDelta(20 ether, -20 ether), data2
        );

        // Kill the feed
        ff.setDown(true);

        (address tr, uint256 coll, uint256 borr, uint8 lev, bool isLong,,,,) = hook2.positions(key2.toId(), address(this));
        assertTrue(hook2.isLiquidatable(
            EswapMarginHook.Position(tr, coll, borr, lev, isLong, 0, 0, 0, 0), key2
        ), "liquidatable via cache");

        token0.mint(address(hook2), 50 ether);
        token1.mint(address(hook2), 50 ether);
        manager.setNextSwapDelta(30 ether, -28 ether);

        vm.prank(liquidator);
        router.liquidate(address(hook2), key2, address(this), 0);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // F-08: deferred payout pull-claim surface
    // ─────────────────────────────────────────────────────────────────────────
    function test_F08_ClaimPayout_NoCredit_Reverts() public {
        vm.prank(address(this));
        vm.expectRevert(EswapMarginHookLogicStorage.NoPayoutCredit.selector);
        EswapMarginHookLogic(payable(address(hook))).claimPayout(Currency.wrap(address(token0)));
    }

    function test_F08_SetPayoutRedirect() public {
        vm.prank(address(this));
        EswapMarginHookLogic(payable(address(hook))).setPayoutRedirect(address(0xBEEF));
        // no revert
    }
}
