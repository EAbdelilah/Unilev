// SPDX-License-Identifier: MIT
pragma solidity =0.8.19;

import {Utils} from "./utils/Utils.sol";
import "./utils/TestSetup.sol";

contract UtilsTest is TestSetup {
    function test__init() public {
        assertEq(address(uniswapV3Helper.swapRouter()), conf.swapRouter);
        assertEq(
            address(uniswapV3Helper.nonfungiblePositionManager()),
            conf.nonfungiblePositionManager
        );
    }

    function test__uniswap_priceUSDCWETH() public {
        // UniswapV3Helper.swapExactInputSingle()

        (uint160 sqrtPrice0, , , , , , ) = UniswapV3Pool(0x8ad599c3A0ff1De082011EFDDc58f1908eb6e6D8) // poolUSDCWETH
            .slot0();
        // console.log("%s:%d", "sqrtPrice0", sqrtPrice0);

        uint160 price0 = uniswapV3Helper.sqrtPriceX96ToPrice(sqrtPrice0, 6);
        // console.log("%s:%d", "Price0", price0);

        uint160 sqrtPrice1 = uniswapV3Helper.priceToSqrtPriceX96(price0, 6);
        // console.log("%s:%d", "sqrtPrice1", sqrtPrice1);

        assertApproxEqRel(sqrtPrice0, sqrtPrice1, 0.01e18);
    }

    function test__uniswap_priceWBTCUSDC() public {
        // UniswapV3Helper.swapExactInputSingle()

        (uint160 sqrtPrice0, , , , , , ) = UniswapV3Pool(0x99ac8cA7087fA4A2A1FB6357269965A2014ABc35) // poolWBTCUSDC
            .slot0();
        // console.log("%s:%d", "sqrtPrice0", sqrtPrice0);

        uint160 price0 = uniswapV3Helper.sqrtPriceX96ToPrice(sqrtPrice0, 8);
        // console.log("%s:%d", "Price0", price0);

        uint160 sqrtPrice1 = uniswapV3Helper.priceToSqrtPriceX96(price0, 8);
        // console.log("%s:%d", "sqrtPrice1", sqrtPrice1);

        assertApproxEqRel(sqrtPrice0, sqrtPrice1, 0.01e18);
    }

    function test__uniswap_priceWBTCWETH() public {
        uint inAmount = 10e8;
        writeTokenBalance(alice, conf.addWBTC, inAmount);
        // console.log("%s:%d", "alice balance WBTC : ", ERC20(conf.addWBTC).balanceOf(alice));
        // console.log("%s:%d", "alice balance WETH : ", ERC20(conf.addWETH).balanceOf(alice));

        vm.startPrank(alice);
        ERC20(conf.addWBTC).approve(address(uniswapV3Helper), inAmount);
        uniswapV3Helper.swapExactInputSingle(conf.addWBTC, conf.addWETH, 3000, inAmount);
        vm.stopPrank();

        (uint160 sqrtPrice0, , , , , , ) = UniswapV3Pool(0xCBCdF9626bC03E24f779434178A73a0B4bad62eD) // poolWBTCWETH
            .slot0();
        // console.log("%s:%d", "sqrtPrice0", sqrtPrice0);

        uint160 price0 = uniswapV3Helper.sqrtPriceX96ToPrice(sqrtPrice0, 8);
        // console.log("%s:%d", "Price0", price0);

        mockV3AggregatorWBTCETH.updateAnswer(int(int160(price0)));
        (, int256 priceToken, , , ) = mockV3AggregatorWBTCETH.latestRoundData();
        // console.log("%s:%d", "Chainlink price : ", uint(priceToken));
        // console.log("%s:%d", "Chainlink price : ", uint(priceToken));

        uint160 sqrtPrice1 = uniswapV3Helper.priceToSqrtPriceX96(uint160(uint(priceToken)), 8);
        // console.log("%s:%d", "sqrtPrice1", sqrtPrice1);

        assertApproxEqRel(sqrtPrice0, sqrtPrice1, 0.01e18);
    }

    function test__sqrtPriceX96ToPriceFuzz6Dec(uint160 init) public {
        vm.assume(init > (1 << 96));
        vm.assume(init < (1 << 120));

        console.log("%s:%d", "init", init);
        uint160 price = uniswapV3Helper.sqrtPriceX96ToPrice(init, 6);
        console.log("%s:%d", "sqrtPriceX96ToPrice", price);
        uint160 pricex96 = uniswapV3Helper.priceToSqrtPriceX96(price, 6);
        console.log("%s:%d", "priceToSqrtPriceX96", pricex96);

        assertApproxEqRel(init, pricex96, 0.01e18);
    }

    // function test__sqrtPriceX96ToPriceFuzz7Dec(uint160 init) public {
    //     vm.assume(init > (1 << 96));
    //     vm.assume(init < (1 << 120));

    //     console.log("%s:%d", "init", init);
    //     uint160 price = uniswapV3Helper.sqrtPriceX96ToPrice(init, 7);
    //     console.log("%s:%d", "sqrtPriceX96ToPrice", price);
    //     uint160 pricex96 = uniswapV3Helper.priceToSqrtPriceX96(price, 7);
    //     console.log("%s:%d", "priceToSqrtPriceX96", pricex96);

    //     assertApproxEqRel(init, pricex96, 0.01e18);
    // }

    function test__sqrtPriceX96ToPriceFuzz8Dec(uint160 init) public {
        vm.assume(init > (1 << 96));
        vm.assume(init < (1 << 120));

        console.log("%s:%d", "init", init);
        uint160 price = uniswapV3Helper.sqrtPriceX96ToPrice(init, 8);
        console.log("%s:%d", "sqrtPriceX96ToPrice", price);
        uint160 pricex96 = uniswapV3Helper.priceToSqrtPriceX96(price, 8);
        console.log("%s:%d", "priceToSqrtPriceX96", pricex96);

        assertApproxEqRel(init, pricex96, 0.01e18);
    }

    function test__sqrtPriceX96ToPriceFuzz18Dec(uint160 init) public {
        vm.assume(init > (1 << 96));
        vm.assume(init < (1 << 120));

        console.log("%s:%d", "init", init);
        uint160 price = uniswapV3Helper.sqrtPriceX96ToPrice(init, 18);
        console.log("%s:%d", "sqrtPriceX96ToPrice", price);
        uint160 pricex96 = uniswapV3Helper.priceToSqrtPriceX96(price, 18);
        console.log("%s:%d", "priceToSqrtPriceX96", pricex96);

        assertApproxEqRel(init, pricex96, 0.01e18);
    }

    function test__getLiquidityPool() public {
        address pool = market.getTokenToLiquidityPools(conf.addWBTC);
        assertEq(pool, address(lbPoolWBTC));
    }

    function test__setPrice1() public {
        setPrice(
            30000e6,
            conf.addWBTC,
            conf.addUSDC,
            3000,
            mockV3AggregatorWBTCETH,
            mockV3AggregatorUSDCETH,
            uniswapV3Helper
        );

        // setPrice(
        //     19000e6,
        //     conf.addWBTC,
        //     conf.addUSDC,
        //     3000,
        //     mockV3AggregatorWBTCETH,
        //     mockV3AggregatorUSDCETH,
        //     uniswapV3Helper
        // );
    }
}
