// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {PriceFeed} from "../../src/v4/PriceFeed.sol";

/// @title SetPlaceholderBounds
/// @notice Sets PLACEHOLDER answer bounds for WETH (the ETH price key on Base and
///         Unichain, where NATIVE_ETH_PRICE_KEY == WETH) and WBTC.
///
/// @dev The placeholders are deliberately NON-BINDING: min = 1 and max = int256.max,
///      so no real price is rejected. They only satisfy the presence check that
///      `requireBounds` enforces. Replace them with real per-feed bounds through
///      `PriceFeed.setAnswerBounds` before relying on the circuit breaker.
///      Bounds are compared in the feed's RAW answer units, so real values must
///      match each feed's decimals.
///
///      Run BEFORE `setRequireBounds(true)`, otherwise pricing reverts with
///      BoundsNotConfigured for any token that still has no bounds.
contract SetPlaceholderBounds is Script {
    int256 internal constant PLACEHOLDER_MIN = 1;
    int256 internal constant PLACEHOLDER_MAX = type(int256).max;

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        PriceFeed priceFeed = PriceFeed(vm.envAddress("PRICE_FEED_ADDRESS"));
        address weth = vm.envAddress("WETH_ADDRESS");
        address wbtc = vm.envAddress("WBTC_ADDRESS");

        vm.startBroadcast(pk);
        priceFeed.setAnswerBounds(weth, PLACEHOLDER_MIN, PLACEHOLDER_MAX);
        priceFeed.setAnswerBounds(wbtc, PLACEHOLDER_MIN, PLACEHOLDER_MAX);
        vm.stopBroadcast();
    }
}
