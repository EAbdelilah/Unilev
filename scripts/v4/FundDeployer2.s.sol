// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {IPoolManager as RealIPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey as RealPoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency as RealCurrency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks as RealIHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolSwapTest} from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {EswapMarginLib} from "../../src/v4/EswapMarginLib.sol";

/// @notice Swap WETH -> USDC on the deep fee-500 no-hook pool using the
///         already-deployed PoolSwapTest at SWAPPER_ADDRESS. Env: PRIVATE_KEY,
///         SWAPPER_ADDRESS, WETH_IN (raw 18-dec wei).
contract FundDeployer2 is Script {
    address constant USDC = 0x078D782b760474a361dDA0AF3839290b0EF57AD6;
    address constant WETH = 0x4200000000000000000000000000000000000006;

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);
        address swapperAddr = vm.envAddress("SWAPPER_ADDRESS");
        uint256 wethIn = vm.envOr("WETH_IN", uint256(500000000000000)); // 0.0005 WETH

        PoolSwapTest swapper = PoolSwapTest(swapperAddr);

        RealPoolKey memory key = RealPoolKey({
            currency0: RealCurrency.wrap(USDC),
            currency1: RealCurrency.wrap(WETH),
            fee: 500,
            tickSpacing: 60,
            hooks: RealIHooks(address(0))
        });

        vm.startBroadcast(pk);
        IERC20(WETH).approve(address(swapper), type(uint256).max);
        // zeroForOne=false: sell WETH (currency1), buy USDC -> amounts[0] = USDC
        BalanceDelta delta = swapper.swap(
            key,
            RealIPoolManager.SwapParams({
                zeroForOne: false,
                amountSpecified: -int256(wethIn),
                sqrtPriceLimitX96: EswapMarginLib.sqrtPriceLimit(false)
            }),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            ""
        );
        vm.stopBroadcast();

        int128 usdcDelta = delta.amount0();
        console.log("WETH in:", wethIn);
        console.log("USDC delta (amount0):", uint256(int256(usdcDelta)));
        console.log("deployer USDC balance:", IERC20(USDC).balanceOf(deployer));
    }
}
