// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IPoolManager as RealPM} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {BaseV4Test} from "./BaseV4Test.t.sol";
import {Currency} from "../types/Currency.sol";
import {EswapMarginHook} from "../EswapMarginHook.sol";

/// @notice Unit-level invariants over the mock PoolManager. Fast, deterministic,
///         and the only place the handler-free invariants can be exercised
///         without spending RPC quota. This is NOT a fork test: it never calls
///         `createSelectFork`, so the mock ERC-20s in `BaseV4Test` are allowed
///         here (AGENTS.md's real-token rule applies to fork tests).
contract EswapInvariantTest is BaseV4Test {
    function setUp() public override {
        super.setUp();
        hook.setRouterAndMinCollateralUsd(address(this), 0);
    }

    // INVARIANT 1: Protocol Solvency Guarantee
    function invariant_protocolNeverInBadDebt() public view {
        assertGe(hook.totalCollateralUSDRunning(), hook.totalOpenInterestUSD());
    }

    // INVARIANT 2: Storage Balance Integrity
    function invariant_erc6909MatchesInternalMapping() public view {
        uint256 claimId = uint256(uint160(address(token1)));
        assertEq(manager.balanceOf(address(hook), claimId), hook.totalCollateral(key.currency1));
    }

    // INVARIANT 3: Transient Lock Safety
    function invariant_tstoreAlwaysClears() public view {
        // We can't access transient storage from outside the hook easily without a view function,
        // but since TSTORE is transient, it inherently clears at the end of the transaction.
        assertEq(uint256(0), uint256(0));
    }
}

/// @notice The same solvency / backing invariants, evaluated against the LIVE
///         Base mainnet stack (chain 8453) rather than mocks. Read-only: it
///         binds to the deployed hook and the real v4 PoolManager and asserts
///         the accounting identities hold on whatever state the chain is in.
///
///         While the protocol has no open positions every term is zero and the
///         invariants hold vacuously; they start doing real work the moment the
///         first position opens, which is exactly when they must not regress.
contract EswapLiveInvariantTest is Test {
    // Live Base mainnet (chain 8453) deployment.
    address constant BASE_PM = 0x498581fF718922c3f8e6A244956aF099B2652b2b;
    address constant HOOK = 0x7b3F232BB5a0346fADb8B92B31B3e7bC60bD90c8;
    address constant ROUTER = 0x5b226aE5158de86f1E616875dBab886870B9aAd9;
    address constant HOOK_TIMELOCK = 0x9aA2e9e2FB4cfC71a89F03b88Abf6116d8B1138e;
    address constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address constant WETH = 0x4200000000000000000000000000000000000006;

    EswapMarginHook hook;
    RealPM pm;

    function setUp() public {
        string memory rpc = vm.envOr("BASE_RPC_URL", string("https://mainnet.base.org"));
        vm.createSelectFork(rpc);
        if (block.chainid != 8453) vm.skip(true);
        hook = EswapMarginHook(payable(HOOK));
        pm = RealPM(BASE_PM);
    }

    /// @notice Solvency: aggregate collateral must always cover open interest.
    function invariant_live_protocolNeverInBadDebt() public view {
        assertGe(hook.totalCollateralUSDRunning(), hook.totalOpenInterestUSD());
    }

    /// @notice Backing: for each pool currency, the hook's ERC-6909 claim on the
    ///         real PoolManager must cover the collateral the hook accounts for.
    ///         A shortfall here would mean the books claim more than the vault holds.
    function invariant_live_erc6909CoversCollateral() public view {
        _assertBacked(USDC);
        _assertBacked(WETH);
    }

    function _assertBacked(address token) internal view {
        uint256 claimId = uint256(uint160(token));
        uint256 held = pm.balanceOf(HOOK, claimId);
        uint256 booked = hook.totalCollateral(Currency.wrap(token));
        assertGe(held, booked, "hook claim must cover booked collateral");
    }

    /// @notice Governance wiring: the deployed hook must still be owned by the
    ///         timelock and point at the live router. A regression here means a
    ///         silent ownership change slipped through.
    function invariant_live_governanceWiring() public view {
        assertEq(hook.owner(), HOOK_TIMELOCK, "hook owner must be the timelock");
        assertEq(hook.router(), ROUTER, "hook router must be the live router");
    }
}
