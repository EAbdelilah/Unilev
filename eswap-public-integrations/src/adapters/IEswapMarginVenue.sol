// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Canonical venue interface for spot-margin / perp meta-aggregators.
/// @dev Eswap is fixed 5x with zero carry; `fundingRateBps` is always 0.
interface IEswapMarginVenue {
    function openLeveragedPosition(
        address collateralAsset,
        address targetAsset,
        uint256 collateralAmount,
        uint256 leverageBps,
        uint256 minAmountOut,
        bytes calldata solverData
    ) external returns (bytes32 positionId, uint256 notionalSize);

    function closeLeveragedPosition(
        bytes32 positionId,
        uint256 minAmountOut,
        bytes calldata solverData
    ) external returns (uint256 netPayoutUsdc);

    function quoteMarginRoute(
        address collateralAsset,
        address targetAsset,
        uint256 collateralAmount,
        uint256 leverageBps
    )
        external
        view
        returns (
            uint256 notionalOut,
            uint256 protocolFeeUsdc,
            uint256 fundingRateBps,
            uint256 estimatedGas
        );
}
