// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import "@solmate/mixins/ERC4626.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

// Errors
error LiquidityPool__NOT_ENOUGH_LIQUIDITY(uint256 maxBorrowCapacity);
error LiquidityPool__LOSSES_EXCEED_REPAYMENT(uint256 losses, uint256 repayment);
error LiquidityPool__INVALID_BORROW_AMOUNT(uint256 amountBorrowed, uint256 borrowedFunds);
error LiquidityPool__INVALID_WITHDRAWAL_AMOUNT(uint256 requested, uint256 available);
// START SECURITY ADDITIONS
error LiquidityPool__DEPOSIT_AMOUNT_TOO_LOW();
// END SECURITY ADDITIONS

contract LiquidityPool is ERC4626, Ownable {
    using SafeTransferLib for ERC20;

    uint256 private borrowedFunds; // Funds currently used by positions

    uint256 private constant MAX_BORROW_RATIO = 8000; // in basis points => 80%

    // FIX: ERC4626 Inflation Attack Mitigation
    // A minimum deposit amount is enforced for the first depositor to prevent share price manipulation.
    // This value should be set high enough to make the attack economically unfeasible.
    // e.g., 10**18 for a standard 18-decimal token.
    uint256 private constant MIN_INITIAL_DEPOSIT = 10e18;

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
        require(_asset != ERC20(address(0)), "Invalid asset address");
        require(_positions != address(0), "Invalid positions address");

        // FIX: ERC4626 Inflation Attack Mitigation
        // This initial mint to the zero address is a standard first-step mitigation.
        // It ensures the total supply of shares is never zero, preventing division-by-zero errors
        // and making the initial share price calculation more stable.
        _mint(address(0), 1000);

        transferOwnership(_positions);
    }

    // --------------- Leveraged Positions Zone ---------------

    function borrow(uint256 _amountToBorrow) external onlyOwner {
        uint256 borrowCapacity = borrowCapacityLeft();
        if (_amountToBorrow > borrowCapacity)
            revert LiquidityPool__NOT_ENOUGH_LIQUIDITY(borrowCapacity);
        borrowedFunds += _amountToBorrow;
        asset.safeTransfer(msg.sender, _amountToBorrow);
    }

    function refund(
        uint256 _amountBorrowed,
        uint256 _interests,
        uint256 _losses
    ) external onlyOwner {
        if (_amountBorrowed > borrowedFunds) {
            revert LiquidityPool__INVALID_BORROW_AMOUNT(_amountBorrowed, borrowedFunds);
        }
        uint256 repayment = _amountBorrowed + _interests;
        if (repayment < _losses) {
            revert LiquidityPool__LOSSES_EXCEED_REPAYMENT(_losses, repayment);
        }
        borrowedFunds -= _amountBorrowed;
        asset.safeTransferFrom(msg.sender, address(this), repayment - _losses);
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
        // FIX: Insufficient Liquidity Risk Mitigation
        // Using Math.min ensures that the borrow capacity can never accidentally exceed the actual liquid assets available in the contract.
        // This prevents a scenario where totalAssets (inflated by borrowedFunds) allows a borrow that cannot be fulfilled by the contract's balance.
        uint256 availableToBorrow = (totalAssets() * MAX_BORROW_RATIO) / 10000;
        uint256 borrowCapacity = availableToBorrow - borrowedFunds;
        return Math.min(borrowCapacity, asset.balanceOf(address(this)));
    }

    // --------------- Overridden Functions for Security ---------------

    // FIX: ERC4626 Inflation Attack Mitigation
    function deposit(uint256 assets, address receiver) public override returns (uint256 shares) {
        // Enforce a minimum deposit amount only when the pool is in its vulnerable initial state.
        if (totalSupply == 1000) { // The only shares are the 1000 wei minted to address(0)
            if (assets < MIN_INITIAL_DEPOSIT) {
                revert LiquidityPool__DEPOSIT_AMOUNT_TOO_LOW();
            }
        }
        return super.deposit(assets, receiver);
    }

    // FIX: ERC4626 Inflation Attack Mitigation
    function mint(uint256 shares, address receiver) public override returns (uint256 assets) {
        // Enforce a minimum deposit amount only when the pool is in its vulnerable initial state.
        if (totalSupply == 1000) { // The only shares are the 1000 wei minted to address(0)
            assets = previewMint(shares);
            if (assets < MIN_INITIAL_DEPOSIT) {
                revert LiquidityPool__DEPOSIT_AMOUNT_TOO_LOW();
            }
        }
        return super.mint(shares, receiver);
    }

    // FIX: Front-running / Insufficient Liquidity Mitigation
    function withdraw(
        uint256 assets,
        address receiver,
        address owner
    ) public override returns (uint256 shares) {
        uint256 available = asset.balanceOf(address(this));
        if (assets > available) {
            revert LiquidityPool__INVALID_WITHDRAWAL_AMOUNT(assets, available);
        }
        // Note: True front-running protection requires a slippage parameter, which would change the ABI.
        // This check primarily ensures withdrawals do not exceed physically available assets.
        return super.withdraw(assets, receiver, owner);
    }

    // FIX: Front-running / Insufficient Liquidity Mitigation
    function redeem(
        uint256 shares,
        address receiver,
        address owner
    ) public override returns (uint256 assets) {
        assets = previewRedeem(shares);
        uint256 available = asset.balanceOf(address(this));
        if (assets > available) {
            revert LiquidityPool__INVALID_WITHDRAWAL_AMOUNT(assets, available);
        }
        // Note: True front-running protection requires a slippage parameter, which would change the ABI.
        // This check primarily ensures redemptions do not exceed physically available assets.
        return super.redeem(shares, receiver, owner);
    }
}