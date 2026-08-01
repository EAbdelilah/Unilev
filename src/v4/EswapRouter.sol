// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IPoolManager} from "./interfaces/IPoolManager.sol";
import {PoolKey} from "./types/PoolKey.sol";
import {Currency} from "./types/Currency.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {BalanceDelta} from "./types/BalanceDelta.sol";

interface IEswapHook {
    function executeLiquidation(PoolKey calldata key, address trader, uint256 minAmountOut) external;
    function rebalancePosition(PoolKey calldata key, address trader) external;
    function deployCollateral(PoolKey calldata key, address trader) external;
    function closePosition(PoolKey calldata key, address trader, address solver, uint256 minAmountOut) external;
}

/**
 * @title EswapRouter
 * @notice Handles Uniswap V4 unlock flow, pulling margin from users and settling deltas.
 */
contract EswapRouter is Ownable {
    IPoolManager public immutable manager;

    enum CallType { SWAP, CLOSE, LIQUIDATE, REBALANCE }

    constructor(IPoolManager _manager) Ownable(msg.sender) {
        manager = _manager;
    }

    struct SwapParams {
        PoolKey key;
        bool zeroForOne;
        int128 amountSpecified;
        uint8 leverage;
        bytes hookData;
    }

    function swap(SwapParams calldata params) external returns (bytes memory) {
        return manager.unlock(abi.encode(CallType.SWAP, params, msg.sender));
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        require(msg.sender == address(manager), "Not manager");

        CallType callType = abi.decode(data, (CallType));

        if (callType == CallType.SWAP) {
            (, SwapParams memory params, address trader) = abi.decode(data, (CallType, SwapParams, address));
            return _swapCallback(params, trader);
        } else if (callType == CallType.CLOSE) {
            (, address hook, PoolKey memory key, address trader, address solver, uint256 minAmountOut) = abi.decode(data, (CallType, address, PoolKey, address, address, uint256));
            _closeCallback(hook, key, trader, solver, minAmountOut);
            return "";
        } else if (callType == CallType.LIQUIDATE) {
            (, address hook, PoolKey memory key, address trader, uint256 minAmountOut) = abi.decode(data, (CallType, address, PoolKey, address, uint256));
            IEswapHook(hook).executeLiquidation(key, trader, minAmountOut);
            return "";
        } else {
            (, address hook, PoolKey memory key, address trader) = abi.decode(data, (CallType, address, PoolKey, address));
            IEswapHook(hook).rebalancePosition(key, trader);
            return "";
        }
    }

    function _swapCallback(SwapParams memory params, address trader) internal returns (bytes memory) {
        BalanceDelta delta = manager.swap(params.key, params.zeroForOne, params.amountSpecified, params.hookData);

        Currency input = params.zeroForOne ? params.key.currency0 : params.key.currency1;
        uint256 marginAmount = uint256(int256(params.amountSpecified < 0 ? -params.amountSpecified : params.amountSpecified));

        IERC20(Currency.unwrap(input)).transferFrom(trader, address(manager), marginAmount);
        manager.settle(input);

        if (params.hookData.length > 0) {
            (bool isMargin, , ) = abi.decode(params.hookData, (bool, uint8, address));
            if (isMargin) {
                try IEswapHook(params.key.hooks).deployCollateral(params.key, trader) {} catch {}
            }
        }

        return abi.encode(delta);
    }

    /**
     * @notice Permissionless liquidation entrypoint for keepers.
     * @dev Anyone may trigger the liquidation of an underwater position. The hook
     *      validates the position is actually liquidatable and enforces slippage
     *      via minAmountOut, so permissionless access cannot force bad liquidations.
     * @param minAmountOut Minimum swap output for the liquidation unwind (slippage
     *                     protection against MEV); derive it from an oracle quote.
     */
    function liquidate(address hook, PoolKey calldata key, address trader, uint256 minAmountOut) external {
        manager.unlock(abi.encode(CallType.LIQUIDATE, hook, key, trader, minAmountOut));
    }

    /**
     * @notice Permissionless rebalancing entrypoint for keepers.
     * @dev Re-centers an out-of-range position's concentrated liquidity around the
     *      current tick. Safe to run permissionless: it only moves liquidity ranges,
     *      is a no-op when the tick is already in range, and the caller pays gas.
     */
    function rebalance(address hook, PoolKey calldata key, address trader) external {
        manager.unlock(abi.encode(CallType.REBALANCE, hook, key, trader));
    }

    function closePosition(address hook, PoolKey calldata key, address trader, address solver, uint256 minAmountOut) external {
        manager.unlock(abi.encode(CallType.CLOSE, hook, key, trader, solver, minAmountOut));
    }

    function _closeCallback(address hook, PoolKey memory key, address trader, address solver, uint256 minAmountOut) internal {
        IEswapHook(hook).closePosition(key, trader, solver, minAmountOut);
    }

    /**
     * @notice Quoter-to-execution parity view helper for ODOS/Enso aggregators.
     * Returns 0 cleanly without throwing EVM reverts on invalid input.
     */
    function quoteExactInput(
        PoolKey calldata,
        bool,
        int128 amountSpecified,
        uint8 leverage
    ) external pure returns (int128 amountOut) {
        if (leverage == 0 || leverage > 5 || amountSpecified == 0) return 0;
        int128 absAmount = amountSpecified < 0 ? -amountSpecified : amountSpecified;
        return absAmount * int128(uint128(leverage));
    }
}
