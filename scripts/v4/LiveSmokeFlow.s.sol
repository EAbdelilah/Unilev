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

/// @notice One-shot live smoke flow (repurpose config → open → close) on Unichain.
///         Repurposes the hook's ETH/USDC accounting pool to native ETH, binds the
///         standard fill key to the DEEP 500/10 pool, then opens a SHORT and a
///         LONG (with leverage) and closes them — proving the exact live sequence
///         end-to-end. Trader = PRIVATE_KEY owner (must hold the margin).
///         Env: PRIVATE_KEY, V4_HOOK_ADDRESS, V4_ROUTER_ADDRESS, V4_SOLVER_ADDRESS,
///         POSITION_TYPE (SHORT|LONG|BOTH, default SHORT), LEVERAGE (default 2),
///         MARGIN_WEI (short, default 0.0002 ETH), MARGIN_USDC (long, default 0.5).
contract LiveSmokeFlow is Script {
    using PoolIdLibrary for PoolKey;

    address constant NATIVE_ETH = address(0);
    address constant USDC = 0x078D782b760474a361dDA0AF3839290b0EF57AD6; // Unichain mainnet USDC

    EswapMarginHook hook;
    EswapRouter router;
    PoolKey nativeKey;
    PoolKey deepStdKey;
    address trader;

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        trader = vm.addr(pk);
        address hookAddr = vm.envAddress("V4_HOOK_ADDRESS");
        address routerAddr = vm.envAddress("V4_ROUTER_ADDRESS");
        address solver = vm.envOr("V4_SOLVER_ADDRESS", address(0));
        uint8 leverage = uint8(vm.envOr("LEVERAGE", uint256(2)));
        uint256 marginWei = vm.envOr("MARGIN_WEI", uint256(200000000000000)); // 0.0002 ETH
        uint256 marginUsdc = vm.envOr("MARGIN_USDC", uint256(500000)); // 0.5 USDC
        string memory mode = vm.envOr("POSITION_TYPE", string("SHORT"));

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

        uint256 nonce = vm.getNonce(trader);
        vm.startBroadcast(pk);
        // 1. One-time config re-point (owner).
        PoolId nativeId = nativeKey.toId();
        hook.setAuthorizedPool(nativeId, true);
        hook.setStandardPoolKey(nativeId, deepStdKey);
        hook.setBaseCurrency(nativeId, Currency.wrap(NATIVE_ETH));

        console.log("repointed poolId:", vm.toString(PoolId.unwrap(nativeId)));

        // 2. Open.
        bytes memory hookData = abi.encode(true, leverage, trader);
        if (keccak256(bytes(mode)) == keccak256(bytes("SHORT")) || keccak256(bytes(mode)) == keccak256(bytes("BOTH"))) {
            uint256 notional = marginWei * uint256(leverage);
            router.swapMultiPool{value: notional}(EswapRouter.SwapParams({
                key: nativeKey,
                standardPoolKey: deepStdKey,
                zeroForOne: true,
                amountSpecified: -int256(marginWei),
                leverage: leverage,
                solver: solver,
                hookData: hookData
            }));
            console.log("SHORT open done");
            _print("SHORT after open");
            router.closePosition(hookAddr, nativeKey, trader, solver, 0);
            console.log("SHORT close done");
            _print("SHORT after close");
        }
        if (keccak256(bytes(mode)) == keccak256(bytes("LONG")) || keccak256(bytes(mode)) == keccak256(bytes("BOTH"))) {
            IERC20(USDC).approve(routerAddr, type(uint256).max);
            router.swapMultiPool(EswapRouter.SwapParams({
                key: nativeKey,
                standardPoolKey: deepStdKey,
                zeroForOne: false,
                amountSpecified: -int256(marginUsdc),
                leverage: leverage,
                solver: solver,
                hookData: hookData
            }));
            console.log("LONG open done");
            _print("LONG after open");
            router.closePosition(hookAddr, nativeKey, trader, solver, 0);
            console.log("LONG close done");
            _print("LONG after close");
        }
        vm.stopBroadcast();
        console.log("nonce used:", vm.getNonce(trader) - nonce);
    }

    function _print(string memory label) internal {
        (address t, uint256 coll, uint256 borr, uint8 lev, bool isLong,,,,) = hook.positions(nativeKey.toId(), trader);
        console.log(label);
        console.log("  trader:", t);
        console.log("  collateral:", coll);
        console.log("  borrowed:", borr);
        console.log("  leverage:", uint256(lev));
        console.log("  isLong:", isLong);
    }
}