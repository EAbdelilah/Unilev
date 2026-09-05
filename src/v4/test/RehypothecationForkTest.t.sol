// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {EswapMarginHook} from "../EswapMarginHook.sol";
import {EswapRouter} from "../EswapRouter.sol";
import {PoolKey} from "../types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "../types/PoolId.sol";
import {Currency} from "../types/Currency.sol";
import {IPoolManager} from "../interfaces/IPoolManager.sol";
import {IERC20 as RealIERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IPoolManager as RealIPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolIdLibrary as RealPoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {PoolKey as RealPoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency as RealCurrency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks as RealIHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {BalanceDelta, BalanceDeltaLibrary} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";

/// @dev Proves the rehypothecation lifecycle with the FIXED yield distribution:
///      Deploys a local hook (compiled from the current src, which includes the
///      rehypPrincipal fix) against the REAL live Unichain PoolManager. Opens a
///      long with a band on the live (deep) standard pool, sweeps in-band volume,
///      then closes — asserting the solver receives the LP fee yield in ETH.
contract RehypothecationForkTest is Test {
    using PoolIdLibrary for PoolKey;
    using RealPoolIdLibrary for RealPoolKey;
    using BalanceDeltaLibrary for BalanceDelta;

    // ─── Live addresses ─────────────────────────────────────────────────────
    address constant PM = 0x1F98400000000000000000000000000000000004;
    address constant USDC = 0x078D782b760474a361dDA0AF3839290b0EF57AD6;
    address constant ETH = address(0);

    // ─── New hook+router (fixed logic) ──────────────────────────────────────
    uint160 constant HIGH_FLAGS = (1 << 159) | (1 << 158) | (1 << 153) | (1 << 152) | (1 << 148);
    uint160 constant LOW_FLAGS = (1 << 13) | (1 << 12) | (1 << 7) | (1 << 6) | (1 << 3);
    uint160 constant NEW_HOOK_ADDR_RAW = HIGH_FLAGS | LOW_FLAGS;

    address newHookAddr;
    EswapMarginHook newHook;
    EswapRouter newRouter;

    // ─── Shared state ───────────────────────────────────────────────────────
    address trader = address(0xABC0000000000000000000000000000000000001);
    address solver = 0x518634753C61342298c3E04326056b3Ce596a566;

    RealPoolKey stdKey = RealPoolKey({
        currency0: RealCurrency.wrap(ETH),
        currency1: RealCurrency.wrap(USDC),
        fee: 500,
        tickSpacing: 10,
        hooks: RealIHooks(address(0))
    });

    PoolKey hookKey;
    PoolId hookPoolId;

    RealIPoolManager mgr;
    receive() external payable {}

    function setUp() public {
        string memory rpc = vm.envOr("UNICHAIN_RPC_URL", string(""));
        require(bytes(rpc).length > 0, "UNICHAIN_RPC_URL required");
        vm.createSelectFork(rpc);
        require(block.chainid == 130, "not unichain");
        mgr = RealIPoolManager(PM);

        // Borrow the live hook's price feed address (immutable getter).
        address liveFeed =
            address(EswapMarginHook(payable(0x4bd2C1e73d150b65EF88DBa247Ed60A1538310c8)).priceFeed());

        // Deploy a fresh hook at the flag-address required by PoolManager.
        deployCodeTo(
            "EswapMarginHook.sol:EswapMarginHook",
            abi.encode(PM, liveFeed, address(this)),
            address(uint160(NEW_HOOK_ADDR_RAW))
        );
        newHook = EswapMarginHook(payable(address(uint160(NEW_HOOK_ADDR_RAW))));
        newHookAddr = address(newHook);

        newRouter = new EswapRouter(IPoolManager(PM));
        newHook.setRouterAndMinCollateralUsd(address(newRouter), 0);
        newHook.setTokenDecimals(USDC, 6);
        newRouter.setSolverWhitelist(solver, true);

        hookKey = PoolKey({
            currency0: Currency.wrap(ETH),
            currency1: Currency.wrap(USDC),
            fee: 3000,
            tickSpacing: 60,
            hooks: newHookAddr
        });
        hookPoolId = hookKey.toId();

        // Initialize the hook pool (unused accounting rail) at the live standard price.
        (uint160 stdSqrt,,,) = StateLibrary.getSlot0(RealIPoolManager(PM), stdKey.toId());
        mgr.initialize(
            RealPoolKey({
                currency0: RealCurrency.wrap(ETH),
                currency1: RealCurrency.wrap(USDC),
                fee: 3000,
                tickSpacing: 60,
                hooks: RealIHooks(newHookAddr)
            }),
            stdSqrt
        );

        newHook.setAuthorizedPool(hookPoolId, true);
        newHook.setStandardPoolKey(hookPoolId, _repoStandardKey());

        deal(USDC, trader, 100_000e6);
        deal(USDC, solver, 100_000e6);
        deal(USDC, address(this), 2_000_000_000e6);

        vm.prank(trader);
        RealIERC20(USDC).approve(address(newRouter), type(uint256).max);
        vm.prank(solver);
        RealIERC20(USDC).approve(address(newRouter), type(uint256).max);
    }

    function _repoStandardKey() internal view returns (PoolKey memory) {
        return PoolKey({
            currency0: Currency.wrap(RealCurrency.unwrap(stdKey.currency0)),
            currency1: Currency.wrap(RealCurrency.unwrap(stdKey.currency1)),
            fee: stdKey.fee,
            tickSpacing: stdKey.tickSpacing,
            hooks: address(stdKey.hooks)
        });
    }

    function _openLong(uint256 margin, uint8 leverage)
        internal
        returns (uint256 coll, uint128 liq, int24 tl, int24 tu, uint256 rehyp)
    {
        vm.prank(trader);
        newRouter.swapMultiPool(EswapRouter.SwapParams({
            key: hookKey,
            standardPoolKey: _repoStandardKey(),
            zeroForOne: false,
            amountSpecified: -int256(margin),
            leverage: leverage,
            solver: solver,
            hookData: abi.encode(true, leverage, trader)
        }));
        (, uint256 rColl, , , , , int24 rTl, int24 rTu, uint128 rLiq) =
            newHook.positions(hookPoolId, trader);
        coll = rColl;
        liq = rLiq;
        tl = rTl;
        tu = rTu;
        rehyp = newHook.rehypPrincipal(hookPoolId, trader);
    }

    // ─── Volume helpers ─────────────────────────────────────────────────────
    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        require(msg.sender == PM, "not manager");
        (bool z1, int256 amt, uint160 priceLimit) = abi.decode(data, (bool, int256, uint160));
        BalanceDelta d = mgr.swap(stdKey, RealIPoolManager.SwapParams(z1, -amt, priceLimit), "");
        (int128 a0, int128 a1) = (d.amount0(), d.amount1());
        if (a0 > 0) mgr.take(RealCurrency.wrap(ETH), address(this), uint256(uint128(a0)));
        if (a1 > 0) mgr.take(RealCurrency.wrap(USDC), address(this), uint256(uint128(a1)));
        if (a0 < 0) mgr.settle{value: uint256(uint128(-a0))}();
        if (a1 < 0) {
            uint256 owed = uint256(uint128(-a1));
            if (RealIERC20(USDC).balanceOf(address(this)) < owed) deal(USDC, address(this), owed);
            mgr.sync(RealCurrency.wrap(USDC));
            RealIERC20(USDC).transfer(PM, owed);
            mgr.settle();
        }
        return "";
    }

    function _buy(int256 amtInUsd, uint160 priceLimit) internal {
        mgr.unlock(abi.encode(false, amtInUsd, priceLimit));
    }

    function _sell(int256 amtInEth, uint160 priceLimit) internal {
        vm.deal(address(this), type(uint128).max);
        mgr.unlock(abi.encode(true, amtInEth, priceLimit));
    }

    function _stdTick() internal view returns (int24) {
        (, int24 tick,,) = StateLibrary.getSlot0(RealIPoolManager(PM), stdKey.toId());
        return tick;
    }

    /// @dev Reads the band LP position's accrued fees using the correct v4 position key (with salt).
    function _dumpBandFee(address hookAddr, string memory label, int24 tl, int24 tu) internal {
        bytes32 posId = keccak256(abi.encodePacked(hookAddr, tl, tu, uint256(0)));
        (uint128 pliq, uint256 fi0Last, uint256 fi1Last) =
            StateLibrary.getPositionInfo(RealIPoolManager(PM), stdKey.toId(), posId);
        (uint256 fg0, uint256 fg1) = StateLibrary.getFeeGrowthInside(RealIPoolManager(PM), stdKey.toId(), tl, tu);
        uint256 owed0 = fg0 >= fi0Last ? FullMath.mulDiv(fg0 - fi0Last, pliq, 1 << 128) : 0;
        uint256 owed1 = fg1 >= fi1Last ? FullMath.mulDiv(fg1 - fi1Last, pliq, 1 << 128) : 0;
        emit log_named_uint(string.concat(label, " pliq"), pliq);
        emit log_named_uint(string.concat(label, " feeOwed0(ETH wei)"), owed0);
        emit log_named_uint(string.concat(label, " feeOwed1(USDC raw)"), owed1);
    }

    // ─── Test ───────────────────────────────────────────────────────────────
    function test_RhypoOpensBand_AccruesFees_AndPaysSolver() public {
        // Phase 1: open + band deployed on the live standard pool.
        (uint256 coll, uint128 posLiq, int24 tl, int24 tu, uint256 rehyp) = _openLong(100e6, 2);
        emit log_named_uint("collateral ETH wei", coll);
        emit log_named_uint("pos.liquidity", posLiq);
        emit log_named_int("band tickLower", tl);
        emit log_named_int("band tickUpper", tu);
        emit log_named_uint("rehypPrincipal(ETH wei)", rehyp);
        assertGt(posLiq, 0, "band must deploy on open");
        assertGt(rehyp, 0, "rehypPrincipal must be recorded");
        assertLt(tl, tu, "band ordered");
        (, int24 slotTick,,) = StateLibrary.getSlot0(RealIPoolManager(PM), stdKey.toId());
        emit log_named_int("std tick at open", slotTick);

        // Phase 2: push price into the band, cycle in-band volume, drag back.
        uint160 buyLimit = TickMath.getSqrtPriceAtTick(tu + 120);
        uint160 sellLimit = TickMath.getSqrtPriceAtTick(tl - 240);

        _buy(20_000_000e6, buyLimit);
        int24 tickAfterBuy = _stdTick();
        emit log_named_int("std tick after push", tickAfterBuy);
        require(tickAfterBuy > tl, "price not pushed into band");

        for (uint256 i = 0; i < 4; i++) {
            _sell(2500 ether, sellLimit);
            _buy(2_500_000e6, buyLimit);
        }
        emit log_named_int("std tick after cycles", _stdTick());
        _dumpBandFee(newHookAddr, "after cycles", tl, tu);

        // Drag the price back down so the LP band ends fully in ETH.
        _sell(2500 ether, sellLimit);
        int24 tickEnd = _stdTick();
        emit log_named_int("std tick at close", tickEnd);

        uint256 solverEthBefore = solver.balance;

        // Phase 3: close — only the trader may close their own position.
        vm.prank(trader);
        newRouter.closePosition(newHookAddr, hookKey, trader, solver, 0);

        uint256 solverEthAfter = solver.balance;
        emit log_named_uint("solver ETH before", solverEthBefore);
        emit log_named_uint("solver ETH after", solverEthAfter);
        (,,,,,, int24 ftl, int24 ftu, uint128 fliq) = newHook.positions(hookPoolId, trader);
        emit log_named_uint("final liq", fliq);

        assertEq(fliq, 0, "band removed on close");
        assertGt(solverEthAfter, solverEthBefore, "solver must receive positive LP yield");
        emit log_named_uint("solver ETH yield (wei)", solverEthAfter - solverEthBefore);
    }
}
