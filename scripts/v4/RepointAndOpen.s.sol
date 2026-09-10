// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {EswapMarginHook} from "../../src/v4/EswapMarginHook.sol";
import {EswapRouter} from "../../src/v4/EswapRouter.sol";
import {PoolKey} from "../../src/v4/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "../../src/v4/types/PoolId.sol";
import {Currency} from "../../src/v4/types/Currency.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Live re-point of the USDC/WETH standard (fill) venue to the DEEP
///         fee-500 no-hook pool (liq 2e11) so fills get ~real prices instead of
///         the ~99% slippage of the thin fee-3000 pool. Then close any existing
///         deployer position (unwinds on the new deep venue) and open a fresh
///         meaningful LONG with the deep venue.
///         Env: PRIVATE_KEY, HOOK_ADDRESS, ROUTER_ADDRESS, USDC_ADDRESS,
///         MARGIN_USDC (raw, default 100000 = $0.10).
contract RepointAndOpen is Script {
    using PoolIdLibrary for PoolKey;

    address constant WETH = 0x4200000000000000000000000000000000000006;

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address trader = vm.addr(pk);
        address hookAddr = vm.envAddress("HOOK_ADDRESS");
        address routerAddr = vm.envAddress("ROUTER_ADDRESS");
        address usdc = vm.envAddress("USDC_ADDRESS");
        uint256 marginUsdc = vm.envOr("MARGIN_USDC", uint256(100000));

        EswapRouter router = EswapRouter(routerAddr);
        EswapMarginHook hook = EswapMarginHook(payable(hookAddr));

        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(usdc),
            currency1: Currency.wrap(WETH),
            fee: 3000,
            tickSpacing: 60,
            hooks: hookAddr
        });
        PoolId poolId = key.toId();

        vm.startBroadcast(pk);

        // 2. Close the existing deployer position (dust long) if any, BEFORE
        //    re-pointing the standard venue, so its rehypothecated LP (deployed
        //    in the old fee-3000 standard pool) is unwound from the same venue
        //    it was deployed into.
        (address posTrader, uint256 posCollateral,,,,,,,) = hook.positions(poolId, trader);
        if (posTrader != address(0) && posCollateral != 0) {
            router.closePosition(hookAddr, key, trader, trader, 0);
            console.log("closed existing position, collateral", posCollateral);
        } else {
            console.log("no open position to close");
        }

        // 1. Re-point standard fill venue to the DEEP fee-500 no-hook pool.
        PoolKey memory standardKey = PoolKey({
            currency0: Currency.wrap(usdc),
            currency1: Currency.wrap(WETH),
            fee: 500,
            tickSpacing: 60,
            hooks: address(0)
        });
        hook.setStandardPoolKey(poolId, standardKey);
        console.log("standardPoolKey set to fee-500 for USDC/WETH");

        // 3. Open a fresh LONG on the deep fee-500 venue.
        bytes memory hookData = abi.encode(true, uint8(1), trader);
        IERC20(usdc).approve(routerAddr, type(uint256).max);
        router.swapMultiPool(EswapRouter.SwapParams({
            key: key,
            standardPoolKey: standardKey,
            zeroForOne: true,            // sell USDC, buy WETH -> long
            amountSpecified: -int256(marginUsdc),
            leverage: 1,
            solver: address(0),
            hookData: hookData,
            deadline: block.timestamp + 15 minutes,
minAmountOut: 0
        }));
        console.log("opened LONG, margin(raw)", marginUsdc);

        vm.stopBroadcast();

        (address nt, uint256 pc, uint256 pb, uint8 pl, bool pil,,,,) = hook.positions(poolId, trader);
        console.log("trader:", trader);
        console.log("posTrader:", nt);
        console.log("collateral raw (WETH):", pc);
        console.log("borrowed raw:", pb);
        console.log("leverage:", uint256(pl));
        console.log("isLong:", pil);
    }
}
