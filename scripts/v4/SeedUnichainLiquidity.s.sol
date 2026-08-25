// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {PoolManager} from "@uniswap/v4-core/src/PoolManager.sol";
import {IPoolManager as RealIPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey as RealPoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency as RealCurrency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolModifyLiquidityTest} from "@uniswap/v4-core/src/test/PoolModifyLiquidityTest.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
// Mirrored local types — used by the EswapMarginHook ABI surface.
import {Currency} from "../../src/v4/types/Currency.sol";
import {EswapMarginHook} from "../../src/v4/EswapMarginHook.sol";
import {PriceFeed} from "../../src/v4/PriceFeed.sol";

/// @notice Post-deploy bootstrap: initialize the standard unwind pools, add
///         liquidity to the hook + standard pools, and seed the insurance fund.
///         Run ONLY after DeployUnichain has broadcast, using the addresses that
///         DeployUnichain actually deployed.
///
///         Requires the deployer EOA to hold the tokens to be deployed.
///         Configured via env:
///           HOOK_ADDRESS          (the LIVE hook address from DeployUnichain)
///           PRICEFEED_ADDRESS     (the LIVE pricefeed address from DeployUnichain)
///           SEED_LIQUIDITY_DELTA  (int128 liquidity per pool, default 1e21)
///           SEED_TICK_SPREAD      (half-width around current tick, default 600)
///           INSURANCE_WETH/USDC/WBTC (raw amounts, default 0)
///           SEED_PRICE_BOUNDS     (optional "min,max" per token, e.g. "0,5e8")
contract SeedUnichainLiquidity is Script {
    address constant WETH = 0x4200000000000000000000000000000000000006;
    address constant USDC = 0x078D782b760474a361dDA0AF3839290b0EF57AD6;
    address constant WBTC = 0x927B51f251480a681271180DA4de28D44EC4AfB8;
    address constant UNICHAIN_PM = 0x1F98400000000000000000000000000000000004;

    // sqrtPriceX96 values DeployUnichain initialized the hook pools at.
    uint160 constant USDC_WETH_SQRT = 1811797413033512382167202542911488; // tick 200760 (~$1912/WETH)
    uint160 constant WBTC_USDC_SQRT = 1939473713542495427389005234176; // tick 63960

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);

        // Post-redeploy the hook/pricefeed live on a fresh address (new pool ids),
        // so they MUST come from env rather than the previous broadcast.
        address hookAddr = vm.envAddress("HOOK_ADDRESS");
        address priceFeedAddr = vm.envAddress("PRICEFEED_ADDRESS");
        require(hookAddr != address(0) && priceFeedAddr != address(0), "HOOK_ADDRESS/PRICEFEED_ADDRESS required");

        uint256 liquidityDeltaRaw = vm.envOr("SEED_LIQUIDITY_DELTA", uint256(1e21));
        // Standard pools use their own delta (defaults to the hook-pool delta).
        // The canonical fee-500 pools may already exist but empty on some chains;
        // a small delta here makes close/liquidation unwind swaps executable.
        uint256 standardDeltaRaw = vm.envOr("SEED_STANDARD_LIQUIDITY_DELTA", liquidityDeltaRaw);
        // WBTC pools are skipped (delta 0) unless explicitly enabled — the small
        // test balance holds no WBTC, and 0-delta pools are simply not seeded.
        uint256 wbtcDeltaRaw = vm.envOr("SEED_WBTC_LIQUIDITY_DELTA", uint256(0));
        bool seedStandard = vm.envOr("SEED_STANDARD_LIQUIDITY", false);
        int24 spread = int24(int256(vm.envOr("SEED_TICK_SPREAD", uint256(600))));
        // Center tick for the standard-pool seed. The canonical fee-500 pools may
        // exist at a legacy price (e.g. 192446 on Unichain), NOT the hook pool's
        // 200760 — seeding around the wrong center puts ALL liquidity out of range
        // and close/liquidation unwind swaps return 0. Default: seed around the
        // hook-pool center so a live read always has some range to hit.
        int24 standardTick = int24(int256(vm.envOr("SEED_STANDARD_TICK", uint256(200760))));
        uint256 insWeth = vm.envOr("INSURANCE_WETH", uint256(0));
        uint256 insUsdc = vm.envOr("INSURANCE_USDC", uint256(0));
        uint256 insWbtc = vm.envOr("INSURANCE_WBTC", uint256(0));

        require(insWeth < 1e30 && insUsdc < 1e30 && insWbtc < 1e30, "insurance amounts look wrong");
        require(liquidityDeltaRaw <= uint256(int256(type(int128).max)), "delta overflow");
        require(wbtcDeltaRaw <= uint256(int256(type(int128).max)), "wbtc delta overflow");
        require(standardDeltaRaw <= uint256(int256(type(int128).max)), "standard delta overflow");
        int128 liquidityDelta = int128(int256(liquidityDeltaRaw));
        int128 wbtcLiquidityDelta = int128(int256(wbtcDeltaRaw));
        int128 standardLiquidityDelta = int128(int256(standardDeltaRaw));

        vm.startBroadcast(pk);

        PoolManager pm = PoolManager(UNICHAIN_PM);
        PoolModifyLiquidityTest seeder = new PoolModifyLiquidityTest(RealIPoolManager(address(pm)));
        console.log("LiquiditySeeder deployed at:", address(seeder));

        // Approve the seeder to pull LP tokens (settle() transferFrom's the EOA).
        IERC20(USDC).approve(address(seeder), type(uint256).max);
        IERC20(WETH).approve(address(seeder), type(uint256).max);
        IERC20(WBTC).approve(address(seeder), type(uint256).max);

        // --- Standard pools: must exist (initialize) and carry liquidity so the
        // hook's close/liquidation unwind swaps (setStandardPoolKey) can execute.
        RealPoolKey memory usdcWethStandard = RealPoolKey({
            currency0: RealCurrency.wrap(USDC),
            currency1: RealCurrency.wrap(WETH),
            fee: 500,
            tickSpacing: 60,
            hooks: IHooks(address(0))
        });
        RealPoolKey memory wbtcUsdcStandard = RealPoolKey({
            currency0: RealCurrency.wrap(WBTC),
            currency1: RealCurrency.wrap(USDC),
            fee: 500,
            tickSpacing: 60,
            hooks: IHooks(address(0))
        });
        if (address(pm).code.length > 0) {
            _initIfNeeded(pm, usdcWethStandard, USDC_WETH_SQRT);
            _initIfNeeded(pm, wbtcUsdcStandard, WBTC_USDC_SQRT);
        }

        // --- Hook pools (fee 3000, the positions' execution venue) ---
        RealPoolKey memory usdcWethHook = RealPoolKey({
            currency0: RealCurrency.wrap(USDC),
            currency1: RealCurrency.wrap(WETH),
            fee: 3000,
            tickSpacing: 60,
            hooks: IHooks(hookAddr)
        });
        RealPoolKey memory wbtcUsdcHook = RealPoolKey({
            currency0: RealCurrency.wrap(WBTC),
            currency1: RealCurrency.wrap(USDC),
            fee: 3000,
            tickSpacing: 60,
            hooks: IHooks(hookAddr)
        });

        // Add liquidity around each pool's current price. Standard pools are
        // skipped by default: on networks with existing canonical liquidity the
        // fee-500 standard pools are already deep, so only the (thin, empty) hook
        // pools need seeding. Set SEED_STANDARD_LIQUIDITY=true to seed them too.
        _addLiquidity(seeder, usdcWethHook, 200760, spread, liquidityDelta);
        if (seedStandard) {
            _addLiquidity(seeder, usdcWethStandard, standardTick, spread, standardLiquidityDelta);
        }
        if (wbtcLiquidityDelta != 0) {
            _addLiquidity(seeder, wbtcUsdcHook, 63960, spread, wbtcLiquidityDelta);
            if (seedStandard) {
                _addLiquidity(seeder, wbtcUsdcStandard, 63960, spread, wbtcLiquidityDelta);
            }
        }

        // --- Insurance fund (pulls tokens from deployer via safeTransferFrom) ---
        EswapMarginHook hook = EswapMarginHook(hookAddr);
        if (insWeth > 0) {
            IERC20(WETH).approve(hookAddr, type(uint256).max);
            hook.seedInsuranceFund(Currency.wrap(WETH), insWeth);
        }
        if (insUsdc > 0) {
            IERC20(USDC).approve(hookAddr, type(uint256).max);
            hook.seedInsuranceFund(Currency.wrap(USDC), insUsdc);
        }
        if (insWbtc > 0) {
            IERC20(WBTC).approve(hookAddr, type(uint256).max);
            hook.seedInsuranceFund(Currency.wrap(WBTC), insWbtc);
        }

        // --- Optional answer circuit-breaker bounds on the PriceFeed ---
        _setBounds(priceFeedAddr, WETH);
        _setBounds(priceFeedAddr, USDC);
        _setBounds(priceFeedAddr, WBTC);

        vm.stopBroadcast();

        console.log("=== Seed Summary ===");
        console.log(string.concat("Seeder:       ", vm.toString(address(seeder))));
        console.log(string.concat("liquidityDelta: ", vm.toString(uint256(int256(liquidityDelta)))));
        console.log(string.concat("tick spread:  ", vm.toString(uint256(int256(spread)))));
        console.log(string.concat("insurance WETH: ", vm.toString(insWeth)));
        console.log(string.concat("insurance USDC: ", vm.toString(insUsdc)));
        console.log(string.concat("insurance WBTC: ", vm.toString(insWbtc)));
        console.log("Reminder: deployer must hold enough USDC/WETH/WBTC for the LP + insurance amounts.");
    }

    function _initIfNeeded(PoolManager pm, RealPoolKey memory key, uint160 sqrtPrice) internal {
        // Initialize only when the pool does not exist yet. v4 has no "exists"
        // getter, so read the pool's slot0 storage word directly: an unset slot0
        // (all zeroes) means the pool was never initialized.
        bytes32 poolId = keccak256(abi.encode(key.currency0, key.currency1, key.fee, key.tickSpacing, key.hooks));
        bytes32 stateSlot = keccak256(abi.encodePacked(poolId, bytes32(uint256(6)))); // PoolManager POOLS_SLOT = 6
        if (pm.extsload(stateSlot) == bytes32(0)) {
            pm.initialize(key, sqrtPrice);
        }
    }

    function _addLiquidity(
        PoolModifyLiquidityTest seeder,
        RealPoolKey memory key,
        int24 currentTick,
        int24 spread,
        int128 delta
    ) internal {
        int24 lower = (currentTick - spread) / 60 * 60;
        int24 upper = (currentTick + spread) / 60 * 60;
        RealIPoolManager.ModifyLiquidityParams memory params = RealIPoolManager.ModifyLiquidityParams({
            tickLower: lower,
            tickUpper: upper,
            liquidityDelta: delta,
            salt: 0
        });
        seeder.modifyLiquidity(key, params, "");
        console.log(string.concat("Seeded: ", vm.toString(uint256(uint160(address(key.hooks)))), " fee ", vm.toString(key.fee), " ticks ", vm.toString(int256(lower)), "/", vm.toString(int256(upper))));
    }

    function _setBounds(address feed, address token) internal {
        string memory bounds = vm.envOr(string.concat("BOUNDS_", _symbol(token)), string(""));
        if (bytes(bounds).length == 0) return;
        (string memory minS, string memory maxS) = _split(bounds);
        int256 min = vm.parseInt(minS);
        int256 max = vm.parseInt(maxS);
        PriceFeed(feed).setAnswerBounds(token, min, max);
        console.log(string.concat("Bounds set for ", _symbol(token), ": ", bounds));
    }

    function _symbol(address token) internal pure returns (string memory) {
        if (token == WETH) return "WETH";
        if (token == USDC) return "USDC";
        if (token == WBTC) return "WBTC";
        return "TOKEN";
    }

    function _split(string memory s) internal pure returns (string memory, string memory) {
        bytes memory b = bytes(s);
        for (uint256 i = 0; i < b.length; i++) {
            if (b[i] == 0x2c) {
                bytes memory a = new bytes(i);
                for (uint256 j = 0; j < i; j++) a[j] = b[j];
                bytes memory c = new bytes(b.length - i - 1);
                for (uint256 j = 0; j < c.length; j++) c[j] = b[i + 1 + j];
                return (string(a), string(c));
            }
        }
        revert("bounds must be \"min,max\"");
    }
}
