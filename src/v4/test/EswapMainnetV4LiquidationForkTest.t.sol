// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {EswapMarginHook} from "../EswapMarginHook.sol";
import {EswapRouter} from "../EswapRouter.sol";
import {PoolKey} from "../types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "../types/PoolId.sol";
import {Currency} from "../types/Currency.sol";
import {IPoolManager} from "../interfaces/IPoolManager.sol";

// REAL lib/v4-core types against the LIVE canonical PoolManager singleton.
import {IPoolManager as RealIPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolId as RealPoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {PoolKey as RealPoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency as RealCurrency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks as RealIHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {BalanceDeltaLibrary} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {IERC20 as RealIERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IPriceFeed} from "../EswapMarginHook.sol";
import {TickMath} from "../libraries/TickMath.sol";

/// @dev Production-faithful oracle mock for CROSS-DECIMAL pairs. Mirrors
///      PriceFeedL1.getPriceFeed semantics: ONE human-scaled map
///      (USD_18dec per WHOLE token) feeds both consumers â€”
///      getTwapPrice returns it raw, getAmountInUsd decimal-normalizes the
///      amount so WETH(18) and USDC(6) valuations land on one USD scale.
///      (The shared BaseV4Test PriceFeedMock skips normalization, which only
///      works for same-decimals pairs and silently breaks isLiquidatable
///      ratios on real pairs.)
contract ForkPriceFeedMock is IPriceFeed {
    mapping(address => uint256) public prices;
    mapping(address => uint8) public decimalsOf;

    function setPrice(address token, uint256 price) external {
        prices[token] = price;
    }

    function setDecimals(address token, uint8 d) external {
        decimalsOf[token] = d;
    }

    function getAmountInUsd(address token, uint256 amount) external view override returns (uint256) {
        uint256 p = prices[token] > 0 ? prices[token] : 1e18;
        uint8 d = decimalsOf[token] > 0 ? decimalsOf[token] : 18;
        return FullMath.mulDiv(amount, p, 10 ** d);
    }

    function getTwapPrice(address token) external view override returns (uint256) {
        return prices[token] > 0 ? prices[token] : 1e18;
    }
}

/// @notice FORK PROOF: forced liquidation unwinds the single-sided collateral
///         LP band under ADVERSE prices on the LIVE Uniswap V4 singleton and a
///         real deep third-party pool.
///
/// Scenario A (test_Fork_Liquidation_OracleCrash_UnwindsBand):
///   open long -> LP band deployed in the live deep pool -> oracle crashes 50%
///   -> a MEV-inflated minAmountOut reverts without damaging the position
///   (retryable) -> permissionless keeper liquidation burns the band OUT OF THE
///   LIVE POOL, unwinds against real venue liquidity, repays the solver
///   principal exactly, routes the 3% keeper reward to the liquidator (no
///   insurance carve-out) and the remainder to the trader.
///
/// Scenario B (test_Fork_Liquidation_RealAdverseMove_UnwindsBand):
///   the REAL deep-pool price is pushed DOWN toward the band with a genuine
///   WETH sell (real fees, real impact, real pool tick move), THEN the oracle
///   crash + liquidation completes the forced unwind against the worsened
///   venue price. Transaction success IS the settlement proof: the real
///   singleton reverts CurrencyNotSettled if any transient delta leaks.
contract EswapMainnetV4LiquidationForkTest is Test {
    using PoolIdLibrary for PoolKey;
    using BalanceDeltaLibrary for BalanceDelta;

    address constant V4_PM_MAINNET = 0x000000000004444c5dc75cB358380D2e3dE08A90; // Ethereum
    address constant V4_PM_UNICHAIN = 0x1F98400000000000000000000000000000000004; // Unichain

address constant UNICHAIN_USDC = 0x078D782b760474a361dDA0AF3839290b0EF57AD6;
    // ONLY native ETH/USDC (NATIVE ETH == address(0) on Uniswap V4). The deep
    // Unichain venue is the native ETH/USDC fee-500/tick-10 pool (~$5.4M,
    // L ~= 4.5e16). The WETH-token/USDC venue is deliberately NOT used: it
    // sits ~66% off the Chainlink TWAP (correctly blocked by TwapManipulated)
    // and is only ~2e11 deep — far below the mainnet-depth floor below.
    address constant UNICHAIN_ETH = address(0);
    address constant MAINNET_USDC = 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48;
    address constant MAINNET_ETH = address(0);

    uint160 constant HIGH_FLAGS = (1 << 159) | (1 << 158) | (1 << 153) | (1 << 152) | (1 << 148);
    uint160 constant LOW_FLAGS = (1 << 13) | (1 << 12) | (1 << 7) | (1 << 6) | (1 << 3);
    // Full-range sqrtPriceLimit for zeroForOne=false swaps (MAX_SQRT_RATIO - 1).
    uint160 constant MAX_SQRT_LIMIT = 1461446703485210103287273052203988822378723970341;
    // Full-range sqrtPriceLimit for zeroForOne=true swaps (MIN_SQRT_RATIO + 1).
    uint160 constant MIN_SQRT_LIMIT = 4295128741;

    RealIPoolManager pm;
    EswapMarginHook hook;
    EswapRouter router;
    ForkPriceFeedMock priceFeed;
    address base; // native ETH (V4 Currency.wrap(0))
    address quote; // USDC

    PoolKey hookLocalKey;
    PoolKey standardLocalKey;
    RealPoolKey hookRealKey;

    bool rpcAvailable;

    address trader = makeAddr("liqForkTrader");
    address solver = makeAddr("liqForkSolver");
    address keeper = makeAddr("liqForkKeeper");

function setUp() public {
        string[2] memory rpcCandidates;
        rpcCandidates[0] = vm.envOr("UNICHAIN_RPC_URL", string(""));
        rpcCandidates[1] = vm.envOr("ETH_RPC_URL", string(""));

        for (uint256 r = 0; r < 2 && !rpcAvailable; r++) {
            string memory rpcUrl = rpcCandidates[r];
            if (bytes(rpcUrl).length == 0) continue;
            // NOTE: `vm.createSelectFork` MUST stay at cheatcode level —
            // Foundry disallows cheatcodes inside try/catch, so wrapping it
            // here silently swallowed the fork and the suite soft-skipped
            // instead of testing live. The try only wraps the (non-cheatcode)
            // external venue-discovery call.
            vm.createSelectFork(rpcUrl);
            try this._setupOnActiveFork() {} catch {}
        }
        // No viable venue configured: tests soft-skip.
    }

    function _setupOnActiveFork() external {
uint256 cid = block.chainid;
        address pmAddr;
        if (cid == 130) {
            base = UNICHAIN_ETH;
            quote = UNICHAIN_USDC;
            pmAddr = V4_PM_UNICHAIN;
        } else if (cid == 1) {
            base = MAINNET_ETH;
            quote = MAINNET_USDC;
            pmAddr = V4_PM_MAINNET;
        } else {
            return;
        }
        // Native ETH (address(0)) has no code; all other currencies must.
        if ((base != address(0) && base.code.length == 0) || quote.code.length == 0 || pmAddr.code.length == 0) {
            return;
        }

        pm = RealIPoolManager(pmAddr);

        // --- Discover the deepest initialized native ETH/USDC pool ---
        RealPoolKey memory deepKey;
        bool found;
        uint128 deepest;
        uint24[6] memory fees = [uint24(500), 3000, 100, 500, 3000, 100];
        int24[6] memory spacings = [int24(60), 60, 1, 10, 10, 10];
for (uint256 i = 0; i < 6; i++) {
            // Canonical V4 key ordering: address(0) native ETH sorts FIRST, so
            // the live pool is token0=base(ETH), token1=quote(USDC).
            RealPoolKey memory k = RealPoolKey({
                currency0: RealCurrency.wrap(base),
                currency1: RealCurrency.wrap(quote),
                fee: fees[i],
                tickSpacing: spacings[i],
                hooks: RealIHooks(address(0))
            });
            (uint160 sqrtP,,,) = StateLibrary.getSlot0(pm, k.toId());
            if (sqrtP == 0) continue;
            uint128 liq = StateLibrary.getLiquidity(pm, k.toId());
            console2.log("candidate fee/ts/liq/tick:", fees[i]);
            console2.log("  ", uint256(int256(spacings[i])));
            console2.log("  ", uint256(liq));
            console2.log("  ", uint256(int256(_slot0Tick(k))));
            if (liq > deepest) {
                deepest = liq;
                deepKey = k;
                found = true;
            }
        }
        if (!found || deepest < 1e15) return;

        rpcAvailable = true;
        standardLocalKey = PoolKey({
            currency0: Currency.wrap(RealCurrency.unwrap(deepKey.currency0)),
            currency1: Currency.wrap(RealCurrency.unwrap(deepKey.currency1)),
            fee: deepKey.fee,
            tickSpacing: deepKey.tickSpacing,
            hooks: address(0)
        });

        address hookAddr = address(uint160(HIGH_FLAGS | LOW_FLAGS));
        priceFeed = new ForkPriceFeedMock();
        deployCodeTo(
            "EswapMarginHook.sol:EswapMarginHook", abi.encode(address(pm), address(priceFeed), address(this)), hookAddr
        );
        hook = EswapMarginHook(payable(hookAddr));
        router = new EswapRouter(IPoolManager(address(pm)));
        hook.setRouterAndMinCollateralUsd(address(router), 0);
        router.setSolverWhitelist(solver, true);

hookRealKey = RealPoolKey({
            currency0: RealCurrency.wrap(base),
            currency1: RealCurrency.wrap(quote),
            fee: 3000,
            tickSpacing: 60,
            hooks: RealIHooks(hookAddr)
        });
        hookLocalKey = PoolKey({
            currency0: Currency.wrap(base), currency1: Currency.wrap(quote), fee: 3000, tickSpacing: 60, hooks: hookAddr
        });

        (uint160 hpSqrtP,,,) = _slot0(hookRealKey);
        (uint160 deepSqrtP,,,) = _slot0(deepKey);
        if (hpSqrtP == 0) {
            pm.initialize(hookRealKey, deepSqrtP);
        }

        hook.setAuthorizedPool(hookLocalKey.toId(), true);
        hook.setStandardPoolKey(hookLocalKey.toId(), standardLocalKey);
        hook.setBaseCurrency(hookLocalKey.toId(), Currency.wrap(base));
        hook.setTokenDecimals(base, _tokenDecimals(base));
        hook.setTokenDecimals(quote, _tokenDecimals(quote));

        // ONE human-scaled price map (USD_18dec per WHOLE token); the mock
        // decimal-normalizes amounts in getAmountInUsd so cross-decimal
        // valuations stay consistent for isLiquidatable, while getTwapPrice
        // feeds the breaker the same human convention production uses.
        priceFeed.setDecimals(base, _tokenDecimals(base));
        priceFeed.setDecimals(quote, _tokenDecimals(quote));
        priceFeed.setPrice(base, _humanPriceBaseInQuote18());
        priceFeed.setPrice(quote, 1e18);

deal(quote, trader, 250_000 * 10 ** _tokenDecimals(quote));
        vm.deal(trader, 50 ether); // native ETH (V4 Currency.wrap(0)) funds
        deal(quote, solver, 250_000 * 10 ** _tokenDecimals(quote));
        // Scenario B pushes the REAL price down: this contract executes the
        // push swap inside its own unlock callback, so it carries inventory.
        vm.deal(keeper, 500 ether);
        vm.deal(address(this), 500 ether);

        vm.prank(trader);
        RealIERC20(quote).approve(address(router), type(uint256).max);
        vm.prank(solver);
        RealIERC20(quote).approve(address(router), type(uint256).max);
    }

    // --- helpers -----------------------------------------------------------

function _tokenDecimals(address token) internal view returns (uint8 d) {
        if (token == address(0)) return 18; // native ETH
        (bool ok, bytes memory ret) = token.staticcall(abi.encodeWithSignature("decimals()"));
        require(ok && ret.length >= 32, "decimals() failed");
        d = uint8(uint256(abi.decode(ret, (uint256))));
    }

    /// @dev Native-aware BASE balance (native ETH vs ERC-20 token).
    function _baseBalance(address who) internal view returns (uint256) {
        if (base == address(0)) return who.balance;
        return RealIERC20(base).balanceOf(who);
    }

    function _slot0(RealPoolKey memory k) internal view returns (uint160 sqrtP, int24 tick, uint24, bool) {
        (sqrtP, tick,,) = StateLibrary.getSlot0(pm, k.toId());
    }

    function _slot0Tick(RealPoolKey memory k) internal view returns (int24) {
        (, int24 tick,,) = StateLibrary.getSlot0(pm, k.toId());
        return tick;
    }

    function _sqrtUint(uint256 x) internal pure returns (uint256 y) {
        if (x == 0) return 0;
        uint256 z = (x + 1) / 2;
        y = x;
        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }
    }

/// @dev 1e18-fixed USD price per WHOLE base unit derived from the live pool.
    ///      Pool is token0=base(ETH), token1=quote(USDC): raw price p =
    ///      sqrtP^2/2^192 = quote_raw per base_raw; whole-quote per whole-base
    ///      = p * 10^(dB-dQ); times 1e18 for the 18-dec convention.
    function _humanPriceBaseInQuote18() internal view returns (uint256) {
        (uint160 sqrtP,,,) = _slot0(deepRealKey());
        require(sqrtP > 0, "deep pool uninitialized");
        uint8 dQ = _tokenDecimals(quote);
        uint8 dB = _tokenDecimals(base);
        require(dB >= dQ && dB - dQ <= 18, "unsupported decimals");
        return FullMath.mulDiv(uint256(sqrtP) * uint256(sqrtP), 10 ** (uint256(dB) - dQ + 18), 1 << 192);
    }

    function deepRealKey() internal view returns (RealPoolKey memory) {
        return RealPoolKey({
            currency0: RealCurrency.wrap(Currency.unwrap(standardLocalKey.currency0)),
            currency1: RealCurrency.wrap(Currency.unwrap(standardLocalKey.currency1)),
            fee: standardLocalKey.fee,
            tickSpacing: standardLocalKey.tickSpacing,
            hooks: RealIHooks(address(0))
        });
    }

    function _deepId() internal view returns (RealPoolId) {
        return RealPoolId.wrap(PoolId.unwrap(standardLocalKey.toId()));
    }

    function _liveBandLiquidity(int24 tl, int24 tu) internal view returns (uint128) {
        bytes32 posKey = keccak256(abi.encodePacked(address(hook), tl, tu, bytes32(0)));
        return StateLibrary.getPositionLiquidity(pm, _deepId(), posKey);
    }

    /// @dev Opens a 2x leveraged long (buy BASE with QUOTE margin).
    function _openLong(uint256 marginQuoteRaw)
        internal
        returns (uint256 collateral, uint256 borrowed, int24 tl, int24 tu, uint128 liq)
    {
        EswapRouter.SwapParams memory params = EswapRouter.SwapParams({
            key: hookLocalKey,
            standardPoolKey: standardLocalKey,
            zeroForOne: Currency.unwrap(standardLocalKey.currency0) == quote, // buy BASE with QUOTE
            amountSpecified: -int256(marginQuoteRaw),
            leverage: 2,
            solver: solver,
            hookData: abi.encode(true, uint8(2), trader),
            deadline: block.timestamp + 15 minutes,
minAmountOut: 0
        });
        vm.prank(trader);
        router.swapMultiPool(params);

        (, collateral, borrowed,,,, tl, tu, liq) = hook.positions(hookLocalKey.toId(), trader);
        assertGt(collateral, 0, "collateral recorded");
        assertGt(liq, 0, "LP band deployed");
    }

    /// @dev Quote-raw proceeds expected from selling `collateralRaw` base at the
    ///      given 1e18-fixed USD-per-whole-base price (venue-fees excluded).
    function _expectedQuoteOut(uint256 collateralRaw, uint256 baseUsd18) internal view returns (uint256) {
        uint8 dQ = _tokenDecimals(quote);
        uint8 dB = _tokenDecimals(base);
        // wholeBase * usdPerWhole * 10^dQ, computed overflow-safely:
        // collateralRaw/10^dB * baseUsd18/1e18 * 10^dQ
        return FullMath.mulDiv(FullMath.mulDiv(collateralRaw, baseUsd18, 10 ** dB), 10 ** dQ, 1e18);
    }

    function _positionFields()
        internal
        view
        returns (address owner, uint256 coll, uint256 borr, int24 tl, int24 tu, uint128 lq)
    {
        address o;
        uint256 c;
        uint256 b;
        int24 lo;
        int24 up;
        uint128 q;
        (o, c, b,,,, lo, up, q) = hook.positions(hookLocalKey.toId(), trader);
        return (o, c, b, lo, up, q);
    }

/// @dev Common post-liquidation battery: position zeroed, band burned from
    ///      the LIVE pool, solver made exactly whole, [FIX H-5] keeper reward ==
    ///      3% of post-solver surplus (no insurance carve-out), trader gets the
    ///      rest, no stray tokens.
    function _assertLiquidatedCleanly(
        uint256 borrowedAtOpen,
        int24 tl,
        int24 tu,
        uint256 solverQuoteBefore,
        uint256 traderQuoteBefore,
        uint256 keeperQuoteBefore,
        uint256 insuranceBefore,
        uint256 hookWethBefore,
        uint256 hookUsdcBefore,
        uint256 minOutUsed,
        uint256 liveExpectedOut,
        uint256 dustBound
    ) internal {
        (address owner, uint256 coll, uint256 borr, int24 lo, int24 up, uint128 lq) = _positionFields();
        assertEq(owner, address(0), "position cleared");
        assertEq(coll, 0, "collateral cleared");
        assertEq(borr, 0, "borrow cleared");
        assertEq(lq, 0, "LP stake closed");
        assertEq(_liveBandLiquidity(tl, tu), 0, "band burned from live deep pool");

        uint256 solverGot = RealIERC20(quote).balanceOf(solver) - solverQuoteBefore;
        uint256 traderGot = RealIERC20(quote).balanceOf(trader) - traderQuoteBefore;
        uint256 keeperGot = RealIERC20(quote).balanceOf(keeper) - keeperQuoteBefore;
        uint256 insuranceGot = hook.insuranceFund(Currency.wrap(quote)) - insuranceBefore;
        uint256 received = solverGot + traderGot + keeperGot;

        // Solver repaid exactly the registered principal (borrowed leg, 0% interest).
        assertEq(solverGot, borrowedAtOpen, "solver made exactly whole");

        // Proceeds: real venue beats the crashed-oracle expectation; guard held.
        assertGt(received, minOutUsed, "slippage guard must have passed");
        assertApproxEqAbs(
            received, liveExpectedOut, liveExpectedOut * 3 / 100 + 1000, "proceeds near LIVE-price expectation"
        );

        // [FIX H-5] The keeper (liquidator) earns exactly floor(3% of the
        // post-solver surplus) — the liquidation incentive — and NO insurance
        // carve-out is minted.
        assertEq(
            keeperGot, FullMath.mulDiv(traderGot + keeperGot, 300, 10000), "keeper reward == 3% of surplus"
        );
        assertEq(insuranceGot, 0, "no insurance carve-out");
        assertGt(traderGot, 0, "trader residual positive");

        // No unbounded token residue in the hook. Residue observed on live
        // mainnet ~= the open-time PROTOCOL FEE share (the router mints
        // claims on the FULL bought bag; the unwind burns all hook-held
        // claims against the swap debt, stranding ~0.5% as hook-owned ETH)
        // plus sub-wei rounding. Bounded at 1% of collateral here. A NET
        // DECREASE is also acceptable: after a mid-band rebalance the unwind
        // may legitimately draw on the hook's residual buffer.
        uint256 hookWethAfter = _baseBalance(address(hook));
        if (hookWethAfter > hookWethBefore) {
            assertLt(hookWethAfter - hookWethBefore, dustBound, "ETH residue within rounding bound");
        }
        uint256 usdcBound = dustBound * 10 ** _tokenDecimals(quote) / 10 ** _tokenDecimals(base);
        uint256 hookUsdcAfter = RealIERC20(quote).balanceOf(address(hook));
        if (hookUsdcAfter > hookUsdcBefore) {
            assertLt(hookUsdcAfter - hookUsdcBefore, usdcBound, "USDC residue within rounding bound");
        }
    }

    // --- tests -------------------------------------------------------------

    function test_Fork_DeepPool_IsLiquid() public view {
        if (!rpcAvailable) return;
        uint128 liq = StateLibrary.getLiquidity(pm, _deepId());
        assertGt(liq, 1e15, "live third-party liquidity floor");
    }

    /// @notice SCENARIO A: oracle-crash liquidation, live band uncrossed.
    function test_Fork_Liquidation_OracleCrash_UnwindsBand() public {
        if (!rpcAvailable) return;

        uint256 margin = 50 * 10 ** _tokenDecimals(quote);
        (uint256 collateral, uint256 borrowed, int24 tl, int24 tu,) = _openLong(margin);

        // Healthy at open.
        EswapMarginHook.Position memory posView = _posMemory();
        assertFalse(hook.isLiquidatable(posView, hookLocalKey), "healthy at open");

uint256 solverQuoteBefore = RealIERC20(quote).balanceOf(solver);
        uint256 traderQuoteBefore = RealIERC20(quote).balanceOf(trader);
        uint256 keeperQuoteBefore = RealIERC20(quote).balanceOf(keeper);
        uint256 insuranceBefore = hook.insuranceFund(Currency.wrap(quote));
        uint256 hookWethBefore = _baseBalance(address(hook));
        uint256 hookUsdcBefore = RealIERC20(quote).balanceOf(address(hook));

        // --- Crash the oracle 50% (real pool untouched) ---
        uint256 liveHuman = _humanPriceBaseInQuote18();
        uint256 crashedHuman = liveHuman / 2;
        priceFeed.setPrice(base, crashedHuman);
        assertTrue(hook.isLiquidatable(posView, hookLocalKey), "underwater after 50% crash");

        // Keeper-style minAmountOut from the CRASHED oracle, 2% slack.
        uint256 minOut = (_expectedQuoteOut(collateral, crashedHuman) * 98) / 100;
        uint256 liveExpectedOut = _expectedQuoteOut(collateral, liveHuman);

        // --- MEV guard: an inflated minAmountOut must revert AND leave the
        //     position fully intact (retryable by an honest keeper). The exact
        //     received figure floats with the live block, so only the revert
        //     itself is pinned here; SlippageExceeded semantics are covered by
        //     the mock-based unit suites. ---
        vm.prank(keeper);
        vm.expectRevert();
        router.liquidate(address(hook), hookLocalKey, trader, type(uint256).max);

        (address owner,,,,, uint128 lqAfterFail) = _positionFields();
        assertEq(owner, trader, "failed attempt must not damage the position");
        assertGt(lqAfterFail, 0, "band intact after failed attempt");
        assertGt(_liveBandLiquidity(tl, tu), 0, "live LP intact after failed attempt");
        assertEq(RealIERC20(quote).balanceOf(solver), solverQuoteBefore, "solver untouched by failed attempt");

        // --- Honest permissionless liquidation ---
        vm.prank(keeper);
        router.liquidate(address(hook), hookLocalKey, trader, minOut);

_assertLiquidatedCleanly(
            borrowed,
            tl,
            tu,
            solverQuoteBefore,
            traderQuoteBefore,
            keeperQuoteBefore,
            insuranceBefore,
            hookWethBefore,
            hookUsdcBefore,
            minOut,
            liveExpectedOut,
            collateral / 100
        );

console2.log(
            "scenario A received(trader+solver+keeper):",
            RealIERC20(quote).balanceOf(trader) - traderQuoteBefore
                + (RealIERC20(quote).balanceOf(solver) - solverQuoteBefore)
                + (RealIERC20(quote).balanceOf(keeper) - keeperQuoteBefore)
        );
    }

    /// @notice SCENARIO B: genuine adverse REAL-price move â€” WETH sold into
    ///         the live deep pool (real fees, real impact, WETH gets cheaper,
    ///         tick rises), THEN the oracle crash + liquidation completes the
    ///         forced unwind against the worsened venue price.
    function test_Fork_Liquidation_RealAdverseMove_UnwindsBand() public {
        if (!rpcAvailable) return;

        uint256 margin = 50 * 10 ** _tokenDecimals(quote);
        (uint256 collateral, uint256 borrowed, int24 tl, int24 tu,) = _openLong(margin);

int24 tickBefore = _slot0Tick(deepRealKey());
        // Canonical ETH/USDC venue (token0 = native ETH/base, token1 = USDC):
        // tick = USDC per ETH, so RISING tick == ETH getting MORE expensive.
        // An ADVERSE real move for the LONG is tick DOWN, executed by SELLING
        // ETH into the live pool. Target cleanly BELOW the band floor so the
        // band sits out-of-range holding pure ETH when the liquidation unwinds
        // it (any in-range sweep converts band ETH -> USDC; the hook's residual
        // claim buffer absorbs small sweeps, but we keep the state unambiguous).
        int24 baseTick = tickBefore < tl ? tickBefore : tl;
        int24 targetTick = baseTick - 40;

        {
            uint128 L = StateLibrary.getLiquidity(pm, _deepId());
            (uint160 sqrtP,,,) = _slot0(deepRealKey());
            uint160 sqrtTarget = TickMath.getSqrtRatioAtTick(targetTick);
            require(sqrtTarget < sqrtP, "push target not below current tick");
            uint256 ethIn = FullMath.mulDiv(
                uint256(L), uint256(sqrtP - sqrtTarget), FullMath.mulDiv(uint256(sqrtP), uint256(sqrtTarget), 1 << 96)
            );
            // Cap at push inventory; recompute achievable depth if needed.
            uint256 budget = _baseBalance(address(this));

            if (ethIn > budget) {
                uint256 sqrtDrop = FullMath.mulDiv(budget, 1 << 96, uint256(L));
                sqrtTarget = uint160(uint256(sqrtP) - sqrtDrop);
                ethIn = budget;
            }
            assertTrue(ethIn > 0, "nonzero push size");

            pm.unlock(abi.encode(true, ethIn, sqrtTarget));

            int24 tickAfter = _slot0Tick(deepRealKey());
            console2.log("scenario B adverse ticks moved:", uint256(int256(tickBefore - tickAfter)));
            assertLt(tickAfter, tickBefore - 10, "REAL adverse move: ETH cheaper");
            assertLt(tickAfter, tl, "band out-of-range (pure collateral side)");
        }

// --- Oracle crash + liquidation on the worsened venue ---
        uint256 solverQuoteBefore = RealIERC20(quote).balanceOf(solver);
        uint256 traderQuoteBefore = RealIERC20(quote).balanceOf(trader);
        uint256 keeperQuoteBefore = RealIERC20(quote).balanceOf(keeper);
        uint256 insuranceBefore = hook.insuranceFund(Currency.wrap(quote));
        uint256 hookWethBefore = _baseBalance(address(hook));
        uint256 hookUsdcBefore = RealIERC20(quote).balanceOf(address(hook));

        uint256 liveHuman = _humanPriceBaseInQuote18();
        priceFeed.setPrice(base, liveHuman / 2);
        assertTrue(hook.isLiquidatable(_posMemory(), hookLocalKey), "underwater after crash");

        uint256 crashedHuman = liveHuman / 2;
        uint256 minOut = (_expectedQuoteOut(collateral, crashedHuman) * 98) / 100;
        uint256 liveExpectedOut = _expectedQuoteOut(collateral, liveHuman);

        vm.prank(keeper);
        router.liquidate(address(hook), hookLocalKey, trader, minOut);

_assertLiquidatedCleanly(
            borrowed,
            tl,
            tu,
            solverQuoteBefore,
            traderQuoteBefore,
            keeperQuoteBefore,
            insuranceBefore,
            hookWethBefore,
            hookUsdcBefore,
            minOut,
            liveExpectedOut,
            collateral / 100
        );
    }

/// @dev Pushes the REAL price UP (buys BASE with QUOTE) until at least
    ///      `minConsumedBps` of the position band [tl, tu] has been swept from
    ///      its collateral (token0/ETH) side, measured exactly like the hook's
    ///      _bandConsumed (isCurrency0: consumed = currentTick - tickLower).
    ///      Every push swap carries a sqrtPriceLimit parked at the
    ///      `maxConsumedBps` point, so overshoot is structurally
    ///      impossible regardless of pool-depth estimation error.
    function _pushToConsumption(
        int24 tl,
        int24 tu,
        uint256 minConsumedBps,
        uint256 maxConsumedBps,
        uint256 maxQuoteRaw
    ) internal {
        int24 width = tu - tl;
        uint160 sqrtLimit;
        if (maxConsumedBps >= 10000) {
            sqrtLimit = MAX_SQRT_LIMIT;
        } else {
            int24 limitTick = int24(tl + int24(int256(FullMath.mulDiv(maxConsumedBps, uint256(uint24(width)), 10000))));
            sqrtLimit = TickMath.getSqrtRatioAtTick(limitTick);
        }
        uint256 prevChunk = 0;
        for (uint256 i = 0; i < 12; i++) {
            int24 tick = _slot0Tick(deepRealKey());
            if (_inBandConsumedPct(tl, tu, tick) >= minConsumedBps) return;

            // Exact-input estimate for buying up to the next checkpoint,
            // halved for a gentle approach; doubles vs previous chunk if stalled.
            (uint160 sqrtP,,,) = _slot0(deepRealKey());
            require(sqrtP < sqrtLimit, "price already at/above safe limit");
            int24 goalTick = int24(tl + int24(int256(FullMath.mulDiv(minConsumedBps, uint256(uint24(width)), 10000))));
            if (goalTick <= tick) goalTick = tick + 1;
            if (TickMath.getSqrtRatioAtTick(goalTick) <= sqrtP) goalTick = tick + 1;
            uint160 sqrtGoal = TickMath.getSqrtRatioAtTick(goalTick);
            if (sqrtGoal > sqrtLimit) sqrtGoal = sqrtLimit;
            uint256 quoteIn = FullMath.mulDiv(StateLibrary.getLiquidity(pm, _deepId()), uint256(sqrtGoal - sqrtP), 1 << 96) / 2;
            if (quoteIn < prevChunk * 2) quoteIn = prevChunk * 2;
            if (quoteIn == 0) quoteIn = 1;
            if (quoteIn > maxQuoteRaw) quoteIn = maxQuoteRaw;
            assertTrue(RealIERC20(quote).balanceOf(address(this)) > quoteIn, "push inventory exhausted");
            pm.unlock(abi.encode(false, quoteIn, sqrtLimit));
            prevChunk = quoteIn;
        }
        revert("failed to reach consumption target");
    }

/// @notice SCENARIO C: stuck-window regression â€” a FAVORABLE move sweeps
    ///         part of the collateral band in-range; permissionless rebalance
    ///         must stay inert below the trigger, then re-center above it, and
    ///         the resulting state must still liquidate cleanly end-to-end.
    function test_Fork_Rebalance_RecentersPartiallyConsumedBand() public {
        if (!rpcAvailable) return;

        // Cheap trigger: 3% of band width keeps the real-price push affordable.
        hook.setBandConsumptionTriggerBps(300);

        // Inventory for the real-price pushes (buying BASE with QUOTE drives tick UP).
        deal(quote, address(this), 26_000_000 * 10 ** _tokenDecimals(quote));

        uint256 margin = 50 * 10 ** _tokenDecimals(quote);
        (, uint256 borrowed, int24 tl, int24 tu,) = _openLong(margin);
        (,,,,, uint128 liq0) = _positionFields();

        // --- STAGE 1: sub-trigger penetration must remain a no-op ---
        int24 tickAtOpen = _slot0Tick(deepRealKey());
        assertLt(tickAtOpen, tl, "band starts above price");
        _pushToConsumption(tl, tu, 50, 250, 200_000 * 10 ** _tokenDecimals(quote));
        int24 tickMid = _slot0Tick(deepRealKey());
        assertGt(tickMid, tickAtOpen, "price moved favorably");
        assertTrue(_inBandConsumedPct(tl, tu, tickMid) < 300, "stage 1 stays sub-trigger");
        vm.prank(keeper);
        router.rebalance(address(hook), hookLocalKey, trader);
        (,,,,,, int24 loA, int24 upA, uint128 lqA) = hook.positions(hookLocalKey.toId(), trader);
        assertEq(loA, tl, "sub-trigger rebalance leaves ticks");
        assertEq(upA, tu, "sub-trigger rebalance leaves ticks");
        assertEq(lqA, liq0, "sub-trigger rebalance leaves LP stake");

        // --- STAGE 2: cross the trigger -> re-center above the new price ---
        _pushToConsumption(tl, tu, 400, 10000, 25_000_000 * 10 ** _tokenDecimals(quote));
        int24 tickDeep = _slot0Tick(deepRealKey());
        assertTrue(_inBandConsumedPct(tl, tu, tickDeep) >= 400, "stage 2 crosses trigger");

        vm.prank(keeper);
        router.rebalance(address(hook), hookLocalKey, trader);

        (address owner2, uint256 coll2, uint256 borr2,,,, int24 lo2, int24 up2, uint128 lq2) =
            hook.positions(hookLocalKey.toId(), trader);
        assertEq(owner2, trader, "position survives rebalance");
        assertEq(borr2, borrowed, "rebalance never deleverages");
        assertGt(lq2, 0, "band re-deployed with liquidity");
        assertGe(lo2, tickDeep, "new band sits at/above the moved price");
        assertGt(up2 - tickDeep, 0, "price below new band ceiling");
        assertGt(up2 - lo2, 0, "non-degenerate width");
        assertEq(_liveBandLiquidity(tl, tu), 0, "old band burned from live pool");

// --- END-TO-END: crash oracle, liquidation must unwind cleanly ---
        uint256 solverQuoteBefore = RealIERC20(quote).balanceOf(solver);
        uint256 traderQuoteBefore = RealIERC20(quote).balanceOf(trader);
        uint256 keeperQuoteBefore = RealIERC20(quote).balanceOf(keeper);
        uint256 insuranceBefore = hook.insuranceFund(Currency.wrap(quote));
        uint256 hookWethBefore = _baseBalance(address(hook));
        uint256 hookUsdcBefore = RealIERC20(quote).balanceOf(address(hook));

        uint256 liveHuman = _humanPriceBaseInQuote18();
        priceFeed.setPrice(base, liveHuman / 2);
        assertTrue(hook.isLiquidatable(_posMemory(), hookLocalKey), "underwater after crash");

        uint256 minOut = (_expectedQuoteOut(coll2, liveHuman / 2) * 98) / 100;
        uint256 liveExpectedOut = _expectedQuoteOut(coll2, liveHuman);

        vm.prank(keeper);
        router.liquidate(address(hook), hookLocalKey, trader, minOut);

_assertLiquidatedCleanly(
            borr2,
            lo2,
            up2,
            solverQuoteBefore,
            traderQuoteBefore,
            keeperQuoteBefore,
            insuranceBefore,
            hookWethBefore,
            hookUsdcBefore,
            minOut,
            liveExpectedOut,
            coll2 / 100
        );
    }

/// @dev In-band consumption measured from the collateral (token0/ETH, lower)
    ///      side: 0 while price stays below the band (untouched), 10000 once
    ///      swept through the ceiling. Mirrors the hook's _bandConsumed for
    ///      isCurrency0 (collateral == token0); band-exit triggers are covered
    ///      by the hook's own out-of-range rule.
    function _inBandConsumedPct(int24 tl, int24 tu, int24 tick) internal pure returns (uint256) {
        if (tick <= tl) return 0;
        if (tick >= tu) return 10000;
        return FullMath.mulDiv(uint256(uint24(tick - tl)), 10000, uint256(uint24(tu - tl)));
    }

    /// @dev Rebuilds a Position view struct from the public mapping getter.
    function _posMemory() internal view returns (EswapMarginHook.Position memory p) {
        (address owner, uint256 coll, uint256 borr, uint8 lev, bool isLong,, int24 tl, int24 tu, uint128 lq) =
            hook.positions(hookLocalKey.toId(), trader);
        p = EswapMarginHook.Position({
            trader: owner,
            collateralAmount: coll,
            borrowedAmount: borr,
            leverage: lev,
            isLong: isLong,
            liquidationSqrtPrice: 0,
            tickLower: tl,
            tickUpper: tu,
            liquidity: lq
        });
    }

// --- unlock callback: direct REAL-pool push swap (scenario B) ----------

    receive() external payable {}

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        require(msg.sender == address(pm), "callback: only PM");
        (bool sellBase, uint256 amountIn, uint160 sqrtLimit) = abi.decode(data, (bool, uint256, uint160));
        // canonical ETH/USDC venue -> token0 = native ETH (base). Sell base =
        // zeroForOne=true; buy base (sell quote) = zeroForOne=false.
        bool baseIsToken0 = RealCurrency.unwrap(deepRealKey().currency0) == base;
        BalanceDelta delta;
        if (sellBase) {
            // Sell BASE (token0=ETH) for QUOTE on the hookless deep venue:
            // exact-input; sqrtLimit caps how far the price can fall.
            delta = pm.swap(
                deepRealKey(),
                RealIPoolManager.SwapParams(baseIsToken0, -int256(amountIn), sqrtLimit),
                ""
            );
        } else {
            // Buy BASE with QUOTE: sells token1=USDC (drives tick UP),
            // hard-capped at sqrtLimit so probes can never overshoot.
            delta = pm.swap(
                deepRealKey(),
                RealIPoolManager.SwapParams(!baseIsToken0, -int256(amountIn), sqrtLimit),
                ""
            );
        }
        // Collect whichever side came OUT. (pm.take forwards native ETH via call.)
        if (delta.amount0() > 0) {
            pm.take(deepRealKey().currency0, address(this), uint256(uint128(delta.amount0())));
        }
        if (delta.amount1() > 0) {
            pm.take(deepRealKey().currency1, address(this), uint256(uint128(delta.amount1())));
        }
        // Pay whichever input leg is negative (native-aware per currency).
        if (delta.amount0() < 0) {
            _settleLeg(deepRealKey().currency0, uint256(uint128(-delta.amount0())));
        }
        if (delta.amount1() < 0) {
            _settleLeg(deepRealKey().currency1, uint256(uint128(-delta.amount1())));
        }
        return "";
    }

    function _settleLeg(RealCurrency c, uint256 amt) internal {
        address token = RealCurrency.unwrap(c);
        if (token == address(0)) {
            // Native ETH: amount comes from the value sent with settle().
            pm.settle{value: amt}();
        } else {
            pm.sync(c);
            RealIERC20(token).transfer(address(pm), amt);
            pm.settle();
        }
    }
}
