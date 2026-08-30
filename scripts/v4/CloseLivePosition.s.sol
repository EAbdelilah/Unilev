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

/// @notice Close the deployer's live USDC/WETH long on the deep fee-500 venue and
///         report the USDC returned. Env: PRIVATE_KEY, HOOK_ADDRESS, ROUTER_ADDRESS,
///         USDC_ADDRESS, MIN_OUT (raw USDC, default 0).
contract CloseLivePosition is Script {
    using PoolIdLibrary for PoolKey;

    address constant WETH = 0x4200000000000000000000000000000000000006;

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address trader = vm.addr(pk);
        address hookAddr = vm.envAddress("HOOK_ADDRESS");
        address routerAddr = vm.envAddress("ROUTER_ADDRESS");
        address usdc = vm.envAddress("USDC_ADDRESS");
        uint256 minOut = vm.envOr("MIN_OUT", uint256(0));

        uint256 usdcBefore = IERC20(usdc).balanceOf(trader);

        EswapRouter router = EswapRouter(routerAddr);
        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(usdc),
            currency1: Currency.wrap(WETH),
            fee: 3000,
            tickSpacing: 60,
            hooks: hookAddr
        });

        vm.startBroadcast(pk);
        router.closePosition(hookAddr, key, trader, trader, minOut);
        vm.stopBroadcast();

        uint256 usdcAfter = IERC20(usdc).balanceOf(trader);
        console.log("trader:", trader);
        console.log("USDC before:", usdcBefore);
        console.log("USDC after:", usdcAfter);
        console.log("USDC received (raw):", usdcAfter > usdcBefore ? usdcAfter - usdcBefore : 0);

        EswapMarginHook hook = EswapMarginHook(payable(hookAddr));
        (address nt,,,,,,,,) = hook.positions(key.toId(), trader);
        console.log("position trader after close:", nt);
    }
}
