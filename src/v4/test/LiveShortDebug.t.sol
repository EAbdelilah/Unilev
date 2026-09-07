// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {EswapMarginHook} from "../EswapMarginHook.sol";
import {EswapRouter} from "../EswapRouter.sol";
import {PoolKey} from "../types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "../types/PoolId.sol";
import {Currency} from "../types/Currency.sol";

/// @notice DEBUG: reproduce the live SHORT open against the NEW deployment on a
///         Unichain fork and print every intermediate reverting frame. The live
///         attempt (margin 0.0002 WETH, 5x) reverts CurrencyNotSettled after
///         MultiPoolMarginOpened; this forks the exact call to isolate the broken
///         sync/settle/mint/take ordering in _multiPoolSwapCallback.
contract LiveShortDebug is Test {
    using PoolIdLibrary for PoolKey;

    address payable constant LIVE_ROUTER = payable(0x4c14D923E9A9f64Da6684b77E07B33c76D0B3d60);
    address constant LIVE_HOOK = 0x4bd2C1e73d150b65EF88DBa247Ed60A1538310c8;
    address constant LIVE_SOLVER = 0x518634753C61342298c3E04326056b3Ce596a566;

    address constant WETH = 0x4200000000000000000000000000000000000006;
    address constant USDC = 0x078D782b760474a361dDA0AF3839290b0EF57AD6;

    address trader;

    function setUp() public {
        vm.createSelectFork(vm.envString("UNICHAIN_RPC_URL"));
        trader = makeAddr("trader");
        deal(WETH, trader, 10 ether);
        deal(WETH, LIVE_SOLVER, 10 ether);
        deal(USDC, trader, 50_000e6);
        deal(USDC, LIVE_SOLVER, 50_000e6);
        vm.startPrank(LIVE_SOLVER);
        IERC20(WETH).approve(LIVE_ROUTER, type(uint256).max);
        IERC20(USDC).approve(LIVE_ROUTER, type(uint256).max);
        vm.stopPrank();
        vm.startPrank(trader);
        IERC20(WETH).approve(LIVE_ROUTER, type(uint256).max);
        IERC20(USDC).approve(LIVE_ROUTER, type(uint256).max);
        vm.stopPrank();
    }

    function _hookKey() internal view returns (PoolKey memory) {
        return PoolKey(Currency.wrap(USDC), Currency.wrap(WETH), 3000, 60, LIVE_HOOK);
    }

    function _stdKey() internal view returns (PoolKey memory) {
        return PoolKey(Currency.wrap(USDC), Currency.wrap(WETH), 500, 60, address(0));
    }

    function _attempt(bool zeroForOne, uint256 marginRaw, uint8 leverage) internal {
        PoolKey memory hookKey = _hookKey();
        PoolKey memory stdKey = _stdKey();
        bytes memory hookData = abi.encode(true, leverage, trader);

        EswapRouter.SwapParams memory params = EswapRouter.SwapParams({
            key: hookKey,
            standardPoolKey: stdKey,
            zeroForOne: zeroForOne,
            amountSpecified: -int256(marginRaw),
            leverage: leverage,
            solver: LIVE_SOLVER,
            hookData: hookData,
            deadline: block.timestamp + 15 minutes
        });

        vm.prank(trader);
        try EswapRouter(LIVE_ROUTER).swapMultiPool(params) returns (bytes memory) {
            emit log("SUCCESS");
        } catch Error(string memory reason) {
            emit log(string(abi.encodePacked("REVERT (string): ", reason)));
        } catch Panic(uint256 code) {
            emit log(string(abi.encodePacked("REVERT (panic 0x): ", vm.toString(code))));
        } catch (bytes memory lowLevelData) {
            emit log(string(abi.encodePacked("REVERT (low-level): ", vm.toString(lowLevelData))));
        }
    }

    function test_ReproduceLiveShort() public {
        emit log("-- Deltas for hook pool: USDC/WETH 3000/60 --");
        emit log("-- Std pool: USDC/WETH 500/60 --");
        _attempt(false, 200000000000000, 5);
    }

    function test_Short1x() public {
        _attempt(false, 200000000000000, 1);
    }

    function test_Short2x() public {
        _attempt(false, 200000000000000, 2);
    }

    function test_Long1x() public {
        _attempt(true, 500000, 1);
    }
}

interface IERC20 {
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address) external view returns (uint256);
}