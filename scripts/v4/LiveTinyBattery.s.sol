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

/// @notice Dust live battery (<$0.05 notional): a FRESH trader wallet (env
///         TINY_TRADER_PK, separate from the solver) opens and closes SHORT 1x/2x/5x
///         and LONG 1x/2x/5x against the deep native ETH/USDC 500/10 pool — exactly
///         mirroring the dashboard's browser-trader flow (trader pays margin/signs;
///         the configured solver EOA funds leveraged borrows).
///         The hook's USD floor comes from MIN_COLLATERAL_USD in .env, which
///         DeployUnichain.s.sol applies via setRouterAndMinCollateralUsd. On
///         Unichain that floor is 1e16 = $0.01, so MARGIN_USD must exceed it with
///         room for swap fees: the hook values the POST-swap collateral, which comes
///         in ~0.5% under the posted margin, so a margin of exactly $0.01 fails
///         CollateralTooLow(). $0.015 leaves ~49% headroom.
///         Env: TINY_TRADER_PK, V4_HOOK_ADDRESS, V4_ROUTER_ADDRESS, V4_SOLVER_ADDRESS,
///         MARGIN_USD (default 0.015 ether = $0.015).
///
///         PRE-REQUISITE — the solver's borrow escrows must already be funded, since
///         `startBroadcast` here signs as the TRADER only. An open draws the borrow
///         leg from the escrow, and a close repays the SOLVER's *balance* — NOT the
///         escrow — so the six cases consume a CUMULATIVE 5x margin and the battery
///         is therefore NOT idempotent: re-running it needs a fresh escrow top-up.
///             router.depositNativeBorrow(solver)  payable,  >= 5 * marginWei
///             router.depositBorrowEscrow(USDC, n)  msg.sender = solver, >= 5 * marginUsdc
///         run() asserts both up front and reverts with the exact shortfall rather
///         than failing deep inside a position open.
contract LiveTinyBattery is Script {
    using PoolIdLibrary for PoolKey;

    address constant NATIVE_ETH = address(0);
    address constant USDC = 0x078D782b760474a361dDA0AF3839290b0EF57AD6; // Unichain mainnet USDC

    /// @dev Sum of (leverage - 1) over the 1x/2x/5x battery = 0 + 1 + 4.
    uint256 internal constant BORROW_LEG_SUM = 5;

    error EscrowUnderfunded(uint256 need, uint256 have);

    EswapMarginHook hook;
    EswapRouter router;
    PoolKey nativeKey;
    PoolKey deepStdKey;
    address trader;
    address solver;
    uint256 marginWei;
    uint256 marginUsdc;

    function run() external {
        uint256 pk = vm.envUint("TINY_TRADER_PK");
        trader = vm.addr(pk);
        address hookAddr = vm.envAddress("V4_HOOK_ADDRESS");
        address routerAddr = vm.envAddress("V4_ROUTER_ADDRESS");
        solver = vm.envOr("V4_SOLVER_ADDRESS", address(0));
        uint256 marginUsd = vm.envOr("MARGIN_USD", uint256(0.01 ether)); // $0.01

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

        // Adaptive: ETH and USDC margins both target `marginUsd` (floor is $0.001).
        //
        // Ceiling division is mandatory here, not cosmetic. `getAmountInUsd` runs
        // the wei amount back through the oracle, so a floor-divided `marginWei`
        // lands strictly *under* the target: at $2,684/ETH, marginUsd=0.01e18
        // truncated to 3725572270779 wei prices out at 9,999,999,999,997,391 raw
        // units -- one part in ~2.6e9 below the 1e16 floor -- and the first SHORT
        // reverts CollateralTooLow(). Round up (and give USDC the same treatment)
        // so a "$0.01 margin" test actually clears a "$0.01 minimum" check.
        uint256 usdPerEth = hook.priceFeed().getAmountInUsd(NATIVE_ETH, 1e18);
        uint256 marginWeiTarget = (marginUsd * 1e18) / usdPerEth;
        marginWei = marginWeiTarget == 0 ? 1 : marginWeiTarget + 1;
        uint256 marginUsdcTarget = marginUsd / 1e12; // raw 6-decimals
        marginUsdc = marginUsdcTarget == 0 ? 1 : marginUsdcTarget + 1;

        console.log("trader:", trader);
        console.log("solver:", solver);
        console.log("margin eth-wei:", marginWei);
        console.log("margin usdc-raw:", marginUsdc);

        _requireEscrow();

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

    /// @dev Fail fast with an actionable message if the solver's borrow escrows
    ///      cannot cover the battery, instead of reverting inside a position open
    ///      with an opaque InsufficientNativeBorrowEscrow.
    function _requireEscrow() internal view {
        uint256 needNative = marginWei * BORROW_LEG_SUM;
        uint256 haveNative = router.nativeBorrowEscrow(solver);
        if (haveNative < needNative) revert EscrowUnderfunded(needNative, haveNative);
        console.log("  native escrow ok:", haveNative, "need:", needNative);

        uint256 needUsdc = marginUsdc * BORROW_LEG_SUM;
        uint256 haveUsdc = router.erc20BorrowEscrow(solver, USDC);
        if (haveUsdc < needUsdc) revert EscrowUnderfunded(needUsdc, haveUsdc);
        console.log("  usdc escrow ok  :", haveUsdc, "need:", needUsdc);
    }

    function _openShort(uint8 lev) internal {
        router.swapMultiPool{value: marginWei * uint256(lev)}(EswapRouter.SwapParams({
            key: nativeKey,
            standardPoolKey: deepStdKey,
            zeroForOne: true,
            amountSpecified: -int256(marginWei),
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
        console.log("  collateral:", coll, "borrowed:", borr);
        console.log("  leverage:", uint256(pl), "isLong:", isLong);
        if (lev > 0) console.log("  requested lev:", uint256(lev));
    }
}