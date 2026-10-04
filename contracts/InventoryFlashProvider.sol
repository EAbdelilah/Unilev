// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {IBalancerVault, IBalancerFlashLoanRecipient} from "./EswapArbitrageExecutor.sol";

/**
 * @title InventoryFlashProvider
 * @notice A zero-fee, single-transaction liquidity source for `EswapArbitrageExecutor`.
 *
 * @dev Why this exists
 *      `EswapArbitrageExecutor._flashProvider` is immutable and `FlashMode.Balancer`
 *      speaks the Balancer V2 `Vault` interface. Unichain has **no** Balancer V2 Vault:
 *      the canonical `0xBA12222222228d8Ba445958a75a0704d566BF2C8` on this chain is an
 *      unrelated 1,546-byte contract with no `flashLoan`, and Morpho Blue is not
 *      deployed here either. Aave charges a premium and is out of scope.
 *
 *      A Uniswap V4 `flash()` source is *also* structurally impossible here: the
 *      provider would hold the PoolManager lock across `receiveFlashLoan`, while the
 *      executor's ESWAP router leg must itself enter `PoolManager.unlock` for its V4
 *      swap, and `unlock` reverts with `AlreadyUnlocked` when the lock is held. The
 *      executor's own design assumes the flash source never takes the V4 lock.
 *
 *      This contract therefore lends its own inventory for the duration of a single
 *      transaction. It is the cheapest 0-cost option available on this chain: there
 *      is no premium, no interest, and no accrual, so the premium leg is removed from
 *      the round trip's cost floor entirely rather than merely priced at zero.
 *
 * @dev Cost of the loan
 *      Exactly zero by construction. There is deliberately no `feeBps` field and no
 *      setter: the fee cannot be misconfigured into a nonzero value, and the reported
 *      `feeAmounts[0]` is always 0. Repayment is principal-only.
 *
 * @dev Safety model
 *      `flashLoan` is intentionally permissionless. Lending is atomic and fee-free,
 *      so a third party can only borrow inventory it returns in the same transaction
 *      or cause its own transaction to revert; there is no balance that can be
 *      stranded, drained, or front-run across transactions. Restricting the caller to
 *      a single address would add mutable trust state and a circular deployment
 *      dependency (the executor needs this address, so this cannot be immutable).
 *
 *      Capital at risk is bounded by the owner's choice of funding and is recoverable
 *      at any time via `withdraw`.
 */
contract InventoryFlashProvider is IBalancerVault, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice Emitted when the owner adds inventory this contract can lend.
    event InventoryFunded(address indexed asset, uint256 amount);

    /// @notice Emitted on every successful loan, with a fee that is always zero.
    event FlashLoanIssued(address indexed recipient, address indexed asset, uint256 amount, uint256 fee);

    error BadAmount();
    error InsufficientInventory(address asset);
    error MultiAssetUnsupported();

    constructor() Ownable(msg.sender) {}

    /**
     * @notice Lend `amount` of `asset` to `recipient` for the duration of one call.
     * @dev Mirrors Balancer V2 `Vault.flashLoan` because that is the entrypoint the
     *      executor calls. Transfers the principal in, runs the recipient's callback
     *      with `feeAmounts[0] == 0`, then pulls principal back and requires it to be
     *      restored. Any shortfall reverts the whole transaction, including the
     *      initial transfer.
     *
     *      `nonReentrant` blocks a callback from re-entering `flashLoan`.
     */
    function flashLoan(address recipient, address[] calldata tokens, uint256[] calldata amounts, bytes calldata userData)
        external
        payable
        nonReentrant
    {
        // The executor deliberately supports a single asset and raises
        // `MultiAssetFlashUnsupported` itself; reject here so that guard is what gets
        // exercised end-to-end rather than assumed.
        if (tokens.length != 1 || amounts.length != 1) revert MultiAssetUnsupported();

        address asset = tokens[0];
        uint256 amount = amounts[0];
        if (amount == 0) revert BadAmount();

        if (IERC20(asset).balanceOf(address(this)) < amount) revert InsufficientInventory(asset);
        IERC20(asset).safeTransfer(recipient, amount);

        IERC20[] memory loanTokens = new IERC20[](1);
        uint256[] memory loanAmounts = new uint256[](1);
        uint256[] memory feeAmounts = new uint256[](1);
        loanTokens[0] = IERC20(asset);
        loanAmounts[0] = amount;
        // feeAmounts[0] stays 0: the loan is free by construction.

        emit FlashLoanIssued(recipient, asset, amount, 0);

        IBalancerFlashLoanRecipient(recipient).receiveFlashLoan(loanTokens, loanAmounts, feeAmounts, userData);

        // Balancer's Vault is transient-stored rather than allowance-based and simply
        // checks the recipient's balance here. The executor sets an approval for
        // symmetry with Aave, which is harmless and is used below.
        if (IERC20(asset).balanceOf(recipient) < amount) revert BadAmount();
        IERC20(asset).safeTransferFrom(recipient, address(this), amount);
    }

    /// @notice Add inventory for `asset` that can be lent fee-free.
    function fund(address asset, uint256 amount) external onlyOwner {
        if (amount == 0) revert BadAmount();
        IERC20(asset).safeTransferFrom(msg.sender, address(this), amount);
        emit InventoryFunded(asset, amount);
    }

    /// @notice Recover inventory. The owner may withdraw at any time, including
    ///         between loans, since no loan can span transactions.
    function withdraw(address asset, address to, uint256 amount) external onlyOwner {
        IERC20(asset).safeTransfer(to, amount);
    }

    receive() external payable {}
}