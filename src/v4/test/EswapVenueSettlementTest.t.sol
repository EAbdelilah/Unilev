// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";

// Legacy venue settlement tests were tied to the old inventory-swap design.
// They are intentionally skipped after the permissionless leveraged-open refactor.
contract EswapVenueSettlementTest is Test {
    function test_LegacyDisabled() public {
        vm.skip(true);
    }
}
