// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {EswapMarginHook} from "../EswapMarginHook.sol";
import {EswapRouter} from "../EswapRouter.sol";
import {PoolKey} from "../types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "../types/PoolId.sol";
import {Currency} from "../types/Currency.sol";
import {IPoolManager} from "../interfaces/IPoolManager.sol";
import {IERC20 as RealIERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IPoolManager as RealIPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolId as RealPoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {PoolKey as RealPoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency as RealCurrency} from "@uniswap/v4-core/src/types/Currency.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";

/// @dev Reproduce the LIVE deployCollateral revert against live Unichain state
///      (chainId 130). Uses the REAL deployed hook/router/pricefeed/singleton.
contract LiveDeployCollateralReproTest is Test {
    using PoolIdLibrary for PoolKey;

    address constant PM = 0x1F98400000000000000000000000000000000004; // Unichain V4 singleton
    address constant USDC = 0x078D782b760474a361dDA0AF3839290b0EF57AD6;
    address constant ETH = address(0);

    address constant LIVE_HOOK = 0x4bd2C1e73d150b65EF88DBa247Ed60A1538310c8;
    address constant LIVE_ROUTER = 0x4c14D923E9A9f64Da6684b77E07B33c76D0B3d60;

    address trader = 0x7a5Ccd2402EEf7E989d86318ef8E4678A8a5ce79;
    address solver = 0x518634753C61342298c3E04326056b3Ce596a566;
    address freshTrader = address(0x1111000011110000111100001111000011110000);

    PoolKey hookKey =
        PoolKey({currency0: Currency.wrap(ETH), currency1: Currency.wrap(USDC), fee: 3000, tickSpacing: 60, hooks: LIVE_HOOK});
    PoolKey stdKey =
        PoolKey({currency0: Currency.wrap(ETH), currency1: Currency.wrap(USDC), fee: 500, tickSpacing: 10, hooks: address(0)});

    EswapRouter router;
    EswapMarginHook hook;

    function setUp() public {
        string memory rpc = vm.envOr("UNICHAIN_RPC_URL", string(""));
        require(bytes(rpc).length > 0, "UNICHAIN_RPC_URL required");
        uint256 forkBlock = vm.envOr("FORK_BLOCK", uint256(0));
        if (forkBlock > 0) {
            vm.createSelectFork(rpc, forkBlock);
        } else {
            vm.createSelectFork(rpc);
        }
        require(block.chainid == 130, "not unichain");
        router = EswapRouter(payable(LIVE_ROUTER));
        hook = EswapMarginHook(payable(LIVE_HOOK));
    }

    function test_DeployCollateral_On_LiveOpenPosition() public {
        // Fund trader + solver with USDC on the fork.
        deal(USDC, freshTrader, 1_000_000e6);
        deal(USDC, solver, 1_000_000e6);
        vm.prank(freshTrader);
        RealIERC20(USDC).approve(LIVE_ROUTER, type(uint256).max);
        vm.prank(solver);
        RealIERC20(USDC).approve(LIVE_ROUTER, type(uint256).max);

        uint256 margin = 84_572; // 0.084572 USDC dust margin, matching the live bot
        EswapRouter.SwapParams memory params = EswapRouter.SwapParams({
            key: hookKey,
            standardPoolKey: stdKey,
            zeroForOne: false, // LONG: pay token1 = USDC
            amountSpecified: -int256(margin),
            leverage: 2,
            solver: solver,
            hookData: abi.encode(true, uint8(2), freshTrader)
        });

        vm.prank(freshTrader);
        router.swapMultiPool(params);

        (,,,, bool isLong,, int24 tl, int24 tu, uint128 liq) = hook.positions(hookKey.toId(), freshTrader);
        emit log_named_uint("OPEN liquidity", liq);
        assertTrue(isLong, "should be LONG");

        // If the open's deployCollateral already succeeded, liq>0 and the direct
        // call below silently returns. Assert what the open actually did:
        if (liq == 0) {
            // Reproduce the live path: force a fresh deploy and surface the revert.
            vm.prank(LIVE_ROUTER);
            hook.deployCollateral(hookKey, freshTrader);
        }
    }

    /// @dev Fork at the EXACT block the live probe tx 0x5108... was mined and call
    ///      deployCollateral on the ALREADY-EXISTING live position (liq==0 by observ).
    function test_DeployCollateral_OnExistingLivePosition() public {
        vm.createSelectFork(vm.envString("UNICHAIN_RPC_URL"), 57791352);
        router = EswapRouter(payable(LIVE_ROUTER));
        hook = EswapMarginHook(payable(LIVE_HOOK));

        (,, uint256 coll,, bool isLong,, int24 tl, int24 tu, uint128 liq) = hook.positions(hookKey.toId(), trader);
        emit log_named_uint("existing collateral", coll);
        emit log_named_uint("existing liq", liq);
        emit log_named_string("isLong", vm.toString(isLong));

        vm.prank(LIVE_ROUTER);
        hook.deployCollateral(hookKey, trader);

        (,, uint256 coll2,, bool isLong2,, int24 tl2, int24 tu2, uint128 liq2) =
            hook.positions(hookKey.toId(), trader);
        emit log_named_int("post-deploy tickLower", tl2);
        emit log_named_int("post-deploy tickUpper", tu2);
        emit log_named_uint("post-deploy liq", liq2);
        assertTrue(isLong2, "should be LONG");
    }
}