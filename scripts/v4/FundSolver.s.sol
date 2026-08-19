// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Funds the solver EOA from the deployer for live leveraged tests.
///         Env: PRIVATE_KEY, SOLVER_ADDRESS, USDC_ADDRESS,
///         FUND_ETH (wei, default 0.001 ETH), FUND_USDC (raw, default 550000 =
///         $0.55), FUND_WETH (raw, default 288000000000000 = 0.000288 WETH ≈ $0.55).
contract FundSolver is Script {
    address constant WETH = 0x4200000000000000000000000000000000000006;

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);
        address solver = vm.envAddress("SOLVER_ADDRESS");
        address usdc = vm.envAddress("USDC_ADDRESS");
        require(solver != address(0), "SOLVER_ADDRESS required");

        uint256 ethAmount = vm.envOr("FUND_ETH", uint256(10 ** 15)); // 0.001 ETH
        uint256 usdcAmount = vm.envOr("FUND_USDC", uint256(550000));
        uint256 wethAmount = vm.envOr("FUND_WETH", uint256(288000000000000));

        vm.startBroadcast(pk);
        (bool ok,) = payable(solver).call{value: ethAmount}("");
        require(ok, "ETH transfer failed");
        IERC20(usdc).transfer(solver, usdcAmount);
        IERC20(WETH).transfer(solver, wethAmount);
        vm.stopBroadcast();

        console.log("funded solver:", solver);
        console.log("  ETH (wei):", ethAmount);
        console.log("  USDC (raw):", usdcAmount);
        console.log("  WETH (raw):", wethAmount);
    }
}