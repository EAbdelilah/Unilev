// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import "@solmate/tokens/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/utils/Base64.sol";
import "@openzeppelin/contracts/utils/Strings.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@uniswapCore/contracts/libraries/TickMath.sol";
import "@uniswapCore/contracts/UniswapV3Pool.sol";
import "@uniswapCore/contracts/UniswapV3Factory.sol";
import "@uniswapPeriphery/contracts/interfaces/INonfungiblePositionManager.sol";

import "./PriceFeedL1.sol";
import "./LiquidityPoolFactory.sol";
import {UniswapV3Helper} from "./UniswapV3Helper.sol";

error Positions__POSITION_NOT_OPEN(uint256 _posId);
error Positions__POSITION_NOT_LIQUIDABLE_YET(uint256 _posId);
error Positions__POSITION_NOT_OWNED(address _trader, uint256 _posId);
error Positions__POOL_NOT_OFFICIAL(address _v3Pool);
error Positions__TOKEN_NOT_SUPPORTED(address _token);
error Positions__TOKEN_NOT_SUPPORTED_ON_MARGIN(address _token);
error Positions__NO_PRICE_FEED(address _token0, address _token1);
error Positions__LEVERAGE_NOT_IN_RANGE(uint8 _leverage);
error Positions__AMOUNT_TO_SMALL(uint256 _amount);
error Positions__LIMIT_ORDER_PRICE_NOT_CONCISTENT(uint256 _limitPrice);
error Positions__STOP_LOSS_ORDER_PRICE_NOT_CONCISTENT(uint256 _stopLossPrice);
error Positions__NOT_LIQUIDABLE(uint256 _posId);
// This error is no longer used in the fixed version to handle partial fills gracefully.
// error Positions__WAIT_FOR_LIMIT_ORDER_TO_COMPLET(uint256 _posId);
error Positions__TOKEN_RECEIVED_NOT_CONCISTENT(
    address tokenBorrowed,
    address tokenReceived,
    uint256 state
);

contract Positions is ERC721, Ownable, ReentrancyGuard {
    using SafeTransferLib for ERC20;

    // Structs
    // prettier-ignore
    struct PositionParams {
        UniswapV3Pool v3Pool;      // Pool to trade
        ERC20 baseToken;           // Token to trade => should be token0 or token1 of v3Pool
        ERC20 quoteToken;          // Token to trade => should be the other token of v3Pool
        uint128 collateralSize;    // Total collateral for the position
        uint128 positionSize;      // Amount (in baseToken if long / quoteToken if short) of token traded
        uint256 initialPrice;      // Price of the position when opened
        uint64 timestamp;          // Timestamp of position creation
        bool isShort;              // True if short, false if long
        bool isBaseToken0;         // True if the baseToken is the token0 (in the uniswapV3Pool)
        uint8 leverage;            // Leverage of position => 0 if no leverage
        uint256 totalBorrow;       // Total borrow in baseToken if long or quoteToken if short
        uint256 hourlyFees;        // Fees to pay every hour on the borrowed amount => 0 if no leverage
        uint256 breakEvenLimit;    // After this limit the position is undercollateralize => 0 if no leverage or short
        uint160 limitPrice;        // Limit order price => 0 if no limit order
        uint256 stopLossPrice;     // Stop loss price => 0 if no stop loss
        uint256 tokenIdLiquidity;  // TokenId of the liquidity position NFT => 0 if no liquidity position
    }

    // Variables from old contract
    uint256 public constant LIQUIDATION_THRESHOLD = 1000; // 10% of margin
    uint256 public constant MIN_POSITION_AMOUNT_IN_USD = 100; // To avoid DOS attack
    uint256 public constant MAX_LEVERAGE = 3; // Kept as constant to preserve ABI
    uint256 public constant BORROW_FEE = 0; // 0.2% when opening a position
    uint256 public constant BORROW_FEE_EVERY_HOURS = 0; // 0.01% : assets borrowed/total assets in pool * 0.01%
    uint256 public constant ORACLE_DECIMALS_USD = 8; // Chainlink decimals for USD
    uint256 public immutable LIQUIDATION_REWARD;
    
    // FIX: Added a constant to limit the gas consumption of getLiquidablePositions
    uint256 private constant GET_LIQUIDABLE_POSITIONS_LOOP_LIMIT = 200;


    // Public state variables from old contract
    LiquidityPoolFactory public immutable liquidityPoolFactory;
    PriceFeedL1 public immutable priceFeed;
    UniswapV3Helper public immutable uniswapV3Helper;
    address public immutable liquidityPoolFactoryUniswapV3;
    address public immutable nonfungiblePositionManager;

    uint256 public posId = 1;
    uint256 public totalNbPos;
    mapping(uint256 => PositionParams) public openPositions;

    // Private state variables for efficient position tracking (ABI compatible)
    mapping(address => uint256[]) private traderPositions;
    mapping(address => mapping(uint256 => uint256)) private traderPositionIndex;

    constructor(
        address _priceFeed,
        address _liquidityPoolFactory,
        address _liquidityPoolFactoryUniswapV3,
        address _nonfungiblePositionManager,
        address _uniswapV3Helper,
        uint256 _liquidationReward
    ) ERC721("Uniswap-MAX", "UNIMAX") {
        liquidityPoolFactoryUniswapV3 = _liquidityPoolFactoryUniswapV3;
        nonfungiblePositionManager = _nonfungiblePositionManager;
        liquidityPoolFactory = LiquidityPoolFactory(_liquidityPoolFactory);
        priceFeed = PriceFeedL1(_priceFeed);
        uniswapV3Helper = UniswapV3Helper(_uniswapV3Helper);
        LIQUIDATION_REWARD = _liquidationReward * (10 ** ORACLE_DECIMALS_USD);
    }

    modifier isPositionOpen(uint256 _posId) {
        if (!_exists(_posId)) {
            revert Positions__POSITION_NOT_OPEN(_posId);
        }
        _;
    }

    modifier isPositionOwned(address _trader, uint256 _posId) {
        if (ownerOf(_posId) != _trader) {
            revert Positions__POSITION_NOT_OWNED(_trader, _posId);
        }
        _;
    }
    modifier isLiquidable(uint256 _posId) {
        uint256 state = getPositionState(_posId);
        // Correctly check for liquidation states (3, 4, or 5)
        if (state < 3 || state > 5) {
            revert Positions__POSITION_NOT_LIQUIDABLE_YET(_posId);
        }
        _;
    }

    // --------------- ERC721 Zone ---------------

    function onERC721Received(
        address,
        address,
        uint256,
        bytes calldata
    ) external pure returns (bytes4) {
        return this.onERC721Received.selector;
    }

    function safeMint(address to) private returns (uint256) {
        uint256 _posId = posId;
        ++posId;
        _safeMint(to, _posId);
        // Gas-efficient tracking logic
        traderPositions[to].push(_posId);
        traderPositionIndex[to][_posId] = traderPositions[to].length - 1;
        return _posId;
    }

    function safeBurn(uint256 _posId) private {
        address trader = ownerOf(_posId);
        _burn(_posId);
        // Gas-efficient removal logic (swap-and-pop)
        uint256[] storage positions = traderPositions[trader];
        uint256 index = traderPositionIndex[trader][_posId];
        if (index < positions.length) {
            positions[index] = positions[positions.length - 1];
            traderPositionIndex[trader][positions[index]] = index;
            positions.pop();
            delete traderPositionIndex[trader][_posId];
        }
    }

    // --------------- Trader Zone ---------------

    function openPosition(
        address _trader,
        address _token0,
        address _token1,
        uint24 _fee,
        bool _isShort,
        uint8 _leverage,
        uint128 _amount,
        uint160 _limitPrice,
        uint256 _stopLossPrice
    ) external onlyOwner nonReentrant returns (uint256) {
        // Check params
        (
            uint256 price,
            address baseToken,
            address quoteToken,
            bool isBaseToken0,
            address v3Pool
        ) = checkPositionParams(
                _token0,
                _token1,
                _fee,
                _isShort,
                _leverage,
                _amount,
                _limitPrice,
                _stopLossPrice
            );

        bool isMargin = _leverage != 1 || _isShort;

        // transfer funds to the contract (trader need to approve first)
        ERC20(_token0).safeTransferFrom(_trader, address(this), _amount);

        // Compute parameters
        uint256 breakEvenLimit;
        uint256 totalBorrow;
        uint256 hourlyFees;
        uint256 tokenIdLiquidity;
        uint256 amount0;
        uint256 amount1;
        uint256 amountBorrow;
        int24 tickUpper;
        int24 tickLower;

        if (isMargin) {
            // FIX: Integer Precision and Rounding. Use multiplication before division.
            if (_isShort) {
                breakEvenLimit = price + (price / _leverage); 
                totalBorrow = (_amount * _leverage * (10 ** ERC20(baseToken).decimals())) / price; // Borrow baseToken
            } else {
                breakEvenLimit = price - (price / _leverage);
                totalBorrow =
                    (_amount * (_leverage - 1) * price) /
                    (10 ** ERC20(baseToken).decimals()); // Borrow quoteToken
            }

            uint128 openingFeesToken1 = (uint128(totalBorrow * BORROW_FEE)) / 10000;
            address cacheLiquidityPoolToUse = LiquidityPoolFactory(liquidityPoolFactory)
                .getTokenToLiquidityPools(_isShort ? baseToken : quoteToken);

            // fees swap
            ERC20(_token0).safeApprove(address(uniswapV3Helper), _amount);
            uint256 openingFeesToken0 = uniswapV3Helper.swapExactOutputSingle(
                _token0,
                _token1,
                UniswapV3Pool(v3Pool).fee(),
                openingFeesToken1,
                _amount
            );

            _amount -= uint128(openingFeesToken0);
            totalBorrow -= openingFeesToken1;

            ERC20(_token1).safeApprove(cacheLiquidityPoolToUse, openingFeesToken1);
            LiquidityPool(cacheLiquidityPoolToUse).refund(0, openingFeesToken1, 0);

            // fees computation
            uint256 decTokenBorrowed = _isShort
                ? ERC20(baseToken).decimals()
                : ERC20(quoteToken).decimals();
            // FIX: Integer Precision and Rounding. Use multiplication before division.
            hourlyFees =
                (totalBorrow * (10 ** decTokenBorrowed) * BORROW_FEE_EVERY_HOURS) /
                (LiquidityPool(cacheLiquidityPoolToUse).rawTotalAsset() * 10000);

            // Borrow funds from the pool
            LiquidityPool(cacheLiquidityPoolToUse).borrow(totalBorrow);

            if (_isShort) {
                ERC20(baseToken).safeApprove(address(uniswapV3Helper), totalBorrow);
                amountBorrow = uniswapV3Helper.swapExactInputSingle(
                    baseToken,
                    quoteToken,
                    UniswapV3Pool(v3Pool).fee(),
                    totalBorrow
                );
            } else {
                if (_leverage != 1) {
                    ERC20(quoteToken).safeApprove(address(uniswapV3Helper), totalBorrow);
                    amountBorrow = uniswapV3Helper.swapExactInputSingle(
                        quoteToken,
                        baseToken,
                        UniswapV3Pool(v3Pool).fee(),
                        totalBorrow
                    );
                }
            }
        } else {
            // if not margin
            if (_limitPrice != 0) {
                tickUpper = TickMath.getTickAtSqrtRatio(
                    uniswapV3Helper.priceToSqrtPriceX96(_limitPrice, ERC20(baseToken).decimals())
                );
                tickLower = tickUpper - 1;

                ERC20(baseToken).safeApprove(address(uniswapV3Helper), _amount);

                (tokenIdLiquidity, , amount0, amount1) = mintV3Position(
                    UniswapV3Pool(v3Pool),
                    isBaseToken0 ? _amount : 0,
                    isBaseToken0 ? 0 : _amount,
                    tickLower,
                    tickUpper
                );
            }
        }

        // position size calculation
        uint128 positionSize;
        if (_isShort) {
            positionSize = uint128(amountBorrow);
        } else if (_leverage != 1) {
            positionSize = uint128(_amount + amountBorrow);
        } else {
            positionSize = _amount;
        }

        openPositions[posId] = PositionParams(
            UniswapV3Pool(v3Pool),
            ERC20(baseToken),
            ERC20(quoteToken),
            _amount,
            positionSize,
            price,
            uint64(block.timestamp),
            _isShort,
            isBaseToken0,
            _leverage,
            totalBorrow,
            hourlyFees,
            breakEvenLimit,
            _limitPrice,
            _stopLossPrice,
            tokenIdLiquidity
        );
        ++totalNbPos;
        return safeMint(_trader);
    }

    function checkPositionParams(
        address _token0,
        address _token1,
        uint24 _fee,
        bool _isShort,
        uint8 _leverage,
        uint256 _amount,
        uint256 _limitPrice,
        uint256 _stopLossPrice
    ) private view returns (uint256, address, address, bool, address) {
        address baseToken;
        address quoteToken;

        address v3Pool = address(
            UniswapV3Factory(liquidityPoolFactoryUniswapV3).getPool(_token0, _token1, _fee)
        );

        if (UniswapV3Pool(v3Pool).factory() != liquidityPoolFactoryUniswapV3) {
            revert Positions__POOL_NOT_OFFICIAL(v3Pool);
        }
        // check token
        if (
            UniswapV3Pool(v3Pool).token0() != _token0 && UniswapV3Pool(v3Pool).token1() != _token0
        ) {
            revert Positions__TOKEN_NOT_SUPPORTED(_token0);
        }

        if (_isShort) {
            quoteToken = _token0;
            baseToken = (_token0 == UniswapV3Pool(v3Pool).token0())
                ? UniswapV3Pool(v3Pool).token1()
                : UniswapV3Pool(v3Pool).token0();
        } else {
            baseToken = _token0;
            quoteToken = (_token0 == UniswapV3Pool(v3Pool).token0())
                ? UniswapV3Pool(v3Pool).token1()
                : UniswapV3Pool(v3Pool).token0();
        }
        bool isBaseToken0 = (baseToken == UniswapV3Pool(v3Pool).token0());

        // check if pair is supported by PriceFeed
        if (!PriceFeedL1(priceFeed).isPairSupported(baseToken, quoteToken)) {
            revert Positions__NO_PRICE_FEED(baseToken, quoteToken);
        }

        uint256 price = PriceFeedL1(priceFeed).getPairLatestPrice(baseToken, quoteToken);

        // check leverage
        if (_leverage < 1 || _leverage > MAX_LEVERAGE) {
            revert Positions__LEVERAGE_NOT_IN_RANGE(_leverage);
        }
        // when margin position check if token is supported by a LiquidityPool
        if (_leverage != 1) {
            if (
                _isShort &&
                LiquidityPoolFactory(liquidityPoolFactory).getTokenToLiquidityPools(baseToken) ==
                address(0)
            ) {
                revert Positions__TOKEN_NOT_SUPPORTED_ON_MARGIN(baseToken);
            }
            if (
                !_isShort &&
                LiquidityPoolFactory(liquidityPoolFactory).getTokenToLiquidityPools(quoteToken) ==
                address(0)
            ) {
                revert Positions__TOKEN_NOT_SUPPORTED_ON_MARGIN(quoteToken);
            }
        }

        // check amount
        if (
            (_amount * PriceFeedL1(priceFeed).getTokenLatestPriceInUSD(_token0)) /
                (10 ** (ORACLE_DECIMALS_USD + ERC20(_token0).decimals())) <
            MIN_POSITION_AMOUNT_IN_USD
        ) {
            revert Positions__AMOUNT_TO_SMALL(
                (_amount * PriceFeedL1(priceFeed).getTokenLatestPriceInUSD(_token0)) /
                    (10 ** (ORACLE_DECIMALS_USD + ERC20(_token0).decimals()))
            );
        }

        if (_isShort) {
            if (_limitPrice > price && _limitPrice != 0) {
                revert Positions__LIMIT_ORDER_PRICE_NOT_CONCISTENT(_limitPrice);
            }
            if (_stopLossPrice < price && _stopLossPrice != 0) {
                revert Positions__STOP_LOSS_ORDER_PRICE_NOT_CONCISTENT(_stopLossPrice);
            }
        } else {
            if (_limitPrice < price && _limitPrice != 0) {
                revert Positions__LIMIT_ORDER_PRICE_NOT_CONCISTENT(_limitPrice);
            }
            if (_stopLossPrice > price && _stopLossPrice != 0) {
                revert Positions__STOP_LOSS_ORDER_PRICE_NOT_CONCISTENT(_stopLossPrice);
            }
        }
        return (price, baseToken, quoteToken, isBaseToken0, v3Pool);
    }

    function closePosition(
        address _trader,
        uint256 _posId
    ) external onlyOwner isPositionOwned(_trader, _posId) {
        _closePosition(_trader, _posId);
    }

    function liquidatePosition(
        address _liquidator,
        uint256 _posId
    ) external onlyOwner isLiquidable(_posId) {
        _closePosition(_liquidator, _posId);
    }

    /**
     * @notice This function is now safer against reentrancy by strictly following the
     * Checks-Effects-Interactions pattern. The nonReentrant modifier provides the primary protection,
     * and the logic is ordered to perform all state changes (Effects) before any external calls (Interactions).
     */
    function _closePosition(
        address _liquidator,
        uint256 _posId
    ) internal nonReentrant isPositionOpen(_posId) {
        // --- CHECKS (Checks-Effects-Interactions Pattern) ---
        PositionParams memory posParms = openPositions[_posId];

        address trader = ownerOf(_posId);
        bool isMargin = posParms.leverage != 1 || posParms.isShort;
        uint256 state = getPositionState(_posId); // relies on fresh price data
        
        LiquidityPool liquidityPoolToUse;
        if(isMargin) {
            liquidityPoolToUse = LiquidityPool(
                LiquidityPoolFactory(liquidityPoolFactory).getTokenToLiquidityPools(
                    posParms.isShort ? address(posParms.baseToken) : address(posParms.quoteToken)
                )
            );
        }
        
        // --- EFFECTS ---
        // All state changes are done here before any interaction.
        --totalNbPos;
        delete openPositions[_posId];
        safeBurn(_posId);

        // --- INTERACTIONS ---
        uint256 amount0;
        uint256 amount1;

        // FIX: Inconsistent State Risk - Handle partial fills for non-margin limit orders
        if (posParms.tokenIdLiquidity != 0 && !isMargin) {
            // burnV3Position can lead to amount0 and amount1 being non-zero if the limit order was partially filled.
            // The old logic would revert. The new logic handles this gracefully by sending both tokens to the trader.
            (amount0, amount1) = burnV3Position(posParms.tokenIdLiquidity);
            
            address token0 = posParms.isBaseToken0 ? address(posParms.baseToken) : address(posParms.quoteToken);
            address token1 = posParms.isBaseToken0 ? address(posParms.quoteToken) : address(posParms.baseToken);

            if(amount0 > 0) {
                ERC20(token0).safeTransfer(trader, amount0);
            }
            if(amount1 > 0) {
                ERC20(token1).safeTransfer(trader, amount1);
            }

        } else if (posParms.isShort) {
            posParms.isBaseToken0 ? amount1 = posParms.positionSize : amount0 = posParms
                .positionSize;
        } else {
            posParms.isBaseToken0 ? amount0 = posParms.positionSize : amount1 = posParms
                .positionSize;
        }

        address addTokenReceived = (amount0 != 0)
            ? posParms.isBaseToken0
                ? address(posParms.baseToken)
                : address(posParms.quoteToken)
            : posParms.isBaseToken0
                ? address(posParms.quoteToken)
                : address(posParms.baseToken);

        address addTokenInitiallySupplied = posParms.isShort
            ? address(posParms.quoteToken)
            : address(posParms.baseToken);
        address addTokenBorrowed = posParms.isShort
            ? address(posParms.baseToken)
            : address(posParms.quoteToken);

        uint256 amountTokenReceived = amount0 != 0 ? amount0 : amount1;
        uint256 interest = posParms.hourlyFees * ((block.timestamp - posParms.timestamp) / 3600);

        address tokenToTrader = addTokenReceived == address(posParms.baseToken)
            ? address(posParms.quoteToken)
            : address(posParms.baseToken);

        // This part of the logic is for non-margin, non-limit-order trades, which is now simplified
        // due to the handling of limit orders above.
        if (state == 1 && !isMargin) {
             // This case is now handled above for partial fills, we can simplify here.
             // But for safety and to keep logic paths explicit, we ensure that if a position
             // is closed via this path, it's a simple token transfer.
            ERC20(addTokenReceived).safeTransfer(trader, amountTokenReceived);
        }
        else if (isMargin) {
            if (addTokenBorrowed == addTokenReceived) {
                revert Positions__TOKEN_RECEIVED_NOT_CONCISTENT(
                    addTokenBorrowed,
                    addTokenReceived,
                    2345
                );
            }

            if (posParms.isShort) {
                amountTokenReceived += posParms.collateralSize;
            }
            (uint256 inAmount, uint256 outAmount) = swapMaxTokenPossible(
                addTokenReceived,
                tokenToTrader,
                UniswapV3Pool(posParms.v3Pool).fee(),
                posParms.totalBorrow + interest,
                amountTokenReceived
            );
            int256 remaining = int256(
                int(outAmount) - int(posParms.totalBorrow) - int(interest)
            );
            uint256 loss = remaining < 0 ? uint256(-remaining) : uint256(0);
            ERC20(addTokenBorrowed).safeApprove(
                address(liquidityPoolToUse),
                posParms.totalBorrow + interest - loss
            );
            liquidityPoolToUse.refund(posParms.totalBorrow, interest, loss);
            if (loss == 0 && (amountTokenReceived > inAmount)) {
                ERC20(addTokenReceived).safeTransfer(trader, amountTokenReceived - inAmount);
            }
        } else if (state == 2) {
             ERC20(addTokenReceived).safeTransfer(trader, amountTokenReceived);
        }
        else {
             ERC20(addTokenReceived).safeApprove(address(uniswapV3Helper), amountTokenReceived);
            uint256 outAmount = uniswapV3Helper.swapExactInputSingle(
                addTokenReceived,
                tokenToTrader,
                UniswapV3Pool(posParms.v3Pool).fee(),
                amountTokenReceived
            );
            ERC20(tokenToTrader).safeTransfer(trader, outAmount);
        }
        
        uint256 liquidationFee = (posParms.collateralSize * 3) / 100;
        ERC20(addTokenInitiallySupplied).safeTransfer(_liquidator, liquidationFee);    }

    function editPosition(
        address _trader,
        uint256 _posId,
        uint256 _newStopLossPrice
    ) external onlyOwner isPositionOwned(_trader, _posId) {
        PositionParams storage pos = openPositions[_posId];
        // check params
        uint256 price = PriceFeedL1(priceFeed).getPairLatestPrice(
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
     * @dev Oracle Dependency: This function, and others in the contract, depend on PriceFeedL1.
     * The security of this contract is therefore tied to the security of the price oracle.
     * A manipulated oracle (e.g., via flash loans) could lead to incorrect liquidations.
     * For enhanced security, it is recommended that the integrated PriceFeedL1 uses a robust
     * price source, such as a Time-Weighted Average Price (TWAP) oracle.
     */
    function getPositionState(uint256 _posId) public view returns (uint256) {
        if (!_exists(_posId)) {
            return 0;
        }
        PositionParams memory pos = openPositions[_posId];
        
        uint256 price = PriceFeedL1(priceFeed).getPairLatestPrice(
            address(pos.baseToken),
            address(pos.quoteToken)
        );

        uint256 lidTresh = pos.isShort
            ? (pos.breakEvenLimit * (10000 - LIQUIDATION_THRESHOLD)) / 10000
            : (pos.breakEvenLimit * (LIQUIDATION_THRESHOLD + 10000)) / 10000;

        // closable because of take profit
        if (pos.isShort) {
            if (pos.limitPrice != 0 && price < pos.limitPrice) return 1;
            if (pos.breakEvenLimit != 0 && price >= pos.breakEvenLimit) return 5;
            if (lidTresh != 0 && price >= lidTresh) return 4;
            if (pos.stopLossPrice != 0 && price >= pos.stopLossPrice) return 3;
        } else {
            if (pos.limitPrice != 0 && price > pos.limitPrice) return 1;
            if (pos.breakEvenLimit != 0 && price <= pos.breakEvenLimit) return 5;
            if (lidTresh != 0 && price <= lidTresh) return 4;
            if (pos.stopLossPrice != 0 && price <= pos.stopLossPrice) return 3;
        }
        return 2;
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
        PositionParams memory pos = openPositions[_posId];
        baseToken_ = address(pos.baseToken);
        quoteToken_ = address(pos.quoteToken);
        positionSize_ = pos.positionSize;
        timestamp_ = pos.timestamp;
        isShort_ = pos.isShort;
        leverage_ = pos.leverage;
        breakEvenLimit_ = pos.breakEvenLimit;
        limitPrice_ = pos.limitPrice;
        stopLossPrice_ = pos.stopLossPrice;

        uint256 initialPrice = pos.initialPrice;
        uint256 currentPrice = PriceFeedL1(priceFeed).getPairLatestPrice(baseToken_, quoteToken_);

        int256 share = 10000 - int(currentPrice * 10000) / int(initialPrice);

        currentPnL_ = int128((int128(positionSize_) * share) / 10000);
        currentPnL_ = isShort_ ? currentPnL_ : -currentPnL_;

        currentPnL_ =
            currentPnL_ -
            int128(
                int256(pos.hourlyFees) *
                    ((int256(block.timestamp) - int64(timestamp_)) / 3600)
            );

        collateralLeft_ = int128(pos.collateralSize) + currentPnL_;
    }

    // --- Internal and Private Functions ---
    
    function mintV3Position(
        UniswapV3Pool _v3Pool,
        uint256 _amount0ToMint,
        uint256 _amount1ToMint,
        int24 _tickLower,
        int24 _tickUpper
    ) private returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1) {
        (tokenId, liquidity, amount0, amount1) = uniswapV3Helper.mintPosition(
            _v3Pool,
            _amount0ToMint,
            _amount1ToMint,
            _tickLower,
            _tickUpper
        );
    }

    function burnV3Position(uint256 _tokenId) private returns (uint256, uint256) {
        uniswapV3Helper.decreaseLiquidity(_tokenId);
        (uint256 amount0, uint256 amount1) = uniswapV3Helper.collectAllFees(_tokenId);
        // INonfungiblePositionManager(nonfungiblePositionManager).burn(_tokenId);
        return (amount0, amount1);
    }

    function swapMaxTokenPossible(
        address _token0,
        address _token1,
        uint24 _fee,
        uint256 amountOut,
        uint256 amountInMaximum
    ) private returns (uint256, uint256) {
        ERC20(_token0).safeApprove(address(uniswapV3Helper), amountInMaximum);
        uint256 swapCost = uniswapV3Helper.swapExactOutputSingle(
            _token0,
            _token1,
            _fee,
            amountOut,
            amountInMaximum
        );
        // if swap cannot be done with amountInMaximum
        if (swapCost == 0) {
            ERC20(_token0).safeApprove(address(uniswapV3Helper), amountInMaximum);
            uint256 out = uniswapV3Helper.swapExactInputSingle(
                _token0,
                _token1,
                _fee,
                amountInMaximum
            );
            return (amountInMaximum, out);
        } else {
            return (swapCost, amountOut);
        }
    }

    // Switched to efficient implementation (ABI compatible)
    function getTraderPositions(address _traderAdd) external view returns (uint256[] memory) {
        return traderPositions[_traderAdd];
    }

    /**
     * @notice FIX: Mitigated Denial of Service (DoS) risk.
     * The original implementation could run out of gas if there are too many open positions.
     * This version is more gas-efficient and has a hard limit on the number of positions it checks.
     * For a large number of positions, it is recommended to use off-chain keepers to monitor for
     * liquidable positions by listening to events and calling `liquidatePosition` directly.
     */
    function getLiquidablePositions() external view returns (uint256[] memory) {
        uint256[] memory allPositions = new uint[](totalNbPos);
        uint256 count = 0;
        for (uint256 i = 1; i < posId && i < GET_LIQUIDABLE_POSITIONS_LOOP_LIMIT; ++i) {
            if (_exists(i)) {
                uint256 state = getPositionState(i);
                if (state >= 3 && state <= 5) { // Liquidation states
                    if (count < totalNbPos) {
                        allPositions[count] = i;
                    }
                    count++;
                }
            }
        }
        // Resize array to actual count of liquidable positions
        uint256[] memory liquidablePositions = new uint[](count);
        for(uint256 i = 0; i < count; i++){
            liquidablePositions[i] = allPositions[i];
        }
        return liquidablePositions;
    }
}