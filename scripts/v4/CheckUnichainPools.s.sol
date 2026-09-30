// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {PoolManager} from "@uniswap/v4-core/src/PoolManager.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";

/// @dev Read-only probe: does the deep (standard) ETH/USDC pool the deploy
/// script designates actually exist and hold liquidity on Unichain?
contract CheckUnichainPools is Script {
    function run() external {
        address pm = 0x1F98400000000000000000000000000000000004;
        address usdc = 0x078D782b760474a361dDA0AF3839290b0EF57AD6;
        address weth = 0x4200000000000000000000000000000000000006;

        (address c0, address c1) = usdc < weth ? (usdc, weth) : (weth, usdc);

        uint24[3] memory fees = [uint24(500), uint24(3000), uint24(100)];
        int24[3] memory ticks = [int24(60), int24(60), int24(200)];

        for (uint256 i = 0; i < fees.length; i++) {
            PoolKey memory key = PoolKey({
                currency0: Currency.wrap(c0),
                currency1: Currency.wrap(c1),
                fee: fees[i],
                tickSpacing: ticks[i],
                hooks: IHooks(address(0))
            });
            PoolId id = key.toId();
            (uint160 sqrtPriceX96,,,) = StateLibrary.getSlot0(IPoolManager(pm), id);
            uint128 liq = StateLibrary.getLiquidity(IPoolManager(pm), id);

            console.log("--------------------------------------------");
            console.log("fee          :", fees[i]);
            console.log("tickSpacing  :", ticks[i]);
            console.log("poolId       :", vm.toString(PoolId.unwrap(id)));
            console.log("sqrtPriceX96 :", sqrtPriceX96);
            console.log("liquidity    :", uint256(liq));
            console.log(liq == 0 ? "=> EMPTY / UNINITIALIZED" : "=> HAS LIQUIDITY");
        }
    }
}
