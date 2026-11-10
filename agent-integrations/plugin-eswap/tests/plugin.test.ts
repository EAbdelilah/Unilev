import { describe, expect, it } from "vitest";
import { OpenMarginActionSchema } from "../src/schemas.js";
import {
  carryDragBenchmarkRaw,
  formatRawAmount,
  marginParts,
  minAmountOutOf,
  parseRawAmount,
  protocolFeeRaw,
} from "../src/utils.js";
import { ESWAP_PAIRS, resolveDeploymentWith } from "../src/constants.js";

describe("plugin schemas", () => {
  it("applies defaults (leverage=5, slippage=50bps)", () => {
    const parsed = OpenMarginActionSchema.parse({ pair: "WETH/USDC", collateralAmount: "100" });
    expect(parsed.leverage).toBe(5);
    expect(parsed.slippageToleranceBps).toBe(50);
  });

  it("rejects non-5 leverage", () => {
    expect(() => OpenMarginActionSchema.parse({ pair: "WETH/USDC", collateralAmount: "10", leverage: 10 })).toThrow();
  });
});

describe("plugin utils", () => {
  it("marginParts for 5x", () => {
    const m = parseRawAmount("100", 6);
    const p = marginParts(m, 5);
    expect(p.notional).toBe(500_000_000n);
    expect(p.borrowed).toBe(400_000_000n);
  });

  it("protocol fee 0.10%", () => {
    expect(protocolFeeRaw(500_000_000n)).toBe(500_000n);
  });

  it("carry benchmark 400 USDC / 7d ≈ 0.920547", () => {
    expect(carryDragBenchmarkRaw(400_000_000n)).toBe(920_547n);
    expect(formatRawAmount(920_547n, 6)).toBe("0.920547");
  });

  it("minAmountOut applies bps", () => {
    expect(minAmountOutOf(10_000n, 50)).toBe(9_950n);
  });

  it("WBTC pair flagged unconfigured", () => {
    expect(ESWAP_PAIRS["WBTC/USDC"].fillVenueConfiguredInOut).toBe(false);
    expect(ESWAP_PAIRS["WETH/USDC"].fillVenueConfiguredInOut).toBe(true);
  });

  it("deployment resolution defaults + override", () => {
    const d = resolveDeploymentWith(undefined, undefined);
    expect(d.hook).toBe("0xe33A630503c640143126BBF222a82689D49b50c8");
    expect(d.router).toBe("0xD3360D67E366Cac21a1c18fC9100B93be79e1437");
    const d2 = resolveDeploymentWith("0x1111111111111111111111111111111111111111", null);
    expect(d2.hook).toBe("0x1111111111111111111111111111111111111111");
  });
});
