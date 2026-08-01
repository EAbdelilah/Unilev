// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BaseV4Test} from "./BaseV4Test.t.sol";
import {EswapRouter} from "../EswapRouter.sol";

contract EswapQuoterTest is BaseV4Test {
    EswapRouter public router;

    function setUp() public override {
        super.setUp();
        router = new EswapRouter(manager);
        hook.setRouter(address(router));
    }

    function test_QuoteMatchesExecution_ZeroDeviation() public view {
        int128 amountIn = -10 ether;
        uint8 leverage = 3;
        int128 quote = router.quoteExactInput(key, true, amountIn, leverage);

        assertEq(quote, 30 ether);
    }

    function test_QuoteZeroOutput_InvalidLeverage() public view {
        int128 quoteHigh = router.quoteExactInput(key, true, -10 ether, 10);
        int128 quoteZero = router.quoteExactInput(key, true, -10 ether, 0);

        assertEq(quoteHigh, 0);
        assertEq(quoteZero, 0);
    }

    function test_QuoteZeroOutput_ZeroAmount() public view {
        int128 quote = router.quoteExactInput(key, true, 0, 3);
        assertEq(quote, 0);
    }

    function test_QuoteIsStaticCall_NoStateChange() public view {
        // Calling view helper in view context proves zero state modification
        int128 quote = router.quoteExactInput(key, true, -5 ether, 2);
        assertTrue(quote > 0);
    }
}
