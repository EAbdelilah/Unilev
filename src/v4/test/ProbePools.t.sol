// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {console} from "forge-std/console.sol";
import {PoolKey} from "../types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "../types/PoolId.sol";
import {Currency} from "../types/Currency.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {PoolId as RealPoolId} from "@uniswap/v4-core/src/types/PoolId.sol";

contract ProbePools is Test {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    IPoolManager constant PM = IPoolManager(0x1F98400000000000000000000000000000000004);
    address constant WETH = 0x4200000000000000000000000000000000000006;
    address constant USDC = 0x078D782b760474a361dDA0AF3839290b0EF57AD6;
    address constant HOOK = 0x4bd2C1e73d150b65EF88DBa247Ed60A1538310c8;

    function setUp() public {
        vm.createSelectFork(vm.envString("UNICHAIN_RPC_URL"));
    }

    function _probePool(address c0, address c1, uint24 fee, int24 ts, address hooks, string memory label) internal {
        PoolKey memory key = PoolKey(Currency.wrap(c0), Currency.wrap(c1), fee, ts, hooks);
        bytes32 id = PoolId.unwrap(key.toId());
        (uint160 sqrtPriceX96, int24 tick,,) = PM.getSlot0(RealPoolId.wrap(id));
        if (sqrtPriceX96 == 0) {
            emit log_named_string(label, "EMPTY (not initialized)");
            return;
        }
        uint128 liq = PM.getLiquidity(RealPoolId.wrap(id));
        emit log_named_string(label, string.concat("tick=", vm.toString(tick)));
        emit log_named_uint(label, uint256(liq));
    }

    function test_ProbeAll() public {
        uint24[6] memory fees = [uint24(100), 300, 500, 3000, 10000, 2500];
        int24[4] memory ts = [int24(60), 200, 10, 1];
        for (uint256 i = 0; i < fees.length; i++) {
            for (uint256 j = 0; j < ts.length; j++) {
                string memory label = "NOHOOK F";
                label = string.concat(label, vm.toString(fees[i]));
                label = string.concat(label, "/T");
                label = string.concat(label, vm.toString(ts[j]));
                _probePool(USDC, WETH, fees[i], ts[j], address(0), label);
            }
        }
        _probePool(USDC, WETH, 3000, 60, HOOK, "OUR-HOOK 3000/60");
    }
}