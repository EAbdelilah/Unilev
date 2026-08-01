// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface ILiquidityPool {
    function lend(address token, uint256 amount, address receiver) external;
    function repay(address token, uint256 amount) external;
}

contract LiquidityPoolMock is ILiquidityPool {
    function lend(address token, uint256 amount, address receiver) external override {
        // In a mock, we just assume we have the tokens or the test funds us
    }
    function repay(address token, uint256 amount) external override {
        // Logic to track repayment
    }
}
