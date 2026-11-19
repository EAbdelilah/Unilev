// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {EswapRouter} from "../../src/v4/EswapRouter.sol";
import {EswapMarginHook} from "../../src/v4/EswapMarginHook.sol";
import {EswapTimelock} from "../../src/v4/EswapTimelock.sol";
import {PriceFeed} from "../../src/v4/PriceFeed.sol";
import {PoolKey} from "../../src/v4/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "../../src/v4/types/PoolId.sol";
import {Currency} from "../../src/v4/types/Currency.sol";

import {EswapMarginVenueAdapter} from "../src/adapters/EswapMarginVenueAdapter.sol";
import {EswapEnsoAdapter} from "../integrations/enso/EswapEnsoAdapter.sol";
import {EswapSolverSettlementAdapter} from "../src/solvers/EswapSolverSettlementAdapter.sol";

import {IPoolManager as RealIPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey as RealPoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency as RealCurrency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolId as RealPoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";
import {TickMath as CoreTickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {TickMath as EswapTickMath} from "../../src/v4/libraries/TickMath.sol";
import {AggregatorV3Interface} from "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

interface IHookPositionState {
    function positionSolver(bytes32 poolId, address trader) external view returns (address);
}

/// @notice Base-mainnet fork coverage for the public MIT integration suite.
/// @dev Uses the REAL deployed router/hook/pools/tokens. No ERC-20 mocks are
///      created; cheatcodes only fund accounts and impersonate timelock admin.
contract MarginAdaptersForkTest is Test {
    using PoolIdLibrary for PoolKey;

    address constant BASE_PM = 0x498581fF718922c3f8e6A244956aF099B2652b2b;
    address constant HOOK_ADDR = 0x7b3F232BB5a0346fADb8B92B31B3e7bC60bD90c8;
    address constant ROUTER_ADDR = 0x5b226aE5158de86f1E616875dBab886870B9aAd9;
    address constant TIMELOCK_ADDR = 0x9aA2e9e2FB4cfC71a89F03b88Abf6116d8B1138e;
    address constant PRICE_FEED_ADDR = 0x91d75C7f750510C04516fC4dcEB5737E5B170c02;

    address constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address constant WETH = 0x4200000000000000000000000000000000000006;
    address constant CBBTC = 0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf;
    address constant CBBTC_USD_FEED = 0x07DA0E54543a844a80ABE69c8A12F22B3aA59f9D;

    uint256 constant CBBTC_ETA = 1_795_195_136;
    /// @dev Deterministic fork timestamp strictly AFTER the cbBTC ETA.
    uint256 constant CBBTC_WARP_TS = 1_795_195_200;

    EswapRouter router;
    EswapMarginHook hook;
    EswapTimelock timelock;
    PriceFeed priceFeed;
    RealIPoolManager pm;

    EswapMarginVenueAdapter venue;
    EswapEnsoAdapter enso;
    EswapSolverSettlementAdapter solverFacade;

    bool forkReady;
    bool cbBtcWarped;
    uint256 originalTs;

    function setUp() public {
        string memory rpcUrl = vm.envOr("BASE_RPC_URL", string("https://mainnet.base.org"));
        if (bytes(rpcUrl).length == 0) return;
        vm.createSelectFork(rpcUrl);
        if (block.chainid != 8453) return;
        if (HOOK_ADDR.code.length == 0 || ROUTER_ADDR.code.length == 0 || BASE_PM.code.length == 0) return;

        originalTs = block.timestamp;
        router = EswapRouter(payable(ROUTER_ADDR));
        hook = EswapMarginHook(payable(HOOK_ADDR));
        timelock = EswapTimelock(TIMELOCK_ADDR);
        priceFeed = PriceFeed(PRICE_FEED_ADDR);
        pm = RealIPoolManager(BASE_PM);

        venue = new EswapMarginVenueAdapter();
        enso = new EswapEnsoAdapter();
        solverFacade = new EswapSolverSettlementAdapter();
        forkReady = true;
    }

    // ─── Venue adapter: WETH/USDC full cycle ────────────────────────────────

    function test_WethUsdcFiveXOpenCloseFeeAndZeroCarry() public {
        if (!forkReady) return;
        uint256 margin = 5e6;
        deal(USDC, address(this), 1_000e6);
        IERC20(USDC).approve(address(venue), type(uint256).max);

        uint256 feeBefore = hook.protocolFees(Currency.wrap(WETH));
        uint256 minOut = _minOut(_wethKey(), false, margin);
        vm.assume(minOut > 0);

        (bytes32 positionId, uint256 notional) =
            venue.openLeveragedPosition(USDC, WETH, margin, 50_000, minOut, hex"");

        assertEq(notional, margin * 5, "5x notional");
        assertGt(venue.lastBoughtAmount(), 0, "bought WETH");
        uint256 expectedFee = (venue.lastBoughtAmount() * venue.lastFeeBps()) / 10_000;
        assertEq(venue.lastFeeBps(), 10, "live default fee must be 10 bps");
        assertEq(venue.lastProtocolFeeUnits(), expectedFee, "adapter fee accounting");
        assertEq(
            hook.protocolFees(Currency.wrap(WETH)) - feeBefore,
            expectedFee,
            "protocolFees(WETH) delta must match bought-leg fee"
        );

        (,, uint256 fundingRateBps,) = venue.quoteMarginRoute(USDC, WETH, margin, 50_000);
        assertEq(fundingRateBps, 0, "zero carry");

        uint256 walletBefore = IERC20(USDC).balanceOf(address(this));
        uint256 payout = venue.closeLeveragedPosition(positionId, 0, hex"");
        assertEq(IERC20(USDC).balanceOf(address(this)) - walletBefore, payout, "payout forwarded");
        assertEq(IERC20(USDC).balanceOf(address(venue)), 0, "no USDC dust");
        assertEq(IERC20(WETH).balanceOf(address(venue)), 0, "no WETH dust");
        assertEq(IERC20(USDC).allowance(address(venue), ROUTER_ADDR), 0, "no router allowance");
        assertEq(router.erc20BorrowEscrow(address(venue), USDC), 0, "escrow fully consumed");
    }

    function test_InvalidPairAndLeverageRevert() public {
        if (!forkReady) return;
        vm.expectRevert(EswapMarginVenueAdapter.UnsupportedPair.selector);
        venue.quoteMarginRoute(USDC, address(0x000000000000000000000000000000000000dEaD), 1e6, 50_000);

        vm.expectRevert(EswapMarginVenueAdapter.InvalidLeverage.selector);
        venue.openLeveragedPosition(USDC, WETH, 1e6, 40_000, 0, hex"");
    }

    // ─── Enso shortcut execution ────────────────────────────────────────────

    function test_EnsoShortcutBuildsSelectorAndExecutes() public {
        if (!forkReady) return;
        uint256 margin = 5e6;
        deal(USDC, address(this), 1_000e6);
        IERC20(USDC).approve(address(enso), type(uint256).max);

        PoolKey memory key = _wethKey();
        uint256 minOut = _minOut(key, false, margin);
        EswapRouter.SwapParams memory params = EswapRouter.SwapParams({
            key: key,
            standardPoolKey: _wethStandardKey(),
            zeroForOne: false,
            amountSpecified: -int256(margin),
            leverage: 5,
            solver: address(enso),
            hookData: abi.encode(true, uint8(5), address(enso)),
            deadline: block.timestamp + router.DEFAULT_DEADLINE_SLACK(),
            minAmountOut: minOut
        });

        (address target, bytes4 selector,) = enso.buildShortcutCall(params);
        assertEq(target, ROUTER_ADDR, "terminal target is live router");
        assertEq(selector, bytes4(0x33046e31), "Enso registered selector");

        (bytes32 positionId, uint256 notional) = enso.executeShortcut(params, address(this), hex"", minOut);
        assertEq(notional, margin * 5);
        uint256 payout = enso.closeShortcut(positionId, 0);
        assertGt(payout, 0, "shortcut payout forwarded");
        assertEq(IERC20(USDC).allowance(address(enso), ROUTER_ADDR), 0, "no dangling allowance");
    }

    // ─── Anonymous solver escrow + intent fill ──────────────────────────────

    function test_AnonymousSolverEscrowFillAndYieldClaim() public {
        if (!forkReady) return;
        uint256 traderPk = 0xA11CE;
        address trader = vm.addr(traderPk);
        address solver = makeAddr("anonSolver");
        uint256 margin = 5e6;
        uint256 borrow = margin * 4;

        deal(USDC, trader, 1_000e6);
        deal(USDC, solver, 1_000e6);
        vm.prank(trader);
        IERC20(USDC).approve(ROUTER_ADDR, type(uint256).max);
        vm.prank(solver);
        IERC20(USDC).approve(address(solverFacade), type(uint256).max);
        vm.prank(solver);
        solverFacade.bondBorrow(USDC, borrow);

        PoolKey memory key = _wethKey();
        PoolKey memory std = _wethStandardKey();
        uint256 minOut = _minOut(key, false, margin);
        bytes32 poolId = PoolId.unwrap(key.toId());
        bytes32 stdPoolId = PoolId.unwrap(std.toId());

        EswapRouter.SwapParams memory params = EswapRouter.SwapParams({
            key: key,
            standardPoolKey: std,
            zeroForOne: false,
            amountSpecified: -int256(margin),
            leverage: 5,
            solver: address(solverFacade),
            hookData: abi.encode(true, uint8(5), trader),
            deadline: block.timestamp + router.DEFAULT_DEADLINE_SLACK(),
            minAmountOut: minOut
        });

        EswapRouter.LendingIntent memory intent = EswapRouter.LendingIntent({
            poolId: poolId,
            standardPoolId: stdPoolId,
            zeroForOne: false,
            amountSpecified: -int256(margin),
            leverage: 5,
            solver: address(solverFacade),
            deadline: params.deadline,
            minAmountOut: minOut,
            nonce: 1
        });

        bytes32 digest = solverFacade.intentDigest(intent);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(traderPk, digest);
        bytes memory signature = abi.encodePacked(r, s, v);

        vm.prank(solver);
        solverFacade.fillWithIntent(params, trader, intent, signature);

        assertEq(router.erc20BorrowEscrow(address(solverFacade), USDC), 0, "bond consumed");
        assertEq(solverFacade.bondCredit(solver, USDC), 0, "solver credit consumed");
        assertEq(
            IHookPositionState(HOOK_ADDR).positionSolver(poolId, trader),
            address(solverFacade),
            "solver is recorded yield recipient"
        );
        assertEq(solverFacade.yieldClaimant(keccak256(abi.encode(poolId, trader))), solver);

        vm.prank(trader);
        router.closePosition(HOOK_ADDR, key, trader, address(solverFacade), 0);

        vm.prank(solver);
        uint256 claimed = solverFacade.claimYield(USDC, poolId, trader);
        assertGt(claimed, 0, "solver claims 100% of LP yield + principal");
        assertEq(IERC20(USDC).allowance(address(solverFacade), ROUTER_ADDR), 0, "no dangling allowance");
    }

    // ─── cbBTC phase-2 route after timelock ETA ─────────────────────────────

    function test_CbBtcRouteAfterTimelockEta() public {
        if (!forkReady) return;
        _ensureCbBtcRegistered();
        assertTrue(cbBtcWarped || hook.isAuthorizedPool(_cbbtcKey().toId()), "ETA warp observed");
        assertEq(block.timestamp, CBBTC_WARP_TS, "fork clock warped to 1795195200");
        assertGt(block.timestamp, CBBTC_ETA, "past cbBTC phase-2 ETA 1795195136");

        PoolKey memory key = _cbbtcKey();
        assertEq(Currency.unwrap(key.currency0), USDC, "USDC must be currency0");
        assertEq(Currency.unwrap(key.currency1), CBBTC, "cbBTC must be currency1");
        assertTrue(hook.isAuthorizedPool(key.toId()), "cbBTC hook pool authorized");

        uint256 margin = 5e6;
        (uint256 out, uint256 feeUsdc, uint256 fundingRateBps,) =
            venue.quoteMarginRoute(USDC, CBBTC, margin, 50_000);
        assertGt(out, 0, "cbBTC 5x quote");
        assertEq(feeUsdc, 25_000, "25 USDC notional * 10 bps");
        assertEq(fundingRateBps, 0, "zero carry");
    }

    // ─── Helpers ────────────────────────────────────────────────────────────

    function _wethKey() internal pure returns (PoolKey memory) {
        return PoolKey({
            currency0: Currency.wrap(WETH),
            currency1: Currency.wrap(USDC),
            fee: 3000,
            tickSpacing: 60,
            hooks: HOOK_ADDR
        });
    }

    function _wethStandardKey() internal pure returns (PoolKey memory) {
        return PoolKey({
            currency0: Currency.wrap(WETH),
            currency1: Currency.wrap(USDC),
            fee: 500,
            tickSpacing: 10,
            hooks: address(0)
        });
    }

    function _cbbtcKey() internal pure returns (PoolKey memory) {
        return PoolKey({
            currency0: Currency.wrap(USDC),
            currency1: Currency.wrap(CBBTC),
            fee: 3000,
            tickSpacing: 60,
            hooks: HOOK_ADDR
        });
    }

    function _minOut(PoolKey memory key, bool zeroForOne, uint256 margin) internal view returns (uint256) {
        int128 q = router.quoteExactInput(key, zeroForOne, -int128(uint128(margin)), 5);
        return q > 0 ? uint256(uint128(q)) : 0;
    }

    function _ensureCbBtcRegistered() internal {
        PoolKey memory key = _cbbtcKey();
        PoolKey memory std = PoolKey({
            currency0: Currency.wrap(USDC),
            currency1: Currency.wrap(CBBTC),
            fee: 500,
            tickSpacing: 10,
            hooks: address(0)
        });

        if (!hook.isAuthorizedPool(key.toId())) {
            bytes memory data = abi.encodeCall(
                EswapMarginHook.registerTradingPair,
                (key, std, Currency.wrap(CBBTC), uint8(6), uint8(8))
            );
            uint256 eta = CBBTC_ETA > block.timestamp ? CBBTC_ETA : block.timestamp + timelock.delay() + 1 hours;
            bytes32 txHash = timelock.getTxHash(HOOK_ADDR, data, eta);
            if (!timelock.isQueued(txHash)) {
                vm.prank(timelock.admin());
                timelock.queue(HOOK_ADDR, data, eta);
            }
            // Exact post-ETA fork timestamp required by the public suite.
            uint256 targetTs = CBBTC_WARP_TS > eta ? CBBTC_WARP_TS : eta + 1;
            vm.warp(targetTs);
            cbBtcWarped = true;
            vm.prank(timelock.admin());
            timelock.execute(HOOK_ADDR, data, eta);
        } else {
            // A later fork may already have the phase-2 registration; still
            // pin the clock to the canonical post-ETA timestamp for quoting.
            vm.warp(CBBTC_WARP_TS);
            cbBtcWarped = true;
        }

        uint160 sqrt = _cbBtcOracleSqrt();
        _initializeIfNeeded(_cbbtcRealKey(3000, 60, HOOK_ADDR), sqrt);
        _initializeIfNeeded(_cbbtcRealKey(500, 10, address(0)), sqrt);
    }

    function _cbbtcRealKey(uint24 fee, int24 spacing, address hooks) internal pure returns (RealPoolKey memory) {
        return RealPoolKey({
            currency0: RealCurrency.wrap(USDC),
            currency1: RealCurrency.wrap(CBBTC),
            fee: fee,
            tickSpacing: spacing,
            hooks: IHooks(hooks)
        });
    }

    function _realId(RealPoolKey memory key) internal pure returns (RealPoolId) {
        return RealPoolId.wrap(keccak256(abi.encode(key.currency0, key.currency1, key.fee, key.tickSpacing, key.hooks)));
    }

    function _initializeIfNeeded(RealPoolKey memory key, uint160 sqrtPriceX96) internal {
        (uint160 slot0,,,) = StateLibrary.getSlot0(pm, _realId(key));
        if (slot0 == 0) pm.initialize(key, sqrtPriceX96);
    }

    function _cbBtcOracleSqrt() internal view returns (uint160) {
        uint256 price0 = priceFeed.getTwapPrice(USDC);
        (, int256 answer,, uint256 updatedAt,) = AggregatorV3Interface(CBBTC_USD_FEED).latestRoundData();
        uint8 feedDecimals = AggregatorV3Interface(CBBTC_USD_FEED).decimals();
        require(feedDecimals == 8, "feed decimals changed");
        require(price0 > 0 && answer > 0 && updatedAt > 0, "bad oracle answer");
        uint256 price1 = uint256(answer) * (10 ** (18 - feedDecimals));
        uint256 targetX192 = FullMath.mulDiv(
            price0 * (10 ** 8),
            uint256(1) << 192,
            price1 * (10 ** 6)
        );
        uint160 rawSqrt = uint160(Math.sqrt(targetX192));
        return EswapTickMath.getSqrtRatioAtTick(CoreTickMath.getTickAtSqrtPrice(rawSqrt));
    }
}
