// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import "@solmate/tokens/ERC20.sol";
import "@uniswapCore/contracts/UniswapV3Pool.sol";

/*
 * @title IMarket interface
 * @notice Interface for the Market contract
 * @dev Market will be the only entry point to interact with the protocol
 * @dev Since functions name are straightforward, no need to add NatSpec comments
 **/
interface IMarket {
    // --------------- Trader Zone ---------------
    function openPosition(
        address _token0,
        address _token1,
        int24 _fee,
        bool _isShort,
        uint8 _leverage,
        uint128 _amount,
        uint160 _limitPrice,
        uint256 _stopLossPrice
    ) external;

    function closePosition(uint256 _posId) external;

    function editPosition(uint256 _posId, uint256 _newStopLossPrice) external;

    function getTraderPositions(address _traderAdd) external view returns (uint256[] memory);

    function getPositionParams(
        uint256 _posId
    )
        external
        view
        returns (
            address baseToken_,
            address quoteToken_,
            uint128 positionSize_,
            uint64 timestamp_,
            bool isShort_,
            uint8 leverage_,
            uint256 breakEvenLimit_,
            uint160 limitPrice_,
            uint256 stopLossPrice_,
            int128 currentPnL_,
            int128 collateralLeft_
        );

    // --------------- Liquidator/Keeper Zone ---------------

    function liquidatePositions(uint256[] memory _posIds) external;

    function liquidatePosition(uint256 _posId) external;

    function getLiquidatablePositions() external view returns (uint256[] memory);

    // --------------- Admin Zone ---------------
    function createLiquidityPool(address _token) external returns (address);

    function getTokenToLiquidityPools(address _token) external view returns (address);

    function addPriceFeed(address _token, address _priceFeed) external;

    function pause() external;

    function unpause() external;

    // Events
    event PositionOpened(
        uint256 indexed posId,
        address indexed trader,
        address indexed token0,
        address token1,
        uint256 amount,
        bool isShort,
        uint8 leverage,
        uint256 limitPrice,
        uint256 stopLossPrice
    );
    event PositionClosed(uint256 indexed posId, address indexed trader);
    event PositionEdited(uint256 indexed posId, address indexed trader, uint256 newStopLossPrice);
    event LiquidityAdded(
        address indexed poolAdd,
        address indexed liquidityProvider,
        uint256 assets
    );
    event LiquidityRemoved(
        address indexed poolAdd,
        address indexed liquidityProvider,
        uint256 shares
    );
    event PositionLiquidated(uint256 indexed posId, address indexed liquidator);
    event LiquidityPoolCreated(address indexed poolAdd, address sender);
    event PriceFeedAdded(address token, address priceFeed);
}
