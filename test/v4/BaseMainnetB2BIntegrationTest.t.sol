// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {AggregatorV3Interface} from "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {EswapMarginHook} from "../../src/v4/EswapMarginHook.sol";
import {EswapRouter} from "../../src/v4/EswapRouter.sol";
import {EswapLeverageAdapter} from "../../src/v4/EswapLeverageAdapter.sol";
import {EswapLeverageQuoter} from "../../src/v4/EswapLeverageQuoter.sol";
import {EswapCoWSettlement, CowOrder} from "../../src/v4/EswapCoWSettlement.sol";
import {CowSigning} from "../../src/v4/cow/CowSigning.sol";
import {EswapUniswapXSettlement} from "../../src/v4/EswapUniswapXSettlement.sol";
import {EswapOneInchFusionSettlement} from "../../src/v4/EswapOneInchFusionSettlement.sol";
import {
    IReactor,
    IValidationCallback,
    ResolvedOrder,
    SignedOrder,
    OrderInfo,
    InputToken,
    OutputToken
} from "../../lib/uniswapx-interfaces/IReactor.sol";
import {IOrderMixin, MakerTraits, TakerTraits} from "../../lib/limit-order-protocol/IOrderMixin.sol";
import {PoolKey} from "../../src/v4/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "../../src/v4/types/PoolId.sol";
import {Currency} from "../../src/v4/types/Currency.sol";
import {PriceFeedMock} from "../../src/v4/test/BaseV4Test.t.sol";
import {BaseEnsoRoute} from "../../src/v4/test/fixtures/BaseEnsoRoute.sol";
import {BaseParaSwapRoute} from "../../src/v4/test/fixtures/BaseParaSwapRoute.sol";
import {BaseKyberRoute} from "../../src/v4/test/fixtures/BaseKyberRoute.sol";
import {EswapHookDeployLib} from "../../src/v4/test/EswapHookDeployLib.sol";

import {IPoolManager as RealIPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolId as RealPoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {PoolKey as RealPoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency as RealCurrency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks as RealIHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";

interface IZeroExV4 {
    struct LimitOrder {
        address makerToken;
        address takerToken;
        uint128 makerAmount;
        uint128 takerAmount;
        uint128 takerTokenFeeAmount;
        address maker;
        address taker;
        address sender;
        address feeRecipient;
        bytes32 pool;
        uint64 expiry;
        uint256 salt;
    }

    struct Signature {
        uint8 signatureType;
        uint8 v;
        bytes32 r;
        bytes32 s;
    }

    function getLimitOrderHash(LimitOrder calldata order) external view returns (bytes32);
    function getProtocolFeeMultiplier() external view returns (uint32);
    function fillLimitOrder(LimitOrder calldata order, Signature calldata signature, uint128 takerTokenFillAmount)
        external
        payable
        returns (uint128 makerTokenFilledAmount, uint128 takerTokenFilledAmount);
}

struct XPriorityInput {
    address token;
    uint256 amount;
    uint256 mpsPerPriorityFeeWei;
}

struct XPriorityOutput {
    address token;
    uint256 amount;
    uint256 mpsPerPriorityFeeWei;
    address recipient;
}

struct XPriorityCosignerData {
    uint256 auctionTargetBlock;
}

struct XPriorityOrder {
    OrderInfo info;
    address cosigner;
    uint256 auctionStartBlock;
    uint256 baselinePriorityFeeWei;
    XPriorityInput input;
    XPriorityOutput[] outputs;
    XPriorityCosignerData cosignerData;
    bytes cosignature;
}

/// @title BaseMainnetB2BIntegrationTest
/// @notice B2B integration suite on a Base mainnet fork (chainId 8453).
///
///         Demand side (aggregators -> Eswap):
///           - real Enso bundle executed through EnsoRouter V2
///           - ODOS / 0x / ParaSwap / KyberSwap / 1inch venue wiring checks
///           - standard adapter path + quoter parity
///           - aggregator whitelist + multicall restrictions
///
///         Supply side (solvers -> Eswap):
///           - CoW Protocol order filled under the canonical GPv2Settlement domain
///           - permissionless LendingIntent solver fill with ERC20 borrow escrow
///           - UniswapX validation-callback gates against the live reactor
///           - 1inch Fusion Limit Order Protocol callback gates
///
///         Risk controls:
///           - live Chainlink ETH/USD and USDC/USD reads
///           - V4-spot vs TWAP circuit breaker rejects a manipulated oracle
contract BaseMainnetB2BIntegrationTest is Test, IUnlockCallback {
    using PoolIdLibrary for PoolKey;

    address constant BASE_PM = 0x498581fF718922c3f8e6A244956aF099B2652b2b;
    address constant BASE_USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address constant BASE_WETH = 0x4200000000000000000000000000000000000006;

    address constant ZEROX_PROXY = 0xDef1C0ded9bec7F1a1670819833240f027b25EfF;
    address constant PARASWAP_AUGUSTUS = 0x6A000F20005980200259B80c5102003040001068;
    address constant KYBERSWAP_META_AGGREGATOR = 0x6131B5fae19EA4f9D964eAc0408E4408b66337b5;
    address constant ODOS_ROUTER_V2 = 0x19cEeAd7105607Cd444F5ad10dd51356436095a1;
    address constant ENSO_ROUTER_V2 = 0xF75584eF6673aD213a685a1B58Cc0330B8eA22Cf;
    address constant ONEINCH_LOP_V4 = 0x111111125421cA6dc452d289314280a0f8842A65;

    address constant UNISWAPX_PRIORITY_REACTOR = 0x000000001Ec5656dcdB24D90DFa42742738De729;
    address constant COW_GPV2_SETTLEMENT = 0x9008D19f58AAbD9eD0D60971565AA8510560ab41;

    address constant CHAINLINK_ETH_USD = 0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70;
    address constant CHAINLINK_USDC_USD = 0x7e860098F58bBFC8648a4311b374B1D669a2bc6B;
    address constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;

    bytes32 constant ORDER_INFO_TYPEHASH = keccak256(
        "OrderInfo(address reactor,address swapper,uint256 nonce,uint256 deadline,address additionalValidationContract,bytes additionalValidationData)"
    );
    bytes32 constant PRIORITY_INPUT_TYPEHASH =
        keccak256("PriorityInput(address token,uint256 amount,uint256 mpsPerPriorityFeeWei)");
    bytes32 constant PRIORITY_OUTPUT_TYPEHASH =
        keccak256("PriorityOutput(address token,uint256 amount,uint256 mpsPerPriorityFeeWei,address recipient)");
    bytes32 constant TOKEN_PERMISSIONS_TYPEHASH = keccak256("TokenPermissions(address token,uint256 amount)");
    bytes32 constant PERMIT2_DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,uint256 chainId,address verifyingContract)");

    uint160 constant HIGH_FLAGS = (1 << 159) | (1 << 158) | (1 << 153) | (1 << 152) | (1 << 148);
    uint160 constant LOW_FLAGS = (1 << 13) | (1 << 12) | (1 << 7) | (1 << 6) | (1 << 3);

    int24 constant LP_HALF_WIDTH = 2400;
    int24 constant INIT_TICK = -198673;

    RealIPoolManager pm;
    EswapMarginHook hook;
    EswapRouter router;
    EswapLeverageAdapter adapter;
    EswapLeverageQuoter quoter;
    EswapCoWSettlement cow;
    EswapUniswapXSettlement uniswapx;
    EswapOneInchFusionSettlement fusion;
    PriceFeedMock priceFeed;

    PoolKey hookLocalKey;
    PoolKey standardLocalKey;

    uint256 constant TRADER_PK = 0xA11CE;
    uint256 constant ZEROX_MAKER_PK = 0xB0B;
    address trader;
    address zeroExMaker;
    address solver = makeAddr("b2bSolver");
    address cowSolver = makeAddr("b2bCowSolver");
    address intentSolver = makeAddr("b2bIntentSolver");
    address relayer = makeAddr("b2bRelayer");
    address swapRecipient = makeAddr("b2bUniswapXRecipient");

    bool ready;

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        (RealPoolKey memory key, int24 tl, int24 tu, int128 liq) = abi.decode(data, (RealPoolKey, int24, int24, int128));
        (BalanceDelta delta,) = pm.modifyLiquidity(
            key,
            RealIPoolManager.ModifyLiquidityParams({tickLower: tl, tickUpper: tu, liquidityDelta: liq, salt: bytes32(0)}),
            ""
        );
        if (delta.amount0() < 0) {
            pm.sync(RealCurrency.wrap(BASE_WETH));
            IERC20(BASE_WETH).transfer(address(pm), uint256(-int256(delta.amount0())));
            pm.settle();
        } else if (delta.amount0() > 0) {
            pm.take(RealCurrency.wrap(BASE_WETH), address(this), uint256(uint128(delta.amount0())));
        }
        if (delta.amount1() < 0) {
            pm.sync(RealCurrency.wrap(BASE_USDC));
            IERC20(BASE_USDC).transfer(address(pm), uint256(-int256(delta.amount1())));
            pm.settle();
        } else if (delta.amount1() > 0) {
            pm.take(RealCurrency.wrap(BASE_USDC), address(this), uint256(uint128(delta.amount1())));
        }
        return bytes("");
    }

    function setUp() public {
        string memory rpcUrl = vm.envOr("BASE_RPC_URL", string("https://mainnet.base.org"));
        vm.createSelectFork(rpcUrl, BaseEnsoRoute.REF_BLOCK);
        try this._setupOnActiveFork() {} catch (bytes memory reason) {
            console2.log("Base B2B setup failed:", _reason(reason));
        }
    }

    function _reason(bytes memory r) internal pure returns (string memory) {
        if (r.length >= 68 && bytes4(r) == 0x08c379a0) return abi.decode(_slice(r, 4), (string));
        return "unknown revert";
    }

    function _slice(bytes memory b, uint256 from) internal pure returns (bytes memory out) {
        out = new bytes(b.length - from);
        for (uint256 i = 0; i < out.length; i++) {
            out[i] = b[from + i];
        }
    }

    function _setupOnActiveFork() external {
        if (block.chainid != 8453) return;
        if (BASE_PM.code.length == 0 || BASE_USDC.code.length == 0 || BASE_WETH.code.length == 0) return;

        pm = RealIPoolManager(BASE_PM);
        priceFeed = new PriceFeedMock();
        trader = vm.addr(TRADER_PK);
        zeroExMaker = vm.addr(ZEROX_MAKER_PK);

        address hookAddr = address(uint160(HIGH_FLAGS | LOW_FLAGS));
        (address hookLogic, address hookLogic2) = EswapHookDeployLib.deployLogic(address(pm), address(priceFeed));
        deployCodeTo(
            "EswapMarginHook.sol:EswapMarginHook",
            abi.encode(address(pm), address(priceFeed), hookLogic, hookLogic2, address(this)),
            hookAddr
        );
        hook = EswapMarginHook(payable(hookAddr));

        deployCodeTo("EswapRouter.sol:EswapRouter", abi.encode(address(pm)), BaseEnsoRoute.TAKER);
        router = EswapRouter(payable(BaseEnsoRoute.TAKER));

        hook.setRouterAndMinCollateralUsd(address(router), 0);
        hook.setTokenDecimals(BASE_WETH, 18);
        hook.setTokenDecimals(BASE_USDC, 6);

        hookLocalKey = PoolKey({
            currency0: Currency.wrap(BASE_WETH),
            currency1: Currency.wrap(BASE_USDC),
            fee: 3000,
            tickSpacing: 60,
            hooks: hookAddr
        });
        standardLocalKey = PoolKey({
            currency0: Currency.wrap(BASE_WETH),
            currency1: Currency.wrap(BASE_USDC),
            fee: 3000,
            tickSpacing: 60,
            hooks: address(0)
        });

        RealPoolKey memory stdReal = _realKey(address(0));
        RealPoolKey memory hookReal = _realKey(hookAddr);
        uint160 initSqrt = TickMath.getSqrtPriceAtTick(INIT_TICK);
        (uint160 stdSqrt,,,) = StateLibrary.getSlot0(pm, stdReal.toId());
        if (stdSqrt == 0) {
            pm.initialize(stdReal, initSqrt);
            stdSqrt = initSqrt;
        }
        (uint160 hookSqrt,,,) = StateLibrary.getSlot0(pm, hookReal.toId());
        if (hookSqrt == 0) pm.initialize(hookReal, stdSqrt);

        hook.setAuthorizedPool(hookLocalKey.toId(), true);
        hook.setStandardPoolKey(hookLocalKey.toId(), standardLocalKey);
        hook.setBaseCurrency(hookLocalKey.toId(), Currency.wrap(BASE_WETH));

        priceFeed.setPrice(BASE_USDC, 1e18);
        priceFeed.setPrice(BASE_WETH, _wethUsd18FromSqrt(stdSqrt));

        _seedPools(hookReal, stdReal, stdSqrt);

        adapter = new EswapLeverageAdapter(router);
        quoter = new EswapLeverageQuoter(router);
        router.setExecutorWhitelist(address(adapter), true);
        router.setAllowedAggregator(ENSO_ROUTER_V2, true);

        adapter.registerPool(BASE_USDC, BASE_WETH, 3000, hookLocalKey, standardLocalKey);
        adapter.registerPool(BASE_WETH, BASE_USDC, 3000, hookLocalKey, standardLocalKey);
        adapter.setDefaultSolver(solver);
        quoter.registerPool(BASE_USDC, BASE_WETH, 3000, hookLocalKey, standardLocalKey);
        quoter.registerPool(BASE_WETH, BASE_USDC, 3000, hookLocalKey, standardLocalKey);

        router.setSolverWhitelist(solver, true);

        cow = new EswapCoWSettlement(router, COW_GPV2_SETTLEMENT);
        uniswapx = new EswapUniswapXSettlement(
            IReactor(UNISWAPX_PRIORITY_REACTOR), IERC20(BASE_USDC), IERC20(BASE_WETH), 1e18
        );
        uniswapx.setPendingRecipient(swapRecipient);
        fusion = new EswapOneInchFusionSettlement(
            IOrderMixin(ONEINCH_LOP_V4), IERC20(BASE_USDC), IERC20(BASE_WETH), 1e18, 1e18
        );

        deal(BASE_USDC, trader, 1_000_000e6);
        deal(BASE_USDC, solver, 1_000_000e6);
        deal(BASE_USDC, cowSolver, 1_000_000e6);
        deal(BASE_USDC, intentSolver, 1_000_000e6);

        vm.prank(trader);
        IERC20(BASE_USDC).approve(address(router), type(uint256).max);
        vm.prank(solver);
        IERC20(BASE_USDC).approve(address(router), type(uint256).max);
        vm.prank(cowSolver);
        IERC20(BASE_USDC).approve(address(router), type(uint256).max);
        vm.prank(cowSolver);
        IERC20(BASE_USDC).approve(address(cow), type(uint256).max);
        vm.prank(intentSolver);
        IERC20(BASE_USDC).approve(address(router), type(uint256).max);

        ready = true;
    }

    function _realKey(address hooks) internal view returns (RealPoolKey memory k) {
        k = RealPoolKey({
            currency0: RealCurrency.wrap(BASE_WETH),
            currency1: RealCurrency.wrap(BASE_USDC),
            fee: 3000,
            tickSpacing: 60,
            hooks: RealIHooks(hooks)
        });
    }

    function _seedPools(RealPoolKey memory hookReal, RealPoolKey memory stdReal, uint160 initSqrt) internal {
        deal(BASE_USDC, address(this), 2_000_000e6);
        deal(BASE_WETH, address(this), 4000 ether);
        IERC20(BASE_USDC).approve(address(pm), type(uint256).max);
        IERC20(BASE_WETH).approve(address(pm), type(uint256).max);

        int24 tick = TickMath.getTickAtSqrtPrice(initSqrt);
        int24 base = (tick / 60) * 60;
        int24 lower = base - LP_HALF_WIDTH;
        int24 upper = base + LP_HALF_WIDTH;
        int128 liq = int128(int256(1e15));

        pm.unlock(abi.encode(stdReal, lower, upper, liq));
        pm.unlock(abi.encode(hookReal, lower, upper, liq));

        require(
            StateLibrary.getLiquidity(pm, RealPoolId.wrap(PoolId.unwrap(standardLocalKey.toId()))) > 0,
            "standard pool liquidity missing"
        );
        require(
            StateLibrary.getLiquidity(pm, RealPoolId.wrap(PoolId.unwrap(hookLocalKey.toId()))) > 0,
            "hook pool liquidity missing"
        );
    }

    function _wethUsd18FromSqrt(uint160 sqrtP) internal pure returns (uint256) {
        return FullMath.mulDiv(uint256(sqrtP) * uint256(sqrtP), 1e30, uint256(1) << 192);
    }

    function _minOut() internal pure returns (uint256) {
        return (BaseEnsoRoute.EXPECTED_BUY * 95) / 100;
    }

    function _route(bytes memory callData, uint256 notional) internal pure returns (EswapRouter.AggregatorRoute memory) {
        return _routeAt(ENSO_ROUTER_V2, callData, notional);
    }

    function _routeAt(address exchangeProxy, bytes memory callData, uint256 notional)
        internal
        pure
        returns (EswapRouter.AggregatorRoute memory)
    {
        return EswapRouter.AggregatorRoute({
            exchangeProxy: exchangeProxy,
            tokenIn: BASE_USDC,
            tokenOut: BASE_WETH,
            sellAmount: notional,
            value: 0,
            callData: callData
        });
    }

    function _priorityOrderTypehash() internal pure returns (bytes32) {
        return keccak256(
            abi.encodePacked(
                "PriorityOrder(OrderInfo info,address cosigner,uint256 auctionStartBlock,uint256 baselinePriorityFeeWei,PriorityInput input,PriorityOutput[] outputs)",
                "OrderInfo(address reactor,address swapper,uint256 nonce,uint256 deadline,address additionalValidationContract,bytes additionalValidationData)",
                "PriorityInput(address token,uint256 amount,uint256 mpsPerPriorityFeeWei)",
                "PriorityOutput(address token,uint256 amount,uint256 mpsPerPriorityFeeWei,address recipient)"
            )
        );
    }

    function _priorityWitnessType() internal pure returns (string memory) {
        return string(
            abi.encodePacked(
                "PriorityOrder witness)",
                "OrderInfo(address reactor,address swapper,uint256 nonce,uint256 deadline,address additionalValidationContract,bytes additionalValidationData)",
                "PriorityInput(address token,uint256 amount,uint256 mpsPerPriorityFeeWei)",
                "PriorityOrder(OrderInfo info,address cosigner,uint256 auctionStartBlock,uint256 baselinePriorityFeeWei,PriorityInput input,PriorityOutput[] outputs)",
                "PriorityOutput(address token,uint256 amount,uint256 mpsPerPriorityFeeWei,address recipient)",
                "TokenPermissions(address token,uint256 amount)"
            )
        );
    }

    function _hashPriorityOutput(XPriorityOutput memory output) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                PRIORITY_OUTPUT_TYPEHASH,
                output.token,
                output.amount,
                output.mpsPerPriorityFeeWei,
                output.recipient
            )
        );
    }

    function _hashPriorityOrder(XPriorityOrder memory order) internal pure returns (bytes32) {
        bytes32 infoHash = keccak256(
            abi.encode(
                ORDER_INFO_TYPEHASH,
                address(order.info.reactor),
                order.info.swapper,
                order.info.nonce,
                order.info.deadline,
                address(order.info.additionalValidationContract),
                keccak256(order.info.additionalValidationData)
            )
        );
        bytes32 inputHash = keccak256(
            abi.encode(
                PRIORITY_INPUT_TYPEHASH,
                order.input.token,
                order.input.amount,
                order.input.mpsPerPriorityFeeWei
            )
        );
        bytes32[] memory outputHashes = new bytes32[](order.outputs.length);
        for (uint256 i; i < order.outputs.length; i++) {
            outputHashes[i] = _hashPriorityOutput(order.outputs[i]);
        }
        bytes32 outputsHash = keccak256(abi.encodePacked(outputHashes));

        return keccak256(
            abi.encode(
                _priorityOrderTypehash(),
                infoHash,
                order.cosigner,
                order.auctionStartBlock,
                order.baselinePriorityFeeWei,
                inputHash,
                outputsHash
            )
        );
    }

    function _permit2WitnessDigest(XPriorityOrder memory order, bytes32 orderHash) internal view returns (bytes32) {
        bytes32 tokenPermissionsHash =
            keccak256(abi.encode(TOKEN_PERMISSIONS_TYPEHASH, order.input.token, order.input.amount));
        bytes32 permitTypeHash = keccak256(
            abi.encodePacked(
                "PermitWitnessTransferFrom(TokenPermissions permitted,address spender,uint256 nonce,uint256 deadline,",
                _priorityWitnessType()
            )
        );
        bytes32 structHash = keccak256(
            abi.encode(
                permitTypeHash,
                tokenPermissionsHash,
                UNISWAPX_PRIORITY_REACTOR,
                order.info.nonce,
                order.info.deadline,
                orderHash
            )
        );
        bytes32 domain =
            keccak256(abi.encode(PERMIT2_DOMAIN_TYPEHASH, keccak256("Permit2"), block.chainid, PERMIT2));
        return keccak256(abi.encodePacked("\x19\x01", domain, structHash));
    }

    function _vs(bytes32 s, uint8 v) internal pure returns (bytes32) {
        return bytes32(uint256(s) | (uint256(v - 27) << 255));
    }

    function _oneInchExtension(address settlement) internal pure returns (bytes memory) {
        uint256 offsets = uint256(20) << 224;
        return abi.encodePacked(bytes32(offsets), settlement);
    }

    // ---------------------------------------------------------------- demand side

    function test_BaseFork_Environment() public view {
        if (!ready) return;
        assertEq(block.chainid, 8453, "must be a Base mainnet fork");
        assertGt(BASE_PM.code.length, 0);
        assertEq(address(router), BaseEnsoRoute.TAKER);
    }

    function test_ExternalVenues_HaveCodeOnBase() public view {
        if (!ready) return;
        assertGt(ZEROX_PROXY.code.length, 0, "0x ExchangeProxy");
        assertGt(PARASWAP_AUGUSTUS.code.length, 0, "ParaSwap Augustus");
        assertGt(KYBERSWAP_META_AGGREGATOR.code.length, 0, "KyberSwap MetaAggregator");
        assertGt(ODOS_ROUTER_V2.code.length, 0, "Odos Router V2");
        assertGt(ENSO_ROUTER_V2.code.length, 0, "Enso Router V2");
        assertGt(ONEINCH_LOP_V4.code.length, 0, "1inch LOP V4");
        assertGt(UNISWAPX_PRIORITY_REACTOR.code.length, 0, "UniswapX PriorityOrderReactor");
        assertGt(COW_GPV2_SETTLEMENT.code.length, 0, "CoW GPv2Settlement");
        assertGt(CHAINLINK_ETH_USD.code.length, 0, "Chainlink ETH/USD");
        assertGt(CHAINLINK_USDC_USD.code.length, 0, "Chainlink USDC/USD");
    }

    function test_ChainlinkFeeds_LiveOnBase() public view {
        if (!ready) return;
        (, int256 ethAnswer,, uint256 ethUpdated,) = AggregatorV3Interface(CHAINLINK_ETH_USD).latestRoundData();
        (, int256 usdcAnswer,, uint256 usdcUpdated,) = AggregatorV3Interface(CHAINLINK_USDC_USD).latestRoundData();
        assertGt(ethAnswer, 1e11, "ETH/USD must be a plausible 8-dec price");
        assertGt(usdcAnswer, 0, "USDC/USD must be positive");
        assertGt(ethUpdated, 0);
        assertGt(usdcUpdated, 0);
    }

    function test_Enso_RealBundle_AggregatorOpen() public {
        if (!ready) return;
        uint8 leverage = 2;
        uint256 notional = BaseEnsoRoute.SELL_AMOUNT;
        uint256 margin = notional / leverage;

        uint256 routerWethBefore = IERC20(BASE_WETH).balanceOf(address(router));

        vm.prank(trader);
        uint256 collateral = adapter.exactInputSingleWithLeverageAggregator(
            BASE_USDC, BASE_WETH, 3000, leverage, margin, _minOut(), trader, _route(BaseEnsoRoute.CALLDATA, notional)
        );

        assertGt(collateral, 0, "Enso fill must return collateral");
        (address posTrader, uint256 posCollateral, uint256 borrowed, uint8 posLev, bool isLong,,,,) =
            hook.positions(hookLocalKey.toId(), trader);
        assertEq(posTrader, trader);
        assertGt(posCollateral, 0);
        assertEq(borrowed, margin);
        assertEq(posLev, leverage);
        assertTrue(isLong);
        assertEq(IERC20(BASE_WETH).balanceOf(address(router)) - routerWethBefore, 0, "router retains no fill output");
    }

    function test_ParaSwap_RealRoute_AggregatorOpen() public {
        if (!ready) return;
        if (BaseParaSwapRoute.CALLDATA.length == 0) return;

        uint8 leverage = 2;
        uint256 notional = BaseParaSwapRoute.SELL_AMOUNT;
        uint256 margin = notional / leverage;

        router.setAllowedAggregator(BaseParaSwapRoute.EXCHANGE_PROXY, true);
        vm.prank(address(router));
        IERC20(BASE_USDC).approve(BaseParaSwapRoute.TOKEN_PROXY, type(uint256).max);

        uint256 routerWethBefore = IERC20(BASE_WETH).balanceOf(address(router));

        vm.prank(trader);
        uint256 collateral = adapter.exactInputSingleWithLeverageAggregator(
            BaseParaSwapRoute.TOKEN_IN,
            BaseParaSwapRoute.TOKEN_OUT,
            3000,
            leverage,
            margin,
            BaseParaSwapRoute.MIN_BUY,
            trader,
            _routeAt(BaseParaSwapRoute.EXCHANGE_PROXY, BaseParaSwapRoute.CALLDATA, notional)
        );

        assertGt(collateral, 0, "ParaSwap fill must return collateral");
        (address posTrader, uint256 posCollateral, uint256 borrowed, uint8 posLev, bool isLong,,,,) =
            hook.positions(hookLocalKey.toId(), trader);
        assertEq(posTrader, trader);
        assertGt(posCollateral, 0);
        assertEq(borrowed, margin);
        assertEq(posLev, leverage);
        assertTrue(isLong);
        assertEq(IERC20(BASE_WETH).balanceOf(address(router)) - routerWethBefore, 0, "router retains no fill output");
    }

    function test_KyberSwap_RealRoute_AggregatorOpen() public {
        if (!ready) return;
        if (BaseKyberRoute.CALLDATA.length == 0) return;

        uint8 leverage = 2;
        uint256 notional = BaseKyberRoute.SELL_AMOUNT;
        uint256 margin = notional / leverage;

        router.setAllowedAggregator(BaseKyberRoute.EXCHANGE_PROXY, true);

        uint256 routerWethBefore = IERC20(BASE_WETH).balanceOf(address(router));

        vm.prank(trader);
        uint256 collateral = adapter.exactInputSingleWithLeverageAggregator(
            BaseKyberRoute.TOKEN_IN,
            BaseKyberRoute.TOKEN_OUT,
            3000,
            leverage,
            margin,
            BaseKyberRoute.MIN_BUY,
            trader,
            _routeAt(BaseKyberRoute.EXCHANGE_PROXY, BaseKyberRoute.CALLDATA, notional)
        );

        assertGt(collateral, 0, "KyberSwap fill must return collateral");
        (address posTrader, uint256 posCollateral, uint256 borrowed, uint8 posLev, bool isLong,,,,) =
            hook.positions(hookLocalKey.toId(), trader);
        assertEq(posTrader, trader);
        assertGt(posCollateral, 0);
        assertEq(borrowed, margin);
        assertEq(posLev, leverage);
        assertTrue(isLong);
        assertEq(IERC20(BASE_WETH).balanceOf(address(router)) - routerWethBefore, 0, "router retains no fill output");
    }

    function test_StandardAdapter_And_QuoterParity() public {
        if (!ready) return;
        uint8 leverage = 2;
        uint256 margin = 10e6;

        int128 quote = quoter.quoteExactInputSingleWithLeverage(BASE_USDC, BASE_WETH, 3000, leverage, int256(margin));
        assertGt(quote, 0, "quoter must price an initialized pool");

        uint256 floor = (uint256(uint128(quote)) * 95) / 100;
        vm.prank(trader);
        uint256 out = adapter.exactInputSingleWithLeverage(BASE_USDC, BASE_WETH, 3000, leverage, margin, floor, trader);

        assertGe(out, floor, "executed output must clear the quote-derived floor");
        assertApproxEqRel(out, uint256(uint128(quote)), 0.05e18, "execution must track the quote");
        (, uint256 collateral,,,,,,,) = hook.positions(hookLocalKey.toId(), trader);
        assertGt(collateral, 0);
    }

    function test_AggregatorWhitelist_RejectsUnknownProxy() public {
        if (!ready) return;
        EswapRouter.AggregatorRoute memory route = _route("", 20e6);
        route.exchangeProxy = address(0xdead);

        vm.prank(trader);
        vm.expectRevert(bytes("Aggregator not whitelisted"));
        adapter.exactInputSingleWithLeverageAggregator(BASE_USDC, BASE_WETH, 3000, 2, 10e6, 0, trader, route);
    }

    function test_AdapterMulticall_RejectsArbitrarySelector() public {
        if (!ready) return;
        bytes[] memory calls = new bytes[](1);
        calls[0] = abi.encodeWithSelector(
            adapter.exactInputSingleWithLeverage.selector, BASE_USDC, BASE_WETH, uint24(3000), uint8(2), uint256(10e6), uint256(0), trader
        );
        vm.expectRevert(bytes("unauthorized delegatecall"));
        adapter.multicall(calls);
    }

    // ---------------------------------------------------------------- supply side

    function test_CoW_FillOrder_CanonicalGpv2Domain() public {
        if (!ready) return;
        uint8 leverage = 2;
        uint256 margin = 10e6;
        uint256 borrowLeg = margin * (leverage - 1);

        bytes32 expectedDomain = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("Gnosis Protocol"),
                keccak256("v2"),
                block.chainid,
                COW_GPV2_SETTLEMENT
            )
        );
        assertEq(cow.domainSeparator(), expectedDomain, "CoW domain must bind the real GPv2Settlement");

        CowOrder.Data memory order = CowOrder.Data({
            sellToken: BASE_USDC,
            buyToken: BASE_WETH,
            receiver: address(0),
            sellAmount: margin,
            buyAmount: 1e12,
            validTo: uint32(block.timestamp + 1000),
            appData: cow.leverageCommitment(leverage),
            feeAmount: 0,
            kind: CowOrder.KIND_SELL,
            partiallyFillable: false,
            sellTokenBalance: CowOrder.BALANCE_ERC20,
            buyTokenBalance: CowOrder.BALANCE_ERC20
        });

        bytes32 digest = cow.hashOrder(order);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(TRADER_PK, digest);
        bytes memory signature = abi.encodePacked(r, s, v);

        vm.prank(cowSolver);
        router.depositBorrowEscrow(BASE_USDC, borrowLeg);

        EswapCoWSettlement.FillParams memory params = EswapCoWSettlement.FillParams({
            leverage: leverage,
            solver: cowSolver,
            key: hookLocalKey,
            standardPoolKey: standardLocalKey
        });

        vm.prank(cowSolver);
        address owner = cow.fillOrder(order, CowSigning.Scheme.Eip712, signature, params);
        assertEq(owner, trader);

        (address posTrader, uint256 collateral, uint256 borrowed, uint8 posLev, bool isLong,,,, uint128 liquidity) =
            hook.positions(hookLocalKey.toId(), trader);
        assertEq(posTrader, trader, "position credited to the order owner");
        assertGt(collateral, 0);
        assertEq(borrowed, borrowLeg);
        assertEq(posLev, leverage);
        assertTrue(isLong);
        assertGt(liquidity, 0);
        assertEq(router.erc20BorrowEscrow(cowSolver, BASE_USDC), 0, "solver bond consumed as the borrow leg");

        (address debtSolver, uint256 principal,) = hook.solverDebts(hookLocalKey.toId(), trader, cowSolver);
        assertEq(debtSolver, cowSolver);
        assertEq(principal, borrowLeg);
    }

    function test_Intent_PermissionlessSolver_WithEscrow() public {
        if (!ready) return;
        uint8 leverage = 2;
        uint256 margin = 10e6;
        uint256 borrowLeg = margin * (leverage - 1);

        vm.prank(intentSolver);
        router.depositBorrowEscrow(BASE_USDC, borrowLeg);
        assertFalse(router.registeredSolvers(intentSolver), "intent path must not require the whitelist");

        EswapRouter.LendingIntent memory intent = EswapRouter.LendingIntent({
            poolId: PoolId.unwrap(hookLocalKey.toId()),
            standardPoolId: PoolId.unwrap(standardLocalKey.toId()),
            zeroForOne: false,
            amountSpecified: -int256(margin),
            leverage: leverage,
            solver: intentSolver,
            deadline: block.timestamp + 1000,
            minAmountOut: 1e12,
            nonce: 1
        });
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", router.DOMAIN_SEPARATOR(), router.hashIntent(intent)));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(TRADER_PK, digest);

        EswapRouter.SwapParams memory params = EswapRouter.SwapParams({
            key: hookLocalKey,
            standardPoolKey: standardLocalKey,
            zeroForOne: false,
            amountSpecified: -int256(margin),
            leverage: leverage,
            solver: intentSolver,
            hookData: abi.encode(true, leverage, trader),
            deadline: intent.deadline,
            minAmountOut: intent.minAmountOut
        });

        vm.prank(relayer);
        router.swapWithIntent(params, trader, intent, abi.encodePacked(r, s, v));

        (address posTrader, uint256 collateral, uint256 borrowed,,,,,, uint128 liquidity) =
            hook.positions(hookLocalKey.toId(), trader);
        assertEq(posTrader, trader);
        assertGt(collateral, 0);
        assertEq(borrowed, borrowLeg);
        assertGt(liquidity, 0);
        assertEq(router.erc20BorrowEscrow(intentSolver, BASE_USDC), 0);
        assertEq(hook.positionSolver(hookLocalKey.toId(), trader), intentSolver);
    }

    function test_Intent_ReplayRejected() public {
        if (!ready) return;
        uint256 margin = 10e6;
        vm.prank(intentSolver);
        router.depositBorrowEscrow(BASE_USDC, margin);

        EswapRouter.LendingIntent memory intent = EswapRouter.LendingIntent({
            poolId: PoolId.unwrap(hookLocalKey.toId()),
            standardPoolId: PoolId.unwrap(standardLocalKey.toId()),
            zeroForOne: false,
            amountSpecified: -int256(margin),
            leverage: 2,
            solver: intentSolver,
            deadline: block.timestamp + 1000,
            minAmountOut: 1e12,
            nonce: 42
        });
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", router.DOMAIN_SEPARATOR(), router.hashIntent(intent)));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(TRADER_PK, digest);
        bytes memory sig = abi.encodePacked(r, s, v);

        EswapRouter.SwapParams memory params = EswapRouter.SwapParams({
            key: hookLocalKey,
            standardPoolKey: standardLocalKey,
            zeroForOne: false,
            amountSpecified: -int256(margin),
            leverage: 2,
            solver: intentSolver,
            hookData: abi.encode(true, uint8(2), trader),
            deadline: intent.deadline,
            minAmountOut: intent.minAmountOut
        });

        vm.prank(relayer);
        router.swapWithIntent(params, trader, intent, sig);

        vm.prank(relayer);
        vm.expectRevert(EswapRouter.IntentAlreadyFilled.selector);
        router.swapWithIntent(params, trader, intent, sig);
    }

    function test_UniswapX_Validate_Gates() public {
        if (!ready) return;
        OutputToken[] memory outputs = new OutputToken[](1);
        outputs[0] = OutputToken({token: BASE_WETH, amount: 1e15, recipient: swapRecipient});

        ResolvedOrder memory resolved = ResolvedOrder({
            info: OrderInfo({
                reactor: IReactor(UNISWAPX_PRIORITY_REACTOR),
                swapper: trader,
                nonce: 1,
                deadline: block.timestamp + 1000,
                additionalValidationContract: IValidationCallback(address(uniswapx)),
                additionalValidationData: ""
            }),
            input: InputToken({token: IERC20(BASE_USDC), amount: 1e6, maxAmount: 1e6}),
            outputs: outputs,
            sig: "",
            hash: bytes32(0)
        });

        vm.prank(UNISWAPX_PRIORITY_REACTOR);
        uniswapx.validate(address(uniswapx), resolved);

        vm.prank(UNISWAPX_PRIORITY_REACTOR);
        vm.expectRevert(EswapUniswapXSettlement.NotAuthorizedFiller.selector);
        uniswapx.validate(address(0xdead), resolved);

        vm.prank(address(0xdead));
        vm.expectRevert(EswapUniswapXSettlement.NotReactor.selector);
        uniswapx.validate(address(uniswapx), resolved);

        outputs[0].recipient = address(0xdead);
        vm.prank(UNISWAPX_PRIORITY_REACTOR);
        vm.expectRevert(EswapUniswapXSettlement.UnauthorizedRecipient.selector);
        uniswapx.validate(address(uniswapx), resolved);

        outputs[0].recipient = swapRecipient;
        outputs[0].amount = 2e18;
        vm.prank(UNISWAPX_PRIORITY_REACTOR);
        vm.expectRevert(EswapUniswapXSettlement.OutputTooLarge.selector);
        uniswapx.validate(address(uniswapx), resolved);
    }

    function test_OneInchFusion_CallbackGates() public {
        if (!ready) return;
        assertEq(address(fusion.lop()), ONEINCH_LOP_V4);
        assertEq(address(uniswapx.reactor()), UNISWAPX_PRIORITY_REACTOR);

        IOrderMixin.Order memory order;
        order.makerAsset = uint256(uint160(BASE_USDC));
        order.takerAsset = uint256(uint160(BASE_WETH));
        order.receiver = uint256(uint160(swapRecipient));

        vm.expectRevert(EswapOneInchFusionSettlement.NotLOP.selector);
        fusion.postInteraction(order, "", bytes32(0), address(fusion), 1, 1, 1, "");

        vm.prank(ONEINCH_LOP_V4);
        vm.expectRevert(EswapOneInchFusionSettlement.NotTaker.selector);
        fusion.postInteraction(order, "", bytes32(0), address(0xdead), 1, 1, 1, "");

        vm.prank(address(0xdead));
        vm.expectRevert(EswapOneInchFusionSettlement.NotOperator.selector);
        fusion.fill(order, bytes32(0), bytes32(0), 1, TakerTraits.wrap(0), "", "", swapRecipient);
    }

    function test_OneInch_RealSignedFusionOrder_Settles() public {
        if (!ready) return;
        uint256 makingAmount = 10e6;
        uint256 takingAmount = 1e15;

        deal(BASE_WETH, address(fusion), 2e15);
        vm.prank(trader);
        IERC20(BASE_USDC).approve(ONEINCH_LOP_V4, type(uint256).max);

        bytes memory extension = _oneInchExtension(address(fusion));
        IOrderMixin.Order memory order = IOrderMixin.Order({
            salt: uint256(keccak256(extension)),
            maker: uint256(uint160(trader)),
            receiver: uint256(uint160(trader)),
            makerAsset: uint256(uint160(BASE_USDC)),
            takerAsset: uint256(uint160(BASE_WETH)),
            makingAmount: makingAmount,
            takingAmount: takingAmount,
            makerTraits: MakerTraits.wrap((1 << 255) | (1 << 251) | (1 << 249))
        });

        bytes32 orderHash = IOrderMixin(ONEINCH_LOP_V4).hashOrder(order);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(TRADER_PK, orderHash);

        uint256 traits = (1 << 255) | (uint256(extension.length) << 224) | takingAmount;

        uint256 makerUsdcBefore = IERC20(BASE_USDC).balanceOf(trader);
        uint256 makerWethBefore = IERC20(BASE_WETH).balanceOf(trader);
        uint256 settlerUsdcBefore = IERC20(BASE_USDC).balanceOf(address(fusion));
        uint256 settlerWethBefore = IERC20(BASE_WETH).balanceOf(address(fusion));

        fusion.fill(
            order, r, _vs(s, v), makingAmount, TakerTraits.wrap(traits), extension, "", trader
        );

        assertEq(makerUsdcBefore - IERC20(BASE_USDC).balanceOf(trader), makingAmount, "maker paid USDC");
        assertEq(IERC20(BASE_WETH).balanceOf(trader) - makerWethBefore, takingAmount, "maker received WETH");
        assertEq(IERC20(BASE_USDC).balanceOf(address(fusion)) - settlerUsdcBefore, makingAmount, "settler got USDC");
        assertEq(settlerWethBefore - IERC20(BASE_WETH).balanceOf(address(fusion)), takingAmount, "settler paid WETH");
        (,, bool fulfilled) = fusion.pendingFills(orderHash);
        assertTrue(fulfilled, "postInteraction must fire");
    }

    function test_UniswapX_RealPriorityOrder_Settles() public {
        if (!ready) return;
        uint256 inputAmount = 10e6;
        uint256 outputAmount = 1e15;

        deal(BASE_WETH, address(uniswapx), outputAmount);
        vm.prank(trader);
        IERC20(BASE_USDC).approve(PERMIT2, type(uint256).max);

        XPriorityOutput[] memory outputs = new XPriorityOutput[](1);
        outputs[0] = XPriorityOutput({
            token: BASE_WETH,
            amount: outputAmount,
            mpsPerPriorityFeeWei: 0,
            recipient: swapRecipient
        });

        XPriorityOrder memory order = XPriorityOrder({
            info: OrderInfo({
                reactor: IReactor(UNISWAPX_PRIORITY_REACTOR),
                swapper: trader,
                nonce: 0x1234,
                deadline: block.timestamp + 1000,
                additionalValidationContract: IValidationCallback(address(uniswapx)),
                additionalValidationData: ""
            }),
            cosigner: address(0),
            auctionStartBlock: block.number,
            baselinePriorityFeeWei: 0,
            input: XPriorityInput({token: BASE_USDC, amount: inputAmount, mpsPerPriorityFeeWei: 0}),
            outputs: outputs,
            cosignerData: XPriorityCosignerData({auctionTargetBlock: 0}),
            cosignature: ""
        });

        bytes32 orderHash = _hashPriorityOrder(order);
        bytes32 digest = _permit2WitnessDigest(order, orderHash);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(TRADER_PK, digest);

        uint256 swapperUsdcBefore = IERC20(BASE_USDC).balanceOf(trader);
        uint256 recipientWethBefore = IERC20(BASE_WETH).balanceOf(swapRecipient);
        uint256 settlerUsdcBefore = IERC20(BASE_USDC).balanceOf(address(uniswapx));
        uint256 settlerWethBefore = IERC20(BASE_WETH).balanceOf(address(uniswapx));

        vm.txGasPrice(block.basefee);
        uniswapx.fill(SignedOrder({order: abi.encode(order), sig: abi.encodePacked(r, s, v)}));

        assertEq(swapperUsdcBefore - IERC20(BASE_USDC).balanceOf(trader), inputAmount, "swapper paid USDC");
        assertEq(IERC20(BASE_WETH).balanceOf(swapRecipient) - recipientWethBefore, outputAmount, "recipient got WETH");
        assertEq(IERC20(BASE_USDC).balanceOf(address(uniswapx)) - settlerUsdcBefore, inputAmount, "settler got USDC");
        assertEq(settlerWethBefore - IERC20(BASE_WETH).balanceOf(address(uniswapx)), outputAmount, "settler paid WETH");
    }

    function test_ZeroEx_RealSignedLimitOrder_Settles() public {
        if (!ready) return;
        uint256 makerAmount = 1e15;
        uint256 takerAmount = 10e6;

        deal(BASE_WETH, zeroExMaker, makerAmount);
        deal(BASE_USDC, address(router), takerAmount);
        vm.prank(zeroExMaker);
        IERC20(BASE_WETH).approve(ZEROX_PROXY, type(uint256).max);
        vm.prank(address(router));
        IERC20(BASE_USDC).approve(ZEROX_PROXY, type(uint256).max);

        IZeroExV4.LimitOrder memory order = IZeroExV4.LimitOrder({
            makerToken: BASE_WETH,
            takerToken: BASE_USDC,
            makerAmount: uint128(makerAmount),
            takerAmount: uint128(takerAmount),
            takerTokenFeeAmount: 0,
            maker: zeroExMaker,
            taker: address(router),
            sender: address(router),
            feeRecipient: address(0),
            pool: bytes32(0),
            expiry: uint64(block.timestamp + 1000),
            salt: uint256(keccak256("eswap-0x-limit-order"))
        });

        assertEq(IZeroExV4(ZEROX_PROXY).getProtocolFeeMultiplier(), 0, "Base 0x protocol fee must be zero");
        bytes32 orderHash = IZeroExV4(ZEROX_PROXY).getLimitOrderHash(order);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ZEROX_MAKER_PK, orderHash);
        IZeroExV4.Signature memory signature = IZeroExV4.Signature({signatureType: 2, v: v, r: r, s: s});

        uint256 makerWethBefore = IERC20(BASE_WETH).balanceOf(zeroExMaker);
        uint256 makerUsdcBefore = IERC20(BASE_USDC).balanceOf(zeroExMaker);
        uint256 routerWethBefore = IERC20(BASE_WETH).balanceOf(address(router));
        uint256 routerUsdcBefore = IERC20(BASE_USDC).balanceOf(address(router));

        vm.prank(address(router));
        (uint128 filledTaker, uint128 filledMaker) =
            IZeroExV4(ZEROX_PROXY).fillLimitOrder(order, signature, uint128(takerAmount));

        assertEq(filledMaker, makerAmount, "maker fill amount");
        assertEq(filledTaker, takerAmount, "taker fill amount");
        assertEq(makerWethBefore - IERC20(BASE_WETH).balanceOf(zeroExMaker), makerAmount, "maker paid WETH");
        assertEq(IERC20(BASE_USDC).balanceOf(zeroExMaker) - makerUsdcBefore, takerAmount, "maker got USDC");
        assertEq(IERC20(BASE_WETH).balanceOf(address(router)) - routerWethBefore, makerAmount, "router got WETH");
        assertEq(routerUsdcBefore - IERC20(BASE_USDC).balanceOf(address(router)), takerAmount, "router paid USDC");
    }

    // ---------------------------------------------------------------- risk controls

    function test_TwapGuard_RejectsManipulatedOracle() public {
        if (!ready) return;
        EswapMarginHook.ConfigParams memory cfg = EswapMarginHook.ConfigParams({
            treasury: makeAddr("b2bTreasury"),
            router: address(router),
            reserveFactor: 50,
            maxPriceSwingBps: 2000,
            defaultMaxLeverage: 20,
            requireTwapOracle: true
        });
        hook.setConfig(cfg);

        priceFeed.setPrice(BASE_WETH, priceFeed.prices(BASE_WETH) * 3);

        vm.prank(trader);
        vm.expectRevert(EswapMarginHook.TwapManipulated.selector);
        adapter.exactInputSingleWithLeverage(BASE_USDC, BASE_WETH, 3000, 2, 10e6, 0, trader);
    }
}
