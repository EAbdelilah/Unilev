// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {EswapRouter} from "./EswapRouter.sol";
import {PoolKey} from "./types/PoolKey.sol";
import {Currency} from "./types/Currency.sol";
import {CowOrder} from "./cow/CowOrder.sol";
import {CowSigning} from "./cow/CowSigning.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

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
 *        4. The solver MUST be the caller (`fillOrder` is not a relay) and
 *           MUST approve THIS settlement for the margin token. The settlement
 *           pulls the margin itself, approves the router for exactly that
 *           amount and passes itself as `marginFunder`, which is the only way
 *           to satisfy the router's anti-drain rule (the address whose tokens
 *           are pulled must be the caller).
 *
 *      This makes Eswap margin intents genuinely CoW-compatible: any solver
 *      that can settle a GPv2 batch can include these fills without bespoke
 *      protocol approval flows.
 */
contract EswapCoWSettlement is CowSigning {
    using CowOrder for CowOrder.Data;
    using SafeERC20 for IERC20;

    /// @dev The EswapRouter that executes the underlying margin swap.
    EswapRouter public immutable router;

    /// @dev The canonical CoW Protocol GPv2Settlement contract address that
    ///      order signatures are bound to (domain separator verifyingContract).
    address public immutable gpv2Settlement;

    struct FillParams {
        // Leverage multiplier applied to the trader's margin. The order's
        // appData must commit this exact value (`leverageCommitment`).
        uint8 leverage;
        // Solver funding the margin AND the borrowed leg. For leverage > 1 the
        // EswapRouter requires this address to be EITHER governance-whitelisted
        // OR to hold a pre-funded `erc20BorrowEscrow` bond covering the whole
        // borrow notional in the input token. The escrow leg is what makes the
        // orderbook route permissionless: an anonymous CoW solver can bond the
        // notional and fill with no per-address allowlist entry, and is recorded
        // as the position's `positionSolver`, which routes the position's
        // rehypothecation yield to it.
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
    error SolverNotCaller();
    error NativeMarginNotSupported();
    // [AUDIT CRIT-05] The order's appData must commit the exact leverage the
    // fill is about to apply (an underwriting signal the trader signs).
    error LeverageCommitmentMismatch(bytes32 appData, bytes32 expected);

    /// @dev [AUDIT CRIT-05] Legacy tag retained for ABI/discovery tooling.
    ///      NOTE: this is NO LONGER hashed into `leverageCommitment` — the
    ///      commitment is now the keccak256 of the canonical CoW `fullAppData`
    ///      JSON document (see `appDataJson`), because CoW's `appData` field is
    ///      defined as exactly `keccak256(fullAppData)`. The previous
    ///      `keccak256(tag ‖ lev)` preimage had no CoW appData record and could
    ///      never be registered, which made every real order unfillable.
    bytes32 public constant APP_DATA_LEVERAGE_TAG = keccak256("eswap-cow-leverage-v1");

    /// @dev Prefix/suffix of the canonical `fullAppData` document. The document
    ///      is `{"version":1,"appCode":"eswap","metadata":{"eswapLeverage":"<lev>"}}`.
    ///      It MUST be serialised byte-for-byte as written here: CoW stores the
    ///      raw document and sets `appData = keccak256(rawBytes)`, so any
    ///      whitespace/ordering change would break the commitment match.
    string internal constant APP_DATA_PREFIX = '{"version":1,"appCode":"eswap","metadata":{"eswapLeverage":"';
    string internal constant APP_DATA_SUFFIX = '"}}';

    /// @dev [AUDIT CRIT-05] The canonical `fullAppData` JSON a CoW order must
    ///      carry to authorize a leveraged fill. Traders (and their UI) register
    ///      this exact string via `PUT /app_data/{hash}` and set the order's
    ///      `appData` to `keccak256(bytes(appDataJson(leverage)))`.
    function appDataJson(uint8 leverage) public pure returns (string memory) {
        return string.concat(APP_DATA_PREFIX, _decimalString(uint256(leverage)), APP_DATA_SUFFIX);
    }

    /// @dev [AUDIT CRIT-05] The canonical appData a CoW order must carry to
    ///      authorize a leveraged fill: `keccak256(bytes(appDataJson(lev)))`.
    ///      This is exactly the CoW `appData` hash of the canonical document, so
    ///      an order accepted by the CoW order book at the trader-committed
    ///      leverage is fillable. This is the trader-signed commitment the
    ///      solver's `params.leverage` must match; without it the order cannot be
    ///      filled at ANY leverage.
    function leverageCommitment(uint8 leverage) public pure returns (bytes32) {
        return keccak256(bytes(appDataJson(leverage)));
    }

    /// @dev Minimal base-10 serialiser for a `uint256` (leverage is a `uint8`).
    function _decimalString(uint256 value) internal pure returns (string memory) {
        if (value == 0) return "0";
        uint256 temp = value;
        uint256 digits;
        while (temp != 0) {
            digits++;
            temp /= 10;
        }
        bytes memory buffer = new bytes(digits);
        while (value != 0) {
            digits -= 1;
            buffer[digits] = bytes1(uint8(48 + (value % 10)));
            value /= 10;
        }
        return string(buffer);
    }

    /// @dev CoW order UID => filled (replay protection, mirrors the CoW UID).
    mapping(bytes32 => bool) public filledOrders;

    event OrderFilled(bytes orderUid, address indexed owner, address indexed solver, uint256 margin, uint8 leverage);
    event BatchFillComplete(uint256 filled, uint256 failed);

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
    /// @dev [AUDIT HIGH-9] Each order is filled independently: a failing order
    ///      (bad signature, stale price, expired deadline, etc.) no longer reverts
    ///      the entire batch and cannot grief the other fills. Failures are
    ///      surfaced via the returned counters and the Failure event.
    /// @return count  The number of successfully filled orders.
    /// @return failed The number of orders that reverted.
    function fillOrders(
        CowOrder.Data[] calldata orders,
        Scheme[] calldata schemes,
        bytes[] calldata signatures,
        FillParams[] calldata params
    ) external returns (uint256 count, uint256 failed) {
        uint256 n = orders.length;
        require(n == schemes.length && n == signatures.length && n == params.length, "array length mismatch");
        for (uint256 i = 0; i < n; i++) {
            // The per-order fill self-call loses `msg.sender`, so bind each
            // solver to the batch caller here; `_fillOrder` accepts the
            // self-call only for orders that passed this gate.
            if (params[i].solver != msg.sender) {
                failed++;
                continue;
            }
            try this.fillOrder(orders[i], schemes[i], signatures[i], params[i]) returns (address) {
                count++;
            } catch {
                failed++;
            }
        }
        emit BatchFillComplete(count, failed);
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
        // unique identifier, used for replay protection. [AUDIT LOW-6] hashed to
        // a fixed bytes32 key so a hostile order payload cannot bloat the table.
        bytes memory orderUid = abi.encodePacked(orderDigest, owner, order.validTo);
        bytes32 uid = keccak256(orderUid);
        if (filledOrders[uid]) revert OrderAlreadyFilled(orderUid);
        filledOrders[uid] = true;

        if (params.solver == address(0)) revert ZeroSolver();
        uint256 margin = order.sellAmount;
        if (margin == 0) revert InvalidAmount();

        // [AUDIT CRIT-05] The position's leverage sets the trader's debt
        // liability — an exposure the CoW order itself never commits to. A
        // solver must therefore fill EXACTLY the leverage the trader committed
        // in the signed appData. Any deviation (or a free-form appData) is
        // rejected: it would let a solver open the position at an arbitrary
        // leverage the trader never authorized.
        bytes32 expectedCommitment = leverageCommitment(params.leverage);
        if (order.appData != expectedCommitment) {
            revert LeverageCommitmentMismatch(order.appData, expectedCommitment);
        }

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

        // [AUDIT CRIT-4b] The margin leg is funded by `params.solver`, so the
        // solver nominating itself must be the caller. Without this, anyone could
        // fill an (attacker-owned) order with `params.solver = <victim solver>`
        // and convert that solver's allowance into a position for the attacker.
        // `msg.sender == address(this)` is the batch path, whose caller is bound
        // to `params.solver` in `fillOrders` before the self-call.
        if (msg.sender != address(this) && params.solver != msg.sender) revert SolverNotCaller();

        // The router only pulls the margin from the address that calls it (the
        // strict anti-drain gate on swapMultiPoolForSolverFunded). Pull the
        // margin into this settlement first, then fund the router from here, so
        // the funder authorizes THIS contract and never the router.
        //
        // [AUDIT CRIT-ACT-03] MARGIN CUSTODY. When this contract settles the
        // order itself, the trader never pays: pulling the margin from the
        // solver means the solver finances the trader's collateral and only the
        // BORROW leg is returned on close, so the trader walks away with the
        // margin. Prefer the ORDER OWNER's own pre-approved sell leg (the CoW
        // "sell" side) and fall back to the solver only when the owner has not
        // approved this settlement — that is the GPv2-batch case, where the
        // canonical settlement has already moved the sell amount to the solver.
        address marginSource = params.solver;
        if (IERC20(order.sellToken).allowance(owner, address(this)) >= margin) {
            marginSource = owner;
        }
        IERC20(order.sellToken).safeTransferFrom(marginSource, address(this), margin);
        IERC20(order.sellToken).forceApprove(address(router), margin);

        router.swapMultiPoolForSolverFunded(swapParams, owner, address(this));
        // The router consumes exactly `margin`; reset the standing approval so no
        // residual allowance survives the fill.
        IERC20(order.sellToken).forceApprove(address(router), 0);

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