import type { Address } from "viem";

/** Base mainnet. */
export const BASE_CHAIN_ID = 8453;

/** Live protocol deployment (verified on Basescan / Sourcify). */
export const ESWAP_CONTRACTS = {
    hook: "0x7b3F232BB5a0346fADb8B92B31B3e7bC60bD90c8" as Address,
    router: "0x5b226aE5158de86f1E616875dBab886870B9aAd9" as Address,
    /** Companion carrying signed trigger orders and ERC-7683 initiation. */
    routerExt: "0x907CdA8c588c9C859A6fB4F105593a64599741CB" as Address,
    poolManager: "0x498581fF718922c3f8e6A244956aF099B2652b2b" as Address,
    /** Optional dedicated leverage quoter; the router quote is tried first. */
    quoter: "0xb1228De759119088D9aCEf20b80dD4ED93Dd2ba5" as Address,
    /** Chainlink-anchored oracle used by the hook and trigger orders. */
    priceFeed: "0x91d75C7f750510C04516fC4dcEB5737E5B170c02" as Address,
    /** ERC-7683 destination settler. */
    settlement: "0x6F347acB3bD901731e192d482b7a40c50f30FCa1" as Address,
    /** CoW Protocol settlement rail. */
    cowSettlement: "0x7341859C0D7e039118b3f85F341583EBCDB8c960" as Address,
} as const;

/** EIP-712 domain pinned by EswapRouterExt's DOMAIN_SEPARATOR. */
export const TRIGGER_ORDER_DOMAIN = {
    name: "EswapRouter",
    version: "1",
    chainId: BASE_CHAIN_ID,
    verifyingContract: ESWAP_CONTRACTS.router,
} as const;

export type TokenSymbol = "USDC" | "WETH" | "cbBTC";

export interface TokenInfo {
    readonly symbol: TokenSymbol;
    readonly address: Address;
    readonly decimals: number;
}

export const USDC: TokenInfo = {
    symbol: "USDC",
    address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    decimals: 6,
};

export const WETH: TokenInfo = {
    symbol: "WETH",
    address: "0x4200000000000000000000000000000000000006",
    decimals: 18,
};

export const CBBTC: TokenInfo = {
    symbol: "cbBTC",
    address: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf",
    decimals: 8,
};

export type SupportedPair = "WETH/USDC" | "cbBTC/USDC";

export interface PoolKey {
    currency0: Address;
    currency1: Address;
    fee: number;
    tickSpacing: number;
    hooks: Address;
}

export interface PairConfig {
    readonly pair: SupportedPair;
    readonly base: TokenInfo;
    readonly quote: TokenInfo;
    /** Accounting pool: 3000 fee / 60 spacing / Eswap hook. */
    readonly hookPoolKey: PoolKey;
    /** Deep-fill execution pool: 500 fee / 10 spacing / no hooks. */
    readonly standardPoolKey: PoolKey;
}

/** Uniswap v4 sorts by ascending address: WETH < USDC, but USDC < cbBTC. */
function makePair(pair: SupportedPair, base: TokenInfo): PairConfig {
    const [currency0, currency1] =
        base.address.toLowerCase() < USDC.address.toLowerCase()
            ? [base.address, USDC.address]
            : [USDC.address, base.address];
    return {
        pair,
        base,
        quote: USDC,
        hookPoolKey: {
            currency0,
            currency1,
            fee: 3000,
            tickSpacing: 60,
            hooks: ESWAP_CONTRACTS.hook,
        },
        standardPoolKey: {
            currency0,
            currency1,
            fee: 500,
            tickSpacing: 10,
            hooks: "0x0000000000000000000000000000000000000000",
        },
    };
}

export const PAIRS = {
    "WETH/USDC": makePair("WETH/USDC", WETH),
    "cbBTC/USDC": makePair("cbBTC/USDC", CBBTC),
} as const satisfies Record<SupportedPair, PairConfig>;

export function getPairConfig(pair: SupportedPair): PairConfig {
    const config = PAIRS[pair];
    if (!config) throw new Error(`Unsupported pair: ${pair}`);
    return config;
}

/** Fixed protocol economics. */
export const LEVERAGE = 5;
export const PROTOCOL_FEE_BPS = 10; // 0.10% of the collateral-equivalent output
export const BENCHMARK_APR_BPS = 1200; // 12% benchmark borrow APR
export const CARRY_DAYS = [7, 30] as const;

export const BASESCAN_TX_BASE = "https://basescan.org/tx/";

/** Runtime overrides. Every field is optional; env vars are the defaults. */
export interface EswapClientOptions {
    rpcUrl?: string;
    privateKey?: string;
    /** Reject `executeEswapMargin` unless `dryRun: true` was requested. */
    readOnly?: boolean;
    /** Default RPC timeout in milliseconds. */
    timeoutMs?: number;
}
