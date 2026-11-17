import { describe, expect, it, vi } from "vitest";
import { ExecutableGameFunctionStatus } from "@virtuals-protocol/game";
import { EswapError, type EswapExecutionResult, type EswapQuote } from "@eswap/core";
import { createEswapGameFunctions } from "../src/functions.js";
import { EswapGamePlugin } from "../src/plugin.js";

const fakeQuote = {
    pair: "cbBTC/USDC",
    collateralUsdcUnits: "100000000",
    netTokenOut: "0.0004995",
    tokenOutSymbol: "cbBTC",
    tokenOutDecimals: 8,
    savings: { days30: { savedUsdc: "0.039" } },
} as unknown as EswapQuote;

const fakeExecution = {
    pair: "cbBTC/USDC",
    dryRun: false,
    baseScanUrl: "https://basescan.org/tx/0xdeadbeef",
} as unknown as EswapExecutionResult;

function callArgs(overrides: Record<string, string> = {}): Record<string, { value: string }> {
    const base: Record<string, string> = {
        pair: "cbBTC/USDC",
        collateralUsdc: "100",
    };
    return Object.fromEntries(
        Object.entries({ ...base, ...overrides }).map(([key, value]) => [key, { value }]),
    );
}

describe("Virtuals GameFunctions", () => {
    it("getEswapQuoteFunction returns Done with 8-decimal cbBTC output", async () => {
        const quote = vi.fn().mockResolvedValue(fakeQuote);
        const { quote: fn } = createEswapGameFunctions({
            dependencies: { quote, execute: vi.fn() },
        });
        const logs: string[] = [];
        const response = await fn.execute(callArgs(), (msg) => logs.push(msg));

        expect(response.status).toBe(ExecutableGameFunctionStatus.Done);
        expect(response.feedback).toContain("0.0004995");
        expect(response.feedback).toContain("cbBTC");
        expect(quote).toHaveBeenCalledWith({ pair: "cbBTC/USDC", collateralUsdc: "100" });
        expect(logs.length).toBeGreaterThan(0);
    });

    it("openEswapMarginFunction returns Done with a BaseScan receipt URL", async () => {
        const execute = vi.fn().mockResolvedValue(fakeExecution);
        const { open } = createEswapGameFunctions({
            dependencies: { quote: vi.fn(), execute },
        });
        const response = await open.execute(callArgs({ slippageBps: "50" }), () => {});

        expect(response.status).toBe(ExecutableGameFunctionStatus.Done);
        expect(response.feedback).toContain("https://basescan.org/tx/0xdeadbeef");
        expect(execute).toHaveBeenCalledWith(
            expect.objectContaining({ pair: "cbBTC/USDC", slippageBps: 50, dryRun: false }),
        );
    });

    it("returns Failed with structured logs on an execution error", async () => {
        const execute = vi.fn().mockRejectedValue(new EswapError("QUOTE_FAILED", "pool not initialized"));
        const { open } = createEswapGameFunctions({
            dependencies: { quote: vi.fn(), execute },
        });
        const logs: string[] = [];
        const response = await open.execute(callArgs(), (msg) => logs.push(msg));

        expect(response.status).toBe(ExecutableGameFunctionStatus.Failed);
        expect(response.feedback).toContain("QUOTE_FAILED");
        expect(logs.at(-1)).toContain("QUOTE_FAILED");
    });

    it("forces dryRun when the plugin is read-only", async () => {
        const execute = vi.fn().mockResolvedValue({ ...fakeExecution, dryRun: true });
        const { open } = createEswapGameFunctions({
            readOnly: true,
            dependencies: { quote: vi.fn(), execute },
        });
        const response = await open.execute(callArgs({ dryRun: "false" }), () => {});

        expect(response.status).toBe(ExecutableGameFunctionStatus.Done);
        expect(response.feedback).toContain("readOnlyEnforced");
        expect(execute).toHaveBeenCalledWith(expect.objectContaining({ dryRun: true }));
    });

    it("rejects invalid pairs before touching the chain", async () => {
        const quote = vi.fn();
        const { quote: fn } = createEswapGameFunctions({
            dependencies: { quote, execute: vi.fn() },
        });
        const response = await fn.execute(callArgs({ pair: "WBTC/USDC" }), () => {});
        expect(response.status).toBe(ExecutableGameFunctionStatus.Failed);
        expect(response.feedback).toContain("INVALID_PAIR");
        expect(quote).not.toHaveBeenCalled();
    });
});

describe("EswapGamePlugin worker", () => {
    it("exposes a ready-to-attach worker with both functions", async () => {
        const plugin = new EswapGamePlugin({
            dependencies: { quote: vi.fn().mockResolvedValue(fakeQuote), execute: vi.fn().mockResolvedValue(fakeExecution) },
        });
        const worker = plugin.getWorker();
        expect(worker.id).toBe("eswap_spot_margin_worker");
        expect(worker.name).toBe("Eswap Spot Margin");
        const names = worker.functions.map(
            (fn) => (fn.toJSON?.() as { fn_name?: string } | undefined)?.fn_name ?? "",
        );
        expect(names).toContain("getEswapQuote");
        expect(names).toContain("openEswapMargin");
        const environment = await worker.getEnvironment?.();
        expect(environment).toMatchObject({ chainId: 8453, leverage: 5, tvl: 0, borrowCarryAprPercent: 0 });
    });
});
