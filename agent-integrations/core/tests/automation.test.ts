import { describe, expect, it } from "vitest";
import { decodeFunctionData, hashTypedData, parseUnits, type Hex } from "viem";
import {
    BASE_CHAIN_ID,
    ESWAP_CONTRACTS,
    ROUTER_ABI,
    ROUTER_EXT_ABI,
    buildTriggerOrderTypedData,
    calculateLeverageTokenMath,
    createGelatoWeb3Function,
    defaultTriggerDirection,
    encodeSettlementHookData,
    evaluateGelatoTrigger,
    generateDcaSchedule,
    getDueDcaOrders,
    marketCrossed,
    sqrtPriceX96ToPrice18,
    type DcaPlan,
    type GelatoUserArgs,
} from "../src/index.js";

const TRADER = "0x2222222222222222222222222222222222222222";
const SOLVER = "0x1111111111111111111111111111111111111111";
const NOW = 1_800_000_000;

function stopLossArgs(pair: "WETH/USDC" | "cbBTC/USDC"): GelatoUserArgs {
    return {
        pair,
        trader: TRADER,
        solver: SOLVER,
        triggerKind: "stopLoss",
        triggerPrice18: parseUnits("3000", 18),
        minAmountOut: 1n,
        closeDeadline: BigInt(NOW + 3600),
        nonce: 7n,
        executionMode: "triggerOrder",
    };
}

const withinBounds = createGelatoWeb3Function({
    getMarketPrice18: async () => parseUnits("3100", 18),
    nowSeconds: () => NOW,
});
const priceCrossed = createGelatoWeb3Function({
    getMarketPrice18: async () => parseUnits("2900", 18),
    nowSeconds: () => NOW,
});

describe("Gelato trigger evaluation", () => {
    it("derives direction from router price convention", () => {
        // RouterExt price = USD(token0)/USD(token1).
        expect(defaultTriggerDirection("WETH/USDC", "stopLoss")).toBe("below");
        expect(defaultTriggerDirection("WETH/USDC", "takeProfit")).toBe("above");
        expect(defaultTriggerDirection("cbBTC/USDC", "stopLoss")).toBe("above");
        expect(defaultTriggerDirection("cbBTC/USDC", "takeProfit")).toBe("below");
        expect(marketCrossed(2_900n, 3_000n, "below")).toBe(true);
        expect(marketCrossed(2_900n, 3_000n, "above")).toBe(false);
    });

    it("returns canExec:false inside bounds and canExec:true after the WETH stop-loss cross", async () => {
        const args = stopLossArgs("WETH/USDC");
        const before = await withinBounds.onRun(args);
        expect(before.canExec).toBe(false);
        expect(before.callData).toBe("0x");
        expect(before.reason).toMatch(/not crossed/);

        const after = await priceCrossed.onRun(args);
        expect(after.canExec).toBe(true);
        const decoded = decodeFunctionData({ abi: ROUTER_EXT_ABI, data: after.callData as Hex });
        expect(decoded.functionName).toBe("executeTriggerOrder");
        expect(decoded.args).toEqual([ESWAP_CONTRACTS.hook, expect.objectContaining({
            currency0: expect.any(String),
            hooks: ESWAP_CONTRACTS.hook,
        }), TRADER]);
    });

    it("flips the direction for cbBTC stop-loss because USDC is token0", async () => {
        const low = createGelatoWeb3Function({
            getMarketPrice18: async () => parseUnits("2900", 18),
            nowSeconds: () => NOW,
        });
        const high = createGelatoWeb3Function({
            getMarketPrice18: async () => parseUnits("3100", 18),
            nowSeconds: () => NOW,
        });
        const args = stopLossArgs("cbBTC/USDC");
        expect((await low.onRun(args)).canExec).toBe(false);
        expect((await high.onRun(args)).canExec).toBe(true);
    });

    it("honours expiry, armed-order and position gates", async () => {
        const expired = await withinBounds.onRun(stopLossArgs("WETH/USDC"));
        expect(expired.canExec).toBe(false);

        const gated = createGelatoWeb3Function({
            getMarketPrice18: async () => parseUnits("2900", 18),
            getPosition: async () => ({ exists: false }),
            isTriggerArmed: async () => false,
            nowSeconds: () => NOW,
        });
        expect((await gated.onRun(stopLossArgs("WETH/USDC"))).reason).toBe("no open position");

        const unarmed = createGelatoWeb3Function({
            getMarketPrice18: async () => parseUnits("2900", 18),
            isTriggerArmed: async () => false,
            nowSeconds: () => NOW,
        });
        expect((await unarmed.onRun(stopLossArgs("WETH/USDC"))).reason).toBe("no armed trigger order");

        const deadlinePassed = await priceCrossed.onRun({
            ...stopLossArgs("WETH/USDC"),
            closeDeadline: BigInt(NOW - 1),
        });
        expect(deadlinePassed.canExec).toBe(false);
        expect(deadlinePassed.reason).toMatch(/expired/);
    });

    it("encodes closePosition fallback only with a solver and liquidate permissionlessly", async () => {
        const base = stopLossArgs("WETH/USDC");
        const { solver: _unusedSolver, ...baseWithoutSolver } = base;
        const noSolver = await priceCrossed.onRun({
            ...baseWithoutSolver,
            executionMode: "closePosition",
        });
        expect(noSolver.canExec).toBe(false);
        expect(noSolver.reason).toMatch(/solver/);

        const fallback = await priceCrossed.onRun({ ...base, executionMode: "closePosition" });
        expect(fallback.canExec).toBe(true);
        const close = decodeFunctionData({ abi: ROUTER_ABI, data: fallback.callData as Hex });
        expect(close.functionName).toBe("closePosition");
        expect(close.args[2]).toBe(TRADER);

        const liquidation = await priceCrossed.onRun({ ...base, executionMode: "liquidate" });
        const liq = decodeFunctionData({ abi: ROUTER_ABI, data: liquidation.callData as Hex });
        expect(liq.functionName).toBe("liquidate");
        expect(liq.args[2]).toBe(TRADER);
    });

    it("builds an EIP-712 digest pinned to the core router domain", () => {
        const typed = buildTriggerOrderTypedData({
            pair: "WETH/USDC",
            triggerPrice18: parseUnits("3000", 18),
            aboveOrBelow: false,
            minAmountOut: 1n,
            closeDeadline: BigInt(NOW + 3600),
            nonce: 7n,
        });
        expect(typed.domain).toEqual({
            name: "EswapRouter",
            version: "1",
            chainId: BASE_CHAIN_ID,
            verifyingContract: ESWAP_CONTRACTS.router,
        });
        expect(typed.message.executorTipBps).toBe(0);
        expect(hashTypedData(typed)).toMatch(/^0x[0-9a-f]{64}$/);
    });
});

describe("slot0 observation", () => {
    it("converts sqrtPriceX96 into the router's 18-decimal token0/token1 price", () => {
        // 3000 USDC per WETH: token1 raw (6dp) / token0 raw (18dp) = 3e-9.
        const sqrt = BigInt(Math.floor(Math.sqrt(3e-9) * 2 ** 96));
        const price = sqrtPriceX96ToPrice18(sqrt, 18, 6);
        expect(price / 10n ** 18n).toBe(3000n);
    });
});

describe("DCA margin keeper", () => {
    it("generates bounded weekly 5x orders and filters due runs", () => {
        const plan: DcaPlan = {
            id: "weekly-weth",
            pair: "WETH/USDC" as const,
            collateralUsdc: "200",
            frequencySeconds: 604_800,
            startAtUnix: NOW,
            occurrences: 3,
            solver: SOLVER,
        };
        const schedule = generateDcaSchedule(plan);
        expect(schedule).toHaveLength(3);
        expect(schedule[1]!.dueAtUnix).toBe(NOW + 604_800);
        expect(schedule[0]!.collateralUnits).toBe("200000000");
        expect(getDueDcaOrders(plan, NOW + 604_800, -1)).toHaveLength(2);
        expect(getDueDcaOrders(plan, NOW + 604_800, 0)).toHaveLength(1);
    });
});

describe("leverage-token rebalancer math", () => {
    it("allocates L/5 of NAV to Eswap and holds the rest as cash", () => {
        const nav = 100_000_000_000n; // 100,000 USDC
        for (const leverage of [2, 3, 5] as const) {
            const math = calculateLeverageTokenMath({
                targetLeverage: leverage,
                navEquityUnits: nav,
            });
            expect(BigInt(math.targetCollateralUnits)).toBe((nav * BigInt(leverage)) / 5n);
            expect(BigInt(math.targetCashUnits) + BigInt(math.targetCollateralUnits)).toBe(nav);
            expect(BigInt(math.targetExposureUnits) / nav).toBe(BigInt(leverage));
            expect(math.executionLeverage).toBe(5);
            expect(BigInt(math.annualCarrySavedUsdc)).toBeGreaterThan(0n);
        }
        const fiveX = calculateLeverageTokenMath({ targetLeverage: 5, navEquityUnits: nav });
        expect(fiveX.targetCashUnits).toBe("0");
        expect(fiveX.eSwapDebtToEquityBps).toBe(40_000);
        expect(encodeSettlementHookData(TRADER)).toMatch(/^0x/);
    });
});
