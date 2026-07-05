// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BaseV4Test} from "./BaseV4Test.t.sol";
import {BeforeSwapDelta} from "../types/BeforeSwapDelta.sol";
import {Currency} from "../types/Currency.sol";

contract EswapHardenedTest is BaseV4Test {
    function test_LeverageCap_Reverts() public {
        uint8 tooHighLeverage = 10;
        bytes memory data = abi.encode(true, tooHighLeverage);

        vm.prank(address(manager));
        vm.expectRevert();
        hook.beforeSwap(address(this), key, true, -10 ether, data);
    }

    function test_SmartCollateral_LiquidityDeployment() public {
        uint8 leverage = 5;
        bytes memory data = abi.encode(true, leverage);

        vm.startPrank(address(manager));
        hook.beforeSwap(address(this), key, true, -100 ether, data);
        hook.afterSwap(address(this), key, true, -500 ether, 500 ether, -480 ether, "");
        vm.stopPrank();

        // Verify rehypothecated liquidity
        (,,,,,int24 tickLower, int24 tickUpper, uint128 liquidity) = hook.positions(key.toId(), address(this));
        assertEq(liquidity, 100 ether); // margin = 100
        assertEq(tickLower, -60);
        assertEq(tickUpper, 60);
    }

    function test_ERC6909_Transfer_Success() public {
        // Setup initial balance via swap
        vm.startPrank(address(manager));
        hook.beforeSwap(address(this), key, true, -100 ether, abi.encode(true, 5));
        hook.afterSwap(address(this), key, true, -500 ether, 500 ether, -480 ether, "");
        vm.stopPrank();

        uint256 claimId = uint256(uint160(Currency.unwrap(key.currency1)));
        assertEq(hook.balanceOf(address(this), claimId), 480 ether);

        // Transfer collateral
        address bob = address(0xB0B);
        vm.prank(address(this));
        hook.transfer(bob, claimId, 100 ether);

        assertEq(hook.balanceOf(address(this), claimId), 380 ether);
        assertEq(hook.balanceOf(bob, claimId), 100 ether);
    }
}
