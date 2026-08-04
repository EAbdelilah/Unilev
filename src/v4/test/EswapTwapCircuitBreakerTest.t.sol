// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {EswapMarginHook} from "../EswapMarginHook.sol";
import {PoolKey} from "../types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "../types/PoolId.sol";
import {Currency} from "../types/Currency.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {PriceFeedMock} from "./BaseV4Test.t.sol";
import {PoolManagerMock} from "./mocks/PoolManagerMock.sol";
import {IPoolManager} from "../interfaces/IPoolManager.sol";

contract ERC20MockDecimals is ERC20 {
    uint8 private immutable _tokenDecimals;

    constructor(string memory name, string memory symbol, uint8 decimals_) ERC20(name, symbol) {
        _tokenDecimals = decimals_;
        _mint(msg.sender, 1_000_000 ether);
    }

    function decimals() public view virtual override returns (uint8) {
        return _tokenDecimals;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/**
 * @notice Regression tests for the V4-spot vs V3-TWAP circuit breaker on pools
 *         with non-18-decimal tokens (USDC has 6 decimals).
 *
 * The raw sqrtPriceX96-derived ratio is off by 10^(d1-d0) from the human price,
 * so without a token-decimals adjustment the breaker fires on honest prices for
 * real USDC pools (~1e12 off). The hook must be configured via setTokenDecimals.
 */
contract EswapTwapCircuitBreakerTest is Test {
    using PoolIdLibrary for PoolKey;

    // Honest spot: 3000 USDC per WETH on a WETH(18)/USDC(6) pool.
    // P_raw = 3000 * 10^(6-18) = 3e-9, sqrtPriceX96 = floor(sqrt(3e-9) * 2^96)
    uint160 constant WETH0_HONEST = 4339505179874779489431521;
    // Manipulated spot: 4000 USDC per WETH (+33% > 5% MAX_PRICE_SWING_BPS).
    // P_raw = 4e-9, sqrtPriceX96 = floor(sqrt(4e-9) * 2^96)
    uint160 constant WETH0_MANIPULATED = 5010828967500958623728276;
    // Honest spot on the reversed USDC(6)/WETH(18) pool: 1/3000 WETH per USDC.
    // P_raw = (1/3000) * 10^12, sqrtPriceX96 = floor(sqrt(P_raw) * 2^96)
    uint160 constant USDC0_HONEST = 1446501726624926496477173928747177;

    EswapMarginHook hook;
    PoolManagerMock manager;
    PriceFeedMock priceFeed;
    PoolKey key;
    ERC20MockDecimals weth;
    ERC20MockDecimals usdc;

    address trader = address(0xBEEF);

    function setUp() public {
        manager = new PoolManagerMock();
        priceFeed = new PriceFeedMock();

        weth = new ERC20MockDecimals("WETH", "WETH", 18);
        usdc = new ERC20MockDecimals("USDC", "USDC", 6);

        priceFeed.setPrice(address(weth), 3000e18);
        priceFeed.setPrice(address(usdc), 1e18);

        address hookAddress = address(uint160((1 << 159) | (1 << 158) | (1 << 153) | (1 << 152) | (1 << 148)));
        deployCodeTo("EswapMarginHook.sol:EswapMarginHook", abi.encode(manager, priceFeed), hookAddress);
        hook = EswapMarginHook(hookAddress);
        hook.setRouter(address(this));

        key = PoolKey({
            currency0: Currency.wrap(address(weth)),
            currency1: Currency.wrap(address(usdc)),
            fee: 3000,
            tickSpacing: 60,
            hooks: address(hook)
        });
        hook.setAuthorizedPool(key.toId(), true);

        // Honest decimals-adjusted spot price
        manager.setSlot0(key.toId(), WETH0_HONEST, 0);
    }

    function test_TwapBreaker_Misfires_WithoutDecimalsConfig() public {
        // Legacy behavior: unconfigured tokens default to 18 decimals, so the raw
        // spot ratio (3e9) is ~1e12 off the 18-decimal TWAP ratio (3e21) and the
        // breaker fires on an honest price. Documents the fail-closed default.
        bytes memory hookData = abi.encode(true, uint8(5), trader);
        vm.prank(address(manager));
        vm.expectRevert("TWAP: V4 Spot Price manipulated");
        hook.beforeSwap(address(this), key, IPoolManager.SwapParams(false, -1e18, 0), hookData);
    }

    function test_TwapBreaker_Passes_HonestSpot_WithDecimalsConfig() public {
        hook.setTokenDecimals(address(weth), 18);
        hook.setTokenDecimals(address(usdc), 6);

        // Must NOT revert: spot and TWAP both represent 3000 USDC/WETH.
        bytes memory hookData = abi.encode(true, uint8(5), trader);
        vm.prank(address(manager));
        hook.beforeSwap(address(this), key, IPoolManager.SwapParams(false, -1e18, 0), hookData);
    }

    function test_TwapBreaker_Fires_ManipulatedSpot_WithDecimalsConfig() public {
        hook.setTokenDecimals(address(weth), 18);
        hook.setTokenDecimals(address(usdc), 6);

        // +33% flash-loan style manipulation must still be caught.
        manager.setSlot0(key.toId(), WETH0_MANIPULATED, 0);
        bytes memory hookData = abi.encode(true, uint8(5), trader);
        vm.prank(address(manager));
        vm.expectRevert("TWAP: V4 Spot Price manipulated");
        hook.beforeSwap(address(this), key, IPoolManager.SwapParams(false, -1e18, 0), hookData);
    }

    function test_TwapBreaker_Passes_ReversedPool_WithDecimalsConfig() public {
        hook.setTokenDecimals(address(weth), 18);
        hook.setTokenDecimals(address(usdc), 6);

        // USDC(6) as token0, WETH(18) as token1. twapRatio18 = 1e18/3000e18 = 1/3000e18.
        PoolKey memory reversed = PoolKey({
            currency0: Currency.wrap(address(usdc)),
            currency1: Currency.wrap(address(weth)),
            fee: 3000,
            tickSpacing: 60,
            hooks: address(hook)
        });
        hook.setAuthorizedPool(reversed.toId(), true);
        manager.setSlot0(reversed.toId(), USDC0_HONEST, 0);

        bytes memory hookData = abi.encode(true, uint8(5), trader);
        vm.prank(address(manager));
        hook.beforeSwap(address(this), reversed, IPoolManager.SwapParams(true, -1e18, 0), hookData);
    }
}
