// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BaseV4Test} from "./BaseV4Test.t.sol";
import {EswapMarginHook} from "../EswapMarginHook.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";

contract ReentrancyAttacker is IUnlockCallback {
    EswapMarginHook public target;
    PoolKey public key;
    bool public attackAttempted;

    constructor(EswapMarginHook _target, PoolKey memory _key) {
        target = _target;
        key = _key;
    }

    function unlockCallback(bytes calldata) external returns (bytes memory) {
        attackAttempted = true;
        try target.closePosition(key, address(this), 0) {} catch {}
        try target.beforeSwap(
            address(this), key,
            IPoolManager.SwapParams({zeroForOne: true, amountSpecified: -100 ether, sqrtPriceLimitX96: 0}),
            abi.encode(true, uint8(3), address(this))
        ) {} catch {}
        return "";
    }

    function attack(address poolManager) external {
        IPoolManager(poolManager).unlock(abi.encode(uint256(0)));
    }
}

contract EswapReentrancyTest is BaseV4Test {
    function setUp() public override {
        super.setUp();
        hook.setRouter(address(this));
        bytes memory data = abi.encode(true, uint8(3), address(this));
        vm.prank(address(manager));
        beforeSwap(address(this), key, true, -100 ether, data);
        vm.prank(address(manager));
        afterSwap(address(this), key, true, -300 ether, -300 ether, 290 ether, data);
    }

    function test_NonReentrant_ClosePosition() public {
        ReentrancyAttacker attacker = new ReentrancyAttacker(hook, key);
        hook.closePosition(key, address(this), 0);

        assertFalse(attacker.attackAttempted());
    }

    function test_NonReentrant_BeforeSwap() public {
        ReentrancyAttacker attacker = new ReentrancyAttacker(hook, key);

        bytes memory data = abi.encode(true, uint8(3), address(attacker));
        vm.prank(address(manager));
        beforeSwap(address(attacker), key, true, -100 ether, data);

        assertFalse(attacker.attackAttempted());
    }
}
