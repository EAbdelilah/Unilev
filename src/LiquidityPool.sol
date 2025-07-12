// SPDX-License-Identifier: MIT
pragma solidity =0.8.19;

import "@solmate/mixins/ERC4626.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

// Errors
error LiquidityPool__NOT_ENOUGH_LIQUIDITY(uint256 maxBorrowCapatity);

contract LiquidityPool is ERC4626, Ownable {
    using SafeTransferLib for ERC20;

    uint256 private borrowedFunds; // Funds currently used by positions

    uint256 private MAX_BORROW_RATIO = 8000; // in basis points => 80%

    constructor(
        ERC20 _asset,
        address _positions
    )
        ERC4626(
            _asset,
            string.concat("UniswapMaxLP-", _asset.symbol()),
            string.concat("um", _asset.symbol())
        )
    {
        transferOwnership(_positions);
    }

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
            revert LiquidityPool__NOT_ENOUGH_LIQUIDITY(borrowCapacity);
        borrowedFunds += _amountToBorrow;
        require(
            asset.safeTransfer(msg.sender, _amountToBorrow),
            "LiquidityPool: transfer failed"
        );
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
        // Losses are taken by the pool
        borrowedFunds = uint256(int256(borrowedFunds) - int256(_amountBorrowed));
        require(
            asset.safeTransferFrom(
                msg.sender,
                address(this),
                _amountBorrowed + _interests - _losses
            ),
            "LiquidityPool: transfer failed"
        );
    }

    // --------------- View Zone ---------------

    function totalAssets() public view override returns (uint256) {
        return asset.balanceOf(address(this)) + borrowedFunds;
    }

    function rawTotalAsset() public view returns (uint256) {
        return asset.balanceOf(address(this));
    }

    function getBorrowedFund() external view returns (uint256) {
        return borrowedFunds;
    }

    function borrowCapacityLeft() public view returns (uint256) {
        return ((totalAssets() * MAX_BORROW_RATIO) / 10000) - borrowedFunds;
    }
}
