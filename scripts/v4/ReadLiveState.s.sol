// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {PoolManager} from "@uniswap/v4-core/src/PoolManager.sol";
import {PoolId as RealPoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey as RealPoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency as RealCurrency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolKey} from "../../src/v4/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "../../src/v4/types/PoolId.sol";
import {Currency} from "../../src/v4/types/Currency.sol";
import {EswapMarginHook} from "../../src/v4/EswapMarginHook.sol";
import {EswapLiquidationKeeper} from "../../src/v4/EswapLiquidationKeeper.sol";

/// @notice Read-only live-state dump for the Unichain mainnet deployment.
///         Env: V4_HOOK_ADDRESS, V4_KEEPER_ADDRESS, TINY_TRADER, SOLVER_ADDRESS.
contract ReadLiveState is Script {
    using PoolIdLibrary for PoolKey;

    address constant NATIVE = address(0);
    address constant USDC = 0x078D782b760474a361dDA0AF3839290b0EF57AD6;
    address constant PM = 0x1F98400000000000000000000000000000000004;

    function run() external {
        address hookAddr = vm.envAddress("V4_HOOK_ADDRESS");
        address keeperAddr = vm.envAddress("V4_KEEPER_ADDRESS");
        address tiny = vm.envOr("TINY_TRADER", address(0));
        address solver = vm.envOr("V4_SOLVER_ADDRESS", address(0));

        EswapMarginHook hook = EswapMarginHook(payable(hookAddr));

        PoolKey memory nativeKey = PoolKey({
            currency0: Currency.wrap(NATIVE),
            currency1: Currency.wrap(USDC),
            fee: 3000,
            tickSpacing: 60,
            hooks: hookAddr
        });
        PoolId nativeId = nativeKey.toId();

        console2.log("--- hook scalars ---");
        console2.log("router", vm.toString(address(hook.router())));
        console2.log("reserveFactor", hook.reserveFactor());
        console2.log("maxPriceSwingBps", uint256(hook.maxPriceSwingBps()));
        console2.log("defaultMaxLeverage", uint256(hook.defaultMaxLeverage()));
        console2.log("requireTwapOracle", hook.requireTwapOracle());
        console2.log("minCollateralUsd", hook.minCollateralUsd());
        console2.log("tokenDecimals WETH", uint256(hook.tokenDecimals(0x4200000000000000000000000000000000000006)));
        console2.log("tokenDecimals USDC", uint256(hook.tokenDecimals(USDC)));
        console2.log("bandConsumptionTriggerBps", hook.bandConsumptionTriggerBps());
        console2.log("insuranceWithdrawalCapBps", hook.insuranceWithdrawalCapBps());
        console2.log("maxSingleOIBps", hook.maxSingleOIBps());
        console2.log("maxTotalOIBps", hook.maxTotalOIBps());
        console2.log("oiCapTvlFloorUsd", hook.oiCapTvlFloorUsd());
        console2.log("totalOpenInterestUSD", hook.totalOpenInterestUSD());
        console2.log("totalCollateralUSDRunning", hook.totalCollateralUSDRunning());
        console2.log("totalBorrowedByToken(USDC)", hook.totalBorrowedByToken(Currency.wrap(USDC)));
        console2.log("totalCollateral(USDC)", hook.totalCollateral(Currency.wrap(USDC)));
        console2.log("insuranceFund(USDC)", hook.insuranceFund(Currency.wrap(USDC)));
        console2.log("protocolFees(USDC)", hook.protocolFees(Currency.wrap(USDC)));

        console2.log("--- pool keys ---");
        (Currency c0, Currency c1, uint24 fee, int24 ts, address hooks) = hook.standardPoolKeys(nativeId);
        console2.log("nativeId std c0", vm.toString(Currency.unwrap(c0)));
        console2.log("nativeId std c1", vm.toString(Currency.unwrap(c1)));
        console2.log("nativeId std fee", fee);
        console2.log("nativeId std ts", ts);
        console2.log("nativeId std hooks", vm.toString(hooks));
        console2.log("nativeId base:", vm.toString(Currency.unwrap(hook.baseCurrency(nativeId))));
        console2.log("nativeId authorized:", hook.isAuthorizedPool(nativeId));

        // Old USDC/WETH accounting id (pre-repurpose) — check for strays.
        PoolKey memory oldKey = PoolKey({
            currency0: Currency.wrap(USDC),
            currency1: Currency.wrap(0x4200000000000000000000000000000000000006),
            fee: 3000,
            tickSpacing: 60,
            hooks: hookAddr
        });
        PoolId oldId = oldKey.toId();
        console2.log("oldId base:", vm.toString(Currency.unwrap(hook.baseCurrency(oldId))));
        console2.log("oldId authorized:", hook.isAuthorizedPool(oldId));

        address[2] memory traders;
        uint256 n = 0;
        if (tiny != address(0)) traders[n++] = tiny;
        if (solver != address(0)) traders[n++] = solver;

        console2.log("--- positions ---");
        for (uint256 i = 0; i < n; i++) {
            _dump(hook, nativeId, traders[i], "native");
            _dump(hook, oldId, traders[i], "old");
        }

        // Keeper watch list (source of truth for who has positions)
        EswapLiquidationKeeper keeper = EswapLiquidationKeeper(keeperAddr);
        uint256 wl = keeper.watchesLength();
        console2.log("keeper.watchesLength", wl);
        for (uint256 i = 0; i < wl; i++) {
            (PoolKey memory realKey, address trader) = keeper.watches(i);
            PoolKey memory k = PoolKey({
                currency0: realKey.currency0,
                currency1: realKey.currency1,
                fee: realKey.fee,
                tickSpacing: realKey.tickSpacing,
                hooks: realKey.hooks
            });
            _dump(hook, k.toId(), trader, "watch");
        }

        console2.log("--- pool slots ---");
        _dumpSlot(RealPoolId.wrap(PoolId.unwrap(nativeId)), "old hook pool");
        _dumpSlot(_deepId(), "deep 500/10 pool");
    }

    function _deepId() internal pure returns (RealPoolId) {
        return RealPoolId.wrap(keccak256(
            abi.encode(address(0), USDC, uint24(500), int24(10), address(0))
        ));
    }

    function _dump(EswapMarginHook hook, PoolId poolId, address trader, string memory tag) internal view {
        (, uint256 collateral, uint256 borrowed, uint8 lev, bool isLong,,,,) = hook.positions(poolId, trader);
        if (collateral == 0 && borrowed == 0) {
            console2.log("no-pos", tag, vm.toString(trader));
            return;
        }
        console2.log("POS", tag, vm.toString(trader));
        console2.log("  pool", vm.toString(bytes32(PoolId.unwrap(poolId))));
        console2.log("  col", collateral);
        console2.log("  bor", borrowed);
        console2.log("  lev", uint256(lev));
        console2.log("  long", isLong);
    }

    function _dumpSlot(RealPoolId id, string memory label) internal view {
        (uint160 sqrtP, int24 tick,,) = StateLibrary.getSlot0(PoolManager(PM), id);
        console2.log(label);
        console2.log("  sqrt", uint256(sqrtP));
        console2.log("  tick", int256(tick));
    }
}