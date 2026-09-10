// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {EswapRouter} from "./EswapRouter.sol";
import {PoolKey} from "./types/PoolKey.sol";
import {Currency} from "./types/Currency.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title EswapSettlement
 * @notice ERC-7683 destination settlement contract for cross-chain leveraged position opens.
 *         Fills on the DESTINATION chain: the filler bridges margin+borrow tokens to
 *         this contract, which then opens a leveraged position via the EswapRouter.
 *
* @dev ERC-7683 flow:
 *        Origin chain:  User signs CrossChainOrder → resolver translates for solvers
 *        Bridge:        Filler bridges margin+borrow tokens to destination chain
 *        Destination:   Filler calls settlement.fill() → pulls tokens, opens position
 *
 *      [FIX H-4] Positions are credited DIRECTLY to the order recipient (the
 *      swapper recovered from hookData), NOT to this settlement. The settlement
 *      acts only as the filler-side solver + margin funder for the router's
 *      solver-funded multi-pool open; the recipient owns the position claim from
 *      the first block. The recipient closes it exactly like any other position
 *      via EswapRouter.closePosition(...) — the router's C-1 rule demands the
 *      trader be the direct caller — and the hook pays close proceeds straight
 *      to the recipient's wallet.
 *
 *      IDestinationSettler interface (ERC-7683):
 *        fill(bytes32 orderId, bytes calldata originData, bytes calldata fillerData)
 */
contract EswapSettlement is Ownable {
    using SafeERC20 for IERC20;

    EswapRouter public immutable router;

error ZeroAddress();
    error OrderAlreadyFilled();
    error CloseFailed();

    event PositionFilled(
        bytes32 indexed orderId, address indexed recipient, address indexed tokenIn, uint256 marginAmount
    );

    // M-3: orderId replay protection
    mapping(bytes32 => bool) public filledOrders;

    // H-4: orderId → credited recipient (on-chain lookup after a bridge fill)
    mapping(bytes32 => address) public filledRecipient;

    constructor(EswapRouter _router) Ownable(msg.sender) {
        router = _router;
    }

// ─── Admin ──────────────────────────────────────────────────────────

    // ─── ERC-7683 Destination Settler ───────────────────────────────────

/**
     * @notice Fill a cross-chain order on the destination chain.
     * @param orderId   Unique order identifier from the origin chain event.
     * @param originData  ABI-encoded SwapParams from the origin chain order:
     *                    (PoolKey key, PoolKey standardPoolKey, bool zeroForOne,
     *                     int256 amountSpecified, uint8 leverage, address solver,
     *                     bytes hookData, uint256 minAmountOut).
     *                    The solver address in originData is overwritten with address(this).
     */
    function fill(
        bytes32 orderId,
        bytes calldata originData,
        bytes calldata /* fillerData */
    )
        external
    {
        // M-3 FIX: Prevent duplicate fills
        if (filledOrders[orderId]) revert OrderAlreadyFilled();
        filledOrders[orderId] = true;

(
            PoolKey memory key,
            PoolKey memory standardPoolKey,
            bool zeroForOne,
            int256 amountSpecified,
            uint8 leverage,,
            bytes memory hookData,
            // [FIX H-3] Origin orders now carry an explicit output floor
            // (appended after hookData). It is forwarded into the router's
            // SwapParams and enforced inside the swap callback
            // (SwapOutputBelowMinimum), so a sandwiched fill reverts instead of
            // opening the position at a manipulated price.
            uint256 minAmountOut
        ) = abi.decode(originData, (PoolKey, PoolKey, bool, int256, uint8, address, bytes, uint256));

(,, address recipient) = abi.decode(hookData, (bool, uint8, address));
        // [FIX H-4] Never open a position under the zero address.
        if (recipient == address(0)) revert ZeroAddress();

        uint256 marginAmount = uint256(amountSpecified < 0 ? -amountSpecified : amountSpecified);
        uint256 borrowAmount = marginAmount * uint256(leverage - 1);
        uint256 notional = marginAmount + borrowAmount;
        address inputToken = zeroForOne ? Currency.unwrap(key.currency0) : Currency.unwrap(key.currency1);

        IERC20(inputToken).safeTransferFrom(msg.sender, address(this), notional);

        IERC20(inputToken).forceApprove(address(router), notional);

        EswapRouter.SwapParams memory params = EswapRouter.SwapParams({
            key: key,
            standardPoolKey: standardPoolKey,
            zeroForOne: zeroForOne,
            amountSpecified: amountSpecified,
            leverage: leverage,
            solver: address(this),
            hookData: abi.encode(true, leverage, recipient),
            deadline: block.timestamp + router.DEFAULT_DEADLINE_SLACK(),
            minAmountOut: minAmountOut
        });

        // [FIX H-4] Solver-funded multi-pool open: the position is credited to
        // `recipient` while BOTH legs (margin + borrow) are pulled from this
        // settlement, which already holds the filler-bridged notional. The
        // recipient never has to approve the router.
        router.swapMultiPoolForSolverFunded(params, recipient, address(this));

        filledRecipient[orderId] = recipient;
        emit PositionFilled(orderId, recipient, inputToken, marginAmount);
    }

// ─── Position Management ────────────────────────────────────────────

    // [FIX H-4] The settlement never owns positions, so it exposes no close()
    // here. After fill(), the RECIPIENT owns the position and closes it exactly
    // like any other position: EswapRouter.closePosition(hook, key, recipient,
    // solver, minAmountOut) — the router's C-1 rule requires the trader to be
    // the direct caller, and close proceeds pay the recipient directly from the
    // hook.

    /**
     * @notice Emergency withdrawal of ERC-20 tokens NOT related to open positions.
     * @dev Only for tokens that are NOT the position collateral/debt currencies.
     */
    function rescueToken(address token, address to, uint256 amount) external onlyOwner {
        IERC20(token).safeTransfer(to, amount);
    }
}
