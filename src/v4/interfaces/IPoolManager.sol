// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Currency} from "../types/Currency.sol";
import {PoolKey} from "../types/PoolKey.sol";
import {PoolId} from "../types/PoolId.sol";

import {BalanceDelta} from "../types/BalanceDelta.sol";

/// @notice Real Uniswap V4 PoolManager interface (lib/v4-core), mirrored locally
///         so the hook/router compile against the exact ABI the real PoolManager
///         dispatches. Struct layouts are byte-identical to
///         lib/v4-core/src/interfaces/IPoolManager.sol.
interface IPoolManager {
    struct SwapParams {
        bool zeroForOne;
        int256 amountSpecified;
        uint160 sqrtPriceLimitX96;
    }

    struct ModifyLiquidityParams {
        int24 tickLower;
        int24 tickUpper;
        int256 liquidityDelta;
        bytes32 salt;
    }

    function unlock(bytes calldata data) external returns (bytes memory);
    function initialize(PoolKey memory key, uint160 sqrtPriceX96) external returns (int24 tick);
    function modifyLiquidity(PoolKey memory key, ModifyLiquidityParams memory params, bytes calldata hookData)
        external
        returns (BalanceDelta callerDelta, BalanceDelta feesAccrued);
    function swap(PoolKey memory key, SwapParams memory params, bytes calldata hookData)
        external
        returns (BalanceDelta swapDelta);
    function donate(PoolKey memory key, uint256 amount0, uint256 amount1, bytes calldata hookData)
        external
        returns (BalanceDelta);
    function sync(Currency currency) external;
    function take(Currency currency, address to, uint256 amount) external;
    function settle() external payable returns (uint256 paid);
    function settleFor(address recipient) external payable returns (uint256 paid);
    function clear(Currency currency, uint256 amount) external;
    function mint(address to, uint256 id, uint256 amount) external;
    function burn(address from, uint256 id, uint256 amount) external;
    function updateDynamicLPFee(PoolKey memory key, uint24 newDynamicLPFee) external;
    function extsload(bytes32 slot) external view returns (bytes32);
    function exttload(bytes32 slot) external view returns (bytes32);
    function balanceOf(address owner, uint256 id) external view returns (uint256);
}
