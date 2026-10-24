// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {Test} from "forge-std/Test.sol";

import {EswapMarginHook} from "../../src/v4/EswapMarginHook.sol";
import {EswapRouter} from "../../src/v4/EswapRouter.sol";
import {EswapLeverageAdapter} from "../../src/v4/EswapLeverageAdapter.sol";
import {PoolKey} from "../../src/v4/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "../../src/v4/types/PoolId.sol";
import {Currency} from "../../src/v4/types/Currency.sol";

import {IPoolManager as RealIPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolId as RealPoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {PoolKey as RealPoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency as RealCurrency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks as RealIHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {IERC20 as RealIERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Fork-phase verification of the hook-fee-burn fix against the FULLY
///         DEPLOYED Base stack (hook + router from {DeployBase}), driven end to
///         end: open a long, close it, then sweep `withdrawProtocolFee`. Fails
///         (Panic 0x11) on the pre-fix bytecode; must pass on the deployed one.
///
/// @dev Run against the local anvil Base fork the deploy was broadcast to:
///        V4_HOOK_ADDRESS=<fork hook> V4_ROUTER_ADDRESS=<fork router> \
///        forge script scripts/v4/VerifyBaseForkFeeSweep.s.sol:VerifyBaseForkFeeSweep \
///          --rpc-url http://localhost:8545 --via-ir
contract VerifyBaseForkFeeSweep is Script {
    using PoolIdLibrary for PoolKey;

    address constant BASE_PM = 0x498581fF718922c3f8e6A244956aF099B2652b2b;
    address constant BASE_USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address constant BASE_WETH = 0x4200000000000000000000000000000000000006;

    int24 constant LP_HALF_WIDTH = 2400;
    int24 constant INIT_TICK = -198673;

    function run() external {
        require(block.chainid == 8453, "not Base (8453)");

        address hookAddr = vm.envAddress("V4_HOOK_ADDRESS");
        address routerAddr = vm.envAddress("V4_ROUTER_ADDRESS");
        require(hookAddr.code.length > 0, "hook has no code");
        require(routerAddr.code.length > 0, "router has no code");

        RealIPoolManager pm = RealIPoolManager(BASE_PM);
        EswapMarginHook hook = EswapMarginHook(payable(hookAddr));
        EswapRouter router = EswapRouter(payable(routerAddr));

        console2.log("Verifying deployed fork hook =", hookAddr);

        // Standalone helper: does all `address(this)`-dependent pool seeding and
        // the whole open->close->sweep cycle, so the ephemeral script contract
        // never references its own address.
        ForkFeeSweepHelper helper = new ForkFeeSweepHelper();
        helper.configure(vm.envUint("PRIVATE_KEY"));
        helper.runCycle(pm, hook, router);

        console2.log("=== FEE SWEEP VERIFIED ON DEPLOYED FORK HOOK ===");
    }
}

/// @dev Everything that touches `address(this)` (unlock callback / seeding) plus
///      the open/close/withdraw cycle, isolated from the ephemeral script.
contract ForkFeeSweepHelper is Test, IUnlockCallback {
    using PoolIdLibrary for PoolKey;

    address constant BASE_USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address constant BASE_WETH = 0x4200000000000000000000000000000000000006;

    int24 constant LP_HALF_WIDTH = 2400;
    int24 constant INIT_TICK = -198673;

    RealIPoolManager pm;
    EswapMarginHook hook;
    EswapRouter router;
    EswapLeverageAdapter adapter;

    PoolKey hookLocalKey;
    PoolKey standardLocalKey;

    address trader = makeAddr("forkSweepTrader");
    address solver = makeAddr("forkSweepSolver");
    uint256 pk;

    function configure(uint256 _pk) external {
        pk = _pk;
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        (RealPoolKey memory key, int24 tl, int24 tu, int128 liq) = abi.decode(data, (RealPoolKey, int24, int24, int128));
        (BalanceDelta delta,) = pm.modifyLiquidity(
            key,
            RealIPoolManager.ModifyLiquidityParams({
                tickLower: tl, tickUpper: tu, liquidityDelta: liq, salt: bytes32(0)
            }),
            ""
        );
        if (delta.amount0() < 0) {
            pm.sync(RealCurrency.wrap(BASE_WETH));
            RealIERC20(BASE_WETH).transfer(address(pm), uint256(-int256(delta.amount0())));
            pm.settle();
        } else if (delta.amount0() > 0) {
            pm.take(RealCurrency.wrap(BASE_WETH), address(this), uint256(uint128(delta.amount0())));
        }
        if (delta.amount1() < 0) {
            pm.sync(RealCurrency.wrap(BASE_USDC));
            RealIERC20(BASE_USDC).transfer(address(pm), uint256(-int256(delta.amount1())));
            pm.settle();
        } else if (delta.amount1() > 0) {
            pm.take(RealCurrency.wrap(BASE_USDC), address(this), uint256(uint128(delta.amount1())));
        }
        return bytes("");
    }

    function runCycle(RealIPoolManager _pm, EswapMarginHook _hook, EswapRouter _router) external {
        pm = _pm;
        hook = _hook;
        router = _router;

        _wireAndSeed();
        _cycle();
    }

    function _wireAndSeed() internal {
        vm.startBroadcast(pk);

        adapter = new EswapLeverageAdapter(router);
        router.setExecutorWhitelist(address(adapter), true);
        router.setSolverWhitelist(solver, true);

        hookLocalKey = PoolKey({
            currency0: Currency.wrap(BASE_WETH),
            currency1: Currency.wrap(BASE_USDC),
            fee: 3000,
            tickSpacing: 60,
            hooks: address(hook)
        });
        standardLocalKey = PoolKey({
            currency0: Currency.wrap(BASE_WETH),
            currency1: Currency.wrap(BASE_USDC),
            fee: 3000,
            tickSpacing: 60,
            hooks: address(0)
        });
        adapter.registerPool(BASE_USDC, BASE_WETH, 3000, hookLocalKey, standardLocalKey);
        adapter.registerPool(BASE_WETH, BASE_USDC, 3000, hookLocalKey, standardLocalKey);
        adapter.setDefaultSolver(solver);

        vm.stopBroadcast();

        RealPoolKey memory stdReal = _realKey(3000, address(0));
        RealPoolKey memory hookReal = _realKey(3000, address(hook));

        uint160 initSqrt = TickMath.getSqrtPriceAtTick(INIT_TICK);
        (uint160 stdSqrt,,,) = StateLibrary.getSlot0(pm, stdReal.toId());
        if (stdSqrt == 0) {
            pm.initialize(stdReal, initSqrt);
            stdSqrt = initSqrt;
        }
        (uint160 hookSqrt,,,) = StateLibrary.getSlot0(pm, hookReal.toId());
        if (hookSqrt == 0) {
            pm.initialize(hookReal, stdSqrt);
        }
        _seedLiquidity(hookReal, stdReal, stdSqrt);

        deal(BASE_USDC, trader, 1_000_000e6);
        deal(BASE_USDC, solver, 1_000_000e6);
        vm.prank(trader);
        RealIERC20(BASE_USDC).approve(address(router), type(uint256).max);
        vm.prank(solver);
        RealIERC20(BASE_USDC).approve(address(router), type(uint256).max);
    }

    function _cycle() internal {
        uint8 leverage = 2;
        uint256 notional = 200_000; // $0.20 USDC
        uint256 margin = notional / leverage;

        vm.prank(solver);
        router.depositBorrowEscrow(BASE_USDC, margin);

        vm.prank(trader);
        adapter.exactInputSingleWithLeverage(BASE_USDC, BASE_WETH, 3000, leverage, margin, 0, trader);

        Currency weth = Currency.wrap(BASE_WETH);
        uint256 feesAfterOpen = hook.protocolFees(weth);
        require(feesAfterOpen > 0, "open must accrue a WETH protocol fee");
        console2.log("protocolFees(WETH) after open:", feesAfterOpen);
        console2.log("heldReserve(WETH) after open :", hook.heldReserve(weth));

        vm.prank(trader);
        router.closePosition(address(hook), hookLocalKey, trader, solver, 0);

        uint256 feesAfterClose = hook.protocolFees(weth);
        uint256 heldAfterClose = hook.heldReserve(weth);
        console2.log("protocolFees(WETH) after close:", feesAfterClose);
        console2.log("heldReserve(WETH) after close :", heldAfterClose);
        require(feesAfterClose == feesAfterOpen, "fee ledger must persist across close");
        require(heldAfterClose >= feesAfterClose, "fee backing must survive settle/close");

        address treasury = hook.treasury();
        uint256 before = RealIERC20(BASE_WETH).balanceOf(treasury);

        vm.startBroadcast(pk);
        hook.withdrawProtocolFee(weth, feesAfterClose);
        vm.stopBroadcast();

        uint256 gained = RealIERC20(BASE_WETH).balanceOf(treasury) - before;
        require(gained == feesAfterClose, "treasury must receive the accrued WETH fee");
        require(hook.protocolFees(weth) == 0, "fee ledger drained on withdraw");

        console2.log("=== FEE SWEEP OK: treasury received (WETH wei):", gained, "===");
    }

    function _realKey(uint24 fee, address hooks) internal view returns (RealPoolKey memory k) {
        k = RealPoolKey({
            currency0: RealCurrency.wrap(BASE_WETH),
            currency1: RealCurrency.wrap(BASE_USDC),
            fee: fee,
            tickSpacing: 60,
            hooks: RealIHooks(hooks)
        });
    }

    function _seedLiquidity(RealPoolKey memory hookReal, RealPoolKey memory stdReal, uint160 initSqrt) internal {
        deal(BASE_USDC, address(this), 2_000_000e6);
        deal(BASE_WETH, address(this), 4000 ether);
        RealIERC20(BASE_USDC).approve(address(pm), type(uint256).max);
        RealIERC20(BASE_WETH).approve(address(pm), type(uint256).max);

        int24 tick = TickMath.getTickAtSqrtPrice(initSqrt);
        int24 base = (tick / 60) * 60;
        int24 lower = base - LP_HALF_WIDTH;
        int24 upper = base + LP_HALF_WIDTH;
        int128 liq = int128(int256(1e15));

        pm.unlock(abi.encode(stdReal, lower, upper, liq));
        pm.unlock(abi.encode(hookReal, lower, upper, liq));

        uint128 stdLiq = StateLibrary.getLiquidity(pm, RealPoolId.wrap(PoolId.unwrap(standardLocalKey.toId())));
        uint128 hookLiq = StateLibrary.getLiquidity(pm, RealPoolId.wrap(PoolId.unwrap(hookLocalKey.toId())));
        require(stdLiq > 0, "standard pool liquidity missing");
        require(hookLiq > 0, "hook pool liquidity missing");
    }
}
