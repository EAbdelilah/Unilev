// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolModifyLiquidityTest} from "@uniswap/v4-core/src/test/PoolModifyLiquidityTest.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency, CurrencyLibrary} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {IERC20} from "forge-std/interfaces/IERC20.sol";

contract AddV4Liquidity is Script {
    address constant UNICHAIN_PM = 0x1F98400000000000000000000000000000000004;
    address constant ETH = address(0);
    address constant USDC = 0x078D782b760474a361dDA0AF3839290b0EF57AD6;

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address sender = vm.addr(deployerPrivateKey);
        vm.startBroadcast(deployerPrivateKey);

        // 1. Deploy the test liquidity modifier
        PoolModifyLiquidityTest modifierTest = new PoolModifyLiquidityTest(IPoolManager(UNICHAIN_PM));
        console.log("PoolModifyLiquidityTest deployed at:", address(modifierTest));

        // 2. Approve USDC to the modifier
        IERC20 usdc = IERC20(USDC);
        usdc.approve(address(modifierTest), type(uint256).max);

        // 3. Define the Standard Pool Key (ETH/USDC 500, tickSpacing 10, no hook)
        PoolKey memory standardKey = PoolKey({
            currency0: Currency.wrap(ETH),
            currency1: Currency.wrap(USDC),
            fee: 500,
            tickSpacing: 10,
            hooks: IHooks(address(0))
        });

        // 4. Provide Liquidity
        // Current tick is around -198030 (as initialized in deploy script).
        int24 tickLower = -198030 - (500 * 10);
        int24 tickUpper = -198030 + (500 * 10);
        int256 liquidityDelta = 10000000000; // ~ 10B liquidity units (around 0.1 USDC)

        IPoolManager.ModifyLiquidityParams memory params = IPoolManager.ModifyLiquidityParams({
            tickLower: tickLower,
            tickUpper: tickUpper,
            liquidityDelta: liquidityDelta,
            salt: 0
        });

        // Add ETH value to cover the currency0 delta
        modifierTest.modifyLiquidity{value: 0.0005 ether}(standardKey, params, "");
        
        console.log("Liquidity added to Standard Pool!");

        vm.stopBroadcast();
    }
}
