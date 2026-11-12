// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {EswapTimelock} from "../../src/v4/EswapTimelock.sol";
import {EswapMarginHookLogic} from "../../src/v4/EswapMarginHookLogic.sol";

/// @dev Minimal view of the two ownership styles in play.
interface IOwnable2Step {
    function owner() external view returns (address);

    function pendingOwner() external view returns (address);

    function transferOwnership(address newOwner) external;

    function acceptOwnership() external;
}

/// @notice Deploys and activates `EswapTimelock` on Base mainnet (8453).
///
/// @dev Why two instances
///
///      `EswapTimelock.queue` hard-reverts unless `target == hook` (the
///      immutable bound at construction, an M-9 fix). The hook and the router
///      are separate owner surfaces, so one instance cannot govern both. Hence:
///
///        * `V4_TIMELOCK_ADDRESS`         -> bound to `EswapMarginHook`
///        * `V4_ROUTER_TIMELOCK_ADDRESS`  -> bound to `EswapRouter`
///
///      The hook surface is the value-bearing one: `withdrawProtocolFee`,
///      `withdrawInsuranceFund`, `sweepResidue`, `setConfig` (treasury,
///      `reserveFactor` up to 100 bps, `defaultMaxLeverage` 2-20),
///      `setAddressProtocolFee`, `setRouterAndMinCollateralUsd`,
///      `repayBadDebt`, `setInsuranceCoverageBps`, `insuranceStake`/`Unstake`.
///      The router surface is the distribution one: solver / aggregator /
///      executor / settlement whitelists and `setSolverNotionalCap`.
///
/// @dev Ownership styles differ, and that dictates the handover:
///
///      * `EswapMarginHook` is **single-step** (`transferOwnership` lives in
///        `EswapMarginHookLogic` and is reached through the hook's fallback
///        allow-list). One transaction, atomic, no window.
///      * `EswapRouter` is **Ownable2Step**: `transferOwnership` only sets
///        `pendingOwner`, and `acceptOwnership()` must be called *by* the new
///        owner. A timelock can only call it through `queue` + `execute`, and
///        `execute` refuses before `eta`. So the router handover is three
///        steps: queue the accept, transfer, then execute after `delay`.
///
/// @dev Ordering matters for the router. The accept is queued *before* the
///      transfer so that nothing but the already-scheduled `execute` is needed
///      once `eta` passes -- the EOA has no remaining discretionary step.
///
/// @dev Usage (FOUNDRY_PROFILE=deploy, from the repo root):
///
///        1. forge script scripts/v4/DeployTimelock.s.sol:DeployTimelock \
///             --rpc-url $BASE_RPC_URL --broadcast --with-gas-price 6000000
///           -> copy V4_TIMELOCK_ADDRESS / V4_ROUTER_TIMELOCK_ADDRESS into .env
///
///        2. forge script scripts/v4/DeployTimelock.s.sol:DeployTimelock \
///             --sig "handover()" --rpc-url $BASE_RPC_URL --broadcast \
///             --with-gas-price 6000000
///           -> hook owner becomes the timelock immediately; prints
///              ROUTER_ACCEPT_ETA
///
///        3. (after ROUTER_ACCEPT_ETA) the same command with
///             --sig "executeRouterAccept(uint256)" <ROUTER_ACCEPT_ETA>
///           -> the router timelock accepts ownership; the EOA has no power
///              over either contract.
///
///      Env: V4_HOOK_ADDRESS, V4_ROUTER_ADDRESS, V4_TIMELOCK_ADDRESS,
///      V4_ROUTER_TIMELOCK_ADDRESS, PRIVATE_KEY (must be the current owner),
///      optional TIMELOCK_ADMIN (defaults to the broadcaster) and
///      TIMELOCK_DELAY (defaults to 48 hours; the contract floor is 1 hour).
contract DeployTimelock is Script {
    uint256 constant DEFAULT_DELAY = 48 hours;
    /// @dev `block.timestamp` here is the *simulation* block. The broadcast lands
    ///      a few seconds later, so an eta of exactly `now + delay` would be
    ///      `TransactionTooFresh` on chain. This buffer makes the queue call safe
    ///      without weakening the delay meaningfully.
    uint256 constant ETA_BUFFER = 10 minutes;

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);

        address hook = vm.envAddress("V4_HOOK_ADDRESS");
        address router = vm.envAddress("V4_ROUTER_ADDRESS");
        address admin = vm.envOr("TIMELOCK_ADMIN", deployer);
        uint256 delay = vm.envOr("TIMELOCK_DELAY", DEFAULT_DELAY);

        if (delay < 1 hours) revert("TIMELOCK_DELAY below the 1h contract floor");
        if (IOwnable2Step(hook).owner() != deployer) revert("hook owner is not the broadcaster");
        if (IOwnable2Step(router).owner() != deployer) revert("router owner is not the broadcaster");

        console.log("deployer (hook+router owner):", deployer);
        console.log("timelock admin:", admin);
        console.log("timelock delay (s):", delay);
        console.log("");

        vm.startBroadcast(pk);
        EswapTimelock hookTimelock = new EswapTimelock(hook, admin, delay);
        EswapTimelock routerTimelock = new EswapTimelock(router, admin, delay);
        vm.stopBroadcast();

        console.log("hook timelock  :", address(hookTimelock));
        console.log("  bound to hook:", hook);
        console.log("router timelock:", address(routerTimelock));
        console.log("  bound to router:", router);
        console.log("");
        console.log(string.concat("V4_TIMELOCK_ADDRESS=", vm.toString(address(hookTimelock))));
        console.log(string.concat("V4_ROUTER_TIMELOCK_ADDRESS=", vm.toString(address(routerTimelock))));
    }

    /// @notice Moves ownership of both contracts to their timelocks.
    function handover() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);

        address hook = vm.envAddress("V4_HOOK_ADDRESS");
        address router = vm.envAddress("V4_ROUTER_ADDRESS");
        address hookTimelock = vm.envAddress("V4_TIMELOCK_ADDRESS");
        address routerTimelock = vm.envAddress("V4_ROUTER_TIMELOCK_ADDRESS");

        // Preconditions: fail loudly rather than half-migrate.
        if (IOwnable2Step(hook).owner() != deployer) revert("hook owner is not the broadcaster");
        if (IOwnable2Step(router).owner() != deployer) revert("router owner is not the broadcaster");
        if (EswapTimelock(hookTimelock).admin() != deployer) revert("hook timelock admin mismatch");
        if (EswapTimelock(routerTimelock).admin() != deployer) revert("router timelock admin mismatch");
        if (EswapTimelock(hookTimelock).hook() != hook) revert("hook timelock bound to wrong target");
        if (EswapTimelock(routerTimelock).hook() != router) revert("router timelock bound to wrong target");

        uint256 eta = vm.envOr(
            "ROUTER_ACCEPT_ETA", block.timestamp + EswapTimelock(routerTimelock).delay() + ETA_BUFFER
        );
        bytes memory acceptData = abi.encodeCall(IOwnable2Step.acceptOwnership, ());

        vm.startBroadcast(pk);
        // 1. Hook: single-step, so this is the whole handover -- atomic.
        EswapMarginHookLogic(payable(hook)).transferOwnership(hookTimelock);
        // 2. Router: schedule the accept first, while the EOA is still admin.
        EswapTimelock(routerTimelock).queue(router, acceptData, eta);
        // 3. Router: hand the *pending* ownership to the timelock.
        IOwnable2Step(router).transferOwnership(routerTimelock);
        vm.stopBroadcast();

        console.log("hook owner now      :", IOwnable2Step(hook).owner());
        console.log("router owner now    :", IOwnable2Step(router).owner());
        console.log("router pendingOwner :", IOwnable2Step(router).pendingOwner());
        console.log("");
        console.log("Router acceptance is scheduled. Execute it after eta:");
        console.log(string.concat("ROUTER_ACCEPT_ETA=", vm.toString(eta)));
        console.log("  forge script scripts/v4/DeployTimelock.s.sol:DeployTimelock \\");
        console.log(
            string.concat(
                "    --sig \"executeRouterAccept(uint256)\" ", vm.toString(eta), " --rpc-url $BASE_RPC_URL --broadcast"
            )
        );
    }

    /// @notice Step 3 of the router handover: the timelock accepts ownership.
    /// @param eta The exact eta used when the accept was queued.
    function executeRouterAccept(uint256 eta) external {
        address router = vm.envAddress("V4_ROUTER_ADDRESS");
        address routerTimelock = vm.envAddress("V4_ROUTER_TIMELOCK_ADDRESS");
        bytes memory acceptData = abi.encodeCall(IOwnable2Step.acceptOwnership, ());

        if (IOwnable2Step(router).pendingOwner() != routerTimelock) {
            revert("router pendingOwner is not the router timelock");
        }

        vm.startBroadcast(vm.envUint("PRIVATE_KEY"));
        EswapTimelock(routerTimelock).execute(router, acceptData, eta);
        vm.stopBroadcast();

        console.log("router owner now :", IOwnable2Step(router).owner());
        console.log("router pendingOwner:", IOwnable2Step(router).pendingOwner());
    }
}
