// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

import {IMarket} from "./interfaces/IMarket.sol";
import {Positions} from "./Positions.sol";
import {LiquidityPoolFactory} from "./LiquidityPoolFactory.sol";
import {PriceFeedL1} from "./PriceFeedL1.sol";
import {PositionLogic} from "./libraries/PositionLogic.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

contract Market is IMarket, Ownable, Pausable {
    using SafeERC20 for IERC20;

    // [FIX INFO-3] Emitted when a batch liquidation attempt fails for a specific position.
    // Previously the empty catch {} silently swallowed failures, making them invisible
    // to off-chain keepers and indexers. Now bots can react and retry appropriately.
    event LiquidationFailed(uint256 indexed posId, address indexed liquidator, bytes reason);

    Positions private immutable POSITIONS;
    LiquidityPoolFactory private immutable LIQUIDITY_POOL_FACTORY;
    PriceFeedL1 private immutable PRICE_FEED;

    constructor(address _positions, address _liquidityPoolFactory, address _priceFeed, address _owner) Ownable(_owner) {
        POSITIONS = Positions(_positions);
        LIQUIDITY_POOL_FACTORY = LiquidityPoolFactory(_liquidityPoolFactory);
        PRICE_FEED = PriceFeedL1(_priceFeed);
    }

    // --------------- Trader Zone ---------------
    function openLongPosition(
        address _token0,
        address _token1,
        uint24 _fee,
        uint8 _leverage,
        uint128 _amount,
        uint160 _limitPrice,
        uint256 _stopLossPrice
    ) external whenNotPaused {
        uint256 posId = POSITIONS.openLongPosition(
            msg.sender, _token0, _token1, _fee, _leverage, _amount, _limitPrice, _stopLossPrice
        );
        emit PositionOpened(posId, msg.sender, _token0, _token1, _amount, false, _leverage, _limitPrice, _stopLossPrice);
    }

    function openShortPosition(
        address _token0,
        address _token1,
        uint24 _fee,
        uint8 _leverage,
        uint128 _amount,
        uint160 _limitPrice,
        uint256 _stopLossPrice
    ) external whenNotPaused {
        uint256 posId = POSITIONS.openShortPosition(
            msg.sender, _token0, _token1, _fee, _leverage, _amount, _limitPrice, _stopLossPrice
        );
        emit PositionOpened(posId, msg.sender, _token0, _token1, _amount, true, _leverage, _limitPrice, _stopLossPrice);
    }

    function closePosition(uint256 _posId) external whenNotPaused {
        POSITIONS.closePosition(msg.sender, _posId);
        emit PositionClosed(_posId, msg.sender);
    }

    function editPosition(uint256 _posId, uint256 _newLstopLossPrice) external whenNotPaused {
        POSITIONS.editPosition(msg.sender, _posId, _newLstopLossPrice);
        emit PositionEdited(_posId, msg.sender, _newLstopLossPrice);
    }

    function getTraderPositions(address _traderAdd) external view returns (uint256[] memory) {
        return POSITIONS.getTraderPositions(_traderAdd);
    }

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
        )
    {
        return POSITIONS.getPositionParams(_posId);
    }

    /**
     * @notice Calculate position opening parameters (borrow amount, liquidation floor, etc.)
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
        returns (uint256 liquidationFloor, uint256 totalBorrow, address borrowToken, address liquidityPoolToken)
    {
        // Get base token decimals
        uint8 baseDecimals = IERC20Metadata(_baseToken).decimals();
        uint256 baseDecimalsPow = 10 ** baseDecimals;

        // Build calculation params
        PositionLogic.PositionOpeningCalcParams memory params = PositionLogic.PositionOpeningCalcParams({
            price: _price,
            leverage: _leverage,
            baseCollateralAmount: _baseCollateralAmount,
            baseDecimals: baseDecimals,
            baseDecimalsPow: baseDecimalsPow,
            isShort: _isShort,
            baseToken: _baseToken,
            quoteToken: _quoteToken
        });

        // Calculate position opening parameters
        PositionLogic.PositionOpeningCalcResult memory result = PositionLogic.calculatePositionOpening(params);

        return (result.liquidationFloor, result.totalBorrow, result.borrowToken, result.liquidityPoolToken);
    }

    // --------------- Liquidator/Keeper Zone ----------------
    function liquidatePositions(uint256[] calldata _posIds) external whenNotPaused {
        uint256 len = _posIds.length;

        for (uint256 i; i < len; ++i) {
            // [FIX INFO-3] Capture revert reason and emit LiquidationFailed so
            // off-chain keepers can identify and react to problematic positions.
            try POSITIONS.liquidatePosition(msg.sender, _posIds[i]) {
                emit PositionLiquidated(_posIds[i], msg.sender);
            } catch (bytes memory reason) {
                emit LiquidationFailed(_posIds[i], msg.sender, reason);
            }
        }
    }

    function liquidatePosition(uint256 _posId) external whenNotPaused {
        POSITIONS.liquidatePosition(msg.sender, _posId);
        emit PositionLiquidated(_posId, msg.sender);
    }

    function getLiquidablePositions() external view returns (uint256[] memory) {
        return POSITIONS.getLiquidablePositions();
    }

    // --------------- Admin Zone ---------------
    function createLiquidityPool(address _token) public onlyOwner whenNotPaused returns (address) {
        address lpAdd = LIQUIDITY_POOL_FACTORY.createLiquidityPool(_token, address(POSITIONS));
        emit LiquidityPoolCreated(_token, msg.sender);
        return lpAdd;
    }

    function getTokenToLiquidityPools(address _token) external view returns (address) {
        return LIQUIDITY_POOL_FACTORY.getTokenToLiquidityPools(_token);
    }

    function addPriceFeed(address _token, address _priceFeed) public onlyOwner whenNotPaused {
        PRICE_FEED.addPriceFeed(_token, _priceFeed);
        emit PriceFeedAdded(_token, _priceFeed);
    }

    function setStalenessThreshold(uint256 _newThreshold) external onlyOwner {
        PRICE_FEED.setStalenessThreshold(_newThreshold);
    }

    /// @notice Adjust Uniswap swap slippage tolerance. Range: 9500 (5%) to 9990 (0.1%).
    /// Default is 9700 (3%). Increase for thin-liquidity pairs, decrease for high-liquidity.
    function setSlippageTolerance(uint256 _newTolerance) external onlyOwner {
        POSITIONS.setSlippageTolerance(_newTolerance);
    }

    function initializeTokens(address[] calldata _tokens, address[] calldata _priceFeeds)
        external
        onlyOwner
        whenNotPaused
        returns (address[] memory)
    {
        uint256 len = _tokens.length;
        require(len == _priceFeeds.length, "Token and PriceFeed arrays must have same length");

        address[] memory pools = new address[](len);
        for (uint256 i; i < len; ++i) {
            pools[i] = createLiquidityPool(_tokens[i]);
            addPriceFeed(_tokens[i], _priceFeeds[i]);
        }
        return pools;
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }
}
