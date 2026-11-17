import { createEswapClient, type EswapClientOptions } from "@eswap/core";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
    createEswapToolHandlers,
    getProtocolSpecsResource,
    getServerInstructions,
    openInputSchema,
    quoteInputSchema,
    type EswapToolDependencies,
} from "./tools.js";

export interface CreateMcpServerOptions {
    readOnly?: boolean;
    rpcUrl?: string;
    privateKey?: string;
    /** Inject tool dependencies (used by tests). */
    dependencies?: EswapToolDependencies;
}

/** Build a fully configured MCP server with 3 tools and the protocol specs resource. */
export function createMcpServer(options: CreateMcpServerOptions = {}): McpServer {
    const clientOptions: EswapClientOptions = {};
    if (options.rpcUrl) clientOptions.rpcUrl = options.rpcUrl;
    if (options.privateKey) clientOptions.privateKey = options.privateKey;
    if (options.readOnly !== undefined) clientOptions.readOnly = options.readOnly;

    const client = createEswapClient(clientOptions);
    const deps: EswapToolDependencies = options.dependencies ?? {
        quote: (params) => client.getEswapQuote(params),
        execute: (params) => client.executeEswapMargin(params),
        poolInfo: () => client.getPoolInfo(),
    };
    const handlers = createEswapToolHandlers(deps, { readOnly: options.readOnly ?? false });

    const server = new McpServer(
        { name: "@eswap/mcp-server", version: "1.0.0" },
        { instructions: getServerInstructions() },
    );

    server.registerTool("eswap_get_quote", {
        title: "Eswap 5x margin quote",
        description:
            "Quote a 5x 0%-interest spot margin long on Base. Returns gross/net base-token output after the 10 bps protocol fee and 12% APR carry savings for 7 and 30 days.",
        inputSchema: quoteInputSchema,
    }, (args) => handlers.getQuote(args));

    server.registerTool("eswap_open_spot_margin", {
        title: "Open Eswap 5x spot margin",
        description:
            "Open a 5x spot margin long on Base mainnet. Approves USDC if needed, bonds the 4x borrow JIT in erc20BorrowEscrow, then calls router.swapMultiPool. Set dryRun:true to simulate only.",
        inputSchema: openInputSchema,
        annotations: {
            readOnlyHint: false,
            destructiveHint: false,
            idempotentHint: false,
            openWorldHint: true,
        },
    }, (args) => handlers.openMargin(args));

    server.registerTool("eswap_get_pool_info", {
        title: "Eswap pool info",
        description:
            "Return verified Base contract addresses, both PoolKey structs, live protocol economics and a 1 USDC probe quote for each supported pair.",
        inputSchema: {},
    }, () => handlers.getPoolInfo());

    const resource = getProtocolSpecsResource();
    server.registerResource(
        "Eswap protocol specifications",
        resource.uri,
        {
            title: "Eswap 0% carry clearinghouse mechanics",
            description:
                "Structured JSON describing the pure JIT solver architecture: 0% interest, 0 TVL, 0 CAC, and when to route trades to Eswap instead of perpetuals.",
            mimeType: resource.mimeType,
        },
        () => ({
            contents: [
                {
                    uri: resource.uri,
                    mimeType: resource.mimeType,
                    text: resource.text,
                },
            ],
        }),
    );

    return server;
}
