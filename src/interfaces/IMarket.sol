// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/*
 * @title IMarket interface
 * @notice Interface for the Market contract
 * @dev Market will be the only entry point to interact with the protocol
 * @dev Since functions name are straightforward, no need to add NatSpec comments
 **/
interface IMarket {
    // --------------- Trader Zone ---------------
    function openLongPosition(
        address _token0,
        address _token1,
        uint24 _fee,
        uint8 _leverage,
        uint128 _amount,
        uint160 _limitPrice,
        uint256 _stopLossPrice
    ) external;

    function openShortPosition(
        address _token0,
        address _token1,
        uint24 _fee,
        uint8 _leverage,
        uint128 _amount,
        uint160 _limitPrice,
        uint256 _stopLossPrice
    ) external;

    function closePosition(uint256 _posId) external;

    function editPosition(uint256 _posId, uint256 _newLstopLossPrice) external;

    function getTraderPositions(address _traderAdd) external view returns (uint256[] memory);

    function getPositionParams(uint256 _posId)
        external
        view
        returns (
            address baseToken_,
            address quoteToken_,
            uint128 positionSize_,
            uint64 timestamp_,
            bool isShort_,
            uint8 leverage_,
            uint256 liquidationFloor_,
            uint160 limitPrice_,
            uint256 stopLossPrice_,
            int128 currentPnL_,
            int128 collateralLeft_
        );

    /**
     * @notice Calculate position opening parameters (borrow amount, break-even, etc.)
     * @param _price Current price from oracle (base/quote)
     * @param _leverage Leverage multiplier (2-5)
     * @param _baseCollateralAmount Collateral amount after fees/swap (in base token decimals)
     * @param _isShort True for short position
     * @param _baseToken Base token address
     * @param _quoteToken Quote token address
     * @return liquidationFloor Price at which position is undercollateralized (collateral depleted)
     * @return totalBorrow Amount to borrow from liquidity pool
     * @return borrowToken Token to borrow (base for short, quote for long)
     * @return liquidityPoolToken Token for liquidity pool lookup
     */
    function calculatePositionOpening(
        uint256 _price,
        uint8 _leverage,
        uint128 _baseCollateralAmount,
        bool _isShort,
        address _baseToken,
        address _quoteToken
    )
        external
        view
        returns (uint256 liquidationFloor, uint256 totalBorrow, address borrowToken, address liquidityPoolToken);

    // --------------- Liquidator/Keeper Zone ---------------

    function liquidatePositions(uint256[] calldata _posIds) external;

    function liquidatePosition(uint256 _posId) external;

    function getLiquidablePositions() external view returns (uint256[] memory);

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
    event LiquidityAdded(address indexed poolAdd, address indexed liquidityProvider, uint256 assets);
    event LiquidityRemoved(address indexed poolAdd, address indexed liquidityProvider, uint256 shares);
    event PositionLiquidated(uint256 indexed posId, address indexed liquidator);
    event LiquidityPoolCreated(address indexed poolAdd, address sender);
    event PriceFeedAdded(address token, address priceFeed);
}
