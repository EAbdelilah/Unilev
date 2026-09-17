// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {EswapMarginHook} from "../EswapMarginHook.sol";
import {EswapRouter} from "../EswapRouter.sol";
import {IPoolManager} from "../interfaces/IPoolManager.sol";
import {PoolKey} from "../types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "../types/PoolId.sol";
import {Currency} from "../types/Currency.sol";
import {PriceFeedMock} from "./BaseV4Test.t.sol";

// REAL lib/v4-core types against the LIVE Ethereum mainnet PoolManager.
import {IPoolManager as RealIPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolId as RealPoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {PoolKey as RealPoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency as RealCurrency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks as RealIHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {IERC20 as RealIERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @dev [P2#7] Controlled aggregator fill venue: a whitelisted exchange proxy whose
///      fill output is CALLER-SET (`setOutputAmount`). It pulls `amountIn` of
///      `tokenIn` from the caller (the router, which force-approved it for the
///      notional) and pays exactly `outputAmount` of `tokenOut` back — so a test
///      can force the aggregator to beat, undercut, or equal the standard pool's
///      deterministic fill and assert which venue `swapMultiPoolBestRoute` chose.
contract MockAggregatorExchange {
    uint256 public outputAmount;
    uint256 public callCount;
    address public lastTokenIn;
    uint256 public lastAmountIn;

    function setOutputAmount(uint256 amount) external {
        outputAmount = amount;
    }

    /// @dev Realistic proxy ABI surface: the router executes `route.callData` on
    ///      the proxy as raw calldata, so this mimics an `execute(tokenIn,
    ///      amountIn, tokenOut)` aggregator entrypoint (0x/ParaSwap-style).
    function execute(address tokenIn, uint256 amountIn, address tokenOut) external returns (uint256) {
        callCount++;
        lastTokenIn = tokenIn;
        lastAmountIn = amountIn;
        RealIERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn);
        require(outputAmount > 0, "Mock: output not set");
        RealIERC20(tokenOut).transfer(msg.sender, outputAmount);
        return outputAmount;
    }
}

/// @notice [P2#7] BEST-ROUTE competition fork proof on Ethereum mainnet: the two
///         fill venues (deep standard pool vs a whitelisted aggregator) compete,
///         and the router must execute the venue guaranteeing the higher output —
///         trader is never worse than the standard-pool route.
///
///         The standard pool is the REAL mainnet 3000bp/60 USDC/WETH no-hook pool
///         (live slot0 price + seeded depth); the aggregator is the CONTROLLED
///         MockAggregatorExchange whose output the test sets, so the competition
///         is exercised deterministically in all three regimes:
///           1. standard estimate >= trader floor  -> STANDARD venue fills, the
///              aggregator is never touched.
///           2. trader floor > standard estimate   -> AGGREGATOR fills AND must
///              actually exceed the standard estimate (it does -> position opens
///              with the better output).
///           3. same as (2) but the aggregator ACTUALLY underdelivers below its
///              floor -> the fill reverts (`SwapOutputBelowMinimum`), so a lying
///              aggregator can never strand the trader on a worse fill.
///
///         Gating: requires ETH_MAINNET_RPC_URL; without it the suite skips.
contract EswapBestRouteForkTest is Test, IUnlockCallback {
    using PoolIdLibrary for PoolKey;

    address constant MAINNET_PM = 0x000000000004444c5dc75cB358380D2e3dE08A90;
    address constant MAINNET_USDC = 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48;
    address constant MAINNET_WETH = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;

    // Hook flags (deployCodeTo directly at a flags-matching address).
    uint160 constant HIGH_FLAGS = (1 << 159) | (1 << 158) | (1 << 153) | (1 << 152) | (1 << 148);
    uint160 constant LOW_FLAGS = (1 << 13) | (1 << 12) | (1 << 7) | (1 << 6) | (1 << 3);

    int24 constant LP_HALF_WIDTH = 2400;

    RealIPoolManager pm;
    EswapMarginHook hook;
    EswapRouter router;
    MockAggregatorExchange mock;
    PriceFeedMock priceFeed;

    PoolKey hookLocalKey;
    PoolKey standardLocalKey;

    address trader = makeAddr("bestRouteTrader");
    address solver = makeAddr("bestRouteSolver");

    uint8 constant LEVERAGE = 2;
    uint256 constant MARGIN = 1_000e6; // 1,000 USDC notional leg

    bool rpcAvailable;

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
            pm.sync(RealCurrency.wrap(MAINNET_USDC));
            RealIERC20(MAINNET_USDC).transfer(address(pm), uint256(-int256(delta.amount0())));
            pm.settle();
        } else if (delta.amount0() > 0) {
            pm.take(RealCurrency.wrap(MAINNET_USDC), address(this), uint256(uint128(delta.amount0())));
        }
        if (delta.amount1() < 0) {
            pm.sync(RealCurrency.wrap(MAINNET_WETH));
            RealIERC20(MAINNET_WETH).transfer(address(pm), uint256(-int256(delta.amount1())));
            pm.settle();
        } else if (delta.amount1() > 0) {
            pm.take(RealCurrency.wrap(MAINNET_WETH), address(this), uint256(uint128(delta.amount1())));
        }
        return bytes("");
    }

    function setUp() public {
        string memory rpcUrl = vm.envOr("ETH_MAINNET_RPC_URL", string(""));
        if (bytes(rpcUrl).length == 0) return;
        vm.createSelectFork(rpcUrl);
        _setupOnActiveFork();
    }

    function _setupOnActiveFork() internal {
        if (block.chainid != 1) return;
        if (MAINNET_PM.code.length == 0 || MAINNET_USDC.code.length == 0 || MAINNET_WETH.code.length == 0) return;

        pm = RealIPoolManager(MAINNET_PM);
        priceFeed = new PriceFeedMock();

        // Hook at flags-valid address; router and mock aggregator as fresh deploys.
        address hookAddr = address(uint160(HIGH_FLAGS | LOW_FLAGS));
        deployCodeTo(
            "EswapMarginHook.sol:EswapMarginHook", abi.encode(address(pm), address(priceFeed), address(this)), hookAddr
        );
        hook = EswapMarginHook(payable(hookAddr));
        router = new EswapRouter(IPoolManager(address(pm)));
        mock = new MockAggregatorExchange();

        hook.setRouterAndMinCollateralUsd(address(router), 0);
        router.setSolverWhitelist(solver, true);
        router.setAllowedAggregator(address(mock), true);

        hookLocalKey = PoolKey({
            currency0: Currency.wrap(MAINNET_USDC),
            currency1: Currency.wrap(MAINNET_WETH),
            fee: 3000,
            tickSpacing: 60,
            hooks: hookAddr
        });
        standardLocalKey = PoolKey({
            currency0: Currency.wrap(MAINNET_USDC),
            currency1: Currency.wrap(MAINNET_WETH),
            fee: 3000,
            tickSpacing: 60,
            hooks: address(0)
        });

        RealPoolKey memory stdReal = _realKey(3000, address(0));
        RealPoolKey memory hookReal = _realKey(3000, hookAddr);
        (uint160 stdSqrt,,,) = StateLibrary.getSlot0(pm, stdReal.toId());
        require(stdSqrt > 0, "real mainnet 3000/60 USDC/WETH pool must be initialized");
        (uint160 hookSqrt,,,) = StateLibrary.getSlot0(pm, hookReal.toId());
        if (hookSqrt == 0) {
            pm.initialize(hookReal, stdSqrt);
        }

        hook.setAuthorizedPool(hookLocalKey.toId(), true);
        hook.setStandardPoolKey(hookLocalKey.toId(), standardLocalKey);
        hook.setBaseCurrency(hookLocalKey.toId(), Currency.wrap(MAINNET_WETH));
        hook.setTokenDecimals(MAINNET_WETH, 18);
        hook.setTokenDecimals(MAINNET_USDC, 6);

        priceFeed.setPrice(MAINNET_USDC, 1e18);
        priceFeed.setPrice(MAINNET_WETH, _humanPriceBaseInQuote18());

        _seedLiquidity(stdReal, hookReal, stdSqrt);

        deal(MAINNET_USDC, trader, 1_000_000e6);
        deal(MAINNET_USDC, solver, 1_000_000e6);
        vm.prank(trader);
        RealIERC20(MAINNET_USDC).approve(address(router), type(uint256).max);
        vm.prank(solver);
        RealIERC20(MAINNET_USDC).approve(address(router), type(uint256).max);
        // The mock must hold the OUTPUT token to pay real fills.
        deal(MAINNET_WETH, address(mock), 100 ether);

        rpcAvailable = true;
    }

    function _realKey(uint24 fee, address hooks) internal view returns (RealPoolKey memory key) {
        key = RealPoolKey({
            currency0: RealCurrency.wrap(MAINNET_USDC),
            currency1: RealCurrency.wrap(MAINNET_WETH),
            fee: fee,
            tickSpacing: 60,
            hooks: RealIHooks(hooks)
        });
    }

    function _seedLiquidity(RealPoolKey memory stdReal, RealPoolKey memory hookReal, uint160 initSqrt) internal {
        deal(MAINNET_USDC, address(this), 2_000_000e6);
        deal(MAINNET_WETH, address(this), 4000 ether);
        RealIERC20(MAINNET_USDC).approve(address(pm), type(uint256).max);
        RealIERC20(MAINNET_WETH).approve(address(pm), type(uint256).max);

        uint160 p = initSqrt;
        int24 tick = TickMath.getTickAtSqrtPrice(p);
        int24 base = (tick / 60) * 60;
        int24 lower = base - LP_HALF_WIDTH;
        int24 upper = base + LP_HALF_WIDTH;
        int128 liq = int128(int256(1e15));

        pm.unlock(abi.encode(stdReal, lower, upper, liq));
        pm.unlock(abi.encode(hookReal, lower, upper, liq));
    }

    function _humanPriceBaseInQuote18() internal view returns (uint256) {
        RealPoolId stdRealId = RealPoolId.wrap(PoolId.unwrap(standardLocalKey.toId()));
        (uint160 sqrtP,,,) = StateLibrary.getSlot0(pm, stdRealId);
        require(sqrtP > 0, "standard pool uninitialized");
        return FullMath.mulDiv(1 << 192, 10 ** 30, uint256(sqrtP) * uint256(sqrtP));
    }

    // --- helpers -----------------------------------------------------------

    function _standardEstimate() internal view returns (uint256) {
        return uint256(uint128(router.quoteExactInput(hookLocalKey, true, -int128(int256(MARGIN)), LEVERAGE)));
    }

    function _buildParams(uint256 minAmountOut)
        internal
        view
        returns (EswapRouter.SwapParams memory params, EswapRouter.AggregatorRoute memory route)
    {
        uint256 notional = MARGIN * uint256(LEVERAGE);
        params = EswapRouter.SwapParams({
            key: hookLocalKey,
            standardPoolKey: standardLocalKey,
            zeroForOne: true,
            amountSpecified: -int256(MARGIN),
            leverage: LEVERAGE,
            solver: solver,
            hookData: bytes(""),
            deadline: block.timestamp + 600,
            minAmountOut: minAmountOut
        });
        route = EswapRouter.AggregatorRoute({
            exchangeProxy: address(mock),
            tokenIn: MAINNET_USDC,
            tokenOut: MAINNET_WETH,
            sellAmount: notional,
            value: 0,
            callData: abi.encodeCall(mock.execute, (MAINNET_USDC, notional, MAINNET_WETH))
        });
    }

    function _readPosition()
        internal
        view
        returns (address posTrader, uint256 collateral, uint256 borrowed, uint8 lev, bool isLong)
    {
        (posTrader, collateral, borrowed, lev, isLong,,,,) = hook.positions(hookLocalKey.toId(), trader);
    }

    // --- Tests -------------------------------------------------------------

    /// @dev The standard pool already satisfies the trader's floor → the STANDARD
    ///      venue fills and the (whitelisted but weaker) aggregator is never
    ///      executed. A stale/predatory aggregator quote cannot force a worse fill.
    function test_BestRoute_StandardWins_AggregatorNeverTouched() public {
        if (!rpcAvailable) return;
        uint256 standardEst = _standardEstimate();
        // The aggregator "promises" (and would deliver) far less than the pool.
        mock.setOutputAmount(standardEst / 10);
        assertTrue(router.allowedAggregators(address(mock)), "mock whitelisted");

        (EswapRouter.SwapParams memory params, EswapRouter.AggregatorRoute memory route) = _buildParams(0);

        vm.prank(trader);
        router.swapMultiPoolBestRoute(params, trader, route);

        assertEq(mock.callCount(), 0, "aggregator must NOT be executed when standard satisfies the floor");
        (address posTrader, uint256 collateral, uint256 borrowed, uint8 lev, bool isLong) = _readPosition();
        assertEq(posTrader, trader, "position credits the trader");
        assertGt(collateral, 0, "standard fill produced collateral");
        assertEq(lev, LEVERAGE, "leverage mismatch");
        assertEq(borrowed, MARGIN * (uint256(LEVERAGE) - 1), "borrow = margin*(leverage-1)");
        assertTrue(isLong, "USDC->WETH must be LONG");
    }

    /// @dev The aggregator promises more than the standard pool can deliver and
    ///      ACTUALLY delivers it → the AGGREGATOR venue fills and the position
    ///      books the better output (proven against the standard estimate).
    function test_BestRoute_AggregatorWins_WhenItBeatsStandardEstimate() public {
        if (!rpcAvailable) return;
        uint256 standardEst = _standardEstimate();
        uint256 floor = (standardEst * 10050) / 10000; // trader demands +0.5% over standard
        uint256 aggOut = (standardEst * 10100) / 10000; // aggregator genuinely delivers +1%
        mock.setOutputAmount(aggOut);

        (EswapRouter.SwapParams memory params, EswapRouter.AggregatorRoute memory route) = _buildParams(floor);

        vm.prank(trader);
        router.swapMultiPoolBestRoute(params, trader, route);

        assertEq(mock.callCount(), 1, "aggregator must fill when it promises more than the standard venue");
        assertEq(mock.lastAmountIn(), MARGIN * uint256(LEVERAGE), "aggregator received the full notional");
        (address posTrader, uint256 collateral, uint256 borrowed, uint8 lev, bool isLong) = _readPosition();
        assertEq(posTrader, trader, "position credits the trader");
        uint256 feeBps = hook.protocolFeeFor(trader);
        uint256 expectedCollateral = aggOut - (aggOut * feeBps) / 10000;
        assertEq(collateral, expectedCollateral, "position books the (reserve-netted) aggregator output");
        assertGt(collateral, standardEst, "trader is strictly better than the standard-route fill");
        assertTrue(isLong, "USDC->WETH must be LONG");
        assertEq(borrowed, MARGIN * (uint256(LEVERAGE) - 1), "borrow = margin*(leverage-1)");
    }

    /// @dev The aggregator ONLY quoted a better price but actually underdelivers
    ///      below its floor (which sits above the standard estimate) → the whole
    ///      fill reverts instead of stranding the trader on a worse route. The
    ///      competition floor is structural: no persistent worse-than-standard fill.
    function test_BestRoute_AggregatorUnderdelivers_Reverts() public {
        if (!rpcAvailable) return;
        uint256 standardEst = _standardEstimate();
        uint256 floor = (standardEst * 10050) / 10000; // aggregator chosen (floor > standard estimate)
        uint256 aggOut = (standardEst * 9950) / 10000; // actually delivers LESS than the pool
        mock.setOutputAmount(aggOut);

        (EswapRouter.SwapParams memory params, EswapRouter.AggregatorRoute memory route) = _buildParams(floor);

        vm.expectRevert(
            abi.encodeWithSelector(EswapRouter.SwapOutputBelowMinimum.selector, aggOut, floor)
        );
        vm.prank(trader);
        router.swapMultiPoolBestRoute(params, trader, route);
    }
}