// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {EswapRouter} from "./EswapRouter.sol";
import {PoolKey} from "./types/PoolKey.sol";
import {Currency} from "./types/Currency.sol";
import {CowOrder} from "./cow/CowOrder.sol";
import {CowSigning} from "./cow/CowSigning.sol";

/**
 * @title EswapCoWSettlement
 * @notice CoW Protocol-compatible settlement for Eswap leveraged position opens.
 *
 * @dev Lets a CoW Swap solver fill a trader's canonical CoW order (signed for
 *      the real CoW Protocol GPv2Settlement domain) into a leveraged Eswap
 *      position:
 *
 *        1. The trader signs a normal CoW order on the CoW order book:
 *             sellToken  = margin asset,        sellAmount = margin M
 *             buyToken   = collateral asset,    buyAmount  = minimum collateral
 *             feeAmount  = 0, kind = "sell", balance = "erc20"/"erc20"
 *             appData    = free (may carry protocol metadata)
 *        2. A solver coerces the intent into a settlement and calls
 *           `fillOrder(order, scheme, signature, params)`. This contract
 *           re-derives the EIP-712 digest under the CANONICAL CoW domain
 *           separator (bound to the real GPv2Settlement address, NOT this
 *           contract), recovers the owner with the exact CoW signature
 *           semantics (EIP-712 / eth_sign / EIP-1271 / pre-sign), binds the
 *           swap parameters to the signed order fields, then opens the
 *           position through the EswapRouter with the SOLVER funding the
 *           margin leg.
 *        3. The position is registered to the recovered order owner; the
 *           margin and borrow legs are pulled from the executing solver, so
 *           the trader never needs to approve the Eswap router.
 *
 *      This makes Eswap margin intents genuinely CoW-compatible: any solver
 *      that can settle a GPv2 batch can include these fills without bespoke
 *      protocol approval flows.
 */
contract EswapCoWSettlement is CowSigning {
    using CowOrder for CowOrder.Data;

    /// @dev The EswapRouter that executes the underlying margin swap.
    EswapRouter public immutable router;

    /// @dev The canonical CoW Protocol GPv2Settlement contract address that
    ///      order signatures are bound to (domain separator verifyingContract).
    address public immutable gpv2Settlement;

    struct FillParams {
        // Leverage multiplier applied to the trader's margin.
        uint8 leverage;
        // Solver funding the margin AND the borrowed leg (must be whitelisted
        // on the EswapRouter for leverage > 1).
        address solver;
        // Hook-enabled pool where the position is registered.
        PoolKey key;
        // Deep standard (no-hook) pool where the physical fill executes.
        PoolKey standardPoolKey;
    }

    error OrderExpired(uint32 validTo, uint256 now);
    error OrderAlreadyFilled(bytes orderUid);
    error InvalidOrderKind();
    error PartiallyFillableNotSupported();
    error FeeNotSupported(uint256 feeAmount);
    error UnsupportedTokenBalance();
    error ReceiverMismatch(address receiver, address owner);
    error TokenMismatch();
    error InvalidAmount();
    error InvalidOwner();
    error ZeroSolver();
    error NativeMarginNotSupported();

    /// @dev CoW order UID => filled (replay protection, mirrors the CoW UID).
    mapping(bytes => bool) public filledOrders;

    event OrderFilled(bytes orderUid, address indexed owner, address indexed solver, uint256 margin, uint8 leverage);

    /// @param _router          The EswapRouter executing the fill.
    /// @param _gpv2Settlement  The canonical CoW GPv2Settlement address.
    constructor(EswapRouter _router, address _gpv2Settlement) CowSigning(_gpv2Settlement) {
        router = _router;
        gpv2Settlement = _gpv2Settlement;
    }

    /// @notice Fill a single CoW order into a leveraged position.
    /// @param order      The trader's signed CoW order.
    /// @param scheme     Signature scheme (Eip712 / EthSign / Eip1271 / PreSign).
    /// @param signature  Signature bytes per the scheme semantics.
    /// @param params     Eswap fill parameters (leverage, solver, pools).
    /// @return owner The recovered order owner (the position holder).
    function fillOrder(CowOrder.Data calldata order, Scheme scheme, bytes calldata signature, FillParams calldata params)
        external
        returns (address owner)
    {
        CowOrder.Data memory orderCopy = order;
        bytes memory signatureCopy = signature;
        FillParams memory paramsCopy = params;
        return _fillOrder(orderCopy, scheme, signatureCopy, paramsCopy);
    }

    /// @notice Fill a batch of CoW orders in a single transaction.
    /// @return count The number of successfully filled orders.
    function fillOrders(
        CowOrder.Data[] calldata orders,
        Scheme[] calldata schemes,
        bytes[] calldata signatures,
        FillParams[] calldata params
    ) external returns (uint256 count) {
        uint256 n = orders.length;
        require(n == schemes.length && n == signatures.length && n == params.length, "array length mismatch");
        for (uint256 i = 0; i < n; i++) {
            CowOrder.Data memory order = orders[i];
            bytes memory signature = signatures[i];
            FillParams memory fillParams = params[i];
            _fillOrder(order, schemes[i], signature, fillParams);
        }
        return n;
    }

    function _fillOrder(CowOrder.Data memory order, Scheme scheme, bytes memory signature, FillParams memory params)
        internal
        returns (address owner)
    {
        _validateOrder(order);

        (bytes32 orderDigest, address recoveredOwner) = recoverOrderSigner(order, scheme, signature);
        owner = recoveredOwner;
        if (owner == address(0)) revert InvalidOwner();

        // Receiver marker must resolve back to the owner: proceeds (the
        // position) always belong to the order signer.
        if (order.receiver != CowOrder.RECEIVER_SAME_AS_OWNER && order.receiver != owner) {
            revert ReceiverMismatch(order.receiver, owner);
        }

        // Order UID = orderDigest ‖ owner ‖ validTo (56 bytes) — the exact CoW
        // unique identifier, used for replay protection.
        bytes memory orderUid = abi.encodePacked(orderDigest, owner, order.validTo);
        if (filledOrders[orderUid]) revert OrderAlreadyFilled(orderUid);
        filledOrders[orderUid] = true;

        if (params.solver == address(0)) revert ZeroSolver();
        uint256 margin = order.sellAmount;
        if (margin == 0) revert InvalidAmount();

        // Derive swap direction from the signed tokens rather than trusting a
        // caller-supplied flag. CoW sell tokens are always ERC20s (native
        // margins wrap to WETH), so native margins are structurally unsupported.
        bool zeroForOne;
        if (order.sellToken == Currency.unwrap(params.key.currency0)) {
            zeroForOne = true;
        } else if (order.sellToken == Currency.unwrap(params.key.currency1)) {
            zeroForOne = false;
        } else {
            revert TokenMismatch();
        }
        if (order.sellToken == address(0)) revert NativeMarginNotSupported();
        if (order.buyToken != Currency.unwrap(zeroForOne ? params.key.currency1 : params.key.currency0)) {
            revert TokenMismatch();
        }

        EswapRouter.SwapParams memory swapParams = EswapRouter.SwapParams({
            key: params.key,
            standardPoolKey: params.standardPoolKey,
            zeroForOne: zeroForOne,
            // Margin is the exact-in leg; the router expands by borrow = margin*(leverage-1).
            amountSpecified: -int256(margin),
            leverage: params.leverage,
            solver: params.solver,
            hookData: abi.encode(true, params.leverage, owner),
            // The CoW validTo expiry doubles as the fill deadline.
            deadline: uint256(order.validTo),
            // The trader's signed minimum buy amount is the slippage floor.
            minAmountOut: order.buyAmount
        });

        router.swapMultiPoolForSolverFunded(swapParams, owner, params.solver);

        emit OrderFilled(orderUid, owner, params.solver, margin, params.leverage);
    }

    /// @dev Odds-and-ends order semantics enforced identically to CoW Protocol.
    function _validateOrder(CowOrder.Data memory order) internal view {
        if (order.kind != CowOrder.KIND_SELL) revert InvalidOrderKind();
        if (order.partiallyFillable) revert PartiallyFillableNotSupported();
        if (order.feeAmount != 0) revert FeeNotSupported(order.feeAmount);
        if (
            order.sellTokenBalance != CowOrder.BALANCE_ERC20 || order.buyTokenBalance != CowOrder.BALANCE_ERC20
        ) revert UnsupportedTokenBalance();
        if (order.validTo < block.timestamp) revert OrderExpired(order.validTo, block.timestamp);
    }

    // ─── Off-chain helpers / resolvability ────────────────────────────────

    /// @notice EIP-712 order digest for the canonical CoW domain.
    function hashOrder(CowOrder.Data calldata order) external view returns (bytes32) {
        CowOrder.Data memory orderCopy = order;
        return orderCopy.hash(domainSeparator);
    }

    /// @notice 56-byte CoW order UID for `owner`.
    function uidOf(CowOrder.Data calldata order, address owner) external view returns (bytes memory) {
        CowOrder.Data memory orderCopy = order;
        return abi.encodePacked(orderCopy.hash(domainSeparator), owner, order.validTo);
    }

    /// @notice Recover the owner / digest / UID without executing a fill
    ///         (useful for solvers and the resolver layer).
    function verify(CowOrder.Data calldata order, Scheme scheme, bytes calldata signature)
        external
        view
        returns (address owner, bytes32 orderDigest, bytes memory orderUid)
    {
        CowOrder.Data memory orderCopy = order;
        bytes memory signatureCopy = signature;
        (orderDigest, owner) = recoverOrderSigner(orderCopy, scheme, signatureCopy);
        orderUid = abi.encodePacked(orderDigest, owner, order.validTo);
    }
}