// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

import "./interfaces/IMarket.sol";
import "./Positions.sol";
import "./LiquidityPool.sol";
import "./LiquidityPoolFactory.sol";
import "./PriceFeedL1.sol";

contract Market is IMarket, Ownable, Pausable, ReentrancyGuard {
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
        require(
            _positions != address(0) &&
                _liquidityPoolFactory != address(0) &&
                _priceFeed != address(0),
            "Invalid address"
        );
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
    ) external whenNotPaused nonReentrant {
        require(_token0 != address(0) && _token1 != address(0), "Invalid token");
        require(_leverage > 0 && _leverage <= 25, "Invalid leverage");
        require(_amount > 0, "Amount must be positive");
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

    function closePosition(uint256 _posId) external whenNotPaused nonReentrant {
        positions.closePosition(msg.sender, _posId);
        emit PositionClosed(_posId, msg.sender);
    }

    function editPosition(uint256 _posId, uint256 _newStopLossPrice) external whenNotPaused nonReentrant {
        positions.editPosition(msg.sender, _posId, _newStopLossPrice);
        emit PositionEdited(_posId, msg.sender, _newStopLossPrice);
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
    uint256 public constant MAX_BATCH_SIZE = 50;
    event LiquidationFailed(uint256 indexed posId, bytes reason);

    function liquidatePositions(uint256[] memory _posIds) external whenNotPaused nonReentrant {
        require(_posIds.length <= MAX_BATCH_SIZE, "Max batch size exceeded");
        uint256 len = _posIds.length;

        for (uint256 i; i < len; ++i) {
            // Is that safe ?
            try positions.liquidatePosition(msg.sender, _posIds[i]) {
                emit PositionLiquidated(_posIds[i], msg.sender);
            } catch (bytes memory reason) {
                emit LiquidationFailed(_posIds[i], reason);
                revert("Liquidation failed");
            }
        }
    }

    function liquidatePosition(uint256 _posId) external whenNotPaused nonReentrant {
        positions.liquidatePosition(msg.sender, _posId);
        emit PositionLiquidated(_posId, msg.sender);
    }

    function getLiquidatablePositions() external view returns (uint256[] memory) {
        return positions.getLiquidatablePositions();
    }

    // --------------- Admin Zone ---------------
    function createLiquidityPool(
        address _token
    ) external onlyOwner whenNotPaused returns (address) {
        address lpAdd = liquidityPoolFactory.createLiquidityPool(_token);
        emit LiquidityPoolCreated(_token, lpAdd);
        return lpAdd;
    }

    function getTokenToLiquidityPools(address _token) external view returns (address) {
        return liquidityPoolFactory.getTokenToLiquidityPools(_token);
    }

    function addPriceFeed(address _token, address _priceFeed) external onlyOwner whenNotPaused {
        require(_priceFeed.code.length > 0, "Not a contract");
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
