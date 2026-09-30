// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {EswapMarginHook, IPriceFeed} from "../EswapMarginHook.sol";
import {EswapRouter} from "../EswapRouter.sol";
import {EswapRouterExt} from "../EswapRouterExt.sol";
import {IPriceFeedForTrigger} from "../EswapRouterExt.sol";
import {PoolManagerRealTokenMock} from "./mocks/PoolManagerMock.sol";
import {PoolKey} from "../types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "../types/PoolId.sol";
import {Currency} from "../types/Currency.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {EswapHookDeployLib} from "./EswapHookDeployLib.sol";

contract ERC20MockJIT is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {
        _mint(msg.sender, 1_000_000 ether);
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract PriceFeedMockJIT is IPriceFeed {
    function getAmountInUsd(address, uint256 amount) external pure override returns (uint256) {
        return amount;
    }

    function getTwapPrice(address) external pure override returns (uint256) {
        return 1e18;
    }
}

contract EswapJITSpotTest is Test {
    using PoolIdLibrary for PoolKey;

    EswapMarginHook public hook;
    PoolManagerRealTokenMock public manager;
    EswapRouter public router;
    EswapRouterExt public ext;
    ERC20MockJIT public token0;
    ERC20MockJIT public token1;
    PoolKey public key;

    address swapper = address(0xAAAA);
    address solver = address(0xBBBB);

    function setUp() public {
        manager = new PoolManagerRealTokenMock();
        PriceFeedMockJIT priceFeed = new PriceFeedMockJIT();

        token0 = new ERC20MockJIT("Token 0", "TK0");
        token1 = new ERC20MockJIT("Token 1", "TK1");

        // Deploy hook at a valid hook address
        address hookAddress = address(uint160((1 << 159) | (1 << 158) | (1 << 153) | (1 << 152) | (1 << 148)));
        (address _hookLogic, address _hookLogic2) = EswapHookDeployLib.deployLogic(address(manager), address(priceFeed));
        deployCodeTo("EswapMarginHook.sol:EswapMarginHook", abi.encode(manager, priceFeed, _hookLogic, _hookLogic2, address(this)), hookAddress);
        hook = EswapMarginHook(payable(hookAddress));

        key = PoolKey({
            currency0: Currency.wrap(address(token0)),
            currency1: Currency.wrap(address(token1)),
            fee: 3000,
            tickSpacing: 60,
            hooks: address(hook)
        });

        router = new EswapRouter(manager);
        ext = new EswapRouterExt(manager, address(router));
        router.setRouterExt(address(ext));
        hook.setRouterAndMinCollateralUsd(address(router), 0);
        hook.setAuthorizedPool(key.toId(), true);
        ext.setJitApprovedSwapper(swapper, true);
        // [AUDIT HIGH-1] JIT counterparties must be whitelisted protocol solvers.
        router.setSolverWhitelist(solver, true);

        // Fund swapper with token0 (input)
        token0.mint(swapper, 1000 ether);

        // Fund solver with token1 (output) AND fund the manager with token1 for take()
        token1.mint(solver, 1000 ether);
        token1.mint(address(manager), 1000 ether); // Manager needs to pay take()

        // Approvals for the JIT callback, which runs in the EXT's context:
        // the swapper pays the input leg and the solver the output leg via
        // transferFrom called by the ext contract.
        vm.prank(swapper);
        token0.approve(address(ext), type(uint256).max);

        vm.prank(solver);
        token1.approve(address(ext), type(uint256).max);
    }

    function test_JITSpotExecution_BypassesAMM() public {
        uint256 amountIn = 100 ether;
        uint256 amountOut = 300 ether;

        uint256 swapperTok0Before = token0.balanceOf(swapper);
        uint256 swapperTok1Before = token1.balanceOf(swapper);
        uint256 solverTok0Before = token0.balanceOf(solver);
        uint256 solverTok1Before = token1.balanceOf(solver);

        EswapRouterExt.JITSpotParams memory params = EswapRouterExt.JITSpotParams({
            key: key,
            zeroForOne: true,
            amountSpecified: -int256(amountIn),
            solver: solver,
            solverOutput: amountOut,
            minSolverOutput: 0, // No min in test
            swapper: swapper
        });

        vm.prank(swapper);
        ext.executeJITSpotSwap(params);
        uint256 swapperTok0After = token0.balanceOf(swapper);
        uint256 swapperTok1After = token1.balanceOf(swapper);
        uint256 solverTok0After = token0.balanceOf(solver);
        uint256 solverTok1After = token1.balanceOf(solver);

        // Swapper paid amountIn token0 and received amountOut token1
        assertEq(swapperTok0Before - swapperTok0After, amountIn, "Swapper should lose input");
        assertEq(swapperTok1After - swapperTok1Before, amountOut, "Swapper should gain output");

        // Solver paid amountOut token1 and received amountIn token0
        assertEq(solverTok1Before - solverTok1After, amountOut, "Solver should lose output");
        assertEq(solverTok0After - solverTok0Before, amountIn, "Solver should gain input");
    }

    function test_JITSpot_OnlyCalledBySwapper() public {
        EswapRouterExt.JITSpotParams memory params = EswapRouterExt.JITSpotParams({
            key: key,
            zeroForOne: true,
            amountSpecified: -int256(100 ether),
            solver: solver,
            solverOutput: 300 ether,
            minSolverOutput: 0, // No min in test
            swapper: swapper
        });

        // [AUDIT HIGH-1] A non-swapper (here the solver) must NOT be able to
        // initiate a JIT that pulls the swapper's funds.
        vm.prank(solver);
        vm.expectRevert("Only swapper can execute JIT");
        ext.executeJITSpotSwap(params);
    }

    // ─── [AUDIT HIGH-2] Trustless fill-price floor ───────────────────────────

    function test_JITSpot_RejectsFillBelowOracleFloor() public {
        // PriceFeedMockJIT prices 1:1, so 100 token0 in == 100 token1 out is fair.
        // With 0 leniency the floor is exactly the 1:1 rate, so a 99-out fill
        // (i.e. the swapper underpaying the whitelisted solver) must revert.
        ext.setTriggerPriceFeed(IPriceFeedForTrigger(address(new PriceFeedMockJIT())));
        ext.setJitOracleFloorLeniencyBps(1); // non-zero => floor enabled

        EswapRouterExt.JITSpotParams memory params = EswapRouterExt.JITSpotParams({
            key: key,
            zeroForOne: true,
            amountSpecified: -int256(100 ether),
            solver: solver,
            solverOutput: 90 ether,
            minSolverOutput: 0,
            swapper: swapper
        });

        vm.prank(swapper);
        vm.expectRevert();
        ext.executeJITSpotSwap(params);
    }

    function test_JITSpot_AcceptsFillAtOrAboveOracleFloor() public {
        ext.setTriggerPriceFeed(IPriceFeedForTrigger(address(new PriceFeedMockJIT())));
        ext.setJitOracleFloorLeniencyBps(1);

        EswapRouterExt.JITSpotParams memory params = EswapRouterExt.JITSpotParams({
            key: key,
            zeroForOne: true,
            amountSpecified: -int256(100 ether),
            solver: solver,
            solverOutput: 300 ether, // well above the 1:1 oracle floor
            minSolverOutput: 0,
            swapper: swapper
        });

        vm.prank(swapper);
        ext.executeJITSpotSwap(params);
    }

    function test_JITSpot_FloorDisabledByDefault() public {
        assertEq(ext.jitOracleFloorLeniencyBps(), 0);

        // With the floor disabled (0) a below-oracle fill still executes, which
        // is the legacy behaviour — documents that the owner MUST opt in.
        EswapRouterExt.JITSpotParams memory params = EswapRouterExt.JITSpotParams({
            key: key,
            zeroForOne: true,
            amountSpecified: -int256(100 ether),
            solver: solver,
            solverOutput: 90 ether,
            minSolverOutput: 0,
            swapper: swapper
        });

        vm.prank(swapper);
        ext.executeJITSpotSwap(params);
    }

    function test_SetJitOracleFloorLeniencyBps_RejectsAbove1000() public {
        vm.expectRevert(EswapRouterExt.BpsTooHigh.selector);
        ext.setJitOracleFloorLeniencyBps(1001);
    }

    // ─── [AUDIT HIGH-1] Native-input JIT leg ─────────────────────────────────

    function test_JITSpot_NativeInput_SettlesViaMsgValue() public {
        // Pool with native currency0 (ETH) and ERC20 currency1: the swapper pays
        // ETH, the solver pays token1 via transferFrom. This is the leg that was
        // previously an unconditional revert on IERC20(address(0)).
        PoolKey memory nativeKey = PoolKey({
            currency0: Currency.wrap(address(0)),
            currency1: Currency.wrap(address(token1)),
            fee: 3000,
            tickSpacing: 60,
            hooks: address(hook)
        });
        hook.setAuthorizedPool(nativeKey.toId(), true);

        uint256 amountIn = 3 ether;
        uint256 amountOut = 300 ether;

        vm.deal(swapper, 10 ether);
        uint256 swapperEthBefore = swapper.balance;
        uint256 solverTok1Before = token1.balanceOf(solver);
        uint256 extEthBefore = address(ext).balance;

        EswapRouterExt.JITSpotParams memory params = EswapRouterExt.JITSpotParams({
            key: nativeKey,
            zeroForOne: true,
            amountSpecified: -int256(amountIn),
            solver: solver,
            solverOutput: amountOut,
            minSolverOutput: 0,
            swapper: swapper
        });

        vm.prank(swapper);
        ext.executeJITSpotSwap{value: amountIn}(params);

        // Swapper paid exactly the input in ETH (no stray value kept by the Ext)
        assertEq(swapper.balance, swapperEthBefore - amountIn, "swapper should pay input ETH");
        // Solver received the input ETH and paid the ERC20 output leg
        assertEq(solver.balance, amountIn, "solver should receive the input ETH");
        assertEq(token1.balanceOf(solver), solverTok1Before - amountOut, "solver should pay output");
        // The Ext must not custody ETH
        assertEq(address(ext).balance, extEthBefore, "ext must not retain ETH");
    }

    function test_JITSpot_NativeInput_RefundsSurplus() public {
        PoolKey memory nativeKey = PoolKey({
            currency0: Currency.wrap(address(0)),
            currency1: Currency.wrap(address(token1)),
            fee: 3000,
            tickSpacing: 60,
            hooks: address(hook)
        });
        hook.setAuthorizedPool(nativeKey.toId(), true);

        uint256 amountIn = 1 ether;
        uint256 amountOut = 100 ether;
        uint256 sent = 2 ether; // deliberately over-sent

        vm.deal(swapper, 10 ether);
        uint256 before = swapper.balance;

        EswapRouterExt.JITSpotParams memory params = EswapRouterExt.JITSpotParams({
            key: nativeKey,
            zeroForOne: true,
            amountSpecified: -int256(amountIn),
            solver: solver,
            solverOutput: amountOut,
            minSolverOutput: 0,
            swapper: swapper
        });

        vm.prank(swapper);
        ext.executeJITSpotSwap{value: sent}(params);

        // Only the input amount should be net-paid; the surplus comes back.
        assertEq(swapper.balance, before - amountIn, "surplus should be refunded");
    }

    function test_JITSpot_NativeOutput_RevertsExplicitly() public {
        // Native on the OUTPUT side cannot settle: the solver would need to
        // supply ETH. Must fail with the named error, not an opaque ERC20 call.
        PoolKey memory nativeKey = PoolKey({
            currency0: Currency.wrap(address(token1)),
            currency1: Currency.wrap(address(0)),
            fee: 3000,
            tickSpacing: 60,
            hooks: address(hook)
        });
        hook.setAuthorizedPool(nativeKey.toId(), true);

        EswapRouterExt.JITSpotParams memory params = EswapRouterExt.JITSpotParams({
            key: nativeKey,
            zeroForOne: true, // input token1, output native
            amountSpecified: -int256(1 ether),
            solver: solver,
            solverOutput: 100 ether,
            minSolverOutput: 0,
            swapper: swapper
        });

        vm.prank(swapper);
        vm.expectRevert(EswapRouterExt.JitNativeCurrencyUnsupported.selector);
        ext.executeJITSpotSwap(params);
    }

    function test_JITSpot_NativeInput_InsufficientValueReverts() public {
        PoolKey memory nativeKey = PoolKey({
            currency0: Currency.wrap(address(0)),
            currency1: Currency.wrap(address(token1)),
            fee: 3000,
            tickSpacing: 60,
            hooks: address(hook)
        });
        hook.setAuthorizedPool(nativeKey.toId(), true);

        EswapRouterExt.JITSpotParams memory params = EswapRouterExt.JITSpotParams({
            key: nativeKey,
            zeroForOne: true,
            amountSpecified: -int256(5 ether),
            solver: solver,
            solverOutput: 100 ether,
            minSolverOutput: 0,
            swapper: swapper
        });

        vm.deal(swapper, 10 ether);
        vm.prank(swapper);
        vm.expectRevert(EswapRouterExt.NativeInsufficient.selector);
        ext.executeJITSpotSwap{value: 1 ether}(params);
    }
}
