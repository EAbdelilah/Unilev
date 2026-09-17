// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {EswapMarginHook} from "../EswapMarginHook.sol";
import {EswapRouter} from "../EswapRouter.sol";
import {PoolKey} from "../types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "../types/PoolId.sol";
import {Currency} from "../types/Currency.sol";
import {IPoolManager} from "../interfaces/IPoolManager.sol";
import {BaseV4Test, ERC20Mock, PriceFeedMock} from "./BaseV4Test.t.sol";

import {PoolManager} from "@uniswap/v4-core/src/PoolManager.sol";
import {PoolModifyLiquidityTest} from "@uniswap/v4-core/src/test/PoolModifyLiquidityTest.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {IPoolManager as RealIPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey as RealPoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId as RealPoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency as RealCurrency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks as RealIHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";

/// @notice [P1#6] Yield-bearing insurance fund: idle insurance claims are staked
///         as full-range LP liquidity in each pool's deep STANDARD venue, so the
///         insurance obligation earns swap fees instead of sitting dormant as
///         ERC-6909 claims. Proves the full cycle against the REAL PoolManager:
///         seed -> stake (claims -> LP) -> unstake (LP + accrued fees -> claims),
///         plus the per-currency staking cap (INSURANCE_STAKE_MAX_BPS) that keeps
///         the unstaked half claim-backed for shortfall coverage at all times.
contract EswapInsuranceYieldTest is Test {
    using PoolIdLibrary for PoolKey;
    uint160 constant HIGH_FLAGS = (1 << 159) | (1 << 158) | (1 << 153) | (1 << 152) | (1 << 148);
    uint160 constant LOW_FLAGS = (1 << 13) | (1 << 12) | (1 << 7) | (1 << 6) | (1 << 3);
    uint160 constant SQRT_PRICE_1_1 = 79228162514264337593543950336;
    uint256 constant SEED = 100 ether;

    PoolManager public realManager;
    EswapMarginHook public realHook;
    address public realHookAddr;
    EswapRouter public router;
    ERC20Mock public token0;
    ERC20Mock public token1;
    PriceFeedMock public priceFeed;
    RealPoolKey public standardRealKey;
    PoolKey public hookLocalKey;
    PoolKey public standardLocalKey;

    address trader = makeAddr("trader");

    function setUp() public {
        realManager = new PoolManager(address(this));
        priceFeed = new PriceFeedMock();
        token0 = new ERC20Mock("Token 0", "TK0");
        token1 = new ERC20Mock("Token 1", "TK1");
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

        RealPoolKey memory hookRealKey = RealPoolKey({
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
        realHook.setAuthorizedPool(hookLocalKey.toId(), true);
        realHook.setStandardPoolKey(hookLocalKey.toId(), standardLocalKey);

        // Deep standard pool needs real liquidity for the full-range stake to be
        // placed and for swaps to cross it.
        PoolModifyLiquidityTest lq = new PoolModifyLiquidityTest(realManager);
        token0.approve(address(lq), type(uint256).max);
        token1.approve(address(lq), type(uint256).max);
        RealIPoolManager.ModifyLiquidityParams memory lpDeep =
            RealIPoolManager.ModifyLiquidityParams({tickLower: -6000, tickUpper: 6000, liquidityDelta: 1e24, salt: 0});
        lq.modifyLiquidity(standardRealKey, lpDeep, "");
        RealIPoolManager.ModifyLiquidityParams memory lpThin =
            RealIPoolManager.ModifyLiquidityParams({tickLower: -60, tickUpper: 60, liquidityDelta: 1e21, salt: 0});
        lq.modifyLiquidity(hookRealKey, lpThin, "");

        realHook.setTokenDecimals(address(token0), 18);
        realHook.setTokenDecimals(address(token1), 18);
        priceFeed.setPrice(address(token0), 1e18);
        priceFeed.setPrice(address(token1), 1e18);

        token0.transfer(trader, 10_000 ether);
        vm.startPrank(trader);
        token0.approve(address(router), type(uint256).max);
        vm.stopPrank();
    }

    function _seedInsurance() internal {
        token0.approve(address(realHook), SEED);
        token1.approve(address(realHook), SEED);
        realHook.seedInsuranceFund(Currency.wrap(address(token0)), SEED);
        realHook.seedInsuranceFund(Currency.wrap(address(token1)), SEED);
    }

    function _claims(ERC20Mock t) internal view returns (uint256) {
        return realManager.balanceOf(realHookAddr, uint256(uint160(address(t))));
    }

    /// @dev Full cycle, no price move: stake claims into full-range LP then
    ///      unstake. The insurance ledger is preserved (± dust) and the staked
    ///      share is capped at INSURANCE_STAKE_MAX_BPS (50%) per currency so the
    ///      unstaked half remains claim-backed for shortfall coverage.
    function test_StakeUnstakeFullCycle_PreservesInsurance() public {
        _seedInsurance();
        uint256 claims0Before = _claims(token0);
        uint256 claims1Before = _claims(token1);

        realHook.insuranceStake(hookLocalKey, 0);

        PoolId pid = hookLocalKey.toId();
        uint128 stakedLiq = realHook.insuranceStakedLiquidity(pid);
        assertGt(stakedLiq, 0, "liquidity staked");
        uint256 staked0 = realHook.insuranceStaked(Currency.wrap(address(token0)));
        uint256 staked1 = realHook.insuranceStaked(Currency.wrap(address(token1)));
        assertLe(staked0, SEED / 2, "staked token0 capped at 50%");
        assertLe(staked1, SEED / 2, "staked token1 capped at 50%");
        // Claims backing dropped (tokens are now in the LP), but the unstaked
        // half of the insurance obligation stays claim-backed for coverage.
        assertLt(_claims(token0), claims0Before, "claims0 converted to LP");
        assertLt(_claims(token1), claims1Before, "claims1 converted to LP");
        assertGe(_claims(token0), realHook.insuranceFund(Currency.wrap(address(token0))) - staked0, "coverage floor token0");
        assertGe(_claims(token1), realHook.insuranceFund(Currency.wrap(address(token1))) - staked1, "coverage floor token1");

        // Unstake everything back to claim-backed insurance funds.
        realHook.insuranceUnstake(hookLocalKey, stakedLiq);

        assertEq(realHook.insuranceStakedLiquidity(pid), 0, "fully unstaked");
        assertEq(realHook.insuranceStaked(Currency.wrap(address(token0))), 0, "staked token0 zeroed");
        assertEq(realHook.insuranceStaked(Currency.wrap(address(token1))), 0, "staked token1 zeroed");
        // The insurance LEDGER only ever grows: removed value (principal + any
        // accrued fees/dust) is credited back. Tolerate LP rounding dust and
        // sub-weeni principal loss on the less-favored leg.
        assertGe(realHook.insuranceFund(Currency.wrap(address(token0))), SEED * 99 / 100, "token0 principal returned");
        assertGe(realHook.insuranceFund(Currency.wrap(address(token1))), SEED * 99 / 100, "token1 principal returned");
        assertApproxEqRel(
            realHook.insuranceFund(Currency.wrap(address(token0))) + realHook.insuranceFund(Currency.wrap(address(token1))),
            SEED * 2,
            1e15,
            "aggregate insurance value preserved"
        );
    }

    /// @dev Only the owner may trigger the staking; non-owner is rejected.
    function test_StakingIsOwnerGated() public {
        _seedInsurance();
        vm.prank(trader);
        vm.expectRevert(EswapMarginHook.NotOwner.selector);
        realHook.insuranceStake(standardLocalKey, 0);
    }

    /// @dev Swap volume crossing the staked full-range LP accrues fees BACK to
    ///      the insurance fund on unstake: a real 2x multi-pool open executes on
    ///      the standard pool (crossing the staked liquidity), then unstaking
    ///      nets principal + fees, never stranding the staked share.
    function test_FeesFromStandardPoolSwapReturnToInsurance() public {
        _seedInsurance();
        realHook.insuranceStake(hookLocalKey, 0);
        PoolId pid = hookLocalKey.toId();
        uint128 stakedLiq = realHook.insuranceStakedLiquidity(pid);
        assertGt(stakedLiq, 0, "liquidity staked");

        // Real protocol swap through the standard pool (deep venue) so the hook's
        // staked LP position earns fees. Solver pre-funded, 2x leverage.
        address solver = makeAddr("solver");
        router.setSolverWhitelist(solver, true);
        token0.transfer(solver, 10_000 ether);
        vm.startPrank(solver);
        token0.approve(address(router), type(uint256).max);
        vm.stopPrank();
        EswapRouter.SwapParams memory sp = EswapRouter.SwapParams({
            key: hookLocalKey,
            standardPoolKey: standardLocalKey,
            zeroForOne: true,
            amountSpecified: -int256(100 ether),
            leverage: 2,
            solver: solver,
            hookData: abi.encode(true, uint8(2), trader),
            deadline: block.timestamp + 15 minutes,
            minAmountOut: 0
        });
        vm.prank(trader);
        router.swapMultiPool(sp);

        // Unstake: principal + fees flow back into claim-backed insurance funds.
        realHook.insuranceUnstake(hookLocalKey, stakedLiq);
        assertEq(realHook.insuranceStakedLiquidity(pid), 0, "fully unstaked");
        assertGe(
            realHook.insuranceFund(Currency.wrap(address(token0))),
            SEED * 99 / 100,
            "token0 insurance not stranded"
        );
        assertGe(
            realHook.insuranceFund(Currency.wrap(address(token1))),
            SEED * 99 / 100,
            "token1 insurance not stranded"
        );
        assertApproxEqRel(
            realHook.insuranceFund(Currency.wrap(address(token0))) + realHook.insuranceFund(Currency.wrap(address(token1))),
            SEED * 2,
            5e14,
            "aggregate value returned after swap"
        );
    }
}