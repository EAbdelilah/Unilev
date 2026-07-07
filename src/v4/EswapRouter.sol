// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IPoolManager} from "./interfaces/IPoolManager.sol";
import {PoolKey} from "./types/PoolKey.sol";
import {Currency} from "./types/Currency.sol";
import {IERC20} from "../interfaces/IERC20.sol";

interface IEswapHook {
    function executeLiquidation(PoolKey calldata key, address trader) external;
    function rebalancePosition(PoolKey calldata key, address trader) external;
}

/**
 * @title EswapRouter
 * @notice Handles Uniswap V4 unlock flow, pulling margin from users and settling deltas.
 */
contract EswapRouter {
    IPoolManager public immutable manager;
    address public owner;

    constructor(IPoolManager _manager) {
        manager = _manager;
        owner = msg.sender;
    }

    struct SwapParams {
        PoolKey key;
        bool zeroForOne;
        int128 amountSpecified;
        bytes hookData;
    }

    function swap(SwapParams calldata params) external returns (bytes memory) {
        return manager.unlock(abi.encode(params, msg.sender));
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        require(msg.sender == address(manager), "Not manager");

        if (data.length > 256) { // Heuristic for SwapParams + address
            (SwapParams memory params, address trader) = abi.decode(data, (SwapParams, address));
            return _swapCallback(params, trader);
        } else {
            _maintainCallback(data);
            return "";
        }
    }

    function _swapCallback(SwapParams memory params, address trader) internal returns (bytes memory) {
        // 1. Execute the swap
        int128 delta = manager.swap(params.key, params.zeroForOne, params.amountSpecified, params.hookData);

        // 2. Settle only the Trader's initial margin.
        // The 'borrowed' portion is provided by the Hook transiently.
        Currency input = params.zeroForOne ? params.key.currency0 : params.key.currency1;
        uint256 marginAmount = uint256(int256(params.amountSpecified < 0 ? -params.amountSpecified : params.amountSpecified));

        // Settle the margin input from the trader
        IERC20(Currency.unwrap(input)).transferFrom(trader, address(manager), marginAmount);
        manager.settle(input);

        // 3. Post-swap Maintenance (Liquidations/Rebalancing)
        // The router as the locker can safely call maintenance functions on the hook
        // avoiding hook re-entrancy restrictions during the swap itself.
        if (params.hookData.length > 0) {
            (bool isMargin, , ) = abi.decode(params.hookData, (bool, uint8, address));
            if (!isMargin) {
                // If this was a maintenance-triggered swap, the hook logic is already handled
                // by the standard swap flow.
            }
        }

        return abi.encode(delta);
    }

    /**
     * @notice External maintenance call for keepers to trigger liquidations or rebalancing
     */
    function maintain(address hook, PoolKey calldata key, address trader) external {
        require(msg.sender == owner, "Not authorized");
        manager.unlock(abi.encode(hook, key, trader));
    }

    function _maintainCallback(bytes calldata data) internal {
        (address hook, PoolKey memory key, address trader) = abi.decode(data, (address, PoolKey, address));

        // Execute maintenance on the hook
        // Re-entrancy is safe here because we are the 'locker' and not currently in a swap() call
        // Note: The hook's maintenance functions will call manager.swap/modifyLiquidity which is allowed for lockers.
        try IEswapHook(hook).executeLiquidation(key, trader) {} catch {
             IEswapHook(hook).rebalancePosition(key, trader);
        }
    }
}
