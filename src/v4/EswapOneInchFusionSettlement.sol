// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IOrderMixin, IPostInteraction, TakerTraits, TakerTraitsLib} from "../../lib/limit-order-protocol/IOrderMixin.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title EswapOneInchFusionSettlement
 * @notice Classic 1inch Fusion destination settler. Fills genuine Limit Order
 *         Protocol orders via IOrderMixin.fillOrderArgs and implements
 *         IPostInteraction.postInteraction.
 *
 * @dev Classic Fusion token flow: the LOP pulls makerAsset maker -> taker (this
 *      contract) and pushes takerAsset this contract -> order.receiver, then
 *      calls postInteraction. This contract is the TAKER and therefore must hold
 *      takerAsset inventory.
 *
 *      WHO RECEIVES THE CALLBACK: OrderMixin reads the listener address from
 *      extension.postInteractionTargetAndData() when the order's makerTraits
 *      carries the needPostInteractionCall flag. That extension is covered by
 *      the maker's signature, so a settler CANNOT inject itself: the maker must
 *      name this contract in the extension it signs. This contract is therefore
 *      only ever invoked by makers that deliberately opted in.
 *
 *      ARGS PACKING: IOrderMixin._parseArgs slices args as
 *      [target:20 if argsHasTarget][extension:argsExtensionLength]
 *      [interaction:argsInteractionLength]. Rather than accept a hand-packed
 *      blob from the operator, fill() rebuilds args from the extension and
 *      interaction and asserts the declared lengths agree, so a mis-encoded blob
 *      cannot be constructed.
 *
 *      FAIL-CLOSED: if the extension does not name this contract the LOP calls
 *      order.maker as the listener, our callback never fires, and fill() reverts
 *      on PostInteractionNotFired. A wrong extension can never settle.
 *
 *      postInteraction is attacker-reachable by any maker whose order names this
 *      contract as the interaction target, so the gates matter:
 *        - msg.sender must be the immutable LOP
 *        - taker must be this contract
 *        - the order must match a fill this contract initiated
 */
contract EswapOneInchFusionSettlement is IPostInteraction, Ownable {
    using SafeERC20 for IERC20;

    IOrderMixin public immutable lop;
    IERC20 public immutable makerAsset;
    IERC20 public immutable takerAsset;
    uint256 public immutable maxFillAmount;

    address public operator;

    struct PendingFill {
        address recipient;
        bool initiated;
        bool fulfilled;
    }

    mapping(bytes32 => PendingFill) public pendingFills;

    error NotLOP();
    error NotTaker();
    error NotOperator();
    error OrderNotInitiated();
    error PostInteractionNotFired();
    error OrderAlreadyFulfilled();
    error AmountTooLarge();
    error ZeroAddress();
    error WrongAsset();
    error WrongReceiver();
    error UnexpectedArgsTarget();
    error ExtensionLengthMismatch();
    error InteractionLengthMismatch();

    event OrderFilled(bytes32 indexed orderHash, address indexed recipient, uint256 makingAmount, uint256 takingAmount);
    event OperatorSet(address indexed operator);

    constructor(IOrderMixin _lop, IERC20 _makerAsset, IERC20 _takerAsset, uint256 _maxFillAmount) Ownable(msg.sender) {
        if (address(_lop) == address(0) || address(_makerAsset) == address(0) || address(_takerAsset) == address(0)) {
            revert ZeroAddress();
        }
        lop = _lop;
        makerAsset = _makerAsset;
        takerAsset = _takerAsset;
        maxFillAmount = _maxFillAmount;
        operator = msg.sender;
    }

    // --- Admin ---

    function setOperator(address _operator) external onlyOwner {
        operator = _operator;
        emit OperatorSet(_operator);
    }

    // --- Fill ---

    /**
     * @notice Fill a 1inch Limit Order Protocol order as taker.
     * @param order The maker-signed order.
     * @param r Signature r component.
     * @param vs Signature vs component; commits to the extension.
     * @param amount Making amount to fill.
     * @param takerTraits Taker preferences. Its declared args lengths must match
     *                   the extension and interaction passed here.
     * @param extension The maker-signed extension. Must carry a
     *                  postInteractionTargetAndData naming this contract.
     * @param interaction Optional taker interaction calldata.
     * @param recipient Must equal order.receiver, the address the LOP actually
     *                  pays, so OrderFilled cannot misreport the destination.
     */
    function fill(
        IOrderMixin.Order calldata order,
        bytes32 r,
        bytes32 vs,
        uint256 amount,
        TakerTraits takerTraits,
        bytes calldata extension,
        bytes calldata interaction,
        address recipient
    ) external {
        if (msg.sender != operator) revert NotOperator();
        if (order.makerAsset != address(makerAsset) || order.takerAsset != address(takerAsset)) revert WrongAsset();
        if (order.makingAmount > maxFillAmount || amount > maxFillAmount) revert AmountTooLarge();
        if (recipient == address(0)) revert ZeroAddress();
        if (order.receiver != recipient) revert WrongReceiver();

        if (TakerTraitsLib.argsHasTarget(takerTraits)) revert UnexpectedArgsTarget();
        if (TakerTraitsLib.argsExtensionLength(takerTraits) != extension.length) revert ExtensionLengthMismatch();
        if (TakerTraitsLib.argsInteractionLength(takerTraits) != interaction.length) revert InteractionLengthMismatch();

        bytes memory args;
        if (extension.length == 0) {
            args = interaction;
        } else if (interaction.length == 0) {
            args = extension;
        } else {
            args = abi.encodePacked(extension, interaction);
        }

        pendingFills[lop.hashOrder(order)] = PendingFill({recipient: recipient, initiated: true, fulfilled: false});

        takerAsset.forceApprove(address(lop), maxFillAmount);

        (uint256 makingAmount, uint256 takingAmount, bytes32 orderHash) =
            lop.fillOrderArgs(order, r, vs, amount, takerTraits, args);

        if (!pendingFills[orderHash].fulfilled) revert PostInteractionNotFired();
        if (takingAmount > maxFillAmount) revert AmountTooLarge();

        emit OrderFilled(orderHash, recipient, makingAmount, takingAmount);
    }

    // --- IPostInteraction callback ---

    function postInteraction(
        IOrderMixin.Order calldata order,
        bytes calldata,
        bytes32 orderHash,
        address taker,
        uint256 makingAmount,
        uint256 takingAmount,
        uint256,
        bytes calldata
    ) external override {
        if (msg.sender != address(lop)) revert NotLOP();
        if (taker != address(this)) revert NotTaker();

        PendingFill storage pf = pendingFills[orderHash];
        if (!pf.initiated) revert OrderNotInitiated();
        if (pf.fulfilled) revert OrderAlreadyFulfilled();
        pf.fulfilled = true;

        emit OrderFilled(orderHash, pf.recipient, makingAmount, takingAmount);
    }

    function rescueToken(address token, address to, uint256 amount) external onlyOwner {
        IERC20(token).safeTransfer(to, amount);
    }
}
