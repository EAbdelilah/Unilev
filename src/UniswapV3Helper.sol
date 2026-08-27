// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.19;

import {IUniswapV3SwapRouter} from "./interfaces/IUniswapV3.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IWETH9} from "./interfaces/IWETH9.sol";

contract UniswapV3Helper {
    IUniswapV3SwapRouter public immutable SWAP_ROUTER;

    constructor(address _swapRouter) {
        SWAP_ROUTER = IUniswapV3SwapRouter(_swapRouter);
    }

    receive() external payable {}

    // [FIX LOW-2] Added _deadline parameter — callers must supply a real deadline
    // (e.g. block.timestamp + N minutes) instead of block.timestamp, which provides
    // zero protection because a validator can include the tx at any future block.
    function swapExactInputSingle(
        address _tokenIn,
        address _tokenOut,
        uint24 _fee,
        uint256 _amountIn,
        uint256 _amountOutMinimum,
        uint256 _deadline
    ) public returns (uint256 amountOut) {
        // Transfer the tokens from Positions.sol to this contract
        SafeERC20.safeTransferFrom(IERC20(_tokenIn), msg.sender, address(this), _amountIn);

        // Approve the router to spend the input token.
        SafeERC20.forceApprove(IERC20(_tokenIn), address(SWAP_ROUTER), _amountIn);

        IUniswapV3SwapRouter.ExactInputSingleParams memory params = IUniswapV3SwapRouter.ExactInputSingleParams({
            tokenIn: _tokenIn,
            tokenOut: _tokenOut,
            fee: _fee,
            recipient: msg.sender,
            deadline: _deadline,
            amountIn: _amountIn,
            amountOutMinimum: _amountOutMinimum,
            sqrtPriceLimitX96: 0
        });

        amountOut = SWAP_ROUTER.exactInputSingle(params);
    }

    // [FIX LOW-2] Added _deadline parameter — same reasoning as above.
    function swapExactOutputSingle(
        address _tokenIn,
        address _tokenOut,
        uint24 _fee,
        uint256 _amountOut,
        uint256 _amountInMaximum,
        uint256 _deadline
    ) public returns (uint256 amountIn) {
        // Transfer the tokens from Positions.sol to this contract
        SafeERC20.safeTransferFrom(IERC20(_tokenIn), msg.sender, address(this), _amountInMaximum);

        // Approve the router to spend the input token.
        SafeERC20.forceApprove(IERC20(_tokenIn), address(SWAP_ROUTER), _amountInMaximum);

        IUniswapV3SwapRouter.ExactOutputSingleParams memory params = IUniswapV3SwapRouter.ExactOutputSingleParams({
            tokenIn: _tokenIn,
            tokenOut: _tokenOut,
            fee: _fee,
            recipient: msg.sender,
            deadline: _deadline,
            amountOut: _amountOut,
            amountInMaximum: _amountInMaximum,
            sqrtPriceLimitX96: 0
        });

        amountIn = SWAP_ROUTER.exactOutputSingle(params);

        // Refund the unused tokens
        if (amountIn < _amountInMaximum) {
            SafeERC20.safeTransfer(IERC20(_tokenIn), msg.sender, _amountInMaximum - amountIn);
        }
    }
}
