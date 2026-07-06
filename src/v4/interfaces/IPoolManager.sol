// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Currency} from "../types/Currency.sol";
import {PoolKey} from "../types/PoolKey.sol";
import {PoolId} from "../types/PoolId.sol";

interface IPoolManager {
    function getSlot0(PoolId id) external view returns (uint160 sqrtPriceX96, int24 tick, uint16 protocolFee, uint24 lpFee);
    function unlock(bytes calldata data) external returns (bytes memory);
    function swap(PoolKey calldata key, bool zeroForOne, int128 amountSpecified, bytes calldata hookData) external returns (int128 delta);
    function modifyLiquidity(PoolKey calldata key, int24 tickLower, int24 tickUpper, int128 liquidityDelta, bytes calldata hookData) external returns (int128 delta0, int128 delta1);
    function settle(Currency currency) external payable returns (uint256);
    function take(Currency currency, address to, uint256 amount) external;
    function mint(address to, uint256 id, uint256 amount) external;
    function burn(address from, uint256 id, uint256 amount) external;
}
