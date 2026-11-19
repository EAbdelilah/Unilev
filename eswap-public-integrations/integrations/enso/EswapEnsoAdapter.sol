// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {EswapMarginVenueAdapter} from "../../src/adapters/EswapMarginVenueAdapter.sol";
import {EswapRouter} from "../../../src/v4/EswapRouter.sol";
import {Currency} from "../../../src/v4/types/Currency.sol";

/**
 * @title EswapEnsoAdapter
 * @notice Enso Shortcut execution helper for Eswap's canonical 5x leveraged open.
 *
 * @dev Enso routes by selector. The terminal router call is
 *      `EswapRouter.swapMultiPool(SwapParams)` == `0x33046e31`; this helper
 *      builds that exact calldata and can also execute it on behalf of a trader
 *      whose margin approval points at this adapter.
 *
 *      No Enso listing/registration is claimed by this repository. The helper
 *      is merge-ready; the upstream shortcut descriptor still needs to be
 *      registered by Enso.
 */
contract EswapEnsoAdapter is EswapMarginVenueAdapter {
    /// @dev `swapMultiPool((PoolKey,PoolKey,bool,int256,uint8,address,bytes,uint256,uint256))`
    bytes4 public constant ENSO_SHORTCUT_SELECTOR = 0x33046e31;

    error InvalidSwapParams();
    error UnauthorizedTrader();

    event EnsoShortcutExecuted(
        bytes32 indexed positionId,
        address indexed trader,
        address indexed solver,
        address target,
        bytes4 selector,
        uint256 margin,
        uint256 notionalSize
    );

    event EnsoShortcutClosed(bytes32 indexed positionId, address indexed trader, uint256 netPayoutUsdc);

    /**
     * @notice Return the canonical Enso Shortcut terminal call.
     * @dev The returned calldata targets the live EswapRouter and carries the
     *      exact selector Enso registers. Integrators place this call last in
     *      the shortcut chain, after USDC approval and optional solver escrow.
     */
    function buildShortcutCall(EswapRouter.SwapParams calldata params)
        external
        pure
        returns (address target, bytes4 selector, bytes memory data)
    {
        if (params.leverage != 5 || params.amountSpecified >= 0) revert InvalidSwapParams();
        if (params.key.hooks != HOOK || params.standardPoolKey.hooks != address(0)) revert InvalidSwapParams();
        target = ROUTER;
        selector = ENSO_SHORTCUT_SELECTOR;
        data = abi.encodeWithSelector(selector, params);
    }

    /**
     * @notice Execute a shortcut open with an explicit trader/owner.
     * @dev `solverData` follows the venue adapter convention: `0x` self-bonds,
     *      `abi.encode(address solver)` uses an external capitalised solver.
     */
    function executeShortcut(
        EswapRouter.SwapParams calldata params,
        address trader,
        bytes calldata solverData,
        uint256 minAmountOut
    ) external nonReentrant returns (bytes32 positionId, uint256 notionalSize) {
        if (trader == address(0)) revert UnauthorizedTrader();
        if (params.leverage != 5 || params.amountSpecified >= 0) revert InvalidSwapParams();
        if (params.key.hooks != HOOK || params.standardPoolKey.hooks != address(0)) revert InvalidSwapParams();
        // The advertised router solver must match the funding mode in solverData.
        if (params.solver != _decodeSolver(solverData)) revert InvalidSwapParams();

        address collateralAsset = Currency.unwrap(params.zeroForOne ? params.key.currency0 : params.key.currency1);
        address targetAsset = Currency.unwrap(params.zeroForOne ? params.key.currency1 : params.key.currency0);
        uint256 margin = uint256(-params.amountSpecified);

        (positionId, notionalSize) =
            _openFor(trader, collateralAsset, targetAsset, margin, minAmountOut, solverData);

        emit EnsoShortcutExecuted(
            positionId, trader, params.solver, ROUTER, ENSO_SHORTCUT_SELECTOR, margin, notionalSize
        );
    }

    /// @notice Close an adapter-custodied shortcut position and forward USDC.
    function closeShortcut(bytes32 positionId, uint256 minAmountOut)
        external
        nonReentrant
        returns (uint256 netPayoutUsdc)
    {
        if (positions[positionId].owner != msg.sender) revert UnauthorizedTrader();
        netPayoutUsdc = _closeFor(positionId, minAmountOut);
        emit EnsoShortcutClosed(positionId, msg.sender, netPayoutUsdc);
    }
}
