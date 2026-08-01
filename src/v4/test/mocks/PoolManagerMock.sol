// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IPoolManager} from "../../interfaces/IPoolManager.sol";
import {PoolKey} from "../../types/PoolKey.sol";
import {Currency} from "../../types/Currency.sol";
import {BalanceDelta, BalanceDeltaLibrary} from "../../types/BalanceDelta.sol";
import {PoolId} from "../../types/PoolId.sol";

contract PoolManagerMock is IPoolManager {
    using BalanceDeltaLibrary for BalanceDelta;

    struct ModifyLiquidityCall {
        PoolKey key;
        int24 tickLower;
        int24 tickUpper;
        int128 liquidityDelta;
    }

    ModifyLiquidityCall[] public modifyLiquidityCalls;

    struct Slot0Data {
        uint160 sqrtPriceX96;
        int24 tick;
        uint16 protocolFee;
        uint24 lpFee;
    }

    mapping(PoolId => Slot0Data) public slot0;
    mapping(address => mapping(uint256 => uint256)) public balances;
    mapping(address => mapping(Currency => int256)) public currencyDeltas;
    BalanceDelta public overrideSwapDelta;
    bool public hasOverrideSwapDelta;

    function setSlot0(PoolId id, uint160 sqrtPriceX96, int24 tick) external {
        slot0[id] = Slot0Data(sqrtPriceX96, tick, 0, 3000);
    }

    function setCurrencyDelta(address locker, Currency currency, int256 delta) external {
        currencyDeltas[locker][currency] = delta;
    }

    function setNextSwapDelta(int128 delta0, int128 delta1) external {
        overrideSwapDelta = BalanceDeltaLibrary.toBalanceDelta(delta0, delta1);
        hasOverrideSwapDelta = true;
    }

    function balanceOf(address owner, uint256 id) external view returns (uint256) {
        return balances[owner][id];
    }

    function unlock(bytes calldata data) external override returns (bytes memory) {
        return "";
    }

    function swap(PoolKey calldata, bool zeroForOne, int128 amountSpecified, bytes calldata) external override returns (BalanceDelta delta) {
        if (hasOverrideSwapDelta) {
            hasOverrideSwapDelta = false; // consume once
            return overrideSwapDelta;
        }
        // Enforce real swap direction semantics:
        //   zeroForOne=true  → selling token0 (amount0<0), receiving token1 (amount1>0)
        //   zeroForOne=false → selling token1 (amount1<0), receiving token0 (amount0>0)
        // Use a 1:1 exchange rate with 4% slippage for realistic output.
        uint256 absIn = uint256(int256(amountSpecified < 0 ? -amountSpecified : amountSpecified));
        int128 output = int128(uint128((absIn * 96) / 100));
        int128 input  = -int128(uint128(absIn));
        if (zeroForOne) {
            // selling token0 → receiving token1
            delta = BalanceDeltaLibrary.toBalanceDelta(input, output);
        } else {
            // selling token1 → receiving token0
            delta = BalanceDeltaLibrary.toBalanceDelta(output, input);
        }
    }

    function modifyLiquidity(
        PoolKey calldata key,
        int24 tickLower,
        int24 tickUpper,
        int128 liquidityDelta,
        bytes calldata
    ) external override returns (BalanceDelta delta) {
        modifyLiquidityCalls.push(ModifyLiquidityCall({
            key: key,
            tickLower: tickLower,
            tickUpper: tickUpper,
            liquidityDelta: liquidityDelta
        }));
        return delta;
    }

    function settle(Currency) external payable override returns (uint256) {
        return 0;
    }

    function take(Currency, address, uint256) external override {}

    function mint(address to, uint256 id, uint256 amount) external override {
        balances[to][id] += amount;
    }

    function burn(address from, uint256 id, uint256 amount) external override {
        if (balances[from][id] >= amount) {
            balances[from][id] -= amount;
        }
    }

    function currencyDelta(address locker, Currency currency) external view override returns (int256) {
        return currencyDeltas[locker][currency];
    }

    function getSlot0(PoolId id) external view override returns (uint160 sqrtPriceX96, int24 tick, uint16 protocolFee, uint24 lpFee) {
        Slot0Data memory s = slot0[id];
        if (s.sqrtPriceX96 == 0) {
            sqrtPriceX96 = 79228162514264337593543950336;
            tick = 0;
            protocolFee = 0;
            lpFee = 3000;
        } else {
            sqrtPriceX96 = s.sqrtPriceX96;
            tick = s.tick;
            protocolFee = s.protocolFee;
            lpFee = s.lpFee;
        }
    }
}
