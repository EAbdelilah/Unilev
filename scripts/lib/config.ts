import { config as loadDotenv } from "dotenv";
import path from "node:path";
import {
    createPublicClient,
    createWalletClient,
    defineChain,
    encodeAbiParameters,
    http,
    keccak256,
    type Account,
    type Address,
    type Chain,
    type Hex,
    type HttpTransport,
    type PublicClient,
    type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
    UNICHAIN_CHAIN_ID,
    COW_GPv2_SETTLEMENT,
    UNICHAIN_WETH,
    UNICHAIN_USDC,
    UNICHAIN_ETH_USD_FEED,
    UNICHAIN_USDC_USD_FEED,
    type PoolKey,
} from "./types.js";

// Load the repository root .env (cwd is repo root when run via npm scripts).
loadDotenv({ path: path.resolve(process.cwd(), ".env"), override: false });

/** Unichain (Chain ID 130) chain definition — local, so the scripts do not
 * depend on a specific viem/chains release shipping the network. */
export const unichain: Chain = defineChain({
    id: UNICHAIN_CHAIN_ID,
    name: "Unichain",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: ["https://mainnet.unichain.org"] } },
});

function loadEnv(name: string): string | undefined {
    const value = process.env[name];
    return value === undefined || value.trim() === "" ? undefined : value.trim();
}

function required(name: string): string {
    const value = loadEnv(name);
    if (value === undefined) {
        throw new Error(`Missing required environment variable ${name}`);
    }
    return value;
}

/** Primary network config: every contract the solver/relayer pipeline talks to. */
export interface NetworkConfig {
    rpcUrl: string;
    chain: Chain;
    hook: Address;
    router: Address;
    settlement: Address;
    quoter: Address;
    adapter: Address;
    priceFeed: Address;
    gpv2Settlement: Address;
    weth: Address;
    usdc: Address;
}

export function loadNetworkConfig(): NetworkConfig {
    const rpcUrl = required("UNICHAIN_RPC_URL");
    const chain = { ...unichain, rpcUrls: { default: { http: [rpcUrl] } } } as Chain;
    return {
        rpcUrl,
        chain,
        hook: required("V4_HOOK_ADDRESS") as Address,
        router: required("V4_ROUTER_ADDRESS") as Address,
        settlement: required("V4_SETTLEMENT_ADDRESS") as Address,
        quoter: required("V4_QUOTER_ADDRESS") as Address,
        adapter: required("V4_ADAPTER_ADDRESS") as Address,
        priceFeed: required("V4_PRICEFEED_ADDRESS") as Address,
        gpv2Settlement: (loadEnv("COW_GPv2_SETTLEMENT") as Address | undefined) ?? COW_GPv2_SETTLEMENT,
        weth: (loadEnv("V4_WETH") as Address | undefined) ?? UNICHAIN_WETH,
        usdc: (loadEnv("V4_USDC") as Address | undefined) ?? UNICHAIN_USDC,
    };
}

export interface ChainClients {
    publicClient: PublicClient<HttpTransport, Chain, Account | undefined>;
    walletClient: WalletClient<HttpTransport, Chain, Account>;
    account: Account;
}

export function createClients(network: NetworkConfig, privateKey: string): ChainClients {
    const account = privateKeyToAccount(privateKey as Hex);
    const publicClient = createPublicClient({ chain: network.chain, transport: http(network.rpcUrl) });
    const walletClient = createWalletClient({ chain: network.chain, transport: http(network.rpcUrl), account });
    return { publicClient, walletClient, account };
}

/**
 * @dev Mirrors `PoolIdLibrary.toId`: keccak256(abi.encode(currency0, currency1,
 * fee, tickSpacing, hooks)). `Currency` is address-flattened in the ABI.
 */
export function poolIdOf(key: PoolKey): Hex {
    return keccak256(
        encodeAbiParameters(
            [
                { type: "address" },
                { type: "address" },
                { type: "uint24" },
                { type: "int24" },
                { type: "address" },
            ],
            [key.currency0, key.currency1, key.fee, key.tickSpacing, key.hooks],
        ),
    );
}

/** Converts an ABI `string` price/amount (CoW API / cross-chain payloads) to a bigint. */
export function toBigInt(value: bigint | number | string): bigint {
    return typeof value === "bigint" ? value : BigInt(value);
}

/** Resolves a configurable per-chain RPC URL or throws a descriptive error. */
export function chainRpcUrl(networkKey: string, chainId: number, defaultUrl?: string): string {
    const value = loadEnv(networkKey);
    if (value === undefined && defaultUrl === undefined) {
        throw new Error(`Missing ${networkKey} (RPC URL for chain ${chainId})`);
    }
    return value ?? (defaultUrl as string);
}

export const ETH_MAINNET = 1;
export const ARBITRUM_ONE = 42161;
export const BASE = 8453;