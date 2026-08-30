// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {EswapMarginHook} from "../../src/v4/EswapMarginHook.sol";
import {EswapRouter} from "../../src/v4/EswapRouter.sol";

interface IWETH9 {
    event Deposit(address indexed dst, uint256 wad);
    event Withdrawal(address indexed src, uint256 wad);
    function deposit() external payable;
    function withdraw(uint256 wad) external;
    function approve(address guy, uint256 wad) external returns (bool);
    function balanceOf(address) external view returns (uint256);
}

/// @notice Post-deploy config for the ETH/USDC-only Unichain deployment:
///         1. Whitelist the solver on the router
///         2. Set minCollateralUsd to $0.05 (matches the earlier live config)
///         3. Wrap a slice of the deployer's native ETH into WETH (short input)
///         4. Max-approve the router for WETH + USDC from the deployer/solver
///         Env: HOOK_ADDRESS, ROUTER_ADDRESS, USDC_ADDRESS, SOLVER_ADDRESS,
///         WRAP_ETH_AMOUNT (raw wei, default 500000000000000 = 0.0005).
contract DeployUnichainPost is Script {
    address constant WETH = 0x4200000000000000000000000000000000000006;
    address constant USDC = 0x078D782b760474a361dDA0AF3839290b0EF57AD6;

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);
        address hookAddr = vm.envOr("HOOK_ADDRESS", address(0x4bd2C1e73d150b65EF88DBa247Ed60A1538310c8));
        address routerAddr = vm.envOr("ROUTER_ADDRESS", address(0x4c14D923E9A9f64Da6684b77E07B33c76D0B3d60));
        address solver = vm.envOr("SOLVER_ADDRESS", deployer);
        uint256 wrapAmount = vm.envOr("WRAP_ETH_AMOUNT", uint256(500000000000000)); // 0.0005 WETH

        EswapMarginHook hook = EswapMarginHook(payable(hookAddr));
        EswapRouter router = EswapRouter(payable(routerAddr));
        IWETH9 weth = IWETH9(WETH);

        vm.startBroadcast(pk);

        // 1. Whitelist solver on the router
        if (!router.registeredSolvers(solver)) {
            router.setSolverWhitelist(solver, true);
            console.log("Solver whitelisted:", solver);
        } else {
            console.log("Solver already whitelisted:", solver);
        }

        // 2. Min collateral = $0.05 (18-decimals)
        hook.setRouterAndMinCollateralUsd(routerAddr, 50000000000000000);
        console.log("minCollateralUsd set to $0.05");

        // 3. Wrap native ETH -> WETH for short-borrow funding
        if (wrapAmount > 0) {
            weth.deposit{value: wrapAmount}();
            console.log("Wrapped WETH amount:", wrapAmount);
        }

        // 4. Approve router for WETH + USDC (solver borrow leg + trader margin leg)
        IERC20(WETH).approve(routerAddr, type(uint256).max);
        IERC20(USDC).approve(routerAddr, type(uint256).max);
        console.log("Router approved for WETH + USDC");

        vm.stopBroadcast();

        console.log("");
        console.log("deployer:", deployer);
        console.log("WETH balance:", weth.balanceOf(deployer));
        console.log("USDC balance:", IERC20(USDC).balanceOf(deployer));
        console.log("solver whitelisted:", router.registeredSolvers(solver));
    }
}