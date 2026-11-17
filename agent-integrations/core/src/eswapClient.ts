import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
    createPublicClient,
    createWalletClient,
    formatUnits,
    http,
    parseUnits,
    type Address,
    type PublicClient,
    type WalletClient,
} from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { base } from "viem/chains";

type EswapHttpTransport = ReturnType<typeof http>;
export type EswapPublicClient = PublicClient<EswapHttpTransport, typeof base>;
export type EswapWalletClient = WalletClient<EswapHttpTransport, typeof base, PrivateKeyAccount>;
import { ERC20_ABI, HOOK_ABI, QUOTER_ABI, ROUTER_ABI } from "./abis.js";
import {
    BASESCAN_TX_BASE,
    BASE_CHAIN_ID,
    ESWAP_CONTRACTS,
    LEVERAGE,
    PAIRS,
    PROTOCOL_FEE_BPS,
    USDC,
    type EswapClientOptions,
    type PairConfig,
    type SupportedPair,
} from "./constants.js";
import { EswapError } from "./errors.js";
import {
    assembleQuote,
    buildSwapParams,
    parseCollateralUnits,
    toSwapParamsJson,
    type RawQuote,
} from "./quote.js";
import type {
    EswapExecutionResult,
    EswapQuote,
    ExecuteEswapParams,
    PoolInfo,
    QuoteExecutionParams,
} from "./types.js";

/** Load KEY=VALUE pairs from a local .env without overriding real process env. */
export function loadEswapEnv(envPath: string = resolve(process.cwd(), ".env")): void {
    if (!existsSync(envPath)) return;
    for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
        const match = /^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
        if (!match || !match[1] || match[1] in process.env) continue;
        let value = match[2] ?? "";
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }
        process.env[match[1]] = value;
    }
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export interface EswapClient {
    readonly publicClient: EswapPublicClient;
    readonly walletClient?: EswapWalletClient;
    readonly account?: Address;
    readonly readOnly: boolean;
    readonly rpcUrl: string;
    getEswapQuote(params: QuoteExecutionParams): Promise<EswapQuote>;
    executeEswapMargin(params: ExecuteEswapParams): Promise<EswapExecutionResult>;
    getPoolInfo(): Promise<PoolInfo>;
}

/**
 * Create a framework-agnostic viem client.
 * RPC defaults to BASE_RPC_URL, signer to PRIVATE_KEY, read-only to ESWAP_READ_ONLY=1.
 */
export function createEswapClient(options: EswapClientOptions = {}): EswapClient {
    const rpcUrl = options.rpcUrl ?? process.env.BASE_RPC_URL ?? "https://mainnet.base.org";
    const privateKey = options.privateKey ?? process.env.PRIVATE_KEY;
    const readOnly = options.readOnly ?? process.env.ESWAP_READ_ONLY === "1";
    const transport = http(rpcUrl, options.timeoutMs ? { timeout: options.timeoutMs } : undefined);

    const publicClient = createPublicClient({ chain: base, transport });
    let walletClient: EswapWalletClient | undefined;
    let account: Address | undefined;

    if (privateKey) {
        try {
            const signer = privateKeyToAccount(privateKey as `0x${string}`);
            account = signer.address;
            walletClient = createWalletClient({ account: signer, chain: base, transport });
        } catch (error) {
            throw new EswapError("INVALID_PRIVATE_KEY", "PRIVATE_KEY is not a valid secp256k1 key", {
                reason: errorMessage(error),
            });
        }
    }

    /** Read-only eth_call against the router, falling back to the dedicated quoter. */
    async function readOutputUnits(pair: SupportedPair, collateralUnits: bigint): Promise<RawQuote> {
        const config: PairConfig = PAIRS[pair];
        if (!config) throw new EswapError("UNSUPPORTED_PAIR", `Unsupported pair: ${pair}`);
        if (collateralUnits <= 0n || collateralUnits > (1n << 127n) - 1n) {
            throw new EswapError("INVALID_COLLATERAL_UNITS", "Collateral must fit a positive int128");
        }
        const zeroForOne = config.hookPoolKey.currency0 !== config.base.address;
        const errors: string[] = [];

        try {
            const out = await publicClient.readContract({
                address: ESWAP_CONTRACTS.router,
                abi: ROUTER_ABI,
                functionName: "quoteExactInput",
                args: [
                    {
                        currency0: config.hookPoolKey.currency0,
                        currency1: config.hookPoolKey.currency1,
                        fee: config.hookPoolKey.fee,
                        tickSpacing: config.hookPoolKey.tickSpacing,
                        hooks: config.hookPoolKey.hooks,
                    },
                    zeroForOne,
                    -collateralUnits,
                    LEVERAGE,
                ],
            });
            if (out > 0n) return { outputUnits: out, source: "router" };
            errors.push("router returned zero output");
        } catch (error) {
            errors.push(`router: ${errorMessage(error)}`);
        }

        try {
            const out = await publicClient.readContract({
                address: ESWAP_CONTRACTS.quoter,
                abi: QUOTER_ABI,
                functionName: "quoteExactInputSingleWithLeverage",
                args: [USDC.address, config.base.address, config.hookPoolKey.fee, LEVERAGE, -collateralUnits],
            });
            if (out > 0n) return { outputUnits: out, source: "quoter" };
            errors.push("quoter returned zero output");
        } catch (error) {
            errors.push(`quoter: ${errorMessage(error)}`);
        }

        throw new EswapError("QUOTE_FAILED", `No live quote available for ${pair}`, { errors, pair });
    }

    const client: EswapClient = {
        publicClient,
        ...(walletClient ? { walletClient } : {}),
        ...(account ? { account } : {}),
        readOnly,
        rpcUrl,

        async getEswapQuote(params: QuoteExecutionParams): Promise<EswapQuote> {
            const collateralUnits = parseCollateralUnits(params.collateralUsdc);
            const raw = await readOutputUnits(params.pair, collateralUnits);
            return assembleQuote(params.pair, params.collateralUsdc, raw);
        },

        async executeEswapMargin(params: ExecuteEswapParams): Promise<EswapExecutionResult> {
            const dryRun = params.dryRun ?? false;
            if (!dryRun && readOnly) {
                throw new EswapError("READ_ONLY", "This client is read-only; pass dryRun: true to simulate", {
                    pair: params.pair,
                });
            }
            if (!dryRun && (!walletClient || !account)) {
                throw new EswapError("NO_SIGNER", "PRIVATE_KEY is required to broadcast a margin trade", {
                    pair: params.pair,
                });
            }

            const config: PairConfig = PAIRS[params.pair];
            if (!config) throw new EswapError("UNSUPPORTED_PAIR", `Unsupported pair: ${params.pair}`);

            const collateralUnits = parseCollateralUnits(params.collateralUsdc);
            const raw = await readOutputUnits(params.pair, collateralUnits);
            const quote = assembleQuote(params.pair, params.collateralUsdc, raw);
            const grossUnits = parseUnits(quote.grossTokenOut, config.base.decimals);
            const slippageBps = params.slippageBps ?? 100;
            const deadline = BigInt(Math.floor(Date.now() / 1000) + (params.deadlineSeconds ?? 300));
            const solver = account ?? "0x0000000000000000000000000000000000000000";
            const swapParams = buildSwapParams({
                pair: params.pair,
                collateralUnits,
                quoteOutputUnits: grossUnits,
                slippageBps,
                solver,
                deadline,
            });

            const borrowUnits = collateralUnits * BigInt(LEVERAGE - 1);
            const steps: string[] = [
                `Quote: ${formatUnits(grossUnits, config.base.decimals)} ${config.base.symbol} gross ` +
                    `for ${formatUnits(collateralUnits, 6)} USDC at ${LEVERAGE}x (${raw.source}, 0% carry).`,
                `JIT borrow: ${formatUnits(borrowUnits, 6)} USDC self-bonded via router.erc20BorrowEscrow.`,
            ];
            const actions: EswapExecutionResult["actions"] = [];

            // 1. USDC allowance for the margin leg.
            let needsApproval = false;
            if (solver !== "0x0000000000000000000000000000000000000000") {
                const allowance = await publicClient.readContract({
                    address: USDC.address,
                    abi: ERC20_ABI,
                    functionName: "allowance",
                    args: [solver, ESWAP_CONTRACTS.router],
                });
                needsApproval = allowance < collateralUnits;
            }
            if (needsApproval) {
                actions.push({
                    type: "approve",
                    description: `Approve EswapRouter for ${formatUnits(collateralUnits, 6)} USDC margin`,
                    token: USDC.address,
                    spender: ESWAP_CONTRACTS.router,
                    amount: collateralUnits.toString(),
                });
                steps.push(`Approve router for ${formatUnits(collateralUnits, 6)} USDC.`);
            } else {
                steps.push("USDC allowance already sufficient; no approval needed.");
            }

            // 2. JIT borrow bond in the router's ERC-20 escrow (self-funded solver).
            let escrowShortfall = borrowUnits;
            if (solver !== "0x0000000000000000000000000000000000000000") {
                const escrowed = await publicClient.readContract({
                    address: ESWAP_CONTRACTS.router,
                    abi: ROUTER_ABI,
                    functionName: "erc20BorrowEscrow",
                    args: [solver, USDC.address],
                });
                escrowShortfall = escrowed >= borrowUnits ? 0n : borrowUnits - escrowed;
            }
            if (escrowShortfall > 0n) {
                actions.push({
                    type: "depositBorrowEscrow",
                    description: `Deposit ${formatUnits(escrowShortfall, 6)} USDC borrow bond (JIT, no interest)`,
                    token: USDC.address,
                    solver,
                    amount: escrowShortfall.toString(),
                });
                steps.push(`Bond ${formatUnits(escrowShortfall, 6)} USDC borrow leg in erc20BorrowEscrow.`);
            } else {
                steps.push("Existing borrow escrow already covers the 4x borrow leg.");
            }

            actions.push({
                type: "swapMultiPool",
                description: `Open ${params.pair} ${LEVERAGE}x long, min ${formatUnits(swapParams.minAmountOut, config.base.decimals)} ${config.base.symbol}`,
                params: toSwapParamsJson(swapParams),
            });
            steps.push(`swapMultiPool: ${LEVERAGE}x long on ${config.hookPoolKey.fee / 100}% hook pool, deep fill on standard pool.`);

            const result: EswapExecutionResult = {
                pair: params.pair,
                collateralUsdc: formatUnits(collateralUnits, 6),
                leverage: LEVERAGE,
                dryRun,
                readOnly,
                quote,
                ...(account ? { account } : {}),
                steps,
                actions,
            };

            if (dryRun) {
                if (!walletClient || !account) {
                    return {
                        ...result,
                        simulation: {
                            status: "reverted",
                            error: "No PRIVATE_KEY configured: planned locally, on-chain simulation skipped",
                        },
                    };
                }
                try {
                    const simulation = await publicClient.simulateContract({
                        account,
                        address: ESWAP_CONTRACTS.router,
                        abi: ROUTER_ABI,
                        functionName: "swapMultiPool",
                        args: [swapParams],
                    });
                    return {
                        ...result,
                        simulation: { status: "success", result: String(simulation.result ?? "0x") },
                    };
                } catch (error) {
                    return {
                        ...result,
                        simulation: { status: "reverted", error: errorMessage(error) },
                    };
                }
            }

            // 3. Broadcast the setup + swap with the wallet client.
            if (!walletClient || !account) throw new EswapError("NO_SIGNER", "Wallet client unavailable");

            if (needsApproval) {
                const hash = await walletClient.writeContract({
                    address: USDC.address,
                    abi: ERC20_ABI,
                    functionName: "approve",
                    args: [ESWAP_CONTRACTS.router, collateralUnits],
                });
                await publicClient.waitForTransactionReceipt({ hash });
                steps.push(`Approve tx: ${BASESCAN_TX_BASE}${hash}`);
            }
            if (escrowShortfall > 0n) {
                const hash = await walletClient.writeContract({
                    address: ESWAP_CONTRACTS.router,
                    abi: ROUTER_ABI,
                    functionName: "depositBorrowEscrow",
                    args: [USDC.address, escrowShortfall],
                });
                await publicClient.waitForTransactionReceipt({ hash });
                steps.push(`Borrow-bond tx: ${BASESCAN_TX_BASE}${hash}`);
            }

            const txHash = await walletClient.writeContract({
                address: ESWAP_CONTRACTS.router,
                abi: ROUTER_ABI,
                functionName: "swapMultiPool",
                args: [swapParams],
            });
            const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
            if (receipt.status !== "success") {
                throw new EswapError("SWAP_REVERTED", "swapMultiPool transaction reverted", {
                    txHash,
                    baseScanUrl: `${BASESCAN_TX_BASE}${txHash}`,
                });
            }
            steps.push(`Swap tx: ${BASESCAN_TX_BASE}${txHash}`);

            return {
                ...result,
                steps,
                txHash,
                baseScanUrl: `${BASESCAN_TX_BASE}${txHash}`,
            };
        },

        async getPoolInfo(): Promise<PoolInfo> {
            const blockNumber = await publicClient.getBlockNumber();
            let onChainReserveFactor: string | undefined;
            let treasury: Address | undefined;
            try {
                const value = await publicClient.readContract({
                    address: ESWAP_CONTRACTS.hook,
                    abi: HOOK_ABI,
                    functionName: "reserveFactor",
                });
                onChainReserveFactor = value.toString();
            } catch {
                // Older hook builds may not expose the getter; static config still applies.
            }
            try {
                treasury = await publicClient.readContract({
                    address: ESWAP_CONTRACTS.hook,
                    abi: HOOK_ABI,
                    functionName: "treasury",
                });
            } catch {
                // Optional telemetry.
            }

            const pairs: PoolInfo["pairs"] = [];
            for (const pair of Object.keys(PAIRS) as SupportedPair[]) {
                const config = PAIRS[pair];
                let probeQuoteUsdcPerToken: string | undefined;
                let probeError: string | undefined;
                try {
                    const raw = await readOutputUnits(pair, parseUnits("1", 6));
                    probeQuoteUsdcPerToken = assembleQuote(pair, "1", raw).estimatedPriceUsdcPerToken;
                } catch (error) {
                    probeError = errorMessage(error);
                }
                pairs.push({
                    pair,
                    base: {
                        symbol: config.base.symbol,
                        address: config.base.address,
                        decimals: config.base.decimals,
                    },
                    quote: {
                        symbol: config.quote.symbol,
                        address: config.quote.address,
                        decimals: config.quote.decimals,
                    },
                    hookPoolKey: config.hookPoolKey,
                    standardPoolKey: config.standardPoolKey,
                    ...(probeQuoteUsdcPerToken ? { probeQuoteUsdcPerToken } : {}),
                    ...(probeError ? { probeError } : {}),
                });
            }

            return {
                chainId: BASE_CHAIN_ID,
                rpcUrl,
                blockNumber: blockNumber.toString(),
                contracts: { ...ESWAP_CONTRACTS },
                economics: {
                    leverage: LEVERAGE,
                    protocolFeeBps: PROTOCOL_FEE_BPS,
                    borrowCarryAprPercent: 0,
                    interestModel: "0% carry; external solvers fund borrow JIT per trade",
                    ...(onChainReserveFactor ? { onChainReserveFactorBps: onChainReserveFactor } : {}),
                    ...(treasury ? { treasury } : {}),
                },
                pairs,
            };
        },
    };

    return client;
}

/** Convenience wrapper using environment configuration. */
export async function getEswapQuote(params: QuoteExecutionParams, options?: EswapClientOptions): Promise<EswapQuote> {
    return createEswapClient(options).getEswapQuote(params);
}

/** Convenience wrapper using environment configuration. */
export async function executeEswapMargin(
    params: ExecuteEswapParams,
    options?: EswapClientOptions,
): Promise<EswapExecutionResult> {
    return createEswapClient(options).executeEswapMargin(params);
}

/** Convenience wrapper using environment configuration. */
export async function getEswapPoolInfo(options?: EswapClientOptions): Promise<PoolInfo> {
    return createEswapClient(options).getPoolInfo();
}
