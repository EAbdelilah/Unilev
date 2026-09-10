// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {EswapMarginHook} from "../../src/v4/EswapMarginHook.sol";
import {EswapRouter} from "../../src/v4/EswapRouter.sol";
import {PoolKey} from "../../src/v4/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "../../src/v4/types/PoolId.sol";
import {Currency} from "../../src/v4/types/Currency.sol";

/// @notice Live trade battery: SHORT 1x/2x/5x and LONG 1x/2x/5x, each opened and
///         closed (round trip) against the deep native ETH/USDC 500/10 pool, using
///         ~$0.06 margins. Trader = solver = PRIVATE_KEY owner (already funded with
///         USDC + native ETH). Confirms the whole multi-pool pipeline end-to-end.
///         Env: PRIVATE_KEY, V4_HOOK_ADDRESS, V4_ROUTER_ADDRESS, V4_SOLVER_ADDRESS.
contract LiveBattery is Script {
    using PoolIdLibrary for PoolKey;

    address constant NATIVE_ETH = address(0);
    address constant USDC = 0x078D782b760474a361dDA0AF3839290b0EF57AD6; // Unichain mainnet USDC
    uint256 constant MARGIN_USD = 0.06 ether; // ~$0.06 >= $0.05 min collateral

    EswapMarginHook hook;
    EswapRouter router;
    PoolKey nativeKey;
    PoolKey deepStdKey;
    address trader;
    address solver;
    uint256 marginWeiShort;

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        trader = vm.addr(pk);
        address hookAddr = vm.envAddress("V4_HOOK_ADDRESS");
        address routerAddr = vm.envAddress("V4_ROUTER_ADDRESS");
        solver = vm.envOr("V4_SOLVER_ADDRESS", trader);

        hook = EswapMarginHook(payable(hookAddr));
        router = EswapRouter(payable(routerAddr));
        nativeKey = PoolKey({
            currency0: Currency.wrap(NATIVE_ETH),
            currency1: Currency.wrap(USDC),
            fee: 3000,
            tickSpacing: 60,
            hooks: hookAddr
        });
        deepStdKey = PoolKey({
            currency0: Currency.wrap(NATIVE_ETH),
            currency1: Currency.wrap(USDC),
            fee: 500,
            tickSpacing: 10,
            hooks: address(0)
        });

        // Adaptive ETH margin so the USD value clears the $0.05 floor regardless of price.
        uint256 usdPerEth = hook.priceFeed().getAmountInUsd(NATIVE_ETH, 1e18);
        marginWeiShort = (MARGIN_USD * 1e18) / usdPerEth;
        console.log("eth price / margin-wei / margin-usdc:");
        console.log(usdPerEth);
        console.log(marginWeiShort);
        console.log(MARGIN_USD);

        vm.startBroadcast(pk);
        IERC20(USDC).approve(routerAddr, type(uint256).max);

        uint8[3] memory levs = [uint8(1), 2, 5];
        for (uint256 i = 0; i < levs.length; i++) {
            _openShort(levs[i]);
            _close();
        }
        for (uint256 j = 0; j < levs.length; j++) {
            _openLong(levs[j]);
            _close();
        }
        vm.stopBroadcast();

        console.log("final balances:");
        console.log("ETH  :", trader.balance);
        console.log("USDC :", IERC20(USDC).balanceOf(trader));
    }

    function _openShort(uint8 lev) internal {
        uint256 notional = marginWeiShort * uint256(lev);
        router.swapMultiPool{value: notional}(EswapRouter.SwapParams({
            key: nativeKey,
            standardPoolKey: deepStdKey,
            zeroForOne: true,
            amountSpecified: -int256(marginWeiShort),
            leverage: lev,
            solver: solver,
            hookData: abi.encode(true, lev, trader),
            deadline: block.timestamp + 15 minutes,
minAmountOut: 0
        }));
        console.log("--- SHORT opened");
        _print(lev);
    }

    function _openLong(uint8 lev) internal {
        uint256 marginUsdc = MARGIN_USD / 1e12; // 0.06 USDC raw
        router.swapMultiPool(EswapRouter.SwapParams({
            key: nativeKey,
            standardPoolKey: deepStdKey,
            zeroForOne: false,
            amountSpecified: -int256(marginUsdc),
            leverage: lev,
            solver: solver,
            hookData: abi.encode(true, lev, trader),
            deadline: block.timestamp + 15 minutes,
minAmountOut: 0
        }));
        console.log("--- LONG opened");
        _print(lev);
    }

    function _close() internal {
        router.closePosition(address(hook), nativeKey, trader, solver, 0);
        console.log("--- position closed");
        _print(0);
    }

    function _print(uint8 lev) internal {
        (address t, uint256 coll, uint256 borr, uint8 pl, bool isLong,,,,) =
            hook.positions(nativeKey.toId(), trader);
        console.log("  trader:", t);
        console.log("  collateral:", coll, "borrowed:", borr);
        console.log("  leverage:", uint256(pl), "isLong:", isLong);
        if (lev > 0) {
            console.log("  requested lev: ", uint256(lev));
        }
    }
}