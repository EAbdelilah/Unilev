// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

import {IMarket} from "./interfaces/IMarket.sol";
import {Positions} from "./Positions.sol";
import {LiquidityPoolFactory} from "./LiquidityPoolFactory.sol";
import {PriceFeedL1} from "./PriceFeedL1.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract Market is IMarket, Ownable, Pausable {
    using SafeERC20 for IERC20;

    Positions private immutable POSITIONS;
    LiquidityPoolFactory private immutable LIQUIDITY_POOL_FACTORY;
    PriceFeedL1 private immutable PRICE_FEED;

    constructor(
        address _positions,
        address _liquidityPoolFactory,
        address _priceFeed,
        address _owner
    ) Ownable(_owner) {
        POSITIONS = Positions(_positions);
        LIQUIDITY_POOL_FACTORY = LiquidityPoolFactory(_liquidityPoolFactory);
        PRICE_FEED = PriceFeedL1(_priceFeed);
    }

    // --------------- Trader Zone ---------------
    function openPosition(
        address _token0,
        address _token1,
        uint24 _fee,
        bool _isShort,
        uint8 _leverage,
        uint128 _amount,
        uint160 _limitPrice,
        uint256 _stopLossPrice
    ) external whenNotPaused {

        SafeERC20.forceApprove(IERC20(_token0), address(POSITIONS), _amount);

        uint256 posId = POSITIONS.openPosition(
            msg.sender,
            _token0,
            _token1,
            _fee,
            _isShort,
            _leverage,
            _amount,
            _limitPrice,
            _stopLossPrice
        );
        emit PositionOpened(
            posId,
            msg.sender,
            _token0,
            _token1,
            _amount,
            _isShort,
            _leverage,
            _limitPrice,
            _stopLossPrice
        );
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
        )
    {
        return POSITIONS.getPositionParams(_posId);
    }

    function getPositionState(uint256 _posId) external view returns (uint8) {
        return uint8(POSITIONS.getPositionState(_posId));
    }

    // --------------- Liquidator/Keeper Zone ----------------
    function liquidatePositions(uint256[] memory _posIds) external whenNotPaused {
        uint256 len = _posIds.length;

        for (uint256 i; i < len; ++i) {
            // Is that safe ?
            try POSITIONS.liquidatePosition(msg.sender, _posIds[i]) {
                emit PositionLiquidated(_posIds[i], msg.sender);
            } catch {}
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
    function createLiquidityPool(
        address _token
    ) external onlyOwner whenNotPaused returns (address) {
        address lpAdd = LIQUIDITY_POOL_FACTORY.createLiquidityPool(_token);
        emit LiquidityPoolCreated(_token, msg.sender);
        return lpAdd;
    }

    function getTokenToLiquidityPools(address _token) external view returns (address) {
        return LIQUIDITY_POOL_FACTORY.getTokenToLiquidityPools(_token);
    }

    function getPriceFeed() external view returns (address) {
        return address(PRICE_FEED);
    }

    function addPriceFeed(address _token, address _priceFeed) external onlyOwner whenNotPaused {
        PRICE_FEED.addPriceFeed(_token, _priceFeed);
        emit PriceFeedAdded(_token, _priceFeed);
    }

    function addPriceFeeds(address[] calldata _tokens, address[] calldata _priceFeeds) external onlyOwner whenNotPaused {
        uint256 len = _tokens.length;
        for (uint256 i; i < len; ++i) {
            PRICE_FEED.addPriceFeed(_tokens[i], _priceFeeds[i]);
            emit PriceFeedAdded(_tokens[i], _priceFeeds[i]);
        }
    }

    function createLiquidityPools(address[] calldata _tokens) external onlyOwner whenNotPaused returns (address[] memory) {
        uint256 len = _tokens.length;
        address[] memory pools = new address[](len);
        for (uint256 i; i < len; ++i) {
            pools[i] = LIQUIDITY_POOL_FACTORY.createLiquidityPool(_tokens[i]);
            emit LiquidityPoolCreated(_tokens[i], msg.sender);
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
