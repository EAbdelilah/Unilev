// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IPoolManager} from "./interfaces/IPoolManager.sol";
import {PoolKey} from "./types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "./types/PoolId.sol";
import {Currency} from "./types/Currency.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {BalanceDelta, BalanceDeltaLibrary} from "./types/BalanceDelta.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {IPoolManager as RealIPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolId as RealPoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {EswapMarginLib} from "./EswapMarginLib.sol";
import {NativeTokens} from "./libraries/NativeTokens.sol";
import {EswapRouter} from "./EswapRouter.sol";

interface IEswapHookExt {
    function clearJITDelta(Currency token, address to, uint256 amount) external;
}

// [P0#2] Narrowest oracle surface used to compute the live pool market price
// (Chainlink-anchored 18-decimal exchange rate) for trigger comparisons. Points
// at the same PriceFeed contract the hook uses, so trigger evaluation and
// liquidation health share one oracle source.
interface IPriceFeedForTrigger {
    function getAmountInUsd(address token, uint256 amount) external view returns (uint256);
}

// [P0#2] Hook reads needed by the permissionless trigger-order executor:
// position existence (to distinguish "no position" from "healthy") and live
// liquidation state (liquidations always win over trigger closes).
interface IEswapTriggerHookRead {
    function positions(bytes32 poolId, address trader)
        external
        view
        returns (
            address trader_,
            uint256 collateralAmount,
            uint256 borrowedAmount,
            uint8 leverage,
            bool isLong,
            uint160 liquidationSqrtPrice,
            int24 tickLower,
            int24 tickUpper,
            uint128 liquidity
        );
    function isPositionLiquidatable(PoolKey calldata key, address trader) external view returns (bool);
}

/**
 * @title EswapRouterExt
 * @notice Companion to [EswapRouter] for the OFF-CORE execution surfaces that
 *         pushed the router past EIP-170 (24,576-byte contract code limit):
 *
 *           - [P0#2] Signed limit / stop-loss `TriggerOrder`s (arm / execute /
 *                    cancel). Execution re-enters PoolManager for a permissionless
 *                    CLOSE of the trader's position — handled by THIS contract's
 *                    own `unlockCallback`, not the router's.
 *           - [M-2]  ERC-7683 `CrossChainOrder` Initiation Gateway (initiate /
 *                    resolve / hashOrder). Fills forward the multi-pool open to
 *                    the CORE router via `EswapRouter.swapMultiPoolFor`, so the
 *                    unlock/callback/heap still live in one place.
 *           - [H-4/H-5] JIT spot swaps (executeJITSpotSwap / _jitSpotCallback).
 *           - Atomic margin trades (atomicMarginTrade / _atomicMarginCallback).
 *
 * @dev EIP-712 DOMAIN_SEPARATOR is pinned to the CANONICAL `EswapRouter`
 *      address (passed in the constructor), so off-chain signers keep signing
 *      against the router that front-ends the v4 pools — the ext is a
 *      permissionless relay/execution contract and never changes the signed
 *      order surface. The `manager.unlock(...)` flows below are the ONLY ones
 *      this contract initiates; PoolManager therefore calls back into
 *      `unlockCallback` of THIS contract (msg.sender == manager).
 */
contract EswapRouterExt is Ownable2Step {
    using PoolIdLibrary for PoolKey;
    using SafeERC20 for IERC20;
    using BalanceDeltaLibrary for BalanceDelta;

    /// @dev Required to receive native ETH from PoolManager during take() on
    ///      native-output positions (mirrors EswapRouter).
    receive() external payable {}

    IPoolManager public immutable manager;
    /// @dev The core router (single-pool + multi-pool + aggregator execution).
    ///      `initiate` forwards its fill here; also the EIP-712 verifying
    ///      contract all signatures are bound to.
    EswapRouter public immutable router;

    // ─── Domain ─────────────────────────────────────────────────────────────

    /// @dev EIP-712 domain pinned to the router, keeping the canonical signing
    ///      surface (name/version/verifyingContract) identical to the previous
    ///      single-contract deployment.
    bytes32 public immutable DOMAIN_SEPARATOR;

    enum CallType {
        CLOSE,
        ATOMIC_MARGIN,
        JIT_SPOT
    }

    // M-2: ERC-7683 nonce consumption
    mapping(bytes32 => bool) public filledOrders;

    // H-4: JIT swapper opt-in — swappers must approve JIT spot swaps
    mapping(address => bool) public jitApprovedSwappers;

    // [AUDIT HIGH-2] JIT fill-price floor. `JITSpotParams.minSolverOutput` is
    // useless as a guard: `executeJITSpotSwap` forces the caller to be the
    // swapper, and the swapper supplies BOTH `solverOutput` and
    // `minSolverOutput`, so that require could never fail. Worse, the RFQ price
    // is entirely swapper-chosen, so an approved swapper could force a passive
    // whitelisted solver to dump inventory at any rate. The floor below is the
    // only trustless bound: the RFQ may not pay materially less than the
    // Chainlink-implied rate for the same input, up to this leniency.
    // 0 = oracle floor DISABLED (owner must opt in per deployment).
    uint256 public jitOracleFloorLeniencyBps;

    event JitOracleFloorLeniencyBpsSet(uint256 bps);

    error JitFillBelowOracleFloor(uint256 solverOutput, uint256 oracleMinOutput);
    error JitOraclePriceUnavailable();
    error JitNativeCurrencyUnsupported();
    error NativeInsufficient();

    function setJitOracleFloorLeniencyBps(uint256 bps) external onlyOwner {
        if (bps > 1000) revert BpsTooHigh();
        jitOracleFloorLeniencyBps = bps;
        emit JitOracleFloorLeniencyBpsSet(bps);
    }

    /// @dev Oracle-implied minimum acceptable RFQ output for `inputAmount` of
    ///      `input`, i.e. the same input priced through the Chainlink feed,
    ///      scaled DOWN by the owner-configured leniency. Returns 0 when the
    ///      floor is disabled (leniency sentinel 0 is ambiguous with a real
    ///      zero, so callers gate on the explicit `oracleFloorEnabled` read).
    function _jitOracleMinOutput(
        Currency input,
        Currency output,
        uint256 inputAmount
    ) internal view returns (uint256 minOutput) {
        if (address(triggerPriceFeed) == address(0)) return 0;

        address inToken = Currency.unwrap(input);
        address outToken = Currency.unwrap(output);
        uint256 priceIn = triggerPriceFeed.getAmountInUsd(inToken, 10 ** _tokenDecimals(inToken));
        uint256 priceOut = triggerPriceFeed.getAmountInUsd(outToken, 10 ** _tokenDecimals(outToken));
        if (priceIn == 0 || priceOut == 0) revert JitOraclePriceUnavailable();

        uint256 leniency = jitOracleFloorLeniencyBps;
        if (leniency == 0) return 0;

        uint256 inputUsd = triggerPriceFeed.getAmountInUsd(inToken, inputAmount);
        minOutput = FullMath.mulDiv(inputUsd, 10 ** _tokenDecimals(outToken), priceOut);
        minOutput = FullMath.mulDiv(minOutput, 10000 - leniency, 10000);
    }

    // ─── [P0#2] Signed limit / stop-loss TriggerOrder ────────────────────────

    /// @dev A trader-signed conditional close. The executor (anyone) waits until
    ///      the pool's market price crosses `triggerPrice18` (an 18-decimal
    ///      exchange rate, `USD(token0 per whole unit) / USD(token1 per whole unit)`)
    ///      in the direction `aboveOrBelow`, then permissionlessly closes the
    ///      trader's position with the signed `minAmountOut` floor. The signature
    ///      pins the exact pool, price, direction, payout floor, nonce and expiry,
    ///      so neither the executed price nor the payout can deviate from what the
    ///      trader authored. `executorTipBps` caps the off-chain executor tip
    ///      (0-1000 = 0-10% of surplus); on-chain enforcement of the split is left
    ///      to a follow-up so this first cut cannot perturb the close settlement.
    struct TriggerOrder {
        bytes32 poolId;
        uint256 triggerPrice18;
        bool aboveOrBelow;
        uint256 minAmountOut;
        uint256 closeDeadline;
        uint256 nonce;
        uint8 executorTipBps;
    }

    bytes32 public constant TRIGGER_ORDER_TYPEHASH = keccak256(
        "TriggerOrder(bytes32 poolId,uint256 triggerPrice18,bool aboveOrBelow,uint256 minAmountOut,uint256 closeDeadline,uint256 nonce,uint8 executorTipBps)"
    );

    /// @dev Oracle source for the live market price. Points at the SAME Chainlink
    ///      PriceFeed the hook uses so trigger evaluation and liquidation health
    ///      never read from different oracles. Owner-set; 0 = trigger orders
    ///      disabled (executeTriggerOrder reverts TriggerPriceFeedNotSet).
    IPriceFeedForTrigger public triggerPriceFeed;

    /// @dev One armed order per (trader, pool) — a trader arms at most one
    ///      conditional close per pool at a time; re-arming overwrites.
    mapping(address => mapping(bytes32 => TriggerOrder)) public armedTriggerOrders;

    /// @dev Consumed (trader, poolId, nonce) keys: an executed trigger order can
    ///      never be replayed, even if the trader re-arms a different order.
    mapping(bytes32 => bool) public executedTriggerOrders;

    // [P0#2] Trigger-order errors.
    error TriggerPriceFeedNotSet();
    error NoArmedTriggerOrder();
    error TriggerOrderAlreadyExecuted();
    error TriggerOrderExpired();
    error TriggerNotHit();
    error PositionLiquidatable();
    error InvalidTriggerOrderSignature();
    error TriggerOrderPoolMismatch();
    error NoActivePosition();
error TriggerPriceUnavailable();
error NativePayoutFailed();
    error NotOwner();
    error BpsTooHigh();

    event TriggerPriceFeedSet(address indexed feed);
    event TriggerOrderArmed(
        address indexed trader, bytes32 indexed poolId, uint256 triggerPrice18, bool aboveOrBelow, uint256 nonce
    );
    event TriggerOrderExecuted(address indexed trader, bytes32 indexed poolId, uint256 nonce, address executor);
    event TriggerOrderCancelled(address indexed trader, bytes32 indexed poolId);

    // ─── ERC-7683 types ──────────────────────────────────────────────────────

    struct CrossChainOrder {
        address settlementContract;
        address swapper;
        uint256 nonce;
        uint32 originChainId;
        uint32 initiateDeadline;
        uint32 fillDeadline;
        bytes orderData;
    }

    struct Input {
        address token;
        uint256 amount;
    }

    struct Output {
        address token;
        uint256 amount;
        uint32 chainId;
        address recipient;
    }

    struct ResolvedCrossChainOrder {
        address settlementContract;
        address swapper;
        uint256 nonce;
        uint32 originChainId;
        uint32 initiateDeadline;
        uint32 fillDeadline;
        Input[] swapperInputs;
        Output[] swapperOutputs;
    }

    bytes32 public constant CROSS_CHAIN_ORDER_TYPEHASH = keccak256(
        "CrossChainOrder(address settlementContract,address swapper,uint256 nonce,uint32 originChainId,uint32 initiateDeadline,uint32 fillDeadline,bytes orderData)"
    );

    // ─── JIT / atomic types ──────────────────────────────────────────────────

    struct AtomicMarginParams {
        PoolKey key;
        PoolKey standardPoolKey;
        bool zeroForOne;
        uint256 borrowAmount;
        uint256 minProfit;
    }

    struct JITSpotParams {
        PoolKey key;
        bool zeroForOne;
        int256 amountSpecified;
        address solver;
        uint256 solverOutput;
        // [FIX H-5] Minimum acceptable solver output for slippage protection against malicious solvers
        uint256 minSolverOutput;
        address swapper;
    }

    constructor(IPoolManager _manager, address _domainRouter) Ownable(msg.sender) {
        manager = _manager;
        router = EswapRouter(payable(_domainRouter));
        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes("EswapRouter")),
                keccak256(bytes("1")),
                block.chainid,
                _domainRouter
            )
        );
    }

    // ─── [P0#2] Signed limit / stop-loss TriggerOrder ────────────────────────

    /// @notice Points the trigger-oracle surface at the Chainlink PriceFeed the
    ///         hook already uses. Owner-only; disabling (address(0)) turns
    ///         trigger orders off until a feed is re-set.
    function setTriggerPriceFeed(IPriceFeedForTrigger _priceFeed) external onlyOwner {
        triggerPriceFeed = _priceFeed;
        emit TriggerPriceFeedSet(address(_priceFeed));
    }

    /// @notice [P0#2] EIP-712 hash of a signed `TriggerOrder`.
    function hashTriggerOrder(TriggerOrder calldata order) public pure returns (bytes32) {
        return keccak256(
            abi.encode(
                TRIGGER_ORDER_TYPEHASH,
                order.poolId,
                order.triggerPrice18,
                order.aboveOrBelow,
                order.minAmountOut,
                order.closeDeadline,
                order.nonce,
                order.executorTipBps
            )
        );
    }

    /// @notice [P0#2] The trader arms a conditional close by proving ownership of
    ///         the EIP-712 signature over the `TriggerOrder`. One order per
    ///         (trader, pool); re-arming overwrites the previous one.
    function armTriggerOrder(PoolKey calldata key, TriggerOrder calldata order, bytes calldata signature) external {
        if (PoolId.unwrap(key.toId()) != order.poolId) revert TriggerOrderPoolMismatch();
        if (block.timestamp > order.closeDeadline) revert TriggerOrderExpired();

        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, hashTriggerOrder(order)));
        if (!_isValidSignature(msg.sender, digest, signature)) revert InvalidTriggerOrderSignature();

        armedTriggerOrders[msg.sender][order.poolId] = order;
        emit TriggerOrderArmed(msg.sender, order.poolId, order.triggerPrice18, order.aboveOrBelow, order.nonce);
    }

    /// @notice [P0#2] PERMISSIONLESS conditional close: any keeper may call this
    ///         once the pool's market price crosses the armed `TriggerOrder`.
    ///         Guards, in order:
    ///          1. An armed order exists, is not expired, and is not replayable.
    ///          2. The position exists. NOTE [AUDIT HIGH-02]: a liquidatable
    ///             position does NOT block execution — the trigger is the
    ///             trader's own signed exit and still enforces their
    ///             `minAmountOut` floor, so it beats being forcibly liquidated.
    ///          3. The live market price crossed the signed trigger in the signed
    ///             direction (`aboveOrBelow=true → market >= trigger`, else
    ///             `market < trigger`).
    ///         If all pass, the close is executed exactly as the trader signed it
    ///         (same unlock path as a manual close, same hook settlement), the
    ///         nonce is consumed and the armed order is cleared.
    function executeTriggerOrder(address hook, PoolKey calldata key, address trader) external {
        bytes32 poolId = PoolId.unwrap(key.toId());
        // Snapshot the armed order into memory: clearing the storage slot below
        // must not zero the fields we still emit and enforce afterwards.
        TriggerOrder memory order = armedTriggerOrders[trader][poolId];
        if (order.closeDeadline == 0) revert NoArmedTriggerOrder();
        if (block.timestamp > order.closeDeadline) revert TriggerOrderExpired();

        bytes32 executionId = keccak256(abi.encode(trader, order.poolId, order.nonce));
        if (executedTriggerOrders[executionId]) revert TriggerOrderAlreadyExecuted();

        if (address(triggerPriceFeed) == address(0)) revert TriggerPriceFeedNotSet();

        // The position must exist.
        (, uint256 collateral,,,,,,,) = IEswapTriggerHookRead(hook).positions(PoolId.unwrap(key.toId()), trader);
        if (collateral == 0) revert NoActivePosition();
        // [AUDIT HIGH-02] Do NOT gate on isPositionLiquidatable. A stop-loss is
        // armed precisely to protect the trader as the market crosses under the
        // maintenance threshold; reverting in exactly that window hands the
        // trader to a liquidator (fee + seizure) despite their signed protection.
        // Execution still honors the trader's signed minAmountOut — the hook
        // enforces the payout floor and a keeper can never force a bad fill —
        // so the close simply happens on the trader's terms instead.

        // The live market price must have crossed the signed trigger.
        uint256 marketPrice18 = _computeMarketPrice18(key);
        bool hit = order.aboveOrBelow ? marketPrice18 >= order.triggerPrice18 : marketPrice18 < order.triggerPrice18;
        if (!hit) revert TriggerNotHit();

        // Consume the nonce and clear the armed slot before the close; both only
        // persist if the close succeeds (a revert rolls the whole tx back, so on
        // a failed close the order stays armed and replayable).
        executedTriggerOrders[executionId] = true;
        delete armedTriggerOrders[trader][poolId];

        emit TriggerOrderExecuted(trader, order.poolId, order.nonce, msg.sender);

        // The hook ignores the `solver` argument (it repays `positionSolver`),
        // so pass a zero address — the signed payout floor is what matters.
        router.extTriggerClose(hook, key, trader, order.minAmountOut);
    }

    /// @notice [P0#2] Trader (or governance) disarms a conditional close.
    function cancelTriggerOrder(address trader, PoolKey calldata key) external {
        bytes32 poolId = PoolId.unwrap(key.toId());
        if (msg.sender != trader && msg.sender != owner()) revert NotOwner();
        if (armedTriggerOrders[trader][poolId].closeDeadline == 0) revert NoArmedTriggerOrder();
        delete armedTriggerOrders[trader][poolId];
        emit TriggerOrderCancelled(trader, poolId);
    }

    /// @dev [P0#2] Live pool market price as an 18-decimal exchange rate:
    ///      USD worth of ONE WHOLE token0 divided by USD worth of ONE WHOLE
    ///      token1 (both via getAmountInUsd(10**decimals), so cross-decimal pairs
    ///      like USDC/WETH price correctly). Same oracle the hook's liquidation
    ///      path reads — trigger evaluation and health share one source.
    ///      Reverts when either leg's feed is missing (0 USD value) so a fake
    ///      "below trigger" can never fire a stop-loss on an unavailable oracle.
    function _computeMarketPrice18(PoolKey calldata key) internal view returns (uint256) {
        address token0 = Currency.unwrap(key.currency0);
        address token1 = Currency.unwrap(key.currency1);
        uint256 price0 = triggerPriceFeed.getAmountInUsd(token0, 10 ** _tokenDecimals(token0));
        uint256 price1 = triggerPriceFeed.getAmountInUsd(token1, 10 ** _tokenDecimals(token1));
        if (price0 == 0 || price1 == 0) revert TriggerPriceUnavailable();
        return FullMath.mulDiv(price0, 1e18, price1);
    }

    function _tokenDecimals(address token) internal view returns (uint8 d) {
        (bool ok, bytes memory ret) = token.staticcall(abi.encodeWithSignature("decimals()"));
        d = (ok && ret.length >= 32) ? uint8(uint256(abi.decode(ret, (uint256)))) : 18;
    }

    // ─── JIT spot ────────────────────────────────────────────────────────────

    /// @notice H-4: JIT swapper opt-in. Owner-only gate; only approved swappers
    ///         may execute a JIT spot swap (which bypasses the AMM for the
    ///         matched input/output).
    function setJitApprovedSwapper(address swapper, bool approved) external onlyOwner {
        jitApprovedSwappers[swapper] = approved;
    }

    /// @dev `payable` so a native-INPUT pair can fund the input leg: the
    ///      swapper's ETH rides in on msg.value, is threaded through the unlock
    ///      payload (the PoolManager calls back with zero value), and is
    ///      forwarded with `settle{value:}`, mirroring `_settleCurrency`. Any
    ///      surplus beyond the input amount is refunded to the swapper. A native
    ///      OUTPUT leg still reverts (the solver would have to supply ETH, which
    ///      `transferFrom` cannot do).
    function executeJITSpotSwap(JITSpotParams calldata params) external payable returns (bytes memory) {
        // [AUDIT HIGH-1] The committed JIT deltas pull `params.swapper`'s input
        // tokens and pay them `solverOutput`. Requiring the CALLER to be the
        // swapper closes the drain: previously ANY address could name an
        // approved swapper plus their own solver and set the solverOutput floor
        // to 0, moving the swapper's funds through a colluding solver at
        // ~zero cost. The counterparty must also be a whitelisted protocol
        // solver so the off-band "solverOutput" leg is provided by a trusted
        // liquidity provider, not an arbitrary attacker address.
        require(msg.sender == params.swapper, "Only swapper can execute JIT");
        require(router.registeredSolvers(params.solver), "JIT solver not whitelisted");
        return manager.unlock(abi.encode(CallType.JIT_SPOT, params, msg.value));
    }

    // ─── Best-route (P2#7, relocated from EswapRouter for EIP-170) ──────────

    error DeadlineExpired();

    /// @notice Best-route competition: open a leveraged position where the
    ///         notional fill routes through whichever venue — the deep standard
    ///         pool OR a whitelisted external aggregator — guarantees the higher
    ///         output. Moved off the core router (which exists to keep EswapRouter
    ///         under EIP-170); venue selection is composed on the ROUTER's public
    ///         entrypoints so the underlying opens stay byte-identical to the
    ///         direct `swapMultiPoolFor` / `swapMultiPoolForAggregator` paths.
    /// @dev Competition rule (identical to the previous in-router logic):
    ///        1. Deterministic standard-pool fill estimate for the notional
    ///           (slot0 price of `params.standardPoolKey`, 0.1% execution
    ///           discount) — see `_quoteStandardFill`.
    ///        2. Standard wins when it meets the trader's floor (or the standard
    ///           venue is unpriceable), mirroring the old `_bestRouteOpen`.
    ///           The aggregator is never executed in that case, so a weak/stale
    ///           aggregator quote can never force a worse fill.
    ///        3. Otherwise the AGGREGATOR venue is chosen and the trader's floor
    ///           — already ABOVE the standard estimate — forces the aggregator
    ///           to genuinely beat the standard pool's output or revert
    ///           (`SwapOutputBelowMinimum`, enforced by the router's fill path).
    ///      Margin is pulled from `trader`, borrow from `params.solver` — mirror
    ///      of `EswapRouter.swapMultiPoolForAggregator`. NOTE: any native-ETH
    ///      excess refund from the underlying open is credited to THIS contract
    ///      (it is the router's caller); the owner should sweep it.
    function swapMultiPoolBestRoute(EswapRouter.SwapParams calldata params, address trader, EswapRouter.AggregatorRoute calldata route)
        external
        payable
        returns (bytes memory)
    {
        require(router.allowedAggregators(route.exchangeProxy), "Aggregator not whitelisted");
        if (block.timestamp > params.deadline) revert DeadlineExpired();

        uint256 marginAmount =
            uint256(int256(params.amountSpecified < 0 ? -params.amountSpecified : params.amountSpecified));
        uint256 borrowAmount = marginAmount * uint256(params.leverage - 1);
        uint256 notional = marginAmount + borrowAmount;

        (uint256 standardOut, bool standardComputable) =
            _quoteStandardFill(params.standardPoolKey, params.zeroForOne, notional);

        if (!standardComputable || standardOut >= params.minAmountOut) {
            return router.swapMultiPoolFor{value: msg.value}(params, trader);
        }
        return router.swapMultiPoolForAggregator{value: msg.value}(params, trader, route);
    }

    /// @dev Deterministic spot-depth estimate of a NOTIONAL-sized fill on the
    ///      given execution pool — the same projection the public
    ///      `EswapRouter.quoteExactInput` quoter uses (slot0 price, 0.1%
    ///      execution discount). Returns `(0, false)` when the pool is
    ///      uninitialized so the caller can fall back to the aggregator venue.
    function _quoteStandardFill(PoolKey memory standardPoolKey, bool zeroForOne, uint256 notional)
        internal
        view
        returns (uint256 output, bool computable)
    {
        (uint160 sqrtPriceX96,,,) = StateLibrary.getSlot0(
            RealIPoolManager(address(manager)), RealPoolId.wrap(PoolId.unwrap(standardPoolKey.toId()))
        );
        if (sqrtPriceX96 == 0) return (0, false);
        if (zeroForOne) {
            // outputUnits = inputUnits * (sqrtPriceX96^2) / 2^192
            output = FullMath.mulDiv(notional, uint256(sqrtPriceX96), 1 << 96);
            output = FullMath.mulDiv(output, uint256(sqrtPriceX96), 1 << 96);
        } else {
            // outputUnits = inputUnits * 2^192 / (sqrtPriceX96^2)
            uint256 temp = FullMath.mulDiv(notional, 1 << 96, uint256(sqrtPriceX96));
            output = FullMath.mulDiv(temp, 1 << 96, uint256(sqrtPriceX96));
        }
        output = (output * 9990) / 10000;
        return (output, true);
    }

    // ─── ERC-7683 ────────────────────────────────────────────────────────────

    function hashOrder(CrossChainOrder calldata order) public pure returns (bytes32) {
        return keccak256(
            abi.encode(
                CROSS_CHAIN_ORDER_TYPEHASH,
                order.settlementContract,
                order.swapper,
                order.nonce,
                order.originChainId,
                order.initiateDeadline,
                order.fillDeadline,
                keccak256(order.orderData)
            )
        );
    }

    /// @dev [AUDIT HIGH-01] Signature verification that (a) rejects ECDSA
    ///      malleability via OpenZeppelin ECDSA (canonical low-s, v∈{27,28},
    ///      padded-v normalization), and (b) supports ERC-1271 contract wallets
    ///      through SignatureChecker. `expectedSigner` is always known at the
    ///      call sites (msg.sender for trigger orders, order.swapper for ERC-7683).
    function _isValidSignature(address expectedSigner, bytes32 digest, bytes calldata signature)
        internal
        view
        returns (bool)
    {
        if (expectedSigner == address(0)) return false;
        // Smart contract wallet: delegate to its ERC-1271 validator.
        if (expectedSigner.code.length > 0) {
            return SignatureChecker.isValidSignatureNow(expectedSigner, digest, signature);
        }
        // EOA: strict ECDSA recovery (low-s canonical form enforced by OZ's
        // tryRecover, which returns address(0) on any malformed/malleable input).
        (address recovered, ECDSA.RecoverError err,) = ECDSA.tryRecover(digest, signature);
        return err == ECDSA.RecoverError.NoError && recovered == expectedSigner;
    }

    /**
     * @notice ERC-7683 Solver Initiation Gateway.
     * Allows permissionless solvers to fill the trader's off-chain signed
     * CrossChainOrder. The fill itself is forwarded to the CORE router's
     * `swapMultiPoolFor` (same MULTI_POOL_SWAP unlock the single-contract
     * deployment used), so position accounting/settlement still runs inside the
     * router's unlock callback.
     */
    function initiate(CrossChainOrder calldata order, bytes calldata signature, bytes calldata) external {
        require(order.settlementContract == address(router), "Invalid settlement contract");
        require(order.originChainId == block.chainid, "Invalid origin chain");
        require(block.timestamp <= order.initiateDeadline, "Initiate deadline passed");

        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, hashOrder(order)));
        require(_isValidSignature(order.swapper, digest, signature) && order.swapper != address(0), "Invalid signature");

        // M-2 FIX: Consume order nonce to prevent replay
        bytes32 orderHash = keccak256(abi.encode(digest));
        require(!filledOrders[orderHash], "Order already filled");
        filledOrders[orderHash] = true;

        (
            PoolKey memory key,
            PoolKey memory standardPoolKey,
            bool zeroForOne,
            int256 amountSpecified,
            uint8 leverage,
            address solver,
            bytes memory hookData,
            uint256 minAmountOut
        ) = abi.decode(order.orderData, (PoolKey, PoolKey, bool, int256, uint8, address, bytes, uint256));

        address activeSolver = solver;
        if (activeSolver == address(0)) {
            activeSolver = msg.sender;
        }

        EswapRouter.SwapParams memory params = EswapRouter.SwapParams({
            key: key,
            standardPoolKey: standardPoolKey,
            zeroForOne: zeroForOne,
            amountSpecified: amountSpecified,
            leverage: leverage,
            solver: activeSolver,
            hookData: hookData,
            deadline: uint256(order.fillDeadline),
            // [FIX H-3] Signed orders carry an explicit output floor appended to
            // orderData; it is enforced inside the swap callback. Zero is only
            // accepted when the signer deliberately omitted/zeroed it.
            minAmountOut: minAmountOut
        });

        // Aggregator intents fill on the DEEP standard pool (multi-pool mode):
        // execution depth comes from Uniswap's existing liquidity. `initiate` is
        // non-payable (native margins flow via swapMultiPool/swapMultiPoolFor),
        // so ETH attached to the unlock is always 0 here. The router's own
        // unlock callback settles the whole fill; refundRecipient (the relayer)
        // is only ever used for non-zero `msg.value`, which this path never sees.
        router.swapMultiPoolFor(params, order.swapper);
    }

    /**
     * @notice ERC-7683 Order Resolution Interface.
     * Decodes the cross-chain order's custom parameters for solvers/aggregators to inspect inputs/outputs.
     */
    function resolve(CrossChainOrder calldata order, bytes calldata)
        external
        view
        returns (ResolvedCrossChainOrder memory resolved)
    {
        (PoolKey memory key,, bool zeroForOne, int256 amountSpecified, uint8 leverage,,) =
            abi.decode(order.orderData, (PoolKey, PoolKey, bool, int256, uint8, address, bytes));

        resolved.settlementContract = order.settlementContract;
        resolved.swapper = order.swapper;
        resolved.nonce = order.nonce;
        resolved.originChainId = order.originChainId;
        resolved.initiateDeadline = order.initiateDeadline;
        resolved.fillDeadline = order.fillDeadline;

        resolved.swapperInputs = new Input[](1);
        address inputToken = zeroForOne ? Currency.unwrap(key.currency0) : Currency.unwrap(key.currency1);
        uint256 marginAmount = uint256(amountSpecified < 0 ? -amountSpecified : amountSpecified);
        resolved.swapperInputs[0] = Input({token: inputToken, amount: marginAmount});

        resolved.swapperOutputs = new Output[](1);
        address outputToken = zeroForOne ? Currency.unwrap(key.currency1) : Currency.unwrap(key.currency0);
        resolved.swapperOutputs[0] = Output({
            token: outputToken, amount: marginAmount * leverage, chainId: order.originChainId, recipient: order.swapper
        });
    }

    // ─── Atomic margin ───────────────────────────────────────────────────────

    function atomicMarginTrade(AtomicMarginParams calldata params) external returns (uint256 profit) {
        bytes memory result = manager.unlock(abi.encode(CallType.ATOMIC_MARGIN, params, msg.sender));
        profit = abi.decode(result, (uint256));
    }

    // ─── PoolManager unlock callback (this contract only) ────────────────────

    /// @notice Executes the unlock flows THIS contract initiates. PoolManager
    ///      calls back with `msg.sender == address(manager)` for the trigger CLOSE
    ///      (hook settlement), the atomic margin double-swap, and the JIT spot
    ///      swap. Everything else operates through the router.
    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        require(msg.sender == address(manager), "Not manager");

        CallType callType = abi.decode(data, (CallType));

        if (callType == CallType.ATOMIC_MARGIN) {
            (, AtomicMarginParams memory params, address trader) =
                abi.decode(data, (CallType, AtomicMarginParams, address));
            return _atomicMarginCallback(params, trader);
        } else if (callType == CallType.JIT_SPOT) {
            (, JITSpotParams memory params, uint256 ethAttached) =
                abi.decode(data, (CallType, JITSpotParams, uint256));
            return _jitSpotCallback(params, ethAttached);
        }
        return "";
    }

    /// @dev [AUDIT MED-01] Native-ETH-aware settle. ERC20 follows the usual
    ///      sync→transfer→settle; native goes sync→settle{value}. The old
    ///      `IERC20(address(0)).safeTransfer` path reverted, making atomic
    ///      margin trades on v4 native pairs impossible (and would silently
    ///      skip settlement if it hadn't).
    function _settleCurrency(Currency currency, uint256 amount) internal {
        manager.sync(currency);
        if (NativeTokens.isNative(currency)) {
            manager.settle{value: amount}();
        } else {
            IERC20(Currency.unwrap(currency)).safeTransfer(address(manager), amount);
            manager.settle();
        }
    }

    /// @dev [AUDIT MED-01] Native-ETH-aware payout to an arbitrary recipient.
    function _payCurrency(Currency currency, address to, uint256 amount) internal {
        if (NativeTokens.isNative(currency)) {
            if (amount > 0) {
                (bool ok,) = payable(to).call{value: amount}("");
                if (!ok) revert NativePayoutFailed();
            }
        } else {
            IERC20(Currency.unwrap(currency)).safeTransfer(to, amount);
        }
    }

    function _atomicMarginCallback(AtomicMarginParams memory params, address trader) internal returns (bytes memory) {
        Currency input = params.zeroForOne ? params.key.currency0 : params.key.currency1;
        Currency output = params.zeroForOne ? params.key.currency1 : params.key.currency0;

        // 1. Borrow input token from PoolManager singleton (0 Capital, 0% Interest)
        manager.take(input, address(this), params.borrowAmount);

        // 2. First leg: swap borrowed input token to output token on high-liquidity standard pool
        _settleCurrency(input, params.borrowAmount);

        BalanceDelta deltaPhysical = manager.swap(
            params.standardPoolKey,
            IPoolManager.SwapParams(
                params.zeroForOne, -int256(params.borrowAmount), EswapMarginLib.sqrtPriceLimit(params.zeroForOne)
            ),
            ""
        );

        int128 receivedOutputDelta = params.zeroForOne ? deltaPhysical.amount1() : deltaPhysical.amount0();
        require(receivedOutputDelta > 0, "Swap output zero");
        uint256 receivedOutputAmount = uint256(int256(receivedOutputDelta));

        manager.take(output, address(this), receivedOutputAmount);

        // 3. Second leg: swap output token back to input token on hook pool
        bool oppositeZeroForOne = !params.zeroForOne;
        _settleCurrency(output, receivedOutputAmount);

        // Pass empty hookData to EswapMarginHook — second leg is a standard spot swap, no accounting
        BalanceDelta deltaHook = manager.swap(
            params.key,
            IPoolManager.SwapParams(
                oppositeZeroForOne, -int256(receivedOutputAmount), EswapMarginLib.sqrtPriceLimit(oppositeZeroForOne)
            ),
            ""
        );

        int128 receivedInputDelta = oppositeZeroForOne ? deltaHook.amount1() : deltaHook.amount0();
        require(receivedInputDelta > 0, "Second swap output zero");
        uint256 finalInputAmount = uint256(int256(receivedInputDelta));

        manager.take(input, address(this), finalInputAmount);

        // 4. Verify profitability: final amount must recover borrow amount + minimum profit
        require(finalInputAmount >= params.borrowAmount + params.minProfit, "Atomic margin trade unprofitable");
        uint256 profit = finalInputAmount - params.borrowAmount;

        // 5. Settle original borrow delta to PoolManager
        _settleCurrency(input, params.borrowAmount);

        // 6. Pay profit to trader with 0 capital used
        if (profit > 0) {
            _payCurrency(input, trader, profit);
        }

        return abi.encode(profit);
    }

    function _jitSpotCallback(JITSpotParams memory params, uint256 ethAttached) internal returns (bytes memory) {
        // H-4 FIX: Require swapper to be JIT-approved
        require(jitApprovedSwappers[params.swapper], "Swapper not JIT-approved");

        Currency input = params.zeroForOne ? params.key.currency0 : params.key.currency1;
        Currency output = params.zeroForOne ? params.key.currency1 : params.key.currency0;

        // [AUDIT HIGH-1] A native OUTPUT leg cannot settle here: the solver
        // would have to supply ETH and `transferFrom` cannot move native. A
        // native INPUT leg is fine — the swapper's ETH arrives on msg.value and
        // is forwarded with `settle{value:}` below, so reject only the output
        // side explicitly rather than failing obscurely on IERC20(address(0)).
        if (NativeTokens.isNative(output)) {
            revert JitNativeCurrencyUnsupported();
        }

        // [FIX H-5] Enforce minimum solver output before executing to protect swapper
        require(params.solverOutput >= params.minSolverOutput, "JIT: solver output below minimum acceptable");

        // [AUDIT HIGH-2] Trustless fill-price floor. The AMM leg is neutralized
        // by the hook (its beforeSwapDelta drives amountToSwap to 0), so there is
        // no pool output to anchor to — the oracle is the only sound reference.
        uint256 jitInputAmount =
            uint256(params.amountSpecified < 0 ? -params.amountSpecified : params.amountSpecified);
        uint256 oracleMin = _jitOracleMinOutput(input, output, jitInputAmount);
        if (oracleMin != 0 && params.solverOutput < oracleMin) {
            revert JitFillBelowOracleFloor(params.solverOutput, oracleMin);
        }

        bytes memory hookData = abi.encode(false, params.solver, params.solverOutput);

        // 1. Execute swap on the Hook pool. The Hook's beforeSwap will absorb the delta.
        manager.swap(
            params.key,
            IPoolManager.SwapParams(
                params.zeroForOne, params.amountSpecified, EswapMarginLib.sqrtPriceLimit(params.zeroForOne)
            ),
            hookData
        );

        uint256 inputAmount = uint256(params.amountSpecified < 0 ? -params.amountSpecified : params.amountSpecified);

        // 2. Swapper pays the input tokens to the Manager (Settles Router's input debt)
        if (NativeTokens.isNative(input)) {
            // ETH arrived on executeJITSpotSwap's msg.value. sync + settle{value}
            // credits this contract's input delta with the forwarded amount.
            if (ethAttached < inputAmount) revert NativeInsufficient();
            manager.sync(input);
            manager.settle{value: inputAmount}();
        } else {
            manager.sync(input);
            IERC20(Currency.unwrap(input)).safeTransferFrom(params.swapper, address(manager), inputAmount);
            manager.settle();
        }

        // Refund any native the swapper over-sent, so the Ext never custodies ETH.
        if (ethAttached > inputAmount) {
            (bool refunded,) = payable(params.swapper).call{value: ethAttached - inputAmount}("");
            if (!refunded) revert NativePayoutFailed();
        }

        // 3. Solver pays the output tokens to the Manager FOR the Hook
        manager.sync(output);
        IERC20(Currency.unwrap(output)).safeTransferFrom(params.solver, address(manager), params.solverOutput);
        manager.settleFor(address(params.key.hooks));

        // 4. Router takes the output tokens and sends them to the Swapper
        manager.take(output, params.swapper, params.solverOutput);

        // 5. Hook takes the input tokens and sends them to the Solver (via the
        //    router passthrough so the hook's onlyRouter gate is satisfied)
        router.extClearJITDelta(address(params.key.hooks), input, params.solver, inputAmount);

        return "";
    }
}