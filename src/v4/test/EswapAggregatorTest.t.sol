// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BaseV4Test, PriceFeedMock, PoolManagerMock, LiquidityPoolMock} from "./BaseV4Test.t.sol";
import {EswapRouter} from "../EswapRouter.sol";
import {EswapSolverAdapter} from "../EswapSolverAdapter.sol";
import {EswapMarginHook} from "../EswapMarginHook.sol";
import {BeforeSwapDelta} from "../types/BeforeSwapDelta.sol";
import {Currency} from "../types/Currency.sol";
import {PoolIdLibrary} from "../types/PoolId.sol";
import {PoolKey} from "../types/PoolKey.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {HookFlags} from "../libraries/HookFlags.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockAggregator {
    TestERC20Agg public immutable outputToken;

    constructor(address _outputToken) {
        outputToken = TestERC20Agg(_outputToken);
    }

    function execute(address inputToken, uint256 amountIn, address to) external {
        ERC20(inputToken).transferFrom(msg.sender, address(this), amountIn);
        uint256 outputAmount = amountIn * 950 / 1000;
        outputToken.mint(to, outputAmount);
    }
}

contract TestERC20Agg is ERC20("Test", "TST") {
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

contract EswapAggregatorTest is BaseV4Test {
    using PoolIdLibrary for PoolKey;

    EswapRouter public router;
    EswapSolverAdapter public adapter;
    TestERC20Agg public token0;
    TestERC20Agg public token1;
    MockAggregator public aggregator;

    function setUp() public override {
        token0 = new TestERC20Agg();
        token1 = new TestERC20Agg();

        manager = new PoolManagerMock();
        priceFeed = new PriceFeedMock();
        lp = new LiquidityPoolMock();

        uint160 flags = HookFlags.AFTER_INITIALIZE_FLAG |
                       HookFlags.BEFORE_SWAP_FLAG |
                       HookFlags.BEFORE_SWAP_RETURNS_DELTA_FLAG |
                       HookFlags.AFTER_SWAP_FLAG |
                       HookFlags.AFTER_SWAP_RETURNS_DELTA_FLAG;

        bytes memory bytecode = abi.encodePacked(
            type(EswapMarginHook).creationCode,
            abi.encode(manager, priceFeed)
        );

        address hookAddr;
        bytes32 salt;
        bool found = false;

        for (uint256 i = 0; i < 1000000; i++) {
            salt = bytes32(i);
            hookAddr = address(uint160(uint256(keccak256(abi.encodePacked(
                bytes1(0xff),
                address(this),
                salt,
                keccak256(bytecode)
            )))));

            if (uint160(hookAddr) & flags == flags) {
                found = true;
                break;
            }
        }

        require(found, "Could not mine valid hook salt");
        hook = new EswapMarginHook{salt: salt}(manager, priceFeed);

        router = new EswapRouter(IPoolManager(address(manager)));
        adapter = new EswapSolverAdapter(address(router));
        hook.setRouter(address(router));

        key = PoolKey({
            currency0: Currency.wrap(address(token0)),
            currency1: Currency.wrap(address(token1)),
            fee: 3000,
            tickSpacing: 60,
            hooks: IHooks(address(hook))
        });

        vm.prank(address(manager));
        hook.afterInitialize(address(0), key, 79228162514264337593543950336, 0);

        hook.setAuthorizedPool(key.toId(), true);

        hook.mintMockLeverageCapacity(key.currency0, 100_000 ether);
        hook.mintMockLeverageCapacity(key.currency1, 100_000 ether);

        aggregator = new MockAggregator(address(token1));

        token0.mint(address(manager), 1_000_000 ether);
        token1.mint(address(manager), 1_000_000 ether);

        token0.mint(address(this), 100_000 ether);
        token1.mint(address(this), 100_000 ether);
    }

    function test_AggregatorSwapOpensLongPosition() public {
        address trader = address(0xBEEF);
        uint256 marginAmount = 100 ether;
        uint8 leverage = 3;

        token0.mint(trader, 1000 ether);

        bytes memory aggData = abi.encodeWithSelector(
            MockAggregator.execute.selector,
            address(token0),
            marginAmount * leverage,
            address(router)
        );

        vm.prank(trader);
        token0.approve(address(router), 1000 ether);

        hook.mintMockLeverageCapacity(key.currency0, 100_000 ether);
        manager.mint(address(hook), uint256(uint160(Currency.unwrap(key.currency0))), 100_000 ether);

        vm.prank(address(this));
        router.swapWithAggregator(EswapRouter.AggregatorSwapParams({
            key: key,
            zeroForOne: true,
            leverage: leverage,
            trader: trader,
            marginAmount: marginAmount,
            target: address(aggregator),
            targetData: aggData,
            amountOutMin: 0,
            deadline: 0
        }));

        (address t, uint256 coll, uint256 borrow, uint8 l, , , , , ) = hook.positions(key.toId(), trader);
        assertEq(t, trader);
        assertTrue(coll > 0, "should have collateral");
        assertEq(l, leverage);
        assertTrue(borrow > 0, "should have borrowed amount");
        assertEq(borrow, marginAmount * (leverage - 1), "borrowed = margin * (leverage - 1)");
    }

    function test_AggregatorSwapOpensShortPosition() public {
        address trader = address(0xCAFE);
        uint256 marginAmount = 50 ether;
        uint8 leverage = 2;

        token1.mint(trader, 1000 ether);

        MockAggregator shortAgg = new MockAggregator(address(token0));

        bytes memory aggData = abi.encodeWithSelector(
            MockAggregator.execute.selector,
            address(token1),
            marginAmount * leverage,
            address(router)
        );

        vm.prank(trader);
        token1.approve(address(router), 1000 ether);

        hook.mintMockLeverageCapacity(key.currency1, 100_000 ether);
        manager.mint(address(hook), uint256(uint160(Currency.unwrap(key.currency1))), 100_000 ether);

        vm.prank(address(this));
        router.swapWithAggregator(EswapRouter.AggregatorSwapParams({
            key: key,
            zeroForOne: false,
            leverage: leverage,
            trader: trader,
            marginAmount: marginAmount,
            target: address(shortAgg),
            targetData: aggData,
            amountOutMin: 0,
            deadline: 0
        }));

        (address t, uint256 coll, uint256 borrow, uint8 l, bool isLong, , , , ) = hook.positions(key.toId(), trader);
        assertEq(t, trader);
        assertTrue(coll > 0, "should have collateral");
        assertEq(l, leverage);
        assertTrue(borrow > 0, "should have borrowed amount");
        // zeroForOne=false → position is long on output token (currency0), isLong=true per hook convention
        assertTrue(isLong, "zeroForOne=false means isLong=true (debt in currency1)");
    }

    function test_AggregatorSwapViaAdapter() public {
        address trader = address(0xDEAD);
        uint256 marginAmount = 100 ether;
        uint8 leverage = 2;

        token0.mint(trader, 1000 ether);

        bytes memory aggData = abi.encodeWithSelector(
            MockAggregator.execute.selector,
            address(token0),
            marginAmount * leverage,
            address(router)
        );

        vm.prank(trader);
        token0.approve(address(router), 1000 ether);

        hook.mintMockLeverageCapacity(key.currency0, 100_000 ether);
        manager.mint(address(hook), uint256(uint160(Currency.unwrap(key.currency0))), 100_000 ether);

        vm.prank(address(this));
        adapter.swapViaAggregator(key, true, leverage, trader, marginAmount, address(aggregator), aggData, 0, 0);

        (address t, uint256 coll, , , , , , , ) = hook.positions(key.toId(), trader);
        assertEq(t, trader);
        assertTrue(coll > 0, "should have collateral");
    }

    function test_AggregatorSwapRejectsBadLeverage() public {
        address trader = address(0xFACE);

        bytes memory aggData = "";
        token0.mint(trader, 1000 ether);
        vm.prank(trader);
        token0.approve(address(router), 1000 ether);

        vm.expectRevert();
        router.swapWithAggregator(EswapRouter.AggregatorSwapParams({
            key: key,
            zeroForOne: true,
            leverage: 0,
            trader: trader,
            marginAmount: 100 ether,
            target: address(aggregator),
            targetData: aggData,
            amountOutMin: 0,
            deadline: 0
        }));
    }

    function test_AggregatorSwapRespectsDeadline() public {
        address trader = address(0xDEAD);
        vm.warp(1000);

        bytes memory aggData = "";
        token0.mint(trader, 1000 ether);
        vm.prank(trader);
        token0.approve(address(router), 1000 ether);

        vm.expectRevert(abi.encodeWithSignature("TransactionExpired()"));
        router.swapWithAggregator(EswapRouter.AggregatorSwapParams({
            key: key,
            zeroForOne: true,
            leverage: 2,
            trader: trader,
            marginAmount: 100 ether,
            target: address(aggregator),
            targetData: aggData,
            amountOutMin: 0,
            deadline: 500
        }));
    }

    function test_AggregatorSwapAndClosePosition() public {
        address trader = address(0xBEAD);
        uint256 marginAmount = 100 ether;
        uint8 leverage = 2;

        token0.mint(trader, 1000 ether);

        bytes memory aggData = abi.encodeWithSelector(
            MockAggregator.execute.selector,
            address(token0),
            marginAmount * leverage,
            address(router)
        );

        vm.prank(trader);
        token0.approve(address(router), 1000 ether);

        hook.mintMockLeverageCapacity(key.currency0, 100_000 ether);
        manager.mint(address(hook), uint256(uint160(Currency.unwrap(key.currency0))), 100_000 ether);

        vm.prank(address(this));
        router.swapWithAggregator(EswapRouter.AggregatorSwapParams({
            key: key,
            zeroForOne: true,
            leverage: leverage,
            trader: trader,
            marginAmount: marginAmount,
            target: address(aggregator),
            targetData: aggData,
            amountOutMin: 0,
            deadline: 0
        }));

        (address t, uint256 coll, , , , , , , ) = hook.positions(key.toId(), trader);
        assertTrue(coll > 0, "position should exist before close");

        vm.prank(trader);
        router.closePosition(address(hook), key, trader, 0);

        (address t2, uint256 c2, , , , , , , ) = hook.positions(key.toId(), trader);
        assertEq(c2, 0, "position should be deleted after close");
    }

    function test_AggregatorSwapRejectsExistingPosition() public {
        address trader = address(0xDAD);
        uint256 marginAmount = 100 ether;
        uint8 leverage = 2;

        token0.mint(trader, 2000 ether);

        bytes memory aggData = abi.encodeWithSelector(
            MockAggregator.execute.selector,
            address(token0),
            marginAmount * leverage,
            address(router)
        );

        vm.prank(trader);
        token0.approve(address(router), 2000 ether);

        hook.mintMockLeverageCapacity(key.currency0, 200_000 ether);
        manager.mint(address(hook), uint256(uint160(Currency.unwrap(key.currency0))), 200_000 ether);

        vm.prank(address(this));
        router.swapWithAggregator(EswapRouter.AggregatorSwapParams({
            key: key,
            zeroForOne: true,
            leverage: leverage,
            trader: trader,
            marginAmount: marginAmount,
            target: address(aggregator),
            targetData: aggData,
            amountOutMin: 0,
            deadline: 0
        }));

        bytes memory aggData2 = abi.encodeWithSelector(
            MockAggregator.execute.selector,
            address(token0),
            marginAmount * leverage,
            address(router)
        );

        vm.expectRevert("Position exists");
        router.swapWithAggregator(EswapRouter.AggregatorSwapParams({
            key: key,
            zeroForOne: true,
            leverage: leverage,
            trader: trader,
            marginAmount: marginAmount,
            target: address(aggregator),
            targetData: aggData2,
            amountOutMin: 0,
            deadline: 0
        }));
    }
}
