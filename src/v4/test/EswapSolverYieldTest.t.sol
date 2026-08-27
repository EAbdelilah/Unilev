// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {EswapMarginHook, IPriceFeed} from "../EswapMarginHook.sol";
import {EswapRouter} from "../EswapRouter.sol";
import {PoolManagerRealTokenMock} from "./mocks/PoolManagerMock.sol";
import {PoolKey} from "../types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "../types/PoolId.sol";
import {Currency} from "../types/Currency.sol";
import {IPoolManager} from "../interfaces/IPoolManager.sol";
import {BalanceDeltaLibrary} from "../types/BalanceDelta.sol";
import {TickMath} from "../libraries/TickMath.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract ERC20MockYield is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {
        _mint(msg.sender, 1_000_000 ether);
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract PriceFeedMockYield is IPriceFeed {
    function getAmountInUsd(address, uint256 amount) external pure override returns (uint256) {
        return amount;
    }

    function getTwapPrice(address) external pure override returns (uint256) {
        return 1e18;
    }
}

/// @notice Rehypothecation yield must reach the SOLVER on every band-removal
///         path. closePosition and executeLiquidation already route the
///         collateral-currency surplus beyond the recorded principal through
///         _distributeRehypothecation; these tests pin the same behavior on
///         rebalancePosition (which previously compounded LP fees silently
///         into the trader's re-deployed band), plus the no-solver fallback.
contract EswapSolverYieldTest is Test {
    using PoolIdLibrary for PoolKey;

    EswapMarginHook public hook;
    PoolManagerRealTokenMock public manager;
    EswapRouter public router;
    ERC20MockYield public token0;
    ERC20MockYield public token1;
    PoolKey public key;

    address trader = makeAddr("yieldTrader");
    address solver = makeAddr("yieldSolver");

    function setUp() public {
        manager = new PoolManagerRealTokenMock();
        PriceFeedMockYield priceFeed = new PriceFeedMockYield();

        token0 = new ERC20MockYield("Token 0", "TK0");
        token1 = new ERC20MockYield("Token 1", "TK1");

        address hookAddress = address(uint160((1 << 159) | (1 << 158) | (1 << 153) | (1 << 152) | (1 << 148)));
        deployCodeTo("EswapMarginHook.sol:EswapMarginHook", abi.encode(manager, priceFeed, address(this)), hookAddress);
        hook = EswapMarginHook(payable(hookAddress));

        key = PoolKey({
            currency0: Currency.wrap(address(token0)),
            currency1: Currency.wrap(address(token1)),
            fee: 3000,
            tickSpacing: 60,
            hooks: address(hook)
        });

        // The test contract is the router AND the owner, mirroring BaseV4Test,
        // so registerSolverDebt / deployCollateral / rebalancePosition are all
        // callable directly.
        hook.setRouterAndMinCollateralUsd(address(this), 0);
        hook.setAuthorizedPool(key.toId(), true);

        // The manager must hold real tokens so removal take()s can pay out.
        token0.mint(address(manager), 10_000 ether);
        token1.mint(address(manager), 10_000 ether);
    }

    /// @dev Direct open through beforeSwap + afterSwap: sells `margin` token0,
    ///      buys exactly margin*leverage token1. The 50bps protocol fee shaves
    ///      the recorded collateral to 99.5% of boughtAmount.
    function _open(address trader_, uint256 margin, uint8 leverage) internal {
        manager.setSlot0(key.toId(), 1 << 96, 0); // price 1.0, tick 0 (mock slot0 defaults to 0 otherwise)
        bytes memory data = abi.encode(true, leverage, trader_);
        vm.prank(address(manager));
        hook.beforeSwap(trader_, key, IPoolManager.SwapParams(true, -int256(margin), 0), data);
        vm.prank(address(manager));
        hook.afterSwap(
            trader_,
            key,
            IPoolManager.SwapParams(true, -int256(margin * leverage), 0),
            BalanceDeltaLibrary.toBalanceDelta(int128(-int256(margin * leverage)), int128(int256(margin * leverage))),
            data
        );
    }

    function _deployBand() internal {
        manager.setSlot0(key.toId(), 1 << 96, 0); // price 1.0, tick 0
        hook.deployCollateral(key, trader);
        (,,,,,, int24 tl, int24 tu, uint128 liq) = hook.positions(key.toId(), trader);
        assertGt(liq, 0, "band must be deployed");
        assertLt(tl, tu);
    }

    function test_Rebalance_RoutesYieldSurplusToSolver() public {
        _open(trader, 100 ether, 3); // bought 300 TK1 -> collateral 298.5 TK1
        (, uint256 collateralRecorded, uint256 borrowed,,,,,,) = hook.positions(key.toId(), trader);
        assertEq(collateralRecorded, 298.5 ether, "50bps fee shaves collateral");
        assertGt(borrowed, 0);

        hook.registerSolverDebt(key.toId(), trader, solver, borrowed);
        assertEq(hook.positionSolver(key.toId(), trader), solver);

        _deployBand();

        // Removal override: burning the band returns principal + 5 TK1 of LP fees.
        uint256 yieldSurplus = 5 ether;
        // Price drifts into the lower half of the band: tick -300 sits inside [-600, 0),
        // consuming 50% against the 25% trigger, so the rebalance gate opens.
        manager.setSlot0(key.toId(), TickMath.getSqrtRatioAtTick(-300), -300);
        manager.setNextModifyLiquidityDelta(0, int128(int256(collateralRecorded + yieldSurplus)));

        uint256 solverBefore = token1.balanceOf(solver);
        hook.rebalancePosition(key, trader);

        assertEq(token1.balanceOf(solver), solverBefore + yieldSurplus, "solver earns rehypothecated fees");
        // Recorded collateral is untouched by the payout.
        (, uint256 collateralAfter,,,,,,,) = hook.positions(key.toId(), trader);
        assertEq(collateralAfter, collateralRecorded, "principal stays with the position");
    }

    function test_Rebalance_YieldFallsBackToTraderWithoutSolver() public {
        _open(trader, 100 ether, 3);
        (, uint256 collateralRecorded,,,,,,,) = hook.positions(key.toId(), trader);
        assertTrue(hook.positionSolver(key.toId(), trader) == address(0));

        _deployBand();

        // Same 50%-consumed gate-opening drift as above.
        manager.setSlot0(key.toId(), TickMath.getSqrtRatioAtTick(-300), -300);
        uint256 yieldSurplus = 2 ether;
        manager.setNextModifyLiquidityDelta(0, int128(int256(collateralRecorded + yieldSurplus)));

        uint256 traderBefore = token1.balanceOf(trader);
        hook.rebalancePosition(key, trader);

        assertEq(token1.balanceOf(trader), traderBefore + yieldSurplus, "no solver: parity with close/liquidation");
    }

    function test_Rebalance_NoSurplus_NoPayout() public {
        _open(trader, 100 ether, 3);
        (, uint256 collateralRecorded, uint256 borrowed,,,,,,) = hook.positions(key.toId(), trader);
        hook.registerSolverDebt(key.toId(), trader, solver, borrowed);

        _deployBand();

        // Removal returns LESS than the recorded principal (round-trip loss):
        // nothing may be paid out and the shortfall caps the re-deploy.
        uint256 removedCollateral = collateralRecorded - 3 ether;
        manager.setSlot0(key.toId(), TickMath.getSqrtRatioAtTick(-300), -300);
        manager.setNextModifyLiquidityDelta(0, int128(int256(removedCollateral)));

        uint256 solverBefore = token1.balanceOf(solver);
        hook.rebalancePosition(key, trader);

        assertEq(token1.balanceOf(solver), solverBefore, "no yield when recovery is below principal");
        (,,,,,,,, uint128 liqAfter) = hook.positions(key.toId(), trader);
        assertGt(liqAfter, 0, "band still re-deploys on the capped principal");
    }
}
