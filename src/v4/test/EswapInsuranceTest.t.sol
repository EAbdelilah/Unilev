// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BaseV4Test} from "./BaseV4Test.t.sol";
import {Currency} from "../types/Currency.sol";

contract EswapInsuranceTest is BaseV4Test {
    function test_InsuranceFundBadDebtCoverage() public {
        address trader = address(0xABC);

        // 1. Setup Insurance Fund with some tokens
        Currency token0 = key.currency0;
        vm.deal(address(hook), 10 ether); // Simulate accumulated fees
        // Manual internal state update for testing
        // In real script, we'd use a setter or generated fees

        // 2. Open 5x Long Position
        // ... (standard open)

        // 3. Price Crashes (Bad Debt scenario)
        // Oracle price shows collateral worth less than borrowed amount
        priceFeed.setPrice(Currency.unwrap(key.currency1), 0.5 ether); // 50% crash

        // 4. Liquidate
        // This should trigger _executeLiquidation and use insurance fund
        // to repay the PM shortfall.
    }
}
