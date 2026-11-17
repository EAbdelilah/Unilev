import {
    BASE_CHAIN_ID,
    ESWAP_CONTRACTS,
    ESWAP_PROTOCOL_SPECS,
    LEVERAGE,
    PAIRS,
    PROTOCOL_FEE_BPS,
    type EswapExecutionResult,
    type EswapQuote,
    type ExecuteEswapParams,
    type PoolInfo,
    type QuoteExecutionParams,
    type ProtocolSpecs,
} from "@eswap/core";
import { z } from "zod";

export const pairSchema = z.enum(["WETH/USDC", "cbBTC/USDC"]);

export const quoteInputSchema = {
    pair: pairSchema.describe("Trading pair. Supported: WETH/USDC or cbBTC/USDC on Base."),
    collateralUsdc: z
        .string()
        .min(1)
        .describe("Margin collateral in USDC, max 6 decimals (e.g. '100' or '0.5'). 5x notional is borrowed JIT."),
};

export const openInputSchema = {
    ...quoteInputSchema,
    slippageBps: z
        .number()
        .int()
        .min(0)
        .max(1000)
        .optional()
        .describe("Maximum accepted slippage vs the quote in basis points. Default 100 (1%)."),
    dryRun: z
        .boolean()
        .optional()
        .describe("Simulate without broadcasting. Forced true when the server runs with --read-only."),
};

export interface ToolResult {
    [key: string]: unknown;
    content: Array<{ type: "text"; text: string }>;
    isError?: boolean;
}

export interface EswapToolDependencies {
    quote(params: QuoteExecutionParams): Promise<EswapQuote>;
    execute(params: ExecuteEswapParams): Promise<EswapExecutionResult>;
    poolInfo(): Promise<PoolInfo>;
}

export interface EswapToolOptions {
    /** When true, eswap_open_spot_margin can only simulate. */
    readOnly?: boolean;
}

function jsonText(value: unknown): string {
    return JSON.stringify(
        value,
        (_key, item) => (typeof item === "bigint" ? item.toString() : item),
        2,
    );
}

function success(value: unknown): ToolResult {
    return { content: [{ type: "text", text: jsonText(value) }] };
}

function failure(error: unknown): ToolResult {
    const normalized =
        error instanceof Error
            ? { name: error.name, message: error.message }
            : { name: "Error", message: String(error) };
    return { content: [{ type: "text", text: jsonText({ ok: false, error: normalized }) }], isError: true };
}

/** Testable handler layer shared by stdio and HTTP transports. */
export function createEswapToolHandlers(deps: EswapToolDependencies, options: EswapToolOptions = {}) {
    const readOnly = options.readOnly ?? false;
    return {
        async getQuote(args: { pair: "WETH/USDC" | "cbBTC/USDC"; collateralUsdc: string }): Promise<ToolResult> {
            try {
                const quote = await deps.quote({ pair: args.pair, collateralUsdc: args.collateralUsdc });
                return success({ ok: true, tool: "eswap_get_quote", quote });
            } catch (error) {
                return failure(error);
            }
        },

        async openMargin(
            args: {
                pair: "WETH/USDC" | "cbBTC/USDC";
                collateralUsdc: string;
                slippageBps?: number | undefined;
                dryRun?: boolean | undefined;
            },
        ): Promise<ToolResult> {
            try {
                const effectiveDryRun = readOnly ? true : (args.dryRun ?? false);
                const result = await deps.execute({
                    pair: args.pair,
                    collateralUsdc: args.collateralUsdc,
                    ...(args.slippageBps !== undefined ? { slippageBps: args.slippageBps } : {}),
                    dryRun: effectiveDryRun,
                });
                return success({
                    ok: true,
                    tool: "eswap_open_spot_margin",
                    ...(readOnly
                        ? {
                              readOnlyEnforced: true,
                              warning: "Server is in --read-only mode: simulation only, nothing was broadcast.",
                          }
                        : {}),
                    result,
                });
            } catch (error) {
                return failure(error);
            }
        },

        async getPoolInfo(): Promise<ToolResult> {
            try {
                const info = await deps.poolInfo();
                return success({ ok: true, tool: "eswap_get_pool_info", info });
            } catch (error) {
                return failure(error);
            }
        },
    };
}

/** Static resource payload for `eswap://protocol/specs`. */
export function getProtocolSpecsResource(): { uri: string; mimeType: string; text: string; specs: ProtocolSpecs } {
    return {
        uri: "eswap://protocol/specs",
        mimeType: "application/json",
        text: jsonText(ESWAP_PROTOCOL_SPECS),
        specs: ESWAP_PROTOCOL_SPECS,
    };
}

/** Compact summary embedded in the MCP server instructions. */
export function getServerInstructions(): string {
    const pairs = Object.keys(PAIRS).join(", ");
    return (
        `Eswap: ${LEVERAGE}x spot margin with 0.00% borrow interest, 0 TVL and external JIT solvers. ` +
        `Base mainnet (${BASE_CHAIN_ID}). Pairs: ${pairs}. Flat ${PROTOCOL_FEE_BPS} bps open fee. ` +
        `Hook ${ESWAP_CONTRACTS.hook}, router ${ESWAP_CONTRACTS.router}. ` +
        `Always call eswap_get_quote first; use eswap_open_spot_margin with dryRun:true to verify before signing.`
    );
}
