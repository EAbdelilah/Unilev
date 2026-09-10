// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BaseV4Test, PriceFeedMock, ERC20Mock} from "./BaseV4Test.t.sol";
import {PoolManagerCallbackMock} from "./mocks/PoolManagerMock.sol";
import {EswapMarginHook} from "../EswapMarginHook.sol";
import {EswapRouter} from "../EswapRouter.sol";
import {EswapSettlement} from "../EswapSettlement.sol";
import {PoolKey} from "../types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "../types/PoolId.sol";
import {Currency} from "../types/Currency.sol";

contract EswapSettlementTest is BaseV4Test {
    using PoolIdLibrary for PoolKey;

    EswapRouter public router;
    EswapSettlement public settlement;
    PoolKey public standardPoolKey;
    address public trader;
    address public filler;

    function setUp() public override {
        manager = new PoolManagerCallbackMock();
        priceFeed = new PriceFeedMock();

        token0 = new ERC20Mock("Token 0", "TK0");
        token1 = new ERC20Mock("Token 1", "TK1");

        address hookAddress = address(uint160((1 << 159) | (1 << 158) | (1 << 153) | (1 << 152) | (1 << 148)));
        deployCodeTo("EswapMarginHook.sol:EswapMarginHook", abi.encode(manager, priceFeed, address(this)), hookAddress);
        hook = EswapMarginHook(payable(hookAddress));

        router = new EswapRouter(manager);

        key = PoolKey({
            currency0: Currency.wrap(address(token0)),
            currency1: Currency.wrap(address(token1)),
            fee: 3000,
            tickSpacing: 60,
            hooks: address(hook)
        });

        standardPoolKey =
            PoolKey({currency0: key.currency0, currency1: key.currency1, fee: 500, tickSpacing: 60, hooks: address(0)});

        hook.setRouterAndMinCollateralUsd(address(router), 0);
        hook.setAuthorizedPool(key.toId(), true);
        hook.setStandardPoolKey(key.toId(), standardPoolKey);

        manager.setSlot0(key.toId(), 1 << 96, 0);
        manager.setSlot0(standardPoolKey.toId(), 1 << 96, 0);

        settlement = new EswapSettlement(router);
        router.setSolverWhitelist(address(settlement), true);

        trader = makeAddr("trader");
        filler = makeAddr("filler");

        token0.mint(filler, 100 ether);
        token1.mint(address(hook), 100 ether);
        token0.mint(address(hook), 100 ether);

        vm.startPrank(filler);
        token0.approve(address(settlement), type(uint256).max);
        vm.stopPrank();
    }

    function _originData(uint256 margin, uint256 minAmountOut) internal view returns (bytes memory) {
        return abi.encode(
            key, standardPoolKey, true, int256(margin), uint8(5), address(0),
            abi.encode(true, uint8(5), trader), minAmountOut
        );
    }

    function test_Fill_OpensPosition() public {
        bytes32 orderId = keccak256("test-order-1");

        vm.prank(filler);
        settlement.fill(orderId, _originData(10 ether, 0), "");

        // [FIX H-4] The position must be credited to the RECIPIENT (trader),
        // never to the settlement contract.
        (, uint256 collateral,,,,,,,) = hook.positions(key.toId(), trader);
        assertGt(collateral, 0, "position not opened under recipient");
        assertEq(settlement.filledRecipient(orderId), trader, "order must record the recipient");
    }

    function test_Fill_EmitsEvent() public {
        bytes32 orderId = keccak256("test-order-2");

        vm.expectEmit(true, true, true, true);
        emit EswapSettlement.PositionFilled(orderId, trader, address(token0), 10 ether);

        vm.prank(filler);
        settlement.fill(orderId, _originData(10 ether, 0), "");
    }

    function test_Fill_LowLeverage() public {
        bytes32 orderId = keccak256("test-order-3");

        vm.prank(filler);
        settlement.fill(orderId, _originData(10 ether, 0), "");

        (, uint256 collateral,,,,,,,) = hook.positions(key.toId(), trader);
        assertGt(collateral, 0, "position not opened");
    }

    function test_RescueToken() public {
        token0.mint(address(settlement), 5 ether);

        address recipient = makeAddr("recipient");
        settlement.rescueToken(address(token0), recipient, 5 ether);

        assertEq(token0.balanceOf(recipient), 5 ether, "rescue amount mismatch");
    }

    function test_RescueToken_OnlyOwner() public {
        vm.prank(makeAddr("stranger"));
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", makeAddr("stranger")));
        settlement.rescueToken(address(token0), makeAddr("recipient"), 5 ether);
    }

    /// @dev [FIX H-3] The settlement no longer hardcodes minAmountOut:0 — the
    ///      floor is forwarded from originData and enforced inside the router's
    ///      swap, so a sandwiched fill backs out atomically (no position).
    function test_Fill_SlippageRevertsAboveOutput() public {
        bytes32 orderId = keccak256("test-order-slippage");

        // margin 10 ether, 5x → notional 50 ether → mock fill output = 48 ether.
        vm.expectRevert(abi.encodeWithSelector(EswapRouter.SwapOutputBelowMinimum.selector, 48 ether, 49 ether));
        vm.prank(filler);
        settlement.fill(orderId, _originData(10 ether, 49 ether), "");

        (address posTrader,,,,,,,,) = hook.positions(key.toId(), address(settlement));
        assertEq(posTrader, address(0), "no position after slippage revert");
    }

    /// @dev [FIX H-4] The recipient owns the position after fill; closing it pays
    ///      the net proceeds STRAIGHT to the recipient (the settlement never
    ///      holds the position or its proceeds).
    function test_Close_RecipientReceivesProceedsDirectly() public {
        bytes32 orderId = keccak256("test-order-close");

        uint256 traderBalBefore = token1.balanceOf(trader);

        vm.prank(filler);
        settlement.fill(orderId, _originData(10 ether, 0), "");

        (, uint256 collateralForTrader,,,,,,,) = hook.positions(key.toId(), trader);
        assertGt(collateralForTrader, 0, "recipient must own the position");

        // The recipient closes their own position direct via the router (C-1 rule).
        vm.prank(trader);
        router.closePosition(address(hook), key, trader, address(settlement), 0);

        (, uint256 collateralAfter,,,,,,,) = hook.positions(key.toId(), trader);
        assertEq(collateralAfter, 0, "position must be closed");

        // Close unwinds token1 collateral back into the DEBT currency (token0),
        // repays the solver, and pays the net remainder to the recipient direct.
        assertGt(token0.balanceOf(trader), 0, "recipient must receive close proceeds directly");
        // The settlement only re-holds its SOLVER REPAYMENT (40 ether borrow
        // principal) — zero trader remainder is captured by it.
        assertEq(token0.balanceOf(address(settlement)), 40 ether, "settlement must hold only the borrow repayment");
    }
}
