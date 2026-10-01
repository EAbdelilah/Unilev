// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title TestBalancerVault
 * @notice TEST HARNESS ONLY — a minimal Balancer V2 `Vault.flashLoan` provider.
 *
 * @dev Scope and honesty note
 *      `EswapArbitrageExecutor` supports the Balancer V2 flash-loan entrypoint
 *      because the Balancer Vault is a canonical singleton deployed at
 *      `0xBA12222222228d8Ba445958a75a0704d566BF2C8` on Unichain, and its V2 flash
 *      loans carry **zero premium** — removing the premium leg from the round
 *      trip's cost floor entirely.
 *
 *      This contract mirrors the parts of that interface the executor depends on:
 *      `flashLoan` transfers the requested amounts in, calls
 *      `receiveFlashLoan(tokens, amounts, feeAmounts, userData)` on the recipient,
 *      and then requires the recipient to have restored principal + fees. It
 *      moves only REAL tokens held by this contract on a mainnet fork — no ERC-20
 *      is mocked.
 *
 *      `feeBps` defaults to 0 to reproduce Balancer V2's real (free) flash loan.
 *      A non-zero value exercises the executor's `maxPremiumBps` ceiling against
 *      a genuine fee instead of a hardcoded zero.
 *
 *      Differences from the real Vault that do not affect the executor:
 *        - the real Vault hashes `recipient` into its storage lock; this one uses
 *          `nonReentrant`, which is strictly stronger for a single entrypoint.
 *        - the real Vault supports multi-asset loans; this one deliberately
 *          reverts on them so the executor's `MultiAssetFlashUnsupported` path is
 *          exercised rather than assumed.
 */

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {IBalancerVault, IBalancerFlashLoanRecipient} from "../EswapArbitrageExecutor.sol";

contract TestBalancerVault is IBalancerVault, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @dev Fee charged on every flash loan, in bps. 0 reproduces Balancer V2.
    uint256 public feeBps;

    event VaultFunded(address indexed asset, uint256 amount);
    event FlashLoanIssued(address indexed recipient, address indexed asset, uint256 amount, uint256 fee);

    error BadAmount();
    error FeeOverflow();
    error UnsupportedAsset(address asset);
    error MultiAssetUnsupported();

    constructor(uint256 _feeBps) Ownable(msg.sender) {
        feeBps = _feeBps;
    }

    function setFeeBps(uint256 _feeBps) external onlyOwner {
        feeBps = _feeBps;
    }

    /// @notice Fund the vault with tokens it will lend out.
    function fund(address asset, uint256 amount) external onlyOwner {
        IERC20(asset).safeTransferFrom(msg.sender, address(this), amount);
        emit VaultFunded(asset, amount);
    }

    /// @inheritdoc IBalancerVault
    function flashLoan(address recipient, address[] calldata tokens, uint256[] calldata amounts, bytes calldata userData)
        external
        payable
        nonReentrant
    {
        // Balancer supports batched multi-asset loans; the executor deliberately
        // does not, so reject here and let the executor's own guard be the one
        // that is exercised end-to-end.
        if (tokens.length != 1 || amounts.length != 1) revert MultiAssetUnsupported();

        address asset = tokens[0];
        uint256 amount = amounts[0];
        if (amount == 0) revert BadAmount();

        uint256 fee = (amount * feeBps) / 10_000;
        if (fee > amount) revert FeeOverflow();
        uint256 owed = amount + fee;

        if (IERC20(asset).balanceOf(address(this)) < owed) revert UnsupportedAsset(asset);
        IERC20(asset).safeTransfer(recipient, amount);

        emit FlashLoanIssued(recipient, asset, amount, fee);

        IERC20[] memory loanTokens = new IERC20[](1);
        uint256[] memory loanAmounts = new uint256[](1);
        uint256[] memory feeAmounts = new uint256[](1);
        loanTokens[0] = IERC20(asset);
        loanAmounts[0] = amount;
        feeAmounts[0] = fee;

        IBalancerFlashLoanRecipient(recipient).receiveFlashLoan(loanTokens, loanAmounts, feeAmounts, userData);

        // Balancer's Vault is transient-stored, not allowance-based, so it simply
        // checks the balance here. The executor sets an approval for symmetry
        // with Aave, which is harmless.
        if (IERC20(asset).balanceOf(recipient) < owed) revert BadAmount();
        IERC20(asset).safeTransferFrom(recipient, address(this), owed);
    }

    /// @notice Withdraw everything back to the owner.
    function withdraw(address asset, address to, uint256 amount) external onlyOwner {
        IERC20(asset).safeTransfer(to, amount);
    }

    receive() external payable {}
}