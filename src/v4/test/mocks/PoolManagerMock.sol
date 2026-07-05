// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IPoolManager} from "../../interfaces/IPoolManager.sol";
import {PoolKey} from "../../types/PoolKey.sol";
import {Currency} from "../../types/Currency.sol";

contract PoolManagerMock is IPoolManager {
    struct ModifyLiquidityCall {
        PoolKey key;
        int24 tickLower;
        int24 tickUpper;
        int128 liquidityDelta;
    }

    ModifyLiquidityCall[] public modifyLiquidityCalls;

    function unlock(bytes calldata data) external override returns (bytes memory) {
        return "";
    }

    function swap(PoolKey calldata, bool, int128, bytes calldata) external override returns (int128) {
        return 0;
    }

    function modifyLiquidity(
        PoolKey calldata key,
        int24 tickLower,
        int24 tickUpper,
        int128 liquidityDelta,
        bytes calldata
    ) external override returns (int128 delta0, int128 delta1) {
        modifyLiquidityCalls.push(ModifyLiquidityCall({
            key: key,
            tickLower: tickLower,
            tickUpper: tickUpper,
            liquidityDelta: liquidityDelta
        }));
        return (0, 0);
    }

    function settle(Currency) external payable override returns (uint256) {
        return 0;
    }

    function take(Currency, address, uint256) external override {}

    function mint(address, uint256, uint256) external override {}

    function burn(address, uint256, uint256) external override {}
}
