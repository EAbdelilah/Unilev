// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {EswapMarginHook} from "../../src/v4/EswapMarginHook.sol";
import {EswapRouter} from "../../src/v4/EswapRouter.sol";
import {PoolKey} from "../../src/v4/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "../../src/v4/types/PoolId.sol";
import {Currency} from "../../src/v4/types/Currency.sol";

/// @notice Live smoke test: open a small USDC- or WETH-margin position on the
///         deployed Unichain stack via EswapRouter.swap, then report the recorded
///         position. Supports LONG (zeroForOne=true, USDC margin) and SHORT
///         (zeroForOne=false, WETH margin) as well as leverage with an on-chain
///         solver (required for LEVERAGE > 1 — the router settles the borrowed
///         leg from the solver via transferFrom, so the solver must approve the
///         router and hold the borrowed currency).
///         Env: PRIVATE_KEY, HOOK_ADDRESS, ROUTER_ADDRESS, USDC_ADDRESS,
///         POSITION_TYPE (default LONG), LEVERAGE (default 1), MARGIN_USDC (raw,
///         default 500000 = 0.5 USDC), MARGIN_WETH (raw, default 0 = derive from
///         $ value), SOLVER_ADDRESS (required when LEVERAGE > 1).
contract LiveOpenPosition is Script {
    using PoolIdLibrary for PoolKey;

    address constant WETH = 0x4200000000000000000000000000000000000006;
    address constant PM = 0x1F98400000000000000000000000000000000004;

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address trader = vm.addr(pk);
        address hookAddr = vm.envAddress("HOOK_ADDRESS");
        address routerAddr = vm.envAddress("ROUTER_ADDRESS");
        address usdc = vm.envAddress("USDC_ADDRESS");
        string memory positionType = vm.envOr("POSITION_TYPE", string("LONG"));
        bool isLong = keccak256(bytes(positionType)) == keccak256(bytes("LONG"));
        uint8 leverage = uint8(vm.envOr("LEVERAGE", uint256(1)));
        uint256 marginUsdc = vm.envOr("MARGIN_USDC", uint256(500000)); // 0.5 USDC raw
        uint256 marginWeth = vm.envOr("MARGIN_WETH", uint256(0));
        if (marginWeth == 0) marginWeth = 240000000000000; // 0.00024 WETH ≈ $0.45
        address solver = vm.envOr("SOLVER_ADDRESS", address(0));
        if (leverage > 1 && solver == address(0)) revert("SOLVER_ADDRESS required for LEVERAGE > 1");

        EswapRouter router = EswapRouter(routerAddr);

        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(usdc),
            currency1: Currency.wrap(WETH),
            fee: 3000,
            tickSpacing: 60,
            hooks: hookAddr
        });
        PoolKey memory standardKey = PoolKey({
            currency0: key.currency0,
            currency1: key.currency1,
            fee: 500,
            tickSpacing: 60,
            hooks: address(0)
        });

        bytes memory hookData = abi.encode(true, leverage, trader);

        vm.startBroadcast(pk);
        if (isLong) {
            IERC20(usdc).approve(routerAddr, type(uint256).max);
            router.swap(EswapRouter.SwapParams({
                key: key,
                standardPoolKey: standardKey,
                zeroForOne: true,            // sell USDC (currency0), buy WETH → long
                amountSpecified: -int256(marginUsdc),
                leverage: leverage,
                solver: solver,
                hookData: hookData
            }));
        } else {
            IERC20(WETH).approve(routerAddr, type(uint256).max);
            router.swap(EswapRouter.SwapParams({
                key: key,
                standardPoolKey: standardKey,
                zeroForOne: false,           // sell WETH (currency1), buy USDC → short
                amountSpecified: -int256(marginWeth),
                leverage: leverage,
                solver: solver,
                hookData: hookData
            }));
        }
        vm.stopBroadcast();

        EswapMarginHook hook = EswapMarginHook(payable(hookAddr));
        (address posTrader, uint256 posCollateral, uint256 posBorrow, uint8 posLev, bool posIsLong, , , , ) =
            hook.positions(key.toId(), trader);
        console.log("trader:", trader);
        console.log("posTrader:", posTrader);
        console.log("collateral raw:", posCollateral);
        console.log("borrowed raw:", posBorrow);
        console.log("leverage:", uint256(posLev));
        console.log("isLong:", posIsLong);
    }
}