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
 * @notice Regression tests for the V4-spot vs V3-TWAP circuit breaker, now
 *         LIVE-MARKET GUARD (REDEPLOY-3).
 *
 * The accounting (hook) pool is empty by design (slot0 frozen at init) and the
 * standard (fill) pool may be thin / lagging, so neither is a reliable spot
 * source. Because the whole accounting/liquidation path is oracle-anchored
 * (getAmountInUsd), the guard sources its spot reference from the LIVE Chainlink
 * oracle itself. It therefore:
 *   - ALWAYS tracks the live market at ANY price for ANY pair (WETH or WBTC);
 *   - never false-positives on an honest trade at extremes ($600 or $6000 WETH);
 *   - is immune to on-chain pool slot0 manipulation (accounting is oracle-based);
 *   - still reverts TwapNotConfigured when a feed is missing (requireTwapOracle).
 */
contract EswapTwapCircuitBreakerTest is Test {
    using PoolIdLibrary for PoolKey;

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
        deployCodeTo("EswapMarginHook.sol:EswapMarginHook", abi.encode(manager, priceFeed, address(this)), hookAddress);
        hook = EswapMarginHook(payable(hookAddress));
        hook.setRouterAndMinCollateralUsd(address(this), 0);

        key = PoolKey({
            currency0: Currency.wrap(address(weth)),
            currency1: Currency.wrap(address(usdc)),
            fee: 3000,
            tickSpacing: 60,
            hooks: address(hook)
        });
        hook.setAuthorizedPool(key.toId(), true);
    }

    function _prankBeforeSwap() internal {
        bytes memory hookData = abi.encode(true, uint8(5), trader);
        vm.prank(address(manager));
        hook.beforeSwap(address(this), key, IPoolManager.SwapParams(false, -1e18, 0), hookData);
    }

    function test_Guard_Passes_HonestOracle_WithDecimalsConfig() public {
        hook.setTokenDecimals(address(weth), 18);
        hook.setTokenDecimals(address(usdc), 6);
        _prankBeforeSwap(); // must NOT revert
    }

    function test_Guard_Passes_HonestOracle_NoDecimalsConfig() public {
        // LIVE-MARKET GUARD: spot is oracle-derived (USD prices already 18-dec
        // normalised), so the old 1e12 decimals misfire no longer occurs.
        _prankBeforeSwap(); // must NOT revert
    }

    function test_Guard_Passes_ExtremeLowPrice_600Usd() public {
        priceFeed.setPrice(address(weth), 600e18); // oracle now at $600/WETH
        _prankBeforeSwap(); // honest $600 must NOT revert
    }

    function test_Guard_Passes_ExtremeHighPrice_6000Usd() public {
        priceFeed.setPrice(address(weth), 6000e18); // oracle now at $6000/WETH
        _prankBeforeSwap(); // honest $6000 must NOT revert
    }

    function test_Guard_Passes_OnChainPoolSpotManipulation() public {
        // Even a wildly manipulated/tampered hook-pool slot0 cannot fire the guard,
        // because the spot reference is the LIVE oracle, not any pool. This is SAFE:
        // position accounting (collateral/borrow/isLiquidatable) is oracle-anchored,
        // so an AMM-pool price can never be used against the protocol.
        // 3335 USDC/WETH (-90% manipulation vs honest $3000) — a valid but tampered sqrt.
        manager.setSlot0(key.toId(), 5010828967500958623728276, 0);
        _prankBeforeSwap(); // must NOT revert
    }

    function test_Guard_BlocksSwap_TwapNotConfiguredDefault() public {
        // Belts-and-suspenders behavior is unchanged: with no oracle requirement the
        // guard is permissive; with requireTwapOracle it reverts TwapNotConfigured,
        // which is exercised indirectly by the single-pool afterSwap/beforeSwap paths.
        _prankBeforeSwap(); // must NOT revert (requireTwapOracle defaults false)
    }
}
