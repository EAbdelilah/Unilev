// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {EswapMarginHook} from "../src/v4/EswapMarginHook.sol";
import {EswapRouter} from "../src/v4/EswapRouter.sol";
import {PoolKey} from "../src/v4/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "../src/v4/types/PoolId.sol";
import {Currency} from "../src/v4/types/Currency.sol";
import {IERC20 as RealIERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @dev Reproduce the NEW live hook's deployCollateral revert against current
///      Unichain state (post-redeploy). Opens a clean LONG through the NEW
///      router, then forces deployCollateral via the router role to surface
///      the wrapped error.
contract LiveNewHookDeployRepro is Test {
    using PoolIdLibrary for PoolKey;

    address constant PM = 0x1F98400000000000000000000000000000000004;
    address constant USDC = 0x078D782b760474a361dDA0AF3839290b0EF57AD6;
    address constant ETH = address(0);

    address constant NEW_HOOK = 0xeFd436e76685E3b647c4c91Af9B9fE57772090C8;
    address constant NEW_ROUTER = 0xD8fB6160bd215a67937f00E2736f6F01Fc306CdC;

    address freshTrader = address(0x2222000022220000222200002222000022220000);
    address solver = 0x518634753C61342298c3E04326056b3Ce596a566;

    PoolKey hookKey =
        PoolKey({currency0: Currency.wrap(ETH), currency1: Currency.wrap(USDC), fee: 3000, tickSpacing: 60, hooks: NEW_HOOK});
    PoolKey stdKey =
        PoolKey({currency0: Currency.wrap(ETH), currency1: Currency.wrap(USDC), fee: 500, tickSpacing: 10, hooks: address(0)});

    EswapRouter router;
    EswapMarginHook hook;

    function setUp() public {
        string memory rpc = vm.envOr("UNICHAIN_RPC_URL", string(""));
        require(bytes(rpc).length > 0, "UNICHAIN_RPC_URL required");
        vm.createSelectFork(rpc);
        require(block.chainid == 130, "not unichain");
        router = EswapRouter(payable(NEW_ROUTER));
        hook = EswapMarginHook(payable(NEW_HOOK));
    }

    function test_Reproduce_NewHook_DeployCollateral() public {
        console2.log("live totalOpenInterestUSD", hook.totalOpenInterestUSD());
        console2.log("live totalCollateralUSDRunning", hook.totalCollateralUSDRunning());
        console2.log("live oiCapTvlFloorUsd", hook.oiCapTvlFloorUsd());

        deal(USDC, freshTrader, 1_000_000e6);
        deal(USDC, solver, 1_000_000e6);
        vm.prank(freshTrader);
        RealIERC20(USDC).approve(NEW_ROUTER, type(uint256).max);
        vm.prank(solver);
        RealIERC20(USDC).approve(NEW_ROUTER, type(uint256).max);

        uint256 margin = 100_000; // 0.1 USDC
        EswapRouter.SwapParams memory params = EswapRouter.SwapParams({
            key: hookKey,
            standardPoolKey: stdKey,
            zeroForOne: false, // LONG: pay token1 = USDC
            amountSpecified: -int256(margin),
            leverage: 2,
            solver: solver,
            hookData: abi.encode(true, uint8(2), freshTrader)
        });

        vm.prank(freshTrader);
        router.swapMultiPool(params);

        (address t, uint256 coll, uint256 bor, uint8 lev, bool isLong,, int24 tl, int24 tu, uint128 liq) =
            hook.positions(hookKey.toId(), freshTrader);
        console2.log("trader", vm.toString(t));
        console2.log("coll", coll);
        console2.log("bor", bor);
        console2.log("lev", uint256(lev));
        console2.log("isLong", isLong);
        console2.log("tickLower", int256(tl));
        console2.log("tickUpper", int256(tu));
        console2.log("liq", uint256(liq));
        console2.log("rehypPrincipal", hook.rehypPrincipal(hookKey.toId(), freshTrader));

        if (liq == 0) {
            // Unwrap the swallowed revert: impersonate the router and force it.
            vm.prank(NEW_ROUTER);
            hook.deployCollateral(hookKey, freshTrader);
        }
    }

    function test_ReplayLiveOpenTx() public {
        // Replay the ENTIRE live block 57882464 (all 9 txs in order) on the fork
        // pinned at block 57882463, then run the live LONG open LAST — matching
        // the exact on-chain state the original tx saw.
        vm.rollFork(57_882_463);
        string memory json = vm.readFile("test/block_57882464.json");
        // Replay prior txs 0..4, then OUR tx (5), then 6..8 — exact block order.
        for (uint256 i = 0; i < 5; i++) replayJsonTx(json, i);

        address trader = 0x518634753C61342298c3E04326056b3Ce596a566;
        bytes memory data = vm.parseBytes(vm.readFile("test/LiveNewHookReplay.input"));
        vm.prank(trader);
        (bool ok, bytes memory ret) = payable(NEW_ROUTER).call{gas: 817_000}(data); // live frame ≈ 848187 − intrinsic(~31k)
        console2.log("replay ok", ok);
        if (!ok) {
            console2.log("revert bytes len", ret.length);
            assembly {
                revert(add(ret, 32), mload(ret))
            }
        } else {
            console2.log("replay SUCCEEDED");
            (,, uint256 borL, uint8 levL, bool isLongL,, int24 tlL, int24 tuL, uint128 liqL) =
                hook.positions(hookKey.toId(), trader);
            console2.log("post-gas-cap bor", borL);
            console2.log("post-gas-cap lev", uint256(levL));
            console2.log("post-gas-cap isLong", isLongL);
            console2.log("post-gas-cap tl", uint256(int256(tlL)));
            console2.log("post-gas-cap tu", uint256(int256(tuL)));
            console2.log("post-gas-cap liq", uint256(liqL));
            console2.log("post-gas-cap rehyp", hook.rehypPrincipal(hookKey.toId(), trader));
        }
        for (uint256 i = 6; i < 9; i++) replayJsonTx(json, i);
    }

    function replayJsonTx(string memory json, uint256 i) internal {
        address from = vm.parseAddress(vm.parseJsonString(json, string.concat("[", vm.toString(i), "].from")));
        address to = vm.parseAddress(vm.parseJsonString(json, string.concat("[", vm.toString(i), "].to")));
        bytes memory inp = vm.parseBytes(vm.parseJsonString(json, string.concat("[", vm.toString(i), "].input")));
        vm.prank(from);
        (bool ok,) = to.call(inp);
        console2.log("tx", i, "ok", ok);
    }
}
