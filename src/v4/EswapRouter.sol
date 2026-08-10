// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IPoolManager} from "./interfaces/IPoolManager.sol";
import {PoolKey} from "./types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "./types/PoolId.sol";
import {Currency} from "./types/Currency.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {BalanceDelta, BalanceDeltaLibrary} from "./types/BalanceDelta.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {IPoolManager as RealIPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolId as RealPoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";

interface IEswapHook {
    function executeLiquidation(PoolKey calldata key, address trader, uint256 minAmountOut) external;
    function rebalancePosition(PoolKey calldata key, address trader) external;
    function deployCollateral(PoolKey calldata key, address trader) external;
    function closePosition(PoolKey calldata key, address trader, address solver, uint256 minAmountOut) external;
    function registerSolverDebt(PoolId poolId, address trader, address solver, uint256 principal) external;
    function setStandardPoolKey(PoolId poolId, PoolKey calldata key) external;
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
contract EswapRouter is Ownable {
    using PoolIdLibrary for PoolKey;
    using BalanceDeltaLibrary for BalanceDelta;

    IPoolManager public immutable manager;

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

    enum CallType { SWAP, CLOSE, LIQUIDATE, REBALANCE, ATOMIC_MARGIN }

    struct AtomicMarginParams {
        PoolKey key;
        PoolKey standardPoolKey;
        bool zeroForOne;
        uint256 borrowAmount;
        uint256 minProfit;
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
    }

    function swap(SwapParams calldata params) external returns (bytes memory) {
        return manager.unlock(abi.encode(CallType.SWAP, params, msg.sender));
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

        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                DOMAIN_SEPARATOR,
                hashOrder(order)
            )
        );
        address swapper = _recoverSigner(digest, signature);
        require(swapper == order.swapper && swapper != address(0), "Invalid signature");

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
            hookData: hookData
        });

        manager.unlock(abi.encode(CallType.SWAP, params, swapper));
    }

    /**
     * @notice ERC-7683 Order Resolution Interface.
     * Decodes the cross-chain order's custom parameters for solvers/aggregators to inspect inputs/outputs.
     */
    function resolve(CrossChainOrder calldata order, bytes calldata) external view returns (ResolvedCrossChainOrder memory resolved) {
        (
            PoolKey memory key,
            ,
            bool zeroForOne,
            int256 amountSpecified,
            uint8 leverage,
            ,
        ) = abi.decode(order.orderData, (PoolKey, PoolKey, bool, int256, uint8, address, bytes));

        resolved.settlementContract = order.settlementContract;
        resolved.swapper = order.swapper;
        resolved.nonce = order.nonce;
        resolved.originChainId = order.originChainId;
        resolved.initiateDeadline = order.initiateDeadline;
        resolved.fillDeadline = order.fillDeadline;

        resolved.swapperInputs = new Input[](1);
        address inputToken = zeroForOne ? Currency.unwrap(key.currency0) : Currency.unwrap(key.currency1);
        uint256 marginAmount = uint256(amountSpecified < 0 ? -amountSpecified : amountSpecified);
        resolved.swapperInputs[0] = Input({
            token: inputToken,
            amount: marginAmount
        });

        resolved.swapperOutputs = new Output[](1);
        address outputToken = zeroForOne ? Currency.unwrap(key.currency1) : Currency.unwrap(key.currency0);
        resolved.swapperOutputs[0] = Output({
            token: outputToken,
            amount: marginAmount * leverage,
            chainId: order.originChainId,
            recipient: order.swapper
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
        } else if (callType == CallType.CLOSE) {
            (, address hook, PoolKey memory key, address trader, address solver, uint256 minAmountOut) = abi.decode(data, (CallType, address, PoolKey, address, address, uint256));
            _closeCallback(hook, key, trader, solver, minAmountOut);
            return "";
        } else if (callType == CallType.LIQUIDATE) {
            (, address hook, PoolKey memory key, address trader, uint256 minAmountOut) = abi.decode(data, (CallType, address, PoolKey, address, uint256));
            IEswapHook(hook).executeLiquidation(key, trader, minAmountOut);
            return "";
        } else if (callType == CallType.REBALANCE) {
            (, address hook, PoolKey memory key, address trader) = abi.decode(data, (CallType, address, PoolKey, address));
            IEswapHook(hook).rebalancePosition(key, trader);
            return "";
        } else if (callType == CallType.ATOMIC_MARGIN) {
            (, AtomicMarginParams memory params, address trader) = abi.decode(data, (CallType, AtomicMarginParams, address));
            return _atomicMarginCallback(params, trader);
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
        IERC20(Currency.unwrap(input)).transfer(address(manager), params.borrowAmount);
        manager.settle();

        BalanceDelta deltaPhysical = manager.swap(
            params.standardPoolKey,
            IPoolManager.SwapParams(params.zeroForOne, -int256(params.borrowAmount), 0),
            ""
        );

        int128 receivedOutputDelta = params.zeroForOne ? deltaPhysical.amount1() : deltaPhysical.amount0();
        require(receivedOutputDelta > 0, "Swap output zero");
        uint256 receivedOutputAmount = uint256(int256(receivedOutputDelta));

        manager.take(output, address(this), receivedOutputAmount);

        // 3. Second leg: swap output token back to input token on hook pool
        bool oppositeZeroForOne = !params.zeroForOne;
        manager.sync(output);
        IERC20(Currency.unwrap(output)).transfer(address(manager), receivedOutputAmount);
        manager.settle();

        // Pass non-margin hookData to EswapMarginHook to skip persistent margin position updates
        bytes memory hookData = abi.encode(false, uint8(1), trader);
        BalanceDelta deltaHook = manager.swap(
            params.key,
            IPoolManager.SwapParams(oppositeZeroForOne, -int256(receivedOutputAmount), 0),
            hookData
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
        IERC20(Currency.unwrap(input)).transfer(address(manager), params.borrowAmount);
        manager.settle();

        // 6. Pay profit to trader with 0 capital used
        if (profit > 0) {
            IERC20(Currency.unwrap(input)).transfer(trader, profit);
        }

        return abi.encode(profit);
    }

    /**
     * @notice SDIM single-pool unlock callback. Executes the margin swap, settles
     *         the trader's margin + the solver's borrow, mints the collateral
     *         claim to the hook, and registers the solver debt.
     * @dev All PoolManager transient deltas must net to zero here or the real
     *      PoolManager reverts CurrencyNotSettled on unlock exit.
     */
    function _swapCallback(SwapParams memory params, address trader) internal returns (bytes memory) {
        uint256 marginAmount = uint256(int256(params.amountSpecified < 0 ? -params.amountSpecified : params.amountSpecified));
        uint256 borrowAmount = marginAmount * uint256(params.leverage - 1);
        if (params.leverage > 1) {
            require(params.solver != address(0), "Solver required for leverage");
        }

        bool isMultiPool = (Currency.unwrap(params.standardPoolKey.currency0) != address(0));

        BalanceDelta delta;
        uint256 outputAmount;
        Currency input = params.zeroForOne ? params.key.currency0 : params.key.currency1;
        Currency output = params.zeroForOne ? params.key.currency1 : params.key.currency0;

        if (isMultiPool) {
            // (1) Margin swap on the hook pool (for accounting / leverage accounting / position registration).
            delta = manager.swap(
                params.key,
                IPoolManager.SwapParams(params.zeroForOne, params.amountSpecified, 0),
                params.hookData
            );

            // (2) Settle the trader's margin (router's -margin delta from the swap)
            if (marginAmount > 0) {
                manager.sync(input);
                IERC20(Currency.unwrap(input)).transferFrom(trader, address(manager), marginAmount);
                manager.settle();
            }

            // (3) Swap the combined margin + borrow on the standard pool
            BalanceDelta deltaPhysical = manager.swap(
                params.standardPoolKey,
                IPoolManager.SwapParams(params.zeroForOne, -int256(marginAmount + borrowAmount), 0),
                ""
            );

            int128 outputDelta = params.zeroForOne ? deltaPhysical.amount1() : deltaPhysical.amount0();
            require(outputDelta > 0, "Swap output zero");
            outputAmount = uint256(int256(outputDelta));

            // Set standard pool key mapping on the hook
            IEswapHook(params.key.hooks).setStandardPoolKey(params.key.toId(), params.standardPoolKey);
        } else {
            // Legacy single-pool routing
            delta = manager.swap(
                params.key,
                IPoolManager.SwapParams(params.zeroForOne, params.amountSpecified, 0),
                params.hookData
            );

            int128 outputDelta = params.zeroForOne ? delta.amount1() : delta.amount0();
            require(outputDelta > 0, "Swap output zero");
            outputAmount = uint256(int256(outputDelta));

            if (marginAmount > 0) {
                manager.sync(input);
                IERC20(Currency.unwrap(input)).transferFrom(trader, address(manager), marginAmount);
                manager.settle();
            }
        }

        // (4) Mint the collateral as an ERC-6909 claim held by the hook.
        manager.mint(address(params.key.hooks), uint256(uint160(Currency.unwrap(output))), outputAmount);

        // (5) Settle the solver's borrow FOR THE HOOK: the hook flash-provided
        //     the borrow leg, so it carries a -borrowAmount transient delta that
        //     settleFor(hook) zeroes.
        if (borrowAmount > 0) {
            manager.sync(input);
            IERC20(Currency.unwrap(input)).transferFrom(params.solver, address(manager), borrowAmount);
            manager.settleFor(address(params.key.hooks));
        }

        // (6) Register the on-chain solver debt (principal + yield) guaranteeing
        //     solver repayment before trader withdrawal.
        if (borrowAmount > 0) {
            IEswapHook(params.key.hooks).registerSolverDebt(params.key.toId(), trader, params.solver, borrowAmount);
        }

        if (params.hookData.length > 0) {
            (bool isMargin, , ) = abi.decode(params.hookData, (bool, uint8, address));
            if (isMargin) {
                try IEswapHook(params.key.hooks).deployCollateral(params.key, trader) {} catch {}
            }
        }

        return abi.encode(delta);
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
        manager.unlock(abi.encode(CallType.LIQUIDATE, hook, key, trader, minAmountOut));
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

    function closePosition(address hook, PoolKey calldata key, address trader, address solver, uint256 minAmountOut) external {
        manager.unlock(abi.encode(CallType.CLOSE, hook, key, trader, solver, minAmountOut));
    }

    function _closeCallback(address hook, PoolKey memory key, address trader, address solver, uint256 minAmountOut) internal {
        IEswapHook(hook).closePosition(key, trader, solver, minAmountOut);
    }

    /**
     * @notice Quoter-to-execution parity view helper for ODOS/Enso aggregators.
     * @dev Spot-depth approximation based on the real on-chain slot0 price.
     */
    function quoteExactInput(
        PoolKey calldata key,
        bool zeroForOne,
        int128 amountSpecified,
        uint8 leverage
    ) external view returns (int128 amountOut) {
        if (leverage == 0 || leverage > 5 || amountSpecified == 0) return 0;
        int128 absAmount = amountSpecified < 0 ? -amountSpecified : amountSpecified;
        uint128 leveragedAmount = uint128(absAmount) * uint128(leverage);

        // Fetch slot0 price of the pool
        (uint160 sqrtPriceX96, , , ) = StateLibrary.getSlot0(RealIPoolManager(address(manager)), RealPoolId.wrap(PoolId.unwrap(key.toId())));
        if (sqrtPriceX96 == 0) {
            // Fallback to 1:1 if uninitialized or custom mock
            return int128(uint128(leveragedAmount));
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
        return int128(uint128(output));
    }
}
