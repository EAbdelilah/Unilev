// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Currency} from "../types/Currency.sol";

/// @notice Native-aware token custody helpers used when the protocol's ETH leg is
///         native ether (Currency 0x0) instead of an ERC-20. Every operation that
///         would normally call an ERC-20 on the native leg is routed to a raw ETH
///         transfer / balance check so the PoolManager's native settlement flow
///         (msg.value-based settle, ETH take) works end-to-end.
library NativeTokens {
    using SafeERC20 for IERC20;

    error NativeTransferFailed(address to);

    function isNative(Currency currency) internal pure returns (bool) {
        return Currency.unwrap(currency) == address(0);
    }

    /// @dev Balance of `holder` in `currency` (ETH balance for native).
    function balanceOf(Currency currency, address holder) internal view returns (uint256) {
        if (isNative(currency)) return holder.balance;
        return IERC20(Currency.unwrap(currency)).balanceOf(holder);
    }

    /// @dev Transfers `amount` of `currency` from `this` to `to`.
    ///      Native: raw ETH call; ERC20: safeTransfer.
    function transfer(Currency currency, address to, uint256 amount) internal {
        if (isNative(currency)) {
            if (address(this).balance < amount) revert NativeTransferFailed(to);
            (bool ok,) = to.call{value: amount}("");
            if (!ok) revert NativeTransferFailed(to);
        } else {
            IERC20(Currency.unwrap(currency)).safeTransfer(to, amount);
        }
    }

    /// @dev Transfers `amount` of `currency` from `from` to `this`.
    ///      Native cannot use transferFrom (no approval); the caller must already
    ///      hold native on this contract (funded via msg.value at the entrypoint).
    ///      ERC20: safeTransferFrom.
    function transferFrom(Currency currency, address from, address to, uint256 amount) internal {
        if (isNative(currency)) {
            // Only meaningful when `from == address(this)` (escrowed native) or a
            // revert for external pulls — external native pulls are impossible.
            if (from == address(this)) {
                transfer(currency, to, amount);
                return;
            }
            revert NativeTransferFailed(from);
        } else {
            IERC20(Currency.unwrap(currency)).safeTransferFrom(from, to, amount);
        }
    }
}
