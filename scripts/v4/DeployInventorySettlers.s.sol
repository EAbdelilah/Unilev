// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {EswapRouter} from "../../src/v4/EswapRouter.sol";
import {EswapUniswapXSettlement} from "../../src/v4/EswapUniswapXSettlement.sol";
import {EswapOneInchFusionSettlement} from "../../src/v4/EswapOneInchFusionSettlement.sol";
import {IReactor} from "../../lib/uniswapx-interfaces/IReactor.sol";
import {IOrderMixin} from "../../lib/limit-order-protocol/IOrderMixin.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @dev Minimal admin surface shared by the two inventory settlers.
interface IEswapSettlementOps {
    function setOperator(address operator) external;
    function setPendingRecipient(address recipient) external;
}

/// @notice Deploys ONLY the two INVENTORY-based venue settlers (UniswapX and
///         1inch Fusion) against an ALREADY-LIVE EswapRouter. This is the
///         "router + CoW/generic settlers exist, inventory settlers missing"
///         path (Base mainnet). It deliberately does NOT redeploy CoW/generic
///         (use DeploySettlements.s.sol for those).
///
///         Both settlers fix the input/output token pair and a max-fill cap at
///         construction (immutable) and must hold inventory; they are
///         solver-whitelisted so the router authorizes their fills. Neither ever
///         represents an Eswap position: they are plain swap fill sources.
///
///         Required env:
///           PRIVATE_KEY                       deployer (== router owner, for whitelist)
///           V4_ROUTER_ADDRESS                 live EswapRouter on the target chain
///           UNISWAPX_REACTOR_ADDRESS          UniswapX reactor (domain binding)
///           UNISWAPX_SETTLEMENT_INPUT_TOKEN   token reactor pulls IN from swapper
///           UNISWAPX_SETTLEMENT_OUTPUT_TOKEN  token we deliver OUT to recipient
///           UNISWAPX_SETTLEMENT_MAX_FILL      per-fill cap (input-token decimals)
///           ONEINCH_FUSION_LOP_ADDRESS        canonical 1inch Limit Order Protocol
///           ONEINCH_FUSION_MAKER_ASSET        maker asset (we receive)
///           ONEINCH_FUSION_TAKER_ASSET        taker asset (we deliver), 6..18 dp
///           ONEINCH_FUSION_MAX_FILL           per-fill cap
///         Optional env:
///           SETTLEMENT_OPERATOR_ADDRESS       authorized filler (both settlers)
///           UNISWAPX_SETTLEMENT_RECIPIENT     default pending recipient
///
///         Run:
///           forge script scripts/v4/DeployInventorySettlers.s.sol:DeployInventorySettlers \
///             --rpc-url https://mainnet.base.org --via-ir --broadcast --slow
contract DeployInventorySettlers is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);

        address routerAddr = vm.envAddress("V4_ROUTER_ADDRESS");
        require(routerAddr.code.length > 0, "V4_ROUTER_ADDRESS has no code on this chain");
        EswapRouter router = EswapRouter(payable(routerAddr));
        require(router.owner() == deployer, "deployer must be router owner (whitelist)");

        console.log("=== Eswap Inventory Settlers Deploy ===");
        console.log("Deployer:", deployer);
        console.log("Router:  ", routerAddr);
        console.log("");

        vm.startBroadcast(pk);

        address operator = vm.envOr("SETTLEMENT_OPERATOR_ADDRESS", address(0));

        // --- UniswapX --------------------------------------------------------
        {
            address reactor = vm.envAddress("UNISWAPX_REACTOR_ADDRESS");
            address input = vm.envAddress("UNISWAPX_SETTLEMENT_INPUT_TOKEN");
            address output = vm.envAddress("UNISWAPX_SETTLEMENT_OUTPUT_TOKEN");
            uint256 maxFill = vm.envUint("UNISWAPX_SETTLEMENT_MAX_FILL");
            require(reactor.code.length > 0, "UNISWAPX_REACTOR_ADDRESS has no code");
            require(input.code.length > 0, "UNISWAPX input token has no code");
            require(output.code.length > 0, "UNISWAPX output token has no code");
            require(maxFill > 0, "maxFill must be > 0");

            EswapUniswapXSettlement ux =
                new EswapUniswapXSettlement(IReactor(reactor), IERC20(input), IERC20(output), maxFill);
            require(ux.operator() == deployer, "ux.operator != deployer");
            if (operator != address(0)) IEswapSettlementOps(address(ux)).setOperator(operator);
            address recipient = vm.envOr("UNISWAPX_SETTLEMENT_RECIPIENT", address(0));
            if (recipient != address(0)) IEswapSettlementOps(address(ux)).setPendingRecipient(recipient);
            if (!router.registeredSolvers(address(ux))) router.setSolverWhitelist(address(ux), true);

            console.log(string.concat("UniswapXSettlement: ", vm.toString(address(ux))));
            console.log(string.concat("  reactor:         ", vm.toString(address(ux.reactor()))));
            console.log(string.concat("  input/output:    ", vm.toString(address(ux.inputToken())), "/", vm.toString(address(ux.outputToken()))));
            console.log(string.concat("  maxFillAmount:   ", vm.toString(ux.maxFillAmount())));
            console.log(string.concat("  operator:        ", vm.toString(ux.operator())));
            console.log(string.concat("  whitelisted:     ", vm.toString(router.registeredSolvers(address(ux)))));
        }

        // --- 1inch Fusion ----------------------------------------------------
        {
            address lop = vm.envAddress("ONEINCH_FUSION_LOP_ADDRESS");
            address makerAsset = vm.envAddress("ONEINCH_FUSION_MAKER_ASSET");
            address takerAsset = vm.envAddress("ONEINCH_FUSION_TAKER_ASSET");
            uint256 maxFill = vm.envUint("ONEINCH_FUSION_MAX_FILL");
            require(lop.code.length > 0, "ONEINCH_FUSION_LOP_ADDRESS has no code");
            require(makerAsset.code.length > 0, "1inch maker asset has no code");
            require(takerAsset.code.length > 0, "1inch taker asset has no code");
            require(maxFill > 0, "maxFill must be > 0");

            EswapOneInchFusionSettlement fi =
                new EswapOneInchFusionSettlement(IOrderMixin(lop), IERC20(makerAsset), IERC20(takerAsset), maxFill);
            require(fi.operator() == deployer, "fi.operator != deployer");
            if (operator != address(0)) IEswapSettlementOps(address(fi)).setOperator(operator);
            if (!router.registeredSolvers(address(fi))) router.setSolverWhitelist(address(fi), true);

            console.log(string.concat("FusionSettlement:  ", vm.toString(address(fi))));
            console.log(string.concat("  lop:             ", vm.toString(address(fi.lop()))));
            console.log(string.concat("  maker/taker:     ", vm.toString(address(fi.makerAsset())), "/", vm.toString(address(fi.takerAsset()))));
            console.log(string.concat("  maxFillAmount:   ", vm.toString(fi.maxFillAmount())));
            console.log(string.concat("  operator:        ", vm.toString(fi.operator())));
            console.log(string.concat("  whitelisted:     ", vm.toString(router.registeredSolvers(address(fi)))));
        }

        vm.stopBroadcast();

        console.log("");
        console.log("=== Next Steps ===");
        console.log("Add to .env, then: node javascript/update-dashboard.js");
    }
}
