// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IPoolManager} from "./interfaces/IPoolManager.sol";
import {PoolKey} from "./types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "./types/PoolId.sol";
import {Currency} from "./types/Currency.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol"; // [FIX L-2]
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {BalanceDelta, BalanceDeltaLibrary} from "./types/BalanceDelta.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {IPoolManager as RealIPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolId as RealPoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {EswapMarginLib} from "./EswapMarginLib.sol";

interface IEswapHook {
    function executeLiquidation(PoolKey calldata key, address trader, uint256 minAmountOut, address liquidator) external;
    function partialLiquidation(PoolKey calldata key, address trader, uint256 minAmountOut, address liquidator, uint256 liquidationBps) external;
    function rebalancePosition(PoolKey calldata key, address trader) external;
    function deployCollateral(PoolKey calldata key, address trader) external;
    function closePosition(PoolKey calldata key, address trader, address solver, uint256 minAmountOut) external;
    function registerSolverDebt(PoolId poolId, address trader, address solver, uint256 principal) external;
    function setStandardPoolKey(PoolId poolId, PoolKey calldata key) external;
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
    function clearJITDelta(Currency token, address to, uint256 amount) external;
}

// [P0#2] Signed limit / stop-loss trigger orders, ERC-7683 CrossChainOrder
// initiation, JIT spot swaps and atomic margin trades moved to EswapRouterExt
// (companion contract) so the core router fits under the EIP-170 code-size cap.
// Trigger-order execution re-enters PoolManager through the COMPANION's own
// unlockCallback; signature domains stay pinned to THIS router.

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
    Ownable2Step, // [FIX L-2]
    ReentrancyGuard
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

    // Aggregator fill venues (0x ExchangeProxy / ParaSwap Augustus / etc.) that
    // the router may delegate the notional swap leg to. Non-whitelisted proxies
    // revert — this is the ONLY address allowed to touch margin/borrow funds in
    // flight, so a compromised/absurd proxy can never be used to steal them.
    mapping(address => bool) public allowedAggregators;

    // [AUDIT CRIT-4] Executor whitelist. `swapFor` / `swapMultiPoolFor` pull the
    // margin leg from an arbitrary caller-supplied `trader`; without a gate, any
    // attacker who finds a victim with a live router approval can open (and then
    // liquidate) a position with attacker-picked params, burning the victim's
    // margin. Only the trader himself or a governance-whitelisted executor
    // (bridge destination executor, adapter, open-netting relay) may open on
    // behalf of someone else.
    mapping(address => bool) public executorWhitelist;

    bytes32 public immutable DOMAIN_SEPARATOR;

    enum CallType {
        SWAP,
        CLOSE,
        LIQUIDATE,
        // [P1#3] Liquidates a proportional slice of an underwater position,
        // keeping the remainder open (see EswapMarginHookLogic.partialLiquidate).
        PARTIAL_LIQUIDATION,
        REBALANCE,
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
        MULTI_POOL_INTENT_OPEN
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
    // Moved to EswapRouterExt: TriggerOrder struct, TRIGGER_ORDER_TYPEHASH,
    // triggerPriceFeed, armedTriggerOrders, executedTriggerOrders, its errors
    // and events, and the arm/execute/cancel entrypoints all live on the
    // companion contract (which re-enters PoolManager for the close through its
    // own unlockCallback).

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

    function setAllowedAggregator(address exchangeProxy, bool allowed) external onlyOwner {
        allowedAggregators[exchangeProxy] = allowed;
        emit AggregatorWhitelistUpdated(exchangeProxy, allowed);
    }

    /// @notice [AUDIT CRIT-4] Governance gates who may relay `swapFor` /
    ///         `swapMultiPoolFor` on behalf of an arbitrary trader.
    function setExecutorWhitelist(address executor, bool approved) external onlyOwner {
        executorWhitelist[executor] = approved;
    }

    event AggregatorWhitelistUpdated(address indexed exchangeProxy, bool allowed);
    event ExecutorWhitelistUpdated(address indexed executor, bool approved);

    // --- EswapRouterExt passthroughs --------------------------------
    //
    // The router's companion (EswapRouterExt) hosts the off-core surfaces
    // (signed trigger orders, JIT spot swaps) so this contract fits EIP-170.
    // The EswapMarginHook only trusts THIS router (and the PoolManager) as its
    // caller for close / JIT-delta accounting, so the ext performs those actions
    // through these two ext-gated passthroughs. Only the designated ext may call
    // them; they add no public capability that the router itself didn't already
    // have before the split.

    /// @dev Owner-sets the companion contract address. The ext is deployed AFTER
    ///      the router (its constructor pins this router's domain), so it cannot
    ///      be wired in the constructor.
    address public routerExt;

    function setRouterExt(address _ext) external onlyOwner {
        routerExt = _ext;
        emit RouterExtSet(_ext);
    }

    event RouterExtSet(address indexed ext);

    /// @notice Ext-gated trigger-close: re-enters the PoolManager with the same
    ///         CLOSE the router's own `closePosition` uses, so the hook sees
    ///         `msg.sender == address(this)`. `solver` is the ext (executor).
    function extTriggerClose(address hook, PoolKey calldata key, address trader, uint256 minAmountOut) external {
        require(msg.sender == routerExt, "EswapRouter: ext only");
        manager.unlock(abi.encode(CallType.CLOSE, hook, key, trader, msg.sender, minAmountOut));
    }

    /// @notice Ext-gated JIT-delta release: forwards the hook's `clearJITDelta`
    ///         from THIS router's address, preserving the hook's onlyRouter gate.
    function extClearJITDelta(address hook, Currency token, address to, uint256 amount) external {
        require(msg.sender == routerExt, "EswapRouter: ext only");
        IEswapHook(hook).clearJITDelta(token, to, amount);
    }

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
    error ExecutorUnauthorized();
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
    /// [AUDIT CRIT-4] Only `trader` himself or a whitelisted executor may relay.
    function swapFor(SwapParams calldata params, address trader) external payable returns (bytes memory) {
        if (msg.sender != trader && !executorWhitelist[msg.sender]) revert ExecutorUnauthorized();
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
    /// [AUDIT CRIT-4] Only `trader` himself or a whitelisted executor may relay.
    function swapMultiPoolFor(SwapParams calldata params, address trader) external payable returns (bytes memory) {
        if (msg.sender != trader && !executorWhitelist[msg.sender]) revert ExecutorUnauthorized();
        return _swapMultiPool(params, trader);
    }

    /// @notice CoW-settlement variant of swapMultiPoolFor: opens a leveraged
    ///         position credited to `trader` (the recovered CoW order owner)
    ///         while the MARGIN leg is pulled from `marginFunder` (the CoW
    ///         solver). Lets CoW solvers fund intents without the trader ever
    ///         approving this router. The borrowed leg is pulled from
    ///         `params.solver`, which for leverage > 1 must be EITHER
    ///         governance-whitelisted OR fully capitalised in
    ///         `erc20BorrowEscrow[params.solver][borrowToken]` for the whole
    ///         `borrowAmount`. The escrow leg is what makes the orderbook
    ///         permissionless: an anonymous CoW solver can bond the notional and
    ///         fill without a per-address allowlist entry, and receives the
    ///         position's rehypothecation yield as `positionSolver`.
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
        nonReentrant
        returns (bytes memory)
    {
        require(allowedAggregators[route.exchangeProxy], "Aggregator not whitelisted");
        // [FIX] Execute the external aggregator fill BEFORE entering the PoolManager
        // lock. A real route frequently fills through a Uniswap V4 pool, and the
        // aggregator calls `PoolManager.unlock()` for that leg; if the router is
        // already inside its own unlock/callback that nested unlock reverts with
        // `AlreadyUnlocked` and breaks every V4-leg fill (on Unichain every pool IS
        // V4). Funding, fill and output measure run here, unlocked; only the hook
        // accounting that needs the PM (mint/sync/settle) stays in the callback.
        (uint256 notional, uint256 outputAmount) = _aggregatorPrefill(params, trader, route, false);
        return manager.unlock(
            abi.encode(
                CallType.MULTI_POOL_AGGREGATOR_SWAP,
                params,
                trader,
                outputAmount,
                notional,
                msg.value,
                msg.sender
            )
        );
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
        if (!_isValidSignature(trader, digest, signature)) revert InvalidIntentSignature();

        // One intent = one fill: consume the (trader, nonce) pair.
        bytes32 fillId = keccak256(abi.encode(trader, intent.nonce));
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

        return manager.unlock(abi.encode(CallType.MULTI_POOL_INTENT_OPEN, params, trader, msg.value, msg.sender));
    }

    // ─── [P0#2] Signed limit / stop-loss TriggerOrder ────────────────────────
    // Trigger-order arm/execute/cancel + ERC-7683 hashOrder moved to
    // EswapRouterExt (companion contract). The keep-copy of the signature
    // checker below also serves swapWithIntent.

    /// @dev [AUDIT HIGH-01] Signature verification that (a) rejects ECDSA
    ///      malleability via OpenZeppelin ECDSA (canonical low-s, v∈{27,28},
    ///      padded-v normalization), and (b) supports ERC-1271 contract wallets
    ///      (Safe, Argent, Kernel, ...) through SignatureChecker so two-factor /
    ///      smart-wallet traders can sign intents. `expectedSigner` is always
    ///      known at the call sites (trader / msg.sender / order.swapper).
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
     * @notice ERC-7683 (initiate / resolve) and atomic-margin (atomicMarginTrade)
     *      Moved to EswapRouterExt. initiate forwards fills to this router's
     *      swapMultiPoolFor; the cross-chain order signature domain stays pinned
     *      to THIS router (ext mirrors it).
     */
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
            (, SwapParams memory params, address trader, uint256 outputAmount, uint256 notional, uint256 ethAttached, address refundRecipient) =
                abi.decode(data, (CallType, SwapParams, address, uint256, uint256, uint256, address));
            return _multiPoolOpenAggregator(params, trader, outputAmount, notional, ethAttached, refundRecipient);
        } else if (callType == CallType.MULTI_POOL_INTENT_OPEN) {
            (, SwapParams memory params, address trader, uint256 ethAttached, address refundRecipient) =
                abi.decode(data, (CallType, SwapParams, address, uint256, address));
            return _multiPoolOpen(params, trader, trader, ethAttached, refundRecipient, true);
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
        }
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

        Currency input = params.zeroForOne ? params.key.currency0 : params.key.currency1;
        Currency output = params.zeroForOne ? params.key.currency1 : params.key.currency0;
        bool inputNative = Currency.unwrap(input) == address(0);

        // H-3 FIX: the borrow-leg solver must be EITHER governance-whitelisted OR
        // fully collateralised in `erc20BorrowEscrow` for this borrow token.
        //
        // [P0#1] The borrow leg is drawn from the solver's own pre-funded escrow
        // first (see the draw below), so an escrow that covers the whole notional
        // makes the solver capitalised rather than credit-exposed: they post the
        // tokens, the hook records them as `positionSolver[poolId][trader]`, they
        // are repaid principal out of the position, and the position's
        // rehypothecation yield is routed to them. An undercapitalised solver
        // therefore loses exactly the notional they chose to bond and nothing
        // else — default is bounded by the bond, not by an allowlist.
        //
        // That is what lets permissionless external solvers (CoW orderbook
        // solvers, searchers) fund borrows with no per-address governance entry,
        // which is what makes aggregator-sourced demand liquid. It also means a
        // collateralised solver needs NO per-trade `approve` (the whole notional
        // comes out of escrow, so the `transferFrom` remainder is zero).
        //
        // The whitelist is retained for the two cases escrow cannot cover: the
        // uncollateralised remainder leg, and native-margin borrows.
        if (params.leverage > 1 && !registeredSolvers[params.solver]) {
            if (inputNative) revert SolverNotAuthorized();
            uint256 escrowed = erc20BorrowEscrow[params.solver][Currency.unwrap(input)];
            if (escrowed < borrowAmount) revert SolverNotAuthorized();
        }

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
            // [P0#1] The whitelist is now ONE of THREE authorization legs:
            //   1. governance registration, or
            //   2. the trader's signed LendingIntent (`solverAuthorizedByIntent`), or
            //   3. FULL capitalisation in `erc20BorrowEscrow` for the borrow token.
            //
            // Leg 3 is what lets EXTERNAL, ANONYMOUS solvers fund the borrow leg
            // with no per-address governance entry — the CoW orderbook case. A CoW
            // solver bidding on an order cannot produce an Eswap LendingIntent
            // signature, so without leg 3 it could only ever fill if governance
            // pre-whitelisted it, which is impossible for an anonymous solver set.
            //
            // Leg 3 is capitalised, not credit: the whole notional comes out of the
            // solver's own pre-funded escrow (drawn before any `transferFrom`, so a
            // collateralised solver needs no per-trade approval), the hook records
            // them as `positionSolver[poolId][trader]`, they are repaid principal
            // out of the position, and the position's rehypothecation yield is
            // routed to them. An undercapitalised solver forfeits exactly the
            // notional they chose to bond and nothing else, so default is bounded
            // by the bond rather than by an allowlist. The escrow is spent per
            // fill, so cumulative exposure can never exceed cumulative deposits.
            //
            // Native-margin borrows are excluded: escrow is ERC20-only, so a native
            // leg has no collateral to test and stays whitelist/intent only.
            if (!registeredSolvers[params.solver] && !solverAuthorizedByIntent) {
                address borrowToken = Currency.unwrap(params.zeroForOne ? params.key.currency0 : params.key.currency1);
                if (borrowToken == address(0)) revert SolverNotAuthorized();
                if (erc20BorrowEscrow[params.solver][borrowToken] < borrowAmount) revert SolverNotAuthorized();
            }
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
     * @notice Aggregator-fill prelude: pulls the margin and solver-funded borrow
     *         legs into the router, approves the whitelisted exchange proxy,
     *         executes the REAL quote calldata and measures the delivered output.
     *         Runs OUTSIDE the PoolManager lock (called by the nonReentrant
     *         aggregator entrypoint) so routes that fill through a Uniswap V4
     *         pool can call `PoolManager.unlock()` themselves without hitting
     *         `AlreadyUnlocked` — every pool on the target chain (Unichain) is
     *         V4, so an in-lock fill would always revert. The PM-backed
     *         accounting (mint/sync/settle) still runs inside the unlock
     *         callback via `_aggregatorSettle`.
     * @return notional      margin + borrow pulled into the router
     * @return outputAmount  the output the aggregator actually delivered
     */
    function _aggregatorPrefill(
        SwapParams memory params,
        address trader,
        AggregatorRoute memory route,
        bool solverAuthorizedByIntent
    ) internal returns (uint256 notional, uint256 outputAmount) {
        // [FIX L-4] Reject fills past the signed deadline.
        if (block.timestamp > params.deadline) revert DeadlineExpired();
        uint256 marginAmount =
            uint256(int256(params.amountSpecified < 0 ? -params.amountSpecified : params.amountSpecified));
        uint256 borrowAmount = marginAmount * uint256(params.leverage - 1);
        notional = marginAmount + borrowAmount;
        if (params.leverage > 1) {
            require(params.solver != address(0), "Solver required for leverage");
            // [P0#1] Third authorization leg, mirroring `_multiPoolOpen`: FULL
            // capitalisation in `erc20BorrowEscrow` for the borrow token. This is
            // the leg that lets an external, anonymous solver fund an
            // aggregator-sourced leveraged fill without a per-address whitelist
            // entry — the whole notional comes out of the solver's own bond, and
            // the position's rehypothecation yield is routed back to them via
            // `positionSolver`. Native legs have no escrow to test, so they stay
            // whitelist/intent only.
            if (!registeredSolvers[params.solver] && !solverAuthorizedByIntent) {
                address borrowToken = Currency.unwrap(params.zeroForOne ? params.key.currency0 : params.key.currency1);
                if (borrowToken == address(0)) revert SolverNotAuthorized();
                if (erc20BorrowEscrow[params.solver][borrowToken] < borrowAmount) revert SolverNotAuthorized();
            }
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
            // Propagate ANY revert payload (Error(string) custom errors, panic)
            // verbatim so the cause is visible to the caller/tooling.
            if (ret.length >= 4) {
                assembly {
                    revert(add(ret, 32), mload(ret))
                }
            }
            revert AggregatorFillFailed();
        }

// 3. Measure the actual output delivered by the real aggregator fill.
        outputAmount = IERC20(Currency.unwrap(output)).balanceOf(address(this)) - outBefore;
        require(outputAmount > 0, "Aggregator output zero");
        // [AUDIT CRIT-5] Never leave a dangling allowance to the exchange proxy.
        // A proxy that consumed less than the approved `notional` would otherwise
        // keep a live transfer right to the router's collateral across fills; an
        // attacker could route a later victim's tokens through that leftover
        // allowance. Reset to 0 unconditionally so every fill re-authorizes fresh.
        IERC20(Currency.unwrap(input)).forceApprove(route.exchangeProxy, 0);
        // [FIX C-4] Enforce the caller's slippage floor on the executed output.
        if (outputAmount < params.minAmountOut) revert SwapOutputBelowMinimum(outputAmount, params.minAmountOut);
    }

    /**
     * @notice Post-fill accounting tail the aggregator paths share: validate the
     *         open in the hook, pin the deliverable as ERC-6909 collateral in the
     *         hook, settle the held ERC20 into the PoolManager, register the
     *         solver debt, refund attached native value and optionally deploy
     *         rehypothecated collateral. Must run inside a `manager.unlock`
     *         callback because it uses `mint/sync/settle`.
     */
    function _aggregatorSettle(
        SwapParams memory params,
        address trader,
        uint256 outputAmount,
        uint256 notional,
        uint256 ethAttached,
        address refundRecipient
    ) internal returns (bytes memory) {
        Currency output = params.zeroForOne ? params.key.currency1 : params.key.currency0;
        uint256 marginAmount =
            uint256(int256(params.amountSpecified < 0 ? -params.amountSpecified : params.amountSpecified));
        uint256 borrowAmount = notional - marginAmount;

        // 4. Hook validates the open and records position accounting — identical
        //    to `_multiPoolOpen`: the hook never sees or cares HOW the fill happened.
        IEswapHook(params.key.hooks)
            .registerMarginOpen(params.key, trader, params.leverage, marginAmount, borrowAmount, output, outputAmount);

        // 5. Collateral custody: the aggregator's output sits at the ROUTER (not
        //    the PM as in the standard pool path). Mint the 6909 claim to the hook
        //    (router -output), then sync+settle the held ERC20 into the PM to zero
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
     * @notice Hoisted aggregator open (accounting only). The external fill already
     *         ran OUTSIDE the PoolManager lock in `swapMultiPoolForAggregator`, so
     *         a real route filling through a Uniswap V4 pool (every pool on
     *         Unichain) can execute its own `PoolManager.unlock()` without
     *         `AlreadyUnlocked`. `outputAmount`/`notional` are computed by the
     *         entrypoint's `_aggregatorPrefill` and carried through this callback.
     */
    function _multiPoolOpenAggregator(
        SwapParams memory params,
        address trader,
        uint256 outputAmount,
        uint256 notional,
        uint256 ethAttached,
        address refundRecipient
    ) internal returns (bytes memory) {
        require(outputAmount > 0, "Aggregator output zero");
        if (outputAmount < params.minAmountOut) revert SwapOutputBelowMinimum(outputAmount, params.minAmountOut);
return _aggregatorSettle(params, trader, outputAmount, notional, ethAttached, refundRecipient);
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
     * @notice Re-centers an out-of-range position's concentrated liquidity around
     *         the current tick.
     * @dev [AUDIT MED-4] NOT permissionless: rebalance removes and re-deploys a
     *      trader's LP band and rewrites `pos.collateralAmount` to the physically
     *      recovered value (sensitive when adverse drift causes impermanent loss).
     *      Only the trader themselves or a governance-whitelisted executor
     *      (keeper, adapter, bridge relay) may trigger it, eliminating griefing
     *      gas-burn and forced early liquidation.
     */
    function rebalance(address hook, PoolKey calldata key, address trader) external {
        require(msg.sender == trader || executorWhitelist[msg.sender], "EswapRouter: rebalance unauthorized");
        manager.unlock(abi.encode(CallType.REBALANCE, hook, key, trader));
    }

    function closePosition(address hook, PoolKey calldata key, address trader, address solver, uint256 minAmountOut)
        external
    {
        // [FIX C-1] Only the trader themselves can close their own position
        require(msg.sender == trader, "EswapRouter: only the trader can close their own position");
        manager.unlock(abi.encode(CallType.CLOSE, hook, key, trader, solver, minAmountOut));
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
}
