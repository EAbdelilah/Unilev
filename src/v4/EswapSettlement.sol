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
 *      IMPORTANT: Positions are registered under `address(this)` (the settlement).
 *      After fill(), the settlement holds the position. The recipient can later call
 *      closePosition() to settle and receive proceeds, OR the settlement owner can
 *      call closePositionFor() on behalf of any recipient.
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
    error NoProceeds();

    event PositionFilled(
        bytes32 indexed orderId, address indexed recipient, address indexed tokenIn, uint256 marginAmount
    );
    event PositionClosed(address indexed trader, uint256 payout);
    event ProceedsClaimed(address indexed recipient, address indexed token, uint256 amount);

    // M-3: orderId replay protection
    mapping(bytes32 => bool) public filledOrders;

    // H-6: Authorized close callers (settlement owner + designated executors)
    mapping(address => bool) public closeExecutors;

    // C-1 FIX: Track close proceeds per recipient per token so they can be claimed
    mapping(address => mapping(address => uint256)) public claimableProceeds;

    constructor(EswapRouter _router) Ownable(msg.sender) {
        router = _router;
    }

    // ─── Admin ──────────────────────────────────────────────────────────

    function setCloseExecutor(address executor, bool approved) external onlyOwner {
        closeExecutors[executor] = approved;
    }

    // ─── ERC-7683 Destination Settler ───────────────────────────────────

    /**
     * @notice Fill a cross-chain order on the destination chain.
     * @param orderId   Unique order identifier from the origin chain event.
     * @param originData  ABI-encoded SwapParams from the origin chain order.
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
            bytes memory hookData
        ) = abi.decode(originData, (PoolKey, PoolKey, bool, int256, uint8, address, bytes));

        (,, address recipient) = abi.decode(hookData, (bool, uint8, address));

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
            hookData: abi.encode(true, leverage, address(this))
        });

        router.swapMultiPoolFor(params, address(this));

        emit PositionFilled(orderId, recipient, inputToken, marginAmount);
    }

    // ─── Position Management ────────────────────────────────────────────

    /**
     * @notice Close a position opened by this settlement contract.
     * @dev Can be called by the recipient (msg.sender == recipient) or by an
     *      authorized close executor (owner or designated bots).
     *      Proceeds are credited to the recipient's claimable balance and can
     *      be withdrawn via claimProceeds().
     * @param key           Pool key of the position
     * @param recipient     The address that should receive the close proceeds
     * @param solver        The solver who backed the position
     * @param minAmountOut  Slippage protection
     */
    function closePosition(
        PoolKey calldata key,
        address recipient,
        address solver,
        uint256 minAmountOut
    ) external {
        require(
            msg.sender == recipient || closeExecutors[msg.sender] || msg.sender == owner(),
            "Not authorized to close"
        );
        require(recipient != address(0), "Invalid recipient");

        // C-1 FIX: Measure balance delta to credit proceeds to recipient
        address c0 = Currency.unwrap(key.currency0);
        address c1 = Currency.unwrap(key.currency1);
        uint256 bal0Before = IERC20(c0).balanceOf(address(this));
        uint256 bal1Before = IERC20(c1).balanceOf(address(this));

        router.closePosition(key.hooks, key, address(this), solver, minAmountOut);

        uint256 bal0After = IERC20(c0).balanceOf(address(this));
        uint256 bal1After = IERC20(c1).balanceOf(address(this));

        if (bal0After > bal0Before) {
            uint256 delta = bal0After - bal0Before;
            claimableProceeds[recipient][c0] += delta;
            emit ProceedsClaimed(recipient, c0, delta);
        }
        if (bal1After > bal1Before) {
            uint256 delta = bal1After - bal1Before;
            claimableProceeds[recipient][c1] += delta;
            emit ProceedsClaimed(recipient, c1, delta);
        }

        emit PositionClosed(recipient, 0);
    }

    /**
     * @notice Claim accumulated close proceeds for a given token.
     * @param token  The ERC-20 token to withdraw
     */
    function claimProceeds(address token) external {
        uint256 amount = claimableProceeds[msg.sender][token];
        if (amount == 0) revert NoProceeds();
        claimableProceeds[msg.sender][token] = 0;
        IERC20(token).safeTransfer(msg.sender, amount);
    }

    /**
     * @notice Emergency withdrawal of ERC-20 tokens NOT related to open positions.
     * @dev Only for tokens that are NOT the position collateral/debt currencies.
     */
    function rescueToken(address token, address to, uint256 amount) external onlyOwner {
        IERC20(token).safeTransfer(to, amount);
    }
}
