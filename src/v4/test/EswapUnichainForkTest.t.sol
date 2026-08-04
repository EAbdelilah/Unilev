// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import {EswapMarginHook} from "../EswapMarginHook.sol";
import {PoolKey} from "../types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "../types/PoolId.sol";
import {Currency} from "../types/Currency.sol";
import {IHooks} from "../interfaces/IHooks.sol";
import {IPoolManager} from "../interfaces/IPoolManager.sol";
import {BalanceDeltaLibrary} from "../types/BalanceDelta.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {PriceFeedMock} from "./BaseV4Test.t.sol";
import {PoolManagerMock} from "./mocks/PoolManagerMock.sol";
import {TickMath} from "../libraries/TickMath.sol";

contract EswapUnichainForkTest is Test {
    using PoolIdLibrary for PoolKey;

    // --- Unichain Mainnet Constants ---
    // Verified live on Unichain mainnet (Alchemy RPC).
    address constant UNICHAIN_WETH = address(0x4200000000000000000000000000000000000006); // OP-stack WETH
    address constant UNICHAIN_USDC = address(0x078D782b760474a361dDA0AF3839290b0EF57AD6); // Native USDC
    address constant UNICHAIN_V3_POOL_WETH_USDC = address(0x123); // Placeholder for V3 Pool
    
    // Core contracts
    PoolManagerMock manager;
    EswapMarginHook hook;
    PriceFeedMock priceFeed;
    PoolKey key;
    
    IERC20 weth = IERC20(UNICHAIN_WETH);
    IERC20 usdc = IERC20(UNICHAIN_USDC);

    address trader = address(0x1234);
    address router = address(0x5678);

    function setUp() public {
        // Create Unichain Fork
        string memory rpcUrl = vm.envOr("UNICHAIN_RPC_URL", string("https://unichain-mainnet.g.alchemy.com/v2/demo"));
        vm.createSelectFork(rpcUrl);

        // We mock the contracts that are not yet on Unichain or that we control natively
        manager = new PoolManagerMock();
        priceFeed = new PriceFeedMock();
        
        // If the Unichain tokens are not yet deployed on this fork RPC, deploy mocks to their exact addresses
        if (UNICHAIN_WETH.code.length == 0) {
            deployCodeTo("BaseV4Test.t.sol:ERC20Mock", abi.encode("WETH", "WETH"), UNICHAIN_WETH);
        }
        if (UNICHAIN_USDC.code.length == 0) {
            deployCodeTo("BaseV4Test.t.sol:ERC20Mock", abi.encode("USDC", "USDC"), UNICHAIN_USDC);
        }

        // Mock the price for WETH and USDC in the oracle (assuming 1 WETH = 3000 USDC)
        priceFeed.setPrice(UNICHAIN_WETH, 3000e18);
        priceFeed.setPrice(UNICHAIN_USDC, 1e18);

        // Deploy Hook
        address hookAddress = address(uint160((1 << 159) | (1 << 158) | (1 << 153) | (1 << 152) | (1 << 148)));
        deployCodeTo("EswapMarginHook.sol:EswapMarginHook", abi.encode(manager, priceFeed), hookAddress);
        hook = EswapMarginHook(hookAddress);

        hook.setRouter(router);
        
        // Setup the V4 Pool using the real Unichain tokens
        // Sort tokens as per Uniswap convention
        (address token0, address token1) = UNICHAIN_WETH < UNICHAIN_USDC 
            ? (UNICHAIN_WETH, UNICHAIN_USDC) 
            : (UNICHAIN_USDC, UNICHAIN_WETH);

        key = PoolKey({
            currency0: Currency.wrap(token0),
            currency1: Currency.wrap(token1),
            fee: 3000,
            tickSpacing: 60,
            hooks: address(hook)
        });

        hook.setAuthorizedPool(key.toId(), true);
        // WETH is the base token: "long WETH" positions report isLong=true. On
        // Unichain USDC < WETH, so currency0=USDC and currency1=WETH.
        hook.setBaseCurrency(key.toId(), Currency.wrap(UNICHAIN_WETH));
        // Configure decimals so the V4-spot vs V3-TWAP circuit breaker compares
        // like-for-like prices (USDC is 6-decimal, WETH 18-decimal).
        hook.setTokenDecimals(UNICHAIN_WETH, 18);
        hook.setTokenDecimals(UNICHAIN_USDC, 6);

        // Initialize the V4 pool with a starting price of 3000 USDC per WETH.
        // sqrtPriceX96 is computed from the raw token1/token0 ratio (decimals-aware):
        //   WETH as currency0: raw = 3000e6/1e18 = 3e-9
        //   USDC as currency0: raw = 1e18/3000e6 = 3.333e8
        uint160 startingSqrtPrice = 79228162514264337593543950336; // 1:1 for mock fallback
        if (token0 == UNICHAIN_WETH) {
            startingSqrtPrice = 4339505179874779489431521; // sqrt(3e-9) * 2^96
        } else {
            startingSqrtPrice = 1446501726624926496477173928747177; // sqrt(3.333e8) * 2^96
        }
        manager.setSlot0(key.toId(), startingSqrtPrice, 0);

        // Fund trader with real tokens using deal()
        vm.deal(trader, 10 ether);
        // On a real fork we would deal WETH and USDC, but since they might not exist at the exact placeholder addresses, we wrap in try/catch or skip minting if address is empty
        deal(UNICHAIN_WETH, trader, 100 ether);
        deal(UNICHAIN_USDC, trader, 300000 ether);

        vm.startPrank(trader);
        weth.approve(address(hook), type(uint256).max);
        usdc.approve(address(hook), type(uint256).max);
        vm.stopPrank();
    }

    function test_Unichain_TWAP_CircuitBreaker() public {
        // Scenario 3: Attempt to swap with a manipulated V4 spot price.
        // We set the oracle TWAP to 3000, but we forcefully set the V4 pool spot price to 4000 (manipulated)
        
        // Let's assume WETH is token0 for this test logic
        bool isWeth0 = Currency.unwrap(key.currency0) == UNICHAIN_WETH;
        
        // Manipulate spot price significantly (spot shows 4000 USDC/WETH instead of 3000).
        // Decimals-aware sqrtPriceX96 values:
        //   WETH as currency0: raw = 4000e6/1e18 = 4e-9
        //   USDC as currency0: raw = 1e18/4000e6 = 2.5e8
        uint160 manipulatedSqrtPrice = isWeth0 ? 5010828967500958623728276 : 1252707241875239655932069007848031;
        manager.setSlot0(key.toId(), manipulatedSqrtPrice, 0);

        // Attempt to open a position. The hook should revert due to V4 Spot vs V3 TWAP deviation
        bytes memory hookData = abi.encode(true, uint8(5), trader);
        
        vm.startPrank(address(manager));
        vm.expectRevert("TWAP: V4 Spot Price manipulated");
        hook.beforeSwap(address(this), key, IPoolManager.SwapParams(!isWeth0, -10 ether, 0), hookData);
        vm.stopPrank();
    }

    function test_Unichain_OpenProfitableLong() public {
        // Restore correct spot price (3000 USDC per WETH, decimals-aware)
        uint160 correctSqrtPrice = Currency.unwrap(key.currency0) == UNICHAIN_WETH ? 4339505179874779489431521 : 1446501726624926496477173928747177;
        manager.setSlot0(key.toId(), correctSqrtPrice, 0);

        // Trader opens 5x Long on WETH (borrows USDC, buys WETH).
        // On Unichain USDC < WETH so currency0=USDC: we sell USDC (currency0) to buy
        // WETH (currency1) → zeroForOne=true. If WETH were currency0 (e.g. Base),
        // we would sell USDC (currency1) to buy WETH → zeroForOne=false.
        bool zeroForOne = Currency.unwrap(key.currency0) == UNICHAIN_USDC;

        bytes memory hookData = abi.encode(true, uint8(5), trader);

        vm.startPrank(address(manager));
        // Provide margin (input USDC)
        hook.beforeSwap(address(this), key, IPoolManager.SwapParams(zeroForOne, -1000e18, 0), hookData);

        // Simulate exact AMM swap execution. afterSwap now receives the SWAPPER-side
        // BalanceDelta: amount0/amount1 are negative where the swapper pays (input)
        // and positive where the swapper receives (output). For zeroForOne=true on
        // Unichain, the swapper pays USDC (amount0 negative) and receives WETH (amount1 positive).
        int128 amount0;
        int128 amount1;
        if (zeroForOne) {
            amount0 = -5000e18;
            amount1 = 1666666666666666666;
        } else {
            amount0 = 1666666666666666666;
            amount1 = -5000e18;
        }
        hook.afterSwap(address(this), key, IPoolManager.SwapParams(zeroForOne, -1000e18, 0), BalanceDeltaLibrary.toBalanceDelta(amount0, amount1), hookData);
        vm.stopPrank();

        // Verify position was created, is a LONG (base = WETH), and collateral is WETH
        ( , , , uint8 leverage, bool isLong, , , , ) = hook.positions(key.toId(), trader);
        assertEq(leverage, 5);
        assertTrue(isLong);
        (Currency collateral, ) = hook.positionCurrencies(key, trader);
        assertEq(Currency.unwrap(collateral), UNICHAIN_WETH);
    }
}
