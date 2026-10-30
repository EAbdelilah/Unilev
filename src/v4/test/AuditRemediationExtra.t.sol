// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {EswapFlashVault} from "../EswapFlashVault.sol";
import {EswapLeverageAdapter} from "../EswapLeverageAdapter.sol";
import {EswapRouter} from "../EswapRouter.sol";
import {PriceFeed} from "../PriceFeed.sol";
import {CowSigning} from "../cow/CowSigning.sol";
import {CowOrder} from "../cow/CowOrder.sol";
import {ERC20Mock} from "./BaseV4Test.t.sol";
import {MockAggregatorV3} from "../../mocks/MockAggregatorV3.sol";

/// @dev Minimal canonical-settlement stand-in exposing the real GPv2
///      `preSignature(bytes)` getter shape.
contract MockGpv2Settlement {
    mapping(bytes => uint256) public preSignature;

    function setPreSignature(bytes calldata orderUid, uint256 value) external {
        preSignature[orderUid] = value;
    }
}

contract CowSigningHarness is CowSigning {
    constructor(address verifyingContract) CowSigning(verifyingContract) {}

    function hashOf(CowOrder.Data memory order) external view returns (bytes32) {
        return CowOrder.hash(order, domainSeparator);
    }

    function recoverPreSignerExternal(CowOrder.Data memory order, bytes memory signature)
        external
        view
        returns (address)
    {
        (, address owner) = recoverOrderSigner(order, Scheme.PreSign, signature);
        return owner;
    }
}

/// @dev Exposes the adapter's multicall selector policy for unit testing.
contract AdapterHarness is EswapLeverageAdapter {
    constructor(EswapRouter r) EswapLeverageAdapter(r) {}

    function allowed(bytes4 selector) external pure returns (bool) {
        return _isAllowedMulticallSelector(selector);
    }
}

/// @title AuditRemediationExtra
/// @notice Regression tests for the re-audit items remediated after the report:
///         HIGH-ACT-02 (canonical CoW pre-signature), HIGH-ACT-03 (single-sided
///         oracle bounds), MED-12 (feed decimals binding) and CRIT-ACT-04
///         (EswapFlashVault destination restriction).
contract AuditRemediationExtra is Test {
    uint256 internal constant PRE_SIGNED = uint256(keccak256("GPv2Signing.Scheme.PreSign"));

    // ─── CRIT-ACT-04: EswapFlashVault.pull destination ─────────────────────

    function test_FlashVault_Pull_RejectsArbitraryDestination() public {
        ERC20Mock token = new ERC20Mock("USD Coin", "USDC");
        EswapFlashVault vault = new EswapFlashVault(IERC20(address(token)), address(this));
        address solver = makeAddr("solver");
        address attacker = makeAddr("attacker");

        vault.setSolver(solver);
        token.mint(address(this), 1_000e6);
        token.approve(address(vault), type(uint256).max);
        vault.fund(1_000e6);

        vm.prank(solver);
        vm.expectRevert(EswapFlashVault.UnauthorizedDestination.selector);
        vault.pull(attacker, 1_000e6, "drain");

        assertEq(token.balanceOf(attacker), 0, "no reserve left the vault");
    }

    function test_FlashVault_DebtCeiling_EnforcedAndAdjustable() public {
        ERC20Mock token = new ERC20Mock("USD Coin", "USDC");
        EswapFlashVault vault = new EswapFlashVault(IERC20(address(token)), address(this));
        address solver = makeAddr("solver");
        vault.setSolver(solver);
        vault.setSolverRouter(solver);
        token.mint(address(this), 10_000e6);
        token.approve(address(vault), type(uint256).max);
        vault.fund(10_000e6);

        vault.setMaxOutstanding(500e6);
        vm.prank(solver);
        vm.expectRevert(abi.encodeWithSelector(EswapFlashVault.DebtCeilingExceeded.selector, 600e6, 500e6));
        vault.pull(solver, 600e6, "over");

        vm.prank(solver);
        vault.pull(solver, 400e6, "within");
        assertEq(vault.outstanding(solver), 400e6);

        // Raising the ceiling is an admin action; the default was never hit.
        vault.setMaxOutstanding(1_000e6);
        vm.prank(solver);
        vault.pull(solver, 600e6, "after raise");
        assertEq(vault.outstanding(solver), 1_000e6);
    }

    function test_FlashVault_Pull_SolverAndRouterOnly() public {
        ERC20Mock token = new ERC20Mock("USD Coin", "USDC");
        EswapFlashVault vault = new EswapFlashVault(IERC20(address(token)), address(this));
        address solver = makeAddr("solver");
        address router = makeAddr("router");

        vault.setSolver(solver);
        vault.setSolverRouter(router);
        token.mint(address(this), 1_000e6);
        token.approve(address(vault), type(uint256).max);
        vault.fund(1_000e6);

        vm.prank(solver);
        vault.pull(router, 400e6, "escrow");
        assertEq(token.balanceOf(router), 400e6);
        assertEq(vault.outstanding(solver), 400e6, "draw recorded as outstanding");

        vm.prank(solver);
        vault.pull(solver, 100e6, "topup");
        assertEq(token.balanceOf(solver), 100e6);

        // Repay clears the outstanding ledger.
        token.mint(solver, 500e6);
        vm.startPrank(solver);
        token.approve(address(vault), type(uint256).max);
        vault.repay(500e6);
        vm.stopPrank();
        assertEq(vault.outstanding(solver), 0, "repaid");
    }

    // ─── HIGH-ACT-03 + MED-12: PriceFeed bounds and decimals ───────────────

    function test_PriceFeed_SetFeed_RejectsDecimalsMismatch() public {
        PriceFeed feed = new PriceFeed();
        ERC20Mock token = new ERC20Mock("Wrapped BTC", "WBTC");
        MockAggregatorV3 agg = new MockAggregatorV3(60_000e8); // 8 decimals

        vm.expectRevert(bytes("PriceFeed: decimals mismatch"));
        feed.setPriceFeed(address(token), address(agg), 18);
    }

    function test_PriceFeed_SetFeed_LegacyOverloadDerivesDecimals() public {
        PriceFeed feed = new PriceFeed();
        ERC20Mock token = new ERC20Mock("Wrapped BTC", "WBTC");
        MockAggregatorV3 agg = new MockAggregatorV3(60_000e8);

        feed.setPriceFeed(address(token), address(agg));
        assertEq(feed.feedDecimals(address(token)), 8, "derived from the feed");
    }

    function test_PriceFeed_RequireBounds_RejectsSingleSidedConfig() public {
        PriceFeed feed = new PriceFeed();
        ERC20Mock token = new ERC20Mock("Wrapped BTC", "WBTC");
        MockAggregatorV3 agg = new MockAggregatorV3(60_000e8);

        feed.setPriceFeed(address(token), address(agg), 8);
        feed.setRequireBounds(true);
        // Only a floor configured: the ceiling is missing and must not pass.
        feed.setAnswerBounds(address(token), 1_000e8, 0);

        vm.expectRevert(PriceFeed.BoundsNotConfigured.selector);
        feed.getAmountInUsd(address(token), 1e18);
    }

    function test_PriceFeed_RequireBounds_AcceptsTwoSidedConfig() public {
        PriceFeed feed = new PriceFeed();
        ERC20Mock token = new ERC20Mock("Wrapped BTC", "WBTC");
        MockAggregatorV3 agg = new MockAggregatorV3(60_000e8);

        feed.setPriceFeed(address(token), address(agg), 8);
        feed.setRequireBounds(true);
        feed.setAnswerBounds(address(token), 1_000e8, 1_000_000e8);

        assertEq(feed.getAmountInUsd(address(token), 1e18), 60_000e18, "USD value");
    }

    // ─── HIGH-ACT-02: canonical CoW pre-signature ──────────────────────────

    function test_CowSigning_PreSign_ReadsCanonicalSettlement() public {
        MockGpv2Settlement gpv2 = new MockGpv2Settlement();
        CowSigningHarness harness = new CowSigningHarness(address(gpv2));

        address owner = makeAddr("cowTrader");
        CowOrder.Data memory order = _order();
        bytes memory uid = abi.encodePacked(harness.hashOf(order), owner, order.validTo);
        bytes memory signature = abi.encodePacked(owner);

        // Not signed anywhere yet.
        vm.expectRevert(bytes("Cow: order not presigned"));
        harness.recoverPreSignerExternal(order, signature);

        // Real CoW users pre-sign on GPv2Settlement, not on the Eswap shim.
        gpv2.setPreSignature(uid, PRE_SIGNED);
        assertEq(harness.recoverPreSignerExternal(order, signature), owner, "canonical presign accepted");
    }

    function test_CowSigning_PreSign_LocalLedgerStillWorks() public {
        MockGpv2Settlement gpv2 = new MockGpv2Settlement();
        CowSigningHarness harness = new CowSigningHarness(address(gpv2));

        address owner = makeAddr("cowTrader");
        CowOrder.Data memory order = _order();
        bytes memory uid = abi.encodePacked(harness.hashOf(order), owner, order.validTo);

        vm.prank(owner);
        harness.setPreSignature(uid, true);

        assertEq(harness.recoverPreSignerExternal(order, abi.encodePacked(owner)), owner, "local presign accepted");
    }

    // ─── HIGH-ACT-02: adapter multicall selector policy ────────────────────

    /// @dev The advertised atomic `[selfPermit, swap]` batch must be permitted,
    ///      while every owner-gated admin action stays unreachable.
    function test_LeverageAdapter_Multicall_SelectorPolicy() public {
        AdapterHarness adapter = new AdapterHarness(EswapRouter(payable(address(0xBEEF))));

        assertTrue(adapter.allowed(EswapLeverageAdapter.selfPermit.selector), "selfPermit allowed");
        assertTrue(
            adapter.allowed(EswapLeverageAdapter.exactInputSingleWithLeverage.selector), "single swap allowed"
        );
        assertTrue(
            adapter.allowed(EswapLeverageAdapter.exactInputSingleWithLeverageFor.selector), "swapFor allowed"
        );
        assertTrue(
            adapter.allowed(EswapLeverageAdapter.exactInputSingleWithLeverageAggregator.selector),
            "aggregator swap allowed"
        );
        assertFalse(adapter.allowed(EswapLeverageAdapter.setDefaultSolver.selector), "admin setter blocked");
        assertFalse(adapter.allowed(EswapLeverageAdapter.registerPool.selector), "admin register blocked");
    }

    /// @dev Admin selectors are rejected at the multicall boundary, not merely
    ///      blocked by the Ownable check after delegatecall.
    function test_LeverageAdapter_Multicall_RejectsAdminSelector() public {
        AdapterHarness adapter = new AdapterHarness(EswapRouter(payable(address(0xBEEF))));
        bytes[] memory calls = new bytes[](1);
        calls[0] = abi.encodeWithSelector(EswapLeverageAdapter.setDefaultSolver.selector, address(0xBAD));

        vm.expectRevert(
            abi.encodeWithSelector(
                EswapLeverageAdapter.UnauthorizedDelegatecall.selector, EswapLeverageAdapter.setDefaultSolver.selector
            )
        );
        adapter.multicall(calls);
    }

    function _order() internal view returns (CowOrder.Data memory order) {
        order = CowOrder.Data({
            sellToken: address(0x1111),
            buyToken: address(0x2222),
            receiver: address(0),
            sellAmount: 1 ether,
            buyAmount: 1 ether,
            validTo: uint32(block.timestamp + 1 hours),
            appData: bytes32(0),
            feeAmount: 0,
            kind: CowOrder.KIND_SELL,
            partiallyFillable: false,
            sellTokenBalance: CowOrder.BALANCE_ERC20,
            buyTokenBalance: CowOrder.BALANCE_ERC20
        });
    }
}
