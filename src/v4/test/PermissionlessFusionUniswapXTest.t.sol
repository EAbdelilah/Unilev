// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {EswapMarginHook} from "../EswapMarginHook.sol";
import {EswapMarginHookLogic} from "../EswapMarginHookLogic.sol";
import {EswapRouter} from "../EswapRouter.sol";
import {EswapOneInchFusionSettlement} from "../EswapOneInchFusionSettlement.sol";
import {EswapUniswapXSettlement} from "../EswapUniswapXSettlement.sol";
import {PoolKey} from "../types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "../types/PoolId.sol";
import {Currency} from "../types/Currency.sol";
import {IPoolManager} from "../interfaces/IPoolManager.sol";
import {PriceFeedMock} from "./BaseV4Test.t.sol";
import {EswapHookDeployLib} from "./EswapHookDeployLib.sol";

import {IPoolManager as RealIPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {IHooks as RealIHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey as RealPoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency as RealCurrency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {IERC20 as RealIERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract PermissionlessFusionUniswapXTest is Test, IUnlockCallback {
    using PoolIdLibrary for PoolKey;

    address constant BASE_PM = 0x498581fF718922c3f8e6A244956aF099B2652b2b;
    address constant BASE_USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address constant BASE_WETH = 0x4200000000000000000000000000000000000006;

    uint160 constant HIGH_FLAGS = (1 << 159) | (1 << 158) | (1 << 153) | (1 << 152) | (1 << 148);
    uint160 constant LOW_FLAGS = (1 << 13) | (1 << 12) | (1 << 7) | (1 << 6) | (1 << 3);
    int24 constant LP_HALF_WIDTH = 2400;
    int24 constant INIT_TICK = -198673;

    uint256 constant SOLVER_BALANCE = 50_000e6;
    uint256 constant MARGIN = 1_000e6;
    uint8 constant LEVERAGE = 5;
    uint256 constant BORROW = MARGIN * (LEVERAGE - 1);

    RealIPoolManager pm;
    EswapMarginHook hook;
    EswapRouter router;
    EswapOneInchFusionSettlement fusionSettlement;
    EswapUniswapXSettlement uxSettlement;
    PriceFeedMock priceFeed;

    PoolKey hookKey;
    PoolKey standardKey;

    address treasury = makeAddr("protocolTreasury");
    address solver = makeAddr("anonymousMarketMaker");
    address trader = makeAddr("trader");

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        (RealPoolKey memory key, int24 tl, int24 tu, int128 liq) = abi.decode(data, (RealPoolKey, int24, int24, int128));
        (BalanceDelta delta,) = pm.modifyLiquidity(
            key,
            RealIPoolManager.ModifyLiquidityParams({tickLower: tl, tickUpper: tu, liquidityDelta: liq, salt: bytes32(0)}),
            ""
        );
        if (delta.amount0() < 0) {
            pm.sync(RealCurrency.wrap(BASE_WETH));
            RealIERC20(BASE_WETH).transfer(address(pm), uint256(-int256(delta.amount0())));
            pm.settle();
        } else if (delta.amount0() > 0) {
            pm.take(RealCurrency.wrap(BASE_WETH), address(this), uint256(uint128(delta.amount0())));
        }
        if (delta.amount1() < 0) {
            pm.sync(RealCurrency.wrap(BASE_USDC));
            RealIERC20(BASE_USDC).transfer(address(pm), uint256(-int256(delta.amount1())));
            pm.settle();
        } else if (delta.amount1() > 0) {
            pm.take(RealCurrency.wrap(BASE_USDC), address(this), uint256(uint128(delta.amount1())));
        }
        return bytes("");
    }

    function setUp() public {
        string memory rpcUrl = vm.envOr("BASE_RPC_URL", string("https://mainnet.base.org"));
        vm.createSelectFork(rpcUrl);
        if (block.chainid != 8453) return;

        pm = RealIPoolManager(BASE_PM);
        priceFeed = new PriceFeedMock();

        address hookAddr = address(uint160(HIGH_FLAGS | LOW_FLAGS));
        (address logic1, address logic2) = EswapHookDeployLib.deployLogic(address(pm), address(priceFeed));
        deployCodeTo(
            "EswapMarginHook.sol:EswapMarginHook",
            abi.encode(address(pm), address(priceFeed), logic1, logic2, address(this)),
            hookAddr
        );
        hook = EswapMarginHook(payable(hookAddr));

        router = new EswapRouter(IPoolManager(BASE_PM));
        fusionSettlement = new EswapOneInchFusionSettlement(router);
        uxSettlement = new EswapUniswapXSettlement(router);

        hook.setRouterAndMinCollateralUsd(address(router), 0);
        hook.setConfig(
            EswapMarginHook.ConfigParams({
                treasury: treasury,
                router: address(router),
                reserveFactor: 10,
                maxPriceSwingBps: 800,
                defaultMaxLeverage: 5,
                requireTwapOracle: false
            })
        );

        hookKey = PoolKey({
            currency0: Currency.wrap(BASE_WETH),
            currency1: Currency.wrap(BASE_USDC),
            fee: 3000,
            tickSpacing: 60,
            hooks: hookAddr
        });
        standardKey = PoolKey({
            currency0: Currency.wrap(BASE_WETH),
            currency1: Currency.wrap(BASE_USDC),
            fee: 3000,
            tickSpacing: 60,
            hooks: address(0)
        });

        RealPoolKey memory stdReal = _realKey(address(0));
        RealPoolKey memory hookReal = _realKey(hookAddr);
        uint160 initSqrt = TickMath.getSqrtPriceAtTick(INIT_TICK);
        (uint160 stdSqrt,,,) = StateLibrary.getSlot0(pm, stdReal.toId());
        if (stdSqrt == 0) {
            pm.initialize(stdReal, initSqrt);
            stdSqrt = initSqrt;
        }
        (uint160 hookSqrt,,,) = StateLibrary.getSlot0(pm, hookReal.toId());
        if (hookSqrt == 0) pm.initialize(hookReal, stdSqrt);

        EswapMarginHookLogic(payable(hookAddr)).setAuthorizedPool(hookKey.toId(), true);
        EswapMarginHookLogic(payable(hookAddr)).setStandardPoolKey(hookKey.toId(), standardKey);
        EswapMarginHookLogic(payable(hookAddr)).setBaseCurrency(hookKey.toId(), Currency.wrap(BASE_WETH));
        EswapMarginHookLogic(payable(hookAddr)).setTokenDecimals(BASE_WETH, 18);
        EswapMarginHookLogic(payable(hookAddr)).setTokenDecimals(BASE_USDC, 6);

        priceFeed.setPrice(BASE_USDC, 1e18);
        priceFeed.setPrice(BASE_WETH, _wethUsd18FromSqrt(stdSqrt));

        _seedLiquidity(hookReal, stdReal, stdSqrt);

        deal(BASE_USDC, solver, SOLVER_BALANCE);
        deal(BASE_USDC, trader, MARGIN);
    }

    function _realKey(address hooksAddr) internal pure returns (RealPoolKey memory) {
        return RealPoolKey({
            currency0: RealCurrency.wrap(BASE_WETH),
            currency1: RealCurrency.wrap(BASE_USDC),
            fee: 3000,
            tickSpacing: 60,
            hooks: RealIHooks(hooksAddr)
        });
    }

    function _seedLiquidity(RealPoolKey memory hookReal, RealPoolKey memory stdReal, uint160) internal {
        int24 tickLower = _floorToSpacing(INIT_TICK - LP_HALF_WIDTH, 60);
        int24 tickUpper = _floorToSpacing(INIT_TICK + LP_HALF_WIDTH, 60);
        uint256 wethForOneSide = 5_000 ether;
        (uint160 sqrtL,,,) = StateLibrary.getSlot0(pm, hookReal.toId());
        uint256 usdcForOneSide = _usdcForWeth(wethForOneSide, sqrtL);
        uint256 wethLp = wethForOneSide * 100;
        uint256 usdcLp = usdcForOneSide * 100;
        deal(BASE_WETH, address(this), wethLp + wethLp);
        deal(BASE_USDC, address(this), usdcLp + usdcLp);
        RealIERC20(BASE_WETH).approve(address(pm), type(uint256).max);
        RealIERC20(BASE_USDC).approve(address(pm), type(uint256).max);
        pm.unlock(abi.encode(hookReal, tickLower, tickUpper, int128(int256(wethLp > usdcLp ? usdcLp : wethLp) / 2)));
        pm.unlock(abi.encode(stdReal, tickLower, tickUpper, int128(int256(wethLp > usdcLp ? usdcLp : wethLp) / 2)));
    }

    function _floorToSpacing(int24 tick, int24 spacing) internal pure returns (int24) {
        int24 c = tick / spacing;
        if (tick < 0 && tick % spacing != 0) c -= 1;
        return c * spacing;
    }

    function _usdcForWeth(uint256 wethAmount, uint160 sqrtPriceX96) internal pure returns (uint256) {
        uint256 priceX192 = uint256(sqrtPriceX96) * uint256(sqrtPriceX96);
        return FullMath.mulDiv(wethAmount, priceX192, 2 ** 192) / 1e12;
    }

    function _wethUsd18FromSqrt(uint160 sqrtPriceX96) internal pure returns (uint256) {
        uint256 priceX192 = uint256(sqrtPriceX96) * uint256(sqrtPriceX96);
        uint256 usdcPerWadWeth = FullMath.mulDiv(priceX192, 1e6, 2 ** 192);
        return usdcPerWadWeth * 1e12;
    }

    function _bondEscrow(uint256 amount) internal {
        vm.startPrank(solver);
        RealIERC20(BASE_USDC).approve(address(router), amount);
        router.depositBorrowEscrow(BASE_USDC, amount);
        vm.stopPrank();
    }

    function test_PermissionlessFusionFill_OpensPosition_SolverGetsRepayment() public {
        if (block.chainid != 8453) vm.skip(true);

        assertFalse(router.registeredSolvers(solver), "solver not registered");
        _bondEscrow(BORROW);

        vm.startPrank(trader);
        RealIERC20(BASE_USDC).approve(address(fusionSettlement), MARGIN);
        vm.stopPrank();

        EswapOneInchFusionSettlement.FillParams memory p = EswapOneInchFusionSettlement.FillParams({
            trader: trader,
            marginToken: BASE_USDC,
            margin: MARGIN,
            leverage: LEVERAGE,
            key: hookKey,
            standardPoolKey: standardKey,
            minAmountOut: 0,
            deadline: block.timestamp + 1 hours
        });
        vm.prank(solver);
        fusionSettlement.fill(p);

        PoolId poolId = hookKey.toId();
        assertEq(hook.positionSolver(poolId, trader), solver, "solver recorded");
        (, , uint256 borrowed, uint8 lev, , , , , ) = hook.positions(poolId, trader);
        assertGt(borrowed, 0, "opened");
        assertEq(borrowed, BORROW, "borrow == 4x margin");
        assertEq(lev, LEVERAGE, "leverage");
    }

    function test_PermissionlessUniswapXFill_OpensPosition() public {
        if (block.chainid != 8453) vm.skip(true);

        assertFalse(router.registeredSolvers(solver), "solver not registered");
        _bondEscrow(BORROW);

        vm.startPrank(trader);
        RealIERC20(BASE_USDC).approve(address(uxSettlement), MARGIN);
        vm.stopPrank();

        EswapUniswapXSettlement.FillParams memory p = EswapUniswapXSettlement.FillParams({
            trader: trader,
            marginToken: BASE_USDC,
            margin: MARGIN,
            leverage: LEVERAGE,
            key: hookKey,
            standardPoolKey: standardKey,
            minAmountOut: 0,
            deadline: block.timestamp + 1 hours
        });
        vm.prank(solver);
        uxSettlement.fill(p);

        PoolId poolId = hookKey.toId();
        assertEq(hook.positionSolver(poolId, trader), solver, "solver recorded");
        (, , uint256 borrowed, uint8 lev, , , , , ) = hook.positions(poolId, trader);
        assertEq(borrowed, BORROW, "borrow == 4x margin");
        assertEq(lev, LEVERAGE, "leverage");
    }
}
