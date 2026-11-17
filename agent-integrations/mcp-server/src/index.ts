#!/usr/bin/env node
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { pathToFileURL } from "node:url";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { loadEswapEnv } from "@eswap/core";
import { createMcpServer, type CreateMcpServerOptions } from "./server.js";

export { createMcpServer } from "./server.js";
export * from "./tools.js";

export interface CliOptions extends CreateMcpServerOptions {
    transport?: "stdio" | "http";
    port?: number;
}

export function parseCliArgs(argv: string[]): CliOptions {
    const readOnly = argv.includes("--read-only") || process.env.ESWAP_READ_ONLY === "1";
    const transport: "stdio" | "http" = argv.includes("--http") || process.env.MCP_TRANSPORT === "http"
        ? "http"
        : "stdio";
    const portFlag = argv.find((arg) => arg.startsWith("--port="));
    const portIndex = argv.indexOf("--port");
    const rawPort = portFlag?.slice("--port=".length) ?? (portIndex >= 0 ? argv[portIndex + 1] : undefined);
    const port = rawPort ? Number.parseInt(rawPort, 10) : Number.parseInt(process.env.MCP_HTTP_PORT ?? "3000", 10);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error(`Invalid MCP HTTP port: ${rawPort ?? port}`);
    }
    return { readOnly, transport, port };
}

export async function startStdioServer(options: CreateMcpServerOptions = {}): Promise<void> {
    const server = createMcpServer(options);
    await server.connect(new StdioServerTransport());
}

/** Stateless Streamable HTTP endpoint at POST /mcp (plus GET /healthz). */
export async function startHttpServer(options: CreateMcpServerOptions = {}, port = 3000): Promise<void> {
    const httpServer = createServer((req: IncomingMessage, res: ServerResponse) => {
        const path = (req.url ?? "/").split("?")[0];
        if (path === "/healthz") {
            res.writeHead(200, { "content-type": "application/json" });
            res.end(JSON.stringify({ status: "ok", server: "@eswap/mcp-server" }));
            return;
        }
        if (path !== "/mcp") {
            res.writeHead(404, { "content-type": "application/json" });
            res.end(JSON.stringify({ error: "Not found. Use POST /mcp." }));
            return;
        }
        if (req.method !== "POST") {
            res.writeHead(405, { "content-type": "application/json", allow: "POST" });
            res.end(JSON.stringify({ error: "Method not allowed. Use POST /mcp." }));
            return;
        }
        void (async () => {
            // Stateless mode: each request gets an isolated transport + MCP server.
            const transportOptions = {
                sessionIdGenerator: undefined,
                enableJsonResponse: true,
            } as unknown as ConstructorParameters<typeof StreamableHTTPServerTransport>[0];
            const transport = new StreamableHTTPServerTransport(transportOptions);
            res.on("close", () => {
                void transport.close();
            });
            const mcp = createMcpServer(options);
            await mcp.connect(transport);
            await transport.handleRequest(req, res);
        })().catch((error: unknown) => {
            const message = error instanceof Error ? error.message : String(error);
            if (!res.headersSent) res.writeHead(500, { "content-type": "application/json" });
            res.end(JSON.stringify({ error: message }));
        });
    });

    await new Promise<void>((resolve, reject) => {
        httpServer.once("error", reject);
        httpServer.listen(port, () => resolve());
    });
    process.stderr.write(`Eswap MCP Streamable HTTP listening on http://localhost:${port}/mcp\n`);
}

async function main(): Promise<void> {
    loadEswapEnv();
    const args = parseCliArgs(process.argv.slice(2));
    if (args.transport === "http") {
        await startHttpServer(args, args.port);
        return;
    }
    await startStdioServer(args);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch((error: unknown) => {
        process.stderr.write(`Eswap MCP server failed: ${error instanceof Error ? error.stack : String(error)}\n`);
        process.exitCode = 1;
    });
}
