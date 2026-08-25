// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {PoolId as RealPoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {IPoolManager as RealIPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey as RealPoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency as RealCurrency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey as LocalPoolKey} from "../../src/v4/types/PoolKey.sol";
import {PoolIdLibrary as LocalPoolIdLib, PoolId as LocalPoolId} from "../../src/v4/types/PoolId.sol";
import {Currency as LocalCurrency} from "../../src/v4/types/Currency.sol";

contract ReadPoolLive is Script {
    using PoolIdLibrary for RealPoolKey;
    using LocalPoolIdLib for LocalPoolKey;

    address constant PM = 0x1F98400000000000000000000000000000000004;
    address constant USDC = 0x078D782b760474a361dDA0AF3839290b0EF57AD6;
    address constant WETH = 0x4200000000000000000000000000000000000006;

    function run() external {
        address hookAddr = vm.envAddress("HOOK_ADDRESS");

        RealPoolKey memory key = RealPoolKey({
            currency0: RealCurrency.wrap(USDC),
            currency1: RealCurrency.wrap(WETH),
            fee: 3000,
            tickSpacing: 60,
            hooks: IHooks(hookAddr)
        });
        RealPoolId realPoolId = key.toId();
        console.log("real poolId:", vm.toString(RealPoolId.unwrap(realPoolId)));

        LocalPoolKey memory localKey = LocalPoolKey({
            currency0: LocalCurrency.wrap(USDC),
            currency1: LocalCurrency.wrap(WETH),
            fee: 3000,
            tickSpacing: 60,
            hooks: hookAddr
        });
        console.log("local poolId:", vm.toString(LocalPoolId.unwrap(LocalPoolIdLib.toId(localKey))));

        RealIPoolManager pm = RealIPoolManager(PM);
        (uint160 sqrt, int24 tick, uint24 fee, uint24 proto) = StateLibrary.getSlot0(pm, realPoolId);
        console.log("sqrt:", vm.toString(uint256(sqrt)));
        console.log("tick:", int256(tick));
        console.log("lpFee:", uint256(fee));
        console.log("liquidity:", uint256(StateLibrary.getLiquidity(pm, realPoolId)));
    }
}
