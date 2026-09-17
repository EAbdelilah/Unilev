// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IPoolManager} from "./interfaces/IPoolManager.sol";
import {PoolKey} from "./types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "./types/PoolId.sol";
import {Currency} from "./types/Currency.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol"; // [FIX L-2]
import {BalanceDelta, BalanceDeltaLibrary} from "./types/BalanceDelta.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {IPoolManager as RealIPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolId as RealPoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";
import {EswapMarginLib} from "./EswapMarginLib.sol";

interface IEswapHook {
    function executeLiquidation(PoolKey calldata key, address trader, uint256 minAmountOut, address liquidator) external;
    function partialLiquidation(PoolKey calldata key, address trader, uint256 minAmountOut, address liquidator, uint256 liquidationBps) external;
    function rebalancePosition(PoolKey calldata key, address trader) external;
    function deployCollateral(PoolKey calldata key, address trader) external;
    function closePosition(PoolKey calldata key, address trader, address solver, uint256 minAmountOut) external;
    function registerSolverDebt(PoolId poolId, address trader, address solver, uint256 principal) external;
    function setStandardPoolKey(PoolId poolId, PoolKey calldata key) external;
    function clearJITDelta(Currency token, address to, uint256 amount) external;
    function executeArbunDelivery(PoolKey calldata key, address trader) external;
    function registerMarginOpen(
        PoolKey calldata key,
        address trader,
        uint8 leverage,
        uint256 marginAmount,
        uint256 borrowedAmount,
        Currency boughtCurrency,
        uint256 boughtAmount
    ) external;
    function standardPoolKeys(PoolId poolId) external view returns (Currency, Currency, uint24, int24, address);
}

// [P0#2] Narrowest oracle surface the router needs to compute the live pool
// market price (Chainlink-anchored 18-decimal exchange rate) for trigger
// comparisons. Points at the same PriceFeed contract the hook uses, so trigger
// evaluation and liquidation health share one oracle source.
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
 * @title EswapRouter
 * @notice Handles Uniswap V4 unlock flow for the SDIM margin model.
 *
 * @dev SDIM (Solver-Delegated Integration Margin) single-pool execution:
 *      there is exactly ONE hook-enabled pool. Inside the unlock callback the
 *      router:
 *        1. Executes the margin swap on the hook pool with `hookData`
 *           (the hook flash-expands the swap by the borrow and records the
 *           position in afterSwap).
 *        2. Pulls the trader's MARGIN and settles it (router's -margin delta).
 *        3. Mints the swap OUTPUT as an ERC-6909 claim held by the HOOK
 *           (collateral custodian), offsetting the router's +output delta.
 *        4. Pulls the SOLVER's borrow and settles it FOR THE HOOK via
 *           settleFor(hook), zeroing the hook's flash-provided -borrow delta.
 *        5. Registers the on-chain SolverDebt guaranteeing solver repayment.
 *      All (account, currency) transient deltas net to zero before unlock exits.
 */
contract EswapRouter is
    Ownable2Step // [FIX L-2]
{
    using PoolIdLibrary for PoolKey;
    using BalanceDeltaLibrary for BalanceDelta;
    using SafeERC20 for IERC20;

    /// @dev Required to receive native ETH from PoolManager during take() on
    ///      native-output positions (e.g., long ETH, short WBTC into ETH).
    receive() external payable {}

    IPoolManager public immutable manager;

    /// @dev Minimum gasleft required at the deployCollateral call site so the
    ///      EIP-150 63/64 sub-call budget (~63/64 of the current gas) never
    ///      starves rehypothecation. Measured deployCollateral cost is ~200k;
    ///      this 350k floor hands it ~345k of headroom. Below it the open
    ///      reverts loudly instead of silently opening without pinned collateral.
    uint256 public constant MIN_DEPLOY_COLLATERAL_GAS = 350_000;

    // H-3: Solver whitelist — only registered solvers can be used
    mapping(address => bool) public registeredSolvers;

    // [FIX C-02] Native-borrow escrow. Native (ETH) has no transferFrom, so a
    // leveraged native-input open cannot pull the solver's borrow leg the way the
    // ERC-20 path does. Solvers deposit ETH here ahead of time; every leveraged
    // native open draws `borrowAmount` from `nativeBorrowEscrow[solver]` so the
    // borrow leg is genuinely funded BY THE SOLVER — never by the trader's own
    // msg.value (which previously funded 100% of notional while the solver was
    // still repaid at close, siphoning trader capital).
    mapping(address => uint256) public nativeBorrowEscrow;

    // M-2: ERC-7683 nonce consumption
    mapping(bytes32 => bool) public filledOrders;

    // H-4: JIT swapper opt-in — swappers must approve JIT spot swaps
    mapping(address => bool) public jitApprovedSwappers;

    // Aggregator fill venues (0x ExchangeProxy / ParaSwap Augustus / etc.) that
    // the router may delegate the notional swap leg to. Non-whitelisted proxies
    // revert — this is the ONLY address allowed to touch margin/borrow funds in
    // flight, so a compromised/absurd proxy can never be used to steal them.
    mapping(address => bool) public allowedAggregators;

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

    bytes32 public immutable DOMAIN_SEPARATOR;

    enum CallType {
        SWAP,
        CLOSE,
        LIQUIDATE,
        // [P1#3] Liquidates a proportional slice of an underwater position,
        // keeping the remainder open (see EswapMarginHookLogic.partialLiquidate).
        PARTIAL_LIQUIDATION,
        REBALANCE,
        ATOMIC_MARGIN,
        JIT_SPOT,
        ARBUN_DELIVERY,
        MULTI_POOL_SWAP,
        // [CoW] Solver-funded fill: position credited to `trader` (the recovered
        // CoW order owner) while the margin leg is pulled from `marginFunder`.
        MULTI_POOL_SOLVER_FUNDED,
        // [0x] Aggregator fill: the notional swap leg executes through a
        // whitelisted external aggregator exchange proxy (real 0x quote
        // calldata) instead of the standard pool; hook accounting is identical.
        MULTI_POOL_AGGREGATOR_SWAP,
        // [P0#1] Permissionless-solver fill: the trader's EIP-712 `LendingIntent`
        // is verified at the entrypoint and the fill proceeds without the
        // governance whitelist gate.
        MULTI_POOL_INTENT_OPEN,
        // [P2#7] Best-route competition between the standard pool and a
        // whitelisted aggregator: the router estimates the standard venue's fill
        // and executes the venue whose guaranteed output is higher, so the trader
        // is never worse than the standard-pool route.
        MULTI_POOL_BEST_ROUTE
    }

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

    /// @dev Fill payload for an external aggregator (0x ExchangeProxy, ParaSwap
    ///      Augustus, ...). `callData` is executed on `exchangeProxy` with the
    ///      FULL notional (margin + borrow) pre-approved. `tokenIn`/`tokenOut`
    ///      must exactly match the swap leg; `sellAmount` must equal the
    ///      internal notional so a stale/mismatched quote can never spend a
    ///      different input size. `value` is native ETH attached to the call
    ///      (0 for pure ERC20 routes).
    struct AggregatorRoute {
        address exchangeProxy;
        address tokenIn;
        address tokenOut;
        uint256 sellAmount;
        uint256 value;
        bytes callData;
    }

    /// @dev [P0#1] Off-chain signed intent authorizing a specific solver to fill
    ///      ONE leveraged open for `trader` (the recovered EIP-712 signer). This
    ///      replaces the governance whitelist with the TRADER's own authorization:
    ///      any solver can fill, but only the solver the trader signed for.
    ///      `poolId` is the hook (margin) pool, `standardPoolId` the deep-fill
    ///      pool; both are `PoolId` values (`key.toId()`).
    struct LendingIntent {
        bytes32 poolId;
        bytes32 standardPoolId;
        bool zeroForOne;
        int256 amountSpecified;
        uint8 leverage;
        address solver;
        uint256 deadline;
        uint256 minAmountOut;
        uint256 nonce;
    }

    bytes32 public constant LENDING_INTENT_TYPEHASH = keccak256(
        "LendingIntent(bytes32 poolId,bytes32 standardPoolId,bool zeroForOne,int256 amountSpecified,uint8 leverage,address solver,uint256 deadline,uint256 minAmountOut,uint256 nonce)"
    );

    // [P0#1] One-flag-per-intent replay protection (trader binds each fill to a
    // unique nonce the same way ERC-2612 permits bind each transfer).
    mapping(bytes32 => bool) public filledIntents;

    // [P0#1] Per-solver max borrow per fill; 0 = unlimited. A governance-set
    // safety rail so a permissionless solver can never ingest an unbounded
    // single fill even when traders sign for it.
    mapping(address => uint256) public solverNotionalCap;

    // [P0#1] ERC20 generalisation of `nativeBorrowEscrow`: solvers pre-funded a
    // token (no per-trade approvals / balance needed at fill time). The router
    // draws the borrow leg from here FIRST, topping up from a direct
    // transferFrom only for the remainder. token => solver => amount.
    mapping(address => mapping(address => uint256)) public erc20BorrowEscrow;

    // ─── [P0#2] Signed limit / stop-loss TriggerOrder ─────────────────────────

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

    event TriggerPriceFeedSet(address indexed feed);
    event TriggerOrderArmed(
        address indexed trader, bytes32 indexed poolId, uint256 triggerPrice18, bool aboveOrBelow, uint256 nonce
    );
    event TriggerOrderExecuted(address indexed trader, bytes32 indexed poolId, uint256 nonce, address executor);
    event TriggerOrderCancelled(address indexed trader, bytes32 indexed poolId);

    constructor(IPoolManager _manager) Ownable(msg.sender) {
        manager = _manager;
        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes("EswapRouter")),
                keccak256(bytes("1")),
                block.chainid,
                address(this)
            )
        );
    }

    // --- Admin (Router owner = deployer / multisig) ---

    function setSolverWhitelist(address solver, bool approved) external onlyOwner {
        registeredSolvers[solver] = approved;
    }

    // [FIX C-02] Solver native-borrow escrow. Solvers pre-fund ETH (or withdraw
    // it) so leveraged native-input opens draw the borrow leg from real solver
    // capital. Withdraw is limited to the solver's own balance; once a position
    // draws from the escrow the ETH is spent on the position's borrow leg and is
    // repaid to the solver through the normal close/liquidation payout path.
    function depositNativeBorrow(address solver) external payable {
        if (msg.value > 0) {
            nativeBorrowEscrow[solver] += msg.value;
            emit NativeBorrowDeposited(solver, msg.value);
        }
    }

    function withdrawNativeBorrow(uint256 amount) external {
        if (amount > nativeBorrowEscrow[msg.sender]) revert InsufficientNativeBorrowEscrow(nativeBorrowEscrow[msg.sender], amount);
        nativeBorrowEscrow[msg.sender] -= amount;
        _safeTransferETH(msg.sender, amount);
        emit NativeBorrowWithdrawn(msg.sender, amount);
    }

    function setJitApprovedSwapper(address swapper, bool approved) external onlyOwner {
        jitApprovedSwappers[swapper] = approved;
    }

    function setAllowedAggregator(address exchangeProxy, bool allowed) external onlyOwner {
        allowedAggregators[exchangeProxy] = allowed;
        emit AggregatorWhitelistUpdated(exchangeProxy, allowed);
    }

    event AggregatorWhitelistUpdated(address indexed exchangeProxy, bool allowed);

    // --- [P0#1] Permissionless-solver admin & tooling ---

    /// @notice Per-solver max borrow per fill (0 = unlimited). This is the
    ///         safety rail that lets governance keep permissionless solvers
    ///         bounded while traders pick WHO fills.
    function setSolverNotionalCap(address solver, uint256 cap) external onlyOwner {
        solverNotionalCap[solver] = cap;
        emit SolverNotionalCapUpdated(solver, cap);
    }

    /// @notice [P0#1] ERC20 generalisation of the native borrow escrow: a solver
    ///         pre-funds `token` so a leveraged ERC20-input fill can draw its
    ///         borrow leg from escrow (no per-trade approval/balance needed).
    function depositBorrowEscrow(address token, uint256 amount) external {
        if (amount == 0) revert BorrowEscrowZero();
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        erc20BorrowEscrow[msg.sender][token] += amount;
        emit BorrowEscrowDeposited(msg.sender, token, amount);
    }

    function withdrawBorrowEscrow(address token, uint256 amount) external {
        uint256 bal = erc20BorrowEscrow[msg.sender][token];
        if (amount > bal) revert InsufficientBorrowEscrow(bal, amount);
        erc20BorrowEscrow[msg.sender][token] = bal - amount;
        IERC20(token).safeTransfer(msg.sender, amount);
        emit BorrowEscrowWithdrawn(msg.sender, token, amount);
    }

    event BorrowEscrowDeposited(address indexed solver, address indexed token, uint256 amount);
    event BorrowEscrowWithdrawn(address indexed solver, address indexed token, uint256 amount);
    event SolverNotionalCapUpdated(address indexed solver, uint256 cap);

    // M-11: Event for failed collateral deployment
    error InsufficientGasForCollateralDeployment(uint256 available, uint256 required);

    error DeadlineExpired();
    // [FIX H-2] Single-pool mode settles via ERC-20 transferFrom and
    // [FIX H-2/C-02] Single-pool native-input margin trades were structurally
    // unsupported (swap/swapFor were non-payable and the callback settled via
    // ERC-20 transferFrom). The entrypoints are payable now and the callback
    // settles native legs with manager.settle{value}; the solver's borrow leg is
    // drawn from `nativeBorrowEscrow` so the ledger stays honest.
    error InsufficientNativeMargin(uint256 attached, uint256 required);
    error InsufficientNativeBorrowEscrow(uint256 available, uint256 required);
    // [FIX C-4] Minimum output enforcement (open-leg slippage protection): a
    // seller-specified floor on the swap output, checked against the executed
    // delta in both callbacks. Zero disables it (aggregator/intent flows rely on
    // their own fill-time slippage checks against the router quote).
    error SwapOutputBelowMinimum(uint256 outputAmount, uint256 minAmountOut);
    error AggregatorNotAllowed(address exchangeProxy);
    error AggregatorNativeLegUnsupported();
    error AggregatorRouteMismatch();
    error AggregatorFillFailed();
    // [P0#1] Permissionless-solver (LendingIntent) errors.
    error BorrowEscrowZero();
    error InsufficientBorrowEscrow(uint256 available, uint256 required);
    error IntentAlreadyFilled();
    error IntentPoolMismatch();
    error IntentStandardPoolMismatch();
    error IntentDirectionMismatch();
    error IntentAmountMismatch();
    error IntentLeverageMismatch();
    error IntentSolverMismatch();
    error IntentSlippageBelowSignedFloor();
    error InvalidIntentSignature();
    error BorrowExceedsSolverNotionalCap(uint256 borrow, uint256 cap);
    error SolverNotAuthorized();
    error NotOwner();
    event NativeBorrowDeposited(address indexed solver, uint256 amount);
    event NativeBorrowWithdrawn(address indexed solver, uint256 amount);
    uint256 public constant DEFAULT_DEADLINE_SLACK = 15 minutes;

    struct SwapParams {
        // Hook-enabled pool where leverage accounting (flash borrow + position
        // registration) and the physical swap both happen.
        PoolKey key;
        PoolKey standardPoolKey;
        bool zeroForOne;
        // Margin amount (negative = exact input). The hook's beforeSwap
        // flash-expands this by the borrow, so the pool swaps margin x leverage.
        int256 amountSpecified;
        uint8 leverage;
        // Off-chain Solver that physically settles the borrowed leg
        // (margin x (leverage-1)). Must be non-zero for leverage > 1.
        address solver;
        bytes hookData;
        // [FIX L-4] Unix timestamp after which the swap is rejected, so a signed
        // fill can never be executed late against a stale price.
        uint256 deadline;
        // [FIX C-4] Minimum acceptable swap output (slippage protection).
        uint256 minAmountOut;
    }

    function swap(SwapParams calldata params) external payable returns (bytes memory) {
        return _swap(params, msg.sender);
    }

    /// @notice Open a leveraged position on behalf of `trader`.
    /// For bridge/intent executors (Socket/Li.Fi/Rubic destination calldata):
    /// the executor relays the call but the position and margin belong to
    /// `trader`, who must have approved this router to pull the margin.
    /// Payable so native-input (ETH) margin trades can attach the margin leg.
    function swapFor(SwapParams calldata params, address trader) external payable returns (bytes memory) {
        return _swap(params, trader);
    }

    function _swap(SwapParams calldata params, address trader) internal returns (bytes memory) {
        return manager.unlock(abi.encode(CallType.SWAP, params, trader, msg.value, msg.sender));
    }

    /// @notice Open a leveraged position with the physical fill routed to the
    /// DEEP standard (no-hook) pool; the hook pool is used for accounting only.
    /// Restores the V3-era execution model: fills come from Uniswap's existing
    /// liquidity, not from our own seeded hook pool. `params.standardPoolKey`
    /// must hold the SAME token pair as `params.key`.
    function swapMultiPool(SwapParams calldata params) external payable returns (bytes memory) {
        return _swapMultiPool(params, msg.sender);
    }

    /// @notice Executor variant of swapMultiPool for bridge/intent relays.
    function swapMultiPoolFor(SwapParams calldata params, address trader) external payable returns (bytes memory) {
        return _swapMultiPool(params, trader);
    }

    /// @notice CoW-settlement variant of swapMultiPoolFor: opens a leveraged
    ///         position credited to `trader` (the recovered CoW order owner)
    ///         while the MARGIN leg is pulled from `marginFunder` (the CoW
    ///         solver). Lets CoW solvers fund intents without the trader ever
    ///         approving this router. The borrowed leg is still pulled from
    ///         `params.solver` and the solver must remain whitelisted for
    ///         leverage > 1.
    function swapMultiPoolForSolverFunded(SwapParams calldata params, address trader, address marginFunder)
        external
        payable
        returns (bytes memory)
    {
        return manager.unlock(
            abi.encode(CallType.MULTI_POOL_SOLVER_FUNDED, params, trader, marginFunder, msg.value, msg.sender)
        );
    }

    function _swapMultiPool(SwapParams calldata params, address trader) internal returns (bytes memory) {
        // [FIX M-3] Carry the attached ETH value and its sender through the unlock
        // so the callback can refund the exact excess (msg.value is 0 inside the
        // callback) to the party who actually funded it.
        return manager.unlock(abi.encode(CallType.MULTI_POOL_SWAP, params, trader, msg.value, msg.sender));
    }

    /// @notice Open a leveraged position where the notional swap leg executes
    ///         through a whitelisted external aggregator (0x ExchangeProxy...)
    ///         instead of the standard pool. The `route.callData` comes from a
    ///         REAL aggregator quote for `route.sellAmount == notional`; the
    ///         router approves the proxy for the notional, executes the fill, and
    ///         measures the actual output — then runs the exact same hook
    ///         accounting as `_multiPoolOpen` (margin/borrow pulls,
    ///         registerMarginOpen, 6909 collateral mint, solver debt).
    function swapMultiPoolForAggregator(SwapParams calldata params, address trader, AggregatorRoute calldata route)
        external
        payable
        returns (bytes memory)
    {
        return manager.unlock(
            abi.encode(CallType.MULTI_POOL_AGGREGATOR_SWAP, params, trader, route, msg.value, msg.sender)
        );
    }

    /// @notice [P2#7] Best-route competition: open a leveraged position where the
    ///         notional fill routes through whichever venue — the deep standard
    ///         pool OR a whitelisted external aggregator — guarantees the higher
    ///         output. The trader can never end up with less than the standard
    ///         pool's fill; the aggregator only wins the route when it genuinely
    ///         outperforms the standard venue.
    ///
    /// @dev Venue selection (inside the unlock):
    ///        1. Compute the deterministic standard-pool fill estimate for the
    ///           notional (slot0 price of `params.standardPoolKey`, 0.1% execution
    ///           discount — the same projection the public `quoteExactInput`
    ///           quoter gives).
    ///        2. `params.minAmountOut` is the trader's slippage floor AND their
    ///           acceptance of the aggregator quote (the amount the aggregator
    ///           promised to deliver).
    ///        3. standard estimate >= floor  → STANDARD venue (`_multiPoolOpen`).
    ///           The aggregator is never executed, so a weak/stale aggregator
    ///           quote can never force a worse fill.
    ///        4. floor > standard estimate   → AGGREGATOR venue
    ///           (`_multiPoolOpenAggregator`). Because the trader's floor already
    ///           sits ABOVE the standard estimate, the venue's existing fill-time
    ///           `SwapOutputBelowMinimum` check forces the aggregator to actually
    ///           beat the standard pool's output or the fill reverts — meaningful
    ///           on-chain competition, not quote trust.
    ///      The aggregator proxy must be whitelisted before this entrypoint is
    ///      usable (checked here and re-checked inside the fill). Margin is pulled
    ///      from `trader`, borrow from `params.solver` — mirror of
    ///      `swapMultiPoolForAggregator`.
    function swapMultiPoolBestRoute(SwapParams calldata params, address trader, AggregatorRoute calldata route)
        external
        payable
        returns (bytes memory)
    {
        require(allowedAggregators[route.exchangeProxy], "Aggregator not whitelisted");
        return manager.unlock(abi.encode(CallType.MULTI_POOL_BEST_ROUTE, params, trader, route, msg.value, msg.sender));
    }

    /// @notice [P0#1] EIP-712 hash of a signed `LendingIntent`.
    function hashIntent(LendingIntent calldata intent) public pure returns (bytes32) {
        return keccak256(
            abi.encode(
                LENDING_INTENT_TYPEHASH,
                intent.poolId,
                intent.standardPoolId,
                intent.zeroForOne,
                intent.amountSpecified,
                intent.leverage,
                intent.solver,
                intent.deadline,
                intent.minAmountOut,
                intent.nonce
            )
        );
    }

    /// @notice [P0#1] PERMISSIONLESS solver fill: open a leveraged position on
    ///         behalf of `trader` where the solver is authorized by the TRADER's
    ///         off-chain EIP-712 `LendingIntent` signature instead of the
    ///         governance whitelist. Anyone may CALL this (relay it), but the
    ///         signature pins the exact pool, direction, margin, leverage, solver
    ///         and slippage floor — a stale/forged fill can never pass. The signed
    ///         nonce is consumed, so each intent funds at most one position.
    ///
    /// @dev Works like `swapMultiPoolFor` but the solver-authorization gate is
    ///      replaced by ecrecover of the intent. The caller must still ensure the
    ///      marginFunder (the recovered trader) has approved this router when the
    ///      margin leg is an ERC20; native margins attach `msg.value` as usual.
    ///      The solver's borrow leg is drawn from its ERC20 escrow FIRST (pre-funded
    ///      via depositBorrowEscrow), falling back to a direct transferFrom.
    function swapWithIntent(
        SwapParams calldata params,
        address trader,
        LendingIntent calldata intent,
        bytes calldata signature
    ) external payable returns (bytes memory) {
        if (block.timestamp > intent.deadline) revert DeadlineExpired();
        if (block.timestamp > params.deadline) revert DeadlineExpired();

        // The signed intent must EXACTLY describe this fill — a solver/relayer
        // can never substitute different execution parameters than the trader
        // authored, so the whitelist gate becomes unnecessary.
        if (PoolId.unwrap(params.key.toId()) != intent.poolId) revert IntentPoolMismatch();
        if (PoolId.unwrap(params.standardPoolKey.toId()) != intent.standardPoolId) revert IntentStandardPoolMismatch();
        if (params.zeroForOne != intent.zeroForOne) revert IntentDirectionMismatch();
        if (params.amountSpecified != intent.amountSpecified) revert IntentAmountMismatch();
        if (params.leverage != intent.leverage) revert IntentLeverageMismatch();
        if (params.solver != intent.solver) revert IntentSolverMismatch();
        if (params.minAmountOut < intent.minAmountOut) revert IntentSlippageBelowSignedFloor();

        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, hashIntent(intent)));
        address recovered = _recoverSigner(digest, signature);
        if (recovered == address(0) || recovered != trader) revert InvalidIntentSignature();

        // One intent = one fill: consume the (trader, nonce) pair.
        bytes32 fillId = keccak256(abi.encode(recovered, intent.nonce));
        if (filledIntents[fillId]) revert IntentAlreadyFilled();
        filledIntents[fillId] = true;

        // Governance-set safety rail: bound the max borrow a permissionless
        // solver can provider per fill, even when traders sign for it.
        if (params.leverage > 1) {
            uint256 marginAmount =
                uint256(int256(params.amountSpecified < 0 ? -params.amountSpecified : params.amountSpecified));
            uint256 borrowAmount = marginAmount * uint256(params.leverage - 1);
            uint256 cap = solverNotionalCap[params.solver];
            if (cap > 0 && borrowAmount > cap) revert BorrowExceedsSolverNotionalCap(borrowAmount, cap);
        }

        return manager.unlock(abi.encode(CallType.MULTI_POOL_INTENT_OPEN, params, recovered, msg.value, msg.sender));
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
        address recovered = _recoverSigner(digest, signature);
        if (recovered == address(0) || recovered != msg.sender) revert InvalidTriggerOrderSignature();

        armedTriggerOrders[msg.sender][order.poolId] = order;
        emit TriggerOrderArmed(msg.sender, order.poolId, order.triggerPrice18, order.aboveOrBelow, order.nonce);
    }

    /// @notice [P0#2] PERMISSIONLESS conditional close: any keeper may call this
    ///         once the pool's market price crosses the armed `TriggerOrder`.
    ///         Guards, in order:
    ///          1. An armed order exists, is not expired, and is not replayable.
    ///          2. The position exists and is NOT liquidatable — liquidation
    ///             always wins over a trigger close (a liquidatable position is
    ///             closed by `liquidate`, never by this path).
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

        // The position must exist and be healthy: liquidation preempts triggers.
        (, uint256 collateral,,,,,,,) = IEswapTriggerHookRead(hook).positions(PoolId.unwrap(key.toId()), trader);
        if (collateral == 0) revert NoActivePosition();
        if (IEswapTriggerHookRead(hook).isPositionLiquidatable(key, trader)) revert PositionLiquidatable();

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
        manager.unlock(abi.encode(CallType.CLOSE, hook, key, trader, address(0), order.minAmountOut));
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

    function executeJITSpotSwap(JITSpotParams calldata params) external returns (bytes memory) {
        // Enforce that the caller is the solver
        require(msg.sender == params.solver, "Only solver can execute JIT");
        return manager.unlock(abi.encode(CallType.JIT_SPOT, params));
    }

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

    function _recoverSigner(bytes32 digest, bytes calldata signature) internal pure returns (address) {
        if (signature.length != 65) return address(0);
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 0x20))
            v := byte(0, calldataload(add(signature.offset, 0x40)))
        }
        return ecrecover(digest, v, r, s);
    }

    /**
     * @notice ERC-7683 Solver Initiation Gateway.
     * Allows permissionless solvers to fill the trader's off-chain signed intent order.
     */
    function initiate(CrossChainOrder calldata order, bytes calldata signature, bytes calldata) external {
        require(order.settlementContract == address(this), "Invalid settlement contract");
        require(order.originChainId == block.chainid, "Invalid origin chain");
        require(block.timestamp <= order.initiateDeadline, "Initiate deadline passed");

        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, hashOrder(order)));
        address swapper = _recoverSigner(digest, signature);
        require(swapper == order.swapper && swapper != address(0), "Invalid signature");

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

        SwapParams memory params = SwapParams({
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
        // so ETH attached to the unlock is always 0 here.
        manager.unlock(abi.encode(CallType.MULTI_POOL_SWAP, params, swapper, uint256(0), msg.sender));
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

    function atomicMarginTrade(AtomicMarginParams calldata params) external returns (uint256 profit) {
        bytes memory result = manager.unlock(abi.encode(CallType.ATOMIC_MARGIN, params, msg.sender));
        profit = abi.decode(result, (uint256));
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        require(msg.sender == address(manager), "Not manager");

        CallType callType = abi.decode(data, (CallType));

        if (callType == CallType.SWAP) {
            (, SwapParams memory params, address trader, uint256 ethAttached, address refundRecipient) =
                abi.decode(data, (CallType, SwapParams, address, uint256, address));
            return _swapCallback(params, trader, ethAttached, refundRecipient);
        } else if (callType == CallType.MULTI_POOL_SWAP) {
            (, SwapParams memory params, address trader, uint256 ethAttached, address refundRecipient) =
                abi.decode(data, (CallType, SwapParams, address, uint256, address));
            return _multiPoolOpen(params, trader, trader, ethAttached, refundRecipient, false);
        } else if (callType == CallType.MULTI_POOL_SOLVER_FUNDED) {
            (, SwapParams memory params, address trader, address marginFunder, uint256 ethAttached, address refundRecipient) =
                abi.decode(data, (CallType, SwapParams, address, address, uint256, address));
            return _multiPoolOpen(params, trader, marginFunder, ethAttached, refundRecipient, false);
        } else if (callType == CallType.MULTI_POOL_AGGREGATOR_SWAP) {
            (, SwapParams memory params, address trader, AggregatorRoute memory route, uint256 ethAttached, address refundRecipient) =
                abi.decode(data, (CallType, SwapParams, address, AggregatorRoute, uint256, address));
            return _multiPoolOpenAggregator(params, trader, route, ethAttached, refundRecipient, false);
        } else if (callType == CallType.MULTI_POOL_INTENT_OPEN) {
            (, SwapParams memory params, address trader, uint256 ethAttached, address refundRecipient) =
                abi.decode(data, (CallType, SwapParams, address, uint256, address));
            return _multiPoolOpen(params, trader, trader, ethAttached, refundRecipient, true);
        } else if (callType == CallType.MULTI_POOL_BEST_ROUTE) {
            (
                ,
                SwapParams memory params,
                address trader,
                AggregatorRoute memory route,
                uint256 ethAttached,
                address refundRecipient
            ) = abi.decode(data, (CallType, SwapParams, address, AggregatorRoute, uint256, address));
            return _bestRouteOpen(params, trader, route, ethAttached, refundRecipient, false);
        } else if (callType == CallType.CLOSE) {
            (, address hook, PoolKey memory key, address trader, address solver, uint256 minAmountOut) =
                abi.decode(data, (CallType, address, PoolKey, address, address, uint256));
            _closeCallback(hook, key, trader, solver, minAmountOut);
            return "";
        } else if (callType == CallType.LIQUIDATE) {
            (, address hook, PoolKey memory key, address trader, uint256 minAmountOut, address liquidator) =
                abi.decode(data, (CallType, address, PoolKey, address, uint256, address));
            IEswapHook(hook).executeLiquidation(key, trader, minAmountOut, liquidator);
            return "";
        } else if (callType == CallType.PARTIAL_LIQUIDATION) {
            (
                ,
                address hook,
                PoolKey memory key,
                address trader,
                uint256 minAmountOut,
                uint256 liquidationBps,
                address liquidator
            ) = abi.decode(data, (CallType, address, PoolKey, address, uint256, uint256, address));
            IEswapHook(hook).partialLiquidation(key, trader, minAmountOut, liquidator, liquidationBps);
            return "";
        } else if (callType == CallType.REBALANCE) {
            (, address hook, PoolKey memory key, address trader) =
                abi.decode(data, (CallType, address, PoolKey, address));
            IEswapHook(hook).rebalancePosition(key, trader);
            return "";
        } else if (callType == CallType.ATOMIC_MARGIN) {
            (, AtomicMarginParams memory params, address trader) =
                abi.decode(data, (CallType, AtomicMarginParams, address));
            return _atomicMarginCallback(params, trader);
        } else if (callType == CallType.JIT_SPOT) {
            (, JITSpotParams memory params) = abi.decode(data, (CallType, JITSpotParams));
            return _jitSpotCallback(params);
        } else if (callType == CallType.ARBUN_DELIVERY) {
            (, address hook, PoolKey memory key, address trader) =
                abi.decode(data, (CallType, address, PoolKey, address));
            IEswapHook(hook).executeArbunDelivery(key, trader);
            return "";
        }
        return "";
    }

    function _atomicMarginCallback(AtomicMarginParams memory params, address trader) internal returns (bytes memory) {
        Currency input = params.zeroForOne ? params.key.currency0 : params.key.currency1;
        Currency output = params.zeroForOne ? params.key.currency1 : params.key.currency0;

        // 1. Borrow input token from PoolManager singleton (0 Capital, 0% Interest)
        manager.take(input, address(this), params.borrowAmount);

        // 2. First leg: swap borrowed input token to output token on high-liquidity standard pool
        manager.sync(input);
        IERC20(Currency.unwrap(input)).safeTransfer(address(manager), params.borrowAmount);
        manager.settle();

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
        manager.sync(output);
        IERC20(Currency.unwrap(output)).safeTransfer(address(manager), receivedOutputAmount);
        manager.settle();

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
        manager.sync(input);
        IERC20(Currency.unwrap(input)).safeTransfer(address(manager), params.borrowAmount);
        manager.settle();

        // 6. Pay profit to trader with 0 capital used
        if (profit > 0) {
            IERC20(Currency.unwrap(input)).safeTransfer(trader, profit);
        }

        return abi.encode(profit);
    }

    function _jitSpotCallback(JITSpotParams memory params) internal returns (bytes memory) {
        // H-4 FIX: Require swapper to be JIT-approved
        require(jitApprovedSwappers[params.swapper], "Swapper not JIT-approved");

        Currency input = params.zeroForOne ? params.key.currency0 : params.key.currency1;
        Currency output = params.zeroForOne ? params.key.currency1 : params.key.currency0;

        // [FIX H-5] Enforce minimum solver output before executing to protect swapper
        require(params.solverOutput >= params.minSolverOutput, "JIT: solver output below minimum acceptable");

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
        manager.sync(input);
        IERC20(Currency.unwrap(input)).safeTransferFrom(params.swapper, address(manager), inputAmount);
        manager.settle();

        // 3. Solver pays the output tokens to the Manager FOR the Hook
        manager.sync(output);
        IERC20(Currency.unwrap(output)).safeTransferFrom(params.solver, address(manager), params.solverOutput);
        manager.settleFor(address(params.key.hooks));

        // 4. Router takes the output tokens and sends them to the Swapper
        manager.take(output, params.swapper, params.solverOutput);

        // 5. Hook takes the input tokens and sends them to the Solver
        IEswapHook(address(params.key.hooks)).clearJITDelta(input, params.solver, inputAmount);

        return "";
    }

    /**
     * @notice SDIM single-pool unlock callback. Executes the margin swap, settles
     *         the trader's margin + the solver's borrow, mints the collateral
     *         claim to the hook, and registers the solver debt.
     * @dev [FIX V2] Only the single-pool execution path is used. The former
     *      multi-pool branch executed TWO physical swaps (hook-pool accounting
     *      swap + standard-pool physical swap) but only funded one input leg,
     *      leaving a `-(margin+borrow)` router delta and an `+accountingOut`
     *      output delta un-netted — the real PoolManager reverts CurrencyNotSettled.
     *      The owner-set standard pool key is still used by the hook for close /
     *      liquidation unwind swaps. All swaps use a valid full-range
     *      sqrtPriceLimitX96 ([FIX V1]); the real Pool library rejects 0.
     */
    function _swapCallback(SwapParams memory params, address trader, uint256 ethAttached, address refundRecipient)
        internal
        returns (bytes memory)
    {
        // [FIX L-4] Reject fills past the signed deadline.
        if (block.timestamp > params.deadline) revert DeadlineExpired();
        uint256 marginAmount =
            uint256(int256(params.amountSpecified < 0 ? -params.amountSpecified : params.amountSpecified));
        uint256 borrowAmount = marginAmount * uint256(params.leverage - 1);
        if (params.leverage > 1) {
            require(params.solver != address(0), "Solver required for leverage");
        }

        // C-2 FIX: Validate that hookData trader matches the trader parameter
        if (params.hookData.length > 0) {
            (bool isMargin,, address hookDataTrader) = abi.decode(params.hookData, (bool, uint8, address));
            if (isMargin) {
                require(hookDataTrader == trader, "hookData trader mismatch");
            }
        }

        // H-3 FIX: Validate solver is whitelisted
        if (params.leverage > 1) {
            require(registeredSolvers[params.solver], "Solver not whitelisted");
        }

        Currency input = params.zeroForOne ? params.key.currency0 : params.key.currency1;
        Currency output = params.zeroForOne ? params.key.currency1 : params.key.currency0;
        bool inputNative = Currency.unwrap(input) == address(0);
        uint256 notional = marginAmount + borrowAmount;

        BalanceDelta delta = manager.swap(
            params.key,
            IPoolManager.SwapParams(
                params.zeroForOne, params.amountSpecified, EswapMarginLib.sqrtPriceLimit(params.zeroForOne)
            ),
            params.hookData
        );

        int128 outputDelta = params.zeroForOne ? delta.amount1() : delta.amount0();
        require(outputDelta > 0, "Swap output zero");
        uint256 outputAmount = uint256(int256(outputDelta));
        // [FIX C-4] Enforce the caller's slippage floor on the executed output.
        if (outputAmount < params.minAmountOut) revert SwapOutputBelowMinimum(outputAmount, params.minAmountOut);

        // [FIX H-2/C-02] Settle the router's -margin delta (and, for native
        // leveraged opens, the hook's -borrow delta) from funds the router
        // actually holds: the caller-attached ETH covers the MARGIN leg and the
        // solver's nativeBorrowEscrow covers the BORROW leg. Native has no
        // transferFrom, so the escrow is the only way to keep the borrow truly
        // solver-funded. Excess attached ETH is refunded to the caller.
        if (inputNative) {
            if (borrowAmount > 0) {
                require(params.solver != address(0), "Solver required for leverage");
                if (nativeBorrowEscrow[params.solver] < borrowAmount) {
                    revert InsufficientNativeBorrowEscrow(nativeBorrowEscrow[params.solver], borrowAmount);
                }
                nativeBorrowEscrow[params.solver] -= borrowAmount;
            }
            if (marginAmount > 0) {
                if (ethAttached < marginAmount) revert InsufficientNativeMargin(ethAttached, marginAmount);
                manager.sync(input);
                // margin leg (caller-attached ETH) settles the router's -margin delta
                manager.settle{value: marginAmount}();
            }
            if (ethAttached > marginAmount) {
                _safeTransferETH(refundRecipient, ethAttached - marginAmount);
            }
        } else {
            // Settle the trader's margin (router's -margin delta from the swap)
            if (marginAmount > 0) {
                manager.sync(input);
                IERC20(Currency.unwrap(input)).safeTransferFrom(trader, address(manager), marginAmount);
                manager.settle();
            }
        }

        // Mint the collateral as an ERC-6909 claim held by the hook, offsetting
        // the router's +output delta.
        manager.mint(address(params.key.hooks), uint256(uint160(Currency.unwrap(output))), outputAmount);

        // Settle the solver's borrow FOR THE HOOK: the hook flash-provided the
        // borrow leg, so it carries a -borrowAmount transient delta that
        // settleFor(hook) zeroes.
        if (borrowAmount > 0) {
            if (inputNative) {
                manager.sync(input);
                manager.settleFor{value: borrowAmount}(address(params.key.hooks));
            } else {
                manager.sync(input);
                IERC20(Currency.unwrap(input)).safeTransferFrom(params.solver, address(manager), borrowAmount);
                manager.settleFor(address(params.key.hooks));
            }
        }

        // Register the on-chain solver debt (principal + yield) guaranteeing
        // solver repayment before trader withdrawal.
        if (borrowAmount > 0) {
            IEswapHook(params.key.hooks).registerSolverDebt(params.key.toId(), trader, params.solver, borrowAmount);
        }

        if (params.hookData.length > 0) {
            (bool isMargin,,) = abi.decode(params.hookData, (bool, uint8, address));
            if (isMargin) {
                if (gasleft() < MIN_DEPLOY_COLLATERAL_GAS) {
                    revert InsufficientGasForCollateralDeployment(gasleft(), MIN_DEPLOY_COLLATERAL_GAS);
                }
                // No try/catch: deployCollateral failure reverts the whole open —
                // a position must never exist without its pinned band collateral.
                IEswapHook(params.key.hooks).deployCollateral(params.key, trader);
            }
        }

        return abi.encode(delta);
    }

    /**
     * @notice Multi-pool unlock callback: the physical fill happens on the DEEP
     *         standard pool; the hook pool is used for accounting only (position
     *         registration + ERC-6909 collateral custody). Mirrors the V3-era
     *         execution model where fills come from Uniswap's existing liquidity.
     * @dev Delta ledger inside this unlock (router perspective):
     *        standard swap:  -notional(input), +outStd(output)
     *        settle margin:  -margin netted          (transferFrom marginFunder)
     *        settle borrow:  -borrow netted          (transferFrom solver)
     *        mint claim:     -outStd netted          (6909 to hook)
     *      All deltas zero before unlock exits — the failure mode of the former
     *      multi-pool branch ([FIX V2] in _swapCallback) cannot recur because
     *      BOTH input legs are funded and the FULL output is minted as a claim.
     *
     * @param marginFunder Address the MARGIN leg is pulled from. The position
     *        is always credited to `trader`; for a standard relay these are the
     *        same address, for CoW solver-funded fills the solver funds the
     *        margin on behalf of the trader.
     * @param solverAuthorizedByIntent true when this fill arrived via a verified
     *        EIP-712 `LendingIntent` (triggered at the leading encoding), in
     *        which case the whitelist gate is bypassed — the trader signed away
     *        exactly this solver and fill.
     */
    function _multiPoolOpen(
        SwapParams memory params,
        address trader,
        address marginFunder,
        uint256 ethAttached,
        address refundRecipient,
        bool solverAuthorizedByIntent
    ) internal returns (bytes memory) {
        // [FIX L-4] Reject fills past the signed deadline.
        if (block.timestamp > params.deadline) revert DeadlineExpired();
        uint256 marginAmount =
            uint256(int256(params.amountSpecified < 0 ? -params.amountSpecified : params.amountSpecified));
        uint256 borrowAmount = marginAmount * uint256(params.leverage - 1);
        if (params.leverage > 1) {
            require(params.solver != address(0), "Solver required for leverage");
            // [P0#1] Whitelist is now ONE of two authorization legs: governance
            // registration OR the trader's signed LendingIntent.
            require(registeredSolvers[params.solver] || solverAuthorizedByIntent, "Solver not authorized");
            uint256 cap = solverNotionalCap[params.solver];
            if (cap > 0 && borrowAmount > cap) revert BorrowExceedsSolverNotionalCap(borrowAmount, cap);
        }

        // The deep-fill venue must trade the exact same token pair as the hook pool.
        require(
            Currency.unwrap(params.standardPoolKey.currency0) == Currency.unwrap(params.key.currency0)
                && Currency.unwrap(params.standardPoolKey.currency1) == Currency.unwrap(params.key.currency1),
            "Standard pool currency mismatch"
        );

        Currency input = params.zeroForOne ? params.key.currency0 : params.key.currency1;
        Currency output = params.zeroForOne ? params.key.currency1 : params.key.currency0;
        bool inputNative = Currency.unwrap(input) == address(0);
        uint256 notional = marginAmount + borrowAmount;

        // 1. Physical fill on the deep standard (native/USDC) pool for margin + borrow.
        BalanceDelta stdDelta = manager.swap(
            params.standardPoolKey,
            IPoolManager.SwapParams(
                params.zeroForOne, -int256(notional), EswapMarginLib.sqrtPriceLimit(params.zeroForOne)
            ),
            ""
        );
        int128 outputDelta = params.zeroForOne ? stdDelta.amount1() : stdDelta.amount0();
        require(outputDelta > 0, "Swap output zero");
        uint256 outputAmount = uint256(int256(outputDelta));
        // [FIX C-4] Enforce the caller's slippage floor on the executed output.
        if (outputAmount < params.minAmountOut) revert SwapOutputBelowMinimum(outputAmount, params.minAmountOut);

        // 2. Fund the router's -input transient delta from this unlock.
        //    ERC20 input: pull margin from trader and borrow from solver independently.
        //    Native input: the MARGIN leg is covered by msg.value attached at the
        //    (payable) entrypoint and the BORROW leg is drawn from the solver's
        //    `nativeBorrowEscrow` — native has no approval/transferFrom, so the
        //    escrow is the only way the borrow can be genuinely solver-funded
        //    (was: the whole notional came from the trader's msg.value and the
        //    solver was still repaid at close, siphoning trader capital).
        if (inputNative) {
            if (borrowAmount > 0) {
                require(params.solver != address(0), "Solver required for leverage");
                if (nativeBorrowEscrow[params.solver] < borrowAmount) {
                    revert InsufficientNativeBorrowEscrow(nativeBorrowEscrow[params.solver], borrowAmount);
                }
                nativeBorrowEscrow[params.solver] -= borrowAmount;
            }
            if (notional > 0) {
                if (ethAttached < marginAmount) revert InsufficientNativeMargin(ethAttached, marginAmount);
                manager.sync(input);
                // margin (attached at entrypoint) + borrow (escrow, router-held)
                manager.settle{value: notional}();
            }
        } else {
            // [GAS] Both legs settle the router's -input delta against the same
            // synced currency, so ONE sync snapshot + ONE settle books the full
            // notional. This v4-core builds `paid` as balanceNow - balanceAtSync
            // against a single "synced currency" slot, so the transfers must
            // happen AFTER the sync snapshot and BEFORE the settle.
            if (marginAmount > 0 || borrowAmount > 0) {
                manager.sync(input);
            }
            if (marginAmount > 0) {
                IERC20(Currency.unwrap(input)).safeTransferFrom(marginFunder, address(manager), marginAmount);
            }
            if (borrowAmount > 0) {
                // [P0#1] Draw the borrower leg from the solver's pre-funded ERC20
                // escrow FIRST (no per-trade approval needed), topping up from a
                // direct transferFrom with whatever the escrow doesn't cover.
                address inputToken = Currency.unwrap(input);
                uint256 escrowed = erc20BorrowEscrow[params.solver][inputToken];
                uint256 fromEscrow = escrowed >= borrowAmount ? borrowAmount : escrowed;
                if (fromEscrow > 0) {
                    erc20BorrowEscrow[params.solver][inputToken] = escrowed - fromEscrow;
                }
                uint256 fromSolver = borrowAmount - fromEscrow;
                if (fromEscrow > 0) {
                    IERC20(inputToken).safeTransfer(address(manager), fromEscrow);
                }
                if (fromSolver > 0) {
                    IERC20(inputToken).safeTransferFrom(params.solver, address(manager), fromSolver);
                }
            }
            if (marginAmount > 0 || borrowAmount > 0) {
                manager.settle();
            }
        }

        // 3. Hook validates the open and records position accounting.
        IEswapHook(params.key.hooks)
            .registerMarginOpen(params.key, trader, params.leverage, marginAmount, borrowAmount, output, outputAmount);

        // 4. Collateral custody: full output minted as an ERC-6909 claim held by the
        //    hook (mirrors single-pool mode, including the protocol-fee share).
        //    For a native OUTPUT, the router first takes the native out of the swap,
        //    then mints the claim and settles the resulting -native delta with the
        //    held ETH. For an ERC20 output it transfers the held ERC20 to the manager.
        if (Currency.unwrap(output) == address(0)) {
            // Router's +output (native) delta: take it out.
            manager.take(output, address(this), outputAmount);
            // Mint the ERC-6909 native claim to the hook → router -native(outputAmount).
            manager.mint(address(params.key.hooks), 0, outputAmount);
            // Settle the -native delta with the ETH just taken out.
            manager.sync(output);
            manager.settle{value: outputAmount}();
        } else {
            manager.mint(address(params.key.hooks), uint256(uint160(Currency.unwrap(output))), outputAmount);
        }

        // 5. Register the solver debt guaranteeing repayment before withdrawal.
        if (borrowAmount > 0) {
            IEswapHook(params.key.hooks).registerSolverDebt(params.key.toId(), trader, params.solver, borrowAmount);
        }

        // 6. [FIX M-3/M-4/C-02] Refund exactly the excess ETH attached at the
        //    entrypoint, back to the caller who funded it — never the trader, and
        //    never the whole router balance (which may hold unrelated native takes
        //    from other flows). Native margin is capped at `marginAmount`: the
        //    borrow leg comes from the solver's escrow, so anything beyond the
        //    margin is returned. Uses a safe call so a contract recipient cannot
        //    DoS the refund with the 2300-gas transfer() stipend.
        if (inputNative && ethAttached > marginAmount) {
            _safeTransferETH(refundRecipient, ethAttached - marginAmount);
        }

        if (params.hookData.length > 0) {
            (bool isMargin,,) = abi.decode(params.hookData, (bool, uint8, address));
            if (isMargin) {
                if (gasleft() < MIN_DEPLOY_COLLATERAL_GAS) {
                    revert InsufficientGasForCollateralDeployment(gasleft(), MIN_DEPLOY_COLLATERAL_GAS);
                }
                // No try/catch — see _swapCallback: rehyp is open-critical.
                IEswapHook(params.key.hooks).deployCollateral(params.key, trader);
            }
        }

        return abi.encode(stdDelta);
    }

    /**
     * @notice Aggregator-orchestrated multi-pool open: the physical fill executes
     *         through an external aggregator (0x ExchangeProxy, ParaSwap Augustus,
     *         ...) that received a REAL quote; the hook pool is used for
     *         accounting only (position registration + ERC-6909 collateral
     *         custody). The hook accounting is IDENTICAL to `_multiPoolOpen` —
     *         only the fill venue changes from the standard pool to the
     *         aggregator's exchange proxy.
     *
     * @dev Delta ledger inside this unlock (router perspective):
     *        aggregator fill: +outputAgg(output) — routed externally, lands at router
     *        settle margin:   -margin netted            (transferFrom marginFunder)
     *        settle borrow:   -borrow netted            (transferFrom solver)
     *        mint claim:      -outputAgg netted         (6909 to hook, then sync+settle)
     *      All deltas zero before unlock exits.
     */
    function _multiPoolOpenAggregator(
        SwapParams memory params,
        address trader,
        AggregatorRoute memory route,
        uint256 ethAttached,
        address refundRecipient,
        bool solverAuthorizedByIntent
    ) internal returns (bytes memory) {
        // [FIX L-4] Reject fills past the signed deadline.
        if (block.timestamp > params.deadline) revert DeadlineExpired();
        uint256 marginAmount =
            uint256(int256(params.amountSpecified < 0 ? -params.amountSpecified : params.amountSpecified));
        uint256 borrowAmount = marginAmount * uint256(params.leverage - 1);
        if (params.leverage > 1) {
            require(params.solver != address(0), "Solver required for leverage");
            // [P0#1] Whitelist is now ONE of two authorization legs: governance
            // registration OR the trader's signed LendingIntent.
            require(registeredSolvers[params.solver] || solverAuthorizedByIntent, "Solver not authorized");
            uint256 cap = solverNotionalCap[params.solver];
            if (cap > 0 && borrowAmount > cap) revert BorrowExceedsSolverNotionalCap(borrowAmount, cap);
        }
        require(allowedAggregators[route.exchangeProxy], "Aggregator not whitelisted");

        // The aggregator route must cover the exact same token pair as the hook
        // pool and its close venue — the unwind swaps use these same currencies.
        require(
            Currency.unwrap(params.standardPoolKey.currency0) == Currency.unwrap(params.key.currency0)
                && Currency.unwrap(params.standardPoolKey.currency1) == Currency.unwrap(params.key.currency1),
            "Standard pool currency mismatch"
        );

        Currency input = params.zeroForOne ? params.key.currency0 : params.key.currency1;
        Currency output = params.zeroForOne ? params.key.currency1 : params.key.currency0;
        bool inputNative = Currency.unwrap(input) == address(0);
        bool outputNative = Currency.unwrap(output) == address(0);
        uint256 notional = marginAmount + borrowAmount;

        // Route sanity: the quoted input/output pair and sell amount must match
        // the swap leg — a stale/mismatched quote can never spend an unexpected
        // input size or leave margin/borrow unspent for the aggregator.
        if (route.tokenIn != Currency.unwrap(input) || route.tokenOut != Currency.unwrap(output)) {
            revert AggregatorRouteMismatch();
        }
        if (route.sellAmount != notional) revert AggregatorRouteMismatch();
        // Current aggregator path is ERC20→ERC20 (USDC→WETH etc.); native legs
        // would require escrow/value handling that differs from the standard pool
        // path and isn't exercised in the fork proof. Extend as needed.
        if (inputNative || outputNative) revert AggregatorNativeLegUnsupported();

        // 1. Pull margin from the trader (or the relay-funded marginFunder for
        //    CoW/solver-funded flows) and the borrow from the solver INTO the
        //    router, which holds them until the aggregator pulls them in step 2.
        if (marginAmount > 0) {
            IERC20(Currency.unwrap(input)).safeTransferFrom(trader, address(this), marginAmount);
        }
        if (borrowAmount > 0) {
            // [P0#1] Draw the borrow leg from the solver's pre-funded ERC20 escrow
            // FIRST, topping up from a direct transferFrom for the remainder.
            address inputToken = Currency.unwrap(input);
            uint256 escrowed = erc20BorrowEscrow[params.solver][inputToken];
            uint256 fromEscrow = escrowed >= borrowAmount ? borrowAmount : escrowed;
            if (fromEscrow > 0) {
                erc20BorrowEscrow[params.solver][inputToken] = escrowed - fromEscrow;
                IERC20(inputToken).safeTransfer(address(this), fromEscrow);
            }
            uint256 fromSolver = borrowAmount - fromEscrow;
            if (fromSolver > 0) {
                IERC20(inputToken).safeTransferFrom(params.solver, address(this), fromSolver);
            }
        }

        // 2. Approve the aggregator's exchange proxy for the full notional, then
        //    execute the real fill calldata. The proxy pulls the input ERC20 from
        //    the router (via allowance) and sends the output ERC20 back to it.
        IERC20(Currency.unwrap(input)).forceApprove(route.exchangeProxy, notional);
        uint256 outBefore = IERC20(Currency.unwrap(output)).balanceOf(address(this));

        // Execute the real aggregator fill; check success and decode the revert reason.
        (bool ok, bytes memory ret) = route.exchangeProxy.call{value: route.value}(route.callData);
        if (!ok) {
            if (ret.length >= 68 && bytes4(ret) == 0x08c379a0) {
                revert(string(abi.decode(_slice(ret, 4), (string))));
            }
            revert AggregatorFillFailed();
        }

        // 3. Measure the actual output delivered by the real aggregator fill.
        uint256 outputAmount = IERC20(Currency.unwrap(output)).balanceOf(address(this)) - outBefore;
        require(outputAmount > 0, "Aggregator output zero");
        // [FIX C-4] Enforce the caller's slippage floor on the executed output.
        if (outputAmount < params.minAmountOut) revert SwapOutputBelowMinimum(outputAmount, params.minAmountOut);

        // 4. Hook validates the open and records position accounting — identical
        //    to `_multiPoolOpen`: the hook never sees or cares HOW the fill happened.
        IEswapHook(params.key.hooks)
            .registerMarginOpen(params.key, trader, params.leverage, marginAmount, borrowAmount, output, outputAmount);

        // 5. Collateral custody: the aggregator's output sits at the ROUTER (not
        //    the PM as in the standard pool path). Mint the 6909 claim to the hook
        //    (router −output), then sync+settle the held ERC20 into the PM to zero
        //    the router's transient delta.
        manager.mint(address(params.key.hooks), uint256(uint160(Currency.unwrap(output))), outputAmount);
        manager.sync(output);
        IERC20(Currency.unwrap(output)).safeTransfer(address(manager), outputAmount);
        manager.settle();

        // 6. Register the solver debt guaranteeing repayment before withdrawal.
        if (borrowAmount > 0) {
            IEswapHook(params.key.hooks).registerSolverDebt(params.key.toId(), trader, params.solver, borrowAmount);
        }

        // 7. [FIX M-3/M-4] Refund any native ETH attached at the entrypoint. In
        //    the aggregator path this is always 0 (ERC20-only route); guard
        //    defensively and return it to the funder.
        if (ethAttached > 0) {
            _safeTransferETH(refundRecipient, ethAttached);
        }

        if (params.hookData.length > 0) {
            (bool isMargin,,) = abi.decode(params.hookData, (bool, uint8, address));
            if (isMargin) {
                if (gasleft() < MIN_DEPLOY_COLLATERAL_GAS) {
                    revert InsufficientGasForCollateralDeployment(gasleft(), MIN_DEPLOY_COLLATERAL_GAS);
                }
                IEswapHook(params.key.hooks).deployCollateral(params.key, trader);
            }
        }

        // Return a BalanceDelta-shaped packed int256 so the adapter decodes the
        // output exactly like the standard pool path:
        //   delta0 = -notional (input spent), delta1 = +outputAmount (received)
        int256 packedDelta = (int256(uint256(-int256(notional))) << 128) | int256(uint256(int256(outputAmount)));
        return abi.encode(packedDelta);
    }

    /**
     * @notice [P2#7] Best-route competition: select and execute the venue whose
     *         guaranteed output is higher — the standard (deep-fill) pool or a
     *         whitelisted external aggregator.
     * @dev Competition rule, all enforced on-chain against the live execution
     *      pool's slot0 price (see `_quoteStandardFill`):
     *        - standard estimate >  trader's floor   → STANDARD venue. The
     *          aggregator route is never executed, so a weak/stale aggregator
     *          quote can neither force a worse fill nor consume gas.
     *        - trader's floor ≥ standard estimate    → AGGREGATOR venue. The
     *          floor is then already above the standard estimate, so the
     *          aggregator's own fill-time slippage check (`SwapOutputBelowMinimum`
     *          inside `_multiPoolOpenAggregator`) forces its ACTUAL delivered
     *          output to exceed the standard venue's output or the whole fill
     *          reverts.
     *        - standard venue uninitialized          → AGGREGATOR venue with the
     *          trader's floor (nothing on-chain to compete against).
     *      Authorizations (solver whitelist/intent) and margin/borrow legs are
     *      delegated to the chosen venue's internal open, so the standard and
     *      aggregator executions stay byte-identical to their entrypoints.
     */
    function _bestRouteOpen(
        SwapParams memory params,
        address trader,
        AggregatorRoute memory route,
        uint256 ethAttached,
        address refundRecipient,
        bool solverAuthorizedByIntent
    ) internal returns (bytes memory) {
        if (block.timestamp > params.deadline) revert DeadlineExpired();

        uint256 marginAmount =
            uint256(int256(params.amountSpecified < 0 ? -params.amountSpecified : params.amountSpecified));
        uint256 borrowAmount = marginAmount * uint256(params.leverage - 1);
        uint256 notional = marginAmount + borrowAmount;

        // Deterministic standard-venue quote at the execution pool's live slot0
        // (0.1% execution discount, mirroring the public quoter's parity model).
        (uint256 standardOut, bool standardComputable) =
            _quoteStandardFill(params.standardPoolKey, params.zeroForOne, notional);

        // Standard wins when it meets the trader's floor (or isn't priceable —
        // an uninitialized execution pool has nothing to compete against, so the
        // aggregator fills). Otherwise the trader demands more than the standard
        // venue can deliver; only the aggregator can fill it, and its floor is
        // then already above the standard estimate, forcing genuine
        // outperformance or a revert.
        if (!standardComputable || standardOut >= params.minAmountOut) {
            return _multiPoolOpen(params, trader, trader, ethAttached, refundRecipient, solverAuthorizedByIntent);
        }
        return _multiPoolOpenAggregator(params, trader, route, ethAttached, refundRecipient, solverAuthorizedByIntent);
    }

    /// @dev Deterministic spot-depth estimate of a NOTIONAL-sized fill on the
    ///      given execution pool — the same projection the public `quoteExactInput`
    ///      quoter uses (slot0 price, 0.1% execution discount). Returns
    ///      `(0, false)` when the pool is uninitialized so the caller can fall
    ///      back to the aggregator venue.
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

    /**
     * @notice Permissionless liquidation entrypoint for keepers.
     * @dev Anyone may trigger the liquidation of an underwater position. The hook
     *      validates the position is actually liquidatable and enforces slippage
     *      via minAmountOut, so permissionless access cannot force bad liquidations.
     * @param minAmountOut Minimum swap output for the liquidation unwind (slippage
     *                     protection against MEV); derive it from an oracle quote.
     */
    function liquidate(address hook, PoolKey calldata key, address trader, uint256 minAmountOut) external {
        manager.unlock(abi.encode(CallType.LIQUIDATE, hook, key, trader, minAmountOut, msg.sender));
    }

    /**
     * @notice [P1#3] Permissionless PARTIAL-liquidation entrypoint for keepers.
     * @dev Liquidates only `liquidationBps` (1-9999) of an underwater position;
     *      the remaining stake stays open. Slippage is enforced via `minAmountOut`
     *      against the unwind slice exactly like the full liquidation path.
     */
    function partialLiquidate(address hook, PoolKey calldata key, address trader, uint256 minAmountOut, uint256 liquidationBps)
        external
    {
        manager.unlock(
            abi.encode(CallType.PARTIAL_LIQUIDATION, hook, key, trader, minAmountOut, liquidationBps, msg.sender)
        );
    }

    /**
     * @notice Permissionless rebalancing entrypoint for keepers.
     * @dev Re-centers an out-of-range position's concentrated liquidity around the
     *      current tick. Safe to run permissionless: it only moves liquidity ranges,
     *      is a no-op when the tick is already in range, and the caller pays gas.
     */
    function rebalance(address hook, PoolKey calldata key, address trader) external {
        manager.unlock(abi.encode(CallType.REBALANCE, hook, key, trader));
    }

    function closePosition(address hook, PoolKey calldata key, address trader, address solver, uint256 minAmountOut)
        external
    {
        // [FIX C-1] Only the trader themselves can close their own position
        require(msg.sender == trader, "EswapRouter: only the trader can close their own position");
        manager.unlock(abi.encode(CallType.CLOSE, hook, key, trader, solver, minAmountOut));
    }

    function executeArbunDelivery(address hook, PoolKey calldata key, address trader) external {
        manager.unlock(abi.encode(CallType.ARBUN_DELIVERY, hook, key, trader));
    }

    function _closeCallback(address hook, PoolKey memory key, address trader, address solver, uint256 minAmountOut)
        internal
    {
        IEswapHook(hook).closePosition(key, trader, solver, minAmountOut);
    }

    /**
     * @notice Quoter-to-execution parity view helper for ODOS/Enso aggregators.
     * @dev Spot-depth approximation based on the real on-chain slot0 price of the
     *      EXECUTION venue: the deep standard pool when one is registered for this
     *      pair (multi-pool mode), else the hook pool itself.
     */
    function quoteExactInput(PoolKey calldata key, bool zeroForOne, int128 amountSpecified, uint8 leverage)
        external
        view
        returns (int128 amountOut)
    {
        if (leverage == 0 || leverage > 20 || amountSpecified == 0) return 0; // [FIX L-3] Raised cap from 5 to 20 to match protocol max
        int128 absAmount = amountSpecified < 0 ? -amountSpecified : amountSpecified;
        uint128 leveragedAmount = uint128(absAmount) * uint128(leverage);

        // Prefer the standard (deep-fill) pool's price: in multi-pool mode that is
        // where the physical swap executes, so quoting it keeps parity.
        PoolKey memory execKey = key;
        try IEswapHook(key.hooks).standardPoolKeys(key.toId()) returns (
            Currency sc0, Currency sc1, uint24 sf, int24 sts, address sh
        ) {
            if (Currency.unwrap(sc0) != address(0)) {
                execKey = PoolKey({currency0: sc0, currency1: sc1, fee: sf, tickSpacing: sts, hooks: sh});
            }
        } catch {}

        // Fetch slot0 price of the execution pool
        (uint160 sqrtPriceX96,,,) =
            StateLibrary.getSlot0(RealIPoolManager(address(manager)), RealPoolId.wrap(PoolId.unwrap(execKey.toId())));
        if (sqrtPriceX96 == 0) {
            // M-3 FIX: Revert instead of returning misleading 1:1 for uninitialized pools
            revert("Pool not initialized");
        }

        uint256 output;
        if (zeroForOne) {
            // outputUnits = inputUnits * (sqrtPriceX96^2) / 2^192
            output = FullMath.mulDiv(leveragedAmount, uint256(sqrtPriceX96), 1 << 96);
            output = FullMath.mulDiv(output, uint256(sqrtPriceX96), 1 << 96);
        } else {
            // outputUnits = inputUnits * 2^192 / (sqrtPriceX96^2)
            uint256 temp = FullMath.mulDiv(leveragedAmount, 1 << 96, uint256(sqrtPriceX96));
            output = FullMath.mulDiv(temp, 1 << 96, uint256(sqrtPriceX96));
        }
        // Apply a conservative 0.1% discount so the quote closely matches actual
        // execution output on the standard Uniswap pool (which has its own fee + slippage).
        // This prevents aggregators from penalising the protocol for quote-vs-execution divergence.
        output = (output * 9990) / 10000;
        return int128(uint128(output));
    }

    /// @dev [FIX M-4] Safe ETH transfer without a hard 2300-gas stipend so
    ///      contract recipients cannot brick the refund.
    function _safeTransferETH(address to, uint256 amount) internal {
        if (amount == 0) return;
        (bool ok, ) = payable(to).call{value: amount}("");
        require(ok, "ETH refund failed");
    }

    function _slice(bytes memory b, uint256 from) internal pure returns (bytes memory out) {
        out = new bytes(b.length - from);
        for (uint256 i = 0; i < out.length; i++) {
            out[i] = b[from + i];
        }
    }
}
