import {
    encodeAbiParameters,
    encodeFunctionData,
    keccak256,
    type AbiParameter,
    type Address,
    type Hex,
} from "viem";
import {
    ERC20_ABI,
    POOL_KEY_COMPONENTS,
    ROUTER_ABI,
    ROUTER_EXT_ABI,
    SETTLEMENT_ABI,
    TRIGGER_ORDER_COMPONENTS,
} from "./abis.js";
import { LEVERAGE, type PoolKey } from "./constants.js";
import type { SwapParams, TriggerOrder } from "./types.js";

const POOL_KEY_PARAMS = POOL_KEY_COMPONENTS as readonly AbiParameter[];
const TRIGGER_ORDER_PARAMS = TRIGGER_ORDER_COMPONENTS as readonly AbiParameter[];

/** viem encodes ABI `tuple` values positionally, not as named objects. */
export function poolKeyTuple(key: PoolKey) {
    return [key.currency0, key.currency1, key.fee, key.tickSpacing, key.hooks] as const;
}

export function triggerOrderTuple(order: TriggerOrder) {
    return [
        order.poolId,
        order.triggerPrice18,
        order.aboveOrBelow,
        order.minAmountOut,
        order.closeDeadline,
        order.nonce,
        order.executorTipBps,
    ] as const;
}

/** Uniswap v4 `PoolId = keccak256(abi.encode(currency0, currency1, fee, tickSpacing, hooks))`. */
export function poolIdOf(key: PoolKey): Hex {
    return keccak256(encodeAbiParameters(POOL_KEY_PARAMS, poolKeyTuple(key)));
}

/** `EswapRouter.swapMultiPool(SwapParams)` — the canonical leveraged open. */
export function encodeSwapMultiPool(params: SwapParams): Hex {
    return encodeFunctionData({
        abi: ROUTER_ABI,
        functionName: "swapMultiPool",
        args: [params],
    });
}

export function encodeApprove(token: Address, spender: Address, amount: bigint): Hex {
    return encodeFunctionData({
        abi: ERC20_ABI,
        functionName: "approve",
        args: [spender, amount],
    });
}

export function encodeDepositBorrowEscrow(token: Address, amount: bigint): Hex {
    return encodeFunctionData({
        abi: ROUTER_ABI,
        functionName: "depositBorrowEscrow",
        args: [token, amount],
    });
}

/** Refresh the hook's JIT collateral band without changing position size. */
export function encodeRebalancePosition(args: {
    hook: Address;
    key: PoolKey;
    trader: Address;
}): Hex {
    return encodeFunctionData({
        abi: ROUTER_ABI,
        functionName: "rebalance",
        args: [args.hook, args.key, args.trader],
    });
}

/**
 * `EswapRouter.closePosition` is trader-only. A keeper can only submit this
 * calldata from a trader-controlled account/Safe; use `executeTriggerOrder`
 * or `liquidate` for permissionless execution.
 */
export function encodeClosePosition(args: {
    hook: Address;
    key: PoolKey;
    trader: Address;
    solver: Address;
    minAmountOut: bigint;
}): Hex {
    return encodeFunctionData({
        abi: ROUTER_ABI,
        functionName: "closePosition",
        args: [args.hook, args.key, args.trader, args.solver, args.minAmountOut],
    });
}

/** Permissionless liquidation of an underwater position. */
export function encodeLiquidate(args: {
    hook: Address;
    key: PoolKey;
    trader: Address;
    minAmountOut: bigint;
}): Hex {
    return encodeFunctionData({
        abi: ROUTER_ABI,
        functionName: "liquidate",
        args: [args.hook, args.key, args.trader, args.minAmountOut],
    });
}

export function encodeArmTriggerOrder(args: {
    key: PoolKey;
    order: TriggerOrder;
    signature: Hex;
}): Hex {
    return encodeFunctionData({
        abi: ROUTER_EXT_ABI,
        functionName: "armTriggerOrder",
        args: [args.key, args.order, args.signature],
    });
}

/** Permissionless execution of a trader's signed conditional close. */
export function encodeExecuteTriggerOrder(args: {
    hook: Address;
    key: PoolKey;
    trader: Address;
}): Hex {
    return encodeFunctionData({
        abi: ROUTER_EXT_ABI,
        functionName: "executeTriggerOrder",
        args: [args.hook, args.key, args.trader],
    });
}

export function encodeCancelTriggerOrder(args: { trader: Address; key: PoolKey }): Hex {
    return encodeFunctionData({
        abi: ROUTER_EXT_ABI,
        functionName: "cancelTriggerOrder",
        args: [args.trader, args.key],
    });
}

/**
 * `EswapSettlement.fill` expects `hookData = abi.encode(true, leverage, recipient)`
 * and ignores the outer `solver` field (it is overwritten with the settler).
 */
export function encodeSettlementHookData(recipient: Address, leverage: number = LEVERAGE): Hex {
    return encodeAbiParameters(
        [
            { name: "isLong", type: "bool" },
            { name: "leverage", type: "uint8" },
            { name: "recipient", type: "address" },
        ] as const satisfies readonly AbiParameter[],
        [true, leverage, recipient],
    );
}

/** ABI-encoded SwapParams blob consumed by `EswapSettlement.fill`. */
export function encodeSettlementOriginData(params: SwapParams): Hex {
    return encodeAbiParameters(
        [
            { type: "tuple", components: POOL_KEY_PARAMS },
            { type: "tuple", components: POOL_KEY_PARAMS },
            { type: "bool" },
            { type: "int256" },
            { type: "uint8" },
            { type: "address" },
            { type: "bytes" },
            { type: "uint256" },
        ] as const satisfies readonly AbiParameter[],
        [
            poolKeyTuple(params.key),
            poolKeyTuple(params.standardPoolKey),
            params.zeroForOne,
            params.amountSpecified,
            params.leverage,
            params.solver,
            params.hookData,
            params.minAmountOut,
        ],
    );
}

export function encodeSettlementFill(orderId: Hex, originData: Hex, fillerData: Hex = "0x"): Hex {
    return encodeFunctionData({
        abi: SETTLEMENT_ABI,
        functionName: "fill",
        args: [orderId, originData, fillerData],
    });
}

/** ERC-7683 order id derivation used by the relay tooling. */
export function computeOrderId(args: {
    originChainId: number;
    originSettler: Address;
    originData: Hex;
}): Hex {
    return keccak256(
        encodeAbiParameters(
            [
                { name: "prefix", type: "bytes32" },
                { name: "originChainId", type: "uint256" },
                { name: "originSettler", type: "address" },
                { name: "originDataHash", type: "bytes32" },
            ] as const satisfies readonly AbiParameter[],
            [
                "0x4f726465724964", // bytes32("OrderId")
                BigInt(args.originChainId),
                args.originSettler,
                keccak256(args.originData),
            ],
        ),
    );
}

export function triggerOrderExecutionId(trader: Address, order: TriggerOrder): Hex {
    return keccak256(
        encodeAbiParameters(
            [
                { name: "trader", type: "address" },
                { name: "poolId", type: "bytes32" },
                { name: "nonce", type: "uint256" },
            ] as const satisfies readonly AbiParameter[],
            [trader, order.poolId, order.nonce],
        ),
    );
}

export { TRIGGER_ORDER_PARAMS };
