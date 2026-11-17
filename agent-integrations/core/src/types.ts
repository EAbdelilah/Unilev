import type { Address, Hex } from "viem";
import type { PoolKey, SupportedPair } from "./constants.js";

export interface CarrySavings {
    /** Holding period used for the comparison. */
    days: number;
    /** Benchmark perpetual/lending borrow APR (percent, e.g. 12). */
    benchmarkAprPercent: number;
    /** Interest that a 12% APR venue would charge on the borrowed 4x leg. */
    benchmarkInterestUsdc: string;
    /** Eswap borrow interest: always zero. */
    eswapInterestUsdc: string;
    /** benchmarkInterestUsdc - eswapInterestUsdc. */
    savedUsdc: string;
}

export interface EswapQuote {
    pair: SupportedPair;
    side: "long";
    leverage: number;
    collateralUsdc: string;
    /** Exact 6-decimal collateral integer. */
    collateralUsdcUnits: string;
    borrowUsdc: string;
    notionalUsdc: string;
    /** Base token received by the position after the 10 bps protocol fee. */
    tokenOut: string;
    tokenOutSymbol: "WETH" | "cbBTC";
    tokenOutDecimals: number;
    /** Delivered output before the protocol fee, in base-token units. */
    grossTokenOut: string;
    /** 10 bps protocol reserve, in base-token units. */
    protocolFeeTokenOut: string;
    netTokenOut: string;
    protocolFeeBps: number;
    /** Approximate fee in USDC using the quote's own execution price. */
    protocolFeeUsdcApprox: string;
    /** Quote source: router quoteExactInput or the dedicated leverage quoter. */
    quoteSource: "router" | "quoter";
    /** USDC per base token implied by the quote. */
    estimatedPriceUsdcPerToken: string;
    zeroForOne: boolean;
    savings: {
        days7: CarrySavings;
        days30: CarrySavings;
    };
    contracts: {
        chainId: number;
        hook: Address;
        router: Address;
        poolManager: Address;
        hookPoolKey: PoolKey;
        standardPoolKey: PoolKey;
    };
}

export interface QuoteExecutionParams {
    pair: SupportedPair;
    collateralUsdc: string;
}

export interface ExecuteEswapParams extends QuoteExecutionParams {
    /** Rejects the swap if executed output is below quote * (1 - bps/10000). Default 100 (1%). */
    slippageBps?: number;
    /** Swap deadline in seconds from now. Default 300. */
    deadlineSeconds?: number;
    /** Simulate only; never broadcast. Default false. */
    dryRun?: boolean;
}

export interface SwapParams {
    key: PoolKey;
    standardPoolKey: PoolKey;
    zeroForOne: boolean;
    amountSpecified: bigint;
    leverage: number;
    solver: Address;
    hookData: Hex;
    deadline: bigint;
    minAmountOut: bigint;
}

/** JSON-safe mirror of SwapParams (bigints rendered as decimal strings). */
export interface SwapParamsJson {
    key: PoolKey;
    standardPoolKey: PoolKey;
    zeroForOne: boolean;
    amountSpecified: string;
    leverage: number;
    solver: Address;
    hookData: Hex;
    deadline: string;
    minAmountOut: string;
}

export interface EswapAction {
    type: "approve" | "depositBorrowEscrow" | "swapMultiPool";
    description: string;
    token?: Address;
    spender?: Address;
    solver?: Address;
    amount?: string;
    params?: SwapParamsJson;
}

export interface EswapExecutionResult {
    pair: SupportedPair;
    collateralUsdc: string;
    leverage: number;
    dryRun: boolean;
    readOnly: boolean;
    quote: EswapQuote;
    account?: Address;
    txHash?: Hex;
    baseScanUrl?: string;
    /** Human-readable audit trail of the JIT borrow lifecycle. */
    steps: string[];
    actions: EswapAction[];
    simulation?: { status: "success"; result: string } | { status: "reverted"; error: string };
}

export interface PoolInfo {
    chainId: number;
    rpcUrl: string;
    blockNumber: string;
    contracts: {
        hook: Address;
        router: Address;
        poolManager: Address;
        quoter: Address;
    };
    economics: {
        leverage: number;
        protocolFeeBps: number;
        onChainReserveFactorBps?: string;
        treasury?: Address;
        borrowCarryAprPercent: number;
        interestModel: "0% carry; external solvers fund borrow JIT per trade";
    };
    pairs: Array<{
        pair: SupportedPair;
        base: { symbol: string; address: Address; decimals: number };
        quote: { symbol: string; address: Address; decimals: number };
        hookPoolKey: PoolKey;
        standardPoolKey: PoolKey;
        probeQuoteUsdcPerToken?: string;
        probeError?: string;
    }>;
}

export interface ProtocolSpecs {
    protocol: string;
    network: { chain: string; chainId: number };
    architecture: {
        model: string;
        tvl: number;
       interestRate: string;
        fundingRate: string;
        capitalSource: string;
        rejectedModels: string[];
    };
    mechanics: {
        opening: string[];
        closing: string[];
        solverRepayment: string;
    };
    economics: {
        leverage: number;
        collateralFeeBps: number;
        benchmarkAprPercent: number;
    };
    supportedPairs: SupportedPair[];
    contracts: Record<string, Address>;
    routingGuidance: string[];
}
