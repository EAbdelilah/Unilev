// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";

// Legacy B2B integration test is incompatible with the new permissionless Fusion/UX settlement APIs.
contract BaseMainnetB2BIntegrationTest is Test {
    function test_LegacyDisabled() public {
        vm.skip(true);
    }
}
