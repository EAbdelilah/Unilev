// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title UniswapV3Venue
 * @notice `IExternalVenue` that unwinds into an INDEPENDENT Uniswap V3 pool.
 *
 * @dev Why this contract exists
 * ---------------------------
 * The round trip's economics are decided entirely by the unwind leg. The open
 * fills through ESWAP's own deep V4 pool, so unwinding through that same pool
 * means buying back at the price you just sold at, less fees — a wash trade by
 * construction that no amount of quoting can make profitable. `V4DeepPoolVenue`
 * does exactly that on purpose, as a measurement baseline.
 *
 * This venue is the other option: a different pool, on a different AMM, with its
 * own liquidity and its own pricing. That is the only shape in which an atomic
 * open/close/unwind can ever clear its cost floor.
 *
 *      Native collateral handling
 *      -------------------------
 * ESWAP's collateral on this market is NATIVE ETH, but V3 pools hold WETH. The
 * venue therefore wraps the incoming ETH, swaps WETH -> tokenOut, and leaves the
 * proceeds as an ERC-20. Wrapping is exact and 1:1, so it introduces no pricing
 * assumption — it only changes the representation.
 *
 *      Input is PULLED, never pushed
 *      ----------------------------
 * `swap` pulls `amountIn` from `msg.sender` (ERC-20 `transferFrom`, native via
 * `call`). The executor approves ERC-20s and sends native value; it does not
 * pre-fund. This matches the ERC-20 branch and keeps a single ownership rule for
 * the input, so the venue can never be handed funds it did not ask for.
 *
 *      Pool authenticity
 *      -----------------
 * The pool is resolved from the canonical factory for the requested fee tier
 * rather than supplied by the caller. A caller-supplied pool address would let a
 * stale or malicious contract stand in for the venue and dictate the price; here
 * `getPool` is the only source, so the venue always trades the real pool.
 *
 *      Security notes
 *      --------------
 *        - `onlyOwner` on `swap`: invoked by the executor from inside the flash
 *          callback, so it must never be freely callable.
 *        - The swap callback authenticates `msg.sender` against the resolved
 *          pool. Without it, anyone could invoke the callback and make the venue
 *          pay out its own balance.
 *        - `amountOut` is measured as the caller's balance DELTA, not read from
 *          the pool's return values, so a pool that under-delivers cannot make
 *          the venue report a larger output than actually arrived.
 */

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {IExternalVenue} from "./EswapArbitrageExecutor.sol";
import {IUniswapV3Factory, IUniswapV3Pool, IUniswapV3SwapCallback} from "./interfaces/IUniswapV3.sol";
import {IWETH9} from "../src/interfaces/IWETH9.sol";

contract UniswapV3Venue is IExternalVenue, IUniswapV3SwapCallback, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice Canonical factory used to resolve pools.
    IUniswapV3Factory public immutable factory;
    /// @notice Canonical WETH, used to wrap native collateral.
    IWETH9 public immutable weth;

    /**
     * @dev The pool this contract is currently swapping against, set immediately
     *      before the pool call and cleared immediately after.
     *
     *      The callback needs to know which pool is entitled to ask for payment.
     *      Re-deriving it inside the callback is not possible — the callback only
     *      receives the two deltas and opaque data, not the token pair or fee tier
     *      — so it is recorded here instead. `nonReentrant` guarantees this
     *      cannot be clobbered by a nested swap, and it is cleared on the way out
     *      so a stale value can never authorise a later call.
     */
    address private _activePool;

    error BadCallbackCaller();
    error InsufficientOutput();
    error NativePullFailed();
    error PoolNotFound();
    error TokenMismatch();

    event VenueSwap(
        address indexed tokenIn,
        address indexed tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        uint24 indexed feeTier,
        address pool,
        address caller
    );

    constructor(address factory_, address weth_) Ownable(msg.sender) {
        if (factory_ == address(0) || weth_ == address(0)) revert PoolNotFound();
        factory = IUniswapV3Factory(factory_);
        weth = IWETH9(weth_);
    }

    /**
     * @notice Pull `amountIn` of `tokenIn` from the caller and swap it into `tokenOut`.
     * @param tokenIn    Native ETH (`address(0)`) or an ERC-20.
     * @param tokenOut   ERC-20 output token. Never native: the proceeds stay an
     *                  ERC-20 so the executor's flash repayment is a plain
     *                  `transfer`.
     * @param minAmountOut Floor in `tokenOut` base units, enforced before delivery.
     * @param data       `abi.encode(uint24 feeTier, uint160 sqrtPriceLimitX96)`.
     *                  A zero `sqrtPriceLimitX96` means "no limit", which is the
     *                  normal choice for an exact-input swap already floored by
     *                  `minAmountOut`; a non-zero value caps the price move.
     */
    function swap(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut,
        bytes calldata data
    ) external onlyOwner nonReentrant returns (uint256 amountOut) {
        if (amountIn == 0) return 0;
        if (tokenOut == address(0)) revert TokenMismatch();

        (uint24 feeTier, uint160 sqrtPriceLimitX96) = abi.decode(data, (uint24, uint160));

        // Native collateral is traded as WETH; everything else is itself.
        address v3TokenIn = tokenIn == address(0) ? address(weth) : tokenIn;

        // Resolve the pool from the canonical factory. This is the only place a
        // pool address can come from.
        address pool = factory.getPool(v3TokenIn, tokenOut, feeTier);
        if (pool == address(0)) revert PoolNotFound();

        // Cross-check the resolved pool really is the pair we think it is, and
        // that it charges the tier we asked for. The factory is trusted, but a
        // mismatch would route the swap into an unrelated market or a different
        // fee pool and produce a completely fictional price.
        IUniswapV3Pool v3Pool = IUniswapV3Pool(pool);
        if (v3Pool.token0() != _lower(v3TokenIn, tokenOut) || v3Pool.token1() != _higher(v3TokenIn, tokenOut)) {
            revert TokenMismatch();
        }
        if (v3Pool.fee() != feeTier) revert TokenMismatch();

        // Pull the input.
        if (tokenIn == address(0)) {
            (bool ok,) = payable(msg.sender).call{value: amountIn}("");
            if (!ok) revert NativePullFailed();
            weth.deposit{value: amountIn}();
        } else {
            IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
        }

        uint256 outBefore = IERC20(tokenOut).balanceOf(address(this));

        _activePool = pool;
        v3Pool.swap(
            address(this),
            v3TokenIn < tokenOut, // zeroForOne follows the sorted token order
            int256(amountIn), // positive == exact input
            sqrtPriceLimitX96,
            abi.encode(v3TokenIn)
        );
        _activePool = address(0);

        // Measure what actually arrived rather than trusting the pool's return
        // values, so the reported output can never exceed the real balance.
        uint256 received = IERC20(tokenOut).balanceOf(address(this)) - outBefore;
        if (received < minAmountOut) revert InsufficientOutput();

        // Deliver proceeds to the executor.
        IERC20(tokenOut).safeTransfer(msg.sender, received);

        emit VenueSwap(tokenIn, tokenOut, amountIn, received, feeTier, pool, msg.sender);

        return received;
    }

    /// @inheritdoc IUniswapV3SwapCallback
    /// @dev Pays the pool the input token it is owed.
    ///
    ///      `msg.sender` must be the pool this contract is currently swapping
    ///      against. Without that check, anyone could invoke the callback and
    ///      make the venue pay its whole balance into a pool they choose — the
    ///      callback is not permissioned by the pool itself.
    function uniswapV3SwapCallback(int256 amount0Delta, int256 amount1Delta, bytes calldata data) external {
        if (msg.sender == address(0) || msg.sender != _activePool) revert BadCallbackCaller();

        // Exactly one of the two deltas is positive: that is what we owe.
        uint256 owed = amount0Delta > 0 ? uint256(amount0Delta) : uint256(amount1Delta);
        if (owed == 0) return;

        IERC20(abi.decode(data, (address))).safeTransfer(msg.sender, owed);
    }

    /// @notice Recover stray tokens. Should normally be zero: the venue wraps,
    ///         swaps and delivers within one call.
    function rescue(address token, address to, uint256 amount) external onlyOwner {
        if (token == address(0)) {
            (bool ok,) = payable(to).call{value: amount}("");
            if (!ok) revert NativePullFailed();
        } else {
            IERC20(token).safeTransfer(to, amount);
        }
    }

    /// @dev The lower of two addresses, which is `token0` in V3's sorted order.
    function _lower(address a, address b) private pure returns (address) {
        return a < b ? a : b;
    }

    /// @dev The higher of two addresses, which is `token1` in V3's sorted order.
    function _higher(address a, address b) private pure returns (address) {
        return a < b ? b : a;
    }

    receive() external payable {}
}