// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import {EswapMarginHook} from "../EswapMarginHook.sol";
import {PoolKey} from "../types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "../types/PoolId.sol";
import {Currency} from "../types/Currency.sol";
import {IHooks} from "../interfaces/IHooks.sol";
import {IPoolManager} from "../interfaces/IPoolManager.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {PriceFeedMock} from "./BaseV4Test.t.sol";
import {PoolManagerMock} from "./mocks/PoolManagerMock.sol";
import {TickMath} from "../libraries/TickMath.sol";

contract EswapUnichainForkTest is Test {
    using PoolIdLibrary for PoolKey;

    // --- Unichain Mainnet Constants ---
    // User must replace these with real addresses once they are fully known on mainnet
    address constant UNICHAIN_WETH = address(0x4200000000000000000000000000000000000006); // Standard OP-stack WETH
    address constant UNICHAIN_USDC = address(0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913); // Example OP-stack USDC
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

        // Initialize the V4 pool with a starting price of 3000 USDC per WETH
        // sqrtPriceX96 for 3000 = ~4342511470701198426038843936496 (depends on decimals, assuming both 18 here for mock simplicity)
        uint160 startingSqrtPrice = 79228162514264337593543950336; // 1:1 for mock fallback
        if (token0 == UNICHAIN_WETH) {
            startingSqrtPrice = 4342511470701198426038843936496; // sqrt(3000) * 2^96
        } else {
            startingSqrtPrice = 1446706790936181774319409893; // sqrt(1/3000) * 2^96
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
        
        // Manipulate spot price significantly (e.g. sqrt(4000) instead of sqrt(3000))
        uint160 manipulatedSqrtPrice = isWeth0 ? 5014389020963507567786443426725 : 1251919808620888126046757134; 
        manager.setSlot0(key.toId(), manipulatedSqrtPrice, 0);

        // Attempt to open a position. The hook should revert due to V4 Spot vs V3 TWAP deviation
        bytes memory hookData = abi.encode(true, uint8(5), trader);
        
        vm.startPrank(address(manager));
        vm.expectRevert("TWAP: V4 Spot Price manipulated");
        hook.beforeSwap(address(this), key, !isWeth0, -10 ether, hookData);
        vm.stopPrank();
    }

    function test_Unichain_OpenProfitableLong() public {
        // Restore correct spot price
        uint160 correctSqrtPrice = Currency.unwrap(key.currency0) == UNICHAIN_WETH ? 4342511470701198426038843936496 : 1446706790936181774319409893;
        manager.setSlot0(key.toId(), correctSqrtPrice, 0);

        // Trader opens 5x Long on WETH
        bytes memory hookData = abi.encode(true, uint8(5), trader);
        bool zeroForOne = Currency.unwrap(key.currency0) == UNICHAIN_USDC; // If WETH is token1, we swap USDC(0) for WETH(1) to go long
        
        vm.startPrank(address(manager));
        // Provide 1000 USDC as margin
        hook.beforeSwap(address(this), key, zeroForOne, -1000e18, hookData);
        
        // Simulate exact AMM swap execution (5000 USDC worth of WETH)
        // V4 Transient states are mocked in afterSwap
        hook.afterSwap(address(this), key, zeroForOne, 1000e18, -1666666666666666666, 5000e18, hookData);
        vm.stopPrank();

        // Verify position was created
        ( , , , uint8 leverage, bool isLong, , , , ) = hook.positions(key.toId(), trader);
        assertEq(leverage, 5);
        assertTrue(isLong);
    }
}
