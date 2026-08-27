// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BaseV4Test} from "./BaseV4Test.t.sol";
import {EswapMarginHook} from "../EswapMarginHook.sol";
import {PoolKey} from "../types/PoolKey.sol";
import {IPoolManager} from "../interfaces/IPoolManager.sol";
import {BalanceDeltaLibrary} from "../types/BalanceDelta.sol";

contract ReentrancyAttacker {
    EswapMarginHook public target;
    PoolKey public key;
    bool public attackAttempted;

    constructor(EswapMarginHook _target, PoolKey memory _key) {
        target = _target;
        key = _key;
    }

    function unlockCallback(bytes calldata) external returns (bytes memory) {
        attackAttempted = true;
        try target.closePosition(key, address(this), address(0), 0) {} catch {}
        try target.beforeSwap(
            address(this), key, IPoolManager.SwapParams(true, -100 ether, 0), abi.encode(true, uint8(3), address(this))
        ) {}
            catch {}
        return "";
    }

    function attack(address poolManager) external {
        IPoolManager(poolManager).unlock(abi.encode(uint256(0)));
    }
}

contract EswapReentrancyTest is BaseV4Test {
    function setUp() public override {
        super.setUp();
        hook.setRouterAndMinCollateralUsd(address(this), 0);
        bytes memory data = abi.encode(true, uint8(3), address(this));
        vm.prank(address(manager));
        hook.beforeSwap(address(this), key, IPoolManager.SwapParams(true, -100 ether, 0), data);
        vm.prank(address(manager));
        hook.afterSwap(
            address(this),
            key,
            IPoolManager.SwapParams(true, -300 ether, 0),
            BalanceDeltaLibrary.toBalanceDelta(300 ether, 290 ether),
            data
        );

        // Simulate Router minting ERC-6909 collateral claims (2× for _settleTransientDebt + _settle).
        // positionCollateral = 290 - 1.45 (50 bps) = 288.55
        manager.mint(address(hook), uint256(uint160(address(token1))), 578 ether);

        // Fund the hook with the debt currency so the close can transfer the surplus to the
        // trader (the mock's take() is a no-op, so the recovered tokens never reach the hook).
        // The position opened with zeroForOne=true is a SHORT, so the debt currency is currency0.
        token0.mint(address(hook), 300 ether);
        // Collateral-currency (token1) leg of the unwind swap: 290 * 9950 / 10000.
        token1.mint(address(hook), 288.55 ether);
    }

    function test_NonReentrant_ClosePosition() public {
        PoolKey memory keyMem = key;
        ReentrancyAttacker attacker = new ReentrancyAttacker(hook, keyMem);
        hook.closePosition(key, address(this), address(0), 0);

        assertFalse(attacker.attackAttempted());
    }

    function test_NonReentrant_BeforeSwap() public {
        PoolKey memory keyMem = key;
        ReentrancyAttacker attacker = new ReentrancyAttacker(hook, keyMem);

        bytes memory data = abi.encode(true, uint8(3), address(attacker));
        vm.prank(address(manager));
        hook.beforeSwap(address(attacker), key, IPoolManager.SwapParams(true, -100 ether, 0), data);

        assertFalse(attacker.attackAttempted());
    }
}
