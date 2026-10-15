// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title EswapFlashVault
/// @notice Backup-liquidity vault for the Eswap solver rail.
///
///         Holds a single ERC-20 reserve (USDC on Base) that the registered
///         solver may pull as a shortfall top-up when its own borrow leg is
///         under-funded. Every pull is emitted on-chain so the borrow leg stays
///         auditable alongside the hook's `solverDebts` senior-claim registry.
///
/// @dev This is deliberately NOT a v4 hook and holds no PoolManager state: it is
///      a plain escrow so it can be deployed, seeded and inspected independently
///      of the Uniswap v4 stack (which is what makes it cheap to verify on a
///      fork). The borrow leg it funds is settled by EswapRouter, not here.
contract EswapFlashVault is Ownable {
    using SafeERC20 for IERC20;

    /// @notice Reserve asset (USDC on Base, 6 decimals).
    IERC20 public immutable asset;

    /// @notice The only address allowed to pull backup liquidity.
    address public solver;

    /// @notice Cumulative amount pulled through the vault (accounting only).
    uint256 public totalPulled;

    event SolverSet(address indexed solver);
    event Funded(address indexed from, uint256 amount);
    event Pulled(address indexed to, uint256 amount, bytes32 indexed reason);
    event Repaid(address indexed from, uint256 amount);
    event SolverApprovalRefreshed(address indexed router, uint256 amount);

    error NotSolver();
    error ZeroAmount();
    error ZeroAddress();
    error InsufficientBalance(uint256 available, uint256 requested);

    constructor(IERC20 _asset, address initialOwner) Ownable(initialOwner) {
        if (address(_asset) == address(0)) revert ZeroAddress();
        asset = _asset;
    }

    /// @notice Set the authorised solver. Owner only.
    function setSolver(address _solver) external onlyOwner {
        if (_solver == address(0)) revert ZeroAddress();
        solver = _solver;
        emit SolverSet(_solver);
    }

    /// @notice Seed / top up the vault reserve. Caller must have approved `asset`.
    function fund(uint256 amount) external {
        if (amount == 0) revert ZeroAmount();
        asset.safeTransferFrom(msg.sender, address(this), amount);
        emit Funded(msg.sender, amount);
    }

    /// @notice Reserve balance available for backup liquidity.
    function balance() external view returns (uint256) {
        return asset.balanceOf(address(this));
    }

    /// @notice Pull backup liquidity to `to` for a solver borrow leg.
    /// @param to     Recipient of the backup liquidity (solver or router escrow).
    /// @param amount Amount to pull. Reverts if it exceeds the reserve.
    /// @param reason Free-form tag echoed in the event for trace reconstruction.
    /// @return The amount transferred.
    function pull(address to, uint256 amount, bytes32 reason) external returns (uint256) {
        if (msg.sender != solver) revert NotSolver();
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();

        uint256 available = asset.balanceOf(address(this));
        if (amount > available) revert InsufficientBalance(available, amount);

        totalPulled += amount;
        asset.safeTransfer(to, amount);
        emit Pulled(to, amount, reason);
        return amount;
    }

    /// @notice Return liquidity to the reserve.
    function repay(uint256 amount) external {
        if (amount == 0) revert ZeroAmount();
        asset.safeTransferFrom(msg.sender, address(this), amount);
        emit Repaid(msg.sender, amount);
    }
}
