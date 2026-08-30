// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {IERC20} from "forge-std/interfaces/IERC20.sol";

contract EthToUsdcSwapper {
    IPoolManager public immutable manager;

    constructor(IPoolManager _manager) {
        manager = _manager;
    }

    receive() external payable {}

    function swapEthForUsdc(PoolKey memory key, uint256 ethAmount) external payable returns (uint256 usdcOut) {
        bytes memory result = manager.unlock(abi.encode(key, ethAmount, msg.sender));
        usdcOut = abi.decode(result, (uint256));
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        (PoolKey memory key, uint256 ethAmount, address recipient) = abi.decode(data, (PoolKey, uint256, address));

        BalanceDelta delta = manager.swap(
            key,
            IPoolManager.SwapParams({
                zeroForOne: true,
                amountSpecified: -int256(ethAmount),
                sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
            }),
            ""
        );

        // Settle ETH input (delta.amount0 is negative)
        manager.sync(key.currency0);
        manager.settle{value: ethAmount}();

        // Take USDC output (delta.amount1 is positive)
        uint256 usdcReceived = uint256(int256(delta.amount1()));
        manager.take(key.currency1, recipient, usdcReceived);

        return abi.encode(usdcReceived);
    }
}

contract SwapEthToUsdcScript is Script {
    address constant UNICHAIN_PM = 0x1F98400000000000000000000000000000000004;
    address constant ETH         = address(0);
    address constant USDC        = 0x078D782b760474a361dDA0AF3839290b0EF57AD6;

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(pk);

        EthToUsdcSwapper swapper = new EthToUsdcSwapper(IPoolManager(UNICHAIN_PM));

        PoolKey memory stdKey = PoolKey({
            currency0: Currency.wrap(ETH),
            currency1: Currency.wrap(USDC),
            fee: 500,
            tickSpacing: 10,
            hooks: IHooks(address(0))
        });

        uint256 swapAmount = 0.00017 ether;
        uint256 usdcOut = swapper.swapEthForUsdc{value: swapAmount}(stdKey, swapAmount);
        console.log("Swapped 0.0001 ETH -> USDC received:", usdcOut);

        vm.stopBroadcast();
    }
}
