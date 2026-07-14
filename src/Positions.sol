// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC721Enumerable} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {IUniswapV3Factory, IUniswapV3Pool} from "./interfaces/IUniswapV3.sol";

import {PriceFeedL1} from "./PriceFeedL1.sol";
import {LiquidityPoolFactory} from "./LiquidityPoolFactory.sol";
import {UniswapV3Helper} from "./UniswapV3Helper.sol";
import {LiquidityPool} from "./LiquidityPool.sol";
import {FeeManager} from "./FeeManager.sol";
import {
    PositionParams,
    Positions__POSITION_NOT_OPEN,
    Positions__POSITION_NOT_LIQUIDABLE_YET,
    Positions__POSITION_NOT_OWNED,
    Positions__POOL_NOT_OFFICIAL,
    Positions__TOKEN_NOT_SUPPORTED,
    Positions__TOKEN_NOT_SUPPORTED_ON_MARGIN,
    Positions__NO_PRICE_FEED,
    Positions__LEVERAGE_NOT_IN_RANGE,
    Positions__AMOUNT_TO_SMALL,
    Positions__LIMIT_ORDER_PRICE_NOT_CONCISTENT,
    Positions__STOP_LOSS_ORDER_PRICE_NOT_CONCISTENT,
    Positions__NOT_LIQUIDABLE,
    Positions__WAIT_FOR_LIMIT_ORDER_TO_COMPLET,
    Positions__TOKEN_RECEIVED_NOT_CONCISTENT,
    PositionState
} from "./libraries/PositionTypes.sol";

import {PositionLogic} from "./libraries/PositionLogic.sol";

contract Positions is ERC721Enumerable, Ownable, ReentrancyGuard, Pausable {
    struct OpenPositionParams {
        address trader;
        address token0;
        uint24 fee;
        uint8 leverage;
        uint128 amount;
        uint160 limitPrice;
        uint256 stopLossPrice;
        address baseToken;
        address quoteToken;
        uint256 price;
        address v3Pool;
        bool isBaseToken0;
        bool isShort;
    }
    using SafeERC20 for IERC20;

    // Variables
    uint256 public constant LIQUIDATION_THRESHOLD = 1000; // 10% of margin
    uint256 public constant MIN_POSITION_AMOUNT_IN_USD = 1e18;
    uint256 public constant MAX_LEVERAGE = 5;
    uint256 public constant USD_DECIMALS = 18; // The standard for USD values in this contract
    /// @notice Slippage tolerance for Uniswap swaps, expressed as a fraction of 10000.
    /// 9900 = 1% slippage, 9700 = 3% slippage, 9500 = 5% slippage (minimum).
    /// Can be updated by the market owner (admin) to handle low-liquidity environments.
    uint256 public slippageTolerance = 9700; // default 3% slippage buffer
    // [FIX LOW-2] Deadline buffer passed to UniswapV3Helper swap calls.
    // block.timestamp alone gives zero MEV protection; this forces the tx to expire
    // if not included within 2 minutes, preventing validator-held reorder attacks.
    // 2 minutes is appropriate for Polygon (~2s blocks => ~60 blocks window).
    uint256 public constant SWAP_DEADLINE_BUFFER = 2 minutes;

    LiquidityPoolFactory public immutable LIQUIDITY_POOL_FACTORY;
    PriceFeedL1 public immutable PRICE_FEED;
    UniswapV3Helper public immutable UNISWAP_V3_HELPER;
    address public immutable LIQUIDITY_POOL_FACTORY_UNISWAP_V3;
    address public treasure;
    FeeManager public feeManager;

    event SlippageToleranceUpdated(uint256 oldTolerance, uint256 newTolerance);

    error Positions__SLIPPAGE_OUT_OF_RANGE(uint256 tolerance);

    /// @notice Update the slippage tolerance. Only callable by the Market (owner).
    /// @param _newTolerance New tolerance in basis points of 10000. Must be in [9500, 9990].
    function setSlippageTolerance(uint256 _newTolerance) external onlyOwner {
        if (_newTolerance < 9500 || _newTolerance > 9990) {
            revert Positions__SLIPPAGE_OUT_OF_RANGE(_newTolerance);
        }
        emit SlippageToleranceUpdated(slippageTolerance, _newTolerance);
        slippageTolerance = _newTolerance;
    }

    uint256 public posId = 1;
    uint256 public totalNbPos;
    mapping(uint256 => PositionParams) public openPositions;

    constructor(
        address _priceFeed,
        address _liquidityPoolFactory,
        address _liquidityPoolFactoryUniswapV3,
        address _uniswapV3Helper,
        address _treasure,
        address _feeManager
    ) ERC721("Uniswap-MAX", "UNIMAX") Ownable(msg.sender) {
        LIQUIDITY_POOL_FACTORY_UNISWAP_V3 = _liquidityPoolFactoryUniswapV3;
        LIQUIDITY_POOL_FACTORY = LiquidityPoolFactory(_liquidityPoolFactory);
        PRICE_FEED = PriceFeedL1(_priceFeed);
        UNISWAP_V3_HELPER = UniswapV3Helper(payable(_uniswapV3Helper));
        treasure = _treasure;
        feeManager = FeeManager(_feeManager);
    }

    modifier isPositionOpen(uint256 _posId) {
        _isPositionOpen(_posId);
        _;
    }
    function _isPositionOpen(uint256 _posId) internal view {
        if (_ownerOf(_posId) == address(0)) {
            revert Positions__POSITION_NOT_OPEN(_posId);
        }
    }

    modifier isPositionOwned(address _trader, uint256 _posId) {
        _isPositionOwned(_trader, _posId);
        _;
    }
    function _isPositionOwned(address _trader, uint256 _posId) internal view {
        if (ownerOf(_posId) != _trader) {
            revert Positions__POSITION_NOT_OWNED(_trader, _posId);
        }
    }

    modifier isLiquidable(uint256 _posId) {
        _isLiquidable(_posId);
        _;
    }
    function _isLiquidable(uint256 _posId) internal view {
        if (getPositionState(_posId) == PositionState.ACTIVE) {
            revert Positions__POSITION_NOT_LIQUIDABLE_YET(_posId);
        }
    }

    /**
     * @notice Pauses the contract in emergency situations
     * @dev Only owner can pause
     */
    function pause() external onlyOwner {
        _pause();
    }

    /**
     * @notice Unpauses the contract
     * @dev Only owner can unpause
     */
    function unpause() external onlyOwner {
        _unpause();
    }

    // --------------- ERC721 Zone ---------------

    // Implementing `onERC721Received` so this contract can receive custody of erc721 tokens
    function onERC721Received(
        address,
        address,
        uint256,
        bytes calldata
    ) external pure returns (bytes4) {
        return this.onERC721Received.selector;
    }

    function safeBurn(uint256 _posId) private {
        _burn(_posId);
    }

    // --------------- Trader Zone ---------------
    /**
     * @notice function to open a new positions
     * @param _trader trader address
     * @param _token0 token sent
     * @param _token1 token traded
     * @param _fee Uniswap V3 pool fee
     * @param _leverage leverage value 1 -> 5
     * @param _amount trade amount in token0
     * @param _limitPrice limit price in token1
     * @param _stopLossPrice stop loss price in token1
     * @return posId position Id
     */
    function openLongPosition(
        address _trader,
        address _token0,
        address _token1,
        uint24 _fee,
        uint8 _leverage,
        uint128 _amount,
        uint160 _limitPrice,
        uint256 _stopLossPrice
    ) external onlyOwner nonReentrant whenNotPaused returns (uint256) {
        PositionLogic.ValidationResult memory validationResult = PositionLogic
            .validateOpenLongPosition(
                PositionLogic.ValidationParams({
                    token0: _token0,
                    token1: _token1,
                    fee: _fee,
                    leverage: _leverage,
                    amount: _amount,
                    limitPrice: _limitPrice,
                    stopLossPrice: _stopLossPrice,
                    liquidityPoolFactoryUniswapV3: LIQUIDITY_POOL_FACTORY_UNISWAP_V3,
                    liquidityPoolFactory: address(LIQUIDITY_POOL_FACTORY),
                    priceFeed: address(PRICE_FEED),
                    maxLeverage: MAX_LEVERAGE,
                    minPositionAmountInUsd: MIN_POSITION_AMOUNT_IN_USD
                })
            );

        return _openPosition(
            OpenPositionParams({
                trader: _trader,
                token0: _token0,
                fee: _fee,
                leverage: _leverage,
                amount: _amount,
                limitPrice: _limitPrice,
                stopLossPrice: _stopLossPrice,
                baseToken: validationResult.baseToken,
                quoteToken: validationResult.quoteToken,
                price: validationResult.price,
                v3Pool: validationResult.v3Pool,
                isBaseToken0: validationResult.isBaseToken0,
                isShort: false
            })
        );
    }

    function openShortPosition(
        address _trader,
        address _token0,
        address _token1,
        uint24 _fee,
        uint8 _leverage,
        uint128 _amount,
        uint160 _limitPrice,
        uint256 _stopLossPrice
    ) external onlyOwner nonReentrant whenNotPaused returns (uint256) {
        PositionLogic.ValidationResult memory validationResult = PositionLogic
            .validateOpenShortPosition(
                PositionLogic.ValidationParams({
                    token0: _token0,
                    token1: _token1,
                    fee: _fee,
                    leverage: _leverage,
                    amount: _amount,
                    limitPrice: _limitPrice,
                    stopLossPrice: _stopLossPrice,
                    liquidityPoolFactoryUniswapV3: LIQUIDITY_POOL_FACTORY_UNISWAP_V3,
                    liquidityPoolFactory: address(LIQUIDITY_POOL_FACTORY),
                    priceFeed: address(PRICE_FEED),
                    maxLeverage: MAX_LEVERAGE,
                    minPositionAmountInUsd: MIN_POSITION_AMOUNT_IN_USD
                })
            );

        return _openPosition(
            OpenPositionParams({
                trader: _trader,
                token0: _token0,
                fee: _fee,
                leverage: _leverage,
                amount: _amount,
                limitPrice: _limitPrice,
                stopLossPrice: _stopLossPrice,
                baseToken: validationResult.baseToken,
                quoteToken: validationResult.quoteToken,
                price: validationResult.price,
                v3Pool: validationResult.v3Pool,
                isBaseToken0: validationResult.isBaseToken0,
                isShort: true
            })
        );
    }

    function _openPosition(OpenPositionParams memory params) private returns (uint256) {
        uint256 currentPosId = posId;

        // CACHE: Create IERC20 and other interface instances once to avoid repeated instantiations
        IERC20 token0 = IERC20(params.token0);
        IERC20 baseToken = IERC20(params.baseToken);
        IERC20 quoteToken = IERC20(params.quoteToken);
        IUniswapV3Pool v3Pool = IUniswapV3Pool(params.v3Pool);

        // Cache pool fee to avoid redundant external calls
        uint24 poolFee = v3Pool.fee();

        uint8 baseDecimals = IERC20Metadata(params.baseToken).decimals();
        uint256 baseDecimalsPow = 10 ** baseDecimals;
        uint8 quoteDecimals = IERC20Metadata(params.quoteToken).decimals();
        uint256 quoteDecimalsPow = 10 ** quoteDecimals;

        token0.safeTransferFrom(params.trader, address(this), params.amount);

        (uint128 treasureFee, uint128 liquidationRewardRate) = feeManager.getFees(params.trader);

        uint128 liquidationReward = uint128((params.amount * liquidationRewardRate) / 10000);
        params.amount = params.amount - liquidationReward;

        uint256 treasureAmount = (params.amount * treasureFee) / 10000;
        token0.safeTransfer(treasure, treasureAmount);
        params.amount = params.amount - uint128(treasureAmount);

        address collateralToken = params.isShort ? params.quoteToken : params.baseToken;
        uint128 baseCollateralAmount;
        if (params.token0 != collateralToken) {
            // OPTIMIZED: Only approve if current allowance is insufficient
            uint256 currentAllowance = token0.allowance(address(this), address(UNISWAP_V3_HELPER));
            if (currentAllowance < params.amount) {
                SafeERC20.forceApprove(token0, address(UNISWAP_V3_HELPER), params.amount);
            }

            uint256 priceToCollateral = PRICE_FEED.getPairLatestPrice(params.token0, collateralToken);
            uint256 minOut = (params.amount * priceToCollateral) / (params.isShort ? baseDecimalsPow : quoteDecimalsPow);
            minOut = (minOut * slippageTolerance) / 10000;

            baseCollateralAmount = uint128(
                UNISWAP_V3_HELPER.swapExactInputSingle(
                    params.token0, collateralToken, poolFee, params.amount, minOut,
                    block.timestamp + SWAP_DEADLINE_BUFFER
                )
            );
        } else {
            baseCollateralAmount = params.amount;
        }

        // Use library function for position calculations
        PositionLogic.PositionOpeningCalcParams memory calcParams = PositionLogic
            .PositionOpeningCalcParams({
                price: params.price,
                leverage: params.leverage,
                baseCollateralAmount: baseCollateralAmount,
                baseDecimals: baseDecimals,
                baseDecimalsPow: baseDecimalsPow,
                isShort: params.isShort,
                baseToken: params.baseToken,
                quoteToken: params.quoteToken
            });

        PositionLogic.PositionOpeningCalcResult memory calcResult = PositionLogic
            .calculatePositionOpening(calcParams);

        address cacheLiquidityPoolToUse = LiquidityPoolFactory(LIQUIDITY_POOL_FACTORY)
            .getTokenToLiquidityPools(calcResult.liquidityPoolToken);

        LiquidityPool(cacheLiquidityPoolToUse).borrow(calcResult.totalBorrow);

        // Use cached token instance for borrowToken (quoteToken for long, baseToken for short)
        IERC20 borrowToken = params.isShort ? baseToken : quoteToken;
        
        // OPTIMIZED: Only approve if current allowance is insufficient
        uint256 borrowAllowance = borrowToken.allowance(address(this), address(UNISWAP_V3_HELPER));
        if (borrowAllowance < calcResult.totalBorrow) {
            SafeERC20.forceApprove(borrowToken, address(UNISWAP_V3_HELPER), calcResult.totalBorrow);
        }

        (address swapFrom, address swapTo) = params.isShort
            ? (params.baseToken, params.quoteToken)
            : (params.quoteToken, params.baseToken);

        uint256 priceBorrow = PRICE_FEED.getPairLatestPrice(swapFrom, swapTo);
        uint256 minOutBorrow = (calcResult.totalBorrow * priceBorrow) /
            (params.isShort ? baseDecimalsPow : quoteDecimalsPow);
        minOutBorrow = (minOutBorrow * slippageTolerance) / 10000;

        uint256 amountBorrow = UNISWAP_V3_HELPER.swapExactInputSingle(
            swapFrom,
            swapTo,
            poolFee,
            calcResult.totalBorrow,
            minOutBorrow,
            block.timestamp + SWAP_DEADLINE_BUFFER
        );

        uint128 positionSize = params.isShort
            ? uint128(amountBorrow)
            : uint128(baseCollateralAmount + amountBorrow);

        openPositions[currentPosId] = PositionParams({
            initialPrice: params.price,
            totalBorrow: calcResult.totalBorrow,
            liquidationFloor: calcResult.liquidationFloor,
            stopLossPrice: params.stopLossPrice,
            v3Pool: params.v3Pool,
            limitPrice: params.limitPrice,
            baseToken: baseToken,
            quoteToken: quoteToken,
            collateralSize: baseCollateralAmount,
            positionSize: positionSize,
            liquidationReward: liquidationReward,
            timestamp: uint64(block.timestamp),
            blockNumber: uint64(block.number),
            isShort: params.isShort,
            isBaseToken0: params.isBaseToken0,
            leverage: params.leverage,
            initialToken: token0
        });

        unchecked {
            ++totalNbPos;
            ++posId;
        }

        _mint(params.trader, currentPosId);
        return currentPosId;
    }

    /**
     * @notice function to close a position can only be call by the position owner
     * @param _trader trader address
     * @param _posId position Id
     */
    function closePosition(
        address _trader,
        uint256 _posId
    ) external onlyOwner isPositionOwned(_trader, _posId) nonReentrant whenNotPaused {
        _closePosition(_trader, _posId);
    }

    /**
     * @notice function to liquidate a position canbe call be every one
     * @param _liquidator liquidator address
     * @param _posId position Id
     */
    function liquidatePosition(
        address _liquidator,
        uint256 _posId
    ) external onlyOwner isLiquidable(_posId) nonReentrant whenNotPaused {
        _closePosition(_liquidator, _posId);
    }

    /**
     * @dev Close/Liquidate a position
     * @notice the 5 states:
     * - 1. The position crossed over the limit ordre
     * - 2. Nothing happened => just refund the trader
     * - 3. The position crossed over the stop loss
     * - 4. Liquidation threshold => no bad debt
     * - 5. Protocol loss => bad debt
     * - 6. The position is liquidable by time limit
     */
    function _closePosition(address _liquidator, uint256 _posId) internal isPositionOpen(_posId) {
        address trader = ownerOf(_posId);
        PositionParams memory posParms = openPositions[_posId];
        PositionState state = getPositionState(_posId);

        // CEI fix: clean state early
        unchecked {
            --totalNbPos;
        }
        delete openPositions[_posId];
        safeBurn(_posId);

        // CACHE: Create IERC20 instances once to avoid repeated instantiations
        IERC20 baseToken = posParms.baseToken;
        IERC20 quoteToken = posParms.quoteToken;
        IERC20 initialToken = posParms.initialToken;
        address baseTokenAddr = address(baseToken);
        address quoteTokenAddr = address(quoteToken);
        address initialTokenAddr = address(initialToken);

        // Cache pool fee to avoid redundant external calls
        uint24 poolFee = IUniswapV3Pool(posParms.v3Pool).fee();

        LiquidityPool liquidityPoolToUse = LiquidityPool(
            LiquidityPoolFactory(LIQUIDITY_POOL_FACTORY).getTokenToLiquidityPools(
                posParms.isShort ? baseTokenAddr : quoteTokenAddr
            )
        );

        (uint128 treasureFee, ) = feeManager.getFees(trader);

        uint256 amount0;
        uint256 amount1;
        address addTokenReceived;
        address addTokenInitiallySupplied;
        address addTokenBorrowed;
        // Close position
        if (posParms.isShort) {
            posParms.isBaseToken0
                ? amount1 = posParms.positionSize
                : amount0 = posParms.positionSize;
        } else {
            posParms.isBaseToken0
                ? amount0 = posParms.positionSize
                : amount1 = posParms.positionSize;
        }

        // prettier-ignore
        addTokenReceived = (amount0 != 0)
            ? posParms.isBaseToken0
                ? baseTokenAddr
                : quoteTokenAddr
            : posParms.isBaseToken0
                ? quoteTokenAddr
                : baseTokenAddr;

        addTokenInitiallySupplied = initialTokenAddr;
        // will be used if margin position
        addTokenBorrowed = posParms.isShort
            ? baseTokenAddr
            : quoteTokenAddr;

        uint256 amountTokenReceived = amount0 != 0 ? amount0 : amount1;

        address tokenToTrader = addTokenReceived == baseTokenAddr
            ? quoteTokenAddr
            : baseTokenAddr;

        // CACHE: Create IERC20 for received token (used multiple times)
        IERC20 addTokenReceivedErc20 = IERC20(addTokenReceived);

        // These state assume that the oracle price and the uniswap price are CONCISTENT
        if (addTokenBorrowed == addTokenReceived) {
            revert Positions__TOKEN_RECEIVED_NOT_CONCISTENT(
                addTokenBorrowed,
                addTokenReceived,
                2345
            );
        }

        // when margin we need to swap back to refund the pool
        // but when refund the trader with the token received
        if (posParms.isShort) {
            amountTokenReceived += posParms.collateralSize;
        }
        // we need first to swap back to refund the pool
        (uint256 inAmount, uint256 outAmount) = swapMaxTokenPossible(
            addTokenReceived,
            tokenToTrader,
            poolFee,
            posParms.totalBorrow,
            amountTokenReceived
        );
        // loss should not occur here but in case of, we refund the pool
        int256 remaining = int256(int(outAmount) - int(posParms.totalBorrow));
        uint256 loss = remaining < 0 ? uint256(-remaining) : uint256(0);

        // OPTIMIZED: Cache IERC20 for borrowed token and check allowance before approve
        IERC20 addTokenBorrowedErc20 = IERC20(addTokenBorrowed);
        uint256 currentAllowance = addTokenBorrowedErc20.allowance(address(this), address(liquidityPoolToUse));
        if (currentAllowance < posParms.totalBorrow - loss) {
            SafeERC20.forceApprove(
                addTokenBorrowedErc20,
                address(liquidityPoolToUse),
                posParms.totalBorrow - loss
            );
        }

        liquidityPoolToUse.refund(posParms.totalBorrow, 0, loss);
        if (loss == 0) {
            uint256 netReceivedBeforeFee = amountTokenReceived - inAmount;
            uint256 profit = 0;
            if (netReceivedBeforeFee > posParms.collateralSize) {
                profit = netReceivedBeforeFee - posParms.collateralSize;
            }
            uint256 treasureAmount = (profit * treasureFee) / 10000;
            if (treasureAmount > 0) {
                addTokenReceivedErc20.safeTransfer(treasure, treasureAmount);
            }

            uint256 netReceived = netReceivedBeforeFee - treasureAmount;
            if (initialTokenAddr != addTokenReceived) {
                // OPTIMIZED: Check allowance before approve
                uint256 helperAllowance = addTokenReceivedErc20.allowance(address(this), address(UNISWAP_V3_HELPER));
                if (helperAllowance < netReceived) {
                    SafeERC20.forceApprove(
                        addTokenReceivedErc20,
                        address(UNISWAP_V3_HELPER),
                        netReceived
                    );
                }

                uint256 priceBaseToQuote = PRICE_FEED.getPairLatestPrice(
                    addTokenReceived,
                    initialTokenAddr
                );
                uint256 minOut = (netReceived * priceBaseToQuote) /
                    (10 ** IERC20Metadata(addTokenReceived).decimals());
                minOut = (minOut * slippageTolerance) / 10000;

                uint256 finalOut = UNISWAP_V3_HELPER.swapExactInputSingle(
                    addTokenReceived,
                    initialTokenAddr,
                    poolFee,
                    netReceived,
                    minOut,
                    block.timestamp + SWAP_DEADLINE_BUFFER
                );
                initialToken.safeTransfer(trader, finalOut);
            } else {
                addTokenReceivedErc20.safeTransfer(trader, netReceived);
            }
        }
        IERC20(addTokenInitiallySupplied).safeTransfer(_liquidator, posParms.liquidationReward);
    }

    /**
     * @notice function to edit a position. We can only edit the stop loss price for now.
     * @param _trader trader address
     * @param _posId position Id
     * @param _newStopLossPrice new SL
     */
    function editPosition(
        address _trader,
        uint256 _posId,
        uint256 _newStopLossPrice
    ) external onlyOwner isPositionOwned(_trader, _posId) nonReentrant whenNotPaused {
        PositionParams storage pos = openPositions[_posId];
        uint256 price = PRICE_FEED.getPairLatestPrice(
            address(pos.baseToken),
            address(pos.quoteToken)
        );
        if (pos.isShort) {
            if (_newStopLossPrice < price) {
                revert Positions__STOP_LOSS_ORDER_PRICE_NOT_CONCISTENT(_newStopLossPrice);
            }
        } else {
            if (_newStopLossPrice > price) {
                revert Positions__STOP_LOSS_ORDER_PRICE_NOT_CONCISTENT(_newStopLossPrice);
            }
        }
        pos.stopLossPrice = _newStopLossPrice;
    }

    /**
     * @notice 5 states:
     * - 1. The position crossed over the limit ordre
     * - 2. Nothing happened => just refund the trader
     * - 3. The position crossed over the stop loss
     * - 4. The position is liquidable => no bad debt
     * - 5. The position is liquidable => bad debt
     * - 6. The position is liquidable by time limit
     * @param _posId position Id
     */
    function getPositionState(uint256 _posId) public view returns (PositionState) {
        if (_ownerOf(_posId) == address(0)) {
            return PositionState.NONE;
        }
        PositionParams storage pos = openPositions[_posId];
        bool isShort = pos.isShort;
        uint256 liquidationFloor = pos.liquidationFloor;
        uint160 limitPrice = pos.limitPrice;
        uint256 stopLossPrice = pos.stopLossPrice;
        uint256 price = PRICE_FEED.getPairLatestPrice(
            address(pos.baseToken),
            address(pos.quoteToken)
        );
        uint256 lidTresh = isShort
            ? (liquidationFloor * (10000 - LIQUIDATION_THRESHOLD)) / 10000
            : (liquidationFloor * (LIQUIDATION_THRESHOLD + 10000)) / 10000;

        if (isShort) {
            if (limitPrice != 0 && price < limitPrice) return PositionState.TAKE_PROFIT;
            if (liquidationFloor != 0 && price >= liquidationFloor) return PositionState.BAD_DEBT;
            if (lidTresh != 0 && price >= lidTresh) return PositionState.LIQUIDATABLE;
            if (stopLossPrice != 0 && price >= stopLossPrice) return PositionState.STOP_LOSS;
        } else {
            if (limitPrice != 0 && price > limitPrice) return PositionState.TAKE_PROFIT;
            if (liquidationFloor != 0 && price <= liquidationFloor) return PositionState.BAD_DEBT;
            if (lidTresh != 0 && price <= lidTresh) return PositionState.LIQUIDATABLE;
            if (stopLossPrice != 0 && price <= stopLossPrice) return PositionState.STOP_LOSS;
        }

        address positionOwner = _ownerOf(_posId);
        uint256 timeBasedExpiry = feeManager.getPositionLifeTime(positionOwner);
        uint256 blockBasedExpiry = feeManager.getPositionLifeBlocks(positionOwner);

        bool timeExpired = block.timestamp - pos.timestamp > timeBasedExpiry;
        bool blocksExpired = block.number - pos.blockNumber > blockBasedExpiry;

        if (timeExpired && blocksExpired) {
            return PositionState.EXPIRED;
        }
        return PositionState.ACTIVE;
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
            uint256 liquidationFloor_,
            uint160 limitPrice_,
            uint256 stopLossPrice_,
            int128 currentPnL_,
            int128 collateralLeft_
        )
    {
        PositionParams storage pos = openPositions[_posId];
        baseToken_ = address(pos.baseToken);
        quoteToken_ = address(pos.quoteToken);
        positionSize_ = pos.positionSize;
        timestamp_ = pos.timestamp;
        isShort_ = pos.isShort;
        leverage_ = pos.leverage;
        liquidationFloor_ = pos.liquidationFloor;
        limitPrice_ = pos.limitPrice;
        stopLossPrice_ = pos.stopLossPrice;

        uint256 initialPrice = pos.initialPrice;
        uint256 currentPrice = PRICE_FEED.getPairLatestPrice(baseToken_, quoteToken_);

        // Cache pool fee to avoid redundant external calls
        uint24 poolFee = IUniswapV3Pool(pos.v3Pool).fee();

        // Use PositionLogic library to calculate PnL
        PositionLogic.PnLCalculationParams memory pnlParams = PositionLogic.PnLCalculationParams({
            initialPrice: initialPrice,
            currentPrice: currentPrice,
            totalBorrow: pos.totalBorrow,
            positionSize: pos.positionSize,
            collateralSize: pos.collateralSize,
            leverage: pos.leverage,
            isShort: isShort_,
            initialToken: address(pos.initialToken),
            priceFeed: address(PRICE_FEED),
            poolFee: poolFee,
            feeManager: address(feeManager),
            trader: ownerOf(_posId)
        });
        
        PositionLogic.PnLCalculationResult memory pnlResult = PositionLogic.calculatePnL(pnlParams);
        currentPnL_ = pnlResult.currentPnL;
        collateralLeft_ = pnlResult.collateralLeft;
    }

    function swapMaxTokenPossible(
        address _token0,
        address _token1,
        uint24 _fee,
        uint256 amountOut,
        uint256 amountInMaximum
    ) private returns (uint256, uint256) {
        uint256 token0DecimalsPow = 10 ** IERC20Metadata(_token0).decimals();
        uint256 deadline = block.timestamp + SWAP_DEADLINE_BUFFER;

        // [FIX CRIT-1] Wrap oracle call in try/catch.
        // If the price feed is stale or the sequencer is down at the moment of
        // liquidation, the old bare call reverted — permanently locking bad-debt
        // positions and preventing the LiquidityPool from recovering its funds.
        // When the oracle is unavailable we fall through to the exactInput fallback
        // with minOut = 0 (accepting any output). This is an emergency-only path;
        // the MEV risk is accepted because the alternative (permanent lock) is worse.
        uint256 priceFeedRate;
        bool oracleAvailable;
        try PRICE_FEED.getPairLatestPrice(_token0, _token1) returns (uint256 rate) {
            priceFeedRate = rate;
            oracleAvailable = true;
        } catch {
            oracleAvailable = false;
        }

        IERC20 token0Erc20 = IERC20(_token0);

        // Normal path: oracle available — attempt a precise exactOutput swap bounded
        // by the oracle-derived maxSwapCost (already guards against CRIT-2 MEV).
        if (oracleAvailable && priceFeedRate > 0) {
            uint256 expectedCost = (amountOut * token0DecimalsPow) / priceFeedRate;
            uint256 maxSwapCost = (expectedCost * (20000 - slippageTolerance)) / 10000;

            if (maxSwapCost <= amountInMaximum && expectedCost <= amountInMaximum) {
                uint256 currentAllowance = token0Erc20.allowance(address(this), address(UNISWAP_V3_HELPER));
                if (currentAllowance < maxSwapCost) {
                    SafeERC20.forceApprove(token0Erc20, address(UNISWAP_V3_HELPER), maxSwapCost);
                }

                try UNISWAP_V3_HELPER.swapExactOutputSingle(
                    _token0,
                    _token1,
                    _fee,
                    amountOut,
                    maxSwapCost,
                    deadline
                ) returns (uint256 swapCost) {
                    return (swapCost, amountOut);
                } catch {
                    // Fallback to exactInputSingle if exact output fails (bad debt path)
                }
            }
        }

        // Fallback path: bad debt OR oracle unavailable.
        // Dump the full amountInMaximum via exactInput to recover as much as possible.
        uint256 currentAllowanceFallback = token0Erc20.allowance(address(this), address(UNISWAP_V3_HELPER));
        if (currentAllowanceFallback < amountInMaximum) {
            SafeERC20.forceApprove(token0Erc20, address(UNISWAP_V3_HELPER), amountInMaximum);
        }

        // Use oracle-derived minOut when available; 0 only in emergency (oracle down).
        uint256 minOut = 0;
        if (oracleAvailable && priceFeedRate > 0) {
            minOut = (amountInMaximum * priceFeedRate) / token0DecimalsPow;
            minOut = (minOut * slippageTolerance) / 10000;
        }

        uint256 outAmount = UNISWAP_V3_HELPER.swapExactInputSingle(
            _token0,
            _token1,
            _fee,
            amountInMaximum,
            minOut,
            deadline
        );
        return (amountInMaximum, outAmount);
    }

    function getTraderPositions(address _traderAdd) external view returns (uint256[] memory) {
        uint256 nbOfPositions = balanceOf(_traderAdd);
        uint256[] memory traderPositions = new uint256[](nbOfPositions);
        for (uint256 i = 0; i < nbOfPositions; i++) {
            traderPositions[i] = tokenOfOwnerByIndex(_traderAdd, i);
        }
        return traderPositions;
    }

    function getLiquidablePositions() external view returns (uint256[] memory) {
        uint256 totalActive = totalSupply();
        uint256[] memory tempPositions = new uint256[](totalActive);
        uint256 count = 0;
        
        for (uint256 i = 0; i < totalActive; i++) {
            uint256 id = tokenByIndex(i);
            PositionState state = getPositionState(id);
            if (state != PositionState.ACTIVE && state != PositionState.NONE) {
                tempPositions[count] = id;
                count++;
            }
        }
        
        uint256[] memory liquidablePositions = new uint256[](count);
        for (uint256 j = 0; j < count; j++) {
            liquidablePositions[j] = tempPositions[j];
        }
        return liquidablePositions;
    }
}
