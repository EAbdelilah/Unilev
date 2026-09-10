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

/// @notice Live smoke test: open a margin position on the deployed Unichain stack
///         using the NATIVE-ETH/USDC configuration (accounting pool (ETH, USDC)
///         3000/60 with hook, physical fill on the DEEP (ETH, USDC) 500/10 pool
///         via EswapRouter.swapMultiPool).
///         SHORT = sell native ETH (zeroForOne=true), funded entirely by
///         msg.value = margin * leverage; margin native wei.
///         LONG = buy native ETH with USDC (zeroForOne=false), margin USDC;
///         LEVERAGE>1 pulls the borrow from SOLVER_ADDRESS so that account must
///         hold + approve USDC.
///         Requires the hook to be configured by LiveRepurposeHookConfig first.
///         Env: PRIVATE_KEY (trader), HOOK_ADDRESS, ROUTER_ADDRESS, USDC_ADDRESS,
///         POSITION_TYPE (SHORT default), LEVERAGE (default 1), MARGIN_WEI (raw
///         native wei, short), MARGIN_USDC (raw, long, default 500000).
contract LiveOpenPosition is Script {
    using PoolIdLibrary for PoolKey;

    address constant NATIVE_ETH = address(0);
    address constant USDC = 0x078D782b760474a361dDA0AF3839290b0EF57AD6; // Unichain mainnet USDC

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address trader = vm.addr(pk);
        address hookAddr = vm.envAddress("V4_HOOK_ADDRESS");
        address routerAddr = vm.envAddress("V4_ROUTER_ADDRESS");
        address v4Solver = vm.envOr("V4_SOLVER_ADDRESS", address(0));
        string memory positionType = vm.envOr("POSITION_TYPE", string("SHORT"));
        bool isShort = keccak256(bytes(positionType)) == keccak256(bytes("SHORT"));
        uint8 leverage = uint8(vm.envOr("LEVERAGE", uint256(1)));
        uint256 marginUsdc = vm.envOr("MARGIN_USDC", uint256(500000)); // 0.5 USDC raw
        uint256 marginWei = vm.envOr("MARGIN_WEI", uint256(200000000000000)); // 0.0002 ETH
        address solver = vm.envOr("SOLVER_ADDRESS", v4Solver);
        if (!isShort && leverage > 1 && solver == address(0)) {
            revert("SOLVER_ADDRESS required for LONG LEVERAGE > 1");
        }

        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(NATIVE_ETH),
            currency1: Currency.wrap(USDC),
            fee: 3000,
            tickSpacing: 60,
            hooks: hookAddr
        });
        PoolKey memory standardKey = PoolKey({
            currency0: Currency.wrap(NATIVE_ETH),
            currency1: Currency.wrap(USDC),
            fee: 500,
            tickSpacing: 10,
            hooks: address(0)
        });

        bytes memory hookData = abi.encode(true, leverage, trader);
        EswapRouter router = EswapRouter(payable(routerAddr));

        vm.startBroadcast(pk);
        if (isShort) {
            uint256 notional = marginWei * uint256(leverage);
            router.swapMultiPool{value: notional}(EswapRouter.SwapParams({
                key: key,
                standardPoolKey: standardKey,
                zeroForOne: true, // sell native ETH (currency0), buy USDC -> short
                amountSpecified: -int256(marginWei),
                leverage: leverage,
                solver: solver,
                hookData: hookData,
                deadline: block.timestamp + 15 minutes,
minAmountOut: 0
            }));
        } else {
            IERC20(USDC).approve(routerAddr, type(uint256).max);
            router.swapMultiPool(EswapRouter.SwapParams({
                key: key,
                standardPoolKey: standardKey,
                zeroForOne: false, // buy native ETH (currency0) with USDC -> long
                amountSpecified: -int256(marginUsdc),
                leverage: leverage,
                solver: solver,
                hookData: hookData,
                deadline: block.timestamp + 15 minutes,
minAmountOut: 0
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