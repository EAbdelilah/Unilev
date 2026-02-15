// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {IMarket} from "../interfaces/IMarket.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title LiquidationBot
 * @notice A simple example of a contract that can be used to liquidate positions on Eswap.
 * In a real-world scenario, this would be combined with a flashloan to avoid needing
 * upfront capital for margin positions.
 */
contract LiquidationBot {
    using SafeERC20 for IERC20;

    IMarket public immutable market;
    address public immutable owner;

    constructor(address _market) {
        market = IMarket(_market);
        owner = msg.sender;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    /**
     * @notice Liquidates all currently liquidatable positions.
     */
    function liquidateEverything() external {
        uint256[] memory liquidablePositions = market.getLiquidablePositions();
        if (liquidablePositions.length > 0) {
            market.liquidatePositions(liquidablePositions);
        }
    }

    /**
     * @notice Liquidates a specific set of positions.
     * @param _posIds The IDs of the positions to liquidate.
     */
    function liquidateBatch(uint256[] calldata _posIds) external {
        market.liquidatePositions(_posIds);
    }

    /**
     * @notice Withdraws any tokens earned from liquidation rewards.
     * @param _token The token to withdraw.
     */
    function withdraw(address _token) external onlyOwner {
        uint256 balance = IERC20(_token).balanceOf(address(this));
        IERC20(_token).safeTransfer(owner, balance);
    }
}
