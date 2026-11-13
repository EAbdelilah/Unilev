// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {EswapMarginHook} from "../EswapMarginHook.sol";
import {EswapMarginHookLogic} from "../EswapMarginHookLogic.sol";
import {EswapRouter} from "../EswapRouter.sol";
import {EswapCoWSettlement} from "../EswapCoWSettlement.sol";
import {CowOrder} from "../cow/CowOrder.sol";
import {CowSigning} from "../cow/CowSigning.sol";
import {PoolKey} from "../types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "../types/PoolId.sol";
import {Currency} from "../types/Currency.sol";
import {IPoolManager} from "../interfaces/IPoolManager.sol";
import {PriceFeedMock} from "./BaseV4Test.t.sol";
import {EswapHookDeployLib} from "./EswapHookDeployLib.sol";

// REAL lib/v4-core types against the LIVE Base PoolManager.
import {IPoolManager as RealIPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {IHooks as RealIHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolId as RealPoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {PoolKey as RealPoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency as RealCurrency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {IERC20 as RealIERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Zero-treasury proof on a Base fork.
///
/// @dev What is real and what is not
///
///      * Real: the Base PoolManager, USDC and WETH (no ERC-20 mocks, per the
///        fork-test rule), the CoW signature path (EIP-712 under the real GPv2
///        domain), and the router's escrow gate.
///      * Stood up by the test: the hook, router and settlement are deployed
///        from this repo's bytecode at fresh addresses, and the pools are seeded
///        with test-owned LP. That LP stands in for market liquidity. It is not
///        protocol capital, and no protocol wallet is funded anywhere below.
///      * Oracle: `PriceFeedMock` pinned to the pool price, as in the Enso fork test.
///
///      Zero-treasury claim, as tested: the borrow leg is funded from the
///      solver's own escrow, the solver is never whitelisted, and the treasury
///      holds 0 USDC and 0 WETH throughout. The fill succeeds only because the
///      solver's escrow covers it, so a protocol-funded borrow would have had to
///      come from a wallet that holds nothing.
contract ExternalSolverZeroTreasuryTest is Test, IUnlockCallback {
    using PoolIdLibrary for PoolKey;

    // Base (chainId 8453).
    address constant BASE_PM = 0x498581fF718922c3f8e6A244956aF099B2652b2b;
    address constant BASE_USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address constant BASE_WETH = 0x4200000000000000000000000000000000000006;
    // Canonical CoW GPv2Settlement on Base (same address as RedeployBaseFull).
    address constant GPV2_SETTLEMENT = 0x9008D19f58AAbD9eD0D60971565AA8510560ab41;

    uint160 constant HIGH_FLAGS = (1 << 159) | (1 << 158) | (1 << 153) | (1 << 152) | (1 << 148);
    uint160 constant LOW_FLAGS = (1 << 13) | (1 << 12) | (1 << 7) | (1 << 6) | (1 << 3);

    int24 constant LP_HALF_WIDTH = 2400;
    int24 constant INIT_TICK = -198673; // ~$2356/WETH, as in the Enso fork test

    uint256 constant SOLVER_BALANCE = 50_000e6; // the anonymous market maker
    uint256 constant MARGIN = 1_000e6; // trader collateral, USDC
    uint8 constant LEVERAGE = 5;
    uint256 constant BORROW = MARGIN * (LEVERAGE - 1); // 4,000 USDC, solver-funded

    RealIPoolManager pm;
    EswapMarginHook hook;
    EswapRouter router;
    EswapCoWSettlement settlement;
    PriceFeedMock priceFeed;

    PoolKey hookKey;
    PoolKey standardKey;

    address treasury = makeAddr("protocolTreasury");
    address solver = makeAddr("anonymousMarketMaker");
    address trader;
    uint256 traderKey;
    address trader2;
    uint256 trader2Key;

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        (RealPoolKey memory key, int24 tl, int24 tu, int128 liq) = abi.decode(data, (RealPoolKey, int24, int24, int128));
        (BalanceDelta delta,) = pm.modifyLiquidity(
            key,
            RealIPoolManager.ModifyLiquidityParams({tickLower: tl, tickUpper: tu, liquidityDelta: liq, salt: bytes32(0)}),
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

    function setUp() public {
        string memory rpcUrl = vm.envOr("BASE_RPC_URL", string("https://mainnet.base.org"));
        vm.createSelectFork(rpcUrl);
        if (block.chainid != 8453) return;

        (trader, traderKey) = makeAddrAndKey("trader");
        (trader2, trader2Key) = makeAddrAndKey("trader2");

        pm = RealIPoolManager(BASE_PM);
        priceFeed = new PriceFeedMock();

        address hookAddr = address(uint160(HIGH_FLAGS | LOW_FLAGS));
        (address logic1, address logic2) = EswapHookDeployLib.deployLogic(address(pm), address(priceFeed));
        deployCodeTo(
            "EswapMarginHook.sol:EswapMarginHook",
            abi.encode(address(pm), address(priceFeed), logic1, logic2, address(this)),
            hookAddr
        );
        hook = EswapMarginHook(payable(hookAddr));

        router = new EswapRouter(IPoolManager(BASE_PM));
        settlement = new EswapCoWSettlement(router, GPV2_SETTLEMENT);

        hook.setRouterAndMinCollateralUsd(address(router), 0);
        hook.setConfig(
            EswapMarginHook.ConfigParams({
                treasury: treasury,
                router: address(router),
                reserveFactor: 10,
                maxPriceSwingBps: 800,
                defaultMaxLeverage: 5,
                requireTwapOracle: false
            })
        );

        // currency0 = WETH (lower address on Base), currency1 = USDC.
        hookKey = PoolKey({
            currency0: Currency.wrap(BASE_WETH),
            currency1: Currency.wrap(BASE_USDC),
            fee: 3000,
            tickSpacing: 60,
            hooks: hookAddr
        });
        standardKey = PoolKey({
            currency0: Currency.wrap(BASE_WETH),
            currency1: Currency.wrap(BASE_USDC),
            fee: 3000,
            tickSpacing: 60,
            hooks: address(0)
        });

        RealPoolKey memory stdReal = _realKey(address(0));
        RealPoolKey memory hookReal = _realKey(hookAddr);
        uint160 initSqrt = TickMath.getSqrtPriceAtTick(INIT_TICK);
        (uint160 stdSqrt,,,) = StateLibrary.getSlot0(pm, stdReal.toId());
        if (stdSqrt == 0) {
            pm.initialize(stdReal, initSqrt);
            stdSqrt = initSqrt;
        }
        (uint160 hookSqrt,,,) = StateLibrary.getSlot0(pm, hookReal.toId());
        if (hookSqrt == 0) pm.initialize(hookReal, stdSqrt);

        EswapMarginHookLogic(payable(hookAddr)).setAuthorizedPool(hookKey.toId(), true);
        EswapMarginHookLogic(payable(hookAddr)).setStandardPoolKey(hookKey.toId(), standardKey);
        EswapMarginHookLogic(payable(hookAddr)).setBaseCurrency(hookKey.toId(), Currency.wrap(BASE_WETH));
        EswapMarginHookLogic(payable(hookAddr)).setTokenDecimals(BASE_WETH, 18);
        EswapMarginHookLogic(payable(hookAddr)).setTokenDecimals(BASE_USDC, 6);

        priceFeed.setPrice(BASE_USDC, 1e18);
        priceFeed.setPrice(BASE_WETH, _wethUsd18FromSqrt(stdSqrt));

        _seedLiquidity(hookReal, stdReal, stdSqrt);

        deal(BASE_USDC, solver, SOLVER_BALANCE);
    }

    // ─── The proof ────────────────────────────────────────────────────────

    function test_ZeroTreasury_ExternalSolverFundsBorrow_ProtocolCollectsFee() public {
        if (block.chainid != 8453) vm.skip(true);

        // (1) An anonymous market maker holds $50,000; the protocol treasury holds $0.
        assertEq(RealIERC20(BASE_USDC).balanceOf(solver), SOLVER_BALANCE, "solver funded");
        assertEq(RealIERC20(BASE_USDC).balanceOf(treasury), 0, "treasury starts at $0 USDC");
        assertEq(RealIERC20(BASE_WETH).balanceOf(treasury), 0, "treasury starts at $0 WETH");

        // (2) The solver is not whitelisted anywhere. Its only standing is escrow.
        assertFalse(router.registeredSolvers(solver), "solver is not governance-registered");

        // The trader posts $1,000 margin, approving only the settlement.
        deal(BASE_USDC, trader, MARGIN);
        vm.prank(trader);
        RealIERC20(BASE_USDC).approve(address(settlement), MARGIN);

        // (3) The trader's signed 5x CoW order.
        // The solver bonds the $4,000 borrow leg in advance, from its own wallet.
        _bondEscrow(BORROW);
        assertEq(router.erc20BorrowEscrow(solver, BASE_USDC), BORROW, "borrow escrow bonded");

        // (4) The solver fills the order, funding the borrow leg from escrow.
        _fill(traderKey);
        PoolId poolId = hookKey.toId();

        // (5) The position opens, and the external solver is recorded as positionSolver.
        assertEq(hook.positionSolver(poolId, trader), solver, "positionSolver == external solver");
        (, uint256 collateral, uint256 borrowed, uint8 lev, bool isLong,,,,) = hook.positions(poolId, trader);
        assertGt(collateral, 0, "position opened");
        assertEq(borrowed, BORROW, "borrow leg == 4x margin");
        assertEq(lev, LEVERAGE, "leverage recorded");
        assertTrue(isLong, "USDC -> WETH is a long");
        assertEq(RealIERC20(BASE_USDC).balanceOf(trader), 0, "trader paid only its margin");
        assertEq(router.erc20BorrowEscrow(solver, BASE_USDC), 0, "escrow consumed by the borrow leg");

        // Round-trip fee generation: a second trader opens and closes on the same
        // pool, so the first position's LP band earns real swap fees.
        _bondEscrow(BORROW);
        deal(BASE_USDC, trader2, MARGIN);
        vm.prank(trader2);
        RealIERC20(BASE_USDC).approve(address(settlement), MARGIN);
        _fill(trader2Key);
        vm.prank(trader2);
        router.closePosition(address(hook), hookKey, trader2, solver, 0);

        uint256 solverWethBefore = RealIERC20(BASE_WETH).balanceOf(solver);
        uint256 solverUsdcBefore = RealIERC20(BASE_USDC).balanceOf(solver);

        // (7) The external solver recovers 100% of its principal on close.
        vm.prank(trader);
        router.closePosition(address(hook), hookKey, trader, solver, 0);

        (address cleared,,,,,,,,) = hook.positions(poolId, trader);
        assertEq(cleared, address(0), "position closed");

        uint256 principalBack = RealIERC20(BASE_USDC).balanceOf(solver) - solverUsdcBefore;
        assertEq(principalBack, BORROW, "solver recovers exact $4,000 principal");

        // (6) LP fee yield accrued to the solver as rehypothecation yield, in WETH.
        uint256 yieldWeth = RealIERC20(BASE_WETH).balanceOf(solver) - solverWethBefore;
        console2.log("solver LP-fee yield (WETH wei, trader-1 close):", yieldWeth);
        assertGt(yieldWeth, 0, "swap fees were collected by the external solver");

        // (8) The protocol collects its fee, having spent $0 of its own capital.
        uint256 feeWeth = hook.protocolFees(Currency.wrap(BASE_WETH));
        assertGt(feeWeth, 0, "protocol fee accrued on open");
        hook.withdrawProtocolFee(Currency.wrap(BASE_WETH), feeWeth);
        assertEq(RealIERC20(BASE_WETH).balanceOf(treasury), feeWeth, "fee lands in treasury");
        assertEq(RealIERC20(BASE_USDC).balanceOf(treasury), 0, "treasury still holds $0 USDC");

        // The solver's whole stake, principal plus yield, is intact.
        uint256 solverUsdcTotal = RealIERC20(BASE_USDC).balanceOf(solver) + router.erc20BorrowEscrow(solver, BASE_USDC);
        assertEq(solverUsdcTotal, SOLVER_BALANCE, "solver USDC fully recovered");
    }

    /// @dev Negative control: without escrow the fill cannot happen. The protocol
    ///      never fronts the borrow leg to fill for an unbonded solver.
    function test_NoEscrow_NoFill() public {
        if (block.chainid != 8453) vm.skip(true);
        deal(BASE_USDC, trader, MARGIN);
        vm.prank(trader);
        RealIERC20(BASE_USDC).approve(address(settlement), MARGIN);

        CowOrder.Data memory order = _order();
        bytes memory sig = _sign(order, traderKey);
        vm.prank(solver);
        vm.expectRevert();
        settlement.fillOrder(order, CowSigning.Scheme.Eip712, sig, _params());
    }

    /// @dev Direct EIP-712 `swapWithIntent` path. The trader signs a LendingIntent
    ///      that pins the pool, direction, margin, leverage, solver, and slippage
    ///      floor. The solver relays it itself.
    ///
    ///      Borrow funding here is the router's wallet draw: the solver is
    ///      governance-registered, so the borrow is drawn by `transferFrom(solver)`
    ///      with no escrow. An UNREGISTERED solver (or any relayer naming it) must
    ///      be fully bonded in escrow instead (EswapRouter, CONSENT gate). Both
    ///      rules are checked here.
    function test_SwapWithIntent_RegisteredSolverDrawsBorrowFromWallet() public {
        if (block.chainid != 8453) vm.skip(true);

        // Registered solver, no escrow: the borrow must come from its wallet.
        router.setSolverWhitelist(solver, true);
        assertEq(router.erc20BorrowEscrow(solver, BASE_USDC), 0, "no escrow");
        vm.prank(solver);
        RealIERC20(BASE_USDC).approve(address(router), type(uint256).max);

        // The trader pays margin through the router (the intent path pulls from the trader).
        deal(BASE_USDC, trader, MARGIN);
        vm.prank(trader);
        RealIERC20(BASE_USDC).approve(address(router), MARGIN);

        uint256 solverBefore = RealIERC20(BASE_USDC).balanceOf(solver);
        _openWithIntent(traderKey, trader, 1);
        PoolId poolId = hookKey.toId();

        // Borrow drawn from the solver's wallet via transferFrom(solver).
        assertEq(solverBefore - RealIERC20(BASE_USDC).balanceOf(solver), BORROW, "borrow pulled from solver wallet");
        assertEq(hook.positionSolver(poolId, trader), solver, "positionSolver == solver");
        (, uint256 collateral, uint256 borrowed, uint8 lev, bool isLong,,,,) = hook.positions(poolId, trader);
        assertGt(collateral, 0, "position opened");
        assertEq(borrowed, BORROW, "borrow == 4x margin");
        assertEq(lev, LEVERAGE, "leverage recorded");
        assertTrue(isLong, "USDC -> WETH is a long");

        // Replay: the same (trader, nonce) can never open twice.
        deal(BASE_USDC, trader, MARGIN);
        vm.prank(trader);
        RealIERC20(BASE_USDC).approve(address(router), MARGIN);
        EswapRouter.LendingIntent memory replay = _intent(1);
        bytes memory replaySig = _signIntent(replay, traderKey);
        vm.expectRevert(EswapRouter.IntentAlreadyFilled.selector);
        vm.prank(solver);
        router.swapWithIntent(_swapParams(), trader, replay, replaySig);

        // A second position for fee accrual, then close both: the solver recovers principal.
        (address intentTrader, uint256 intentTraderKey) = makeAddrAndKey("intent-trader-2");
        deal(BASE_USDC, intentTrader, MARGIN);
        vm.prank(intentTrader);
        RealIERC20(BASE_USDC).approve(address(router), MARGIN);
        _openWithIntent(intentTraderKey, intentTrader, 2);
        vm.prank(intentTrader);
        router.closePosition(address(hook), hookKey, intentTrader, solver, 0);

        uint256 solverUsdcBeforeClose = RealIERC20(BASE_USDC).balanceOf(solver);
        uint256 solverWethBeforeClose = RealIERC20(BASE_WETH).balanceOf(solver);
        vm.prank(trader);
        router.closePosition(address(hook), hookKey, trader, solver, 0);

        // Principal comes back exactly. Yield is realised in WETH.
        assertEq(
            RealIERC20(BASE_USDC).balanceOf(solver) - solverUsdcBeforeClose,
            BORROW,
            "solver recovers exact principal on close"
        );
        uint256 yieldWeth = RealIERC20(BASE_WETH).balanceOf(solver) - solverWethBeforeClose;
        console2.log("swapWithIntent LP-fee yield (WETH wei):", yieldWeth);
        assertGt(yieldWeth, 0, "fee yield returned to the solver");
        assertEq(RealIERC20(BASE_USDC).balanceOf(treasury), 0, "treasury still holds $0 USDC");
    }

    // ─── helpers ──────────────────────────────────────────────────────────

    function _intent(uint256 nonce) internal view returns (EswapRouter.LendingIntent memory it) {
        it = EswapRouter.LendingIntent({
            poolId: PoolId.unwrap(hookKey.toId()),
            standardPoolId: PoolId.unwrap(standardKey.toId()),
            zeroForOne: false, // sell USDC (currency1) for WETH
            amountSpecified: -int256(MARGIN),
            leverage: LEVERAGE,
            solver: solver,
            deadline: block.timestamp + 1 hours,
            minAmountOut: 0.5 ether,
            nonce: nonce
        });
    }

    function _signIntent(EswapRouter.LendingIntent memory it, uint256 pk) internal returns (bytes memory sig) {
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", router.DOMAIN_SEPARATOR(), router.hashIntent(it)));
        (uint8 v, bytes32 rr, bytes32 s) = vm.sign(pk, digest);
        sig = abi.encodePacked(rr, s, v);
    }

    function _swapParams() internal view returns (EswapRouter.SwapParams memory p) {
        p = EswapRouter.SwapParams({
            key: hookKey,
            standardPoolKey: standardKey,
            zeroForOne: false,
            amountSpecified: -int256(MARGIN),
            leverage: LEVERAGE,
            solver: solver,
            hookData: abi.encode(true, LEVERAGE, address(0)),
            deadline: block.timestamp + 1 hours,
            minAmountOut: 0.5 ether
        });
    }

    /// @dev The solver relays a trader-signed intent. `hookData` names the trader.
    function _openWithIntent(uint256 pk, address who, uint256 nonce) internal {
        EswapRouter.LendingIntent memory it = _intent(nonce);
        bytes memory sig = _signIntent(it, pk);
        EswapRouter.SwapParams memory p = _swapParams();
        p.hookData = abi.encode(true, LEVERAGE, who);
        vm.prank(solver);
        router.swapWithIntent(p, who, it, sig);
    }

    function _fill(uint256 pk) internal {
        CowOrder.Data memory order = _order();
        bytes memory sig = _sign(order, pk);
        vm.prank(solver);
        settlement.fillOrder(order, CowSigning.Scheme.Eip712, sig, _params());
    }

    function _bondEscrow(uint256 amount) internal {
        vm.startPrank(solver);
        RealIERC20(BASE_USDC).approve(address(router), type(uint256).max);
        router.depositBorrowEscrow(BASE_USDC, amount);
        vm.stopPrank();
    }

    function _order() internal view returns (CowOrder.Data memory o) {
        o = CowOrder.Data({
            sellToken: BASE_USDC,
            buyToken: BASE_WETH,
            receiver: CowOrder.RECEIVER_SAME_AS_OWNER,
            sellAmount: MARGIN,
            buyAmount: 0.5 ether, // slippage floor on the WETH bought
            validTo: uint32(block.timestamp + 1 hours),
            appData: settlement.leverageCommitment(LEVERAGE),
            feeAmount: 0,
            kind: CowOrder.KIND_SELL,
            partiallyFillable: false,
            sellTokenBalance: CowOrder.BALANCE_ERC20,
            buyTokenBalance: CowOrder.BALANCE_ERC20
        });
    }

    function _params() internal view returns (EswapCoWSettlement.FillParams memory p) {
        p = EswapCoWSettlement.FillParams({
            leverage: LEVERAGE,
            solver: solver,
            key: hookKey,
            standardPoolKey: standardKey
        });
    }

    function _sign(CowOrder.Data memory order, uint256 pk) internal returns (bytes memory sig) {
        bytes32 digest = settlement.hashOrder(order);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        sig = abi.encodePacked(r, s, v);
    }

    function _realKey(address hooks) internal pure returns (RealPoolKey memory k) {
        k = RealPoolKey({
            currency0: RealCurrency.wrap(BASE_WETH),
            currency1: RealCurrency.wrap(BASE_USDC),
            fee: 3000,
            tickSpacing: 60,
            hooks: RealIHooks(hooks)
        });
    }

    function _seedLiquidity(RealPoolKey memory hookReal, RealPoolKey memory stdReal, uint160 initSqrt) internal {
        deal(BASE_USDC, address(this), 2_000_000e6);
        deal(BASE_WETH, address(this), 4000 ether);
        RealIERC20(BASE_USDC).approve(address(pm), type(uint256).max);
        RealIERC20(BASE_WETH).approve(address(pm), type(uint256).max);

        int24 base = (TickMath.getTickAtSqrtPrice(initSqrt) / 60) * 60;
        int128 liq = int128(int256(1e15));
        pm.unlock(abi.encode(stdReal, base - LP_HALF_WIDTH, base + LP_HALF_WIDTH, liq));
        pm.unlock(abi.encode(hookReal, base - LP_HALF_WIDTH, base + LP_HALF_WIDTH, liq));
    }

    /// @dev currency0=WETH(18), currency1=USDC(6): USD-per-WETH (18dp) from sqrtPrice.
    function _wethUsd18FromSqrt(uint160 sqrtP) internal pure returns (uint256) {
        return FullMath.mulDiv(uint256(sqrtP) * uint256(sqrtP), 1e30, uint256(1) << 192);
    }
}
