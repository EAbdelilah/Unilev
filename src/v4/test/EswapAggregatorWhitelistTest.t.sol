// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BaseV4Test, PriceFeedMock, ERC20Mock} from "./BaseV4Test.t.sol";
import {PoolManagerCallbackMock} from "./mocks/PoolManagerMock.sol";
import {EswapMarginHook} from "../EswapMarginHook.sol";
import {EswapRouter} from "../EswapRouter.sol";
import {PoolKey} from "../types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "../types/PoolId.sol";
import {Currency} from "../types/Currency.sol";

/// @notice Regression coverage for the DEMAND-side registration gate.
/// @dev Both aggregator entrypoints assert
///      `require(allowedAggregators[route.exchangeProxy], "Aggregator not whitelisted")`
///      (EswapRouter.sol). A router deployed without calling `setAllowedAggregator`
///      therefore cannot execute ANY aggregator route, which is why the deploy
///      scripts now whitelist the opt-in `AGG_*_PROXY_ADDRESS` slots.
/// @dev The exchange proxy is a stub: this test asserts the WHITELIST GATE, not
///      aggregator integration, so the stub only needs to be a plausible callee.
contract EswapAggregatorWhitelistTest is BaseV4Test {
    using PoolIdLibrary for PoolKey;

    EswapRouter public router;
    PoolKey public standardPoolKey;
    address public trader;
    address public proxy;

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

        trader = makeAddr("trader");
        proxy = makeAddr("exchangeProxy");

        token0.mint(trader, 100 ether);
        token1.mint(address(hook), 100 ether);
        token0.mint(address(hook), 100 ether);
    }

    function _route() internal view returns (EswapRouter.AggregatorRoute memory) {
        return EswapRouter.AggregatorRoute({
            exchangeProxy: proxy,
            tokenIn: address(token0),
            tokenOut: address(token1),
            sellAmount: 1 ether,
            value: 0,
            callData: abi.encodeWithSignature("swap()")
        });
    }

    function test_UnregisteredProxy_CannotRoute() public {
        // A freshly deployed router has an empty whitelist.
        assertFalse(router.allowedAggregators(proxy), "fresh router must have an empty aggregator whitelist");

        vm.prank(trader);
        vm.expectRevert("Aggregator not whitelisted");
        router.swapMultiPoolForAggregator(_params(), trader, _route());
    }

    function test_RegisteredProxy_PassesTheGate() public {
        // This is the call the deploy scripts now make.
        router.setAllowedAggregator(proxy, true);
        assertTrue(router.allowedAggregators(proxy), "setAllowedAggregator must register the proxy");

        // The gate is passed. The call may still revert later for unrelated
        // reasons (the stub proxy cannot actually swap), so we assert only that
        // the revert is no longer the whitelist error.
        vm.prank(trader);
        (bool ok, bytes memory ret) =
            address(router).call(abi.encodeWithSelector(EswapRouter.swapMultiPoolForAggregator.selector, _params(), trader, _route()));
        if (!ok) {
            assertFalse(
                _isAggregatorGateRevert(ret),
                "must not revert with 'Aggregator not whitelisted' once the proxy is registered"
            );
        }
    }

    function test_CanBeRevoked() public {
        router.setAllowedAggregator(proxy, true);
        assertTrue(router.allowedAggregators(proxy));

        router.setAllowedAggregator(proxy, false);
        assertFalse(router.allowedAggregators(proxy), "revocation must clear the whitelist entry");

        vm.prank(trader);
        vm.expectRevert("Aggregator not whitelisted");
        router.swapMultiPoolForAggregator(_params(), trader, _route());
    }

    function test_OnlyOwnerCanRegister() public {
        address stranger = makeAddr("stranger");
        vm.prank(stranger);
        vm.expectRevert();
        router.setAllowedAggregator(proxy, true);
    }

    function _params() internal view returns (EswapRouter.SwapParams memory) {
        return EswapRouter.SwapParams({
            key: key,
            standardPoolKey: standardPoolKey,
            zeroForOne: true,
            amountSpecified: -int256(1 ether),
            leverage: 2,
            solver: address(0xB0B),
            hookData: "0x",
            deadline: block.timestamp + 3600,
            minAmountOut: 0
        });
    }

    /// @dev True when `ret` is exactly the `require` string used by the
    ///      aggregator gate, i.e. the whitelist check is what failed.
    function _isAggregatorGateRevert(bytes memory ret) internal pure returns (bool) {
        bytes memory expected = abi.encodeWithSignature("Error(string)", "Aggregator not whitelisted");
        if (ret.length != expected.length) return false;
        for (uint256 i = 0; i < expected.length; i++) {
            if (ret[i] != expected[i]) return false;
        }
        return true;
    }
}
