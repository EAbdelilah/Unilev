// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {EswapMarginHook} from "../EswapMarginHook.sol";
import {EswapRouter} from "../EswapRouter.sol";
import {PoolKey} from "../types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "../types/PoolId.sol";
import {Currency} from "../types/Currency.sol";

/// @notice LIVE-deployment canary (Unichain mainnet fork): runs the exact SHORT
///         call the frontend's useV4Position sends against the ACTUAL deployed
///         router/hook. The venture MUST be NATIVE ETH / USDC — base = ETH,
///         margin = native ETH (msg.value = notional), standard fill = the deep
///         ETH/USDC fee-500 tick-10 pool. A WRAPPED WETH / USDC venue is
///         oracle-divergent and correctly rejected by the TWAP breaker (see
///         LiveShortOpenTest for the fork-deploy proof on the working tree).
///
///         TODAY the live router (0x4c14) empty-reverts on every swapMultiPool
///         (both the stale 0x1244/0xe357 pair and the current 0x4c14/0x4bd2
///         pair) — 691 gas, no sub-frames — i.e. the deployed bytecode predates
///         the native-ETH flow. This test therefore ASSERTS the revert as a
///         canary: the moment deployment catches up, this test fails and must be
///         switched to the round-trip expectation (the code path itself is
///         already proven by LiveShortOpenTest).
contract LiveShortSimTest is Test {
    using PoolIdLibrary for PoolKey;

    address payable constant LIVE_ROUTER = payable(0x4c14D923E9A9f64Da6684b77E07B33c76D0B3d60);
    address constant LIVE_HOOK = 0x4bd2C1e73d150b65EF88DBa247Ed60A1538310c8;
    address constant OWNER = 0x518634753C61342298c3E04326056b3Ce596a566;
    address constant SOLVER = 0x518634753C61342298c3E04326056b3Ce596a566;

    address constant ETH = 0x0000000000000000000000000000000000000000;
    address constant USDC = 0x078D782b760474a361dDA0AF3839290b0EF57AD6;
    address constant LIVE_FEED = 0xc245def5317DbcB34e9F153eb3E0388bbc0e69F5;

    address trader = makeAddr("trader");

    PoolKey nativeHookKey = PoolKey(Currency.wrap(ETH), Currency.wrap(USDC), 3000, 60, LIVE_HOOK);
    PoolKey deepStdKey = PoolKey(Currency.wrap(ETH), Currency.wrap(USDC), 500, 10, address(0));
    PoolId nativePoolId = nativeHookKey.toId();

    function setUp() public {
        vm.createSelectFork(vm.envString("UNICHAIN_RPC_URL"));

        // Sanity: the live 0x4bd2 hook is wired to the real live ETH/USDC oracle
        // and its current router, so any revert below is a code-version issue,
        // not a config one.
        assertEq(address(EswapMarginHook(payable(LIVE_HOOK)).priceFeed()), LIVE_FEED, "live feed drift");
        // Re-point the accounting pool to native ETH/USDC the way the dashboard
        // now sends it (the hook originally hardcoded WRAPPED WETH).
        vm.startPrank(OWNER);
        EswapMarginHook(payable(LIVE_HOOK)).setAuthorizedPool(nativePoolId, true);
        EswapMarginHook(payable(LIVE_HOOK)).setBaseCurrency(nativePoolId, Currency.wrap(ETH));
        EswapMarginHook(payable(LIVE_HOOK)).setStandardPoolKey(nativePoolId, deepStdKey);
        vm.stopPrank();
    }

    /// @dev Canary. Corrected premise: native ETH/USDC 5x short.
    function test_LiveShort_NativeEthUsdc_CorrectVenue_DeploymentCanary() public {
        uint256 margin = 0.0002 ether;
        uint256 notional = margin * 5;
        EswapRouter.SwapParams memory params = EswapRouter.SwapParams({
            key: nativeHookKey,
            standardPoolKey: deepStdKey,
            zeroForOne: true, // sell native ETH (currency0), buy USDC -> SHORT
            amountSpecified: -int256(margin),
            leverage: 5,
            solver: SOLVER,
            hookData: abi.encode(true, uint8(5), trader),
            deadline: block.timestamp + 15 minutes,
            minAmountOut: 0
        });

        vm.deal(trader, notional * 2);
        vm.startPrank(trader);
        try EswapRouter(LIVE_ROUTER).swapMultiPool{value: notional}(params) returns (bytes memory) {
            emit log("LIVE SHORT OPENED: deployment caught up with the native ETH/USDC flow");
            emit log("-> flip this canary to the round-trip expectation and delete the stale-deploy note");
            fail("live deployment now supports shorts - update this canary to the round-trip test");
        } catch Error(string memory reason) {
            emit log(string(abi.encodePacked("LIVE SHORT reverted (string): ", reason)));
        } catch Panic(uint256 code) {
            emit log(string(abi.encodePacked("LIVE SHORT reverted (panic): ", vm.toString(code))));
        } catch (bytes memory lowLevelData) {
            emit log(string(abi.encodePacked("LIVE SHORT reverted (low-level): ", vm.toString(lowLevelData))));
        }
        vm.stopPrank();

        (,,, uint8 lev, bool isLong,,,,) = EswapMarginHook(payable(LIVE_HOOK)).positions(nativePoolId, trader);
        // Stale-deployment state: nothing recorded. The native ETH/USDC code path
        // is proven green on the working tree by LiveShortOpenTest.
        emit log_named_uint("live-recorded leverage (expected 0 until redeploy)", uint256(lev));
        emit log_named_uint("live-recorded isLong (expected 0 until redeploy)", isLong ? 1 : 0);
        assertEq(lev, 0, "stale deployment records no position; update canary when redeployed");
        assertFalse(isLong, "stale deployment records no position; update canary when redeployed");
    }
}