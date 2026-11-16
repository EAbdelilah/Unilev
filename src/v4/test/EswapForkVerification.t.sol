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
///         behavior against the REAL Base PoolManager. Requires
///         BASE_RPC_URL; skipped otherwise. Uses real USDC/WETH (no mock
///         ERC-20s, per AGENTS.md).
contract EswapForkVerificationTest is Test {
    using PoolIdLibrary for LocalKey;

    // Base mainnet (chain 8453) — the protocol's target chain.
    address constant BASE_PM   = 0x498581fF718922c3f8e6A244956aF099B2652b2b;
    address constant USDC      = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address constant WETH      = 0x4200000000000000000000000000000000000006;
    uint160 constant SQRT_PRICE_1_1 = 79228162514264337593543950336;

    RealPM pm;
    EswapMarginHook hook;
    EswapRouter router;
    EswapRouterExt ext;
    ForkLocker locker;
    LocalKey lkey;
    RealKey key;
    PoolId poolId;

    // Live Nov-11 Base deployment (chain 8453).
    address constant LIVE_HOOK = 0x7b3F232BB5a0346fADb8B92B31B3e7bC60bD90c8;
    address constant LIVE_ROUTER = 0x5b226aE5158de86f1E616875dBab886870B9aAd9;
    address constant HOOK_TIMELOCK = 0x9aA2e9e2FB4cfC71a89F03b88Abf6116d8B1138e;
    // keccak256(abi.encodePacked(WETH, USDC, uint24(3000), int24(60), liveHook))
    bytes32 constant LIVE_POOL_ID = 0x48ccea22cd56a363882769b3f3b8f056a91df05c17cd96c4429b62767ff8ade3;

    address swapper = address(0xAAAA);
    address solver = address(0xBBBB);

    function setUp() public {
        string memory rpc = vm.envOr("BASE_RPC_URL", string("https://mainnet.base.org"));
        vm.createSelectFork(rpc);
        if (block.chainid != 8453) vm.skip(true);

        pm = RealPM(BASE_PM);
        FeedStub feed = new FeedStub();
        // High bits: repo HookFlags (checked by the hook constructor). Low 14 bits:
        // the real v4 PoolManager permission mask, matching scripts/v4/DeployBase._flags.
        address hookAddr = address(uint160((1 << 159) | (1 << 158) | (1 << 153) | (1 << 152) | (1 << 148) | 0x10C8));
        (hook,,) = EswapHookDeployLib.deployHookAt(vm, BASE_PM, address(feed), address(this), hookAddr);

        EswapMarginHookLogic(payable(address(hook))).setTokenDecimals(USDC, 6);
        EswapMarginHookLogic(payable(address(hook))).setTokenDecimals(WETH, 18);

        router = new EswapRouter(LocalPM(BASE_PM));
        ext = new EswapRouterExt(LocalPM(BASE_PM), address(router));
        router.setRouterExt(address(ext));
        hook.setRouterAndMinCollateralUsd(address(router), 0);
        router.setSolverWhitelist(solver, true);
        ext.setJitApprovedSwapper(swapper, true);

        lkey = LocalKey({
            currency0: LocalCurrency.wrap(WETH),
            currency1: LocalCurrency.wrap(USDC),
            fee: 3000,
            tickSpacing: 60,
            hooks: address(hook)
        });
        poolId = lkey.toId();
        EswapMarginHookLogic(payable(address(hook))).setAuthorizedPool(poolId, true);

        // On Base: WETH (0x4200…06) < USDC (0x8335…13) by address → WETH=currency0.
        key = RealKey({
            currency0: RealCurrency.wrap(WETH),
            currency1: RealCurrency.wrap(USDC),
            fee: 3000,
            tickSpacing: 60,
            hooks: IHooks(address(hook))
        });
        pm.initialize(key, SQRT_PRICE_1_1);

        locker = new ForkLocker(pm);
        // The real PoolManager reports the caller of `swap` (the locker) as the
        // hook's `sender`, so the locker must play the router's role here.
        hook.setRouterAndMinCollateralUsd(address(locker), 0);
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

    /// @notice The live Nov-11 Base deployment must still be governed by the
    ///         hook timelock, bound to the live router, and authorized for the
    ///         WETH/USDC pool this suite exercises. Read-only: proves the stack
    ///         under test is the stack that is live.
    function test_LiveStack_GovernanceAndPoolWiring() public {
        EswapMarginHook live = EswapMarginHook(payable(LIVE_HOOK));
        assertEq(live.owner(), HOOK_TIMELOCK, "live hook owner must be the timelock");
        assertEq(live.router(), LIVE_ROUTER, "live hook router must be the live router");
        assertTrue(live.isAuthorizedPool(PoolId.wrap(LIVE_POOL_ID)), "live hook must authorize WETH/USDC");
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
