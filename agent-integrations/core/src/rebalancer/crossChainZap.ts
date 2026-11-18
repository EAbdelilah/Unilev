import type { Address, Hex } from "viem";
import {
    BASE_CHAIN_ID,
    ESWAP_CONTRACTS,
    LEVERAGE,
    USDC,
    getPairConfig,
    type SupportedPair,
} from "../constants.js";
import {
    encodeApprove,
    encodeSettlementFill,
    encodeSettlementHookData,
    encodeSettlementOriginData,
    encodeSwapMultiPool,
} from "../calldata.js";
import { EswapError } from "../errors.js";
import { buildSwapParams, parseCollateralUnits } from "../quote.js";
import type { TransactionCall } from "../types.js";

/** LI.FI contract-call shape accepted by getContractCallsQuote(). */
export interface LifiContractCall {
    fromAmount: string;
    fromTokenAddress: Address;
    toContractAddress: Address;
    toContractCallData: Hex;
    toContractGasLimit: string;
}

export interface LifiMarginZapRequest {
    fromChain: number;
    toChain: number;
    fromToken: Address;
    /** Origin-chain token amount, in its own decimals, as a decimal string. */
    fromAmount: string;
    /** Destination margin amount; strict USDC 6dp. */
    toToken: Address;
    fromAddress: Address;
    contractCalls: LifiContractCall[];
}

export interface LifiZapInput {
    originChainId: number;
    fromToken: Address;
    /** Origin token amount in its native decimals. */
    fromAmountUnits: bigint;
    originTokenDecimals: number;
    /** Exact USDC margin the bridge must deliver on Base (6dp string). */
    collateralUsdc: string;
    pair: SupportedPair;
    recipient: Address;
    solver: Address;
    quoteOutputUnits: bigint;
    slippageBps?: number;
    deadline?: bigint;
    nowUnix?: number;
    /** LI.FI calls the destination contract from the user's context by default. */
    includeApprove?: boolean;
    gasLimit?: bigint;
}

export interface Erc7683IntentInput {
    /** Canonical order id emitted by the origin-chain bridge; never invented locally. */
    orderId: Hex;
    originChainId: number;
    pair: SupportedPair;
    recipient: Address;
    collateralUsdc: string;
    quoteOutputUnits: bigint;
    slippageBps?: number;
    deadline?: bigint;
    fillerData?: Hex;
}

export interface Erc7683MarginIntent {
    orderId: Hex;
    originChainId: number;
    destinationChainId: number;
    settlement: Address;
    swapper: Address;
    originData: Hex;
    maxSpent: { token: Address; amount: string; chainId: number };
    minReceived: { token: Address; amount: string; chainId: number };
    fillCall: TransactionCall;
}

function assertPositiveAmount(amount: bigint, label: string): void {
    if (amount <= 0n) throw new EswapError("INVALID_AMOUNT", `${label} must be positive`);
}

function assertDecimals(decimals: number): void {
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) {
        throw new EswapError("INVALID_DECIMALS", "token decimals must be an integer in 0..36", {
            decimals,
        });
    }
}

function buildOpenCall(input: {
    pair: SupportedPair;
    collateralUsdc: string;
    quoteOutputUnits: bigint;
    solver: Address;
    slippageBps?: number;
    deadline?: bigint;
    nowUnix?: number;
}): TransactionCall {
    const collateralUnits = parseCollateralUnits(input.collateralUsdc);
    if (input.quoteOutputUnits <= 0n) {
        throw new EswapError("INVALID_QUOTE", "quoteOutputUnits must be positive");
    }
    const params = buildSwapParams({
        pair: input.pair,
        collateralUnits,
        quoteOutputUnits: input.quoteOutputUnits,
        slippageBps: input.slippageBps ?? 100,
        solver: input.solver,
        deadline:
            input.deadline ??
            BigInt(input.nowUnix ?? Math.floor(Date.now() / 1000)) + 900n,
    });
    return { to: ESWAP_CONTRACTS.router, data: encodeSwapMultiPool(params), value: 0n };
}

/**
 * Build the LI.FI `contractCalls` array that bridges to Base USDC and opens a
 * 5x Eswap position as the final destination call.
 */
export function buildLifiMarginZap(input: LifiZapInput): LifiMarginZapRequest {
    assertDecimals(input.originTokenDecimals);
    assertPositiveAmount(input.fromAmountUnits, "fromAmountUnits");
    if (input.originChainId === BASE_CHAIN_ID) {
        throw new EswapError("INVALID_ORIGIN_CHAIN", "use the direct adapter for same-chain opens");
    }
    const collateralUnits = parseCollateralUnits(input.collateralUsdc);
    const openInput: Parameters<typeof buildOpenCall>[0] = {
        pair: input.pair,
        collateralUsdc: input.collateralUsdc,
        quoteOutputUnits: input.quoteOutputUnits,
        solver: input.solver,
    };
    if (input.slippageBps !== undefined) openInput.slippageBps = input.slippageBps;
    if (input.deadline !== undefined) openInput.deadline = input.deadline;
    if (input.nowUnix !== undefined) openInput.nowUnix = input.nowUnix;
    const open = buildOpenCall(openInput);

    const contractCalls: LifiContractCall[] = [];
    if (input.includeApprove !== false) {
        contractCalls.push({
            fromAmount: collateralUnits.toString(),
            fromTokenAddress: USDC.address,
            toContractAddress: ESWAP_CONTRACTS.router,
            toContractCallData: encodeApprove(USDC.address, ESWAP_CONTRACTS.router, collateralUnits),
            toContractGasLimit: "60000",
        });
    }
    contractCalls.push({
        fromAmount: collateralUnits.toString(),
        fromTokenAddress: USDC.address,
        toContractAddress: ESWAP_CONTRACTS.router,
        toContractCallData: open.data,
        toContractGasLimit: (input.gasLimit ?? 900_000n).toString(),
    });

    return {
        fromChain: input.originChainId,
        toChain: BASE_CHAIN_ID,
        fromToken: input.fromToken,
        fromAmount: input.fromAmountUnits.toString(),
        toToken: USDC.address,
        fromAddress: input.recipient,
        contractCalls,
    };
}

/**
 * Build an ERC-7683 fill payload for EswapSettlement. The position recipient is
 * pinned in hookData; the outer solver field is overwritten by the settlement.
 */
export function buildErc7683MarginIntent(input: Erc7683IntentInput): Erc7683MarginIntent {
    if (!/^0x[0-9a-fA-F]{64}$/.test(input.orderId)) {
        throw new EswapError("INVALID_ORDER_ID", "orderId must be bytes32");
    }
    const collateralUnits = parseCollateralUnits(input.collateralUsdc);
    const config = getPairConfig(input.pair);
    const params = buildSwapParams({
        pair: input.pair,
        collateralUnits,
        quoteOutputUnits: input.quoteOutputUnits,
        slippageBps: input.slippageBps ?? 100,
        solver: ESWAP_CONTRACTS.settlement,
        deadline: input.deadline ?? 0n,
    });
    const originData = encodeSettlementOriginData({
        ...params,
        hookData: encodeSettlementHookData(input.recipient, LEVERAGE),
        solver: ESWAP_CONTRACTS.settlement,
    });

    return {
        orderId: input.orderId,
        originChainId: input.originChainId,
        destinationChainId: BASE_CHAIN_ID,
        settlement: ESWAP_CONTRACTS.settlement,
        swapper: input.recipient,
        originData,
        maxSpent: {
            token: USDC.address,
            amount: collateralUnits.toString(),
            chainId: input.originChainId,
        },
        minReceived: {
            token: config.base.address,
            amount: params.minAmountOut.toString(),
            chainId: BASE_CHAIN_ID,
        },
        fillCall: {
            to: ESWAP_CONTRACTS.settlement,
            data: encodeSettlementFill(input.orderId, originData, input.fillerData ?? "0x"),
            value: 0n,
        },
    };
}

/** JSON-safe payload for the intent relay / LI.FI metadata field. */
export function toCrossChainZapPayload(
    zap: LifiMarginZapRequest,
    intent?: Erc7683MarginIntent,
): Record<string, unknown> {
    return {
        lifi: {
            ...zap,
            contractCalls: zap.contractCalls.map((call) => ({
                ...call,
                fromTokenAddress: call.fromTokenAddress.toLowerCase(),
                toContractAddress: call.toContractAddress.toLowerCase(),
            })),
        },
        erc7683: intent
            ? {
                  ...intent,
                  fillCall: {
                      to: intent.fillCall.to,
                      data: intent.fillCall.data,
                      value: intent.fillCall.value.toString(),
                  },
              }
            : undefined,
    };
}

export function createCrossChainZap() {
    return {
        lifi: buildLifiMarginZap,
        erc7683: buildErc7683MarginIntent,
        payload: toCrossChainZapPayload,
    };
}
