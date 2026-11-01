// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BaseV4Test} from "./BaseV4Test.t.sol";
import {EswapMarginHook} from "../EswapMarginHook.sol";
import {EswapMarginHookLogic} from "../EswapMarginHookLogic.sol";
import {BeforeSwapDelta} from "../types/BeforeSwapDelta.sol";
import {Currency} from "../types/Currency.sol";
import {PoolKey} from "../types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "../types/PoolId.sol";
import {IPoolManager} from "../interfaces/IPoolManager.sol";
import {BalanceDeltaLibrary} from "../types/BalanceDelta.sol";

contract EswapHardenedTest is BaseV4Test {
    using PoolIdLibrary for PoolKey;

    function test_LeverageCap_Reverts() public {
        uint8 tooHighLeverage = 10;
        bytes memory data = abi.encode(true, tooHighLeverage, address(this));

        vm.prank(address(manager));
        vm.expectRevert();
        hook.beforeSwap(address(this), key, IPoolManager.SwapParams(true, -10 ether, 0), data);
    }

    function test_SmartCollateral_LiquidityDeployment() public {
        uint8 leverage = 5;
        bytes memory data = abi.encode(true, leverage, address(this));

        vm.startPrank(address(manager));
        hook.beforeSwap(address(this), key, IPoolManager.SwapParams(true, -100 ether, 0), data);
        hook.afterSwap(
            address(this),
            key,
            IPoolManager.SwapParams(true, -500 ether, 0),
            BalanceDeltaLibrary.toBalanceDelta(-500 ether, 480 ether),
            data
        );
        vm.stopPrank();

        hook.deployCollateral(key, address(this));

        (,,,,,, int24 tickLower, int24 tickUpper, uint128 liquidity) = hook.positions(key.toId(), address(this));
        assertTrue(liquidity > 0);
        // Single-sided band BELOW price holding token1 (SHORT collateral):
        // tick grid at 0 with spacing 60 -> [0 - 10*60, 0].
        assertEq(tickLower, -600);
        assertEq(tickUpper, 0);
    }

    function test_ERC6909_Transfer_Success() public {
        bytes memory data = abi.encode(true, uint8(5), address(this));
        vm.startPrank(address(manager));
        hook.beforeSwap(address(this), key, IPoolManager.SwapParams(true, -100 ether, 0), data);
        hook.afterSwap(
            address(this),
            key,
            IPoolManager.SwapParams(true, -500 ether, 0),
            BalanceDeltaLibrary.toBalanceDelta(-500 ether, 480 ether),
            data
        );
        vm.stopPrank();

        uint256 claimId = uint256(uint160(address(token1)));
        uint256 bal = hook._claimBalances(address(this), claimId);
        assertTrue(bal > 0);
    }

    /// @dev [AUDIT FIX] The unwind venue is security-critical: redirecting
    ///      `standardPoolKeys` lets whoever writes it route close/liquidation
    ///      swaps through an attacker-controlled pool. It must be owner-only,
    ///      not writable by the keeper/router path.
    function test_SetStandardPoolKey_NotRouterWritable() public {
        EswapMarginHookLogic logic = EswapMarginHookLogic(payable(address(hook)));

        PoolKey memory ownerKey = key;
        ownerKey.fee = 500;
        logic.setStandardPoolKey(key.toId(), ownerKey); // owner == address(this)

        PoolKey memory attackerKey = key;
        attackerKey.fee = 10_000;
        vm.prank(address(0xBAD));
        vm.expectRevert(EswapMarginHook.NotOwner.selector);
        logic.setStandardPoolKey(key.toId(), attackerKey);

        (,, uint24 storedFee,,) = hook.standardPoolKeys(key.toId());
        assertEq(storedFee, 500, "non-owner rewrote the unwind venue");
    }
}
