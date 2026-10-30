// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {StdCheats} from "forge-std/StdCheats.sol";
import {console} from "forge-std/console.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {AggregatorV3Interface} from "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";

import {EswapMarginHook} from "../src/v4/EswapMarginHook.sol";
import {EswapRouter} from "../src/v4/EswapRouter.sol";
import {PoolKey} from "../src/v4/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "../src/v4/types/PoolId.sol";
import {Currency} from "../src/v4/types/Currency.sol";

/// @notice Stage 4 analog — FORK-ONLY dry run of the production $5 + $20 trade.
///
///         It opens a 5x WETH long with $5 USDC margin against the LIVE Base
///         Eswap stack, with the $20 borrow leg supplied by a solver through
///         the router's escrow (the real "solver supplies the borrow" path).
///
///         This NEVER broadcasts to mainnet: run it with `--rpc-url <Base>` and
///         NO `--broadcast`, so every state change lives only in the fork.
///
///         It impersonates the router owner (to whitelist the solver) and a
///         margin funder, and `deal`s real USDC on the fork. It then:
///           * executes the open and measures execution gas
///           * reads hook.positions(...) and hook.solverDebts(...)
///           * prints the brief's target (gas < 180,000) and the REAL number
///
/// Run:
///   forge script scripts/mainnetDryRun.s.sol:MainnetDryRun \
///     --rpc-url https://mainnet.base.org --via-ir -vv
contract MainnetDryRun is Script, StdCheats {
    using PoolIdLibrary for PoolKey;

    // --- Base (8453) ---
    address constant WETH = 0x4200000000000000000000000000000000000006;
    address constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    // Canonical Base v4 PoolManager (NOT 0x1F98..0004, which is Unichain).
    address constant BASE_PM = 0x498581fF718922c3f8e6A244956aF099B2652b2b;

    // Live Base deployment.
    address constant LIVE_HOOK = 0x7b38f16A40683457Fa46EcC819103613f47C50C8;
    address constant LIVE_ROUTER = 0xaBDD8e37082D232C331B109bC9Ca3c62A992F10F;
    address constant LIVE_OWNER = 0x518634753C61342298c3E04326056b3Ce596a566;

    uint256 constant GAS_TARGET = 180_000;

    function run() external {
        require(block.chainid == 8453, "not Base (8453)");

        address hookAddr = vm.envOr("BASE_HOOK_ADDRESS", LIVE_HOOK);
        address routerAddr = vm.envOr("BASE_ROUTER_ADDRESS", LIVE_ROUTER);
        address owner = vm.envOr("ROUTER_OWNER", LIVE_OWNER);

        uint256 margin = vm.envOr("MARGIN_USDC", uint256(5e6)); // $5
        uint8 leverage = uint8(vm.envOr("LEVERAGE", uint256(5))); // 5x
        uint256 borrow = margin * (uint256(leverage) - 1); // $20

        address trader = _resolveActor("TRADER_ADDRESS", "TRADER_PK", address(0xBEEF));
        address solver = _resolveActor("SOLVER_ADDRESS", "SOLVER_PRIVATE_KEY", address(0x5017E4));

        console.log("=== Stage 4: Base fork dry-run (no broadcast) ===");
        console.log("PoolManager:", BASE_PM);
        console.log("Hook       :", hookAddr);
        console.log("Router     :", routerAddr);
        console.log("Trader     :", trader);
        console.log("Solver     :", solver);
        console.log("margin     :", margin, "(USDC raw)");
        console.log("leverage   :", leverage);
        console.log("borrow leg :", borrow, "(USDC raw)");

        // Optional VM-level oracle overlay. On Base the raw Chainlink USDC/USD
        // feed (~24 h heartbeat) is older than the protocol's 1 h MAX_ORACLE_AGE
        // at most blocks, so a bare latest-block fork reverts StalePrice(). This
        // overlay stamps updatedAt = block.timestamp on the USDC/USD aggregator,
        // exactly what the Unichain UsdcTwapFeed adapter does natively, so the
        // FULL open path can be exercised. It is a fork-only cheatcode overlay,
        // NOT a real feed and NOT a broadcast. Off unless MOCK_FRESH_ORACLE=1.
        if (vm.envOr("MOCK_FRESH_ORACLE", false)) {
            address usdcFeed = vm.envOr(
                "USDC_USD_FEED_ADDRESS", address(0x7e860098F58bBFC8648a4311b374B1D669a2bc6B)
            );
            vm.mockCall(
                usdcFeed,
                abi.encodeWithSelector(AggregatorV3Interface.latestRoundData.selector),
                abi.encode(uint80(1), int256(100_000_000), block.timestamp, block.timestamp, uint80(1))
            );
            console.log("MOCK_FRESH_ORACLE=1 -> USDC/USD feed updatedAt overridden to block.timestamp");
        }

        EswapRouter router = EswapRouter(payable(routerAddr));

        // ---- Fund actors on the fork --------------------------------------
        deal(USDC, trader, margin);
        deal(USDC, solver, borrow);

        // ---- Owner: whitelist the solver ----------------------------------
        vm.prank(owner);
        router.setSolverWhitelist(solver, true);

        // ---- Solver: approve + escrow the borrow leg ----------------------
        vm.startPrank(solver);
        IERC20(USDC).approve(routerAddr, type(uint256).max);
        router.depositBorrowEscrow(USDC, borrow);
        vm.stopPrank();

        // ---- Trader: approve margin ---------------------------------------
        vm.prank(trader);
        IERC20(USDC).approve(routerAddr, type(uint256).max);

        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(WETH),
            currency1: Currency.wrap(USDC),
            fee: 3000,
            tickSpacing: 60,
            hooks: hookAddr
        });
        PoolKey memory standardKey = PoolKey({
            currency0: Currency.wrap(WETH),
            currency1: Currency.wrap(USDC),
            fee: 500,
            tickSpacing: 10,
            hooks: address(0)
        });

        bytes memory hookData = abi.encode(true, leverage, trader);
        EswapRouter.SwapParams memory params = EswapRouter.SwapParams({
            key: key,
            standardPoolKey: standardKey,
            zeroForOne: false, // buy WETH with USDC -> long
            amountSpecified: -int256(margin),
            leverage: leverage,
            solver: solver,
            hookData: hookData,
            deadline: block.timestamp + 15 minutes,
            minAmountOut: 0
        });

        // ---- Execute, measuring execution gas -----------------------------
        uint256 gasBefore = gasleft();
        bool ok;
        // The solver-funded entrypoint only accepts the margin funder as the
        // caller (anti-drain gate), so relay as the trader who approved here.
        vm.prank(trader);
        try router.swapMultiPoolForSolverFunded(params, trader, trader) {
            ok = true;
        } catch Error(string memory reason) {
            console.log("open reverted:", reason);
        } catch (bytes memory data) {
            console.log("open reverted w/ data:");
            console.logBytes(data);
        }
        uint256 gasUsed = gasBefore - gasleft();

        if (!ok) {
            console.log("RESULT: dry-run did NOT complete on this fork (see revert above).");
            return;
        }

        // ---- Inspect senior-debt + position state -------------------------
        EswapMarginHook hook = EswapMarginHook(payable(hookAddr));
        PoolId pid = key.toId();

        (address pTrader, uint256 pCollateral, uint256 pBorrow, uint8 pLev, bool pLong, , , , ) =
            hook.positions(pid, trader);
        (address debtSolver, uint256 principal, uint256 accruedYield) =
            hook.solverDebts(pid, trader, solver);

        console.log("");
        console.log("--- state ---");
        console.log("position.trader   :", pTrader);
        console.log("position.collateral:", pCollateral);
        console.log("position.borrowed :", pBorrow);
        console.log("position.leverage :", uint256(pLev));
        console.log("position.isLong   :", pLong);
        console.log("solverDebt.solver :", debtSolver);
        console.log("solverDebt.principal:", principal);
        console.log("solverDebt.yield  :", accruedYield);

        console.log("");
        console.log("--- gas ---");
        console.log("execution gas used:", gasUsed);
        console.log("brief target      :", GAS_TARGET);
        console.log(gasUsed < GAS_TARGET ? "WITHIN target" : "ABOVE target (real number shown)");
    }

    function _resolveActor(string memory addrKey, string memory pkKey, address fallback_)
        internal
        view
        returns (address)
    {
        string memory s = vm.envOr(addrKey, string(""));
        if (bytes(s).length > 0) return vm.parseAddress(s);
        uint256 pk = vm.envOr(pkKey, uint256(0));
        if (pk != 0) return vm.addr(pk);
        return fallback_;
    }
}
