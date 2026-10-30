// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {EswapRouter} from "../../src/v4/EswapRouter.sol";

/// @title SetSolverCaps
/// @notice Sets `solverNotionalCap` for each solver. Run it right after
///         `setSolverWhitelist(solver, true)` or any multi-pool escrow setup.
///
/// @dev A cap of 0 means UNLIMITED on every router path, so a whitelisted solver
///      without a cap can be drawn by any trader up to its allowance.
///
///      The default cap is an ARBITRARY PLACEHOLDER (1,000,000 units of an 18-decimal
///      token). The cap is compared in RAW token units, so one value is not
///      equivalent across tokens: 1e24 is effectively unlimited for a 6-decimal token
///      like USDC and tiny for nothing in particular. Set a per-solver value with
///      SOLVER_NOTIONAL_CAP, and change it later with `EswapRouter.setSolverNotionalCap`.
///
///      Settlement contracts (EswapSettlement / CoW / 1inch / UniswapX) are not capped
///      here; they are filler-funded and their borrow equals the order notional.
contract SetSolverCaps is Script {
    uint256 internal constant PLACEHOLDER_CAP = 1_000_000 ether;

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        EswapRouter router = EswapRouter(payable(vm.envAddress("V4_ROUTER_ADDRESS")));
        address solver = vm.envAddress("SOLVER_ADDRESS");
        uint256 cap = vm.envOr("SOLVER_NOTIONAL_CAP", PLACEHOLDER_CAP);

        vm.startBroadcast(pk);
        router.setSolverNotionalCap(solver, cap);
        vm.stopBroadcast();
    }
}
