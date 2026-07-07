// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ILiquidityPool} from "../../EswapMarginHook.sol";
import {IERC20} from "../../../interfaces/IERC20.sol";

contract LiquidityPoolMock is ILiquidityPool {
    function lend(address token, uint256 amount, address receiver) external override {
        // In a mock, we just assume we have the tokens or the test funds us
    }
    function repay(address token, uint256 amount) external override {
        // Logic to track repayment
    }
}
