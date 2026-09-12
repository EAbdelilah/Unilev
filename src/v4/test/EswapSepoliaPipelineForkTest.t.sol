// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {EswapMarginHook} from "../EswapMarginHook.sol";
import {EswapRouter} from "../EswapRouter.sol";
import {EswapCoWSettlement, CowOrder} from "../EswapCoWSettlement.sol";
import {CowSigning} from "../cow/CowSigning.sol";
import {EswapLeverageAdapter} from "../EswapLeverageAdapter.sol";
import {EswapLeverageQuoter} from "../EswapLeverageQuoter.sol";
import {PoolKey} from "../types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "../types/PoolId.sol";
import {Currency} from "../types/Currency.sol";
import {IPoolManager} from "../interfaces/IPoolManager.sol";
import {PriceFeedMock} from "./BaseV4Test.t.sol";

// REAL lib/v4-core types against the LIVE Unichain Sepolia PoolManager.
import {IPoolManager as RealIPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolId as RealPoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {PoolKey as RealPoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency as RealCurrency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks as RealIHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";
import {IERC20 as RealIERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {TickMath} from "../libraries/TickMath.sol";

/// @notice TESTNET connection proof for the solver + aggregator pipeline on
///         Unichain Sepolia (chainId 1301), run against a fork of the REAL
///         testnet: canonical PoolManager 0x00B036..., real testnet
///         USDC/WETH tokens, real hook/router/CoW-settlement/adapters code.
///
///   Aggregator connection: EswapLeverageQuoter.quoteExactInputSingleWithLeverage
///                          -> EswapLeverageAdapter.exactInputSingleWithLeverage
///   Solver connection:     EswapCoWSettlement.fillOrder (EIP-712 CoW order,
///                          solver funds margin + borrow)
///
/// Liquidity is self-seeded into the no-hook 500/60 standard pool (the physical
/// fill venue) so the test is deterministic and independent of testnet LP
/// activity. No testnet tokens or gas are consumed: everything runs in the fork.
contract EswapSepoliaPipelineForkTest is Test, IUnlockCallback {
    using PoolIdLibrary for PoolKey;

    // Unichain Sepolia (chainId 1301)
    address constant SEPOLIA_PM = 0x00B036B58a818B1BC34d502D3fE730Db729e62AC;
    address constant SEPOLIA_USDC = 0x31d0220469e10c4E71834a79b1f276d740d3768F;
    address constant SEPOLIA_WETH = 0x4200000000000000000000000000000000000006;
    // Canonical CoW GPv2Settlement (deterministic address on every CoW chain).
    address constant GPV2_SETTLEMENT = 0x9008D19f58AAbD9eD0D60971565AA8510560ab41;

    // Hook flags (deployCodeTo directly at a flags-matching address).
    uint160 constant HIGH_FLAGS = (1 << 159) | (1 << 158) | (1 << 153) | (1 << 152) | (1 << 148);
    uint160 constant LOW_FLAGS = (1 << 13) | (1 << 12) | (1 << 7) | (1 << 6) | (1 << 3);

    // Canonical Sepolia topology (see DeployUnichainSepolia.s.sol).
    int24 constant POOL_TICK = 200760; // ~$1912/WETH, USDC(6)/WETH(18), 60-tick grid
    int24 constant LP_LOWER = 200760 - 2400;
    int24 constant LP_UPPER = 200760 + 2400;

    RealIPoolManager pm;
    EswapMarginHook hook;
    EswapRouter router;
    EswapCoWSettlement settlement;
    EswapLeverageAdapter adapter;
    EswapLeverageQuoter quoter;
    PriceFeedMock priceFeed;

    PoolKey hookLocalKey;
    PoolKey standardLocalKey;

    address trader = makeAddr("sepTrader");
    address solver = makeAddr("sepSolver");
    uint256 traderPk = 0xA11CE;

    bool rpcAvailable;
    bool liquiditySeeded;

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        (RealPoolKey memory key, int24 tl, int24 tu, int128 liq) = abi.decode(data, (RealPoolKey, int24, int24, int128));
        (BalanceDelta delta,) = pm.modifyLiquidity(
            key,
            RealIPoolManager.ModifyLiquidityParams({
                tickLower: tl, tickUpper: tu, liquidityDelta: liq, salt: bytes32(0)
            }),
            ""
        );
        if (delta.amount0() < 0) {
            pm.sync(RealCurrency.wrap(SEPOLIA_USDC));
            RealIERC20(SEPOLIA_USDC).transfer(address(pm), uint256(-int256(delta.amount0())));
            pm.settle();
        } else if (delta.amount0() > 0) {
            pm.take(RealCurrency.wrap(SEPOLIA_USDC), address(this), uint256(uint128(delta.amount0())));
        }
        if (delta.amount1() < 0) {
            pm.sync(RealCurrency.wrap(SEPOLIA_WETH));
            RealIERC20(SEPOLIA_WETH).transfer(address(pm), uint256(-int256(delta.amount1())));
            pm.settle();
        } else if (delta.amount1() > 0) {
            pm.take(RealCurrency.wrap(SEPOLIA_WETH), address(this), uint256(uint128(delta.amount1())));
        }
        return bytes("");
    }

    function setUp() public {
        string memory rpcUrl = vm.envOr("UNICHAIN_SEPOLIA_RPC_URL", string(""));
        if (bytes(rpcUrl).length == 0) return;
        vm.createSelectFork(rpcUrl);
        try this._setupOnActiveFork() {}
        catch (bytes memory reason) {
            console2.log("setupOnActiveFork failed:", _reason(reason));
        }
    }

    function _reason(bytes memory r) internal pure returns (string memory) {
        if (r.length >= 68 && bytes4(r) == 0x08c379a0) return abi.decode(_slice(r, 4), (string));
        return "unknown revert";
    }

    function _slice(bytes memory b, uint256 from) internal pure returns (bytes memory out) {
        out = new bytes(b.length - from);
        for (uint256 i = 0; i < out.length; i++) {
            out[i] = b[from + i];
        }
    }

    function _setupOnActiveFork() external {
        if (block.chainid != 1301) return;
        if (SEPOLIA_PM.code.length == 0 || SEPOLIA_USDC.code.length == 0 || SEPOLIA_WETH.code.length == 0) return;

        pm = RealIPoolManager(SEPOLIA_PM);
        priceFeed = new PriceFeedMock();
        console2.log("forked Unichain Sepolia, chainId:", block.chainid);

        // Deploy hook + router against the live testnet singleton.
        address hookAddr = address(uint160(HIGH_FLAGS | LOW_FLAGS));
        deployCodeTo(
            "EswapMarginHook.sol:EswapMarginHook", abi.encode(address(pm), address(priceFeed), address(this)), hookAddr
        );
        hook = EswapMarginHook(payable(hookAddr));
        router = new EswapRouter(IPoolManager(address(pm)));
        hook.setRouterAndMinCollateralUsd(address(router), 0);
        router.setSolverWhitelist(solver, true);

        // Accounting hook pool is fee-3000/tick-60; physical fill venue is the
        // no-hook fee-500/tick-60 standard pool (mirrors the Sepolia deploy).
        hookLocalKey = PoolKey({
            currency0: Currency.wrap(SEPOLIA_USDC),
            currency1: Currency.wrap(SEPOLIA_WETH),
            fee: 3000,
            tickSpacing: 60,
            hooks: hookAddr
        });
        standardLocalKey = PoolKey({
            currency0: Currency.wrap(SEPOLIA_USDC),
            currency1: Currency.wrap(SEPOLIA_WETH),
            fee: 500,
            tickSpacing: 60,
            hooks: address(0)
        });
        uint160 initSqrt = TickMath.getSqrtRatioAtTick(POOL_TICK);

        RealPoolKey memory stdReal = _realKey(500, address(0));
        RealPoolKey memory hookReal = _realKey(3000, hookAddr);
        (uint160 stdSqrt,,,) = StateLibrary.getSlot0(pm, stdReal.toId());
        if (stdSqrt == 0) {
            pm.initialize(stdReal, initSqrt);
        } else {
            initSqrt = stdSqrt;
        }
        (uint160 hookSqrt,,,) = StateLibrary.getSlot0(pm, hookReal.toId());
        if (hookSqrt == 0) {
            pm.initialize(hookReal, initSqrt);
        }

        hook.setAuthorizedPool(hookLocalKey.toId(), true);
        hook.setStandardPoolKey(hookLocalKey.toId(), standardLocalKey);
        hook.setBaseCurrency(hookLocalKey.toId(), Currency.wrap(SEPOLIA_WETH));
        hook.setTokenDecimals(SEPOLIA_WETH, 18);
        hook.setTokenDecimals(SEPOLIA_USDC, 6);

        // Oracle mock tracks the venue price (stable $1 USDC).
        priceFeed.setPrice(SEPOLIA_USDC, 1e18);
        priceFeed.setPrice(SEPOLIA_WETH, _humanPriceBaseInQuote18());

        // Seed the standard (physical fill) pool with liquidity.
        _seedLiquidity();

        // Pipeline contracts.
        settlement = new EswapCoWSettlement(router, GPV2_SETTLEMENT);
        adapter = new EswapLeverageAdapter(router);
        quoter = new EswapLeverageQuoter(router);
        adapter.registerPool(SEPOLIA_USDC, SEPOLIA_WETH, 3000, hookLocalKey, standardLocalKey);
        adapter.registerPool(SEPOLIA_WETH, SEPOLIA_USDC, 3000, hookLocalKey, standardLocalKey);
        quoter.registerPool(SEPOLIA_USDC, SEPOLIA_WETH, 3000, hookLocalKey, standardLocalKey);
        quoter.registerPool(SEPOLIA_WETH, SEPOLIA_USDC, 3000, hookLocalKey, standardLocalKey);
        adapter.setDefaultSolver(solver);

        // Participants funded with REAL testnet tokens (cheatcode-level inject,
        // so no testnet bridge/faucet is needed on the fork).
        deal(SEPOLIA_USDC, trader, 250_000e6);
        deal(SEPOLIA_USDC, solver, 250_000e6);
        vm.prank(trader);
        RealIERC20(SEPOLIA_USDC).approve(address(router), type(uint256).max);
        vm.prank(solver);
        RealIERC20(SEPOLIA_USDC).approve(address(router), type(uint256).max);
        vm.deal(trader, 5 ether);

        rpcAvailable = true;
    }

    function _realKey(uint24 fee, address hooks) internal view returns (RealPoolKey memory k) {
        k = RealPoolKey({
            currency0: RealCurrency.wrap(SEPOLIA_USDC),
            currency1: RealCurrency.wrap(SEPOLIA_WETH),
            fee: fee,
            tickSpacing: 60,
            hooks: RealIHooks(hooks)
        });
    }

    function _seedLiquidity() internal {
        // LP = this test contract (implements the unlock callback). Wide single
        // position so both open and close fills stay in range. Generous token
        // budgets: the settle path pulls exactly the computed deposit.
        deal(SEPOLIA_USDC, address(this), 500_000e6);
        deal(SEPOLIA_WETH, address(this), 1000 ether);
        RealIERC20(SEPOLIA_USDC).approve(address(pm), type(uint256).max);
        RealIERC20(SEPOLIA_WETH).approve(address(pm), type(uint256).max);

        RealPoolKey memory stdReal = _realKey(500, address(0));
        RealPoolKey memory hookReal = _realKey(3000, address(hook));
        int128 liq = int128(int256(1e15));

        pm.unlock(abi.encode(stdReal, LP_LOWER, LP_UPPER, liq));
        pm.unlock(abi.encode(hookReal, LP_LOWER, LP_UPPER, liq));

        uint128 stdLiq = StateLibrary.getLiquidity(pm, RealPoolId.wrap(PoolId.unwrap(standardLocalKey.toId())));
        uint128 hookLiq = StateLibrary.getLiquidity(pm, RealPoolId.wrap(PoolId.unwrap(hookLocalKey.toId())));
        require(stdLiq > 0, "standard pool liquidity missing");
        require(hookLiq > 0, "hook pool liquidity missing");
        liquiditySeeded = true;
    }

    // --- helpers -----------------------------------------------------------

    function _tokenDecimals(address token) internal view returns (uint8 d) {
        if (token == SEPOLIA_WETH) return 18;
        if (token == SEPOLIA_USDC) return 6;
        (bool ok, bytes memory ret) = token.staticcall(abi.encodeWithSignature("decimals()"));
        require(ok && ret.length >= 32, "decimals() failed");
        d = uint8(uint256(abi.decode(ret, (uint256))));
    }

    function _humanPriceBaseInQuote18() internal view returns (uint256) {
        RealPoolId stdRealId = RealPoolId.wrap(PoolId.unwrap(standardLocalKey.toId()));
        (uint160 sqrtP,,,) = StateLibrary.getSlot0(pm, stdRealId);
        require(sqrtP > 0, "standard pool uninitialized");
        // Sepolia standard pool is token0=USDC(6) / token1=WETH(18):
        //   r = sqrtP^2 / 2^192 = raw WETH per raw USDC.
        // Whole WETH = 1e18 raw -> 1e18/r raw USDC -> (1e18/r)/1e6 whole USDC,
        // so the 1e18-fixed USD price = 1e30/r = 1e30 * 2^192 / sqrtP^2.
        return FullMath.mulDiv(1 << 192, 10 ** 30, uint256(sqrtP) * uint256(sqrtP));
    }

    function _order(uint256 margin, uint32 validTo, uint256 minOut, address sell, address buy)
        internal
        pure
        returns (CowOrder.Data memory o)
    {
        o = CowOrder.Data({
            sellToken: sell,
            buyToken: buy,
            receiver: address(0),
            sellAmount: margin,
            buyAmount: minOut,
            validTo: validTo,
            appData: keccak256("eswap-sepolia-pipeline"),
            feeAmount: 0,
            kind: keccak256("sell"),
            partiallyFillable: false,
            sellTokenBalance: keccak256("erc20"),
            buyTokenBalance: keccak256("erc20")
        });
    }

    function _profits(address who) internal view returns (uint256) {
        return RealIERC20(SEPOLIA_USDC).balanceOf(who);
    }

    // --- Tests -------------------------------------------------------------

    function test_Sepolia_StandardVenue_HasLiquidity() public view {
        if (!rpcAvailable) return;
        RealPoolId id = RealPoolId.wrap(PoolId.unwrap(standardLocalKey.toId()));
        assertGt(StateLibrary.getLiquidity(pm, id), 0, "standard pool must have seeded liquidity");
    }

    /// @dev AGGREGATOR connection: quote via quoter, execute via adapter,
    ///      position must open under the recipient with the solver lending.
    function test_Sepolia_AggregatorConnection_LeveragedSwap() public {
        if (!rpcAvailable) return;

        uint256 margin = 50e6; // $50 USDC
        uint8 leverage = 2;
        int128 quote =
            quoter.quoteExactInputSingleWithLeverage(SEPOLIA_USDC, SEPOLIA_WETH, 3000, leverage, int256(margin));
        uint256 minOut = uint256(uint128(quote)) * 95 / 100;

        adapter.exactInputSingleWithLeverage(SEPOLIA_USDC, SEPOLIA_WETH, 3000, leverage, margin, minOut, trader);

        (address posTrader, uint256 collateral, uint256 borrowed, uint8 lev, bool isLong,,,,) =
            hook.positions(hookLocalKey.toId(), trader);
        assertEq(posTrader, trader, "aggregator open must credit the recipient");
        assertGt(collateral, 0, "collateral minted");
        assertEq(lev, leverage, "leverage mismatch");
        assertEq(borrowed, margin * uint256(leverage - 1), "borrow = margin*(leverage-1)");
        assertTrue(isLong, "USDC->WETH must be LONG (base=WETH)");

        (address debtSolver,,) = hook.solverDebts(hookLocalKey.toId(), trader, solver);
        assertEq(debtSolver, solver, "solver debt registered for the borrow leg");
    }

    /// @dev SOLVER (CoW) connection: trader's EIP-712 CoW order is filled by the
    ///      settlement, solver funds margin + borrow, position under the owner.
    function test_Sepolia_SolverConnection_CoWFillOrder() public {
        if (!rpcAvailable) return;

        uint256 margin = 50e6; // $50 USDC margin
        uint8 leverage = 2;
        address owner = vm.addr(traderPk);
        CowOrder.Data memory order = _order(margin, uint32(block.timestamp + 15 minutes), 1, SEPOLIA_USDC, SEPOLIA_WETH);
        bytes32 digest = settlement.hashOrder(order);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(traderPk, digest);
        bytes memory sig = abi.encodePacked(r, s, v);

        uint256 solverBefore = _profits(solver);
        EswapCoWSettlement.FillParams memory params = EswapCoWSettlement.FillParams({
            leverage: leverage, solver: solver, key: hookLocalKey, standardPoolKey: standardLocalKey
        });

        address recovered = settlement.fillOrder(order, CowSigning.Scheme.Eip712, sig, params);
        assertEq(recovered, owner, "recovered owner must equal signer");

        (address posTrader, uint256 collateral, uint256 borrowed, uint8 lev,,,,,) =
            hook.positions(hookLocalKey.toId(), owner);
        assertEq(posTrader, owner, "CoW fill must credit the order owner");
        assertGt(collateral, 0, "collateral minted");
        assertEq(lev, leverage);
        assertEq(borrowed, margin * uint256(leverage - 1), "borrow = margin*(leverage-1)");

        // Solvent funded margin + borrow (margin*leverage total).
        assertEq(solverBefore - _profits(solver), margin * leverage, "solver funded margin + borrow");
        bytes memory uid = abi.encodePacked(digest, owner, order.validTo);
        assertTrue(settlement.filledOrders(uid), "order UID marked filled");
    }
}
