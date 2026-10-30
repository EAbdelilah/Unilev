// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {EswapRouter} from "../../src/v4/EswapRouter.sol";
import {EswapCoWSettlement} from "../../src/v4/EswapCoWSettlement.sol";
import {EswapUniswapXSettlement} from "../../src/v4/EswapUniswapXSettlement.sol";
import {EswapOneInchFusionSettlement} from "../../src/v4/EswapOneInchFusionSettlement.sol";
import {EswapSettlement} from "../../src/v4/EswapSettlement.sol";
import {IReactor} from "../../lib/uniswapx-interfaces/IReactor.sol";
import {IOrderMixin} from "../../lib/limit-order-protocol/IOrderMixin.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @dev Minimal admin surface shared by the two inventory settlers.
interface IEswapSettlementOps {
    function setOperator(address operator) external;
    function setPendingRecipient(address recipient) external;
}

/// @notice Deploys ONLY the venue settlement contracts against an ALREADY-LIVE
///         EswapRouter. This is the "router exists, settlers are missing" path
///         (e.g. Base mainnet, where the hook/router/pricefeed are live but no
///         venue settler has been deployed).
///
///         CoW is the rail that needs no router configuration at all:
///         {EswapCoWSettlement.fillOrder} forwards to
///         {EswapRouter.swapMultiPoolForSolverFunded} as the order's designated
///         solver (`params.solver`). The solver — not the settler — is what the
///         router authorizes (governance whitelist, the trader's signed
///         LendingIntent, or a pre-funded `erc20BorrowEscrow` bond), so the
///         settler itself is never whitelisted. See EswapRouter.sol:876-880.
///
///         UniswapX and 1inch Fusion are inventory-based fill sources: the
///         protocol requires the filler to deliver output tokens to the order
///         recipient, which cannot represent an Eswap position, so neither ever
///         calls the router. They are deployed only when their FULL address set
///         is supplied, mirroring DeployBase.s.sol.
///
///         Required env:
///           PRIVATE_KEY             deployer (must match router owner for any ops)
///           V4_ROUTER_ADDRESS       live EswapRouter on the target chain
///           COW_GPv2_SETTLEMENT     canonical CoW GPv2Settlement (domain binding)
///         Optional env (UniswapX):
///           UNISWAPX_REACTOR_ADDRESS, UNISWAPX_SETTLEMENT_INPUT_TOKEN,
///           UNISWAPX_SETTLEMENT_OUTPUT_TOKEN, UNISWAPX_SETTLEMENT_MAX_FILL,
///           UNISWAPX_SETTLEMENT_RECIPIENT
///         Optional env (1inch Fusion):
///           ONEINCH_FUSION_LOP_ADDRESS, ONEINCH_FUSION_MAKER_ASSET,
///           ONEINCH_FUSION_TAKER_ASSET, ONEINCH_FUSION_MAX_FILL,
///           ONEINCH_FUSION_MAX_TAKING (optional; defaults to MAX_FILL)
///         Optional env (both inventory settlers):
///           SETTLEMENT_OPERATOR_ADDRESS
///
///         Run:
///           FOUNDRY_PROFILE=deploy forge script scripts/v4/DeploySettlements.s.sol:DeploySettlements \
///             --rpc-url https://mainnet.base.org --broadcast --slow
contract DeploySettlements is Script {
    // Canonical CoW GPv2Settlement, present on Base (and most chains) at this
    // CREATE2 address. Order signatures bind to this as the EIP-712
    // verifyingContract; the settler never depends on it at fill time.
    address constant COW_GPv2_SETTLEMENT = 0x9008D19f58AAbD9eD0D60971565AA8510560ab41;

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);

        address routerAddr = vm.envAddress("V4_ROUTER_ADDRESS");
        require(routerAddr.code.length > 0, "V4_ROUTER_ADDRESS has no code on this chain");
        EswapRouter router = EswapRouter(payable(routerAddr));

        address gpv2 = vm.envOr("COW_GPv2_SETTLEMENT", COW_GPv2_SETTLEMENT);
        require(gpv2.code.length > 0, "CoW GPv2Settlement has no code on this chain");

        console.log("=== Eswap Settlement Deploy ===");
        console.log("Deployer:", deployer);
        console.log("Router:  ", routerAddr);
        console.log("GPv2:    ", gpv2);
        console.log("");

        vm.startBroadcast(pk);

        // --- CoW (required) --------------------------------------------------
        EswapCoWSettlement cow = new EswapCoWSettlement(router, gpv2);
        require(address(cow.router()) == routerAddr, "cow.router mismatch");
        require(cow.gpv2Settlement() == gpv2, "cow.gpv2 mismatch");
        console.log(string.concat("CoWSettlement:    ", vm.toString(address(cow))));
        console.log(string.concat("  router:         ", vm.toString(address(cow.router()))));
        console.log(string.concat("  gpv2Settlement: ", vm.toString(cow.gpv2Settlement())));
        console.log(string.concat("  leverageCommitment(5): ", vm.toString(cow.leverageCommitment(5))));

        // --- ERC-7683 generic destination settler (required) ----------------
        // Destination settler for any relayer that bridges the notional in and
        // then calls fill(orderId, originData, fillerData) -- i.e. Across and any
        // future ERC-7683 relayer. fill() sets SwapParams.solver = address(this)
        // before swapMultiPoolForSolverFunded, so the router's solver whitelist
        // gates it: WITHOUT the setSolverWhitelist below every generic fill
        // reverts "Solver not authorized". Whitelisting the settler here IS the
        // venue-registration step.
        EswapSettlement generic = new EswapSettlement(router);
        require(address(generic.router()) == routerAddr, "generic.router mismatch");
        if (!router.registeredSolvers(address(generic))) {
            router.setSolverWhitelist(address(generic), true);
        }
        console.log(string.concat("EswapSettlement:  ", vm.toString(address(generic))));
        console.log(string.concat("  whitelisted:    ", vm.toString(router.registeredSolvers(address(generic)))));

        // --- UniswapX (opt-in) ----------------------------------------------
        {
            address reactor = vm.envOr("UNISWAPX_REACTOR_ADDRESS", address(0));
            address input = vm.envOr("UNISWAPX_SETTLEMENT_INPUT_TOKEN", address(0));
            address output = vm.envOr("UNISWAPX_SETTLEMENT_OUTPUT_TOKEN", address(0));
            uint256 maxFill = vm.envOr("UNISWAPX_SETTLEMENT_MAX_FILL", uint256(0));
            if (reactor == address(0) || input == address(0) || output == address(0) || maxFill == 0) {
                console.log("  [PENDING] UniswapX settlement (reactor/input/output/maxFill incomplete)");
            } else {
                EswapUniswapXSettlement ux =
                    new EswapUniswapXSettlement(IReactor(reactor), IERC20(input), IERC20(output), maxFill);
                _setOperator(address(ux));
                address recipient = vm.envOr("UNISWAPX_SETTLEMENT_RECIPIENT", address(0));
                if (recipient != address(0)) {
                    IEswapSettlementOps(address(ux)).setPendingRecipient(recipient);
                }
                console.log(string.concat("UniswapXSettlement:", vm.toString(address(ux))));
            }
        }

        // --- 1inch Fusion (opt-in) ------------------------------------------
        {
            address lop = vm.envOr("ONEINCH_FUSION_LOP_ADDRESS", address(0));
            address makerAsset = vm.envOr("ONEINCH_FUSION_MAKER_ASSET", address(0));
            address takerAsset = vm.envOr("ONEINCH_FUSION_TAKER_ASSET", address(0));
            // Two independent caps: USDC-side (making) and WETH-side (taking).
            // Reusing one scalar truncated institutional $100k orders because a
            // 6-decimal USDC cap is ~1e12x a wei-denominated WETH cap.
            uint256 maxMaking = vm.envOr("ONEINCH_FUSION_MAX_FILL", uint256(0));
            uint256 maxTaking = vm.envOr("ONEINCH_FUSION_MAX_TAKING", maxMaking);
            if (lop == address(0) || makerAsset == address(0) || takerAsset == address(0) || maxMaking == 0) {
                console.log("  [PENDING] 1inch Fusion settlement (lop/maker/taker/maxMaking incomplete)");
            } else {
                EswapOneInchFusionSettlement fi = new EswapOneInchFusionSettlement(
                    IOrderMixin(lop), IERC20(makerAsset), IERC20(takerAsset), maxMaking, maxTaking
                );
                _setOperator(address(fi));
                console.log(string.concat("FusionSettlement: ", vm.toString(address(fi))));
            }
        }

        vm.stopBroadcast();

        console.log("");
        console.log("=== Next Steps ===");
        console.log("1. Add to .env (then: node javascript/update-dashboard.js):");
        console.log(string.concat("   V4_COW_SETTLEMENT_ADDRESS=", vm.toString(address(cow))));
        console.log(string.concat("   V4_SETTLEMENT_ADDRESS=", vm.toString(address(generic))));
        console.log("2. A solver fills via EswapCoWSettlement.fillOrder with its own");
        console.log("   erc20BorrowEscrow bond (no router whitelist entry required).");
        console.log("3. ERC-7683 relayers target EswapSettlement.fill (already solver-whitelisted).");
        console.log("4. CoW appData: register appDataJson(leverage) via PUT /app_data/{hash}, then");
        console.log("   set order.appData = leverageCommitment(leverage).");
    }

    function _setOperator(address settler) internal {
        address operator = vm.envOr("SETTLEMENT_OPERATOR_ADDRESS", address(0));
        if (operator != address(0)) {
            IEswapSettlementOps(settler).setOperator(operator);
        }
    }
}
