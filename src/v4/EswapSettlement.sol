// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {EswapRouter} from "./EswapRouter.sol";
import {PoolKey} from "./types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "./types/PoolId.sol";
import {Currency} from "./types/Currency.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {NativeTokens} from "./libraries/NativeTokens.sol";
import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";

/// @dev Minimal read-only view of the hook's solver registry. A non-zero answer
///      proves the position is still OPEN: the entry is written at open and
///      deleted when the position is settled.
interface IEswapPositionState {
    function positionSolver(bytes32 poolId, address trader) external view returns (address);
    function positionEpoch(bytes32 poolId, address trader) external view returns (uint256);
}

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
    using PoolIdLibrary for PoolKey;

    EswapRouter public immutable router;

error ZeroAddress();
    error OrderAlreadyFilled();
    error CloseFailed();
    error InvalidNotional();

    event PositionFilled(
        bytes32 indexed orderId, address indexed recipient, address indexed tokenIn, uint256 marginAmount
    );

    /// @notice Emitted when a filler recovers the borrow leg a closed position
    ///         returned to this settlement.
    event RepaymentClaimed(
        bytes32 indexed orderId, address indexed filler, address indexed token, uint256 amount
    );

    error NotFiller();
    error NothingToClaim();
    error PositionStillOpen();

    // M-3: orderId replay protection
    mapping(bytes32 => bool) public filledOrders;

    // H-4: orderId → credited recipient (on-chain lookup after a bridge fill)
    mapping(bytes32 => address) public filledRecipient;

    // [AUDIT CRIT-ACT-02] The filler that bridged the notional is the economic
    // owner of the BORROW leg: it is registered as the position's solver, so a
    // close returns `principal + yield` to THIS contract. Without a per-order
    // ledger that money was unattributable and only the owner could move it via
    // `rescueToken`. Record who funded each order, in which token, and how much
    // principal they are owed, so any filler can pull its own repayment.
    //
    // [AUDIT NEW-CRIT-01] Paying purely out of `balanceOf(this)` let a filler
    // claim BEFORE its own position closed, spending another filler's repayment
    // (which is already sitting here after THAT position closed). Repayment is
    // therefore gated on the position actually being closed, which requires
    // remembering where it lives.
    mapping(bytes32 => address) public orderFiller;
    mapping(bytes32 => address) public fillerToken;
    mapping(bytes32 => uint256) public fillerPrincipal;
    mapping(bytes32 => address) public orderHook;
    mapping(bytes32 => bytes32) public orderPoolId;
    mapping(bytes32 => address) public orderRecipient;
    // [LIVENESS] The hook's position epoch for (pool, recipient) right after this
    // order opened. A later epoch means the order's position has since closed.
    mapping(bytes32 => uint256) public orderEpoch;

    // [AUDIT F-04] Aggregate principal owed per repayment token. `_settle` pays
    // the settlement as a single `positionSolver`, so every order's borrow-leg
    // repayment lands in ONE balance with no per-order attribution; the only cap
    // on a claim used to be `balanceOf(this)`, which let the first claimer take
    // another filler's repayment whole. Claims are now capped pro-rata:
    // `principal * balance / totalOwed`, and the shortfall is shared instead of
    // being absorbed by whoever claims last. Order-independent by construction.
    mapping(address => uint256) public totalPrincipalOwed;

    error RescueExceedsSurplus(uint256 requested, uint256 surplus);

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
        payable
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
        Currency inputCurrency = zeroForOne ? key.currency0 : key.currency1;
        address inputToken = Currency.unwrap(inputCurrency);

        // [AUDIT MED-05] A native-ETH order leg must not hit the ERC-20 pull
        // path (SafeERC20 on address(0x0) always reverts, bricking bridge fills
        // for native pairs). Native cannot be transferFrom'd, so the filler
        // funds it via msg.value exactly equal to the notional; ERC-20 legs
        // keep the transferFrom pull.
        bool native = NativeTokens.isNative(inputCurrency);
        if (native) {
            if (msg.value != notional) revert InvalidNotional();
        } else {
            IERC20(inputToken).safeTransferFrom(msg.sender, address(this), notional);
            IERC20(inputToken).forceApprove(address(router), notional);
        }

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
        // Fund the borrow leg through this settlement's own borrow escrow (ERC-20)
        // or native borrow escrow (native), so the router's solver-authorization
        // check passes and the borrow is drawn from capital the filler bridged.
        // The margin leg follows: ERC-20 margin is pulled from this contract's
        // approval (notional - borrow), native margin is forwarded as msg.value.
        if (native) {
            if (borrowAmount > 0) router.depositNativeBorrow{value: borrowAmount}(address(this));
            router.swapMultiPoolForSolverFunded{value: marginAmount}(params, recipient, address(this));
        } else {
            if (borrowAmount > 0) router.depositBorrowEscrow(inputToken, borrowAmount);
            router.swapMultiPoolForSolverFunded(params, recipient, address(this));
        }

        // The router consumed `marginAmount` of the `notional` approval; the
        // borrow leg went in through the escrow above. Clear the residual so no
        // standing allowance to the router survives the fill.
        if (!native) IERC20(inputToken).forceApprove(address(router), 0);

        filledRecipient[orderId] = recipient;
        orderFiller[orderId] = msg.sender;
        fillerToken[orderId] = inputToken;
        fillerPrincipal[orderId] = borrowAmount;
        orderHook[orderId] = address(key.hooks);
        orderPoolId[orderId] = PoolId.unwrap(key.toId());
        orderRecipient[orderId] = recipient;
        orderEpoch[orderId] = IEswapPositionState(address(key.hooks)).positionEpoch(PoolId.unwrap(key.toId()), recipient);
        // [AUDIT F-04] Track the aggregate claimable principal for this token so
        // claims can be proportionally capped against what has actually arrived.
        totalPrincipalOwed[inputToken] += borrowAmount;
        emit PositionFilled(orderId, recipient, inputToken, marginAmount);
    }

    /**
     * @notice Claim the borrow-leg principal that a closed position returned to
     *         this settlement.
     * @dev The filler fronts `notional` and is the position's `positionSolver`,
     *      so `close`/`liquidation` pays `borrowAmount + yield` back here. This
     *      lets the FILLER (not just the owner) recover its principal without
     *      touching any other order's funds.
     *
     *      [AUDIT NEW-CRIT-01] The position MUST be closed before anything is
     *      paid out. Previously the only check was this contract's aggregate
     *      balance, so a filler whose position was still open could claim the
     *      repayment that ANOTHER filler's already-closed position had parked
     *      here, leaving the honest filler with nothing. The hook's
     *      `positionSolver[poolId][recipient]` entry is set at open and deleted
     *      at settlement, so a non-zero value proves the position is live.
     *
     *      The payout is capped PRO-RATA, not at the aggregate balance: with an
     *      uncovered liquidation shortfall the settlement holds less than it
     *      owes, and the cap is `principal * balance / totalOwed`, so every
     *      filler absorbs the same fraction of the loss regardless of the order
     *      in which claims are made. [AUDIT F-04]
     */
    function claimRepayment(bytes32 orderId) external returns (uint256 amount) {
        address filler = orderFiller[orderId];
        if (filler == address(0) || msg.sender != filler) revert NotFiller();
        uint256 principal = fillerPrincipal[orderId];
        if (principal == 0) revert NothingToClaim();
        if (_positionStillOpen(orderId)) revert PositionStillOpen();

        fillerPrincipal[orderId] = 0;
        address token = fillerToken[orderId];

        // [AUDIT F-04] Pro-rata cap across every still-unclaimed order in this
        // token. In the healthy case `available >= owed`, the pro-rata share is
        // >= principal and the claim is paid in full.
        uint256 owed = totalPrincipalOwed[token];
        if (owed == 0) revert NothingToClaim();
        uint256 available = NativeTokens.balanceOf(Currency.wrap(token), address(this));
        amount = FullMath.mulDiv(principal, available, owed);
        if (amount > principal) amount = principal;
        if (amount == 0) revert NothingToClaim();
        totalPrincipalOwed[token] = owed - principal;

        if (token == address(0)) {
            NativeTokens.transfer(Currency.wrap(address(0)), filler, amount);
        } else {
            IERC20(token).safeTransfer(filler, amount);
        }
        emit RepaymentClaimed(orderId, filler, token, amount);
    }

    /// @dev True while the hook still records a solver for the order's position.
    ///      Fails CLOSED: a hook that cannot answer is treated as "still open" so
    ///      an unverifiable order can never release funds.
    function _positionStillOpen(bytes32 orderId) internal view returns (bool) {
        address hook = orderHook[orderId];
        if (hook == address(0) || hook.code.length == 0) return true;
        bytes32 poolId = orderPoolId[orderId];
        address trader = orderRecipient[orderId];
        // A later open for the same (pool, trader) can only happen after this
        // order's position closed, so an advanced epoch proves it is no longer open.
        // This is what lets an earlier order claim even when the trader has since
        // reopened the same pool.
        try IEswapPositionState(hook).positionEpoch(poolId, trader) returns (uint256 epoch) {
            if (epoch != orderEpoch[orderId]) return false;
        } catch {
            return true;
        }
        try IEswapPositionState(hook).positionSolver(poolId, trader) returns (address solver) {
            return solver != address(0);
        } catch {
            return true;
        }
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
     *      [AUDIT F-04] Also bounded by the surplus above outstanding filler
     *      principal: the owner must never be able to sweep a repayment that a
     *      filler is still owed.
     */
    function rescueToken(address token, address to, uint256 amount) external onlyOwner {
        uint256 owed = totalPrincipalOwed[token];
        uint256 bal = IERC20(token).balanceOf(address(this));
        uint256 surplus = bal > owed ? bal - owed : 0;
        if (amount > surplus) revert RescueExceedsSurplus(amount, surplus);
        IERC20(token).safeTransfer(to, amount);
    }
}
