import { describe, expect, it } from "vitest";
import { formatUnits, parseUnits } from "viem";
import {
    applyProtocolFee,
    assembleQuote,
    buildSwapParams,
    carryInterestUnits,
    ESWAP_PROTOCOL_SPECS,
    LEVERAGE,
    PAIRS,
    parseCollateralUnits,
    PROTOCOL_FEE_BPS,
    toSwapParamsJson,
    USDC,
} from "../src/index.js";

describe("USDC + base-token decimal scaling", () => {
    it("parses collateral as exact 6-decimal USDC units", () => {
        expect(parseCollateralUnits("1000")).toBe(1_000_000_000n);
        expect(parseCollateralUnits("0.000001")).toBe(1n);
        expect(parseCollateralUnits("123.450001")).toBe(123_450_001n);
    });

    it("rejects invalid precision, zero and non-decimal input", () => {
        expect(() => parseCollateralUnits("1.0000001")).toThrow(/at most 6 decimals/);
        expect(() => parseCollateralUnits("0")).toThrow(/greater than zero/);
        expect(() => parseCollateralUnits("1e3")).toThrow(/at most 6 decimals/);
        expect(() => parseCollateralUnits("-1")).toThrow(/at most 6 decimals/);
    });

    it("uses 8 decimals for cbBTC and 18 for WETH", () => {
        expect(PAIRS["cbBTC/USDC"].base.decimals).toBe(8);
        expect(PAIRS["WETH/USDC"].base.decimals).toBe(18);
        expect(USDC.decimals).toBe(6);
        expect(formatUnits(50_000_000n, 8)).toBe("0.5");
        expect(formatUnits(parseUnits("0.00000001", 8), 8)).toBe("0.00000001");
    });

    it("orders both hook and standard pool keys currency0 < currency1 with the live addresses", () => {
        for (const pair of ["WETH/USDC", "cbBTC/USDC"] as const) {
            const config = PAIRS[pair];
            // Uniswap v4 requires ascending addresses. WETH < USDC, but USDC < cbBTC.
            expect(config.hookPoolKey.currency0.toLowerCase() < config.hookPoolKey.currency1.toLowerCase()).toBe(true);
            expect([config.hookPoolKey.currency0.toLowerCase(), config.hookPoolKey.currency1.toLowerCase()].sort()).toEqual(
                [config.base.address.toLowerCase(), USDC.address.toLowerCase()].sort(),
            );
            expect(config.hookPoolKey.fee).toBe(3000);
            expect(config.hookPoolKey.tickSpacing).toBe(60);
            expect(config.hookPoolKey.hooks.toLowerCase()).toBe(
                "0x7b3f232bb5a0346fadb8b92b31b3e7bc60bd90c8",
            );
            expect(config.standardPoolKey.fee).toBe(500);
            expect(config.standardPoolKey.tickSpacing).toBe(10);
            expect(config.standardPoolKey.hooks).toBe("0x0000000000000000000000000000000000000000");
        }
    });
});

describe("quote math", () => {
    it("deducts exactly 10 bps of the bought leg", () => {
        expect(applyProtocolFee(50_000_000n)).toEqual({
            protocolFeeUnits: 50_000n,
            netUnits: 49_950_000n,
        });
        expect(PROTOCOL_FEE_BPS).toBe(10);
    });

    it("computes 12% APR carry on the borrowed 4x leg", () => {
        const borrow = 4_000_000_000n; // 4000 USDC
        expect(carryInterestUnits(borrow, 1200, 7)).toBe(9_205_479n);
        expect(carryInterestUnits(borrow, 1200, 30)).toBe(39_452_054n);
        expect(carryInterestUnits(borrow, 0, 30)).toBe(0n);
    });

    it("assembles a cbBTC quote with 8-decimal net output and correct price", () => {
        const quote = assembleQuote("cbBTC/USDC", "1000", { outputUnits: 50_000_000n, source: "router" });
        expect(quote.collateralUsdcUnits).toBe("1000000000");
        expect(quote.borrowUsdc).toBe("4000");
        expect(quote.notionalUsdc).toBe("5000");
        expect(quote.tokenOutSymbol).toBe("cbBTC");
        expect(quote.tokenOutDecimals).toBe(8);
        expect(quote.grossTokenOut).toBe("0.5");
        expect(quote.protocolFeeTokenOut).toBe("0.0005");
        expect(quote.netTokenOut).toBe("0.4995");
        expect(quote.estimatedPriceUsdcPerToken).toBe("10000");
        expect(quote.protocolFeeUsdcApprox).toBe("5");
        // USDC (0x83...) sorts below cbBTC (0xcb...), so USDC is currency0 and the input leg is one-for-zero.
        expect(quote.zeroForOne).toBe(true);
        expect(quote.savings.days7.benchmarkInterestUsdc).toBe("9.205479");
        expect(quote.savings.days30.savedUsdc).toBe("39.452054");
        expect(quote.savings.days7.eswapInterestUsdc).toBe("0");
        expect(quote.leverage).toBe(LEVERAGE);
    });

    it("assembles a WETH quote with 18-decimal net output", () => {
        const quote = assembleQuote("WETH/USDC", "1000", { outputUnits: 10n ** 18n, source: "quoter" });
        expect(quote.tokenOutSymbol).toBe("WETH");
        expect(quote.grossTokenOut).toBe("1");
        expect(quote.protocolFeeTokenOut).toBe("0.001");
        expect(quote.netTokenOut).toBe("0.999");
        expect(quote.estimatedPriceUsdcPerToken).toBe("5000");
        expect(quote.quoteSource).toBe("quoter");
    });
});

describe("swap encoding", () => {
    it("encodes a negative-margin, self-bonded 5x long with a slippage floor", () => {
        const params = buildSwapParams({
            pair: "cbBTC/USDC",
            collateralUnits: 1_000_000_000n,
            quoteOutputUnits: 50_000_000n,
            slippageBps: 100,
            solver: "0x1111111111111111111111111111111111111111",
            deadline: 2_000_000_000n,
        });
        expect(params.zeroForOne).toBe(true);
        expect(params.amountSpecified).toBe(-1_000_000_000n);
        expect(params.leverage).toBe(5);
        expect(params.hookData).toBe("0x");
        expect(params.minAmountOut).toBe(49_500_000n);
        expect(params.key.fee).toBe(3000);
        expect(params.standardPoolKey.fee).toBe(500);
        expect(toSwapParamsJson(params).amountSpecified).toBe("-1000000000");
        expect(() =>
            buildSwapParams({
                pair: "WETH/USDC",
                collateralUnits: 1n,
                quoteOutputUnits: 1n,
                slippageBps: 10_001,
                solver: "0x1111111111111111111111111111111111111111",
                deadline: 1n,
            }),
        ).toThrow(/slippageBps/);
    });
});

describe("protocol positioning", () => {
    it("documents the pure JIT model and rejects vault/TVL", () => {
        expect(ESWAP_PROTOCOL_SPECS.architecture.tvl).toBe(0);
        expect(ESWAP_PROTOCOL_SPECS.architecture.interestRate).toContain("0.00%");
        expect(ESWAP_PROTOCOL_SPECS.architecture.rejectedModels.join(" ").toLowerCase()).toContain("erc-4626");
        expect(ESWAP_PROTOCOL_SPECS.supportedPairs).toEqual(["WETH/USDC", "cbBTC/USDC"]);
    });
});
