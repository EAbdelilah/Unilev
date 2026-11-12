// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {PoolManager} from "@uniswap/v4-core/src/PoolManager.sol";
import {IPoolManager as RealIPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey as RealPoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency as RealCurrency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolId as RealPoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {AggregatorV3Interface} from "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {PoolKey} from "../../src/v4/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "../../src/v4/types/PoolId.sol";
import {Currency} from "../../src/v4/types/Currency.sol";
import {IPoolManager} from "../../src/v4/interfaces/IPoolManager.sol";
import {EswapMarginHook} from "../../src/v4/EswapMarginHook.sol";
import {EswapMarginHookLogic} from "../../src/v4/EswapMarginHookLogic.sol";
import {EswapMarginHookLogic2} from "../../src/v4/EswapMarginHookLogic2.sol";
import {EswapMarginHookLogic3} from "../../src/v4/EswapMarginHookLogic3.sol";
import {IPriceFeedLogic} from "../../src/v4/EswapMarginHookLogicStorage.sol";
import {EswapMarginLib} from "../../src/v4/EswapMarginLib.sol";
import {EswapRouter} from "../../src/v4/EswapRouter.sol";
import {EswapRouterExt} from "../../src/v4/EswapRouterExt.sol";
import {EswapLiquidationKeeper} from "../../src/v4/EswapLiquidationKeeper.sol";
import {EswapLeverageAdapter} from "../../src/v4/EswapLeverageAdapter.sol";
import {EswapLeverageQuoter} from "../../src/v4/EswapLeverageQuoter.sol";
import {EswapCoWSettlement} from "../../src/v4/EswapCoWSettlement.sol";
import {EswapSettlement} from "../../src/v4/EswapSettlement.sol";
import {EswapUniswapXSettlement} from "../../src/v4/EswapUniswapXSettlement.sol";
import {EswapOneInchFusionSettlement} from "../../src/v4/EswapOneInchFusionSettlement.sol";
import {IReactor} from "../../lib/uniswapx-interfaces/IReactor.sol";
import {IOrderMixin} from "../../lib/limit-order-protocol/IOrderMixin.sol";
import {PriceFeed} from "../../src/v4/PriceFeed.sol";
import {UsdcTwapFeed} from "../../src/v4/UsdcTwapFeed.sol";
import {HookFlags} from "../../src/v4/libraries/HookFlags.sol";

/// @dev Minimal admin surface shared by both venue settlers.
interface IEswapSettlementOps {
    function setOperator(address operator) external;

    function setPendingRecipient(address recipient) external;
}

/// @notice Base mainnet (8453) FULL-STACK redeploy at HEAD.
///
/// @dev Why this exists
///
///      The live Base deployment was broadcast on 2026-10-20 (commit 35292c3).
///      Every production contract in that stack has changed since: the hook
///      (+296), Logic (+267), Logic2 (654), Logic3 (a NEW 769-line contract),
///      Router (+151), RouterExt (+107), Keeper (+73), Adapter (+69),
///      CoW/UniswapX/Fusion settlers, PriceFeed, UsdcTwapFeed and
///      EswapMarginLib. The deployed Router predates `_requireKeyHook`, the
///      guard that stops the router forwarding a privileged hook call to an
///      arbitrary hook address -- which is exactly the cross-hook confusion
///      path a hook-only replacement would create (old hook and new hook both
///      trusting one router).
///
///      None of that is patchable in place: `hookLogic` is an immutable of
///      `EswapMarginHook`, `logic2`/`logic3` are constructor-bound, and
///      `EswapRouter`'s constructor takes only the PoolManager, so a HEAD
///      hook cannot be attached to the deployed router without redeploying it
///      anyway. Hence: fresh stack, fresh addresses.
///
/// @dev State cost
///
///      The live protocol holds one dust position (`totalOpenInterestUSD`
///      ~ $0.03, ~0.000028 WETH collateral) left over from the live proof
///      cycle. Nothing of value is stranded by moving to a new hook; the old
///      hook keeps its own (closed-out) book.
///
/// @dev What does NOT move
///
///      USDC/WETH, the canonical V4 PoolManager, the Chainlink feeds, and the
///      deep standard pool (WETH/USDC, fee 500, tickSpacing 10, no hooks).
///      The standard pool is hook-independent, so its liquidity is untouched.
///
/// @dev Three phases (the hook's initcode embeds the PriceFeed address, so the
///      feed must exist before the hook salt can be mined):
///
///        1. `forge script ... --sig "deployPriceFeed()"`  -> PRICE_FEED_ADDRESS
///        2. `forge script ... --sig "mine()"`            -> HOOK_SALT
///        3. `forge script ...` (run)                     -> the stack
///
///      Build with FOUNDRY_PROFILE=deploy: at the default profile
///      EswapMarginHook is 25,056 bytes and cannot be deployed under EIP-170.
contract RedeployBaseFull is Script {
    using PoolIdLibrary for PoolKey;

    // --- Base (8453) well-known addresses ----------------------------------
    address constant WETH = 0x4200000000000000000000000000000000000006;
    address constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address constant BASE_PM = 0x498581fF718922c3f8e6A244956aF099B2652b2b;
    // Chainlink ETH/USD (8 decimals). PriceFeed stores it under NATIVE_ETH_PRICE_KEY,
    // which is WETH -- so `setPriceFeed` MUST use WETH as the key.
    address constant ETH_USD_FEED = 0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70;
    address constant L2_SEQUENCER_UPTIME_FEED = 0xBCF85224fc0756B9Fa45aA7892530B47e10b6433;
    // Deepest Base USDC/WETH Uniswap V3 pool (0.05% tier) for the USDC TWAP leg.
    address constant USDC_WETH_V3_POOL = 0xd0b53D9277642d899DF5C87A3966A349A798F224;
    uint32 constant TWAP_WINDOW = 1800;
    /// @dev B2: the ETH/USD leg's own liveness bound. Chainlink's Base ETH/USD
    ///      heartbeat is well inside 24h, and the PriceFeed's 1h MAX_ORACLE_AGE
    ///      still bounds the composed answer.
    uint256 constant ETH_FEED_MAX_AGE = 24 hours;

    address constant CREATE2_DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;

    // --- Fresh CREATE2 salts ------------------------------------------------
    // The v1 salts belong to the 2026-10-20 deployment. Bumping them is not
    // strictly required (a changed creation code already yields a new address)
    // but it makes the intent explicit and keeps the two stacks trivially
    // distinguishable in block explorers.
    bytes32 constant LOGIC2_SALT = keccak256("eswap.logic2.base.v2");
    bytes32 constant LOGIC3_SALT = keccak256("eswap.logic3.base.v2");
    bytes32 constant LOGIC1_SALT = keccak256("eswap.logic1.base.v2");

    /// @dev EswapMarginLib is auto-linked by Foundry at
    ///      create2Address(CREATE2_DEPLOYER, 0, keccak256(libCreationCode)), so
    ///      its salt is fixed at zero by the linker, not by us. Because the
    ///      library's own bytecode changed since 2026-10-20, that address is a
    ///      NEW address -- the hook cannot silently link the stale copy.
    bytes32 constant LIB_SALT = bytes32(0);

    /// @dev ~5.4M for the hook CREATE2 (dominated by the 200 gas/byte deposit).
    uint256 constant HOOK_DEPLOY_GAS = 6_000_000;

    // --- Base aggregator proxies (verified in the live partner-config proof) --
    address constant AGG_0X_ALLOWANCE_HOLDER = 0x0000000000001fF3684f28c67538d4D072C22734;
    address constant AGG_ENSO = 0xF75584eF6673aD213a685a1B58Cc0330B8eA22Cf;
    address constant AGG_PARASWAP_V6_2 = 0x6A000F20005980200259B80c5102003040001068;
    address constant AGG_PARASWAP_V5 = 0x59C7C832e96D2568bea6db468C1aAdcbbDa08A52;
    address constant AGG_KYBER = 0x6131B5fae19EA4f9D964eAc0408E4408b66337b5;
    address constant AGG_1INCH = 0x111111125421cA6dc452d289314280a0f8842A65;
    address constant AGG_LIFI = 0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE;
    address constant AGG_BUNGEE = 0x50c4E75a512F2A14A7b304787Adf79C4531A5909;

    // ---------------------------------------------------------------- phase 1
    /// @notice Deploys PriceFeed + the USDC TWAP adapter (B2) and wires the
    ///         sequencer guard. Prints the address to put in PRICE_FEED_ADDRESS.
    function deployPriceFeed() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(pk);

        PriceFeed priceFeed = new PriceFeed();
        console.log("PriceFeed deployed at:", address(priceFeed));

        // ETH/USD under the WETH key: PriceFeed remaps address(0) -> WETH.
        priceFeed.setPriceFeed(
            WETH, ETH_USD_FEED, AggregatorV3Interface(ETH_USD_FEED).decimals()
        );

        // B2: the live adapter was built with the OLD 5-arg constructor and has
        // no `maxEthFeedAge`, so a stale ETH/USD answer could be priced off an
        // old anchor. HEAD fails closed instead (returns 0 -> StalePrice).
        UsdcTwapFeed usdcTwap =
            new UsdcTwapFeed(USDC_WETH_V3_POOL, ETH_USD_FEED, TWAP_WINDOW, USDC, WETH, ETH_FEED_MAX_AGE);
        priceFeed.setPriceFeed(USDC, address(usdcTwap), 18);
        console.log("UsdcTwapFeed deployed at:", address(usdcTwap));
        console.log("  maxEthFeedAge:", usdcTwap.maxEthFeedAge());

        priceFeed.setSequencerUptimeFeed(L2_SEQUENCER_UPTIME_FEED);

        vm.stopBroadcast();

        console.log("");
        console.log(string.concat("PRICE_FEED_ADDRESS=", vm.toString(address(priceFeed))));
        console.log(string.concat("USDC_TWAP_FEED=", vm.toString(address(usdcTwap))));
    }

    // ---------------------------------------------------------------- phase 2
    /// @notice Mines the hook salt for the CURRENT build. Requires
    ///         PRICE_FEED_ADDRESS. Run {run} against the SAME build: the salt
    ///         depends on this compilation unit's metadata hash.
    function mine() external {
        address owner_ = vm.addr(vm.envUint("PRIVATE_KEY"));
        address priceFeedAddr = vm.envAddress("PRICE_FEED_ADDRESS");

        address logic2 = _logic2Address(priceFeedAddr);
        address logic3 = _logic3Address(priceFeedAddr);
        address logic1 = _logic1Address(priceFeedAddr, logic2, logic3);
        bytes memory initCode = abi.encodePacked(
            type(EswapMarginHook).creationCode,
            abi.encode(BASE_PM, priceFeedAddr, logic1, logic2, owner_)
        );
        bytes32 initCodeHash = keccak256(initCode);

        console.log("logic2 (derived):", logic2);
        console.log("logic3 (derived):", logic3);
        console.log("logic1 (derived):", logic1);
        console.log("initCodeHash:");
        console.logBytes32(initCodeHash);

        (uint160 highFlags, uint160 lowMask, uint160 allMask) = _flags();
        vm.pauseGasMetering();
        bytes32 salt;
        uint256 tries;
        while (tries < 50_000_000) {
            bytes32 candidate = bytes32(tries);
            address computed = create2Address(CREATE2_DEPLOYER, candidate, initCodeHash);
            if ((uint160(computed) & highFlags) == highFlags && (uint160(computed) & allMask) == lowMask) {
                salt = candidate;
                break;
            }
            tries++;
        }
        vm.resumeGasMetering();
        require(salt != bytes32(0), "salt search exhausted");

        console.log("");
        console.log("HOOK_SALT=");
        console.logBytes32(salt);
        console.log("expected hook:", create2Address(CREATE2_DEPLOYER, salt, initCodeHash));
        console.log("tries:", tries);
    }

    // ---------------------------------------------------------------- phase 3
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);
        address solver = vm.envOr("SOLVER_ADDRESS", deployer);

        address priceFeedAddr = vm.envAddress("PRICE_FEED_ADDRESS");
        require(priceFeedAddr.code.length > 0, "PRICE_FEED_ADDRESS has no code - run deployPriceFeed first");
        bytes32 hookSalt = vm.envBytes32("HOOK_SALT");
        require(uint256(hookSalt) != 0, "HOOK_SALT unset - run mine first");

        PriceFeed priceFeed = PriceFeed(priceFeedAddr);
        PoolManager pm = PoolManager(BASE_PM);

        vm.startBroadcast(pk);

        // --- 1. EswapMarginLib at its linker-derived CREATE2 address --------
        bytes memory libInit = type(EswapMarginLib).creationCode;
        address libAddr = create2Address(CREATE2_DEPLOYER, LIB_SALT, keccak256(libInit));
        if (libAddr.code.length == 0) {
            address deployedLib;
            bytes32 libSalt = LIB_SALT;
            assembly {
                deployedLib := create2(0, add(libInit, 32), mload(libInit), libSalt)
            }
            require(deployedLib != address(0), "lib create2 failed");
        }
        require(libAddr.code.length > 0, "lib not deployed");
        console.log("EswapMarginLib:", libAddr);

        // --- 2. Logic2 -> Logic3 -> Logic (order matters) -------------------
        address expectedLogic2 = _logic2Address(priceFeedAddr);
        if (expectedLogic2.code.length == 0) {
            EswapMarginHookLogic2 deployed = new EswapMarginHookLogic2{salt: LOGIC2_SALT}(
                IPoolManager(address(pm)), IPriceFeedLogic(priceFeedAddr)
            );
            require(address(deployed) == expectedLogic2, "logic2 address drift");
        }
        console.log("HookLogic2:", expectedLogic2);

        address expectedLogic3 = _logic3Address(priceFeedAddr);
        if (expectedLogic3.code.length == 0) {
            EswapMarginHookLogic3 deployed = new EswapMarginHookLogic3{salt: LOGIC3_SALT}(
                IPoolManager(address(pm)), IPriceFeedLogic(priceFeedAddr)
            );
            require(address(deployed) == expectedLogic3, "logic3 address drift");
        }
        console.log("HookLogic3:", expectedLogic3);

        address expectedLogic1 = _logic1Address(priceFeedAddr, expectedLogic2, expectedLogic3);
        if (expectedLogic1.code.length == 0) {
            EswapMarginHookLogic deployed = new EswapMarginHookLogic{salt: LOGIC1_SALT}(
                IPoolManager(address(pm)), IPriceFeedLogic(priceFeedAddr), expectedLogic2, expectedLogic3
            );
            require(address(deployed) == expectedLogic1, "logic1 address drift");
        }
        console.log("HookLogic:", expectedLogic1);

        require(
            address(EswapMarginHookLogic(payable(expectedLogic1)).manager()) == address(pm),
            "logic manager mismatch"
        );
        require(
            address(EswapMarginHookLogic2(payable(expectedLogic2)).manager()) == address(pm),
            "logic2 manager mismatch"
        );

        // --- 3. Hook (CREATE2 with the mined permission bits) ---------------
        (uint160 highFlags, uint160 lowMask, uint160 allMask) = _flags();
        bytes memory initCode = abi.encodePacked(
            type(EswapMarginHook).creationCode,
            abi.encode(BASE_PM, priceFeedAddr, expectedLogic1, expectedLogic2, deployer)
        );
        bytes32 initCodeHash = keccak256(initCode);
        address expectedHook = create2Address(CREATE2_DEPLOYER, hookSalt, initCodeHash);
        require((uint160(expectedHook) & highFlags) == highFlags, "stale HOOK_SALT: missing high bits");
        require((uint160(expectedHook) & allMask) == lowMask, "stale HOOK_SALT: missing low bits");

        (bool ok, bytes memory ret) =
            CREATE2_DEPLOYER.call{gas: HOOK_DEPLOY_GAS}(abi.encodePacked(hookSalt, initCode));
        require(ok && ret.length == 20, "hook create2 failed");
        address payable hookAddr = payable(address(uint160(bytes20(ret))));
        require(hookAddr == expectedHook, "hook address != mined address");
        EswapMarginHook hook = EswapMarginHook(hookAddr);
        console.log("Hook:", address(hook));

        // --- 4. Router + execution stack ------------------------------------
        EswapRouter router = new EswapRouter(IPoolManager(address(pm)));
        console.log("Router:", address(router));

        EswapRouterExt routerExt = new EswapRouterExt(IPoolManager(address(pm)), address(router));
        console.log("RouterExt:", address(routerExt));
        router.setRouterExt(address(routerExt));
        router.setExecutorWhitelist(address(routerExt), true);

        EswapLiquidationKeeper keeper = new EswapLiquidationKeeper(address(hook), address(router));
        console.log("LiquidationKeeper:", address(keeper));

        EswapLeverageAdapter adapter = new EswapLeverageAdapter(router);
        console.log("LeverageAdapter:", address(adapter));
        // [AUDIT CRIT-4] the adapter relays swapMultiPoolFor for its recipient.
        router.setExecutorWhitelist(address(adapter), true);

        EswapLeverageQuoter quoter = new EswapLeverageQuoter(router);
        console.log("LeverageQuoter:", address(quoter));

        // --- 5. Hook config -------------------------------------------------
        hook.setConfig(
            EswapMarginHook.ConfigParams({
                treasury: vm.envOr("TREASURY", deployer),
                router: address(router),
                reserveFactor: vm.envOr("RESERVE_FACTOR", uint256(10)),
                maxPriceSwingBps: uint160(vm.envOr("MAX_PRICE_SWING_BPS", uint256(800))),
                defaultMaxLeverage: uint8(vm.envOr("DEFAULT_MAX_LEVERAGE", uint256(5))),
                requireTwapOracle: vm.envOr("REQUIRE_TWAP_ORACLE", true)
            })
        );
        hook.setRouterAndMinCollateralUsd(
            address(router), vm.envOr("MIN_COLLATERAL_USD", uint256(50000000000000000))
        );
        // [EIP-170] These three owner setters live in EswapMarginHookLogic and are
        // reachable only through the hook's fallback (delegatecall), so they must
        // be called on the hook ADDRESS using Logic1's ABI.
        EswapMarginHookLogic admin = EswapMarginHookLogic(payable(address(hook)));
        if (vm.envOr("LIQUIDATOR_INCENTIVE_BPS", uint256(0)) > 0) {
            admin.setLiquidatorIncentiveBps(vm.envOr("LIQUIDATOR_INCENTIVE_BPS", uint256(0)));
        }
        admin.setOpenInterestCaps(
            vm.envOr("MAX_SINGLE_OI_BPS", uint256(200)),
            vm.envOr("MAX_TOTAL_OI_BPS", uint256(1500)),
            vm.envOr("OI_CAP_TVL_FLOOR_USD", uint256(100_000 ether))
        );
        admin.setBandConsumptionTriggerBps(vm.envOr("BAND_CONSUMPTION_TRIGGER_BPS", uint256(2500)));

        // --- 6. Pools ------------------------------------------------------
        // WETH (0x4200..) sorts below USDC (0x8335..) => currency0 = WETH.
        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(WETH),
            currency1: Currency.wrap(USDC),
            fee: 3000,
            tickSpacing: 60,
            hooks: address(hook)
        });
        PoolKey memory standardKey = PoolKey({
            currency0: Currency.wrap(WETH),
            currency1: Currency.wrap(USDC),
            fee: 500,
            tickSpacing: 10,
            hooks: address(0)
        });

        // Seed the accounting rail at the live deep pool's price so the hook
        // pool's tick matches the venue it actually fills on.
        RealPoolId stdRealId =
            RealPoolId.wrap(keccak256(abi.encode(WETH, USDC, uint24(500), int24(10), address(0))));
        (uint160 stdSqrt,,,) = StateLibrary.getSlot0(pm, stdRealId);
        require(stdSqrt > 0, "deep standard pool uninitialized");

        RealPoolKey memory hookRealKey = RealPoolKey({
            currency0: RealCurrency.wrap(WETH),
            currency1: RealCurrency.wrap(USDC),
            fee: 3000,
            tickSpacing: 60,
            hooks: IHooks(address(hook))
        });
        RealPoolId hookRealId = RealPoolId.wrap(
            keccak256(abi.encode(WETH, USDC, uint24(3000), int24(60), address(hook)))
        );
        (uint160 hookSqrt,,,) = StateLibrary.getSlot0(pm, hookRealId);
        if (hookSqrt == 0) {
            pm.initialize(hookRealKey, stdSqrt);
        }

        // One owner call registers the pair end to end: authorized pool,
        // standard key, base currency, both token decimals and currency list.
        hook.registerTradingPair(key, standardKey, Currency.wrap(WETH), 18, 6);
        PoolId poolId = key.toId();
        console.log("PoolId:", vm.toString(PoolId.unwrap(poolId)));

        // --- 7. Adapter / quoter registry -----------------------------------
        adapter.registerPool(WETH, USDC, 3000, key, standardKey);
        adapter.registerPool(USDC, WETH, 3000, key, standardKey);
        quoter.registerPool(WETH, USDC, 3000, key, standardKey);
        quoter.registerPool(USDC, WETH, 3000, key, standardKey);
        if (adapter.defaultSolver() != solver) {
            adapter.setDefaultSolver(solver);
        }
        if (!router.registeredSolvers(solver)) {
            router.setSolverWhitelist(solver, true);
        }

        // --- 8. Settlers ----------------------------------------------------
        EswapCoWSettlement cow = new EswapCoWSettlement(
            router, vm.envOr("COW_GPv2_SETTLEMENT", address(0x9008D19f58AAbD9eD0D60971565AA8510560ab41))
        );
        console.log("CoWSettlement:", address(cow));
        // [AUDIT N-05] opens for the order owner, not the margin funder.
        if (!router.settlementWhitelist(address(cow))) {
            router.setSettlementWhitelist(address(cow), true);
        }

        EswapSettlement generic = new EswapSettlement(router);
        console.log("Settlement:", address(generic));
        if (!router.registeredSolvers(address(generic))) {
            router.setSolverWhitelist(address(generic), true);
        }
        if (!router.settlementWhitelist(address(generic))) {
            router.setSettlementWhitelist(address(generic), true);
        }

        address uniswapX = _deployUniswapX(router);
        address fusion = _deployFusion(router);

        // --- 9. Demand side: aggregator proxies -----------------------------
        _allow(router, AGG_0X_ALLOWANCE_HOLDER, "0x AllowanceHolder");
        _allow(router, AGG_ENSO, "Enso");
        _allow(router, AGG_PARASWAP_V6_2, "ParaSwap V6.2");
        _allow(router, AGG_PARASWAP_V5, "ParaSwap V5");
        _allow(router, AGG_KYBER, "Kyber MetaAggRouterV2");
        _allow(router, AGG_1INCH, "1inch V6");
        _allow(router, AGG_LIFI, "LI.FI");
        _allow(router, AGG_BUNGEE, "Socket/Bungee AllowanceHolder");
        // Optional extras, so a new venue can be added without a new script.
        _allowIfSet(router, "AGG_ODOS_PROXY_ADDRESS", "Odos");
        _allowIfSet(router, "AGG_JUMPER_PROXY_ADDRESS", "Jumper");

        vm.stopBroadcast();

        _summary(router, routerExt, hook, adapter, quoter, keeper, cow, generic, uniswapX, fusion, priceFeedAddr, poolId, solver);
    }

    // ------------------------------------------------------------- helpers
    function _deployUniswapX(EswapRouter router) internal returns (address) {
        address reactor = vm.envOr("UNISWAPX_REACTOR_ADDRESS", address(0));
        address input = vm.envOr("UNISWAPX_SETTLEMENT_INPUT_TOKEN", address(0));
        address output = vm.envOr("UNISWAPX_SETTLEMENT_OUTPUT_TOKEN", address(0));
        uint256 maxFill = vm.envOr("UNISWAPX_SETTLEMENT_MAX_FILL", uint256(0));
        if (reactor == address(0) || input == address(0) || output == address(0) || maxFill == 0) {
            console.log("  [PENDING] UniswapX settlement (reactor/input/output/maxFill incomplete)");
            return address(0);
        }
        EswapUniswapXSettlement settler =
            new EswapUniswapXSettlement(IReactor(reactor), IERC20(input), IERC20(output), maxFill);
        address operator = vm.envOr("SETTLEMENT_OPERATOR_ADDRESS", address(0));
        if (operator != address(0)) IEswapSettlementOps(address(settler)).setOperator(operator);
        address recipient = vm.envOr("UNISWAPX_SETTLEMENT_RECIPIENT", address(0));
        if (recipient != address(0)) IEswapSettlementOps(address(settler)).setPendingRecipient(recipient);
        if (!router.registeredSolvers(address(settler))) {
            router.setSolverWhitelist(address(settler), true);
        }
        console.log("UniswapXSettlement:", address(settler));
        return address(settler);
    }

    function _deployFusion(EswapRouter router) internal returns (address) {
        address lop = vm.envOr("ONEINCH_FUSION_LOP_ADDRESS", address(0));
        address makerAsset = vm.envOr("ONEINCH_FUSION_MAKER_ASSET", address(0));
        address takerAsset = vm.envOr("ONEINCH_FUSION_TAKER_ASSET", address(0));
        uint256 maxMaking = vm.envOr("ONEINCH_FUSION_MAX_FILL", uint256(0));
        // 5 WETH: the making-side cap (5,000 USDC) binds first, so this is a
        // backstop rather than the primary bound. Defaulting to maxMaking would
        // be 5e9 wei of WETH and would reject every fill.
        uint256 maxTaking = vm.envOr("ONEINCH_FUSION_MAX_TAKING", uint256(5 ether));
        if (lop == address(0) || makerAsset == address(0) || takerAsset == address(0) || maxMaking == 0) {
            console.log("  [PENDING] 1inch Fusion settlement (lop/maker/taker/maxMaking incomplete)");
            return address(0);
        }
        require(maxTaking > 0, "ONEINCH_FUSION_MAX_TAKING must be > 0");
        EswapOneInchFusionSettlement settler = new EswapOneInchFusionSettlement(
            IOrderMixin(lop), IERC20(makerAsset), IERC20(takerAsset), maxMaking, maxTaking
        );
        address operator = vm.envOr("SETTLEMENT_OPERATOR_ADDRESS", address(0));
        if (operator != address(0)) IEswapSettlementOps(address(settler)).setOperator(operator);
        if (!router.registeredSolvers(address(settler))) {
            router.setSolverWhitelist(address(settler), true);
        }
        console.log("OneInchFusionSettlement:", address(settler));
        console.log("  maxMakingAmount:", settler.maxMakingAmount());
        console.log("  maxTakingAmount:", settler.maxTakingAmount());
        return address(settler);
    }

    function _allow(EswapRouter router, address proxy, string memory label) internal {
        require(proxy.code.length > 0, string.concat("aggregator has no code: ", label));
        if (!router.allowedAggregators(proxy)) {
            router.setAllowedAggregator(proxy, true);
        }
        console.log(string.concat("  [ROUTABLE] ", label, " ", vm.toString(proxy)));
    }

    function _allowIfSet(EswapRouter router, string memory envName, string memory label) internal {
        address proxy = vm.envOr(envName, address(0));
        if (proxy == address(0)) {
            console.log(string.concat("  [PENDING] ", label, " (", envName, " unset)"));
            return;
        }
        _allow(router, proxy, label);
    }

    /// @dev Prints a `KEY=value` block that `scripts/v4/live/apply-env.cjs` can
    ///      consume verbatim. Every address `.env` needs must appear here, or a
    ///      redeploy silently leaves a key pointing at the retired stack -- which
    ///      is exactly what happened on 2026-11-11 (PriceFeed, USDC feed,
    ///      RouterExt and both inventory settlers were only in the broadcast
    ///      artifacts). Keep this list in sync with `apply-env.cjs`.
    function _summary(
        EswapRouter router,
        EswapRouterExt routerExt,
        EswapMarginHook hook,
        EswapLeverageAdapter adapter,
        EswapLeverageQuoter quoter,
        EswapLiquidationKeeper keeper,
        EswapCoWSettlement cow,
        EswapSettlement generic,
        address uniswapX,
        address fusion,
        address priceFeed,
        PoolId poolId,
        address solver
    ) internal view {
        console.log("");
        console.log("=== Base full-stack redeploy (HEAD) ===");
        console.log(string.concat("V4_HOOK_ADDRESS=", vm.toString(address(hook))));
        console.log(string.concat("V4_ROUTER_ADDRESS=", vm.toString(address(router))));
        console.log(string.concat("V4_ROUTER_EXT_ADDRESS=", vm.toString(address(routerExt))));
        console.log(string.concat("V4_ADAPTER_ADDRESS=", vm.toString(address(adapter))));
        console.log(string.concat("V4_QUOTER_ADDRESS=", vm.toString(address(quoter))));
        console.log(string.concat("V4_KEEPER_ADDRESS=", vm.toString(address(keeper))));
        console.log(string.concat("V4_COW_SETTLEMENT_ADDRESS=", vm.toString(address(cow))));
        console.log(string.concat("V4_SETTLEMENT_ADDRESS=", vm.toString(address(generic))));
        if (uniswapX != address(0)) {
            console.log(string.concat("V4_UNISWAPX_SETTLEMENT_ADDRESS=", vm.toString(uniswapX)));
        }
        if (fusion != address(0)) {
            console.log(string.concat("V4_ONEINCH_FUSION_SETTLEMENT_ADDRESS=", vm.toString(fusion)));
        }
        console.log(string.concat("V4_PRICEFEED_ADDRESS=", vm.toString(priceFeed)));
        console.log(string.concat("PRICE_FEED_ADDRESS=", vm.toString(priceFeed)));
        console.log(string.concat("POOL_ID=", vm.toString(PoolId.unwrap(poolId))));
        console.log(string.concat("DefaultSolver: ", vm.toString(adapter.defaultSolver())));
        console.log(string.concat("SolverWhitelisted: ", vm.toString(router.registeredSolvers(solver))));
        console.log("");
        console.log("Next: node scripts/v4/live/apply-env.cjs phase3-broadcast.log");
        console.log("      node javascript/update-dashboard.js && node scripts/v4/live/partner-config.cjs");
    }

    // ---------------------------------------------------------- derivations
    function _flags() internal pure returns (uint160 highFlags, uint160 lowMask, uint160 allMask) {
        highFlags = HookFlags.AFTER_INITIALIZE_FLAG | HookFlags.BEFORE_SWAP_FLAG
            | HookFlags.BEFORE_SWAP_RETURNS_DELTA_FLAG | HookFlags.AFTER_SWAP_FLAG;
        lowMask = (uint160(1) << 12) | (uint160(1) << 7) | (uint160(1) << 6) | (uint160(1) << 3);
        allMask = (uint160(1) << 14) - 1;
    }

    function _logic2Address(address priceFeedAddr) internal pure returns (address) {
        bytes32 h = keccak256(
            abi.encodePacked(
                type(EswapMarginHookLogic2).creationCode, abi.encode(BASE_PM, priceFeedAddr)
            )
        );
        return create2Address(CREATE2_DEPLOYER, LOGIC2_SALT, h);
    }

    function _logic3Address(address priceFeedAddr) internal pure returns (address) {
        bytes32 h = keccak256(
            abi.encodePacked(
                type(EswapMarginHookLogic3).creationCode, abi.encode(BASE_PM, priceFeedAddr)
            )
        );
        return create2Address(CREATE2_DEPLOYER, LOGIC3_SALT, h);
    }

    function _logic1Address(address priceFeedAddr, address logic2, address logic3)
        internal
        pure
        returns (address)
    {
        bytes32 h = keccak256(
            abi.encodePacked(
                type(EswapMarginHookLogic).creationCode,
                abi.encode(BASE_PM, priceFeedAddr, logic2, logic3)
            )
        );
        return create2Address(CREATE2_DEPLOYER, LOGIC1_SALT, h);
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
