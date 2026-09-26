// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IReactor, IValidationCallback, ResolvedOrder, SignedOrder, OutputToken} from "../../lib/uniswapx-interfaces/IReactor.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title EswapUniswapXSettlement
 * @notice Destination settler for UniswapX. Implements the genuine
 *         IValidationCallback from Uniswap/uniswapx and fills via
 *         IReactor.execute(SignedOrder).
 *
 * @dev Token flow follows BaseReactor._fill + CurrencyLibrary.transferFill:
 *        the reactor pulls the order input swapper -> this contract, then pulls
 *        the output this contract -> order recipient via
 *        safeTransferFrom(filler, recipient, amount). This contract is therefore
 *        the FILLER and must hold output inventory. The approval granted to the
 *        reactor is capped at maxFillAmount, and validate() independently bounds
 *        the order, so a malicious reactor cannot drain more than that cap.
 *
 *      validate() is attacker-reachable: additionalValidationContract is chosen
 *      by the swapper inside the signed order, so ANY order can name this
 *      contract. Every branch below is a security gate, not a formality:
 *        - msg.sender must be the immutable reactor (only the reactor resolves)
 *        - filler must be this contract (nobody else may consume our inventory)
 *        - input/output tokens are fixed at construction (fixed-price pairing)
 *        - exactly one output, bounded by maxFillAmount
 *        - recipient must be operator-set for the current fill
 *
 *      This is a plain swap settlement. It does NOT open a leveraged position:
 *      BaseReactor._fill requires literal output-token delivery to the recipient,
 *      which cannot represent an Eswap position. Eswap liquidity is exposed here
 *      as a fill source for UniswapX takers.
 */
contract EswapUniswapXSettlement is IValidationCallback, Ownable {
    using SafeERC20 for IERC20;

    IReactor public immutable reactor;
    IERC20 public immutable inputToken;
    IERC20 public immutable outputToken;
    uint256 public immutable maxFillAmount;

    address public operator;
    address public pendingRecipient;

    mapping(bytes32 => bool) public filledOrders;

    error NotReactor();
    error NotAuthorizedFiller();
    error DeadlineExpired();
    error UnsupportedInput();
    error UnsupportedOutput();
    error OutputCountMismatch();
    error OutputTooLarge();
    error UnauthorizedRecipient();
    error OrderAlreadyFilled();
    error ZeroAddress();

    event OrderFilled(bytes32 indexed orderHash, address indexed recipient, uint256 inputAmount, uint256 outputAmount);
    event RecipientSet(address indexed recipient);
    event OperatorSet(address indexed operator);

    constructor(IReactor _reactor, IERC20 _inputToken, IERC20 _outputToken, uint256 _maxFillAmount) Ownable(msg.sender) {
        if (address(_reactor) == address(0) || address(_inputToken) == address(0) || address(_outputToken) == address(0)) {
            revert ZeroAddress();
        }
        reactor = _reactor;
        inputToken = _inputToken;
        outputToken = _outputToken;
        maxFillAmount = _maxFillAmount;
        operator = msg.sender;
    }

    // ─── Admin ───────────────────────────────────────────────────────────

    function setOperator(address _operator) external onlyOwner {
        operator = _operator;
        emit OperatorSet(_operator);
    }

    function setPendingRecipient(address _recipient) external onlyOwner {
        pendingRecipient = _recipient;
        emit RecipientSet(_recipient);
    }

    // ─── Security gate: called by the reactor during order resolution ─────

    function validate(address filler, ResolvedOrder calldata resolvedOrder) external view override {
        if (msg.sender != address(reactor)) revert NotReactor();
        if (filler != address(this)) revert NotAuthorizedFiller();
        if (resolvedOrder.info.deadline < block.timestamp) revert DeadlineExpired();
        if (address(resolvedOrder.input.token) != address(inputToken)) revert UnsupportedInput();
        if (resolvedOrder.outputs.length != 1) revert OutputCountMismatch();

        OutputToken calldata output = resolvedOrder.outputs[0];
        if (output.token != address(outputToken)) revert UnsupportedOutput();
        if (output.amount > maxFillAmount) revert OutputTooLarge();
        if (output.recipient != pendingRecipient) revert UnauthorizedRecipient();
    }

    // ─── Fill ─────────────────────────────────────────────────────────────

    /**
     * @notice Fill a UniswapX order. Pulls output inventory to the order
     *         recipient through the reactor's own transferFill accounting.
     * @param order Reactor-encoded order and swapper signature.
     *
     * @dev The replay key is derived from the signed payload itself, not supplied
     *      by the caller. SignedOrder.order is opaque reactor-encoded bytes, so the
     *      canonical protocol hash is not computable here; hashing (order, sig)
     *      is still tamper-evident, meaning the same signed order can never be
     *      replayed under a fresh key. A caller-chosen hash would allow exactly
     *      that, re-filling one signed order indefinitely.
     */
    function fill(SignedOrder calldata order) external payable {
        if (msg.sender != operator) revert NotAuthorizedFiller();

        bytes32 orderHash = keccak256(abi.encodePacked(order.order, order.sig));
        if (filledOrders[orderHash]) revert OrderAlreadyFilled();
        filledOrders[orderHash] = true;

        // Cap the reactor's allowance. validate() independently enforces the
        // same bound, so a compromised reactor cannot exceed maxFillAmount.
        outputToken.forceApprove(address(reactor), maxFillAmount);

        uint256 inputBefore = inputToken.balanceOf(address(this));
        uint256 outputBefore = outputToken.balanceOf(address(this));
        reactor.execute{value: msg.value}(order);
        uint256 received = inputToken.balanceOf(address(this)) - inputBefore;
        uint256 sent = outputBefore - outputToken.balanceOf(address(this));

        emit OrderFilled(orderHash, pendingRecipient, received, sent);
    }

    function rescueToken(address token, address to, uint256 amount) external onlyOwner {
        IERC20(token).safeTransfer(to, amount);
    }
}
