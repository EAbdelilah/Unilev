// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice One-shot LP seeder: mints a wide single position into a live v4
///         pool on behalf of the caller-funded contract.
contract EswapLpSeeder is IUnlockCallback {
    IPoolManager public immutable pm;

    constructor(IPoolManager _pm) {
        pm = _pm;
    }

    function seed(PoolKey calldata key, int24 tickLower, int24 tickUpper, int128 liquidityDelta) external {
        pm.unlock(abi.encode(key, tickLower, tickUpper, liquidityDelta));
    }

    function approveToken(address token, address spender, uint256 amount) external {
        IERC20(token).approve(spender, amount);
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        require(msg.sender == address(pm), "only pm");
        (PoolKey memory key, int24 tl, int24 tu, int128 liq) = abi.decode(data, (PoolKey, int24, int24, int128));
        (BalanceDelta delta,) = pm.modifyLiquidity(
            key,
            IPoolManager.ModifyLiquidityParams({tickLower: tl, tickUpper: tu, liquidityDelta: liq, salt: bytes32(0)}),
            ""
        );
        _settleDelta(key, delta);
        return bytes("");
    }

    function _settleDelta(PoolKey memory key, BalanceDelta delta) internal {
        if (delta.amount0() < 0) {
            pm.sync(key.currency0);
            IERC20(Currency.unwrap(key.currency0)).transfer(address(pm), uint256(-int256(delta.amount0())));
            pm.settle();
        } else if (delta.amount0() > 0) {
            pm.take(key.currency0, address(this), uint256(uint128(delta.amount0())));
        }
        if (delta.amount1() < 0) {
            pm.sync(key.currency1);
            IERC20(Currency.unwrap(key.currency1)).transfer(address(pm), uint256(-int256(delta.amount1())));
            pm.settle();
        } else if (delta.amount1() > 0) {
            pm.take(key.currency1, address(this), uint256(uint128(delta.amount1())));
        }
    }
}