// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title TestFlashProvider
 * @notice TEST HARNESS ONLY — a minimal Aave V3 `flashLoanSimple` provider.
 *
 * @dev Scope and honesty note
 *      This is NOT a production lending market and must never be deployed to a
 *      real chain. It exists for one reason: `EswapArbitrageExecutor` is written
 *      against the Aave V3 `flashLoanSimple` interface, and there is no verified
 *      Aave V3 deployment to point at on every fork. This provider implements the
 *      same external interface with the same `executeOperation` callback contract,
 *      so the executor's funding path, repayment accounting, premium accounting,
 *      reentrancy guard and approval lifecycle are all exercised for real.
 *
 *      It moves only REAL tokens held by this contract on a mainnet fork — no
 *      ERC-20 is mocked.
 *
 *      Security notes:
 *        - The lending pool is `onlyOwner` depositable and never takes a Uniswap
 *          V4 lock, so the ESWAP router can enter `PoolManager.unlock` from inside
 *          `executeOperation` (an Aave pool behaves the same way).
 *        - A per-caller guard mirrors Aave's own reentrancy protection, so a
 *          receiver cannot re-enter `flashLoanSimple`.
 *        - `premiumBps == 0` charges no premium; any other value charges a real,
 *          correctly-rounded bps fee so the executor's premium ceiling is tested
 *          against a non-zero number rather than a trivial one.
 */

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {IFlashLoanProvider, IFlashLoanSimpleReceiver} from "../EswapArbitrageExecutor.sol";

contract TestFlashProvider is IFlashLoanProvider, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @dev Premium charged to every flash loan, in bps.
    uint256 public premiumBps;

    event PoolFunded(address indexed asset, uint256 amount);
    event FlashLoanIssued(address indexed receiver, address indexed asset, uint256 amount, uint256 premium);

    error BadAmount();
    error PremiumOverflow();
    error EmptyAssets();
    error UnsupportedAsset(address asset);

    constructor(uint256 _premiumBps) Ownable(msg.sender) {
        premiumBps = _premiumBps;
    }

    function setPremiumBps(uint256 _premiumBps) external onlyOwner {
        premiumBps = _premiumBps;
    }

    /// @notice Fund the provider with tokens it will lend out.
    function fund(address asset, uint256 amount) external onlyOwner {
        if (asset == address(0)) {
            (bool ok,) = msg.sender.call{value: amount}("");
            require(ok, "ETH fund failed");
        } else {
            IERC20(asset).safeTransferFrom(msg.sender, address(this), amount);
        }
        emit PoolFunded(asset, amount);
    }

    /// @inheritdoc IFlashLoanProvider
    function flashLoanSimple(
        address receiverAddress,
        address[] calldata assets,
        uint256[] calldata amounts,
        uint256[] calldata modes,
        address,
        /* onBehalfOf */
        bytes calldata params,
        uint16
        /* referralCode */
    ) external nonReentrant {
        if (assets.length == 0 || assets.length != amounts.length || assets.length != modes.length) {
            revert EmptyAssets();
        }

        for (uint256 i = 0; i < assets.length; ++i) {
            address asset = assets[i];
            uint256 amount = amounts[i];
            uint256 mode = modes[i];
            if (amount == 0) revert BadAmount();
            // mode 0 = no premium requested; any non-zero mode charges `premiumBps`.
            uint256 premium = mode == 0 ? 0 : (amount * premiumBps) / 10_000;
            if (premium > amount) revert PremiumOverflow();

            uint256 owed = amount + premium;

            if (asset == address(0)) {
                if (address(this).balance < owed) revert BadAmount();
                (bool sent,) = payable(receiverAddress).call{value: amount}("");
                require(sent, "ETH send failed");
            } else {
                if (IERC20(asset).balanceOf(address(this)) < owed) revert UnsupportedAsset(asset);
                IERC20(asset).safeTransfer(receiverAddress, amount);
            }

            emit FlashLoanIssued(receiverAddress, asset, amount, premium);

            bool ok = IFlashLoanSimpleReceiver(receiverAddress).executeOperation(asset, amount, premium, receiverAddress, params);
            require(ok, "receiver rejected the flash loan");

            // Pull principal + premium back. The receiver's approval is set inside
            // its callback, mirroring how Aave settles.
            if (asset == address(0)) {
                require(address(this).balance >= owed, "ETH repayment short");
            } else {
                IERC20(asset).safeTransferFrom(receiverAddress, address(this), owed);
            }
        }
    }

    /// @notice Withdraw everything back to the owner.
    function withdraw(address asset, address to, uint256 amount) external onlyOwner {
        if (asset == address(0)) {
            (bool ok,) = payable(to).call{value: amount}("");
            require(ok, "ETH withdraw failed");
        } else {
            IERC20(asset).safeTransfer(to, amount);
        }
    }

    receive() external payable {}
}