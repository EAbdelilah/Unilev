// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {EswapMarginLib} from "../EswapMarginLib.sol";

/// @dev [AUDIT CRIT-SYS-01] Regression: the liquidation-threshold formula
///      must never get a floor of exactly 100pct (guaranteed bad debt at
///      >=10x). The floor is now 10,500 bps = 105pct: at 10x and beyond the
///      keeper liquidates while the position is still 5pct solvent, so the
///      liquidation is never structurally loss-making.
contract EswapMarginLibTwapTest is Test {
    function test_CRIT_SYS_01_FloorIs105pct_Not100pct() public pure {
        for (uint8 lev = 10; lev <= 64; lev++) {
            assertEq(EswapMarginLib.liquidationThresholdBps(lev), 10500);
        }
        assertEq(EswapMarginLib.liquidationThresholdBps(9), 10200);
        assertEq(EswapMarginLib.liquidationThresholdBps(5), 11000);
        assertEq(EswapMarginLib.liquidationThresholdBps(1), 11800);
    }
}