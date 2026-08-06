// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "../../src/v4/types/PoolKey.sol";
import {Currency} from "../../src/v4/types/Currency.sol";
import {PerpLedger} from "../../src/v4/EswapPerpLedger.sol";
import {PriceFeed} from "../../src/v4/PriceFeed.sol";

/**
 * @title DeployPerpLedger
 * @notice Deploys the synthetic 0%-interest perpetuals ledger on Unichain mainnet.
 *
 * @dev The ledger reads its spot trigger from the REAL V4 pool slot0 via
 *      `extsload` (the same storage slot the production PoolManager uses) and its
 *      settlement TWAP from a Chainlink-backed PriceFeed. Only the prices must be
 *      live: the ledger never needs the pool to route funds (pure ledger entries).
 */
contract DeployPerpLedger is Script {
    address constant WETH = 0x4200000000000000000000000000000000000006;
    address constant USDC = 0x078D782b760474a361dDA0AF3839290b0EF57AD6;
    address constant UNICHAIN_PM = 0x1F98400000000000000000000000000000000004;

    // Verified live on Unichain Mainnet (18-decimal Chainlink answers).
    address constant ETH_USD_FEED = 0xBcE70e194940a157f3A80566505a7E96f5238CCa;
    address constant USDC_USD_FEED = 0xbd1cD1518eFB92a92100da62D4C488c810dFd75b;

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");

        vm.startBroadcast(deployerPrivateKey);

        // PriceFeed: Chainlink settlement oracle (staleness + circuit breakers).
        PriceFeed priceFeed = new PriceFeed();
        priceFeed.setPriceFeed(WETH, ETH_USD_FEED, 18);
        priceFeed.setPriceFeed(USDC, USDC_USD_FEED, 18);

        IPoolManager pm = IPoolManager(UNICHAIN_PM);

        // WETH/USDC pool on Unichain (USDC sorts below WETH by address).
        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(USDC),
            currency1: Currency.wrap(WETH),
            fee: 3000,
            tickSpacing: 60,
            hooks: address(0) // ledger does not attach hook flags
        });

        PerpLedger ledger =
            new PerpLedger(address(USDC), address(priceFeed), address(pm), key, WETH);

        vm.stopBroadcast();

        console.log("=== PerpLedger Deployment Summary ===");
        console.log("Network: Unichain Mainnet (Chain ID 130)");
        console.log(string.concat("Ledger:    ", vm.toString(address(ledger))));
        console.log(string.concat("PriceFeed: ", vm.toString(address(priceFeed))));
        console.log("Margin token: USDC | Base token: WETH | Spot pool: WETH/USDC");
        console.log("");
        console.log("=== Next Steps ===");
        console.log("1. Set risk params on the ledger (as owner):");
        console.log("   ledger.setOICapUsd(<USD>); ledger.setMaxLeverage(5);");
        console.log("   ledger.setWhitelist(<trader>, true);");
        console.log("2. Fund the Takaful/counterparty pool (any address):");
        console.log("   ledger.depositInsurance(<USDC amount>);");
        console.log("3. Update .env and run: node javascript/update-dashboard.js");
        console.log(string.concat("   PERP_LEDGER_ADDRESS=", vm.toString(address(ledger))));
    }
}
