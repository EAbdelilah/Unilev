import {
    createEswapClient,
    EswapError,
    loadEswapEnv,
    type EswapExecutionResult,
    type EswapQuote,
    type ExecuteEswapParams,
    type QuoteExecutionParams,
    type SupportedPair,
} from "@eswap/core";
import {
    ExecutableGameFunctionResponse,
    ExecutableGameFunctionStatus,
    GameFunction,
} from "@virtuals-protocol/game";

export interface EswapGameDependencies {
    quote(params: QuoteExecutionParams): Promise<EswapQuote>;
    execute(params: ExecuteEswapParams): Promise<EswapExecutionResult>;
}

export interface EswapGameFunctionOptions {
    /** Force all execute calls into simulation mode. */
    readOnly?: boolean;
    rpcUrl?: string;
    privateKey?: string;
    /** Injectable for tests; defaults to the shared viem core. */
    dependencies?: Partial<EswapGameDependencies>;
}

export interface EswapGameFunctions {
    quote: GameFunction<GameFunctionArg[]>;
    open: GameFunction<GameFunctionArg[]>;
    deps: EswapGameDependencies;
}

type GameFunctionArg = { name: string; description: string; type?: string; optional?: boolean };

function json(value: unknown): string {
    return JSON.stringify(value, (_key, item) => (typeof item === "bigint" ? item.toString() : item));
}

function parsePair(raw: string | undefined): SupportedPair {
    if (raw !== "WETH/USDC" && raw !== "cbBTC/USDC") {
        throw new EswapError("INVALID_PAIR", "pair must be WETH/USDC or cbBTC/USDC", { pair: raw });
    }
    return raw;
}

function parseDryRun(raw: string | undefined): boolean {
    if (raw === undefined || raw === "") return false;
    if (raw === "true" || raw === "1") return true;
    if (raw === "false" || raw === "0") return false;
    throw new EswapError("INVALID_DRY_RUN", "dryRun must be 'true' or 'false'", { dryRun: raw });
}

function errorPayload(error: unknown): Record<string, unknown> {
    if (error instanceof EswapError) return error.toJSON();
    return {
        name: error instanceof Error ? error.name : "Error",
        code: "GAME_FUNCTION_FAILED",
        message: error instanceof Error ? error.message : String(error),
    };
}

function failed(error: unknown, logger: (msg: string) => void): ExecutableGameFunctionResponse {
    const payload = { ok: false, ...errorPayload(error) };
    logger(json(payload));
    return new ExecutableGameFunctionResponse(
        ExecutableGameFunctionStatus.Failed,
        json(payload),
    );
}

/** Create both GameFunctions with injectable dependencies (testable, no network in unit tests). */
export function createEswapGameFunctions(options: EswapGameFunctionOptions = {}): EswapGameFunctions {
    loadEswapEnv();
    const readOnly = options.readOnly ?? false;
    const clientOptions: Record<string, string | boolean> = {};
    if (options.rpcUrl) clientOptions.rpcUrl = options.rpcUrl;
    if (options.privateKey) clientOptions.privateKey = options.privateKey;
    clientOptions.readOnly = readOnly;
    // The shared core is the single source of truth for quotes and execution.
    const client = createEswapClient(clientOptions);
    const deps: EswapGameDependencies = {
        quote: (params) => options.dependencies?.quote?.(params) ?? client.getEswapQuote(params),
        execute: (params) => options.dependencies?.execute?.(params) ?? client.executeEswapMargin(params),
    };

    const quote = new GameFunction<GameFunctionArg[]>({
        name: "getEswapQuote",
        description:
            "Quote a 5x 0%-interest Eswap spot margin long on Base for WETH/USDC or cbBTC/USDC. Returns gross/net token output after the 10 bps fee and 12% APR carry savings.",
        args: [
            {
                name: "pair",
                description: "Supported pair: WETH/USDC or cbBTC/USDC",
                type: "string",
            },
            {
                name: "collateralUsdc",
                description: "USDC margin as a decimal string with at most 6 decimals, e.g. 100",
                type: "string",
            },
        ],
        hint: "Always quote before opening a position; Eswap charges 0% borrow carry versus 12% APR on perpetuals.",
        executable: async (args, logger) => {
            try {
                const pair = parsePair(args.pair);
                if (!args.collateralUsdc) throw new EswapError("MISSING_COLLATERAL", "collateralUsdc is required");
                const result = await deps.quote({ pair, collateralUsdc: args.collateralUsdc });
                const feedback = json({ ok: true, tool: "getEswapQuote", quote: result });
                logger(feedback);
                return new ExecutableGameFunctionResponse(ExecutableGameFunctionStatus.Done, feedback);
            } catch (error) {
                return failed(error, logger);
            }
        },
    });

    const open = new GameFunction<GameFunctionArg[]>({
        name: "openEswapMargin",
        description:
            "Open a 5x Eswap spot margin long on Base mainnet. Bonds the 4x borrow JIT in erc20BorrowEscrow and calls router.swapMultiPool. Returns a BaseScan receipt URL.",
        args: [
            { name: "pair", description: "WETH/USDC or cbBTC/USDC", type: "string" },
            { name: "collateralUsdc", description: "USDC margin decimal string (max 6 decimals)", type: "string" },
            {
                name: "slippageBps",
                description: "Optional slippage tolerance in bps, default 100",
                type: "string",
                optional: true,
            },
            {
                name: "dryRun",
                description: "Optional 'true' to simulate without broadcasting",
                type: "string",
                optional: true,
            },
        ],
        hint: "Use dryRun='true' first. Requires PRIVATE_KEY in the agent environment for real fills.",
        executable: async (args, logger) => {
            try {
                const pair = parsePair(args.pair);
                if (!args.collateralUsdc) throw new EswapError("MISSING_COLLATERAL", "collateralUsdc is required");
                const slippageBps = args.slippageBps ? Number.parseInt(args.slippageBps, 10) : undefined;
                if (slippageBps !== undefined && (!Number.isInteger(slippageBps) || slippageBps < 0 || slippageBps > 1000)) {
                    throw new EswapError("INVALID_SLIPPAGE", "slippageBps must be 0..1000", {
                        slippageBps: args.slippageBps,
                    });
                }
                const dryRun = readOnly ? true : parseDryRun(args.dryRun);
                const result = await deps.execute({
                    pair,
                    collateralUsdc: args.collateralUsdc,
                    ...(slippageBps !== undefined ? { slippageBps } : {}),
                    dryRun,
                });
                const feedback = json({
                    ok: true,
                    tool: "openEswapMargin",
                    receiptUrl: result.baseScanUrl ?? null,
                    dryRun: result.dryRun,
                    ...(readOnly ? { readOnlyEnforced: true } : {}),
                    result,
                });
                logger(feedback);
                return new ExecutableGameFunctionResponse(ExecutableGameFunctionStatus.Done, feedback);
            } catch (error) {
                return failed(error, logger);
            }
        },
    });

    return { quote, open, deps };
}

/** Default singletons for quickstart usage. */
const defaults = createEswapGameFunctions();
export const getEswapQuoteFunction = defaults.quote;
export const openEswapMarginFunction = defaults.open;
