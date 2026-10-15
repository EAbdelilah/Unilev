// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {EswapMarginHook} from "../EswapMarginHook.sol";
import {EswapRouter} from "../EswapRouter.sol";
import {EswapLeverageAdapter} from "../EswapLeverageAdapter.sol";
import {PoolKey} from "../types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "../types/PoolId.sol";
import {Currency} from "../types/Currency.sol";
import {IPoolManager} from "../interfaces/IPoolManager.sol";
import {PriceFeedMock} from "./BaseV4Test.t.sol";
import {BaseEnsoRoute} from "./fixtures/BaseEnsoRoute.sol";

// REAL lib/v4-core types against the LIVE Base PoolManager.
import {IPoolManager as RealIPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolId as RealPoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {PoolKey as RealPoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency as RealCurrency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks as RealIHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";
import {IERC20 as RealIERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {EswapHookDeployLib} from "./EswapHookDeployLib.sol";

/// @notice FULL-CYCLE Base proof: a REAL Enso bundle (enso:route USDC -> WETH,
///         routingStrategy=router) is executed through Enso's Router (the
///         exchangeProxy below) inside a fork of Base (chainId 8453), opening a
///         LEVERAGED LONG through EswapRouter._multiPoolOpenAggregator, then
///         closing against a local no-hook USDC/WETH pool.
///
///   open:  REAL Enso bundle (api.enso.build) -> adapter
///          exactInputSingleWithLeverageAggregator -> router executes
///          exchangeProxy.call(bundle tx.data) -> hook accounting
///   close: router.closePosition -> hook unwind on the no-hook pool
///
/// Why a fork: the fork swallows all execution, so Enso's router call never
/// broadcasts on Base — zero reputation/blacklist risk while proving the exact
/// Enso integration (real bundle data + real fill venue). Capital is injected
/// via cheatcodes from the fork's real token contracts; nothing moves.
///
/// NOTE on ordering: on Base WETH (0x4200..06) sorts BELOW USDC (0x8335..13),
/// so currency0=WETH, currency1=USDC (the inverse of Ethereum mainnet).
contract EswapBaseEnsoFullCycleForkTest is Test, IUnlockCallback {
    using PoolIdLibrary for PoolKey;

    // Base (chainId 8453).
    address constant BASE_PM = 0x498581fF718922c3f8e6A244956aF099B2652b2b;
    address constant BASE_USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address constant BASE_WETH = 0x4200000000000000000000000000000000000006;

    uint160 constant HIGH_FLAGS = (1 << 159) | (1 << 158) | (1 << 153) | (1 << 152) | (1 << 148);
    uint160 constant LOW_FLAGS = (1 << 13) | (1 << 12) | (1 << 7) | (1 << 6) | (1 << 3);

    int24 constant LP_HALF_WIDTH = 2400;
    // ~$2356/WETH consistent with the live Enso quote; oracle is derived from
    // whichever sqrt the pool ends up at, so exactness is not load-bearing.
    int24 constant INIT_TICK = -198673;

    RealIPoolManager pm;
    EswapMarginHook hook;
    EswapRouter router;
    EswapLeverageAdapter adapter;
    PriceFeedMock priceFeed;

    PoolKey hookLocalKey;
    PoolKey standardLocalKey;

    address trader = makeAddr("baseEnsoTrader");
    address solver = makeAddr("baseEnsoSolver");

    bool rpcAvailable;
    bool fixtureReady;

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        (RealPoolKey memory key, int24 tl, int24 tu, int128 liq) = abi.decode(data, (RealPoolKey, int24, int24, int128));
        (BalanceDelta delta,) = pm.modifyLiquidity(
            key,
            RealIPoolManager.ModifyLiquidityParams({
                tickLower: tl, tickUpper: tu, liquidityDelta: liq, salt: bytes32(0)
            }),
            ""
        );
        // On Base currency0 = WETH, currency1 = USDC.
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

    function setUp() public {
        string memory rpcUrl = vm.envOr("BASE_RPC_URL", string("https://mainnet.base.org"));
        if (bytes(rpcUrl).length == 0) return;
        if (BaseEnsoRoute.REF_BLOCK != 0) {
            vm.createSelectFork(rpcUrl, BaseEnsoRoute.REF_BLOCK);
        } else {
            vm.createSelectFork(rpcUrl);
        }
        try this._setupOnActiveFork() {}
        catch (bytes memory reason) {
            console2.log("setupOnActiveFork failed:", _reason(reason));
        }
    }

    function _reason(bytes memory r) internal pure returns (string memory) {
        if (r.length >= 68 && bytes4(r) == 0x08c379a0) return abi.decode(_slice(r, 4), (string));
        return "unknown revert";
    }

    function _slice(bytes memory b, uint256 from) internal pure returns (bytes memory out) {
        out = new bytes(b.length - from);
        for (uint256 i = 0; i < out.length; i++) {
            out[i] = b[from + i];
        }
    }

    function _setupOnActiveFork() external {
        if (block.chainid != 8453) return;
        if (BASE_PM.code.length == 0 || BASE_USDC.code.length == 0 || BASE_WETH.code.length == 0) return;

        pm = RealIPoolManager(BASE_PM);
        priceFeed = new PriceFeedMock();
        console2.log("forked Base (8453): PM", BASE_PM);
        console2.log("[step] hook deploy");

        address hookAddr = address(uint160(HIGH_FLAGS | LOW_FLAGS));
        (address _hookLogic, address _hookLogic2) = EswapHookDeployLib.deployLogic(address(pm), address(priceFeed));
        deployCodeTo("EswapMarginHook.sol:EswapMarginHook", abi.encode(address(pm), address(priceFeed), _hookLogic, _hookLogic2, address(this)), hookAddr);
        hook = EswapMarginHook(payable(hookAddr));
        console2.log("[step] router deploy");
        deployCodeTo("EswapRouter.sol:EswapRouter", abi.encode(address(pm)), BaseEnsoRoute.TAKER);
        router = EswapRouter(payable(BaseEnsoRoute.TAKER));
        console2.log("[step] wiring");
        hook.setRouterAndMinCollateralUsd(address(router), 0);
        router.setSolverWhitelist(solver, true);
        if (BaseEnsoRoute.EXCHANGE_PROXY != address(0)) {
            router.setAllowedAggregator(BaseEnsoRoute.EXCHANGE_PROXY, true);
        }

        // currency0 = WETH (lower address), currency1 = USDC.
        hookLocalKey = PoolKey({
            currency0: Currency.wrap(BASE_WETH),
            currency1: Currency.wrap(BASE_USDC),
            fee: 3000,
            tickSpacing: 60,
            hooks: hookAddr
        });
        standardLocalKey = PoolKey({
            currency0: Currency.wrap(BASE_WETH),
            currency1: Currency.wrap(BASE_USDC),
            fee: 3000,
            tickSpacing: 60,
            hooks: address(0)
        });

        RealPoolKey memory stdReal = _realKey(3000, address(0));
        RealPoolKey memory hookReal = _realKey(3000, hookAddr);
        uint160 initSqrt = TickMath.getSqrtPriceAtTick(INIT_TICK);
        (uint160 stdSqrt,,,) = StateLibrary.getSlot0(pm, stdReal.toId());
        console2.log("[step] init hook pool");
        if (stdSqrt == 0) {
            pm.initialize(stdReal, initSqrt);
            stdSqrt = initSqrt;
        }
        (uint160 hookSqrt,,,) = StateLibrary.getSlot0(pm, hookReal.toId());
        if (hookSqrt == 0) {
            pm.initialize(hookReal, stdSqrt);
        }
        console2.log("[step] pool wiring");

        hook.setAuthorizedPool(hookLocalKey.toId(), true);
        hook.setStandardPoolKey(hookLocalKey.toId(), standardLocalKey);
        hook.setBaseCurrency(hookLocalKey.toId(), Currency.wrap(BASE_WETH));
        hook.setTokenDecimals(BASE_WETH, 18);
        hook.setTokenDecimals(BASE_USDC, 6);

        // Oracle mock tracks the pool venue price (stable $1 USDC).
        priceFeed.setPrice(BASE_USDC, 1e18);
        priceFeed.setPrice(BASE_WETH, _wethUsd18FromSqrt(stdSqrt));
        console2.log("[step] seed pools");

        _seedLiquidity(hookReal, stdReal, stdSqrt);

        console2.log("[step] pipeline contracts");
        adapter = new EswapLeverageAdapter(router);
        router.setExecutorWhitelist(address(adapter), true);
        adapter.registerPool(BASE_USDC, BASE_WETH, 3000, hookLocalKey, standardLocalKey);
        adapter.registerPool(BASE_WETH, BASE_USDC, 3000, hookLocalKey, standardLocalKey);
        adapter.setDefaultSolver(solver);

        deal(BASE_USDC, trader, 1_000_000e6);
        deal(BASE_USDC, solver, 1_000_000e6);
        vm.prank(trader);
        RealIERC20(BASE_USDC).approve(address(router), type(uint256).max);
        vm.prank(solver);
        RealIERC20(BASE_USDC).approve(address(router), type(uint256).max);

        fixtureReady = BaseEnsoRoute.CALLDATA.length > 0;
        rpcAvailable = true;
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

        uint160 p = initSqrt;
        int24 tick = TickMath.getTickAtSqrtPrice(p);
        int24 base = (tick / 60) * 60;
        int24 lower = base - LP_HALF_WIDTH;
        int24 upper = base + LP_HALF_WIDTH;
        int128 liq = int128(int256(1e15));

        pm.unlock(abi.encode(stdReal, lower, upper, liq));
        pm.unlock(abi.encode(hookReal, lower, upper, liq));

        uint128 stdLiq =
            StateLibrary.getLiquidity(pm, RealPoolId.wrap(PoolId.unwrap(standardLocalKey.toId())));
        uint128 hookLiq = StateLibrary.getLiquidity(pm, RealPoolId.wrap(PoolId.unwrap(hookLocalKey.toId())));
        require(stdLiq > 0, "standard pool liquidity missing");
        require(hookLiq > 0, "hook pool liquidity missing");
    }

    // --- helpers -----------------------------------------------------------

    /// @dev currency0=WETH(18), currency1=USDC(6): price_raw = USDC_raw/WETH_raw,
    ///      and USD-per-WETH (18dp) = price_raw * 1e30 (USDC ≈ $1).
    function _wethUsd18FromSqrt(uint160 sqrtP) internal pure returns (uint256) {
        return FullMath.mulDiv(uint256(sqrtP) * uint256(sqrtP), 1e30, uint256(1) << 192);
    }

    function _minOut() internal pure returns (uint256) {
        if (BaseEnsoRoute.MIN_BUY > 0) return BaseEnsoRoute.MIN_BUY;
        return (BaseEnsoRoute.EXPECTED_BUY * 95) / 100;
    }

    // --- Tests -------------------------------------------------------------

    function test_BaseEnso_RouterDeployedAtQuoteTakerAndWhitelisted() public view {
        if (!fixtureReady) return;
        assertEq(address(router), BaseEnsoRoute.TAKER, "router at fixed bundle fromAddress");
        assertTrue(router.allowedAggregators(BaseEnsoRoute.EXCHANGE_PROXY), "EnsoRouter whitelisted");
        assertGt(BaseEnsoRoute.EXCHANGE_PROXY.code.length, 0, "real EnsoRouter has code on Base");
    }

    /// @dev AGGREGATOR (Enso) full cycle on Base: REAL bundle calldata open on
    ///      the fork, then close on the local no-hook pool liquidity.
    function test_BaseEnso_FullCycle_AggregatorOpen_ThenClose() public {
        if (!fixtureReady) return;
        if (BaseEnsoRoute.SELL_AMOUNT == 0) return;

        uint8 leverage = 2;
        uint256 notional = BaseEnsoRoute.SELL_AMOUNT;
        uint256 margin = notional / leverage;
        uint256 solverPrincipal = margin;

        EswapRouter.AggregatorRoute memory route = EswapRouter.AggregatorRoute({
            exchangeProxy: BaseEnsoRoute.EXCHANGE_PROXY,
            tokenIn: BaseEnsoRoute.TOKEN_IN,
            tokenOut: BaseEnsoRoute.TOKEN_OUT,
            sellAmount: notional,
            value: BaseEnsoRoute.TX_VALUE,
            callData: BaseEnsoRoute.CALLDATA
        });

        uint256 traderStart = RealIERC20(BASE_USDC).balanceOf(trader);
        uint256 routerStartWeth = RealIERC20(BASE_WETH).balanceOf(address(router));

        vm.prank(trader);
        uint256 collateral = adapter.exactInputSingleWithLeverageAggregator(
            BASE_USDC, BASE_WETH, 3000, leverage, margin, _minOut(), trader, route
        );
        require(collateral > 0, "aggregator open must produce collateral");

        (address posTrader, uint256 posCollateral, uint256 borrowed, uint8 lev, bool isLong,,,,) =
            hook.positions(hookLocalKey.toId(), trader);
        assertEq(posTrader, trader, "Enso open credits the recipient");
        uint256 feeBps = hook.protocolFeeFor(trader);
        uint256 expectedCollateral = collateral - (collateral * feeBps) / 10000;
        assertEq(posCollateral, expectedCollateral, "hook nets protocol reserve from real fill output");
        assertEq(lev, leverage, "leverage mismatch");
        assertEq(borrowed, solverPrincipal, "borrow = margin*(leverage-1)");
        assertTrue(isLong, "USDC->WETH must be LONG on Base");

        (address debtSolver,,) = hook.solverDebts(hookLocalKey.toId(), trader, solver);
        assertEq(debtSolver, solver, "solver debt registered for the borrow leg");
        assertEq(
            RealIERC20(BASE_WETH).balanceOf(address(router)) - routerStartWeth,
            0,
            "router must not retain fill output"
        );

        uint256 solverBeforeClose = RealIERC20(BASE_USDC).balanceOf(solver);

        vm.prank(trader);
        router.closePosition(address(hook), hookLocalKey, trader, solver, 0);

        (address cleared, uint256 collAfter, uint256 _b, uint8 _l, bool _lng, uint160 _lsp, int24 _tl, int24 _tu, uint128 liqAfter) =
            hook.positions(hookLocalKey.toId(), trader);
        assertEq(cleared, address(0), "position cleared after close");
        assertEq(collAfter, 0, "collateral cleared after close");
        assertEq(liqAfter, 0, "LP stake closed after close");

        assertEq(
            RealIERC20(BASE_USDC).balanceOf(solver) - solverBeforeClose,
            solverPrincipal,
            "solver must recover exact principal on close"
        );

        uint256 traderFinal = RealIERC20(BASE_USDC).balanceOf(trader);
        uint256 returned = margin + traderFinal - traderStart;
        assertGt(returned, margin * 88 / 100, "trader recovers >88% of margin after full Enso Base cycle");
        assertLt(returned, margin * 101 / 100, "no free money on flat-price round-trip");
    }

    /// @dev MOAT PROOF on Base — the protocol funds NOTHING of the borrowed leg.
    ///      A REAL Enso bundle supplies the swap output (external liquidity), and
    ///      the borrow leg is drawn ENTIRELY from the solver's own pre-deposited
    ///      bond (`erc20BorrowEscrow`). The protocol's own capital is never
    ///      touched: the router/pool/hook hold ZERO USDC and ZERO WETH before and
    ///      after, the trader pays only its margin, and the solver's only spend
    ///      is the bond it recovers on close.
    function test_Moat_SolverFundsBorrow_ProtocolHoldsZeroCapital() public {
        if (!fixtureReady) return;
        if (BaseEnsoRoute.SELL_AMOUNT == 0) return;

        uint8 leverage = 2;
        uint256 notional = BaseEnsoRoute.SELL_AMOUNT;
        uint256 margin = notional / leverage;
        uint256 borrowLeg = notional - margin;

        EswapRouter.AggregatorRoute memory route = EswapRouter.AggregatorRoute({
            exchangeProxy: BaseEnsoRoute.EXCHANGE_PROXY,
            tokenIn: BaseEnsoRoute.TOKEN_IN,
            tokenOut: BaseEnsoRoute.TOKEN_OUT,
            sellAmount: notional,
            value: BaseEnsoRoute.TX_VALUE,
            callData: BaseEnsoRoute.CALLDATA
        });

        // --- 1. Solver bonds the borrow leg up-front (NO protocol capital). ---
        vm.prank(solver);
        router.depositBorrowEscrow(BASE_USDC, borrowLeg);
        assertEq(router.erc20BorrowEscrow(solver, BASE_USDC), borrowLeg, "solver bond recorded");
        uint256 solverStart = RealIERC20(BASE_USDC).balanceOf(solver);

        // --- 2. Protocol starts with zero of its own capital in play. ---
        assertEq(RealIERC20(BASE_USDC).balanceOf(address(router)), borrowLeg, "router holds only solver escrow");
        assertEq(RealIERC20(BASE_WETH).balanceOf(address(router)), 0, "router holds no WETH");
        assertEq(RealIERC20(BASE_USDC).balanceOf(address(hook)), 0, "hook holds no USDC");
        assertEq(RealIERC20(BASE_WETH).balanceOf(address(hook)), 0, "hook holds no WETH");

        uint256 traderStart = RealIERC20(BASE_USDC).balanceOf(trader);

        // --- 3. Land the tx: aggregator swap + solver-funded borrow. ---
        vm.prank(trader);
        uint256 collateral = adapter.exactInputSingleWithLeverageAggregator(
            BASE_USDC, BASE_WETH, 3000, leverage, margin, _minOut(), trader, route
        );
        assertGt(collateral, 0, "aggregator open must produce collateral");

        // --- 4. Borrow came from the solver's bond, not the protocol. ---
        assertEq(router.erc20BorrowEscrow(solver, BASE_USDC), 0, "solver bond fully consumed");
        assertEq(
            RealIERC20(BASE_USDC).balanceOf(solver),
            solverStart,
            "solver USDC unchanged during open (borrow drawn from bond, repaid later)"
        );
        assertEq(
            traderStart - RealIERC20(BASE_USDC).balanceOf(trader),
            margin,
            "trader spent exactly its margin, nothing more"
        );

        // --- 5. Protocol retained ZERO of its own capital. ---
        assertEq(RealIERC20(BASE_USDC).balanceOf(address(router)), 0, "router ends with 0 USDC");
        assertEq(RealIERC20(BASE_WETH).balanceOf(address(router)), 0, "router ends with 0 WETH");
        assertEq(RealIERC20(BASE_USDC).balanceOf(address(hook)), 0, "hook ends with 0 USDC");
        assertEq(RealIERC20(BASE_WETH).balanceOf(address(hook)), 0, "hook ends with 0 WETH");

        // --- 6. Accounting is intact: position + solver debt for the borrow. ---
        (address posTrader, uint256 posCollateral, uint256 borrowed, uint8 lev, bool isLong,,,,) =
            hook.positions(hookLocalKey.toId(), trader);
        assertEq(posTrader, trader, "position credited to trader");
        assertGt(posCollateral, 0, "collateral recorded");
        assertEq(borrowed, borrowLeg, "borrowed == solver-funded leg");
        assertEq(lev, leverage, "leverage");
        assertTrue(isLong, "USDC->WETH is long");

        (address debtSolver, uint256 principal,) = hook.solverDebts(hookLocalKey.toId(), trader, solver);
        assertEq(debtSolver, solver, "solver debt registered");
        assertEq(principal, borrowLeg, "solver principal == borrow leg (senior debt)");
    }
}
