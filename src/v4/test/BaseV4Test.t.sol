// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {EswapMarginHook} from "../EswapMarginHook.sol";
import {PoolManagerMock} from "./mocks/PoolManagerMock.sol";
import {PoolKey} from "../types/PoolKey.sol";
import {Currency} from "../types/Currency.sol";

contract BaseV4Test is Test {
    EswapMarginHook public hook;
    PoolManagerMock public manager;
    PoolKey public key;

    function setUp() public virtual {
        manager = new PoolManagerMock();
        hook = new EswapMarginHook(manager);

        key = PoolKey({
            currency0: Currency.wrap(address(0x1)),
            currency1: Currency.wrap(address(0x2)),
            fee: 3000,
            tickSpacing: 60,
            hooks: address(hook)
        });
    }
}
