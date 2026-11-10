import { describe, expect, it } from "vitest";
import { EswapPairSchema, GetEswapQuoteSchema, OpenSpotMarginSchema } from "../src/action-providers/eswap/schemas.js";

describe("EswapPairSchema", () => {
  it("accepts the two listed pairs", () => {
    expect(EswapPairSchema.parse("WETH/USDC")).toBe("WETH/USDC");
    expect(EswapPairSchema.parse("WBTC/USDC")).toBe("WBTC/USDC");
  });

  it("rejects any other pair", () => {
    expect(() => EswapPairSchema.parse("SOL/USDC")).toThrow();
    expect(() => EswapPairSchema.parse("weth/usdc")).toThrow();
  });
});

describe("GetEswapQuoteSchema", () => {
  it("parses a well-formed quote request", () => {
    const parsed = GetEswapQuoteSchema.parse({ pair: "WETH/USDC", collateralAmount: "100.5" });
    expect(parsed.pair).toBe("WETH/USDC");
    expect(parsed.collateralAmount).toBe("100.5");
  });

  it("rejects negative or malformed collateralAmount", () => {
    expect(() => GetEswapQuoteSchema.parse({ pair: "WETH/USDC", collateralAmount: "-10" })).toThrow();
    expect(() => GetEswapQuoteSchema.parse({ pair: "WETH/USDC", collateralAmount: "1e6" })).toThrow();
    expect(() => GetEswapQuoteSchema.parse({ pair: "WETH/USDC", collateralAmount: "" })).toThrow();
  });

  it("is strict about unknown keys", () => {
    expect(() => GetEswapQuoteSchema.parse({ pair: "WETH/USDC", collateralAmount: "1", extra: true })).toThrow();
  });
});

describe("OpenSpotMarginSchema", () => {
  it("applies contract-fixed defaults (leverage=5, slippage=50bps)", () => {
    const parsed = OpenSpotMarginSchema.parse({
      pair: "WETH/USDC",
      collateralAmount: "100",
    });
    expect(parsed.leverage).toBe(5);
    expect(parsed.slippageToleranceBps).toBe(50);
  });

  it("allows explicit slippage within bounds", () => {
    const parsed = OpenSpotMarginSchema.parse({
      pair: "WBTC/USDC",
      collateralAmount: "50.25",
      leverage: 5,
      slippageToleranceBps: 150,
    });
    expect(parsed.slippageToleranceBps).toBe(150);
  });

  it("rejects leverage ≠ 5", () => {
    expect(() => OpenSpotMarginSchema.parse({ pair: "WBTC/USDC", collateralAmount: "10", leverage: 10 })).toThrow();
  });

  it("rejects out-of-bounds slippage", () => {
    expect(() => OpenSpotMarginSchema.parse({ pair: "WETH/USDC", collateralAmount: "10", slippageToleranceBps: 5000 })).toThrow();
    expect(() => OpenSpotMarginSchema.parse({ pair: "WETH/USDC", collateralAmount: "10", slippageToleranceBps: -1 })).toThrow();
  });

  it("rejects finer-than-USDC collateral precision (7 decimals)", () => {
    expect(() => OpenSpotMarginSchema.parse({ pair: "WETH/USDC", collateralAmount: "1.2345678" })).toThrow();
    expect(() => OpenSpotMarginSchema.parse({ pair: "WETH/USDC", collateralAmount: "1.234567" })).not.toThrow();
  });
});
