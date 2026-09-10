// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {EswapMarginHook} from "../EswapMarginHook.sol";
import {EswapRouter} from "../EswapRouter.sol";
import {PoolKey} from "../types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "../types/PoolId.sol";
import {Currency} from "../types/Currency.sol";
import {IPoolManager} from "../interfaces/IPoolManager.sol";
import {IERC20 as RealIERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IPoolManager as RealIPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolIdLibrary as RealPoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {PoolKey as RealPoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency as RealCurrency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks as RealIHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";

/// @dev Fork-deploy rewrite of the LIVE deployCollateral repro (was: live hook +
///      live router at a past block; now: CURRENT working-tree hook + router
///      deployed against the REAL live Unichain PoolManager). Proves the
///      [FIX SELF-CLOSE] self-wrap: a MINED, out-of-unlock `deployCollateral`
///      (onlyRouterOrManager) no longer reverts `ManagerLocked` on the real
///      PoolManager — it wraps itself in an unlock and actually executes the
///      band deployment.
contract LiveDeployCollateralReproTest is Test {
    using PoolIdLibrary for PoolKey;
    using RealPoolIdLibrary for RealPoolKey;

    address constant PM = 0x1F98400000000000000000000000000000000004; // Unichain V4 singleton
    address constant USDC = 0x078D782b760474a361dDA0AF3839290b0EF57AD6;
    address constant ETH = address(0);

    // New hook + router (fix compiled in) at a PoolManager-flag-compliant address.
    uint160 constant HIGH_FLAGS = (1 << 159) | (1 << 158) | (1 << 153) | (1 << 152) | (1 << 148);
    uint160 constant LOW_FLAGS = (1 << 13) | (1 << 12) | (1 << 7) | (1 << 6) | (1 << 3);
    uint160 constant NEW_HOOK_ADDR_RAW = HIGH_FLAGS | LOW_FLAGS;

    address newHookAddr;
    EswapMarginHook newHook;
    EswapRouter newRouter;

    address trader = makeAddr("trader");
    address solver = 0x518634753C61342298c3E04326056b3Ce596a566;

    PoolKey hookKey;
    PoolId hookPoolId;

    RealPoolKey stdKey = RealPoolKey({
        currency0: RealCurrency.wrap(ETH),
        currency1: RealCurrency.wrap(USDC),
        fee: 500,
        tickSpacing: 10,
        hooks: RealIHooks(address(0))
    });

    RealIPoolManager mgr;
    receive() external payable {}

    function setUp() public {
        string memory rpc = vm.envOr("UNICHAIN_RPC_URL", string(""));
        require(bytes(rpc).length > 0, "UNICHAIN_RPC_URL required");
        vm.createSelectFork(rpc);
        require(block.chainid == 130, "not unichain");
        mgr = RealIPoolManager(PM);

        // Borrow the live hook's price feed address (immutable getter).
        address liveFeed =
            address(EswapMarginHook(payable(0x4bd2C1e73d150b65EF88DBa247Ed60A1538310c8)).priceFeed());

        deployCodeTo(
            "EswapMarginHook.sol:EswapMarginHook",
            abi.encode(PM, liveFeed, address(this)),
            address(uint160(NEW_HOOK_ADDR_RAW))
        );
        newHook = EswapMarginHook(payable(address(uint160(NEW_HOOK_ADDR_RAW))));
        newHookAddr = address(newHook);

        newRouter = new EswapRouter(IPoolManager(PM));
        newHook.setRouterAndMinCollateralUsd(address(newRouter), 0);
        newHook.setTokenDecimals(USDC, 6);
        newRouter.setSolverWhitelist(solver, true);

        hookKey = PoolKey({
            currency0: Currency.wrap(ETH),
            currency1: Currency.wrap(USDC),
            fee: 3000,
            tickSpacing: 60,
            hooks: newHookAddr
        });
        hookPoolId = hookKey.toId();

        // Initialize the hook accounting pool at the live standard price.
        (uint160 stdSqrt,,,) = StateLibrary.getSlot0(mgr, stdKey.toId());
        mgr.initialize(
            RealPoolKey({
                currency0: RealCurrency.wrap(ETH),
                currency1: RealCurrency.wrap(USDC),
                fee: 3000,
                tickSpacing: 60,
                hooks: RealIHooks(newHookAddr)
            }),
            stdSqrt
        );

        newHook.setAuthorizedPool(hookPoolId, true);
        newHook.setStandardPoolKey(hookPoolId, _stdKeyLocal());

        deal(USDC, trader, 1_000_000e6);
        deal(USDC, solver, 1_000_000e6);
        deal(USDC, address(this), 1_000_000e6);

        vm.prank(trader);
        RealIERC20(USDC).approve(address(newRouter), type(uint256).max);
        vm.prank(solver);
        RealIERC20(USDC).approve(address(newRouter), type(uint256).max);
    }

    function _stdKeyLocal() internal view returns (PoolKey memory) {
        return PoolKey({
            currency0: Currency.wrap(RealCurrency.unwrap(stdKey.currency0)),
            currency1: Currency.wrap(RealCurrency.unwrap(stdKey.currency1)),
            fee: stdKey.fee,
            tickSpacing: stdKey.tickSpacing,
            hooks: address(stdKey.hooks)
        });
    }

    function _openLong(uint256 margin, uint8 leverage) internal {
        vm.prank(trader);
        newRouter.swapMultiPool(EswapRouter.SwapParams({
            key: hookKey,
            standardPoolKey: _stdKeyLocal(),
            zeroForOne: false, // LONG: pay token1 = USDC, buy token0 = ETH
            amountSpecified: -int256(margin),
            leverage: leverage,
            solver: solver,
            hookData: abi.encode(true, leverage, trader),
            deadline: block.timestamp + 15 minutes,
            minAmountOut: 0
        }));
    }

    function _positionOf(address who) internal view returns (uint256 coll, int24 tl, int24 tu, uint128 liq) {
        (, coll, , , , , tl, tu, liq) = newHook.positions(hookPoolId, who);
    }

    /// @dev Storage slot holding {tickLower, tickUpper, liquidity} for
    ///      positions[hookPoolId][who]. `positions` is slot 1 in both the hook
    ///      and the (delegatecalled) logic; the struct packs the band fields in
    ///      its 5th value slot (trader | collateral | borrowed | lev+isLong+liqSqrt
    ///      | tickLower+tickUpper+liquidity).
    function _bandFieldsSlot(address who) internal view returns (bytes32) {
        bytes32 inner = keccak256(abi.encode(PoolId.unwrap(hookPoolId), uint256(1)));
        bytes32 posSlot = keccak256(abi.encode(uint256(uint160(who)), uint256(inner)));
        return bytes32(uint256(posSlot) + 4);
    }

    /// @dev Manufactures the exact state the live probe observed at block
    ///      57791352: an existing position with collateral (which the hook holds
    ///      as its settlement backing) but NO recorded band. The hook forgets its
    ///      band fields; the position stays solvent, so a redeploy is legitimate.
    function _forgetBand(address who) internal returns (uint256 coll, uint128 liq) {
        vm.store(address(newHook), _bandFieldsSlot(who), bytes32(0));
        (coll, , , liq) = _positionOf(who);
        assertEq(liq, 0, "band must read back as removed");
        assertGt(coll, 0, "collateral must survive band removal");
    }

    // ─── Tests ─────────────────────────────────────────────────────────────

    /// @dev The ManagerLocked regression: a MINED out-of-unlock deployCollateral
    ///      on a collateralized-but-bandless position. Pre-fix this reverted
    ///      `ManagerLocked` on the real PoolManager; with [FIX SELF-CLOSE] it
    ///      self-wraps into an unlock and actually (re)deploys the LP band.
    function test_DeployCollateral_OutOfUnlock_SelfWrap_RedeploysBand_OnRealPM() public {
        _openLong(100e6, 2);

        (uint256 coll,,, uint128 liq) = _positionOf(trader);
        emit log_named_uint("open collateral (wei ETH)", coll);
        emit log_named_uint("open liquidity", liq);
        assertGt(liq, 0, "full margin open must deploy a band");

        // Forget the band in the hook's records only; refund the hook so the
        // redeploy's settlement backing exists (as if the band had never been
        // deployed — the 57791352 live state).
        vm.store(address(newHook), _bandFieldsSlot(trader), bytes32(0));
        (coll,,, liq) = _positionOf(trader);
        assertEq(liq, 0, "band must read back as removed");
        assertGt(coll, 0, "collateral must survive band removal");
        vm.deal(newHookAddr, 1 ether);

        // MINED out-of-unlock direct call. The caller is the router (the only
        // legit external caller), the PoolManager lock is CLOSED. Pre-fix:
        // ManagerLocked revert. Post-fix: self-wrapped success.
        vm.prank(address(newRouter));
        newHook.deployCollateral(hookKey, trader);

        (uint256 coll2, int24 tl2, int24 tu2, uint128 liq2) = _positionOf(trader);
        uint256 rehyp = newHook.rehypPrincipal(hookPoolId, trader);
        emit log_named_int("redeployed tickLower", tl2);
        emit log_named_int("redeployed tickUpper", tu2);
        emit log_named_uint("redeployed liquidity", liq2);
        emit log_named_uint("redeployed principal (wei ETH)", rehyp);
        assertGt(coll2, 0, "position must remain collateralized");
        assertGt(liq2, 0, "self-wrapped deploy must redeploy a band on the real PM");
        assertGt(rehyp, 0, "redeploy must re-record the rehyp principal");
        assertLt(tl2, tu2, "redeployed band must stay ordered");
    }

    /// @dev Ergonomics of a mined out-of-unlock call on a freshly-deployed
    ///      position (band already present): the router-or-manager access rule
    ///      holds, the call is an idempotent no-op, and position state is
    ///      untouched.
    function test_DeployCollateral_OutOfUnlock_AlreadyBanded_IsIdempotent() public {
        _openLong(100e6, 2);
        (uint256 coll, int24 tl0, int24 tu0, uint128 liq0) = _positionOf(trader);
        assertGt(liq0, 0, "open must deploy a band");

        vm.prank(address(newRouter));
        newHook.deployCollateral(hookKey, trader);

        (uint256 coll1, int24 tl1, int24 tu1, uint128 liq1) = _positionOf(trader);
        assertEq(coll1, coll, "collateral unchanged");
        assertEq(liq1, liq0, "band unchanged");
        assertEq(tl1, tl0, "tickLower unchanged");
        assertEq(tu1, tu0, "tickUpper unchanged");
    }
}