// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title V4DeepPoolVenue
 * @notice Reference `IExternalVenue` implementation that routes the unwind leg
 *         through a REAL Uniswap V4 pool via the live `PoolManager`.
 *
 * @dev This exists so the executor's atomic round trip can be exercised against
 *      genuine liquidity on a mainnet fork without mocking any ERC-20. It is a
 *      *measurement harness*, and it deliberately does not fake a price edge: the
 *      pool it swaps on is the same deep pool ESWAP itself routes through, so the
 *      round trip is structurally P&L-negative. That negative baseline is the
 *      honest reference the off-chain quoter is checked against.
 *
 *      Interaction shape
 *      -----------------
 *      The executor holds the recovered collateral, so this venue PULLS the input
 *      from `msg.sender` (ERC-20 via `transferFrom`, native via `call`) and
 *      delivers the output straight back to `msg.sender`. Keeping the input pull
 *      on the caller means the executor owns the approval lifecycle and can zero
 *      it in the same transaction.
 *
 *      Security notes:
 *        - `onlyOwner` on `swap`: the venue is invoked by the executor from inside
 *          the flash callback, so it must never be freely callable.
 *        - The swap runs inside its own `PoolManager.unlock` window. This contract
 *          is never reached from inside an ESWAP unlock, so there is no
 *          `AlreadyUnlocked` collision.
 *        - The input is `sync` + `settle`d against the manager's reserves, which
 *          is the canonical V4 router pattern and leaves every delta netted to
 *          zero before `unlock` returns.
 */

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta, BalanceDeltaLibrary} from "@uniswap/v4-core/src/types/BalanceDelta.sol";

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {IExternalVenue} from "./EswapArbitrageExecutor.sol";

contract V4DeepPoolVenue is IExternalVenue, IUnlockCallback, Ownable {
    using BalanceDeltaLibrary for BalanceDelta;
    using SafeERC20 for IERC20;

    IPoolManager public immutable manager;

    error BadCaller();
    error CurrencyMismatch();
    error BelowMinOut();
    error NativePullFailed();

    event VenueSwap(
        address indexed tokenIn, address indexed tokenOut, uint256 amountIn, uint256 amountOut, address indexed caller
    );

    constructor(IPoolManager _manager) Ownable(msg.sender) {
        manager = _manager;
    }

    /**
     * @notice Pull `amountIn` of `tokenIn` from the caller and swap it for `tokenOut`.
     * @param data abi.encode(PoolKey key) — the pool must contain `tokenIn`/`tokenOut`.
     */
    function swap(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut,
        bytes calldata data
    ) external onlyOwner returns (uint256 amountOut) {
        if (amountIn == 0) return 0;

        PoolKey memory key = abi.decode(data, (PoolKey));
        Currency c0 = key.currency0;
        Currency c1 = key.currency1;
        if (
            !(
                (Currency.unwrap(c0) == tokenIn && Currency.unwrap(c1) == tokenOut)
                    || (Currency.unwrap(c0) == tokenOut && Currency.unwrap(c1) == tokenIn)
            )
        ) revert CurrencyMismatch();

        // Pull the input into this contract so the unlock callback can settle it.
        if (tokenIn == address(0)) {
            (bool ok,) = payable(msg.sender).call{value: amountIn}("");
            if (!ok) revert NativePullFailed();
        } else {
            IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
        }

        manager.unlock(abi.encode(key, tokenIn, amountIn, minAmountOut, msg.sender));
    }

    /// @inheritdoc IUnlockCallback
    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(manager)) revert BadCaller();

        (PoolKey memory key, address tokenIn, uint256 amountIn, uint256 minAmountOut, address caller) =
            abi.decode(data, (PoolKey, address, uint256, uint256, address));

        bool zeroForOne = Currency.unwrap(key.currency0) == tokenIn;
        (Currency currencyIn, Currency currencyOut) =
            zeroForOne ? (key.currency0, key.currency1) : (key.currency1, key.currency0);

        // Pay the input. `sync` snapshots reserves; `settle` debits our transient
        // delta by the amount actually transferred in.
        manager.sync(currencyIn);
        if (currencyIn.isAddressZero()) {
            manager.settle{value: amountIn}();
        } else {
            IERC20(Currency.unwrap(currencyIn)).safeTransfer(address(manager), amountIn);
            manager.settle();
        }

        // Exact-input swap across the real pool.
        BalanceDelta delta = manager.swap(
            key,
            IPoolManager.SwapParams({zeroForOne: zeroForOne, amountSpecified: int256(amountIn), sqrtPriceLimitX96: 0}),
            ""
        );

        uint256 amountOut = uint256(int256(zeroForOne ? delta.amount1() : delta.amount0()));
        if (amountOut < minAmountOut) revert BelowMinOut();

        // Deliver the proceeds directly to the executor and close our delta.
        manager.take(currencyOut, caller, amountOut);

        emit VenueSwap(tokenIn, Currency.unwrap(currencyOut), amountIn, amountOut, caller);

        return abi.encode(amountOut);
    }

    /// @notice Recover anything the venue is holding. Should normally be zero
    ///         because the venue pulls and delivers in one call.
    function rescue(address token, address to, uint256 amount) external onlyOwner {
        if (token == address(0)) {
            (bool ok,) = payable(to).call{value: amount}("");
            require(ok, "ETH rescue failed");
        } else {
            IERC20(token).safeTransfer(to, amount);
        }
    }

    receive() external payable {}
}