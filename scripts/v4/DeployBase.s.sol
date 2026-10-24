// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {PoolManager} from "@uniswap/v4-core/src/PoolManager.sol";
import {IPoolManager as RealIPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {AggregatorV3Interface} from "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";
import {PoolKey as RealPoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency as RealCurrency} from "@uniswap/v4-core/src/types/Currency.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {PoolId as RealPoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
// Mirrored local types — used by the EswapMarginHook/Router ABI surface.
import {PoolKey} from "../../src/v4/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "../../src/v4/types/PoolId.sol";
import {Currency} from "../../src/v4/types/Currency.sol";
import {IPoolManager} from "../../src/v4/interfaces/IPoolManager.sol";
import {TickMath} from "../../src/v4/libraries/TickMath.sol";
import {EswapMarginHook, IPriceFeed} from "../../src/v4/EswapMarginHook.sol";
import {EswapMarginHookLogic} from "../../src/v4/EswapMarginHookLogic.sol";
import {EswapMarginHookLogic2} from "../../src/v4/EswapMarginHookLogic2.sol";
import {IPriceFeedLogic} from "../../src/v4/EswapMarginHookLogicStorage.sol";
import {EswapMarginLib} from "../../src/v4/EswapMarginLib.sol";
import {EswapRouter} from "../../src/v4/EswapRouter.sol";
import {EswapRouterExt} from "../../src/v4/EswapRouterExt.sol";
import {EswapLiquidationKeeper} from "../../src/v4/EswapLiquidationKeeper.sol";
import {EswapUniswapXSettlement} from "../../src/v4/EswapUniswapXSettlement.sol";
import {EswapOneInchFusionSettlement} from "../../src/v4/EswapOneInchFusionSettlement.sol";
import {IReactor} from "../../lib/uniswapx-interfaces/IReactor.sol";
import {IOrderMixin} from "../../lib/limit-order-protocol/IOrderMixin.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @dev Minimal admin surface shared by both venue settlers.
interface EswapSettlementOps {
    function setOperator(address operator) external;

    function setPendingRecipient(address recipient) external;
}
import {PriceFeed} from "../../src/v4/PriceFeed.sol";
import {UsdcTwapFeed} from "../../src/v4/UsdcTwapFeed.sol";
import {HookFlags} from "../../src/v4/libraries/HookFlags.sol";

/// @notice Base mainnet (chain 8453) deployment of the Eswap margin stack.
///
///         Topology (the WETH/USDC variant of {DeployUnichain}):
///           - hook (accounting) pool : WETH / USDC, fee-3000 / tick-60
///           - standard (physical) pool: WETH / USDC, fee-500  / tick-10  (deep, hookless)
///
///         Why WETH (0x4200..06) and not native ETH: the aggregator rail is
///         ERC20<->ERC20 only and rejects native legs (AggregatorNativeLegUnsupported),
///         so a WETH-quoted pool is the only topology on which the demand-side
///         (Enso/Odos/1inch/...) path can ever settle. Both pools are already
///         initialized on Base; base currency = WETH and the Chainlink ETH feed is
///         registered under the SAME key the hook remaps native to
///         (PriceFeed.NATIVE_ETH_PRICE_KEY == WETH), so the oracle wiring is
///         identical to the native variant.
///
///         The hook is CREATE2-mined (permission bits) exactly as on Unichain. The
///         two logic contracts are deployed with FIXED CREATE2 salts so their
///         addresses are derivable before any broadcast — which is what lets
///         {mineHookSalt} compute the hook's initcodeHash in a single pass.
contract DeployBase is Script {
    using PoolIdLibrary for PoolKey;
    using LPFeeLibrary for uint24;

    // --- Base (8453) well-known addresses ---
    address constant WETH = 0x4200000000000000000000000000000000000006;
    address constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address constant BASE_PM = 0x498581fF718922c3f8e6A244956aF099B2652b2b;
    // PriceFeed.NATIVE_ETH_PRICE_KEY: the key under which the ETH/USD feed is
    // stored/looked-up. The contract remaps address(0) -> this address, so
    // setPriceFeed MUST use this key. It also equals our pool's currency0.
    address constant NATIVE_ETH_PRICE_KEY = 0x4200000000000000000000000000000000000006;

    // Verified live on Base via latestRoundData()/decimals()/description().
    // Canonical USD feeds are 8-decimal here (unlike Unichain's 18-decimal SVR feeds).
    address constant ETH_USD_FEED = 0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70;
    address constant USDC_USD_FEED = 0x7e860098F58bBFC8648a4311b374B1D669a2bc6B;
    // Chainlink L2 Sequencer Uptime Feed (Base). Present on Base, so the
    // sequencer guard is ENABLED (it stays disabled on Unichain, which has none).
    address constant L2_SEQUENCER_UPTIME_FEED = 0xBCF85224fc0756B9Fa45aA7892530B47e10b6433;

    // Deepest Base USDC/WETH Uniswap V3 pool (0.05% tier). Used by the USDC TWAP
    // adapter to derive a continuously-fresh USDC/USD price (see deployPriceFeed).
    address constant USDC_WETH_V3_POOL = 0xd0b53D9277642d899DF5C87A3966A349A798F224;
    uint32 constant TWAP_WINDOW = 1800;

    // Foundry routes broadcasted CREATE2 through this deterministic deployer
    // (present on Base at this canonical address). All CREATE2 arithmetic below
    // MUST use this factory as the deployer, NOT the EOA.
    address constant CREATE2_DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;

    /// @dev Gas forwarded to the deterministic deployer for the hook. The real
    ///      hook CREATE2 costs ~5.38M (dominated by the 200-gas/byte code
    ///      deposit); 6M leaves ~11% headroom. Kept deliberately tight so the
    ///      outer tx's gas reservation (and thus the deployer's up-front ETH
    ///      requirement) is not inflated to a 16M stipend.
    uint256 constant HOOK_DEPLOY_GAS = 6_000_000;
    /// @dev Floor for the number of EswapMarginLib references the hook creation
    ///      code must contain once linked by Foundry.
    uint256 constant LIB_REFS = 2;

    /// @dev Bytes of headroom the hook must keep under EIP-170 (24,576).
    uint256 constant HOOK_RUNTIME_HEADROOM = 900;

    /// @dev Fixed CREATE2 salts for the two logic contracts, so their addresses
    ///      are derivable before broadcast (the hook's initcode embeds both).
    bytes32 constant LOGIC2_SALT = keccak256("eswap.logic2.base.v1");
    bytes32 constant LOGIC1_SALT = keccak256("eswap.logic1.base.v1");

    // --- Stage 1: PriceFeed -------------------------------------------------
    // Deployed SEPARATELY (its address is baked into the hook's initcode, so it
    // must be known before the hook salt can be mined). Then set
    // PRICE_FEED_ADDRESS in .env before mining/running.
    function deployPriceFeed() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(deployerPrivateKey);

        PriceFeed priceFeed = new PriceFeed();
        console.log("PriceFeed deployed at:", address(priceFeed));

        // Register ETH under the NATIVE_ETH_PRICE_KEY (== WETH), NOT address(0).
        priceFeed.setPriceFeed(NATIVE_ETH_PRICE_KEY, ETH_USD_FEED, AggregatorV3Interface(ETH_USD_FEED).decimals());
        console.log(string.concat("Configured ETH feed: ", vm.toString(ETH_USD_FEED)));
        // Base's native Chainlink USDC/USD is a *Reference* feed with a ~24h
        // heartbeat, so it can never satisfy MAX_ORACLE_AGE (1h): getTwapPrice(USDC)
        // reverts StalePrice and every USDC-margined open stalls. Register a
        // genuinely fresh, independent USDC/USD source instead:
        //   USDC/USD = (V3 USDC/WETH TWAP) * (Chainlink ETH/USD)
        // The ETH/USD leg keeps a Chainlink anchor; the TWAP leg keeps it
        // independent of the V4 pool the hook circuit-breaks against.
        UsdcTwapFeed usdcTwap = new UsdcTwapFeed(USDC_WETH_V3_POOL, ETH_USD_FEED, TWAP_WINDOW, USDC, WETH);
        priceFeed.setPriceFeed(USDC, address(usdcTwap), 18);
        console.log(string.concat("Configured USDC TWAP adapter: ", vm.toString(address(usdcTwap))));
        priceFeed.setSequencerUptimeFeed(L2_SEQUENCER_UPTIME_FEED);
        console.log(string.concat("Configured sequencer feed: ", vm.toString(L2_SEQUENCER_UPTIME_FEED)));

        vm.stopBroadcast();
        console.log(string.concat("V4_PRICEFEED_ADDRESS=", vm.toString(address(priceFeed))));
    }

    /// @dev Mines the hook's CREATE2 salt with a frame of its own (the ~2**-19
    ///      search burns millions of gas and cannot be funded inside {run}).
    ///      Requires PRICE_FEED_ADDRESS. Logic addresses are DERIVED from the
    ///      fixed salts, so no HOOK_LOGIC env is needed.
    function mineHookSalt() external {
        address owner = vm.addr(vm.envUint("PRIVATE_KEY"));
        address priceFeedAddr = vm.envAddress("PRICE_FEED_ADDRESS");

        address logic2 = _logic2Address(priceFeedAddr);
        address logic1 = _logic1Address(priceFeedAddr, logic2);
        bytes memory linkedCreation = type(EswapMarginHook).creationCode;
        bytes memory initCode = abi.encodePacked(
            linkedCreation, abi.encode(address(BASE_PM), priceFeedAddr, logic1, logic2, owner)
        );
        bytes32 initCodeHash = keccak256(initCode);
        console.log("logic2 (derived):", logic2);
        console.log("logic1 (derived):", logic1);
        console.log("mining against initcodeHash:");
        console.logBytes32(initCodeHash);

        (uint160 highFlags, uint160 lowMask, uint160 allHookMask) = _flags();
        vm.pauseGasMetering();
        bytes32 salt;
        uint256 tries;
        while (tries < 50_000_000) {
            bytes32 candidate = bytes32(tries);
            address computed = create2Address(CREATE2_DEPLOYER, candidate, initCodeHash);
            if ((uint160(computed) & highFlags) == highFlags && (uint160(computed) & allHookMask) == lowMask) {
                salt = candidate;
                break;
            }
            tries++;
        }
        vm.resumeGasMetering();
        require(salt != bytes32(0), "salt search exhausted");

        console.log("HOOK_SALT=");
        console.logBytes32(salt);
        console.log("expected hook:", create2Address(CREATE2_DEPLOYER, salt, initCodeHash));
        console.log("tries        :", tries);
    }

    // --- Stage 3: full broadcast -------------------------------------------
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        address priceFeedAddr = vm.envAddress("PRICE_FEED_ADDRESS");
        require(priceFeedAddr.code.length > 0, "PRICE_FEED_ADDRESS has no code - run deployPriceFeed first");
        PriceFeed priceFeed = PriceFeed(priceFeedAddr);

        bytes32 salt = vm.envBytes32("HOOK_SALT");
        require(uint256(salt) != 0, "HOOK_SALT unset - run mineHookSalt first");

        vm.startBroadcast(deployerPrivateKey);

        PoolManager pm = PoolManager(BASE_PM);
        console.log("Using Base PoolManager at:", BASE_PM);

        // EswapMarginLib at its deterministic CREATE2 address (salt 0).
        bytes32 libSalt = bytes32(0);
        address libAddr = create2Address(CREATE2_DEPLOYER, libSalt, keccak256(type(EswapMarginLib).creationCode));
        if (libAddr.code.length == 0) {
            bytes memory libInit = type(EswapMarginLib).creationCode;
            address deployedLib;
            assembly {
                deployedLib := create2(0, add(libInit, 32), mload(libInit), libSalt)
            }
            require(deployedLib != address(0), "lib create2 failed");
        }
        require(libAddr.code.length > 0, "lib not deployed");
        console.log("EswapMarginLib deployed at:", libAddr);

        vm.pauseGasMetering();
        uint256 linkCount = _libraryReferenceCount(type(EswapMarginHook).creationCode);
        vm.resumeGasMetering();
        require(linkCount >= LIB_REFS, "hook lib auto-link mismatch");

        uint256 runtimeLen = _deployedBytecodeLength();
        require(24_576 - runtimeLen >= HOOK_RUNTIME_HEADROOM, "hook runtime too large for deployment budget");
        console.log("hook runtime bytes", runtimeLen);

        // Deploy the two delegatecall'd logic contracts as separate CREATE2s with
        // FIXED salts (addresses derive deterministically, matching mineHookSalt).
        (uint160 highFlags, uint160 lowMask, uint160 allHookMask) = _flags();

        address expectedLogic2 = _logic2Address(priceFeedAddr);
        EswapMarginHookLogic2 logic2;
        if (expectedLogic2.code.length == 0) {
            logic2 = new EswapMarginHookLogic2{salt: LOGIC2_SALT}(
                IPoolManager(address(pm)), IPriceFeedLogic(address(priceFeed))
            );
            require(address(logic2) == expectedLogic2, "logic2 address drift");
        } else {
            logic2 = EswapMarginHookLogic2(payable(expectedLogic2));
        }
        console.log("HookLogic2 deployed at:", address(logic2));

        address expectedLogic1 = _logic1Address(priceFeedAddr, expectedLogic2);
        EswapMarginHookLogic logic1;
        if (expectedLogic1.code.length == 0) {
            logic1 = new EswapMarginHookLogic{salt: LOGIC1_SALT}(
                IPoolManager(address(pm)), IPriceFeedLogic(address(priceFeed)), expectedLogic2
            );
        } else {
            logic1 = EswapMarginHookLogic(payable(expectedLogic1));
        }
        console.log("HookLogic deployed at:", address(logic1));

        require(address(logic1.manager()) == address(pm), "logic manager mismatch");
        require(address(logic2.manager()) == address(pm), "logic2 manager mismatch");

        bytes memory initCode = abi.encodePacked(
            type(EswapMarginHook).creationCode,
            abi.encode(address(pm), priceFeedAddr, address(logic1), address(logic2), deployer)
        );
        bytes32 initCodeHash = keccak256(initCode);

        address expectedHook = create2Address(CREATE2_DEPLOYER, salt, initCodeHash);
        require((uint160(expectedHook) & highFlags) == highFlags, "stale HOOK_SALT: missing high bits");
        require((uint160(expectedHook) & allHookMask) == lowMask, "stale HOOK_SALT: missing low bits");
        console.log("hook salt       :", uint256(salt));
        console.log("expected hook   :", expectedHook);

        bytes memory payload = abi.encodePacked(salt, initCode);
        uint256 gasBefore = gasleft();
        (bool ok, bytes memory ret) = CREATE2_DEPLOYER.call{gas: HOOK_DEPLOY_GAS}(payload);
        console.log("hook create2 gas spent (incl. unused stipend):", gasBefore - gasleft());
        if (!ok) {
            if (ret.length == 0) {
                console.log("create2 failed with empty returndata - out of gas");
            } else {
                console.log("create2 revert data:");
                console.logBytes(ret);
            }
        }
        require(ok && ret.length == 20, "hook create2 failed");
        address payable hookAddr = payable(address(uint160(bytes20(ret))));
        require(hookAddr.code.length > 0, "hook not deployed");
        EswapMarginHook hook = EswapMarginHook(hookAddr);
        console.log("Hook deployed at:", address(hook));

        EswapRouter router = new EswapRouter(IPoolManager(address(pm)));
        console.log("Router deployed at:", address(router));

        // RouterExt (JIT/trigger/best-route/atomic surfaces) and the LiquidationKeeper
        // are NOT on the CoW open/close path: the settlement only calls
        // swapMultiPoolForSolverFunded (no executor gate) and closePosition. Gate the
        // two deploys so a one-off trade can skip ~5.5M gas of dead code; both default
        // ON so a production deploy is unchanged and either can be added later.
        EswapRouterExt routerExt;
        if (vm.envOr("DEPLOY_ROUTER_EXT", true)) {
            routerExt = new EswapRouterExt(IPoolManager(address(pm)), address(router));
            console.log("RouterExt deployed at:", address(routerExt));
            router.setRouterExt(address(routerExt));
            router.setExecutorWhitelist(address(routerExt), true);
        } else {
            console.log("RouterExt SKIPPED (DEPLOY_ROUTER_EXT=false)");
        }

        EswapLiquidationKeeper keeper;
        if (vm.envOr("DEPLOY_KEEPER", true)) {
            keeper = new EswapLiquidationKeeper(address(hook), address(router));
            console.log("LiquidationKeeper deployed at:", address(keeper));
        } else {
            console.log("LiquidationKeeper SKIPPED (DEPLOY_KEEPER=false)");
        }

        address treasury = vm.envOr("TREASURY", deployer);
        hook.setConfig(EswapMarginHook.ConfigParams({
            treasury: treasury,
            router: address(router),
            reserveFactor: 5,
            maxPriceSwingBps: 800,
            defaultMaxLeverage: 5,
            requireTwapOracle: vm.envOr("REQUIRE_TWAP_ORACLE", false)
        }));
        hook.setTokenDecimals(WETH, 18);
        hook.setTokenDecimals(USDC, 6);

        hook.setRouterAndMinCollateralUsd(
            address(router),
            vm.envOr("MIN_COLLATERAL_USD", uint256(50000000000000000))
        );

        if (vm.envOr("LIQUIDATOR_INCENTIVE_BPS", uint256(0)) > 0) {
            hook.setLiquidatorIncentiveBps(vm.envOr("LIQUIDATOR_INCENTIVE_BPS", uint256(0)));
        }

        // --- Initialize the ONLY pool: WETH / USDC (currency0 = WETH) ---
        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(WETH),
            currency1: Currency.wrap(USDC),
            fee: 3000,
            tickSpacing: 60,
            hooks: address(hook)
        });

        // Seed the accounting rail at the live deep standard pool's sqrt price.
        RealPoolId stdRealId = RealPoolId.wrap(
            keccak256(abi.encode(WETH, USDC, uint24(500), int24(10), address(0)))
        );
        (uint160 stdSqrt,,,) = StateLibrary.getSlot0(pm, stdRealId);
        require(stdSqrt > 0, "deep standard pool uninitialized");
        uint160 sqrtPriceX96 = stdSqrt;
        pm.initialize(
            RealPoolKey({
                currency0: RealCurrency.wrap(WETH),
                currency1: RealCurrency.wrap(USDC),
                fee: 3000,
                tickSpacing: 60,
                hooks: IHooks(address(hook))
            }),
            sqrtPriceX96
        );

        PoolId poolId = key.toId();
        hook.setAuthorizedPool(poolId, true);
        // WETH is base currency: long WETH buys WETH (isLong = true) and borrows
        // USDC; short sells WETH for USDC.
        hook.setBaseCurrency(poolId, Currency.wrap(WETH));

        PoolKey memory standardKey = PoolKey({
            currency0: key.currency0,
            currency1: key.currency1,
            fee: 500,
            tickSpacing: 10,
            hooks: address(0)
        });
        hook.setStandardPoolKey(poolId, standardKey);

        hook.setOpenInterestCaps(
            vm.envOr("MAX_SINGLE_OI_BPS", uint256(200)),
            vm.envOr("MAX_TOTAL_OI_BPS", uint256(1500)),
            vm.envOr("OI_CAP_TVL_FLOOR_USD", uint256(100_000 ether))
        );
        hook.setBandConsumptionTriggerBps(vm.envOr("BAND_CONSUMPTION_TRIGGER_BPS", uint256(2500)));

        _whitelistAggregators(router, "Enso", "AGG_ENSO_PROXY_ADDRESS");
        _whitelistAggregators(router, "Odos", "AGG_ODOS_PROXY_ADDRESS");
        _whitelistAggregators(router, "Bungee", "AGG_BUNGEE_PROXY_ADDRESS");
        _whitelistAggregators(router, "Jumper", "AGG_JUMPER_PROXY_ADDRESS");
        _whitelistAggregators(router, "1inch", "AGG_ONEINCH_ROUTER_ADDRESS");

        _maybeDeployUniswapXSettlement(router);
        _maybeDeployOneInchFusionSettlement(router);

        vm.stopBroadcast();

        console.log("");
        console.log("=== Deployment Summary ===");
        console.log("Network: Base Mainnet (Chain ID 8453)");
        console.log("Pool:    WETH/USDC (fee 3000/60 hook, std 500/10)");
        console.log(string.concat("PoolManager: ", vm.toString(address(pm))));
        console.log(string.concat("MarginLib:   ", vm.toString(libAddr)));
        console.log(string.concat("Hook:        ", vm.toString(address(hook))));
        console.log(string.concat("Router:      ", vm.toString(address(router))));
        console.log(string.concat("RouterExt:   ", vm.toString(address(routerExt))));
        console.log(string.concat("Keeper:      ", vm.toString(address(keeper))));
        console.log(string.concat("PriceFeed:   ", vm.toString(address(priceFeed))));
        console.log(string.concat("Treasury:    ", vm.toString(treasury)));
        console.log("");
        console.log("=== Next Steps ===");
        console.log("1. Whitelist the solver on the new router: router.setSolverWhitelist(SOLVER, true)");
        console.log("2. Optionally set answer bounds: priceFeed.setAnswerBounds(WETH, <min>, <max>)");
        console.log("3. Update .env and run: node javascript/update-dashboard.js");
        console.log(string.concat("   V4_HOOK_ADDRESS=", vm.toString(address(hook))));
        console.log(string.concat("   V4_ROUTER_ADDRESS=", vm.toString(address(router))));
        console.log(string.concat("   V4_ROUTER_EXT_ADDRESS=", vm.toString(address(routerExt))));
        console.log(string.concat("   V4_KEEPER_ADDRESS=", vm.toString(address(keeper))));
        console.log(string.concat("   V4_PRICEFEED_ADDRESS=", vm.toString(address(priceFeed))));
    }

    // --- derivations --------------------------------------------------------
    function _flags()
        internal
        pure
        returns (uint160 highFlags, uint160 lowMask, uint160 allMask)
    {
        highFlags = HookFlags.AFTER_INITIALIZE_FLAG | HookFlags.BEFORE_SWAP_FLAG
            | HookFlags.BEFORE_SWAP_RETURNS_DELTA_FLAG | HookFlags.AFTER_SWAP_FLAG;
        lowMask = (uint160(1) << 12) | (uint160(1) << 7) | (uint160(1) << 6) | (uint160(1) << 3);
        allMask = (uint160(1) << 14) - 1;
    }

    function _logic2Address(address priceFeedAddr) internal pure returns (address) {
        bytes32 h = keccak256(
            abi.encodePacked(
                type(EswapMarginHookLogic2).creationCode, abi.encode(address(BASE_PM), priceFeedAddr)
            )
        );
        return create2Address(CREATE2_DEPLOYER, LOGIC2_SALT, h);
    }

    function _logic1Address(address priceFeedAddr, address logic2) internal pure returns (address) {
        bytes32 h = keccak256(
            abi.encodePacked(
                type(EswapMarginHookLogic).creationCode,
                abi.encode(address(BASE_PM), priceFeedAddr, logic2)
            )
        );
        return create2Address(CREATE2_DEPLOYER, LOGIC1_SALT, h);
    }

    function _deployedBytecodeLength() internal returns (uint256) {
        bytes memory json = bytes(vm.readFile("out/EswapMarginHook.sol/EswapMarginHook.json"));
        bytes memory key = '"deployedBytecode":{"object":"0x';
        uint256 k = _indexOf(json, key);
        require(k > 0, "deployedBytecode not found in hook artifact");
        uint256 start = k + key.length;
        uint256 n = 0;
        while (start + n < json.length && uint8(json[start + n]) != 0x22) n++;
        return n / 2;
    }

    function _libraryReferenceCount(bytes memory creation) internal view returns (uint256) {
        address libAddr =
            create2Address(CREATE2_DEPLOYER, bytes32(0), keccak256(type(EswapMarginLib).creationCode));
        uint256 count;
        for (uint256 i = 0; i + 20 <= creation.length; i++) {
            bool eq = true;
            for (uint256 j = 0; j < 20; j++) {
                if (creation[i + j] != bytes20(libAddr)[j]) {
                    eq = false;
                    break;
                }
            }
            if (eq) count++;
        }
        return count;
    }

    function _whitelistAggregators(EswapRouter router, string memory label, string memory envName) internal {
        address proxy = vm.envOr(envName, address(0));
        if (proxy == address(0)) {
            console.log(string.concat("  [PENDING] ", label, " (", envName, " unset)"));
            return;
        }
        if (!router.allowedAggregators(proxy)) {
            router.setAllowedAggregator(proxy, true);
        }
        console.log(string.concat("  [ROUTABLE] ", label, " ", vm.toString(proxy)));
    }

    function _maybeDeployUniswapXSettlement(EswapRouter router) internal {
        address reactor = vm.envOr("UNISWAPX_REACTOR_ADDRESS", address(0));
        address input = vm.envOr("UNISWAPX_SETTLEMENT_INPUT_TOKEN", address(0));
        address output = vm.envOr("UNISWAPX_SETTLEMENT_OUTPUT_TOKEN", address(0));
        uint256 maxFill = vm.envOr("UNISWAPX_SETTLEMENT_MAX_FILL", uint256(0));

        if (reactor == address(0) || input == address(0) || output == address(0) || maxFill == 0) {
            console.log("  [PENDING] UniswapX settlement (reactor/input/output/maxFill incomplete)");
            return;
        }

        EswapUniswapXSettlement settler =
            new EswapUniswapXSettlement(IReactor(reactor), IERC20(input), IERC20(output), maxFill);

        address operator = vm.envOr("SETTLEMENT_OPERATOR_ADDRESS", address(0));
        if (operator != address(0)) {
            EswapSettlementOps(address(settler)).setOperator(operator);
        }
        address recipient = vm.envOr("UNISWAPX_SETTLEMENT_RECIPIENT", address(0));
        if (recipient != address(0)) {
            EswapSettlementOps(address(settler)).setPendingRecipient(recipient);
        }
        if (!router.registeredSolvers(address(settler))) {
            router.setSolverWhitelist(address(settler), true);
        }
        console.log(string.concat("  [SETTLER] UniswapX ", vm.toString(address(settler))));
    }

    function _maybeDeployOneInchFusionSettlement(EswapRouter router) internal {
        address lop = vm.envOr("ONEINCH_FUSION_LOP_ADDRESS", address(0));
        address makerAsset = vm.envOr("ONEINCH_FUSION_MAKER_ASSET", address(0));
        address takerAsset = vm.envOr("ONEINCH_FUSION_TAKER_ASSET", address(0));
        uint256 maxFill = vm.envOr("ONEINCH_FUSION_MAX_FILL", uint256(0));

        if (lop == address(0) || makerAsset == address(0) || takerAsset == address(0) || maxFill == 0) {
            console.log("  [PENDING] 1inch Fusion settlement (lop/maker/taker/maxFill incomplete)");
            return;
        }

        EswapOneInchFusionSettlement settler =
            new EswapOneInchFusionSettlement(IOrderMixin(lop), IERC20(makerAsset), IERC20(takerAsset), maxFill);

        address operator = vm.envOr("SETTLEMENT_OPERATOR_ADDRESS", address(0));
        if (operator != address(0)) {
            EswapSettlementOps(address(settler)).setOperator(operator);
        }
        if (!router.registeredSolvers(address(settler))) {
            router.setSolverWhitelist(address(settler), true);
        }
        console.log(string.concat("  [SETTLER] 1inchFusion ", vm.toString(address(settler))));
    }

    function _indexOf(bytes memory haystack, bytes memory needle) internal pure returns (uint256) {
        require(needle.length > 0 && haystack.length >= needle.length, "bad _indexOf");
        for (uint256 i = 0; i + needle.length <= haystack.length; i++) {
            bool eq = true;
            for (uint256 j = 0; j < needle.length; j++) {
                if (haystack[i + j] != needle[j]) {
                    eq = false;
                    break;
                }
            }
            if (eq) return i;
        }
        return 0;
    }

    function create2Address(address deployer, bytes32 salt, bytes32 initCodeHash)
        internal
        pure
        returns (address addr)
    {
        assembly ("memory-safe") {
            let ptr := mload(0x40)
            mstore(add(ptr, 0x40), initCodeHash)
            mstore(add(ptr, 0x20), salt)
            mstore(ptr, deployer)
            let start := add(ptr, 0x0b)
            mstore8(start, 0xff)
            addr := and(keccak256(start, 85), 0xffffffffffffffffffffffffffffffffffffffff)
        }
    }
}
