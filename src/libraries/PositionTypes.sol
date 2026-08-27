// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

// Enums
enum PositionState {
    NONE, // 0
    TAKE_PROFIT, // 1
    ACTIVE, // 2
    STOP_LOSS, // 3
    LIQUIDATABLE, // 4
    BAD_DEBT, // 5
    EXPIRED // 6
}

// Structs
// prettier-ignore
struct PositionParams {
    // Slot 0: 32 bytes
    uint256 initialPrice; // Price of the position when opened

    // Slot 1: 32 bytes
    uint256 totalBorrow; // Total borrow in baseToken if long or quoteToken if short

    // Slot 2: 32 bytes
    uint256 liquidationFloor; // Price at which position becomes undercollateralized (total loss threshold)

    // Slot 3: 32 bytes
    uint256 stopLossPrice; // Stop loss price => 0 if no stop loss

    // Slot 4: 20 + 12 = 32 bytes
    address v3Pool; // Pool to trade
    uint160 limitPrice; // Limit order price => 0 if no limit order

    // Slot 5: 20 + 20 = 40 bytes -> 8 bytes overflow
    IERC20 baseToken; // Token to trade => should be token0 or token1 of v3Pool
    IERC20 quoteToken; // Token to trade => should be the other token of v3Pool

    // Slot 6: 16 + 16 = 32 bytes
    uint128 collateralSize; // Total collateral for the position
    uint128 positionSize; // Amount (in baseToken if long / quoteToken if short) of token traded

    // Slot 7: 16 + 8 + 8 = 32 bytes
    uint128 liquidationReward; // Amount (in baseToken if long / quoteToken if short) of token to pay to the liquidator
    uint64 timestamp; // Timestamp of position creation (used for expiration)
    uint64 blockNumber; // Block number of position creation (used for manipulation-resistant expiration)

    // Slot 8: 1 + 1 + 1 + 29 bytes padding = 32 bytes
    bool isShort; // True if short, false if long
    bool isBaseToken0; // True if the baseToken is the token0 (in the uniswapV3Pool)
    uint8 leverage; // Leverage of position => 0 if no leverage
    IERC20 initialToken; // Token provided by the user as collateral
}

// Errors
error Positions__POSITION_NOT_OPEN(uint256 _posId);
error Positions__POSITION_NOT_LIQUIDABLE_YET(uint256 _posId);
error Positions__POSITION_NOT_OWNED(address _trader, uint256 _posId);
error Positions__POOL_NOT_OFFICIAL(address _v3Pool);
error Positions__TOKEN_NOT_SUPPORTED(address _token);
error Positions__TOKEN_NOT_SUPPORTED_ON_MARGIN(address _token);
error Positions__NO_PRICE_FEED(address _token0, address _token1);
error Positions__LEVERAGE_NOT_IN_RANGE(uint8 _leverage);
error Positions__AMOUNT_TO_SMALL(string tokenSymbol, uint256 amountInUsd, uint256 amount);
error Positions__LIMIT_ORDER_PRICE_NOT_CONCISTENT(uint256 _limitPrice);
error Positions__STOP_LOSS_ORDER_PRICE_NOT_CONCISTENT(uint256 _stopLossPrice);
error Positions__NOT_LIQUIDABLE(uint256 _posId);
error Positions__WAIT_FOR_LIMIT_ORDER_TO_COMPLET(uint256 _posId);
error Positions__TOKEN_RECEIVED_NOT_CONCISTENT(address tokenBorrowed, address tokenReceived, uint256 state);
