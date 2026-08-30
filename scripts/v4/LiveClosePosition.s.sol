// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {EswapMarginHook} from "../../src/v4/EswapMarginHook.sol";
import {EswapRouter} from "../../src/v4/EswapRouter.sol";
import {PoolKey} from "../../src/v4/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "../../src/v4/types/PoolId.sol";
import {Currency} from "../../src/v4/types/Currency.sol";

/// @notice Live close: unwind a NATIVE-ETH/USDC margin position opened via
///         LiveOpenPosition. The trader (PRIVATE_KEY) is the only caller allowed.
///         Env: PRIVATE_KEY, HOOK_ADDRESS, ROUTER_ADDRESS, USDC_ADDRESS,
///         TRADER_ADDRESS (defaults to PRIVATE_KEY's address), MIN_AMOUNT_OUT
///         (raw wei, default 0).
contract LiveClosePosition is Script {
    using PoolIdLibrary for PoolKey;

    address constant NATIVE_ETH = address(0);
    address constant USDC = 0x078D782b760474a361dDA0AF3839290b0EF57AD6; // Unichain mainnet USDC

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address hookAddr = vm.envAddress("V4_HOOK_ADDRESS");
        address routerAddr = vm.envAddress("V4_ROUTER_ADDRESS");
        address trader = vm.envOr("TRADER_ADDRESS", address(vm.addr(pk)));
        uint256 minAmountOut = vm.envOr("MIN_AMOUNT_OUT", uint256(0));
        address solver = vm.envOr("V4_SOLVER_ADDRESS", address(0));

        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(NATIVE_ETH),
            currency1: Currency.wrap(USDC),
            fee: 3000,
            tickSpacing: 60,
            hooks: hookAddr
        });

        EswapMarginHook hook = EswapMarginHook(payable(hookAddr));
        (, uint256 posCollateral, uint256 posBorrow, uint8 posLev, bool posIsLong,,,,) = hook.positions(key.toId(), trader);
        console.log("before - collateral:", posCollateral);
        console.log("before - borrow:", posBorrow);
        console.log("before - lev:", uint256(posLev));
        console.log("before - isLong:", posIsLong);

        EswapRouter router = EswapRouter(payable(routerAddr));
        vm.startBroadcast(pk);
        router.closePosition(hookAddr, key, trader, solver, minAmountOut);
        vm.stopBroadcast();

        (, uint256 c2, uint256 b2, uint8 l2, bool il2,,,,) = hook.positions(key.toId(), trader);
        console.log("after - collateral:", c2);
        console.log("after - borrow:", b2);
        console.log("after - lev:", uint256(l2));
        console.log("after - isLong:", il2);
    }
}