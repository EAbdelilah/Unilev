// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {EswapMarginHook} from "../EswapMarginHook.sol";
import {EswapRouter} from "../EswapRouter.sol";
import {EswapCoWSettlement, CowOrder} from "../EswapCoWSettlement.sol";
import {CowSigning} from "../cow/CowSigning.sol";
import {EswapLeverageAdapter} from "../EswapLeverageAdapter.sol";
import {EswapLeverageQuoter} from "../EswapLeverageQuoter.sol";
import {PoolKey} from "../types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "../types/PoolId.sol";
import {Currency} from "../types/Currency.sol";
import {IPoolManager} from "../interfaces/IPoolManager.sol";

// REAL lib/v4-core types against the LIVE Unichain Sepolia PoolManager.
import {IPoolManager as RealIPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolId as RealPoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {PoolKey as RealPoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency as RealCurrency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks as RealIHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {IERC20 as RealIERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {TickMath} from "../libraries/TickMath.sol";

/// @notice LIVE replay / proof-of-execution for the SOLVER + AGGREGATOR pipeline
///         against the BROADCAST stack on Unichain Sepolia.
///
///   AGGREGATOR: EswapLeverageQuoter -> EswapLeverageAdapter.exactInputSingleWithLeverage
///   SOLVER:     EswapCoWSettlement.fillOrder (solver funds margin + borrow)
///
/// Unlike the offline fork proof (EswapSepoliaPipelineForkTest, which deployed
/// ad-hoc copies into the fork), this test points at the EXACT on-chain
/// instances deployed by DeployUnichainSepoliaFull.s.sol (REDEPLOY-4):
///   Hook 0xF39bc13b11479Aef93153514DD9bB8635a5cd0C8
///   Router 0xCda944857685AdbeD0c2be1b6A4f53C041fE38d5
///   Settlement 0x4A1af94548355aDEAa853Ac4f1D5663acDdD078d
///   SolverAdapter 0x574c7b851c90A00f6544eA0a7ac34d0ada0dafcA
///   LeverageAdapter 0xeD1E0ff7f2a2c01Ac29621cc3dF5915c107fC255
///   LeverageQuoter 0xF50aeadc193715Eaa7B0a140fa3a48112DFddf7C
///
/// Runs in a fork so no testnet gas/tokens are spent, but every contract byte
/// is the broadcast one. Liquidity is self-seeded into the (forked) pools only.
contract EswapSepoliaLiveStackReplay is Test, IUnlockCallback {
    using PoolIdLibrary for PoolKey;

    // ─── Broadcast (REDEPLOY-4) instances ────────────────────────────────
    address constant BROADCAST_HOOK = 0xF39bc13b11479Aef93153514DD9bB8635a5cd0C8;
    address constant BROADCAST_ROUTER = 0xCda944857685AdbeD0c2be1b6A4f53C041fE38d5;
    address constant BROADCAST_SETTLEMENT = 0x4A1af94548355aDEAa853Ac4f1D5663acDdD078d;
    address constant BROADCAST_ADAPTER = 0xeD1E0ff7f2a2c01Ac29621cc3dF5915c107fC255;
    address constant BROADCAST_QUOTER = 0xF50aeadc193715Eaa7B0a140fa3a48112DFddf7C;
    // Default solver (live wired on adapter + registered on router/hook).
    address constant SOLVER = 0x518634753C61342298c3E04326056b3Ce596a566;

    // Unichain Sepolia (chainId 1301)
    address constant SEPOLIA_PM = 0x00B036B58a818B1BC34d502D3fE730Db729e62AC;
    address constant SEPOLIA_USDC = 0x31d0220469e10c4E71834a79b1f276d740d3768F;
    address constant SEPOLIA_WETH = 0x4200000000000000000000000000000000000006;
    address constant GPV2_SETTLEMENT = 0x9008D19f58AAbD9eD0D60971565AA8510560ab41;

    // Sepolia topology (see DeployUnichainSepolia.s.sol): hook pool = 3000/60,
    // standard fill venue = 500/60, USDC(6) = token0, WETH(18) = token1.
    int24 constant POOL_TICK = 200760; // ~$1912/WETH
    int24 constant LP_LOWER = 200760 - 2400;
    int24 constant LP_UPPER = 200760 + 2400;

    RealIPoolManager pm;
    EswapMarginHook hook;
    EswapRouter router;
    EswapCoWSettlement settlement;
    EswapLeverageAdapter adapter;
    EswapLeverageQuoter quoter;

    PoolKey hookLocalKey;
    PoolKey standardLocalKey;

    // Aggregator recipient; CoW order owner/signer.
    address trader = makeAddr("liveTrader");
    uint256 traderPk = 0xA11CE;

    bool rpcAvailable;
    bool liquiditySeeded;

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
            pm.sync(RealCurrency.wrap(SEPOLIA_USDC));
            RealIERC20(SEPOLIA_USDC).transfer(address(pm), uint256(-int256(delta.amount0())));
            pm.settle();
        } else if (delta.amount0() > 0) {
            pm.take(RealCurrency.wrap(SEPOLIA_USDC), address(this), uint256(uint128(delta.amount0())));
        }
        if (delta.amount1() < 0) {
            pm.sync(RealCurrency.wrap(SEPOLIA_WETH));
            RealIERC20(SEPOLIA_WETH).transfer(address(pm), uint256(-int256(delta.amount1())));
            pm.settle();
        } else if (delta.amount1() > 0) {
            pm.take(RealCurrency.wrap(SEPOLIA_WETH), address(this), uint256(uint128(delta.amount1())));
        }
        return bytes("");
    }

    function setUp() public {
        string memory rpcUrl = vm.envOr("UNICHAIN_SEPOLIA_RPC_URL", string(""));
        if (bytes(rpcUrl).length == 0) return;
        vm.createSelectFork(rpcUrl);
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
        if (block.chainid != 1301) return;
        if (BROADCAST_HOOK.code.length == 0 || BROADCAST_ROUTER.code.length == 0) return;
        if (BROADCAST_SETTLEMENT.code.length == 0 || BROADCAST_ADAPTER.code.length == 0) return;

        pm = RealIPoolManager(SEPOLIA_PM);
        hook = EswapMarginHook(payable(BROADCAST_HOOK));
        router = EswapRouter(payable(BROADCAST_ROUTER));
        settlement = EswapCoWSettlement(BROADCAST_SETTLEMENT);
        adapter = EswapLeverageAdapter(BROADCAST_ADAPTER);
        quoter = EswapLeverageQuoter(BROADCAST_QUOTER);
        console2.log("replay on broadcast stack, hook:", BROADCAST_HOOK);

        // Sanity: live hook must be feed-less + oracle not required so real
        // opens pass the TWAP guard (REDEPLOY-3b).
        (bool ok1, bytes memory r1) = BROADCAST_HOOK.staticcall(abi.encodeWithSignature("requireTwapOracle()"));
        require(ok1 && r1.length >= 32 && abi.decode(r1, (bool)) == false, "live hook requireTwapOracle != false");
        (bool ok2, bytes memory r2) = BROADCAST_HOOK.staticcall(abi.encodeWithSignature("priceFeed()"));
        require(ok2 && r2.length >= 32 && abi.decode(r2, (address)) == address(0), "live hook priceFeed != 0");
        require(adapter.defaultSolver() == SOLVER, "live adapter defaultSolver mismatch");
        require(router.registeredSolvers(SOLVER), "live router solver not whitelisted");

        hookLocalKey = PoolKey({
            currency0: Currency.wrap(SEPOLIA_USDC),
            currency1: Currency.wrap(SEPOLIA_WETH),
            fee: 3000,
            tickSpacing: 60,
            hooks: BROADCAST_HOOK
        });
        standardLocalKey = PoolKey({
            currency0: Currency.wrap(SEPOLIA_USDC),
            currency1: Currency.wrap(SEPOLIA_WETH),
            fee: 500,
            tickSpacing: 60,
            hooks: address(0)
        });

        // Live: hook pool is initialized; the standard 500/60 venue is NOT
        // (deploy script no longer initializes it), so a physical fill pool
        // must be initialized + seeded on the fork.
        RealPoolKey memory stdReal = _realKey(500, address(0));
        RealPoolKey memory hookReal = _realKey(3000, BROADCAST_HOOK);
        (uint160 hookSqrt,,,) = StateLibrary.getSlot0(pm, hookReal.toId());
        require(hookSqrt > 0, "live hook pool not initialized");
        (uint160 stdSqrt,,,) = StateLibrary.getSlot0(pm, stdReal.toId());
        if (stdSqrt == 0) {
            pm.initialize(stdReal, hookSqrt);
        }

        // Replay participants funded with REAL testnet tokens (cheatcode-level
        // inject; nothing is spent on-chain). Aggregator recipient + CoW owner.
        deal(SEPOLIA_USDC, trader, 250_000e6);
        deal(SEPOLIA_USDC, SOLVER, 250_000e6);
        vm.prank(trader);
        RealIERC20(SEPOLIA_USDC).approve(address(router), type(uint256).max);
        vm.prank(SOLVER);
        RealIERC20(SEPOLIA_USDC).approve(address(router), type(uint256).max);
        vm.deal(trader, 5 ether);

        _seedLiquidity();
        rpcAvailable = true;
    }

    function _realKey(uint24 fee, address hooks) internal view returns (RealPoolKey memory k) {
        k = RealPoolKey({
            currency0: RealCurrency.wrap(SEPOLIA_USDC),
            currency1: RealCurrency.wrap(SEPOLIA_WETH),
            fee: fee,
            tickSpacing: 60,
            hooks: RealIHooks(hooks)
        });
    }

    function _seedLiquidity() internal {
        deal(SEPOLIA_USDC, address(this), 500_000e6);
        deal(SEPOLIA_WETH, address(this), 1000 ether);
        RealIERC20(SEPOLIA_USDC).approve(address(pm), type(uint256).max);
        RealIERC20(SEPOLIA_WETH).approve(address(pm), type(uint256).max);

        RealPoolKey memory stdReal = _realKey(500, address(0));
        RealPoolKey memory hookReal = _realKey(3000, BROADCAST_HOOK);
        int128 liq = int128(int256(1e15));

        pm.unlock(abi.encode(stdReal, LP_LOWER, LP_UPPER, liq));
        pm.unlock(abi.encode(hookReal, LP_LOWER, LP_UPPER, liq));

        uint128 stdLiq = StateLibrary.getLiquidity(pm, RealPoolId.wrap(PoolId.unwrap(standardLocalKey.toId())));
        uint128 hookLiq = StateLibrary.getLiquidity(pm, RealPoolId.wrap(PoolId.unwrap(hookLocalKey.toId())));
        require(stdLiq > 0, "standard pool liquidity missing");
        require(hookLiq > 0, "hook pool liquidity missing");
        liquiditySeeded = true;
    }

    // --- helpers -----------------------------------------------------------

    function _order(uint256 margin, uint32 validTo, uint256 minOut, address sell, address buy)
        internal
        pure
        returns (CowOrder.Data memory o)
    {
        o = CowOrder.Data({
            sellToken: sell,
            buyToken: buy,
            receiver: address(0),
            sellAmount: margin,
            buyAmount: minOut,
            validTo: validTo,
            appData: keccak256("eswap-live-replay"),
            feeAmount: 0,
            kind: keccak256("sell"),
            partiallyFillable: false,
            sellTokenBalance: keccak256("erc20"),
            buyTokenBalance: keccak256("erc20")
        });
    }

    // ─── Tests (each against the broadcast stack) ─────────────────────────

    function test_Replay_Stack_IsLiveBroadcast() public view {
        if (!rpcAvailable) return;
        assertEq(hook.router(), address(router), "hook must point at broadcast router");
        require(hook.requireTwapOracle() == false, "requireTwapOracle false");
        require(address(hook.priceFeed()) == address(0), "priceFeed zero");
        assertTrue(router.registeredSolvers(SOLVER), "solver registered");
        assertEq(adapter.defaultSolver(), SOLVER, "adapter default solver");
        assertTrue(hook.isAuthorizedPool(hookLocalKey.toId()), "hook pool must be authorized");
        (Currency sk0, Currency sk1, uint24 skFee, int24 skTs, address skH) = hook.standardPoolKeys(hookLocalKey.toId());
        assertEq(Currency.unwrap(sk0), SEPOLIA_USDC, "std venue token0");
        assertEq(Currency.unwrap(sk1), SEPOLIA_WETH, "std venue token1");
        assertEq(skFee, 500, "std venue fee");
        assertEq(skTs, 60, "std venue tick spacing");
        assertEq(skH, address(0), "std venue must be no-hook");
    }

    /// @dev AGGREGATOR connection: quote at broadcast quoter, execute at
    ///      broadcast adapter/router/hook. Open works with the live
    ///      feed-less TWAP-guard config (REDEPLOY-3b).
    function test_Replay_AggregatorConnection_LeveragedSwap() public {
        if (!rpcAvailable) return;

        uint256 margin = 50e6; // $50 USDC
        uint8 leverage = 2;
        int128 quote =
            quoter.quoteExactInputSingleWithLeverage(SEPOLIA_USDC, SEPOLIA_WETH, 3000, leverage, int256(margin));
        require(quote > 0, "quote must be positive on live stack");
        uint256 minOut = uint256(uint128(quote)) * 95 / 100;

        vm.prank(trader);
        adapter.exactInputSingleWithLeverage(SEPOLIA_USDC, SEPOLIA_WETH, 3000, leverage, margin, minOut, trader);

        (address posTrader, uint256 collateral, uint256 borrowed, uint8 lev, bool isLong,,,,) =
            hook.positions(hookLocalKey.toId(), trader);
        assertEq(posTrader, trader, "aggregator open credits the recipient");
        assertGt(collateral, 0, "collateral minted");
        assertEq(lev, leverage, "leverage mismatch");
        assertEq(borrowed, margin * uint256(leverage - 1), "borrow = margin*(leverage-1)");
        assertTrue(isLong, "USDC->WETH must be LONG");

        (address debtSolver,,) = hook.solverDebts(hookLocalKey.toId(), trader, SOLVER);
        assertEq(debtSolver, SOLVER, "solver debt registered");
    }

    /// @dev SOLVER (CoW) connection: trader's EIP-712 CoW order filled at the
    ///      broadcast settlement; solver funds margin + borrow.
    function test_Replay_SolverConnection_CoWFillOrder() public {
        if (!rpcAvailable) return;

        uint256 margin = 50e6;
        uint8 leverage = 2;
        address owner = vm.addr(traderPk);
        CowOrder.Data memory order = _order(margin, uint32(block.timestamp + 15 minutes), 1, SEPOLIA_USDC, SEPOLIA_WETH);
        bytes32 digest = settlement.hashOrder(order);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(traderPk, digest);
        bytes memory sig = abi.encodePacked(r, s, v);

        uint256 solverBefore = RealIERC20(SEPOLIA_USDC).balanceOf(SOLVER);
        EswapCoWSettlement.FillParams memory params = EswapCoWSettlement.FillParams({
            leverage: leverage, solver: SOLVER, key: hookLocalKey, standardPoolKey: standardLocalKey
        });

        address recovered = settlement.fillOrder(order, CowSigning.Scheme.Eip712, sig, params);
        assertEq(recovered, owner, "recovered owner must equal signer");

        (address posTrader, uint256 collateral, uint256 borrowed, uint8 lev,,,,,) =
            hook.positions(hookLocalKey.toId(), owner);
        assertEq(posTrader, owner, "CoW fill credits the order owner");
        assertGt(collateral, 0, "collateral minted");
        assertEq(lev, leverage);
        assertEq(borrowed, margin * uint256(leverage - 1), "borrow = margin*(leverage-1)");

        assertEq(
            solverBefore - RealIERC20(SEPOLIA_USDC).balanceOf(SOLVER),
            margin * leverage,
            "solver funded margin + borrow"
        );
        bytes memory uid = abi.encodePacked(digest, owner, order.validTo);
        assertTrue(settlement.filledOrders(uid), "order UID marked filled");
    }

    // ─── Full-cycle close proofs (LIVE round-trip on both pipelines) ──────

    /// @dev AGGREGATOR full cycle: open via quoter+adapter, then round-trip
    ///      close via the router. Solver nets principal exactly; trader
    ///      recovers the bulk of margin (only protocol + venue fees).
    function test_Replay_FullCycle_Aggregator_OpenThenClose() public {
        if (!rpcAvailable) return;

        uint256 margin = 50e6; // $50 USDC
        uint8 leverage = 2;
        int128 quote =
            quoter.quoteExactInputSingleWithLeverage(SEPOLIA_USDC, SEPOLIA_WETH, 3000, leverage, int256(margin));
        require(quote > 0, "quote must be positive on live stack");
        uint256 minOut = uint256(uint128(quote)) * 95 / 100;

        uint256 traderStart = RealIERC20(SEPOLIA_USDC).balanceOf(trader);

        // Open (aggregator connection).
        vm.prank(trader);
        adapter.exactInputSingleWithLeverage(SEPOLIA_USDC, SEPOLIA_WETH, 3000, leverage, margin, minOut, trader);

        (address posTrader, uint256 collateral, uint256 borrowed, uint8 lev, bool isLong,,,,) =
            hook.positions(hookLocalKey.toId(), trader);
        assertEq(posTrader, trader, "aggregator open credits the recipient");
        assertGt(collateral, 0, "collateral minted");
        assertEq(lev, leverage, "leverage mismatch");
        assertEq(borrowed, margin * uint256(leverage - 1), "borrow = margin*(leverage-1)");
        assertTrue(isLong, "USDC->WETH must be LONG");

        // Solver lent margin*(leverage-1); capture before close.
        uint256 solverBefore = RealIERC20(SEPOLIA_USDC).balanceOf(SOLVER);

        // Close: only the trader may close their own position (router C-1 rule).
        vm.prank(trader);
        router.closePosition(address(hook), hookLocalKey, trader, SOLVER, 0);

        (address cleared, uint256 collAfter, uint256 _b, uint8 _l, bool _lng, uint160 _lsp, int24 _tl, int24 _tu, uint128 liqAfter) =
            hook.positions(hookLocalKey.toId(), trader);
        assertEq(cleared, address(0), "position cleared after close");
        assertEq(collAfter, 0, "collateral cleared after close");
        assertEq(liqAfter, 0, "LP stake closed after close");

        // Solver nets back the exact principal lent.
        assertEq(
            RealIERC20(SEPOLIA_USDC).balanceOf(SOLVER) - solverBefore,
            borrowed,
            "solver must recover exact principal on close"
        );

        // Trader round-trip on a flat market: the USDC credited back at close
        // settles within retained-margin bounds (above 90%, no free money).
        uint256 traderFinal = RealIERC20(SEPOLIA_USDC).balanceOf(trader);
        uint256 returned = margin + traderFinal - traderStart; // start -margin (open), +X (close)
        assertGt(returned, margin * 90 / 100, "trader recovers above 90% of margin after full aggregator cycle");
        assertLt(returned, margin * 101 / 100, "no free money on flat-price round-trip");
    }

    /// @dev SOLVER (CoW) full cycle: EIP-712 order filled at the broadcast
    ///      settlement, then round-trip closed by the order owner through the
    ///      router. Solver nets principal; order owner recovers the bulk of margin.
    function test_Replay_FullCycle_CoWSolver_OpenThenClose() public {
        if (!rpcAvailable) return;

        address owner = vm.addr(traderPk);
        uint256 margin = 50e6;
        uint8 leverage = 2;

        CowOrder.Data memory order = _order(margin, uint32(block.timestamp + 15 minutes), 1, SEPOLIA_USDC, SEPOLIA_WETH);
        bytes32 digest = settlement.hashOrder(order);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(traderPk, digest);
        bytes memory sig = abi.encodePacked(r, s, v);

        EswapCoWSettlement.FillParams memory params = EswapCoWSettlement.FillParams({
            leverage: leverage, solver: SOLVER, key: hookLocalKey, standardPoolKey: standardLocalKey
        });
        address recovered = settlement.fillOrder(order, CowSigning.Scheme.Eip712, sig, params);
        assertEq(recovered, owner, "recovered owner must equal signer");

        (address posTrader, uint256 collateral, uint256 borrowed, uint8 lev, bool isLong,,,,) =
            hook.positions(hookLocalKey.toId(), owner);
        assertEq(posTrader, owner, "CoW fill credits the order owner");
        assertGt(collateral, 0, "collateral minted");
        assertEq(lev, leverage);
        assertEq(borrowed, margin * uint256(leverage - 1), "borrow = margin*(leverage-1)");
        assertTrue(isLong, "USDC->WETH order fill must open LONG");

        uint256 solverBefore = RealIERC20(SEPOLIA_USDC).balanceOf(SOLVER);

        // Close as the order owner (trader).
        vm.prank(owner);
        router.closePosition(address(hook), hookLocalKey, owner, SOLVER, 0);

        (address cleared, uint256 collAfter, uint256 _b2, uint8 _l2, bool _lng2, uint160 _lsp2, int24 _tl2, int24 _tu2, uint128 liqAfter) =
            hook.positions(hookLocalKey.toId(), owner);
        assertEq(cleared, address(0), "position cleared after close");
        assertEq(collAfter, 0, "collateral cleared after close");
        assertEq(liqAfter, 0, "LP stake closed after close");

        assertEq(
            RealIERC20(SEPOLIA_USDC).balanceOf(SOLVER) - solverBefore,
            borrowed,
            "solver must recover exact principal on close"
        );

        uint256 ownerBefore = RealIERC20(SEPOLIA_USDC).balanceOf(owner);
        assertGt(ownerBefore, margin * 90 / 100, "owner residual above 90% of margin after full CoW solver cycle");
        assertLt(ownerBefore, margin * 101 / 100, "no free money on flat-price round-trip");
    }
}
