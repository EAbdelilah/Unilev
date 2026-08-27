// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {EswapMarginHook, IPriceFeed} from "../EswapMarginHook.sol";
import {EswapRouter} from "../EswapRouter.sol";
import {PoolManagerRealTokenMock} from "./mocks/PoolManagerMock.sol";
import {PoolKey} from "../types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "../types/PoolId.sol";
import {Currency} from "../types/Currency.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

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
        deployCodeTo("EswapMarginHook.sol:EswapMarginHook", abi.encode(manager, priceFeed, address(this)), hookAddress);
        hook = EswapMarginHook(payable(hookAddress));

        key = PoolKey({
            currency0: Currency.wrap(address(token0)),
            currency1: Currency.wrap(address(token1)),
            fee: 3000,
            tickSpacing: 60,
            hooks: address(hook)
        });

        router = new EswapRouter(manager);
        hook.setRouterAndMinCollateralUsd(address(router), 0);
        hook.setAuthorizedPool(key.toId(), true);
        router.setJitApprovedSwapper(swapper, true);

        // Fund swapper with token0 (input)
        token0.mint(swapper, 1000 ether);

        // Fund solver with token1 (output) AND fund the manager with token1 for take()
        token1.mint(solver, 1000 ether);
        token1.mint(address(manager), 1000 ether); // Manager needs to pay take()

        // Approvals
        vm.prank(swapper);
        token0.approve(address(router), type(uint256).max);

        vm.prank(solver);
        token1.approve(address(router), type(uint256).max);
    }

    function test_JITSpotExecution_BypassesAMM() public {
        uint256 amountIn = 100 ether;
        uint256 amountOut = 300 ether;

        uint256 swapperTok0Before = token0.balanceOf(swapper);
        uint256 swapperTok1Before = token1.balanceOf(swapper);
        uint256 solverTok0Before = token0.balanceOf(solver);
        uint256 solverTok1Before = token1.balanceOf(solver);

        EswapRouter.JITSpotParams memory params = EswapRouter.JITSpotParams({
            key: key,
            zeroForOne: true,
            amountSpecified: -int256(amountIn),
            solver: solver,
            solverOutput: amountOut,
            minSolverOutput: 0, // No min in test
            swapper: swapper
        });

        vm.prank(solver);
        router.executeJITSpotSwap(params);

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

    function test_JITSpot_OnlyCalledBySolver() public {
        EswapRouter.JITSpotParams memory params = EswapRouter.JITSpotParams({
            key: key,
            zeroForOne: true,
            amountSpecified: -int256(100 ether),
            solver: solver,
            solverOutput: 300 ether,
            minSolverOutput: 0, // No min in test
            swapper: swapper
        });

        // Calling as non-solver should revert
        vm.expectRevert("Only solver can execute JIT");
        router.executeJITSpotSwap(params);
    }
}
