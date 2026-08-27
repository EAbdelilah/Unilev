// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {IUniswapV3SwapRouter} from "../../src/interfaces/IUniswapV3.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {MockV3Aggregator} from "./MockV3Aggregator.sol";
import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {UniswapV3Helper} from "../../src/UniswapV3Helper.sol";
import {PriceFeedL1} from "../../src/PriceFeedL1.sol";
import {Utils} from "../utils/Utils.sol"; // Import Utils for writeTokenBalance

/**
 * @title MockUniswapV3Helper
 * @notice A mock implementation of UniswapV3Helper used for testing.
 * @dev This mock uses the PriceFeedL1 to simulate swap calculations based on USD prices,
 * and uses Forge cheatcodes (via Utils inheritance) to directly manipulate token balances.
 * @dev It calculates the exchange amount using USD prices and simulates swap fees
 * according to the Uniswap V3 fee tier passed as parameter.
 */
contract MockUniswapV3Helper is Utils {
    PriceFeedL1 public immutable PRICE_FEED;

    // Uniswap V3 fee tiers (in hundredths of a bip, i.e., 1e6 = 100%)
    uint24 public constant FEE_TIER_0_05 = 500; // 0.05%
    uint24 public constant FEE_TIER_0_3 = 3000; // 0.3%
    uint24 public constant FEE_TIER_1 = 10000; // 1%

    // Optional override for amount out to skip slippage issues in exact target testing
    uint256 public nextExactAmountOut;
    uint256 public nextExactAmountIn;

    function setNextExactAmountOut(uint256 _amount) public {
        nextExactAmountOut = _amount;
    }

    function setNextExactAmountIn(uint256 _amount) public {
        nextExactAmountIn = _amount;
    }

    constructor(address _priceFeed) {
        PRICE_FEED = PriceFeedL1(_priceFeed);
    }

    /**
     * @notice Calculate the fee multiplier for a given fee tier.
     * @dev Uniswap V3 fees are represented in hundredths of a bip (1e6 = 100%).
     * @param _fee The fee tier (500 = 0.05%, 3000 = 0.3%, 10000 = 1%).
     * @return feeMultiplier The multiplier to apply (1000000 - fee) / 1000000.
     */
    function getFeeMultiplier(uint24 _fee) internal pure returns (uint256) {
        // fee is in hundredths of a bip, so 3000 = 0.3% = 3000/1000000 = 0.003
        // We return (1_000_000 - fee) for the output multiplier
        return uint256(1_000_000 - _fee);
    }

    /**
     * @notice Calculate the input fee multiplier for a given fee tier.
     * @dev For exact output swaps, the input amount needs to be higher to cover fees.
     * @dev Using the formula: amountIn = amountOut / (1 - fee) which approximates to amountOut * (1 + fee + fee^2 + ...)
     * @dev For small fees, this is approximately amountOut * (1 + fee), but for more precision we use 1_000_000 / (1_000_000 - fee)
     * @param _fee The fee tier.
     * @return feeMultiplier The multiplier to apply (1000000 * 1000000) / (1000000 - fee).
     */
    function getInputFeeMultiplier(uint24 _fee) internal pure returns (uint256) {
        // For exact output swaps, we need: amountIn = amountOut / (1 - fee)
        // This can be computed as: amountIn = amountOut * 1_000_000 / (1_000_000 - fee)
        // We return the numerator to be used as: amountIn = amountOut * multiplier / 1_000_000
        return uint256(1_000_000 * 1_000_000) / uint256(1_000_000 - _fee);
    }

    /**
     * @notice Mocks Uniswap's exactInputSingle. Sells an exact amount of _tokenIn for _tokenOut.
     * @dev Calculates the amountOut based on USD prices from PriceFeedL1 and applies the specified fee tier.
     * @dev It updates the balances of msg.sender using Forge cheatcodes (`writeTokenBalance`).
     * @param _tokenIn The input token.
     * @param _tokenOut The output token.
     * @param _fee The Uniswap V3 fee tier (500 = 0.05%, 3000 = 0.3%, 10000 = 1%).
     * @param _amountIn The exact amount of input token to sell.
     * @return amountOut The amount of output token received.
     */
    function swapExactInputSingle(
        address _tokenIn,
        address _tokenOut,
        uint24 _fee,
        uint256 _amountIn,
        uint256 _amountOutMinimum,
        uint256 _deadline
    ) public returns (uint256 amountOut) {
        // --- 1. Calculate amountOut (Net Effect of Swap) ---

        if (nextExactAmountOut != 0) {
            amountOut = nextExactAmountOut;
            nextExactAmountOut = 0; // reset
        } else {
            // Price of tokenIn in USD (18 decimals)
            uint256 priceInUsd = PRICE_FEED.getTokenLatestPriceInUsd(_tokenIn);
            // Price of tokenOut in USD (18 decimals)
            uint256 priceOutUsd = PRICE_FEED.getTokenLatestPriceInUsd(_tokenOut);

            // Value of input amount in USD (18 decimals)
            uint8 tokenInDecimals = IERC20Metadata(_tokenIn).decimals();
            uint256 valueUsd = (_amountIn * priceInUsd) / (10 ** tokenInDecimals);

            // Amount of tokenOut received (in its own decimals)
            uint8 tokenOutDecimals = IERC20Metadata(_tokenOut).decimals();
            // Calculate raw amountOut
            amountOut = (valueUsd * (10 ** tokenOutDecimals)) / priceOutUsd;

            // Apply the fee based on the fee tier
            // Uniswap V3 fees are in hundredths of a bip (1e6 = 100%)
            // For exact input: amountOut = amountOut * (1_000_000 - fee) / 1_000_000
            // When mock slippage override is set, this is skipped!
            amountOut = (amountOut * getFeeMultiplier(_fee)) / 1_000_000;
        }

        if (amountOut < _amountOutMinimum) {
            revert("Amount out less than minimum");
        }

        // --- 2. Simulate Balance Changes (Net Effect on msg.sender - Positions.sol) ---

        // a) Remove _tokenIn from msg.sender (Positions.sol)
        uint256 currentBalanceIn = IERC20(_tokenIn).balanceOf(msg.sender);
        uint256 newBalanceIn = currentBalanceIn - _amountIn;
        writeTokenBalance(msg.sender, _tokenIn, newBalanceIn);

        // b) Send amountOut of _tokenOut to msg.sender (Positions.sol)
        uint256 currentBalanceOut = IERC20(_tokenOut).balanceOf(msg.sender);
        uint256 newBalanceOut = currentBalanceOut + amountOut;
        writeTokenBalance(msg.sender, _tokenOut, newBalanceOut);

        return amountOut;
    }

    /**
     * @notice Mocks Uniswap's exactOutputSingle. Sells up to _amountInMaximum of _tokenIn to receive an exact amount of _amountOut of _tokenOut.
     * @dev Calculates the amountIn required based on USD prices from PriceFeedL1 and applies the specified fee tier.
     * @dev It updates the balances of msg.sender using Forge cheatcodes (`writeTokenBalance`).
     * @param _tokenIn The input token.
     * @param _tokenOut The output token.
     * @param _fee The Uniswap V3 fee tier (500 = 0.05%, 3000 = 0.3%, 10000 = 1%).
     * @param _amountOut The exact amount of output token desired.
     * @param _amountInMaximum The maximum amount of input token to spend.
     * @return amountIn The exact amount of input token spent.
     */
    function swapExactOutputSingle(
        address _tokenIn,
        address _tokenOut,
        uint24 _fee,
        uint256 _amountOut,
        uint256 _amountInMaximum,
        uint256 _deadline
    ) public returns (uint256 amountIn) {
        // --- 1. Calculate amountIn (Net Cost of Swap) ---

        if (nextExactAmountIn != 0) {
            amountIn = nextExactAmountIn;
            nextExactAmountIn = 0; // reset
        } else {
            // Price of tokenIn in USD (18 decimals)
            uint256 priceInUsd = PRICE_FEED.getTokenLatestPriceInUsd(_tokenIn);
            // Price of tokenOut in USD (18 decimals)
            uint256 priceOutUsd = PRICE_FEED.getTokenLatestPriceInUsd(_tokenOut);

            // Value of output amount in USD (18 decimals)
            uint8 tokenOutDecimals = IERC20Metadata(_tokenOut).decimals();
            uint256 valueUsd = (_amountOut * priceOutUsd) / (10 ** tokenOutDecimals);

            // Amount of tokenIn required (in its own decimals)
            uint8 tokenInDecimals = IERC20Metadata(_tokenIn).decimals();
            // Calculate raw amountIn
            amountIn = (valueUsd * (10 ** tokenInDecimals)) / priceInUsd;

            // Apply the fee based on the fee tier
            // Uniswap V3 fees are in hundredths of a bip (1e6 = 100%)
            // For exact output: amountIn = amountIn * (1_000_000 + fee) / 1_000_000
            amountIn = (amountIn * getInputFeeMultiplier(_fee)) / 1_000_000;
        }

        // Check against the maximum allowed input
        if (amountIn > _amountInMaximum) {
            // The calculated cost is too high, simulating a swap failure.
            return 0;
        }

        // --- 2. Simulate Balance Changes (Net Effect on msg.sender - Positions.sol) ---

        // a) Remove amountIn of _tokenIn from msg.sender (Positions.sol)
        uint256 currentBalanceIn = IERC20(_tokenIn).balanceOf(msg.sender);
        uint256 newBalanceIn = currentBalanceIn - amountIn;
        writeTokenBalance(msg.sender, _tokenIn, newBalanceIn);

        // b) Send _amountOut of _tokenOut to msg.sender (Positions.sol)
        uint256 currentBalanceOut = IERC20(_tokenOut).balanceOf(msg.sender);
        uint256 newBalanceOut = currentBalanceOut + _amountOut;
        writeTokenBalance(msg.sender, _tokenOut, newBalanceOut);

        return amountIn;
    }
}
