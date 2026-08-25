// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BaseV4Test, PriceFeedMock, ERC20Mock} from "./BaseV4Test.t.sol";
import {PoolManagerCallbackMock} from "./mocks/PoolManagerMock.sol";
import {EswapMarginHook} from "../EswapMarginHook.sol";
import {EswapRouter} from "../EswapRouter.sol";
import {PoolKey} from "../types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "../types/PoolId.sol";
import {Currency} from "../types/Currency.sol";
import {IPoolManager} from "../interfaces/IPoolManager.sol";
import {BalanceDelta, BalanceDeltaLibrary} from "../types/BalanceDelta.sol";

contract EswapERC7683Test is BaseV4Test {
    using PoolIdLibrary for PoolKey;

    EswapRouter public router;
    PoolKey public standardPoolKey;

    uint256 public traderPrivateKey = 0xA11CE;
    address public trader;

    function setUp() public override {
        manager = new PoolManagerCallbackMock();
        priceFeed = new PriceFeedMock();

        token0 = new ERC20Mock("Token 0", "TK0");
        token1 = new ERC20Mock("Token 1", "TK1");

        address hookAddress = address(uint160((1 << 159) | (1 << 158) | (1 << 153) | (1 << 152) | (1 << 148)));
        deployCodeTo("EswapMarginHook.sol:EswapMarginHook", abi.encode(manager, priceFeed, address(this)), hookAddress);
        hook = EswapMarginHook(hookAddress);

        router = new EswapRouter(manager);

        key = PoolKey({
            currency0: Currency.wrap(address(token0)),
            currency1: Currency.wrap(address(token1)),
            fee: 3000,
            tickSpacing: 60,
            hooks: address(hook)
        });

        standardPoolKey = PoolKey({
            currency0: key.currency0,
            currency1: key.currency1,
            fee: 0,
            tickSpacing: 60,
            hooks: address(0)
        });

        hook.setRouterAndMinCollateralUsd(address(router), 0);
        hook.setAuthorizedPool(key.toId(), true);

        manager.setSlot0(key.toId(), 1 << 96, 0);
        manager.setSlot0(standardPoolKey.toId(), 1 << 96, 0);

        trader = vm.addr(traderPrivateKey);
        token0.mint(trader, 100 ether);
        token1.mint(trader, 100 ether);
    }

    function test_ERC7683_OrderResolution() public view {
        bytes memory orderData = abi.encode(
            key,
            standardPoolKey,
            true, // zeroForOne
            -10 ether, // amountSpecified
            uint8(5), // leverage
            address(0x999), // solver
            bytes("") // hookData
        );

        EswapRouter.CrossChainOrder memory order = EswapRouter.CrossChainOrder({
            settlementContract: address(router),
            swapper: trader,
            nonce: 42,
            originChainId: uint32(block.chainid),
            initiateDeadline: uint32(block.timestamp + 1 hours),
            fillDeadline: uint32(block.timestamp + 2 hours),
            orderData: orderData
        });

        EswapRouter.ResolvedCrossChainOrder memory resolved = router.resolve(order, "");

        assertEq(resolved.settlementContract, address(router));
        assertEq(resolved.swapper, trader);
        assertEq(resolved.nonce, 42);
        assertEq(resolved.originChainId, block.chainid);

        assertEq(resolved.swapperInputs.length, 1);
        assertEq(resolved.swapperInputs[0].token, Currency.unwrap(key.currency0));
        assertEq(resolved.swapperInputs[0].amount, 10 ether);

        assertEq(resolved.swapperOutputs.length, 1);
        assertEq(resolved.swapperOutputs[0].token, Currency.unwrap(key.currency1));
        assertEq(resolved.swapperOutputs[0].amount, 50 ether); // 10 ether * 5x leverage = 50 ether virtual output depth
    }

    function test_ERC7683_OrderInitiation_WithSignature() public {
        bytes memory orderData = abi.encode(
            key,
            standardPoolKey,
            true, // zeroForOne
            -10 ether, // amountSpecified (margin size)
            uint8(5), // leverage
            address(0x123), // solver (the caller or specialized solver)
            abi.encode(true, uint8(5), trader) // hookData with margin flag enabled
        );

        EswapRouter.CrossChainOrder memory order = EswapRouter.CrossChainOrder({
            settlementContract: address(router),
            swapper: trader,
            nonce: 101,
            originChainId: uint32(block.chainid),
            initiateDeadline: uint32(block.timestamp + 1 hours),
            fillDeadline: uint32(block.timestamp + 2 hours),
            orderData: orderData
        });

        // 1. Calculate EIP-712 Signature
        bytes32 orderHash = router.hashOrder(order);
        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                router.DOMAIN_SEPARATOR(),
                orderHash
            )
        );

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(traderPrivateKey, digest);
        bytes memory signature = abi.encodePacked(r, s, v);

        // Pre-approve router from trader and solver
        vm.startPrank(trader);
        token0.approve(address(router), type(uint256).max);
        vm.stopPrank();

        address solver = address(0x123);
        token0.mint(solver, 100 ether);
        vm.startPrank(solver);
        token0.approve(address(router), type(uint256).max);
        vm.stopPrank();

        // Mint token1 (the collateral) to the hook so deployCollateral can add concentrated liquidity
        token1.mint(address(hook), 100 ether);

        // Mock swap output for standard swap
        // 10 ether margin + 40 ether borrow = 50 ether swapped. Let's return 48 ether of token1
        manager.setNextSwapDelta(-50 ether, 48 ether);

        // NOTE: initiate() now routes through MULTI_POOL_SWAP, whose callback
        // registers the position via hook.registerMarginOpen() directly — no
        // manual beforeSwap/afterSwap priming needed (or allowed: the position
        // must not pre-exist).

        // 2. Solver initiates the order permissionlessly
        vm.prank(solver);
        router.initiate(order, signature, "");

        // 3. Verify on-chain position created successfully for trader with correct parameters
        (address posTrader, uint256 collateral, uint256 borrowed, uint8 posLeverage, , , , , uint128 liquidity) =
            hook.positions(key.toId(), trader);

        assertEq(posTrader, trader);
        assertEq(posLeverage, 5);
        assertEq(borrowed, 40 ether);
        assertEq(collateral, (48 ether * 9950) / 10000); // 0.5% fee deducted
        assertGt(liquidity, 0, "collateral rehypothecation should be deployed");
    }
}
