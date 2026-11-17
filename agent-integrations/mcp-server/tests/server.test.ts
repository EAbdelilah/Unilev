import { afterEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { EswapExecutionResult, EswapQuote, PoolInfo } from "@eswap/core";
import { parseCliArgs } from "../src/index.js";
import { createMcpServer } from "../src/server.js";
import {
    createEswapToolHandlers,
    getProtocolSpecsResource,
    type EswapToolDependencies,
} from "../src/tools.js";

const fakeQuote = {
    pair: "WETH/USDC",
    netTokenOut: "0.99",
    tokenOutSymbol: "WETH",
    savings: { days7: { savedUsdc: "9.2" } },
} as unknown as EswapQuote;

const fakeExecution = {
    dryRun: false,
    baseScanUrl: "https://basescan.org/tx/0xabc",
} as unknown as EswapExecutionResult;

const fakePoolInfo = { chainId: 8453, pairs: [] } as unknown as PoolInfo;

function deps(): EswapToolDependencies {
    return {
        quote: vi.fn().mockResolvedValue(fakeQuote),
        execute: vi.fn().mockResolvedValue(fakeExecution),
        poolInfo: vi.fn().mockResolvedValue(fakePoolInfo),
    };
}

function resultText(result: { content: Array<{ text?: string }> }): string {
    return result.content.map((item) => item.text ?? "").join("\n");
}

describe("MCP tool handlers", () => {
    it("returns a structured quote for valid input", async () => {
        const dependency = deps();
        const handlers = createEswapToolHandlers(dependency);
        const result = await handlers.getQuote({ pair: "WETH/USDC", collateralUsdc: "100" });
        expect(result.isError).toBeUndefined();
        expect(JSON.parse(resultText(result)).quote.netTokenOut).toBe("0.99");
        expect(dependency.quote).toHaveBeenCalledWith({ pair: "WETH/USDC", collateralUsdc: "100" });
    });

    it("opens a position and returns the BaseScan URL", async () => {
        const dependency = deps();
        const handlers = createEswapToolHandlers(dependency);
        const result = await handlers.openMargin({
            pair: "cbBTC/USDC",
            collateralUsdc: "50",
            slippageBps: 50,
            dryRun: false,
        });
        expect(JSON.parse(resultText(result)).result.baseScanUrl).toBe("https://basescan.org/tx/0xabc");
        expect(dependency.execute).toHaveBeenCalledWith({
            pair: "cbBTC/USDC",
            collateralUsdc: "50",
            slippageBps: 50,
            dryRun: false,
        });
    });

    it("forces simulation in --read-only mode", async () => {
        const dependency = deps();
        const handlers = createEswapToolHandlers(dependency, { readOnly: true });
        const result = await handlers.openMargin({
            pair: "WETH/USDC",
            collateralUsdc: "10",
            dryRun: false,
        });
        const parsed = JSON.parse(resultText(result));
        expect(parsed.readOnlyEnforced).toBe(true);
        expect(dependency.execute).toHaveBeenCalledWith(
            expect.objectContaining({ dryRun: true }),
        );
    });

    it("returns isError on downstream failure", async () => {
        const dependency = deps();
        vi.mocked(dependency.quote).mockRejectedValueOnce(new Error("QUOTE_FAILED: pool not initialized"));
        const result = await createEswapToolHandlers(dependency).getQuote({
            pair: "cbBTC/USDC",
            collateralUsdc: "1",
        });
        expect(result.isError).toBe(true);
        expect(resultText(result)).toContain("QUOTE_FAILED");
    });
});

describe("MCP resource + CLI", () => {
    it("serves 0 TVL / 0% interest JSON specs", () => {
        const resource = getProtocolSpecsResource();
        expect(resource.uri).toBe("eswap://protocol/specs");
        const parsed = JSON.parse(resource.text);
        expect(parsed.architecture.tvl).toBe(0);
        expect(parsed.architecture.interestRate).toContain("0.00%");
    });

    it("parses stdio/http read-only flags", () => {
        expect(parseCliArgs([])).toMatchObject({ transport: "stdio", readOnly: false });
        expect(parseCliArgs(["--read-only", "--http", "--port=4444"])).toMatchObject({
            transport: "http",
            readOnly: true,
            port: 4444,
        });
    });
});

describe("MCP protocol over in-memory transport", () => {
    let server: McpServer | undefined;
    let client: Client | undefined;

    afterEach(async () => {
        await client?.close();
        await server?.close();
    });

    it("lists 3 tools and reads the protocol spec resource", async () => {
        server = createMcpServer({ dependencies: deps(), readOnly: true });
        client = new Client({ name: "eswap-test-client", version: "1.0.0" });
        const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
        await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

        const tools = await client.listTools();
        expect(tools.tools.map((tool) => tool.name).sort()).toEqual([
            "eswap_get_pool_info",
            "eswap_get_quote",
            "eswap_open_spot_margin",
        ]);

        const quoteCall = await client.callTool({
            name: "eswap_get_quote",
            arguments: { pair: "cbBTC/USDC", collateralUsdc: "25" },
        });
        expect(resultText(quoteCall as { content: Array<{ text?: string }> })).toContain("WETH");

        const resource = await client.readResource({ uri: "eswap://protocol/specs" });
        const first = resource.contents[0];
        expect(first && "text" in first ? first.text : "").toContain("0 TVL");
    });
});
