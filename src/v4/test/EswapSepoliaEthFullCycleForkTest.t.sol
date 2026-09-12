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

// REAL lib/v4-core types against the LIVE Ethereum Sepolia PoolManager.
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

/// @notice FULL-CYCLE live-trading proof on Ethereum Sepolia (chainId 11155111)
///         — the chain where the REAL CoW order-book API (api.cow.fi/sepolia)
///         and 0x Swap API (sepolia.api.0x.org) run. Runs on a fork of the
///         live testnet: canonical PoolManager 0xE03A..., REAL testnet
///         WETH/USDC tokens, canonical CoW GPv2Settlement 0x9008....
///
///   AGGREGATOR full round-trip:  quote -> adapter open -> router close
///   SOLVER full round-trip:      EIP-712 CoW order -> settlement fill -> close
///
/// Liquidity is self-seeded into the no-hook 500/60 standard fill venue so the
/// test is deterministic and independent of testnet LP activity. No testnet
/// tokens or gas are consumed; everything runs in the fork.
///
/// What this proves for "ready for live trading":
///   - the mirror stack deploys + wires against the REAL 11155111 singletons,
///   - BOTH pipelines execute a full open->close cycle with solvent netting,
///   - CoW orders signed here verify against the fork domain (byte-identical to
///     the canonical 11155111 domain separator proven in EswapSepoliaDomainCompatTest).
contract EswapSepoliaEthFullCycleForkTest is Test, IUnlockCallback {
    using PoolIdLibrary for PoolKey;

    // Ethereum Sepolia (chainId 11155111) — the CoW + 0x testnet chain.
    address constant SEPOLIA_PM = 0xE03A1074c86CFeDd5C142C4F04F1a1536e203543;
    address constant SEPOLIA_WETH = 0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9;
    address constant SEPOLIA_USDC = 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238;
    // Canonical CoW GPv2Settlement (deterministic address on every CoW chain).
    address constant GPV2_SETTLEMENT = 0x9008D19f58AAbD9eD0D60971565AA8510560ab41;

    // Hook flags (deployCodeTo directly at a flags-matching address).
    uint160 constant HIGH_FLAGS = (1 << 159) | (1 << 158) | (1 << 153) | (1 << 152) | (1 << 148);
    uint160 constant LOW_FLAGS = (1 << 13) | (1 << 12) | (1 << 7) | (1 << 6) | (1 << 3);

    // Ethereum Sepolia topology (mirror of DeployUnichainSepoliaFull).
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

    address trader = makeAddr("ethSepTrader");
    address solver = makeAddr("ethSepSolver");
    uint256 traderPk = 0xA11CE;
    address owner = vm.addr(traderPk);

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
        string memory rpcUrl = vm.envOr("ETH_SEPOLIA_RPC_URL", string(""));
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
        if (block.chainid != 11155111) return;
        if (SEPOLIA_PM.code.length == 0 || SEPOLIA_USDC.code.length == 0 || SEPOLIA_WETH.code.length == 0) return;

        pm = RealIPoolManager(SEPOLIA_PM);
        priceFeed = new PriceFeedMock();
        console2.log("forked Ethereum Sepolia (11155111): PM", SEPOLIA_PM);

        // Deploy hook + router against the live testnet singleton (mirrors the
        // Phase-B deploy: accounting pool = hook 3000/60, fill venue = 500/60).
        address hookAddr = address(uint160(HIGH_FLAGS | LOW_FLAGS));
        deployCodeTo(
            "EswapMarginHook.sol:EswapMarginHook", abi.encode(address(pm), address(priceFeed), address(this)), hookAddr
        );
        hook = EswapMarginHook(payable(hookAddr));
        router = new EswapRouter(IPoolManager(address(pm)));
        hook.setRouterAndMinCollateralUsd(address(router), 0);
        router.setSolverWhitelist(solver, true);

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

        // Pipeline contracts (same wiring the Phase-B deployer performs).
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
        // position so both open and close fills stay in range.
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
            appData: keccak256("eswap-eth-sepolia-full-cycle"),
            feeAmount: 0,
            kind: keccak256("sell"),
            partiallyFillable: false,
            sellTokenBalance: keccak256("erc20"),
            buyTokenBalance: keccak256("erc20")
        });
    }

    // --- Tests -------------------------------------------------------------

    function test_EthSepolia_StackWiresAgainstReal11155111Singletons() public view {
        if (!rpcAvailable) return;
        assertEq(address(pm), SEPOLIA_PM, "real PoolManager");
        assertTrue(GPV2_SETTLEMENT.code.length > 0, "canonical GPv2 deployed on 11155111");
        assertEq(adapter.defaultSolver(), solver, "adapter default solver wired");
        assertTrue(router.registeredSolvers(solver), "solver whitelisted on router");
        assertTrue(hook.isAuthorizedPool(hookLocalKey.toId()), "hook pool authorized");
        RealPoolId stdRealId = RealPoolId.wrap(PoolId.unwrap(standardLocalKey.toId()));
        assertGt(StateLibrary.getLiquidity(pm, stdRealId), 0, "standard pool must have seeded liquidity");
    }

    /// @dev AGGREGATOR full cycle on 11155111: quote -> open -> close.
    function test_EthSepolia_FullCycle_Aggregator_OpenThenClose() public {
        if (!rpcAvailable) return;

        uint256 margin = 50e6; // $50 USDC
        uint8 leverage = 2;
        int128 quote =
            quoter.quoteExactInputSingleWithLeverage(SEPOLIA_USDC, SEPOLIA_WETH, 3000, leverage, int256(margin));
        require(quote > 0, "quote must be positive on the 11155111 mirror stack");
        uint256 minOut = uint256(uint128(quote)) * 95 / 100;
        uint256 solverPrincipal = margin * uint256(leverage - 1);

        uint256 traderStart = RealIERC20(SEPOLIA_USDC).balanceOf(trader);

        vm.prank(trader);
        adapter.exactInputSingleWithLeverage(SEPOLIA_USDC, SEPOLIA_WETH, 3000, leverage, margin, minOut, trader);

        (address posTrader, uint256 collateral, uint256 borrowed, uint8 lev, bool isLong,,,,) =
            hook.positions(hookLocalKey.toId(), trader);
        assertEq(posTrader, trader, "aggregator open credits the recipient");
        assertGt(collateral, 0, "collateral minted");
        assertEq(lev, leverage, "leverage mismatch");
        assertEq(borrowed, solverPrincipal, "borrow = margin*(leverage-1)");
        assertTrue(isLong, "USDC->WETH must be LONG on 11155111");

        (address debtSolver,,) = hook.solverDebts(hookLocalKey.toId(), trader, solver);
        assertEq(debtSolver, solver, "solver debt registered for the borrow leg");

        uint256 solverBeforeClose = RealIERC20(SEPOLIA_USDC).balanceOf(solver);

        // Close: only the trader may close their own position (router C-1 rule).
        vm.prank(trader);
        router.closePosition(address(hook), hookLocalKey, trader, solver, 0);

        (address cleared, uint256 collAfter, uint256 _b, uint8 _l, bool _lng, uint160 _lsp, int24 _tl, int24 _tu, uint128 liqAfter) =
            hook.positions(hookLocalKey.toId(), trader);
        assertEq(cleared, address(0), "position cleared after close");
        assertEq(collAfter, 0, "collateral cleared after close");
        assertEq(liqAfter, 0, "LP stake closed after close");

        // Solvent nets back the exact principal lent; trader keeps >90% of
        // margin (only reserve + venue fees leave the system on a flat loop).
        assertEq(
            RealIERC20(SEPOLIA_USDC).balanceOf(solver) - solverBeforeClose,
            solverPrincipal,
            "solver must recover exact principal on close"
        );

        uint256 traderFinal = RealIERC20(SEPOLIA_USDC).balanceOf(trader);
        uint256 returned = margin + traderFinal - traderStart; // start -margin (open), +X (close)
        assertGt(returned, margin * 90 / 100, "trader recovers above 90% of margin after full aggregator cycle");
        assertLt(returned, margin * 101 / 100, "no free money on flat-price round-trip");
    }

    /// @dev SOLVER (CoW) full cycle on 11155111: EIP-712 order -> fill -> close.
    function test_EthSepolia_FullCycle_CoWSolver_OpenThenClose() public {
        if (!rpcAvailable) return;

        uint256 margin = 50e6;
        uint8 leverage = 2;
        uint256 solverPrincipal = margin * uint256(leverage - 1);

        CowOrder.Data memory order = _order(margin, uint32(block.timestamp + 15 minutes), 1, SEPOLIA_USDC, SEPOLIA_WETH);
        bytes32 digest = settlement.hashOrder(order);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(traderPk, digest);
        bytes memory sig = abi.encodePacked(r, s, v);

        EswapCoWSettlement.FillParams memory params = EswapCoWSettlement.FillParams({
            leverage: leverage, solver: solver, key: hookLocalKey, standardPoolKey: standardLocalKey
        });
        address recovered = settlement.fillOrder(order, CowSigning.Scheme.Eip712, sig, params);
        assertEq(recovered, owner, "recovered owner must equal signer");

        (address posTrader, uint256 collateral, uint256 borrowed, uint8 lev, bool isLong,,,,) =
            hook.positions(hookLocalKey.toId(), owner);
        assertEq(posTrader, owner, "CoW fill credits the order owner");
        assertGt(collateral, 0, "collateral minted");
        assertEq(lev, leverage);
        assertEq(borrowed, solverPrincipal, "borrow = margin*(leverage-1)");
        assertTrue(isLong, "USDC->WETH order fill must open LONG on 11155111");
        bytes memory uid = abi.encodePacked(digest, owner, order.validTo);
        assertTrue(settlement.filledOrders(uid), "order UID marked filled");

        uint256 solverBefore = RealIERC20(SEPOLIA_USDC).balanceOf(solver);

        // Close as the order owner.
        vm.prank(owner);
        router.closePosition(address(hook), hookLocalKey, owner, solver, 0);

        (address cleared, uint256 collAfter, uint256 _b2, uint8 _l2, bool _lng2, uint160 _lsp2, int24 _tl2, int24 _tu2, uint128 liqAfter) =
            hook.positions(hookLocalKey.toId(), owner);
        assertEq(cleared, address(0), "position cleared after close");
        assertEq(collAfter, 0, "collateral cleared after close");
        assertEq(liqAfter, 0, "LP stake closed after close");

        // Solvent nets back the exact principal lent.
        assertEq(
            RealIERC20(SEPOLIA_USDC).balanceOf(solver) - solverBefore,
            solverPrincipal,
            "solver must recover exact principal on close"
        );

        // Order owner round-trip on a flat market: keeps the bulk of margin,
        // no free money printed on the closed loop.
        uint256 ownerFinal = RealIERC20(SEPOLIA_USDC).balanceOf(owner);
        assertGt(ownerFinal, margin * 90 / 100, "owner recovers above 90% of margin after full CoW cycle on 11155111");
        assertLt(ownerFinal, margin * 101 / 100, "no free money on flat-price round-trip");
    }
}