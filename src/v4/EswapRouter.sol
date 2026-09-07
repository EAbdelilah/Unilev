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

    // M-2: ERC-7683 nonce consumption
    mapping(bytes32 => bool) public filledOrders;

    // H-4: JIT swapper opt-in — swappers must approve JIT spot swaps
    mapping(address => bool) public jitApprovedSwappers;

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
        REBALANCE,
        ATOMIC_MARGIN,
        JIT_SPOT,
        ARBUN_DELIVERY,
        MULTI_POOL_SWAP
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

    function setJitApprovedSwapper(address swapper, bool approved) external onlyOwner {
        jitApprovedSwappers[swapper] = approved;
    }

    // M-11: Event for failed collateral deployment
    error InsufficientGasForCollateralDeployment(uint256 available, uint256 required);

    error DeadlineExpired();
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
    }

    function swap(SwapParams calldata params) external returns (bytes memory) {
        return _swap(params, msg.sender);
    }

    /// @notice Open a leveraged position on behalf of `trader`.
    /// For bridge/intent executors (Socket/Li.Fi/Rubic destination calldata):
    /// the executor relays the call but the position and margin belong to
    /// `trader`, who must have approved this router to pull the margin.
    function swapFor(SwapParams calldata params, address trader) external returns (bytes memory) {
        return _swap(params, trader);
    }

    function _swap(SwapParams calldata params, address trader) internal returns (bytes memory) {
        return manager.unlock(abi.encode(CallType.SWAP, params, trader));
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

    function _swapMultiPool(SwapParams calldata params, address trader) internal returns (bytes memory) {
        return manager.unlock(abi.encode(CallType.MULTI_POOL_SWAP, params, trader));
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
            bytes memory hookData
        ) = abi.decode(order.orderData, (PoolKey, PoolKey, bool, int256, uint8, address, bytes));

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
            deadline: uint256(order.fillDeadline)
        });

        // Aggregator intents fill on the DEEP standard pool (multi-pool mode):
        // execution depth comes from Uniswap's existing liquidity.
        manager.unlock(abi.encode(CallType.MULTI_POOL_SWAP, params, swapper));
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
            (, SwapParams memory params, address trader) = abi.decode(data, (CallType, SwapParams, address));
            return _swapCallback(params, trader);
        } else if (callType == CallType.MULTI_POOL_SWAP) {
            (, SwapParams memory params, address trader) = abi.decode(data, (CallType, SwapParams, address));
            return _multiPoolSwapCallback(params, trader);
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
    function _swapCallback(SwapParams memory params, address trader) internal returns (bytes memory) {
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

        // The hook pool executes the swap (flash-expanded by the borrow) and
        // records the position in afterSwap.
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

        // Settle the trader's margin (router's -margin delta from the swap)
        if (marginAmount > 0) {
            manager.sync(input);
            IERC20(Currency.unwrap(input)).safeTransferFrom(trader, address(manager), marginAmount);
            manager.settle();
        }

        // Mint the collateral as an ERC-6909 claim held by the hook, offsetting
        // the router's +output delta.
        manager.mint(address(params.key.hooks), uint256(uint160(Currency.unwrap(output))), outputAmount);

        // Settle the solver's borrow FOR THE HOOK: the hook flash-provided the
        // borrow leg, so it carries a -borrowAmount transient delta that
        // settleFor(hook) zeroes.
        if (borrowAmount > 0) {
            manager.sync(input);
            IERC20(Currency.unwrap(input)).safeTransferFrom(params.solver, address(manager), borrowAmount);
            manager.settleFor(address(params.key.hooks));
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
     *        settle margin:  -margin netted          (transferFrom trader)
     *        settle borrow:  -borrow netted          (transferFrom solver)
     *        mint claim:     -outStd netted          (6909 to hook)
     *      All deltas zero before unlock exits — the failure mode of the former
     *      multi-pool branch ([FIX V2] in _swapCallback) cannot recur because
     *      BOTH input legs are funded and the FULL output is minted as a claim.
     */
    function _multiPoolSwapCallback(SwapParams memory params, address trader) internal returns (bytes memory) {
        // [FIX L-4] Reject fills past the signed deadline.
        if (block.timestamp > params.deadline) revert DeadlineExpired();
        uint256 marginAmount =
            uint256(int256(params.amountSpecified < 0 ? -params.amountSpecified : params.amountSpecified));
        uint256 borrowAmount = marginAmount * uint256(params.leverage - 1);
        if (params.leverage > 1) {
            require(params.solver != address(0), "Solver required for leverage");
            require(registeredSolvers[params.solver], "Solver not whitelisted");
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

        // 2. Fund the router's -input transient delta from this unlock.
        //    ERC20 input: pull margin from trader and borrow from solver independently.
        //    Native input: the whole notional is covered by msg.value attached at the
        //    (payable) entrypoint — native has no approval/transferFrom, so a single
        //    ETH contribution funds both margin and the solver-borrow leg, and the
        //    solver is repaid in the output token at close.
        if (inputNative) {
            if (notional > 0) {
                require(address(this).balance >= notional, "Insufficient native input");
                manager.sync(input);
                manager.settle{value: notional}();
            }
        } else {
            if (marginAmount > 0) {
                manager.sync(input);
                IERC20(Currency.unwrap(input)).safeTransferFrom(trader, address(manager), marginAmount);
                manager.settle();
            }
            if (borrowAmount > 0) {
                manager.sync(input);
                IERC20(Currency.unwrap(input)).safeTransferFrom(params.solver, address(manager), borrowAmount);
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

        // 6. Refund any excess ETH attached at the entrypoint (native input leg).
        //    msg.value is 0 inside the unlock callback, so refund from the balance
        //    remaining after the native-input settle above.
        if (inputNative && notional > 0 && address(this).balance > 0) {
            payable(trader).transfer(address(this).balance);
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
}
