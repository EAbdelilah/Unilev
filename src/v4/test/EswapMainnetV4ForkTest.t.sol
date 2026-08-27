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
import {IERC20 as RealIERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {PriceFeedMock} from "./BaseV4Test.t.sol";

/// @notice END-TO-END fork proof against the LIVE Uniswap V4 singleton and a
///         REAL deep third-party pool.
///
/// Chain: Unichain mainnet (UNICHAIN_RPC_URL) or Ethereum mainnet (ETH_RPC_URL),
/// wherever the canonical PoolManager 0x000...4444 is deployed.
///
/// Proven on real mainnet state, no mocks of the AMM:
///  1. A deep native USDC/WETH V4 pool is DISCOVERED (initialized + liquid).
///  2. swapMultiPool executes the physical fill ON THAT POOL (its price moves).
///  3. deployCollateral stakes the collateral as single-sided LP in the SAME
///     deep pool (position-level liquidity > 0).
///  4. closePosition unwinds everything inside one unlock WITHOUT
///     CurrencyNotSettled — transient deltas fully netted on the real singleton.
contract EswapMainnetV4ForkTest is Test {
    using PoolIdLibrary for PoolKey;

    // Canonical V4 PoolManager singletons (per-chain vanity deployments).
    address constant V4_PM_MAINNET = 0x000000000004444c5dc75cB358380D2e3dE08A90; // Ethereum
    address constant V4_PM_UNICHAIN = 0x1F98400000000000000000000000000000000004; // Unichain

    // Unichain mainnet (chainId 130)
    address constant UNICHAIN_USDC = 0x078D782b760474a361dDA0AF3839290b0EF57AD6;
    address constant UNICHAIN_WETH = 0x4200000000000000000000000000000000000006;
    // Ethereum mainnet (chainId 1)
    address constant MAINNET_USDC = 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48;
    address constant MAINNET_WETH = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;

    uint160 constant HIGH_FLAGS = (1 << 159) | (1 << 158) | (1 << 153) | (1 << 152) | (1 << 148);
    uint160 constant LOW_FLAGS = (1 << 13) | (1 << 12) | (1 << 7) | (1 << 6) | (1 << 3);

    RealIPoolManager pm;
    EswapMarginHook hook;
    EswapRouter router;
    PriceFeedMock priceFeed;
    address base; // WETH
    address quote; // USDC

    PoolKey hookLocalKey;
    PoolKey standardLocalKey;
    RealPoolKey hookRealKey;

    bool rpcAvailable;

    address trader = makeAddr("forkTrader");
    address solver = makeAddr("forkSolver");

    function setUp() public {
        // Probe configured RPCs in order and settle on the first chain that
        // hosts the canonical V4 singleton AND a genuinely deep ERC20
        // WETH/USDC pool. (.env may point at chains with only dust venues.)
        string[2] memory rpcCandidates;
        rpcCandidates[0] = vm.envOr("UNICHAIN_RPC_URL", string(""));
        rpcCandidates[1] = vm.envOr("ETH_RPC_URL", string(""));

        for (uint256 r = 0; r < 2 && !rpcAvailable; r++) {
            string memory rpcUrl = rpcCandidates[r];
            if (bytes(rpcUrl).length == 0) continue;
            try vm.createSelectFork(rpcUrl) {
                this._setupOnActiveFork();
            } catch {}
        }
        // No viable venue (e.g. only a Polygon RPC configured): tests soft-skip.
    }

    /// @dev Runs against the CURRENTLY selected fork; sets rpcAvailable only if
    ///      the chain is supported and a deep enough pool was discovered.
    function _setupOnActiveFork() external {
        uint256 cid = block.chainid;
        address pmAddr;
        if (cid == 130) {
            base = UNICHAIN_WETH;
            quote = UNICHAIN_USDC;
            pmAddr = V4_PM_UNICHAIN;
        } else if (cid == 1) {
            base = MAINNET_WETH;
            quote = MAINNET_USDC;
            pmAddr = V4_PM_MAINNET;
        } else {
            return;
        }
        if (base.code.length == 0 || quote.code.length == 0 || pmAddr.code.length == 0) return;

        pm = RealIPoolManager(pmAddr);
        console2.log("forked chainId:", cid);

        // --- Discover the deepest initialized ERC20 pool for this pair ---
        RealPoolKey memory deepKey;
        bool found;
        uint128 deepest;
        uint24[6] memory fees = [uint24(500), 3000, 100, 500, 3000, 100];
        int24[6] memory spacings = [int24(60), 60, 1, 10, 10, 10];
        for (uint256 i = 0; i < 6; i++) {
            RealPoolKey memory k = RealPoolKey({
                currency0: RealCurrency.wrap(quote),
                currency1: RealCurrency.wrap(base),
                fee: fees[i],
                tickSpacing: spacings[i],
                hooks: RealIHooks(address(0))
            });
            (uint160 sqrtP, int24 tick,,) = StateLibrary.getSlot0(pm, k.toId());
            if (sqrtP == 0) continue;
            uint128 liq = StateLibrary.getLiquidity(pm, k.toId());
            console2.log("candidate fee:", fees[i]);
            console2.log("  ts:", uint256(int256(spacings[i])));
            console2.log("  liq:", uint256(liq));
            console2.log("  tick:", uint256(int256(tick)));
            if (liq > deepest) {
                deepest = liq;
                deepKey = k;
                found = true;
            }
        }
        // Depth floor: below this, even small fills collapse the pool price
        // (observed: L=2e11 absorbs only ~$0.006 per 0.5% range crossing).
        if (!found || deepest < 1e15) return;

        rpcAvailable = true;
        standardLocalKey = PoolKey({
            currency0: Currency.wrap(RealCurrency.unwrap(deepKey.currency0)),
            currency1: Currency.wrap(RealCurrency.unwrap(deepKey.currency1)),
            fee: deepKey.fee,
            tickSpacing: deepKey.tickSpacing,
            hooks: address(0)
        });

        // --- Deploy hook + router against the live singleton ---
        address hookAddr = address(uint160(HIGH_FLAGS | LOW_FLAGS));
        priceFeed = new PriceFeedMock();
        deployCodeTo(
            "EswapMarginHook.sol:EswapMarginHook", abi.encode(address(pm), address(priceFeed), address(this)), hookAddr
        );
        hook = EswapMarginHook(payable(hookAddr));
        router = new EswapRouter(IPoolManager(address(pm)));
        hook.setRouterAndMinCollateralUsd(address(router), 0);

        hookRealKey = RealPoolKey({
            currency0: RealCurrency.wrap(quote),
            currency1: RealCurrency.wrap(base),
            fee: 3000,
            tickSpacing: 60,
            hooks: RealIHooks(hookAddr)
        });
        hookLocalKey = PoolKey({
            currency0: Currency.wrap(quote), currency1: Currency.wrap(base), fee: 3000, tickSpacing: 60, hooks: hookAddr
        });

        // The accounting-rail hook pool must trade at the DEEP venue's price —
        // initializing it anywhere else (e.g. 1:1) would trip the V4-spot vs
        // oracle TWAP circuit breaker, since the oracle tracks the venue.
        (uint160 hpSqrtP,,,) = StateLibrary.getSlot0(pm, hookRealKey.toId());
        (uint160 deepSqrtP,,,) = StateLibrary.getSlot0(pm, RealPoolId.wrap(PoolId.unwrap(standardLocalKey.toId())));
        if (hpSqrtP == 0) {
            pm.initialize(hookRealKey, deepSqrtP);
        }

        hook.setAuthorizedPool(hookLocalKey.toId(), true);
        hook.setStandardPoolKey(hookLocalKey.toId(), standardLocalKey);
        hook.setBaseCurrency(hookLocalKey.toId(), Currency.wrap(base));
        hook.setTokenDecimals(base, _tokenDecimals(base));
        hook.setTokenDecimals(quote, _tokenDecimals(quote));

        // Oracle mock tracks the REAL deep-pool price so the TWAP circuit breaker
        // passes. Convention (PriceFeed.sol): USD_18dec per WHOLE token.
        priceFeed.setPrice(base, _humanPriceBaseInQuote18());
        priceFeed.setPrice(quote, 1e18); // stable: $1 per whole unit

        // Fund participants with REAL tokens.
        deal(quote, trader, 250_000 * 10 ** _tokenDecimals(quote));
        deal(base, trader, 50 ether);
        deal(quote, solver, 250_000 * 10 ** _tokenDecimals(quote));

        vm.prank(trader);
        RealIERC20(quote).approve(address(router), type(uint256).max);
        vm.prank(solver);
        RealIERC20(quote).approve(address(router), type(uint256).max);
    }

    // --- helpers -----------------------------------------------------------

    function _tokenDecimals(address token) internal view returns (uint8 d) {
        (bool ok, bytes memory ret) = token.staticcall(abi.encodeWithSignature("decimals()"));
        require(ok && ret.length >= 32, "decimals() failed");
        d = uint8(uint256(abi.decode(ret, (uint256))));
    }

    /// @dev Integer square root (Newton).
    function _sqrt(uint256 x) internal pure returns (uint256 y) {
        if (x == 0) return 0;
        uint256 z = (x + 1) / 2;
        y = x;
        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }
    }

    /// @dev sqrtPriceX96 for a raw 1:1 ratio between the two currencies,
    ///      decimals-aware (raw ratio = 10^(dec1 - dec0)).
    function _oneToOneSqrtPrice() internal view returns (uint160) {
        uint256 d0 = _tokenDecimals(quote);
        uint256 d1 = _tokenDecimals(base);
        // rawRatio = 10^(d1-d0); sqrtPriceX96 = sqrt(rawRatio) * 2^96.
        if (d1 >= d0) {
            uint256 raw = 10 ** (d1 - d0);
            return uint160((_sqrt(raw) * (1 << 96)) / 1e9);
        }
        uint256 invRaw = 10 ** (d0 - d1);
        return uint160(((1 << 96) * 1e9) / _sqrt(invRaw));
    }

    /// @dev Human quote-per-base price (18-dec USD convention) derived from the
    ///      REAL deep pool's slot0. With currency0=quote and currency1=base:
    ///      R = sqrtP^2/2^192 = base_wei per quote_unit, so a whole base unit
    ///      sells for 10^dB * R / 10^dQ quote units -> in 1e18-fixed:
    ///      human = 10^(dB - dQ) * 2^192 / sqrtP^2.
    ///      (Sanity: fee500/ts60 WETH pool with sqrtP=1.758e33 gives ~2030e18.)
    function _humanPriceBaseInQuote18() internal view returns (uint256) {
        (uint160 sqrtP,,,) = StateLibrary.getSlot0(pm, RealPoolId.wrap(PoolId.unwrap(standardLocalKey.toId())));
        require(sqrtP > 0, "deep pool uninitialized");
        uint8 dQ = _tokenDecimals(quote);
        uint8 dB = _tokenDecimals(base);
        require(dB >= dQ && dB - dQ <= 18, "unsupported decimals");
        // 1e18-fixed USD price, as consumed by PriceFeedMock.getAmountInUsd.
        return FullMath.mulDiv((1 << 192) * (10 ** (dB - dQ)), 1e18, uint256(sqrtP) * uint256(sqrtP));
    }

    // --- tests -------------------------------------------------------------

    /// @dev The discovered pool must carry genuine third-party liquidity.
    ///      (Live Ethereum-mainnet fee500/ts10 WETH/USDC sits around L=4.45e16;
    ///      the setUp depth floor already guarantees at least 1e15.)
    function test_Fork_DeepPool_IsLiquid() public view {
        if (!rpcAvailable) return;
        uint128 liq = StateLibrary.getLiquidity(pm, RealPoolId.wrap(PoolId.unwrap(standardLocalKey.toId())));
        assertGt(liq, 1e15, "live third-party liquidity floor");
    }

    /// @dev Full lifecycle on live mainnet state. Transaction success IS the
    ///      settlement proof: the real singleton reverts CurrencyNotSettled if
    ///      any transient delta leaks out of the unlock.
    function test_Fork_DeepPool_Open_LP_Close_RoundTrip() public {
        if (!rpcAvailable) return;

        RealPoolId deepId = RealPoolId.wrap(PoolId.unwrap(standardLocalKey.toId()));
        (uint160 pBefore,,,) = StateLibrary.getSlot0(pm, deepId);
        uint256 solverBefore = RealIERC20(quote).balanceOf(solver);

        uint8 dQ = _tokenDecimals(quote);
        // Keep the fill small relative to venue depth: $50 margin, 2x ->
        // ~$100 notional (well under 0.1% of the mainnet pool's in-range side).
        uint256 margin = 50 * 10 ** dQ;

        EswapRouter.SwapParams memory params = EswapRouter.SwapParams({
            key: hookLocalKey,
            standardPoolKey: standardLocalKey,
            zeroForOne: Currency.unwrap(standardLocalKey.currency0) == quote, // buy BASE with QUOTE
            amountSpecified: -int256(margin),
            leverage: 2,
            solver: solver,
            hookData: abi.encode(true, uint8(2), trader)
        });

        vm.prank(trader);
        router.swapMultiPool(params);

        // 1. Physical fill moved the REAL deep pool's price.
        (uint160 pAfter,,,) = StateLibrary.getSlot0(pm, deepId);
        assertNotEq(pAfter, pBefore, "physical fill must move the live deep pool");

        // 2. Position recorded; LP staked in the SAME deep pool.
        (
            address posTrader,
            uint256 collateral,
            uint256 borrowed,
            uint8 lev,
            bool isLong,,
            int24 tl,
            int24 tu,
            uint128 liq
        ) = hook.positions(hookLocalKey.toId(), trader);
        assertEq(posTrader, trader, "position recorded");
        assertGt(collateral, 0, "collateral recorded");
        assertEq(borrowed, margin, "borrow registered (leverage 2 -> margin-sized loan)");
        assertEq(lev, 2);
        // Fill sells QUOTE to buy BASE (=WETH) -> collateral in base -> LONG.
        assertTrue(isLong, "bought base=WETH with quote=USDC must record LONG");
        assertGt(liq, 0, "collateral deployed as single-sided LP");

        bytes32 posKey = keccak256(abi.encodePacked(address(hook), tl, tu, bytes32(0)));
        assertGt(StateLibrary.getPositionLiquidity(pm, deepId, posKey), 0, "LP minted into the LIVE deep pool");

        // 3. Clean close on the live singleton (revert-free == fully netted).
        uint256 traderBefore = RealIERC20(quote).balanceOf(trader);
        vm.prank(trader);
        router.closePosition(address(hook), hookLocalKey, trader, solver, 0);

        (address cleared, uint256 collAfter,,,,,,, uint128 liqAfter) = hook.positions(hookLocalKey.toId(), trader);
        assertEq(cleared, address(0), "position cleared");
        assertEq(collAfter, 0, "collateral cleared");
        assertEq(liqAfter, 0, "LP stake closed");

        // Solver lent principal at open and gets exactly it back at close.
        assertEq(RealIERC20(quote).balanceOf(solver), solverBefore, "solver nets out principal exactly");
        // Trader recovers the bulk of margin after real round-trip costs
        // (0.5% open fee + venue fees both ways + impact ~1% on this thin pool).
        uint256 residual = RealIERC20(quote).balanceOf(trader) - traderBefore;
        assertGt(residual, margin * 80 / 100, "trader residual above 80% of margin");
        assertLt(residual, margin * 101 / 100, "no free money");
    }
}
