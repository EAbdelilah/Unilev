// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {UniswapV3Helper} from "./UniswapV3Helper.sol";

/**
 * @title StrategyExecutor
 * @notice Atomic executor for Eswap trading strategies (Arbitrage, Looping, etc.)
 * @dev Handles flashLoan callbacks and executes multi-step swaps.
 */
contract StrategyExecutor is Ownable {
    using SafeERC20 for IERC20;

    UniswapV3Helper public immutable helper;

    enum Action { ARBITRAGE, LOOPING, REFINANCE, LIQUIDATION }

    struct StrategyData {
        Action action;
        address tokenIn;
        address tokenOut;
        uint24 fee;
        uint256 amountIn;
        uint256 minAmountOut;
        bytes extraData;
    }

    mapping(address => bool) public isTrustedPool;

    constructor(address _helper, address _owner) Ownable(_owner) {
        helper = UniswapV3Helper(_helper);
    }

    function setPoolTrust(address _pool, bool _trust) external onlyOwner {
        isTrustedPool[_pool] = _trust;
    }

    /**
     * @notice Callback for LiquidityPool.flashLoan
     */
    function onFlashLoan(
        address sender,
        uint256 amount,
        bytes calldata data
    ) external returns (bytes4) {
        require(isTrustedPool[msg.sender], "StrategyExecutor: Untrusted pool");

        StrategyData memory strategy = abi.decode(data, (StrategyData));

        if (strategy.action == Action.ARBITRAGE) {
            _executeArbitrage(strategy);
        } else if (strategy.action == Action.LOOPING) {
            _executeLooping(strategy);
        } else if (strategy.action == Action.REFINANCE) {
            _executeRefinance(strategy);
        }

        // Repay the flash loan
        IERC20(strategy.tokenIn).safeTransfer(msg.sender, amount);

        return keccak256("onFlashLoan(address,uint256,bytes)");
    }

    function _executeArbitrage(StrategyData memory strategy) internal {
        IERC20(strategy.tokenIn).forceApprove(address(helper), strategy.amountIn);

        // Leg 1: Buy TokenOut
        uint256 received = helper.swapExactInputSingle(
            strategy.tokenIn,
            strategy.tokenOut,
            strategy.fee,
            strategy.amountIn,
            strategy.minAmountOut
        );

        // Leg 2: Sell TokenOut back for TokenIn (e.g. on a different fee tier pool)
        // Decode second leg fee from extraData
        uint24 secondLegFee = abi.decode(strategy.extraData, (uint24));

        IERC20(strategy.tokenOut).forceApprove(address(helper), received);
        helper.swapExactInputSingle(
            strategy.tokenOut,
            strategy.tokenIn,
            secondLegFee,
            received,
            strategy.amountIn // Ensure we get back at least what we borrowed
        );
    }

    function _executeLooping(StrategyData memory strategy) internal {
        // 1. Initial collateral is already in contract (from flash loan)
        // 2. Open Leveraged position on Eswap
        // This effectively 'loops' the leverage in one go.
        IERC20(strategy.tokenIn).forceApprove(address(helper), strategy.amountIn);

        helper.swapExactInputSingle(
            strategy.tokenIn,
            strategy.tokenOut,
            strategy.fee,
            strategy.amountIn,
            strategy.minAmountOut
        );

        // The remaining tokens (profit/surplus) stay in the executor.
    }

    function _executeRefinance(StrategyData memory strategy) internal {
        // 1. We have the flash-borrowed amount
        // 2. Perform the logic to repay external debt (if integration exists)
        // 3. Open the replacement position on Eswap
        IERC20(strategy.tokenIn).forceApprove(address(helper), strategy.amountIn);

        helper.swapExactInputSingle(
            strategy.tokenIn,
            strategy.tokenOut,
            strategy.fee,
            strategy.amountIn,
            strategy.minAmountOut
        );
    }

    // Allow owner to withdraw any stuck tokens
    function withdraw(address token, uint256 amount) external onlyOwner {
        IERC20(token).safeTransfer(msg.sender, amount);
    }
}
