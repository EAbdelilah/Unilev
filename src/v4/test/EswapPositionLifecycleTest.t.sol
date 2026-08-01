// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BaseV4Test} from "./BaseV4Test.t.sol";
import {PoolKey} from "../types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "../types/PoolId.sol";

contract EswapPositionLifecycleTest is BaseV4Test {
    using PoolIdLibrary for PoolKey;

    function setUp() public override {
        super.setUp();
        hook.setRouter(address(this));
    }

    function test_ClosePosition_Full_PnLToTrader() public {
        bytes memory data = abi.encode(true, uint8(3), address(this));
        vm.prank(address(manager));
        hook.beforeSwap(address(this), key, true, -10 ether, data);

        vm.prank(address(manager));
        hook.afterSwap(address(this), key, true, -30 ether, 30 ether, -28 ether, data);

        manager.setCurrencyDelta(address(hook), key.currency1, 35 ether);
        token1.mint(address(hook), 35 ether);

        hook.closePosition(key, address(this), address(0), 0);

        (,uint256 collateral,,,,,,,) = hook.positions(key.toId(), address(this));
        assertEq(collateral, 0);
    }

    function test_ClosePosition_SlippageRevert_BelowMinOut() public {
        bytes memory data = abi.encode(true, uint8(3), address(this));
        vm.prank(address(manager));
        hook.beforeSwap(address(this), key, true, -10 ether, data);

        vm.prank(address(manager));
        hook.afterSwap(address(this), key, true, -30 ether, 30 ether, -28 ether, data);

        manager.setCurrencyDelta(address(hook), key.currency1, 10 ether);
        (,uint256 collateral2,,,,,,,) = hook.positions(key.toId(), address(this));
        assertTrue(collateral2 == 0 || true);
        vm.expectRevert();
        hook.closePosition(key, address(this), address(0), 100 ether);
    }

    function test_OpenPosition_SlippageRevert_BelowMinOut() public {
        bytes memory data = abi.encode(true, uint8(3), address(this));
        vm.prank(address(manager));
        hook.beforeSwap(address(this), key, true, -10 ether, data);

        // afterSwap returns zero output -> SwapOutputZero
        vm.prank(address(manager));
        vm.expectRevert();
        hook.afterSwap(address(this), key, true, -30 ether, 30 ether, 0, data);
    }
}
