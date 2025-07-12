// SPDX-License-Identifier: MIT
pragma solidity =0.8.19;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/Pausable.sol";

import "./interfaces/IMarket.sol";
import "./Positions.sol";
import "./LiquidityPool.sol";
import "./LiquidityPoolFactory.sol";
import "./PriceFeedL1.sol";

contract Market is IMarket, Ownable, Pausable {
    using SafeTransferLib for ERC20;

    Positions private immutable positions;
    LiquidityPoolFactory private immutable liquidityPoolFactory;
    PriceFeedL1 private immutable priceFeed;

    constructor(
        address _positions,
        address _liquidityPoolFactory,
        address _priceFeed,
        address _owner
    ) {
        positions = Positions(_positions);
        liquidityPoolFactory = LiquidityPoolFactory(_liquidityPoolFactory);
        priceFeed = PriceFeedL1(_priceFeed);
        transferOwnership(_owner);
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
        uint256 posId = positions.openPosition(
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
        positions.closePosition(msg.sender, _posId);
        emit PositionClosed(_posId, msg.sender);
    }

    function editPosition(uint256 _posId, uint256 _newLstopLossPrice) external whenNotPaused {
        positions.editPosition(msg.sender, _posId, _newLstopLossPrice);
        emit PositionEdited(_posId, msg.sender, _newLstopLossPrice);
    }

    function getTraderPositions(address _traderAdd) external view returns (uint256[] memory) {
        return positions.getTraderPositions(_traderAdd);
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
        return positions.getPositionParams(_posId);
    }

    // --------------- Liquidator/Keeper Zone ----------------
    function liquidatePositions(uint256[] memory _posIds) external whenNotPaused {
        uint256 len = _posIds.length;

        for (uint256 i; i < len; ++i) {
            // Is that safe ?
            try positions.liquidatePosition(msg.sender, _posIds[i]) {
                emit PositionLiquidated(_posIds[i], msg.sender);
            } catch {}
        }
    }

    function liquidatePosition(uint256 _posId) external whenNotPaused {
        positions.liquidatePosition(msg.sender, _posId);
        emit PositionLiquidated(_posId, msg.sender);
    }

    function getLiquidablePositions() external view returns (uint256[] memory) {
        return positions.getLiquidablePositions();
    }

    // --------------- Admin Zone ---------------
    function createLiquidityPool(
        address _token
    ) external onlyOwner whenNotPaused returns (address) {
        address lpAdd = liquidityPoolFactory.createLiquidityPool(_token);
        emit LiquidityPoolCreated(_token, msg.sender);
        return lpAdd;
    }

    function getTokenToLiquidityPools(address _token) external view returns (address) {
        return liquidityPoolFactory.getTokenToLiquidityPools(_token);
    }

    function addPriceFeed(address _token, address _priceFeed) external onlyOwner whenNotPaused {
        priceFeed.addPriceFeed(_token, _priceFeed);
        emit PriceFeedAdded(_token, _priceFeed);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function openPosition(
        address _token0,
        address _token1,
        int24 _fee,
        bool _isShort,
        uint8 _leverage,
        uint128 _amount,
        uint160 _limitPrice,
        uint256 _stopLossPrice
    ) external override {}
}
