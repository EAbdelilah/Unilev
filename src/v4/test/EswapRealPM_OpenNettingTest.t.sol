// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {EswapMarginHook} from "../EswapMarginHook.sol";
import {EswapRouter} from "../EswapRouter.sol";
import {EswapMarginLib} from "../EswapMarginLib.sol";
import {PoolKey} from "../types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "../types/PoolId.sol";
import {Currency} from "../types/Currency.sol";
import {IPoolManager} from "../interfaces/IPoolManager.sol";
import {BaseV4Test, ERC20Mock, PriceFeedMock} from "./BaseV4Test.t.sol";

import {PoolManager} from "@uniswap/v4-core/src/PoolManager.sol";
import {PoolModifyLiquidityTest} from "@uniswap/v4-core/src/test/PoolModifyLiquidityTest.sol";
import {IPoolManager as RealIPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey as RealPoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency as RealCurrency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks as RealIHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";

/// @notice Two empirical proofs against the REAL lib/v4-core PoolManager:
///   1. The EswapRouter's open path passes sqrtPriceLimitX96 = 0 on every swap,
///      which the real Pool library rejects with PriceLimitOutOfBounds.
///   2. The multi-pool margin open (accounting swap on the hook pool + physical
///      swap on the standard pool) leaves un-netted transient deltas (router
///      input leg of the standard pool swap is never settled, hook-pool output
///      leg is never taken), so the real PoolManager reverts CurrencyNotSettled.
///      The mock PoolManager never enforces this invariant, which is why the
///      mock-based suite passes.
contract EswapRealPM_OpenNettingTest is Test {
    using PoolIdLibrary for PoolKey;
    uint160 constant HIGH_FLAGS = (1 << 159) | (1 << 158) | (1 << 153) | (1 << 152) | (1 << 148);
    uint160 constant LOW_FLAGS = (1 << 13) | (1 << 12) | (1 << 7) | (1 << 6) | (1 << 3);
    uint160 constant SQRT_PRICE_1_1 = 79228162514264337593543950336;
    uint160 constant MIN_SQRT = 4295128739;

    PoolManager public realManager;
    EswapMarginHook public realHook;
    address public realHookAddr;
    EswapRouter public router;
    ERC20Mock public token0;
    ERC20Mock public token1;
    PriceFeedMock public priceFeed;
    RealPoolKey public hookRealKey;
    RealPoolKey public standardRealKey;
    PoolKey public hookLocalKey;
    PoolKey public standardLocalKey;

    address trader = makeAddr("trader");
    address solver = makeAddr("solver");

    uint256 constant MARGIN = 100 ether;
    uint256 constant BORROW = 100 ether; // leverage 2

    function setUp() public {
        realManager = new PoolManager(address(this));
        priceFeed = new PriceFeedMock();
        token0 = new ERC20Mock("Token 0", "TK0");
        token1 = new ERC20Mock("Token 1", "TK1");
        // Real PoolManager requires currency0 < currency1.
        if (uint256(uint160(address(token0))) > uint256(uint160(address(token1)))) {
            ERC20Mock t = token0;
            token0 = token1;
            token1 = t;
        }
        assertLt(uint256(uint160(address(token0))), uint256(uint160(address(token1))));

        realHookAddr = address(uint160(HIGH_FLAGS | LOW_FLAGS));
        deployCodeTo(
            "EswapMarginHook.sol:EswapMarginHook",
            abi.encode(address(realManager), address(priceFeed), address(this)),
            realHookAddr
        );
        realHook = EswapMarginHook(payable(realHookAddr));

        router = new EswapRouter(IPoolManager(address(realManager)));
        realHook.setRouterAndMinCollateralUsd(address(router), 0);
        router.setSolverWhitelist(solver, true);

        hookRealKey = RealPoolKey({
            currency0: RealCurrency.wrap(address(token0)),
            currency1: RealCurrency.wrap(address(token1)),
            fee: 3000,
            tickSpacing: 60,
            hooks: RealIHooks(realHookAddr)
        });
        standardRealKey = RealPoolKey({
            currency0: RealCurrency.wrap(address(token0)),
            currency1: RealCurrency.wrap(address(token1)),
            fee: 500,
            tickSpacing: 60,
            hooks: RealIHooks(address(0))
        });

        hookLocalKey = PoolKey({
            currency0: Currency.wrap(address(token0)),
            currency1: Currency.wrap(address(token1)),
            fee: 3000,
            tickSpacing: 60,
            hooks: realHookAddr
        });
        standardLocalKey = PoolKey({
            currency0: Currency.wrap(address(token0)),
            currency1: Currency.wrap(address(token1)),
            fee: 500,
            tickSpacing: 60,
            hooks: address(0)
        });

        realManager.initialize(hookRealKey, SQRT_PRICE_1_1);
        realManager.initialize(standardRealKey, SQRT_PRICE_1_1);
        realHook.setAuthorizedPool(_localId(realHookAddr), true);

        PoolModifyLiquidityTest lq = new PoolModifyLiquidityTest(realManager);
        token0.approve(address(lq), type(uint256).max);
        token1.approve(address(lq), type(uint256).max);
        RealIPoolManager.ModifyLiquidityParams memory lp =
            RealIPoolManager.ModifyLiquidityParams({tickLower: -60, tickUpper: 60, liquidityDelta: 1e23, salt: 0});
        lq.modifyLiquidity(hookRealKey, lp, "");
        lq.modifyLiquidity(standardRealKey, lp, "");

        realHook.setTokenDecimals(address(token0), 18);
        realHook.setTokenDecimals(address(token1), 18);
        priceFeed.setPrice(address(token0), 1e18);
        priceFeed.setPrice(address(token1), 1e18);

        token0.transfer(trader, 1_000 ether);
        token0.transfer(solver, 1_000 ether);
        vm.prank(trader);
        token0.approve(address(router), type(uint256).max);
        vm.prank(solver);
        token0.approve(address(router), type(uint256).max);
        // For the inline unlockCallback simulation the unlock caller is this test.
        vm.prank(trader);
        token0.approve(address(this), type(uint256).max);
        vm.prank(solver);
        token0.approve(address(this), type(uint256).max);
    }

    function _localId(address hookAddr) internal view returns (PoolId) {
        PoolKey memory k = PoolKey({
            currency0: Currency.wrap(address(token0)),
            currency1: Currency.wrap(address(token1)),
            fee: 3000,
            tickSpacing: 60,
            hooks: hookAddr
        });
        return k.toId();
    }

    /// @dev Post-fix regression proof: the router's single-pool open passes a
    ///      VALID full-range sqrtPriceLimitX96 ([FIX V1]) and leaves no un-netted
    ///      deltas ([FIX V2]), so the real PoolManager accepts the transaction and
    ///      the position is recorded on the hook.
    function test_RealPM_RouterOpen_SucceedsAfterFixes() public {
        bytes memory hookData = abi.encode(true, uint8(2), trader);
        EswapRouter.SwapParams memory params = EswapRouter.SwapParams({
            key: hookLocalKey,
            standardPoolKey: standardLocalKey,
            zeroForOne: true,
            amountSpecified: -int256(MARGIN),
            leverage: 2,
            solver: solver,
            hookData: hookData,
            deadline: block.timestamp + 15 minutes
        });
        vm.prank(trader);
        router.swap(params);
        // Reaching here means the real PoolManager did NOT revert
        // (PriceLimitOutOfBounds / CurrencyNotSettled).
        uint160 limit = EswapMarginLib.sqrtPriceLimit(true);
        assertEq(limit, MIN_SQRT + 1, "valid full-range limit used");
        (address posTrader, uint256 collateral, uint256 borrowed,,,,,,) =
            realHook.positions(hookLocalKey.toId(), trader);
        assertEq(posTrader, trader, "position recorded on the real PM");
        assertEq(borrowed, BORROW);
        assertGt(collateral, 0);
    }

    /// @dev Bridge/intent executor flow: a third party relays swapFor() and the
    ///      position is owned by `trader`, with margin pulled from `trader`
    ///      (router allowance), not from the executor.
    function test_RealPM_ExecutorSwapFor_RecordsTraderPosition() public {
        bytes memory hookData = abi.encode(true, uint8(2), trader);
        EswapRouter.SwapParams memory params = EswapRouter.SwapParams({
            key: hookLocalKey,
            standardPoolKey: standardLocalKey,
            zeroForOne: true,
            amountSpecified: -int256(MARGIN),
            leverage: 2,
            solver: solver,
            hookData: hookData,
            deadline: block.timestamp + 15 minutes
        });
        address executor = makeAddr("executor");
        vm.prank(executor);
        router.swapFor(params, trader);
        (address posTrader, uint256 collateral, uint256 borrowed,,,,,,) =
            realHook.positions(hookLocalKey.toId(), trader);
        assertEq(posTrader, trader, "position owned by trader, not executor");
        assertEq(borrowed, BORROW);
        assertGt(collateral, 0);
        assertEq(token0.balanceOf(executor), 0, "executor funds untouched");
    }

    /// @dev Simulates the exact multi-pool open callback (with valid price limits)
    ///      and proves the real PoolManager reverts CurrencyNotSettled because the
    ///      router never nets its standard-pool input leg nor takes the hook-pool
    ///      accounting output.
    function test_RealPM_MultiPool_Deltas_DoNotNet() public {
        vm.expectRevert(abi.encodeWithSignature("CurrencyNotSettled()"));
        realManager.unlock(abi.encode(1));
    }

    /// @dev Single-pool (legacy) open nets cleanly on the real PM when a valid
    ///      price limit is used: margin settled, borrow settledFor(hook), output
    ///      minted to the hook as the 6909 claim. Proves single-pool mode is the
    ///      viable fallback once the sqrtPriceLimit bug is fixed.
    function test_RealPM_SinglePool_Inline_NetsDeltas() public {
        realManager.unlock(abi.encode(2));
        // Reaching here means the unlock did NOT revert CurrencyNotSettled.
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        require(msg.sender == address(realManager), "not pm");
        uint256 mode = abi.decode(data, (uint256));

        RealCurrency rInput = RealCurrency.wrap(address(token0));
        uint256 outputId = uint256(uint160(address(token1)));

        if (mode == 1) {
            // ---- MULTI-POOL (mirrors EswapRouter._swapCallback) ----
            // (1) accounting swap on the hook pool (flash-expanded to margin+borrow)
            realManager.swap(
                hookRealKey,
                RealIPoolManager.SwapParams(true, -int256(MARGIN), MIN_SQRT + 1),
                abi.encode(true, uint8(2), trader)
            );
            // (2) settle trader margin
            realManager.sync(rInput);
            token0.transferFrom(trader, address(realManager), MARGIN);
            realManager.settle();
            // (3) physical swap on the standard pool
            BalanceDelta deltaPhysical = realManager.swap(
                standardRealKey, RealIPoolManager.SwapParams(true, -int256(MARGIN + BORROW), MIN_SQRT + 1), ""
            );
            uint256 outputAmount = uint256(int256(deltaPhysical.amount1()));
            // (4) mint collateral claim to the hook
            realManager.mint(address(realHookAddr), outputId, outputAmount);
            // (5) settle solver borrow for the hook
            realManager.sync(rInput);
            token0.transferFrom(solver, address(realManager), BORROW);
            realManager.settleFor(address(realHookAddr));
        } else if (mode == 2) {
            // ---- SINGLE-POOL (legacy) ----
            // (1) single physical+accounting swap on the hook pool
            BalanceDelta d = realManager.swap(
                hookRealKey,
                RealIPoolManager.SwapParams(true, -int256(MARGIN), MIN_SQRT + 1),
                abi.encode(true, uint8(2), trader)
            );
            uint256 outputAmount = uint256(int256(d.amount1()));
            // (2) settle trader margin
            realManager.sync(rInput);
            token0.transferFrom(trader, address(realManager), MARGIN);
            realManager.settle();
            // (3) mint the SAME swap output as the collateral claim
            realManager.mint(address(realHookAddr), outputId, outputAmount);
            // (4) settle solver borrow for the hook
            realManager.sync(rInput);
            token0.transferFrom(solver, address(realManager), BORROW);
            realManager.settleFor(address(realHookAddr));
        }

        return "";
    }
}
