import { afterEach, describe, expect, it } from "vitest";
import {
  carryDragBenchmarkRaw,
  defaultStandardPoolKey,
  formatRawAmount,
  marginParts,
  minAmountOutOf,
  parseRawAmount,
  poolIdOf,
  protocolFeeRaw,
} from "../src/action-providers/eswap/utils.js";
import { ESWAP_PAIRS, hookPoolKey, resolveEswapDeployment } from "../src/action-providers/eswap/constants.js";

describe("parse/format (explicit decimals)", () => {
  it("parses USDC (6 decimals)", () => {
    expect(parseRawAmount("100.5", 6)).toBe(100_500_000n);
  });

  it("parses WETH (18 decimals) and WBTC (8 decimals) independently", () => {
    expect(parseRawAmount("1.5", 18)).toBe(1_500_000_000_000_000_000n);
    expect(parseRawAmount("1.5", 8)).toBe(150_000_000n);
  });

  it("round-trips", () => {
    expect(formatRawAmount(parseRawAmount("1234.567890", 6), 6)).toBe("1234.56789");
  });

  it("rejects garbage and zero", () => {
    expect(() => parseRawAmount("0", 6)).toThrow();
    expect(() => parseRawAmount("1e6", 6)).toThrow();
    expect(() => parseRawAmount("0x10", 6)).toThrow();
  });
});

describe("margin math", () => {
  it("computes notional/borrow for 5x", () => {
    const margin = parseRawAmount("100", 6);
    const parts = marginParts(margin, 5);
    expect(parts.notional).toBe(500_000_000n);
    expect(parts.borrowed).toBe(400_000_000n);
  });

  it("computes the 0.10% protocol fee on notional", () => {
    expect(protocolFeeRaw(500_000_000n)).toBe(500_000n); // $5000 notional → $5 fee
  });

  it("carry benchmark: 400 USDC borrowed at 12% APR over 7 days ≈ 0.920547 USDC saved", () => {
    const raw = carryDragBenchmarkRaw(400_000_000n);
    expect(raw).toBe(920_547n); // 400e6 * 1200 * 7 / (365 * 10000) = 920547.945…
    expect(formatRawAmount(raw, 6)).toBe("0.920547"); // USDC 6dp
  });

  it("minAmountOut applies bps correctly", () => {
    expect(minAmountOutOf(10_000n, 50)).toBe(9_950n);
    expect(minAmountOutOf(10_000n, 0)).toBe(10_000n);
    expect(() => minAmountOutOf(10_000n, 4000)).toThrow();
  });
});

describe("pool identity", () => {
  it("PoolKey ordering puts base (WETH/WBTC) as currency0 vs USDC", () => {
    expect(ESWAP_PAIRS["WETH/USDC"].base < ESWAP_PAIRS["WETH/USDC"].quote).toBe(true);
    expect(ESWAP_PAIRS["WBTC/USDC"].base < ESWAP_PAIRS["WBTC/USDC"].quote).toBe(true);
  });

  it("long = zeroForOne:false on both pairs (USDC=currency1 → base=currency0)", () => {
    expect(ESWAP_PAIRS["WETH/USDC"].longZeroForOne).toBe(false);
    expect(ESWAP_PAIRS["WBTC/USDC"].longZeroForOne).toBe(false);
  });

  it("matches the live-hashed WETH/USDC hook poolId (verified on-chain 2026-11-03)", () => {
    const { hook } = resolveEswapDeployment();
    const id = poolIdOf(hookPoolKey(ESWAP_PAIRS["WETH/USDC"], hook));
    // Computed and cross-checked against Base via hook.standardPoolKeys(poolId)
    expect(id).toBe("0xdd4958586bcbc340177b3b18ecbf31cfa277e5a8a78735deee01218f54a1d512");
  });

  it("WBTC pair is flagged as fill-venue-not-configured (verified on-chain)", () => {
    expect(ESWAP_PAIRS["WBTC/USDC"].fillVenueConfiguredInOut).toBe(false);
    expect(ESWAP_PAIRS["WETH/USDC"].fillVenueConfiguredInOut).toBe(true);
    const stdKey = defaultStandardPoolKey(ESWAP_PAIRS["WETH/USDC"]);
    expect(stdKey).toEqual([
      "0x4200000000000000000000000000000000000006",
      "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      500,
      10,
      "0x0000000000000000000000000000000000000000",
    ]);
  });
});

describe("deployment resolution", () => {
  afterEach(() => {
    delete process.env.ESWAP_HOOK_ADDRESS;
    delete process.env.ESWAP_ROUTER_ADDRESS;
  });

  it("defaults to the live-verified Base deployment", () => {
    const d = resolveEswapDeployment();
    expect(d.hook).toBe("0xe33A630503c640143126BBF222a82689D49b50c8");
    expect(d.router).toBe("0xD3360D67E366Cac21a1c18fC9100B93be79e1437");
  });

  it("honors env overrides for redeploys", () => {
    process.env.ESWAP_HOOK_ADDRESS = "0x1111111111111111111111111111111111111111";
    const d = resolveEswapDeployment();
    expect(d.hook).toBe("0x1111111111111111111111111111111111111111");
    expect(d.router).toBe("0xD3360D67E366Cac21a1c18fC9100B93be79e1437");
  });

  it("ignores malformed env values instead of trusting them", () => {
    process.env.ESWAP_HOOK_ADDRESS = "0x6f98Ea19b5e52B88e624f2b1d7dE63F285aE1842"; // not checksummable/no code on Base
    const d = resolveEswapDeployment();
    expect(d.hook).toBe("0xe33A630503c640143126BBF222a82689D49b50c8");
  });
});
