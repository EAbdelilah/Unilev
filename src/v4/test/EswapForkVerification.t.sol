// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IPoolManager as RealPM} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey as RealKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency as RealCurrency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {TransientStateLibrary} from "@uniswap/v4-core/src/libraries/TransientStateLibrary.sol";
import {IPoolManager as LocalPM} from "../interfaces/IPoolManager.sol";
import {EswapMarginHook, IPriceFeed} from "../EswapMarginHook.sol";
import {EswapMarginHookLogic} from "../EswapMarginHookLogic.sol";
import {EswapRouter} from "../EswapRouter.sol";
import {EswapRouterExt} from "../EswapRouterExt.sol";
import {PoolKey as LocalKey} from "../types/PoolKey.sol";
import {Currency as LocalCurrency} from "../types/Currency.sol";
import {PoolId, PoolIdLibrary} from "../types/PoolId.sol";
import {EswapHookDeployLib} from "./EswapHookDeployLib.sol";

/// @dev Real PoolManager (Unichain) counterparty. Settles its own deltas and,
///      optionally, the hook's negative delta via `settleFor(hook)` — the same
///      mechanism EswapRouter._swapCallback uses for the borrow leg.
contract ForkLocker {
    RealPM public immutable pm;

    // Snapshot of currency deltas taken right after the swap, before settlement.
    int256 public lockerDelta0;
    int256 public lockerDelta1;
    int256 public hookDelta0;
    int256 public hookDelta1;

    struct Plan {
        RealKey key;
        int256 liquidityDelta;
        bool zeroForOne;
        int256 amountSpecified;
        bytes hookData;
        bool settleHook;
        uint256 hookPayPct;
    }

    constructor(RealPM _pm) {
        pm = _pm;
    }

    function run(Plan memory p) external returns (bytes memory) {
        return pm.unlock(abi.encode(p));
    }

    function unlockCallback(bytes calldata raw) external returns (bytes memory) {
        require(msg.sender == address(pm), "not pm");
        Plan memory p = abi.decode(raw, (Plan));
        if (p.liquidityDelta != 0) {
            pm.modifyLiquidity(
                p.key,
                RealPM.ModifyLiquidityParams({tickLower: -120, tickUpper: 120, liquidityDelta: p.liquidityDelta, salt: 0}),
                ""
            );
        }
        if (p.amountSpecified != 0) {
            pm.swap(
                p.key,
                RealPM.SwapParams({
                    zeroForOne: p.zeroForOne,
                    amountSpecified: p.amountSpecified,
                    sqrtPriceLimitX96: p.zeroForOne ? 4295128740 : 1461446703485210103287273052203988822378723970341
                }),
                p.hookData
            );
        }
        address hk = address(p.key.hooks);
        lockerDelta0 = TransientStateLibrary.currencyDelta(pm, address(this), p.key.currency0);
        lockerDelta1 = TransientStateLibrary.currencyDelta(pm, address(this), p.key.currency1);
        hookDelta0 = TransientStateLibrary.currencyDelta(pm, hk, p.key.currency0);
        hookDelta1 = TransientStateLibrary.currencyDelta(pm, hk, p.key.currency1);
        _settleOwn(p.key.currency0);
        _settleOwn(p.key.currency1);
        if (p.settleHook) {
            _settleHook(p.key.currency0, address(p.key.hooks), p.hookPayPct);
            _settleHook(p.key.currency1, address(p.key.hooks), p.hookPayPct);
        }
        return "";
    }

    function _settleOwn(RealCurrency c) internal {
        int256 d = TransientStateLibrary.currencyDelta(pm, address(this), c);
        if (d < 0) {
            pm.sync(c);
            IERC20(RealCurrency.unwrap(c)).transfer(address(pm), uint256(-d));
            pm.settle();
        } else if (d > 0) {
            pm.take(c, address(this), uint256(d));
        }
    }

    function _settleHook(RealCurrency c, address hook, uint256 pct) internal {
        int256 d = TransientStateLibrary.currencyDelta(pm, hook, c);
        if (d >= 0) return;
        uint256 pay = (uint256(-d) * pct) / 100;
        if (pay == 0) return;
        pm.sync(c);
        IERC20(RealCurrency.unwrap(c)).transfer(address(pm), pay);
        pm.settleFor(hook);
    }
}

contract FeedStub is IPriceFeed {
    function getAmountInUsd(address, uint256 amount) external pure override returns (uint256) {
        return amount;
    }

    function getTwapPrice(address) external pure override returns (uint256) {
        return 1e18;
    }
}

/// @notice Fork verification of I3 (PoolManager delta accounting) and I6/JIT
///         behavior against the REAL Unichain PoolManager. Requires
///         UNICHAIN_RPC_URL; skipped otherwise. Uses real USDC/WETH (no mock
///         ERC-20s, per AGENTS.md).
contract EswapForkVerificationTest is Test {
    using PoolIdLibrary for LocalKey;

    address constant UNICHAIN_PM = 0x1F98400000000000000000000000000000000004;
    address constant USDC = 0x078D782b760474a361dDA0AF3839290b0EF57AD6;
    address constant WETH = 0x4200000000000000000000000000000000000006;
    uint160 constant SQRT_PRICE_1_1 = 79228162514264337593543950336;

    RealPM pm;
    EswapMarginHook hook;
    EswapRouter router;
    EswapRouterExt ext;
    ForkLocker locker;
    LocalKey lkey;
    RealKey key;
    PoolId poolId;

    address swapper = address(0xAAAA);
    address solver = address(0xBBBB);

    function setUp() public {
        string memory rpc = vm.envOr("UNICHAIN_RPC_URL", string(""));
        if (bytes(rpc).length == 0) vm.skip(true);
        vm.createSelectFork(rpc);

        pm = RealPM(UNICHAIN_PM);
        FeedStub feed = new FeedStub();
        // High bits: repo HookFlags (checked by the hook constructor). Low 14 bits:
        // the real v4 PoolManager permission mask, matching scripts/v4/DeployBase._flags.
        address hookAddr = address(uint160((1 << 159) | (1 << 158) | (1 << 153) | (1 << 152) | (1 << 148) | 0x10C8));
        (hook,,) = EswapHookDeployLib.deployHookAt(vm, UNICHAIN_PM, address(feed), address(this), hookAddr);

        EswapMarginHookLogic(payable(address(hook))).setTokenDecimals(USDC, 6);
        EswapMarginHookLogic(payable(address(hook))).setTokenDecimals(WETH, 18);

        router = new EswapRouter(LocalPM(UNICHAIN_PM));
        ext = new EswapRouterExt(LocalPM(UNICHAIN_PM), address(router));
        router.setRouterExt(address(ext));
        hook.setRouterAndMinCollateralUsd(address(router), 0);
        router.setSolverWhitelist(solver, true);
        ext.setJitApprovedSwapper(swapper, true);

        lkey = LocalKey({
            currency0: LocalCurrency.wrap(USDC),
            currency1: LocalCurrency.wrap(WETH),
            fee: 3000,
            tickSpacing: 60,
            hooks: address(hook)
        });
        poolId = lkey.toId();
        EswapMarginHookLogic(payable(address(hook))).setAuthorizedPool(poolId, true);

        key = RealKey({
            currency0: RealCurrency.wrap(USDC),
            currency1: RealCurrency.wrap(WETH),
            fee: 3000,
            tickSpacing: 60,
            hooks: IHooks(address(hook))
        });
        pm.initialize(key, SQRT_PRICE_1_1);

        locker = new ForkLocker(pm);
        deal(USDC, address(locker), 1e20);
        deal(WETH, address(locker), 1000 ether);
        locker.run(_plan(1e21, false, 0, "", false, 0));
    }

    function _plan(int256 liq, bool z1, int256 amt, bytes memory hd, bool settleHook, uint256 pct)
        internal
        view
        returns (ForkLocker.Plan memory)
    {
        return ForkLocker.Plan({
            key: key,
            liquidityDelta: liq,
            zeroForOne: z1,
            amountSpecified: amt,
            hookData: hd,
            settleHook: settleHook,
            hookPayPct: pct
        });
    }

    function _marginData(uint8 lev) internal view returns (bytes memory) {
        return abi.encode(true, lev, address(locker));
    }

    /// @notice I3 negative: a margin open whose hook-side borrow delta is never
    ///         settled through the PoolManager must not survive unlock.
    function test_I3_RealPM_UnsettledHookDelta_Reverts() public {
        vm.expectRevert(abi.encodeWithSignature("CurrencyNotSettled()"));
        locker.run(_plan(0, false, -0.1 ether, _marginData(3), false, 0));
    }

    /// @notice I3 control: the same margin open, with the borrow leg settled via
    ///         settleFor(hook), succeeds and records the position with the
    ///         exact borrowed amount. Validates the PM delta-accounting assumption.
    function test_I3_RealPM_SettledBorrowLeg_Succeeds() public {
        locker.run(_plan(0, false, -0.1 ether, _marginData(3), true, 100));
        (, , uint256 borrowed, , , , , , ) = hook.positions(poolId, address(locker));
        assertEq(borrowed, 0.2 ether, "recorded borrow must equal margin * (lev - 1)");
    }

    /// @notice I1: after a margin open completes in this transaction, every
    ///         transient margin slot for the trader must be zero. Read in the same
    ///         transaction, since transient storage is cleared only at its end.
    function test_I1_RealPM_NoResidualTransientAfterMarginOpen() public {
        locker.run(_plan(0, false, -0.1 ether, _marginData(3), true, 100));
        (bytes32 t, bytes32 b, bytes32 l) = hook.getTransientMarginState(address(locker));
        assertEq(t, bytes32(0), "TRADER guard residue");
        assertEq(b, bytes32(0), "BORROW residue");
        assertEq(l, bytes32(0), "LEVERAGE residue");
    }

    /// @notice Diagnostic: measures where the margin open's negative borrow delta
    ///         is booked on the real PoolManager (locker vs hook address).
    function test_Diag_DeltaAttribution() public {
        locker.run(_plan(0, false, -0.1 ether, _marginData(3), true, 100));
        console2.log("locker delta0 (USDC):", locker.lockerDelta0());
        console2.log("locker delta1 (WETH):", locker.lockerDelta1());
        console2.log("hook   delta0 (USDC):", locker.hookDelta0());
        console2.log("hook   delta1 (WETH):", locker.hookDelta1());
    }

    /// @notice I3: a borrow settled for less than the hook delta (leverage
    ///         mismatch at the settlement layer) must not survive unlock.
    function test_I3_RealPM_PartialBorrowSettlement_Reverts() public {
        vm.expectRevert(abi.encodeWithSignature("CurrencyNotSettled()"));
        locker.run(_plan(0, false, -0.1 ether, _marginData(3), true, 50));
    }

    /// @notice I6: an external swap with empty hookData on the authorized hook
    ///         pool must not succeed (it would pay zero protocol fee). The
    ///         PoolManager wraps the hook's revert in WrappedError, so assert on
    ///         failure rather than the exact error payload.
    function test_I6_ExternalEmptyHookDataSwap_Reverts() public {
        (bool ok, bytes memory ret) =
            address(locker).call(abi.encodeCall(ForkLocker.run, (_plan(0, false, -0.1 ether, "", false, 0))));
        console2.log("empty-hookData swap succeeded:", ok);
        console2.logBytes(ret);
        assertFalse(ok, "external empty-hookData swap must revert");
    }

    /// @notice JIT: the spot-JIT path must not complete on the real PoolManager.
    ///         Records the raw revert payload so the failure site is visible.
    function test_JIT_RealPM_Reverts() public {
        deal(USDC, swapper, 1000e6);
        deal(WETH, solver, 10 ether);
        vm.prank(swapper);
        IERC20(USDC).approve(address(ext), type(uint256).max);
        vm.prank(solver);
        IERC20(WETH).approve(address(ext), type(uint256).max);

        EswapRouterExt.JITSpotParams memory params = EswapRouterExt.JITSpotParams({
            key: lkey,
            zeroForOne: true,
            amountSpecified: -int256(100e6),
            solver: solver,
            solverOutput: 0.05 ether,
            minSolverOutput: 0,
            swapper: swapper
        });

        vm.prank(swapper);
        (bool ok, bytes memory ret) = address(ext).call(abi.encodeCall(EswapRouterExt.executeJITSpotSwap, (params)));
        console2.log("JIT succeeded:", ok);
        console2.log("JIT revert payload length:", ret.length);
        console2.logBytes(ret);
        assertFalse(ok, "JIT spot swap completed on the real PoolManager");
    }
}
