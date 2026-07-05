// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Currency} from "../types/Currency.sol";

interface IURC3 {
    function getHookTVL(Currency currency) external view returns (uint256);
    function getSwappableCapacity(Currency currency) external view returns (uint256);
}
