// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "forge-std/Test.sol";
import "../src/LiquidityPool.sol";
import "../src/StrategyExecutor.sol";
import "../src/UniswapV3Helper.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./mocks/MockERC20.sol";

contract StrategyExecutorTest is Test {
    LiquidityPool public lp;
    StrategyExecutor public executor;
    MockERC20 public asset;
    address public helper = address(0x123); // Mock helper address
    address public owner = address(this);

    function setUp() public {
        asset = new MockERC20("Test", "TST", 18);
        lp = new LiquidityPool(IERC20(address(asset)), address(this), "LP", "LP");
        executor = new StrategyExecutor(helper, owner);

        executor.setPoolTrust(address(lp), true);

        asset.mint(address(lp), 1000e18);
    }

    function test_FlashLoanArbitrage() public {
        StrategyExecutor.StrategyData memory data = StrategyExecutor.StrategyData({
            action: StrategyExecutor.Action.ARBITRAGE,
            tokenIn: address(asset),
            tokenOut: address(0x456),
            fee: 3000,
            amountIn: 100e18,
            minAmountOut: 0,
            extraData: abi.encode(uint24(500))
        });

        // This will fail because helper is not a real contract in this mock test
        // But we are testing the flash loan flow
        vm.mockCall(
            helper,
            abi.encodeWithSelector(UniswapV3Helper.swapExactInputSingle.selector),
            abi.encode(110e18)
        );

        bytes memory encodedData = abi.encode(data);

        // Executor needs to have enough tokenIn to repay if swap doesn't return enough
        asset.mint(address(executor), 10e18);

        lp.flashLoan(address(executor), 100e18, encodedData);

        assertEq(asset.balanceOf(address(lp)), 1000e18);
    }

    function test_FlashLoanUntrustedPool() public {
        LiquidityPool maliciousLp = new LiquidityPool(IERC20(address(asset)), address(this), "MAL", "MAL");

        vm.expectRevert("StrategyExecutor: Untrusted pool");
        executor.onFlashLoan(address(this), 100e18, "");
    }
}
