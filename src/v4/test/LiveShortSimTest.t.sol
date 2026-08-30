// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {EswapMarginHook} from "../EswapMarginHook.sol";
import {EswapRouter} from "../EswapRouter.sol";
import {PoolKey} from "../types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "../types/PoolId.sol";
import {Currency} from "../types/Currency.sol";

/// @notice LIVE-deployment ground truth (Unichain mainnet fork): opens a SHORT
///         WETH through the ACTUAL deployed router/hook — the exact call the
///         frontend's useV4Position sends. Uses the WRAPPED WETH / USDC pool the
///         live hook authorizes (fee 3000, tick 60; standard fill 500 / 60).
contract LiveShortSimTest is Test {
    using PoolIdLibrary for PoolKey;

    address payable constant LIVE_ROUTER = payable(0x1244a9977368A09aA38619D92959A78638Ac0DEa);
    address constant LIVE_HOOK = 0xe3574Bc94557378fD944cdF1EE2F56f7c12d90c8;
    address constant LIVE_SOLVER = 0x518634753C61342298c3E04326056b3Ce596a566;

    address constant WETH = 0x4200000000000000000000000000000000000006;
    address constant USDC = 0x078D782b760474a361dDA0AF3839290b0EF57AD6;

    address trader = makeAddr("trader");

    function setUp() public {
        vm.createSelectFork(vm.envString("UNICHAIN_RPC_URL"));
    }

    function test_LiveShortWETH5x_Opens() public {
        // Fund trader with wrapped WETH (margin leg) + USDC
        deal(WETH, trader, 10 ether);
        deal(USDC, trader, 50_000e6);
        // Fund the LIVE SOLVER with WETH — the router pulls the borrow leg from
        // the solver wallet (transferFrom solver -> manager).
        deal(WETH, LIVE_SOLVER, 10 ether);
        deal(USDC, LIVE_SOLVER, 50_000e6);
        vm.startPrank(LIVE_SOLVER);
        IERC20(WETH).approve(LIVE_ROUTER, type(uint256).max);
        IERC20(USDC).approve(LIVE_ROUTER, type(uint256).max);
        vm.stopPrank();
        vm.startPrank(trader);
        IERC20(WETH).approve(LIVE_ROUTER, type(uint256).max);
        IERC20(USDC).approve(LIVE_ROUTER, type(uint256).max);
        vm.stopPrank();

        // Live hook authorizes USDC/WETH-token 3000/60; std fill is 500/60.
        PoolKey memory hookKey = PoolKey({
            currency0: Currency.wrap(USDC),
            currency1: Currency.wrap(WETH),
            fee: 3000,
            tickSpacing: 60,
            hooks: LIVE_HOOK
        });
        PoolKey memory stdKey = PoolKey({
            currency0: Currency.wrap(USDC),
            currency1: Currency.wrap(WETH),
            fee: 500,
            tickSpacing: 60,
            hooks: address(0)
        });

        bytes32 poolId = PoolId.unwrap(hookKey.toId());
        assertTrue(EswapMarginHook(payable(LIVE_HOOK)).isAuthorizedPool(hookKey.toId()), "live pool not authorized");
        assertTrue(EswapRouter(LIVE_ROUTER).registeredSolvers(LIVE_SOLVER), "solver not whitelisted");

        // SHORT WETH 5x: margin = 0.01 WETH -> sell WETH (currency1) for USDC => zeroForOne=false.
        uint256 marginWeth = 0.01 ether;
        uint8 leverage = 5;
        bytes memory hookData = abi.encode(true, uint8(leverage), trader);

        EswapRouter.SwapParams memory params = EswapRouter.SwapParams({
            key: hookKey,
            standardPoolKey: stdKey,
            zeroForOne: false,
            amountSpecified: -int256(marginWeth),
            leverage: leverage,
            solver: LIVE_SOLVER,
            hookData: hookData
        });

        vm.prank(trader);
        try EswapRouter(LIVE_ROUTER).swapMultiPool(params) returns (bytes memory res) {
            emit log("SUCCESS: live SHORT WETH 5x opened");
            emit log_bytes32(keccak256(res));
        } catch Error(string memory reason) {
            emit log(string(abi.encodePacked("REVERT (string): ", reason)));
            fail();
        } catch Panic(uint256 code) {
            emit log(string(abi.encodePacked("REVERT (panic 0x): ", vm.toString(code))));
            fail();
        } catch (bytes memory lowLevelData) {
            emit log(string(abi.encodePacked("REVERT (low-level): ", vm.toString(lowLevelData))));
            fail();
        }
    }

    /// @notice Full recovery recipe for the live deployment, validated on a fork:
    ///         owner restores the default OI-cap config (floor $100k => caps are
    ///         INACTIVE at current tracked TVL) and the solver is funded with the
    ///         short input token (WETH). After that the exact frontend SHORT call
    ///         succeeds.
    function test_LiveShortWETH5x_OpensAfterCapsFix() public {
        vm.prank(LIVE_SOLVER);
        EswapMarginHook(payable(LIVE_HOOK)).setOpenInterestCaps(200, 1500, 100000 ether);
        (bool capsActive,,, uint256 maxSingle, uint256 remaining) =
            EswapMarginHook(payable(LIVE_HOOK)).openInterestCapacity();
        assertFalse(capsActive, "OI caps should be inactive after floor restore");

        deal(WETH, trader, 10 ether);
        deal(WETH, LIVE_SOLVER, 10 ether);
        vm.startPrank(LIVE_SOLVER);
        IERC20(WETH).approve(LIVE_ROUTER, type(uint256).max);
        vm.stopPrank();
        vm.startPrank(trader);
        IERC20(WETH).approve(LIVE_ROUTER, type(uint256).max);
        vm.stopPrank();

        PoolKey memory hookKey = PoolKey({
            currency0: Currency.wrap(USDC),
            currency1: Currency.wrap(WETH),
            fee: 3000,
            tickSpacing: 60,
            hooks: LIVE_HOOK
        });
        PoolKey memory stdKey = PoolKey({
            currency0: Currency.wrap(USDC),
            currency1: Currency.wrap(WETH),
            fee: 500,
            tickSpacing: 60,
            hooks: address(0)
        });

        uint256 marginWeth = 0.01 ether;
        uint8 leverage = 5;
        bytes memory hookData = abi.encode(true, uint8(leverage), trader);

        EswapRouter.SwapParams memory params = EswapRouter.SwapParams({
            key: hookKey,
            standardPoolKey: stdKey,
            zeroForOne: false,
            amountSpecified: -int256(marginWeth),
            leverage: leverage,
            solver: LIVE_SOLVER,
            hookData: hookData
        });

        vm.prank(trader);
        try EswapRouter(LIVE_ROUTER).swapMultiPool(params) returns (bytes memory res) {
            emit log("SUCCESS: live SHORT WETH 5x opened after owner caps fix + solver funding");
            emit log_bytes32(keccak256(res));
        } catch Error(string memory reason) {
            emit log(string(abi.encodePacked("REVERT (string): ", reason)));
            fail();
        } catch Panic(uint256 code) {
            emit log(string(abi.encodePacked("REVERT (panic 0x): ", vm.toString(code))));
            fail();
        } catch (bytes memory lowLevelData) {
            emit log(string(abi.encodePacked("REVERT (low-level): ", vm.toString(lowLevelData))));
            fail();
        }
    }
}

interface IERC20 {
    function approve(address, uint256) external returns (bool);
    function balanceOf(address) external view returns (uint256);
}