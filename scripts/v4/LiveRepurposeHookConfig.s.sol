// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {EswapMarginHook} from "../../src/v4/EswapMarginHook.sol";
import {PoolKey} from "../../src/v4/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "../../src/v4/types/PoolId.sol";
import {Currency} from "../../src/v4/types/Currency.sol";

/// @notice Live one-time config migration: re-point the deployed hook's accounting
///         pool for ETH/USDC to a NATIVE-ETH key and bind the standard fill key to
///         the DEEP Uniswap V4 ETH/USDC pool (fee 500, tickSpacing 10, no hooks,
///         PoolId 0x3258f413c7a88cda2fa8709a589d221a80f6574f63df5a5b6774485d8acc39d9,
///         ~$5.4M TVL). Owner-only setters.
///         Env: PRIVATE_KEY (owner), HOOK_ADDRESS, USDC_ADDRESS.
contract LiveRepurposeHookConfig is Script {
    using PoolIdLibrary for PoolKey;

    address constant NATIVE_ETH = address(0);
    address constant USDC = 0x078D782b760474a361dDA0AF3839290b0EF57AD6; // Unichain mainnet USDC
    bytes32 constant DEEP_POOL_ID =
        0x3258f413c7a88cda2fa8709a589d221a80f6574f63df5a5b6774485d8acc39d9;

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address hookAddr = vm.envAddress("V4_HOOK_ADDRESS");

        PoolKey memory nativeAccountKey = PoolKey({
            currency0: Currency.wrap(NATIVE_ETH),
            currency1: Currency.wrap(USDC),
            fee: 3000,
            tickSpacing: 60,
            hooks: hookAddr
        });
        PoolKey memory deepStdKey = PoolKey({
            currency0: Currency.wrap(NATIVE_ETH),
            currency1: Currency.wrap(USDC),
            fee: 500,
            tickSpacing: 10,
            hooks: address(0)
        });
        PoolId nativeId = nativeAccountKey.toId();
        require(PoolId.unwrap(nativeId) != DEEP_POOL_ID, "key collides with deep pool");

        EswapMarginHook hook = EswapMarginHook(payable(hookAddr));
        vm.startBroadcast(pk);
        hook.setAuthorizedPool(nativeId, true);
        hook.setStandardPoolKey(nativeId, deepStdKey);
        hook.setBaseCurrency(nativeId, Currency.wrap(NATIVE_ETH));
        vm.stopBroadcast();

        console.log("native accounting poolId:", vm.toString(PoolId.unwrap(nativeId)));
        console.log("authorized:", hook.isAuthorizedPool(nativeId));
        (Currency c0, Currency c1, uint24 fee, int24 ts, address h) = hook.standardPoolKeys(nativeId);
        console.log("std c0:", vm.toString(Currency.unwrap(c0)));
        console.log("std c1:", vm.toString(Currency.unwrap(c1)));
        console.log("std fee:", fee);
        console.log("std tickSpacing:", ts);
        console.log("std hooks:", h);
        console.log("baseCurrency:", vm.toString(Currency.unwrap(hook.baseCurrency(nativeId))));
    }
}