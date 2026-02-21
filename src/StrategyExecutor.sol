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
    address public immutable market;

    enum Action { ARBITRAGE, LIQUIDATION }

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

    constructor(address _helper, address _market, address _owner) Ownable(_owner) {
        helper = UniswapV3Helper(_helper);
        market = _market;
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
        } else if (strategy.action == Action.LIQUIDATION) {
            _executeLiquidation(strategy);
        }

        // Repay the flash loan
        IERC20(strategy.tokenIn).safeTransfer(msg.sender, amount);

        return bytes4(keccak256("onFlashLoan(address,uint256,bytes)"));
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


    function _executeLiquidation(StrategyData memory strategy) internal {
        // 1. We have the flash-borrowed asset to repay the debt
        // 2. Perform the liquidation on Eswap (Assume extraData contains the posId)
        uint256 posId = abi.decode(strategy.extraData, (uint256));

        IERC20(strategy.tokenIn).forceApprove(market, strategy.amountIn);

        // Call Market.liquidatePosition
        (bool success, ) = market.call(
            abi.encodeWithSignature("liquidatePosition(uint256)", posId)
        );
        require(success, "Liquidation call failed");
    }

    // Allow owner to withdraw any stuck tokens
    function withdraw(address token, uint256 amount) external onlyOwner {
        IERC20(token).safeTransfer(msg.sender, amount);
    }
}
