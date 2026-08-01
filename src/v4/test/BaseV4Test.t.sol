// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {EswapMarginHook, IPriceFeed} from "../EswapMarginHook.sol";
import {PoolManagerMock} from "./mocks/PoolManagerMock.sol";
import {LiquidityPoolMock} from "./mocks/LiquidityPoolMock.sol";
import {PoolKey} from "../types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "../types/PoolId.sol";
import {Currency} from "../types/Currency.sol";

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract ERC20Mock is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {
        _mint(msg.sender, 1_000_000 ether);
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract PriceFeedMock is IPriceFeed {
    mapping(address => uint256) public prices;
    function setPrice(address token, uint256 price) external { prices[token] = price; }
    function getAmountInUsd(address token, uint256 amount) external view override returns (uint256) {
        return (amount * (prices[token] > 0 ? prices[token] : 1e18)) / 1e18;
    }

    function getTwapPrice(address token) external view override returns (uint256) {
        return prices[token] > 0 ? prices[token] : 1e18;
    }
}

contract BaseV4Test is Test {
    using PoolIdLibrary for PoolKey;

    EswapMarginHook public hook;
    PoolManagerMock public manager;
    PriceFeedMock public priceFeed;
    LiquidityPoolMock public lp;
    PoolKey public key;
    ERC20Mock public token0;
    ERC20Mock public token1;

    function setUp() public virtual {
        manager = new PoolManagerMock();
        priceFeed = new PriceFeedMock();
        lp = new LiquidityPoolMock();

        token0 = new ERC20Mock("Token 0", "TK0");
        token1 = new ERC20Mock("Token 1", "TK1");

        address hookAddress = address(uint160((1 << 159) | (1 << 158) | (1 << 153) | (1 << 152) | (1 << 148)));
        deployCodeTo("EswapMarginHook.sol:EswapMarginHook", abi.encode(manager, priceFeed), hookAddress);
        hook = EswapMarginHook(hookAddress);

        key = PoolKey({
            currency0: Currency.wrap(address(token0)),
            currency1: Currency.wrap(address(token1)),
            fee: 3000,
            tickSpacing: 60,
            hooks: address(hook)
        });

        hook.setRouter(address(this));
        hook.setAuthorizedPool(key.toId(), true);
    }
}
