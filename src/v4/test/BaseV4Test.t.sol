// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {EswapMarginHook, IPriceFeed} from "../EswapMarginHook.sol";
import {PoolManagerMock} from "./mocks/PoolManagerMock.sol";
import {LiquidityPoolMock} from "./mocks/LiquidityPoolMock.sol";
import {PoolKey} from "../types/PoolKey.sol";
import {Currency} from "../types/Currency.sol";

contract PriceFeedMock is IPriceFeed {
    mapping(address => uint256) public prices;
    function setPrice(address token, uint256 price) external { prices[token] = price; }
    function getAmountInUsd(address token, uint256 amount) external view override returns (uint256) {
        return (amount * (prices[token] > 0 ? prices[token] : 1e18)) / 1e18;
    }
}

contract BaseV4Test is Test {
    EswapMarginHook public hook;
    PoolManagerMock public manager;
    PriceFeedMock public priceFeed;
    LiquidityPoolMock public lp;
    PoolKey public key;

    function setUp() public virtual {
        manager = new PoolManagerMock();
        priceFeed = new PriceFeedMock();
        lp = new LiquidityPoolMock();

        // Mine for a salt that satisfies flags
        // For testing, we can often just use a predictable salt if the flags are simple,
        // but the hook constructor validates flags at the current address.
        // We'll use a simplified salt mining here or use vm.etch to place hook at flag-compatible address.

        // Flag-compatible address for: beforeInit, afterInit, beforeSwap, afterSwap, returnsDelta
        // Flags sum: 1<<159 | 1<<158 | 1<<153 | 1<<152 | 1<<148
        address hookAddr = address(uint160(uint256(keccak256("test_hook")) | (1 << 159 | 1 << 158 | 1 << 153 | 1 << 152 | 1 << 148)));

        hook = new EswapMarginHook{salt: bytes32(0)}(manager, priceFeed);

        key = PoolKey({
            currency0: Currency.wrap(address(0x1)),
            currency1: Currency.wrap(address(0x2)),
            fee: 3000,
            tickSpacing: 60,
            hooks: address(hook)
        });
    }
}
