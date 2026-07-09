// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Currency} from "../types/Currency.sol";

/**
 * @title IURC3: HookStats
 * @notice Standardized read-only interface for hook TVL and capacity.
 */
interface IURC3 {
    /**
     * @notice Returns the total value locked within the hook for a specific currency.
     */
    function getHookTVL(Currency currency) external view returns (uint256);

    /**
     * @notice Returns the immediately swappable liquidity (capacity) of the hook.
     */
    function getSwappableCapacity(Currency currency) external view returns (uint256);
}
