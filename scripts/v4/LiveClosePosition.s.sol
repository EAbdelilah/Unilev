// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {EswapMarginHook} from "../../src/v4/EswapMarginHook.sol";
import {EswapRouter} from "../../src/v4/EswapRouter.sol";
import {PoolKey} from "../../src/v4/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "../../src/v4/types/PoolId.sol";
import {Currency} from "../../src/v4/types/Currency.sol";

/// @notice Live smoke test: close the trader's position via EswapRouter.closePosition.
///         For a LONG the trader receives WETH (collateral is WETH, debt is USDC);
///         for a SHORT the trader receives USDC (collateral is USDC, debt is WETH).
///         Env: PRIVATE_KEY, HOOK_ADDRESS, ROUTER_ADDRESS, USDC_ADDRESS,
///         POSITION_TYPE (default LONG), SOLVER_ADDRESS (optional, only needed to
///         report the recorded solver; close uses the on-chain positionSolver),
///         MIN_AMOUNT_OUT (raw of the payout currency, default 1 = any amount).
contract LiveClosePosition is Script {
    using PoolIdLibrary for PoolKey;

    address constant WETH = 0x4200000000000000000000000000000000000006;

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address trader = vm.addr(pk);
        address hookAddr = vm.envAddress("HOOK_ADDRESS");
        address routerAddr = vm.envAddress("ROUTER_ADDRESS");
        address usdc = vm.envAddress("USDC_ADDRESS");
        string memory positionType = vm.envOr("POSITION_TYPE", string("LONG"));
        address solver = vm.envOr("SOLVER_ADDRESS", address(0));
        uint256 minAmountOut = vm.envOr("MIN_AMOUNT_OUT", uint256(1));

        EswapRouter router = EswapRouter(routerAddr);

        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(usdc),
            currency1: Currency.wrap(WETH),
            fee: 3000,
            tickSpacing: 60,
            hooks: hookAddr
        });

        vm.startBroadcast(pk);
        router.closePosition(hookAddr, key, trader, solver, minAmountOut);
        vm.stopBroadcast();

        EswapMarginHook hook = EswapMarginHook(payable(hookAddr));
        (address posTrader, uint256 posCollateral, uint256 posBorrow, uint8 posLev, bool isLong, , , , ) =
            hook.positions(key.toId(), trader);
        console.log("after close - posTrader:", posTrader);
        console.log("after close - collateral raw:", posCollateral);
        console.log("after close - borrowed raw:", posBorrow);
        console.log("after close - leverage:", uint256(posLev));
        console.log("after close - isLong:", isLong);
        console.log("positionType:", positionType);
    }
}