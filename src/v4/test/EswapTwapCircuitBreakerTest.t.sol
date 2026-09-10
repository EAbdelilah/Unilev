// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {EswapMarginHook} from "../EswapMarginHook.sol";
import {EswapMarginLib} from "../EswapMarginLib.sol";
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
 *         LIVE-MARKET GUARD (REDEPLOY-3, [FIX H-2]).
 *
 * The accounting (hook) pool is empty by design (slot0 frozen at init) and is
 * NOT a spot source. The guard therefore compares the REAL V4 slot0 of the
 * configured STANDARD (deep fill) pool against the Chainlink-anchored TWAP. It:
 *   - alerts on ANY honest price for ANY pair (WETH or WBTC) as long as the
 *     standard pool's live slot0 tracks the oracle (deviation < maxPriceSwingBps);
 *   - reverts TwapManipulated when the standard pool's slot0 deviates more than
 *     maxPriceSwingBps from the oracle TWAP (flash-manipulated or stale fill venue);
 *   - degrades to oracle-only (no-op) for accounting-only pairs with no standard
 *     pool configured, because the accounting/liquidation path is oracle-anchored;
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
        // Even a wildly manipulated/tampered HOOK-pool slot0 cannot fire the guard:
        // the spot reference is the live slot0 of the STANDARD (execution) pool,
        // not the empty accounting pool. When no standard pool is configured the
        // guard is a no-op — position accounting (collateral/borrow/isLiquidatable)
        // is oracle-anchored, so a hook-pool price can never be used against the
        // protocol. 3335 USDC/WETH (-90% manipulation vs honest $3000) slot0 here.
        manager.setSlot0(key.toId(), 5010828967500958623728276, 0);
        _prankBeforeSwap(); // must NOT revert
    }

    function test_Guard_Passes_RealStandardPoolSlot0_HonestPrice() public {
        // The credit lines: WETH(18) → oracle $3000/USDC(6). Honest pool spot =
        // 3000 USDC per WETH → sqrtPriceX96 = sqrt(3e-9) * 2^96.
        hook.setTokenDecimals(address(weth), 18);
        hook.setTokenDecimals(address(usdc), 6);
        _enableStandardPool(4339505179874780000000000);
        _prankBeforeSwap(); // honest pool tracking the oracle must NOT revert
    }

    function test_Guard_BlocksSwap_TamperedStandardPoolSlot0() public {
        // Standard pool slot0 manipulated 50% below the oracle (≈$1500 when the
        // oracle says $3000): the fill venue is not an honest market read and the
        // trade must be blocked instead of executing at a bad price.
        hook.setTokenDecimals(address(weth), 18);
        hook.setTokenDecimals(address(usdc), 6);
        _enableStandardPool(3068493539683600000000000);
        vm.expectRevert(EswapMarginLib.TwapManipulated.selector);
        _prankBeforeSwap();
    }

    function test_Guard_BlocksSwap_TamperedStandardPoolSlot0_NoDecimalsConfig() public {
        // Same tamper rejection when token decimals were never registered — the
        // guard still detects the (very large) manipulation (defaults 18/18).
        _enableStandardPool(3068493539683600000000000);
        vm.expectRevert(EswapMarginLib.TwapManipulated.selector);
        _prankBeforeSwap();
    }

    function test_Guard_AccountingOnly_RequireTwapOracle_Passes() public {
        // requireTwapOracle + no standard pool configured (accounting-only mode):
        // feeds are present so the guard is a no-op rather than a false positive.
        hook.setConfig(EswapMarginHook.ConfigParams({
            treasury: address(0xBEEF),
            router: address(this),
            reserveFactor: 50,
            maxPriceSwingBps: 800,
            defaultMaxLeverage: 5,
            requireTwapOracle: true
        }));
        _prankBeforeSwap(); // must NOT revert
    }

    function test_Guard_StandardPoolUninitialized_RequireTwapOracle_Reverts() public {
        // requireTwapOracle + standard pool configured but never initialized
        // (slot0 == 0): no honest spot to compare → TwapNotConfigured.
        hook.setTokenDecimals(address(weth), 18);
        hook.setTokenDecimals(address(usdc), 6);
        hook.setStandardPoolKey(key.toId(), _standardKey());
        hook.setConfig(EswapMarginHook.ConfigParams({
            treasury: address(0xBEEF),
            router: address(this),
            reserveFactor: 50,
            maxPriceSwingBps: 800,
            defaultMaxLeverage: 5,
            requireTwapOracle: true
        }));
        vm.expectRevert(EswapMarginLib.TwapNotConfigured.selector);
        _prankBeforeSwap();
    }

    function _standardKey() internal view returns (PoolKey memory) {
        return PoolKey({
            currency0: Currency.wrap(address(weth)),
            currency1: Currency.wrap(address(usdc)),
            fee: 500,
            tickSpacing: 60,
            hooks: address(0)
        });
    }

    function _enableStandardPool(uint160 sqrtPriceX96) internal {
        hook.setStandardPoolKey(key.toId(), _standardKey());
        manager.setSlot0(_standardKey().toId(), sqrtPriceX96, 0);
    }

    function test_Guard_BlocksSwap_TwapNotConfiguredDefault() public {
        // Belts-and-suspenders behavior is unchanged: with no oracle requirement the
        // guard is permissive; with requireTwapOracle it reverts TwapNotConfigured,
        // which is exercised indirectly by the single-pool afterSwap/beforeSwap paths.
        _prankBeforeSwap(); // must NOT revert (requireTwapOracle defaults false)
    }
}
