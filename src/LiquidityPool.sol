// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol"; // [FIX L-2]
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

// Errors
error LiquidityPool__NOT_ENOUGH_LIQUIDITY(string tokenSymbol, uint256 maxBorrowCapacity);

contract LiquidityPool is ERC4626, Ownable2Step { // [FIX L-2]
    using SafeERC20 for IERC20;

    uint256 private borrowedFunds; // Funds currently used by positions

    uint256 public maxBorrowRatio = 8000; // [FIX M-6] Made public; in basis points => 80%

    constructor(
        IERC20 _asset,
        address _positions,
        string memory _name,
        string memory _symbol
    ) ERC4626(_asset) ERC20(_name, _symbol) Ownable(_positions) {}

    // --------------- Leveraged Positions Zone ---------------
    // @note We don't track the debt in this contract, it's tracked in the Positions contract

    /**
     * @notice Borrow funds from the pool to open a leveraged position
     * @dev Only the owner (the Positions contract) can borrow funds
     * @param _amountToBorrow amount to borrow
     */
    function borrow(uint256 _amountToBorrow) external onlyOwner {
        uint256 borrowCapacity = borrowCapacityLeft();
        if (_amountToBorrow > borrowCapacity)
            revert LiquidityPool__NOT_ENOUGH_LIQUIDITY(ERC20(asset()).symbol(), borrowCapacity);
        borrowedFunds += _amountToBorrow;
        IERC20(asset()).safeTransfer(msg.sender, _amountToBorrow);
    }

    /**
     * @notice Refund funds from the pool once the position is closed
     * @dev Positions contract will need to approve the LiquidityPool to transfer funds
     * @param _amountBorrowed amount that was borrowed
     * @param _interests interest to earned with fees
     * @param _losses losses when a postion was not liquidated in time
     */
    function refund(
        uint256 _amountBorrowed,
        uint256 _interests,
        uint256 _losses
    ) external onlyOwner {
        // [FIX C-4] Safe subtraction: if _amountBorrowed > borrowedFunds (bad-debt edge case),
        // clamp to 0 instead of wrapping to a huge uint256 which would brick the pool.
        borrowedFunds = _amountBorrowed >= borrowedFunds ? 0 : borrowedFunds - _amountBorrowed;

        // [FIX INFO-4] Guard against arithmetic underflow: if losses exceed the total
        // repayment amount (amountBorrowed + interests), clamp to zero rather than reverting.
        // This prevents a scenario where bad-debt exceeds the principal from permanently
        // locking the refund path and bricking the pool.
        uint256 grossRepayment = _amountBorrowed + _interests;
        uint256 toTransfer = grossRepayment > _losses ? grossRepayment - _losses : 0;
        if (toTransfer > 0) {
            IERC20(asset()).safeTransferFrom(msg.sender, address(this), toTransfer);
        }
    }

    /**
     * @notice [FIX M-6] Allows the owner to adjust the maximum borrow ratio.
     * @dev Safety ceiling of 9000 bps (90%) prevents full pool drain by a single borrower.
     */
    function setMaxBorrowRatio(uint256 _maxBorrowRatio) external onlyOwner {
        require(_maxBorrowRatio <= 9000, "LiquidityPool: max borrow ratio cannot exceed 90%");
        maxBorrowRatio = _maxBorrowRatio;
    }

    // --------------- View Zone ---------------

    function totalAssets() public view override returns (uint256) {
        return super.totalAssets() + borrowedFunds;
    }

    function rawTotalAsset() public view returns (uint256) {
        return IERC20(asset()).balanceOf(address(this));
    }

    function getBorrowedFund() external view returns (uint256) {
        return borrowedFunds;
    }

    // [FIX LOW-3] Safe subtraction: after a loss writedown, borrowedFunds can momentarily
    // exceed the borrow-ratio cap, causing the old arithmetic to revert (underflow).
    // Clamp to 0 so the view function always returns a valid value.
    function borrowCapacityLeft() public view returns (uint256) {
        uint256 cap = (totalAssets() * maxBorrowRatio) / 10000;
        return cap > borrowedFunds ? cap - borrowedFunds : 0;
    }
}
