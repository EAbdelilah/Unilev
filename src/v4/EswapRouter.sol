// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IPoolManager} from "./interfaces/IPoolManager.sol";
import {PoolKey} from "./types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "./types/PoolId.sol";
import {Currency} from "./types/Currency.sol";
import {TickMath} from "./libraries/TickMath.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {BalanceDelta, BalanceDeltaLibrary} from "./types/BalanceDelta.sol";

interface IEswapHook {
    function executeLiquidation(PoolKey calldata key, address trader, uint256 minAmountOut) external;
    function rebalancePosition(PoolKey calldata key, address trader) external;
    function deployCollateral(PoolKey calldata key, address trader) external;
    function closePosition(PoolKey calldata key, address trader, address solver, uint256 minAmountOut) external;
    function registerSolverDebt(PoolId poolId, address trader, address solver, uint256 principal) external;
    function setStandardPoolKey(PoolId poolId, PoolKey calldata key) external;
}

/**
 * @title EswapRouter
 * @notice Handles Uniswap V4 unlock flow for the SDIM margin model.
 *
 * @dev SDIM (Solver-Delegated Integration Margin) single-pool execution:
 *      there is exactly ONE hook-enabled pool. Inside the unlock callback the
 *      router:
 *        1. Executes the margin swap on the hook pool with `hookData`
 *           (the hook flash-expands the swap by the borrow and records the
 *           position in afterSwap).
 *        2. Pulls the trader's MARGIN and settles it (router's -margin delta).
 *        3. Mints the swap OUTPUT as an ERC-6909 claim held by the HOOK
 *           (collateral custodian), offsetting the router's +output delta.
 *        4. Pulls the SOLVER's borrow and settles it FOR THE HOOK via
 *           settleFor(hook), zeroing the hook's flash-provided -borrow delta.
 *        5. Registers the on-chain SolverDebt guaranteeing solver repayment.
 *      All (account, currency) transient deltas net to zero before unlock exits.
 */
contract EswapRouter is Ownable {
    using PoolIdLibrary for PoolKey;
    using BalanceDeltaLibrary for BalanceDelta;

    IPoolManager public immutable manager;

    enum CallType { SWAP, CLOSE, LIQUIDATE, REBALANCE }

    constructor(IPoolManager _manager) Ownable(msg.sender) {
        manager = _manager;
    }

    struct SwapParams {
        // Hook-enabled pool where leverage accounting (flash borrow + position
        // registration) and the physical swap both happen.
        PoolKey key;
        PoolKey standardPoolKey;
        bool zeroForOne;
        // Margin amount (negative = exact input). The hook's beforeSwap
        // flash-expands this by the borrow, so the pool swaps margin x leverage.
        int256 amountSpecified;
        uint8 leverage;
        // Off-chain Solver that physically settles the borrowed leg
        // (margin x (leverage-1)). Must be non-zero for leverage > 1.
        address solver;
        bytes hookData;
    }

    /// @dev A sqrtPriceLimit that never binds but satisfies the real PoolManager's
    ///      bounds check (the mock accepts 0, the real PM reverts
    ///      PriceLimitOutOfBounds).
    function _defaultSqrtPriceLimit(bool zeroForOne) internal pure returns (uint160) {
        return zeroForOne ? TickMath.MIN_SQRT_RATIO + 1 : TickMath.MAX_SQRT_RATIO - 1;
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

    /**
     * @notice SDIM single-pool unlock callback. Executes the margin swap, settles
     *         the trader's margin + the solver's borrow, mints the collateral
     *         claim to the hook, and registers the solver debt.
     * @dev All PoolManager transient deltas must net to zero here or the real
     *      PoolManager reverts CurrencyNotSettled on unlock exit.
     */
    function _swapCallback(SwapParams memory params, address trader) internal returns (bytes memory) {
        uint256 marginAmount = uint256(int256(params.amountSpecified < 0 ? -params.amountSpecified : params.amountSpecified));
        uint256 borrowAmount = marginAmount * uint256(params.leverage - 1);
        if (params.leverage > 1) {
            require(params.solver != address(0), "Solver required for leverage");
        }

        bool isMultiPool = (Currency.unwrap(params.standardPoolKey.currency0) != address(0));

        BalanceDelta delta;
        uint256 outputAmount;
        Currency input = params.zeroForOne ? params.key.currency0 : params.key.currency1;
        Currency output = params.zeroForOne ? params.key.currency1 : params.key.currency0;

        if (isMultiPool) {
            // (1) Margin swap on the hook pool (for accounting / leverage accounting / position registration).
            delta = manager.swap(
                params.key,
                IPoolManager.SwapParams(params.zeroForOne, params.amountSpecified, _defaultSqrtPriceLimit(params.zeroForOne)),
                params.hookData
            );

            // (2) Settle the trader's margin (router's -margin delta from the swap)
            if (marginAmount > 0) {
                manager.sync(input);
                IERC20(Currency.unwrap(input)).transferFrom(trader, address(manager), marginAmount);
                manager.settle();
            }

            // (3) Swap the combined margin + borrow on the standard pool
            BalanceDelta deltaPhysical = manager.swap(
                params.standardPoolKey,
                IPoolManager.SwapParams(params.zeroForOne, -int256(marginAmount + borrowAmount), _defaultSqrtPriceLimit(params.zeroForOne)),
                ""
            );

            int128 outputDelta = params.zeroForOne ? deltaPhysical.amount1() : deltaPhysical.amount0();
            require(outputDelta > 0, "Swap output zero");
            outputAmount = uint256(int256(outputDelta));

            // Set standard pool key mapping on the hook
            IEswapHook(params.key.hooks).setStandardPoolKey(params.key.toId(), params.standardPoolKey);
        } else {
            // Legacy single-pool routing
            delta = manager.swap(
                params.key,
                IPoolManager.SwapParams(params.zeroForOne, params.amountSpecified, _defaultSqrtPriceLimit(params.zeroForOne)),
                params.hookData
            );

            int128 outputDelta = params.zeroForOne ? delta.amount1() : delta.amount0();
            require(outputDelta > 0, "Swap output zero");
            outputAmount = uint256(int256(outputDelta));

            if (marginAmount > 0) {
                manager.sync(input);
                IERC20(Currency.unwrap(input)).transferFrom(trader, address(manager), marginAmount);
                manager.settle();
            }
        }

        // (4) Mint the collateral as an ERC-6909 claim held by the hook.
        manager.mint(address(params.key.hooks), uint256(uint160(Currency.unwrap(output))), outputAmount);

        // (5) Settle the solver's borrow FOR THE HOOK: the hook flash-provided
        //     the borrow leg, so it carries a -borrowAmount transient delta that
        //     settleFor(hook) zeroes.
        if (borrowAmount > 0) {
            manager.sync(input);
            IERC20(Currency.unwrap(input)).transferFrom(params.solver, address(manager), borrowAmount);
            manager.settleFor(address(params.key.hooks));
        }

        // (6) Register the on-chain solver debt (principal + yield) guaranteeing
        //     solver repayment before trader withdrawal.
        if (borrowAmount > 0) {
            IEswapHook(params.key.hooks).registerSolverDebt(params.key.toId(), trader, params.solver, borrowAmount);
        }

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
