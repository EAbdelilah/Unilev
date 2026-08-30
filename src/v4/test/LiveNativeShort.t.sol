// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {EswapMarginHook} from "../EswapMarginHook.sol";
import {EswapRouter} from "../EswapRouter.sol";
import {PoolKey} from "../types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "../types/PoolId.sol";
import {Currency} from "../types/Currency.sol";

/// @notice NATIVE-ETH/USDC path on the LIVE deployment (fork): re-point the hook
///         accounting pool to (ETH-native, USDC) 3000/60, bind the standard fill
///         key to the DEEP ETH/USDC fee-500 tick-10 pool (the $5.4M venue,
///         PoolId 0x3258...), then open a SHORT selling native ETH. This is the
///         configuration the dashboard sends once useV4Position targets ETH/USDC.
contract LiveNativeShort is Test {
    using PoolIdLibrary for PoolKey;

    address payable constant LIVE_ROUTER = payable(0x4c14D923E9A9f64Da6684b77E07B33c76D0B3d60);
    address constant LIVE_HOOK = 0x4bd2C1e73d150b65EF88DBa247Ed60A1538310c8;
    address constant OWNER = 0x518634753C61342298c3E04326056b3Ce596a566;
    address constant SOLVER = 0x518634753C61342298c3E04326056b3Ce596a566;

    address constant ETH = 0x0000000000000000000000000000000000000000;
    address constant USDC = 0x078D782b760474a361dDA0AF3839290b0EF57AD6;

    PoolId nativePoolId;
    PoolKey nativeHookKey;
    PoolKey deepStdKey;
    address trader;

    function setUp() public {
        vm.createSelectFork(vm.envString("UNICHAIN_RPC_URL"));
        trader = makeAddr("trader");
        nativeHookKey = PoolKey(Currency.wrap(ETH), Currency.wrap(USDC), 3000, 60, LIVE_HOOK);
        nativePoolId = nativeHookKey.toId();
        deepStdKey = PoolKey(Currency.wrap(ETH), Currency.wrap(USDC), 500, 10, address(0));
    }

    function _forceUsdc(address who, uint256 amount) internal {
        if (IERC20Like(USDC).balanceOf(who) < amount) {
            vm.store(
                USDC, bytes32(uint256(keccak256(abi.encode(who, uint256(0))))), bytes32(uint256(amount))
            );
        }
    }

    function _repurposeHook() internal {
        vm.startPrank(OWNER);
        EswapMarginHook(payable(LIVE_HOOK)).setAuthorizedPool(nativeHookKey.toId(), true);
        EswapMarginHook(payable(LIVE_HOOK)).setStandardPoolKey(nativeHookKey.toId(), deepStdKey);
        EswapMarginHook(payable(LIVE_HOOK)).setBaseCurrency(nativeHookKey.toId(), Currency.wrap(ETH));
        vm.stopPrank();
    }

    function _attempt(uint8 leverage, uint256 marginWei) internal {
        bytes memory hookData = abi.encode(true, leverage, trader);
        uint256 notional = marginWei * uint256(leverage);
        EswapRouter.SwapParams memory params = EswapRouter.SwapParams({
            key: nativeHookKey,
            standardPoolKey: deepStdKey,
            zeroForOne: true, // sell native ETH (currency0), buy USDC -> SHORT
            amountSpecified: -int256(marginWei),
            leverage: leverage,
            solver: SOLVER,
            hookData: hookData
        });
        vm.deal(trader, 10 ether);
        vm.startPrank(trader);
        try EswapRouter(LIVE_ROUTER).swapMultiPool{value: notional}(params) returns (bytes memory) {
            emit log("SUCCESS");
        } catch Error(string memory reason) {
            emit log(string(abi.encodePacked("REVERT (string): ", reason)));
        } catch Panic(uint256 code) {
            emit log(string(abi.encodePacked("REVERT (panic): ", vm.toString(code))));
        } catch (bytes memory lowLevelData) {
            emit log(string(abi.encodePacked("REVERT (low-level): ", vm.toString(lowLevelData))));
        }
        vm.stopPrank();
    }

    function test_NativeShort1x() public {
        _repurposeHook();
        emit log_named_uint("nativePoolId", uint256(PoolId.unwrap(nativePoolId)));
        _attempt(1, 0.0002 ether);
        _printPosition();
    }

    function test_NativeShort2x() public {
        _repurposeHook();
        _attempt(2, 0.0002 ether);
        _printPosition();
    }

    function test_NativeShort5x() public {
        _repurposeHook();
        _attempt(5, 0.0002 ether);
        _printPosition();
    }

    function test_NativeShort2x_Close() public {
        _repurposeHook();
        _attempt(2, 0.0002 ether);
        uint256 ethBefore = trader.balance;
        vm.startPrank(trader);
        try EswapRouter(LIVE_ROUTER).closePosition(LIVE_HOOK, nativeHookKey, trader, SOLVER, 0) {
            emit log("CLOSE SUCCESS");
        } catch (bytes memory lowLevelData) {
            emit log(string(abi.encodePacked("CLOSE REVERT: ", vm.toString(lowLevelData))));
        }
        vm.stopPrank();
        emit log_named_uint("traderEthAfter", trader.balance);
        emit log_named_uint("traderEthDelta", (trader.balance - ethBefore));
        _printPosition();
    }

    function test_NativeLong5x() public {
        _repurposeHook();
        uint256 marginUsdc = 0.5e6; // 0.5 USDC
        uint256 notionalUsdc = marginUsdc * 5;
        deal(USDC, trader, notionalUsdc * 20);
        deal(USDC, SOLVER, notionalUsdc * 20);
        // Unichain native USDC isn't a standard-storage ERC20; force the balance slot.
        _forceUsdc(trader, notionalUsdc * 20);
        _forceUsdc(SOLVER, notionalUsdc * 20);
        bytes memory hookData = abi.encode(true, 5, trader);
        EswapRouter.SwapParams memory params = EswapRouter.SwapParams({
            key: nativeHookKey,
            standardPoolKey: deepStdKey,
            zeroForOne: false, // buy native ETH (currency0) with USDC -> LONG
            amountSpecified: -int256(marginUsdc),
            leverage: 5,
            solver: SOLVER,
            hookData: hookData
        });
        vm.startPrank(trader);
        IERC20Like(USDC).approve(LIVE_ROUTER, type(uint256).max);
        try EswapRouter(LIVE_ROUTER).swapMultiPool(params) returns (bytes memory) {
            emit log("LONG SUCCESS");
        } catch (bytes memory lowLevelData) {
            emit log(string(abi.encodePacked("LONG REVERT: ", vm.toString(lowLevelData))));
        }
        vm.stopPrank();
        uint256 nativeOutput = address(trader).balance; // note: msg.value was 0; output ETH accrues to hook/router
        emit log_named_uint("traderNativeBalanceTotal", nativeOutput);
        _printPosition();
        emit log_named_uint("hookEthBalance", address(payable(LIVE_HOOK)).balance);
        emit log_named_uint("routerEthBalance", address(payable(LIVE_ROUTER)).balance);
    }

    function test_NativeLong5x_Close() public {
        _repurposeHook();
        uint256 marginUsdc = 0.5e6; // 0.5 USDC
        uint256 notionalUsdc = marginUsdc * 5;
        deal(USDC, trader, notionalUsdc * 20);
        deal(USDC, SOLVER, notionalUsdc * 20);
        _forceUsdc(trader, notionalUsdc * 20);
        _forceUsdc(SOLVER, notionalUsdc * 20);
        bytes memory hookData = abi.encode(true, 5, trader);
        EswapRouter.SwapParams memory params = EswapRouter.SwapParams({
            key: nativeHookKey,
            standardPoolKey: deepStdKey,
            zeroForOne: false,
            amountSpecified: -int256(marginUsdc),
            leverage: 5,
            solver: SOLVER,
            hookData: hookData
        });
        vm.startPrank(trader);
        IERC20Like(USDC).approve(LIVE_ROUTER, type(uint256).max);
        try EswapRouter(LIVE_ROUTER).swapMultiPool(params) returns (bytes memory) {
            emit log("LONG SUCCESS");
        } catch (bytes memory lowLevelData) {
            emit log(string(abi.encodePacked("LONG REVERT: ", vm.toString(lowLevelData))));
        }
        uint256 usdcBefore = IERC20Like(USDC).balanceOf(trader);
        try EswapRouter(LIVE_ROUTER).closePosition(LIVE_HOOK, nativeHookKey, trader, SOLVER, 0) {
            emit log("LONG CLOSE SUCCESS");
        } catch (bytes memory lowLevelData) {
            emit log(string(abi.encodePacked("LONG CLOSE REVERT: ", vm.toString(lowLevelData))));
        }
        vm.stopPrank();
        uint256 usdcAfter = IERC20Like(USDC).balanceOf(trader);
        emit log_named_uint("traderUsdcRefund", usdcAfter - usdcBefore);
        emit log_named_int(
            "traderUsdcNetPnlBps",
            int256(usdcAfter) - int256(notionalUsdc * 20) - int256(0)
        );
    }

    function _printPosition() internal {
        EswapMarginHook hook = EswapMarginHook(payable(LIVE_HOOK));
        (address t0, uint256 coll, uint256 borr, uint8 lev, bool isLong, uint160 liqPrice, int24 tLow, int24 tUp, uint128 liq) = hook.positions(nativePoolId, trader);
        emit log_named_address("posTrader", t0);
        emit log_named_uint("collateralRaw", coll);
        emit log_named_uint("borrowedRaw", borr);
        emit log_named_uint("leverage", uint256(lev));
        emit log_named_string("isLong", isLong ? "true" : "false");
        emit log_named_uint("positionLiquidity", uint256(liq));
    }
}

interface IERC20Like {
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}