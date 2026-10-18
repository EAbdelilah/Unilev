/**
 * Stage 2 — Aggregator Pathfinder simulation (Base mainnet, chain 8453).
 *
 * Mirrors Enso's off-chain route evaluation with a direct eth_call against the
 * Eswap quote surface, then states the brief's Stage-2 assertion exactly as it
 * is and reports whether it actually holds.
 *
 * Brief assertion (quoted): the quoter "returns a higher net WETH payout than a
 * standard Uniswap v3/v4 swap path because 0.00% daily borrow carry drag
 * eliminates continuous fee decay."
 *
 * HONEST RESULT: this cannot hold. Leverage amplifies EXPOSURE, not the
 * exchange RATE. A $25 notional swap on a deeper standard pool returns ~$25 of
 * WETH minus fees regardless of who borrowed the other $20. The "0.00% carry"
 * is a property of the Eswap position (the borrow leg is interest-free), not a
 * better spot rate. So we report the two numbers and label the assertion FALSE.
 *
 * No transaction is signed or broadcast.
 *
 * Run: npx tsx scripts/simulateEnsoPath.ts
 */
import path from "node:path";
import dotenv from "dotenv";
import { ethers } from "ethers";

dotenv.config({ path: path.resolve(process.cwd(), ".env"), override: false });

const RPC = process.env.BASE_RPC_URL ?? "https://mainnet.base.org";
const CHAIN_ID = 8453;
const USDC = ethers.getAddress("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
const WETH = ethers.getAddress("0x4200000000000000000000000000000000000006");
const HOOK = ethers.getAddress(process.env.V4_HOOK_ADDRESS ?? "0x6f98Ea19e522Ecc706E0Fb1574BDA8D32aC510C8");
const ROUTER = ethers.getAddress(process.env.V4_ROUTER_ADDRESS ?? "0x57E75A87A62ab8Ff14C59FA10Ac2AB2c8cBD45D1");
const QUOTER_RAW = process.env.V4_QUOTER_ADDRESS ?? "0x3177f4e53a0EE0318174771b32E68aDe63c20f3b";
const POOL_FEE = 3000;
const TICK_SPACING = 60;

const AMOUNT_IN = 5_000_000n; // $5.00 USDC (6dp)
const LEVERAGE = 5; // => $25 notional, $20 borrow

// WETH (0x4200..06) sorts below USDC (0x8335..13) => currency0 = WETH.
const HOOK_POOL_KEY = [WETH, USDC, POOL_FEE, TICK_SPACING, HOOK] as const;

const ROUTER_ABI = [
  "function quoteExactInput((address,address,uint24,int24,address) key, bool zeroForOne, int128 amountSpecified, uint8 leverage) view returns (int128 amountOut)",
  "function registeredSolvers(address) view returns (bool)",
];
const QUOTER_ABI = [
  "function quoteExactInputSingleWithLeverage(address tokenIn, address tokenOut, uint24 fee, uint8 leverage, int256 amountIn) view returns (int128 amountOut)",
];

async function main() {
  console.log("=== Stage 2: Aggregator pathfinder simulation (Base 8453) ===");
  console.log(`amountIn = ${AMOUNT_IN} ($5.00 USDC)  leverage = ${LEVERAGE}x  notional = $25`);
  console.log(`hookPoolKey = [WETH, USDC, ${POOL_FEE}, ${TICK_SPACING}, ${HOOK}]`);

  const provider = new ethers.JsonRpcProvider(RPC);
  const net = await provider.getNetwork();
  console.log(`RPC chainId = ${net.chainId}  block = ${await provider.getBlockNumber()}`);
  if (Number(net.chainId) !== CHAIN_ID) throw new Error(`RPC is chain ${net.chainId}, expected ${CHAIN_ID}`);

  // [1] Enso (the "aggregator demand" leg) — real live query, honest about listing.
  const enso = await queryEnso();
  // [2] Eswap core quote — quoter if deployed, else the router (same slot0 path).
  const eswap = await eswapQuote(provider);

  console.log("\n--- comparison ---");
  console.log(`    Enso spot out for $5          : ${enso ?? "n/a"} WETH (wei)`);
  if (eswap !== null) {
    const spotEquivalent = eswap / BigInt(LEVERAGE);
    console.log(`    Eswap 5x quote                : ${eswap} WETH (wei)`);
    console.log(`    Eswap quote / leverage        : ${spotEquivalent} WETH (wei)  [spot-equivalent]`);
    if (enso !== null) {
      const better = spotEquivalent >= enso;
      console.log(`    -> Eswap spot-equiv is ${better ? "AT/ABOVE" : "BELOW"} the Enso single-pool route.`);
    }
  }

  console.log("\n--- brief Stage-2 assertion ---");
  console.log('    "quoter returns a HIGHER net WETH payout than a standard swap because');
  console.log('     0.00% daily borrow carry eliminates continuous fee decay"');
  console.log("    RESULT: FALSE (cannot hold). Leverage scales notional, not the rate.");
  console.log("    The 0.00% carry is real and is a property of the Eswap POSITION (the");
  console.log("    $20 borrow leg is interest-free); it is not a better exchange rate.");
  console.log("\nNo transaction was signed or broadcast.");
}

async function queryEnso(): Promise<bigint | null> {
  console.log("\n[1] Aggregator demand — live Enso route endpoint");
  const apiKey = process.env.ENSO_API_KEY;
  if (!apiKey) {
    console.log("    ENSO_API_KEY unset -> skipping live query.");
    return null;
  }
  const sender =
    process.env.TINY_TRADER_ADDRESS ??
    process.env.TRADER_ADDRESS ??
    "0xd9Aba9723d14b36588bcF9D47c2FF355EEC47F3c";
  const url = new URL("https://api.enso.finance/api/v1/shortcuts/route");
  url.searchParams.set("chainId", String(CHAIN_ID));
  url.searchParams.set("fromAddress", sender);
  url.searchParams.set("tokenIn", USDC);
  url.searchParams.set("tokenOut", WETH);
  url.searchParams.set("amountIn", AMOUNT_IN.toString());
  url.searchParams.set("slippage", "50");
  url.searchParams.set("routingStrategy", "router");
  try {
    const res = await fetch(url, {
      headers: { accept: "application/json", authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(20_000),
    });
    const text = await res.text();
    if (!res.ok) {
      console.log(`    Enso HTTP ${res.status}: ${text.slice(0, 200)}`);
      return null;
    }
    const j = JSON.parse(text);
    const route = (j.route ?? []).map((r: any) => `${r.action ?? "?"}:${r.protocol ?? "?"}`).join(", ");
    console.log(`    Enso amountOut : ${j.amountOut ?? "n/a"}`);
    console.log(`    Enso route     : ${route || "n/a"}`);
    const mentionsHook = text.toLowerCase().includes(HOOK.slice(2).toLowerCase());
    console.log(`    references Eswap hook? ${mentionsHook ? "YES" : "NO (expected: Eswap is not listed)"}`);
    return j.amountOut ? BigInt(j.amountOut) : null;
  } catch (e) {
    console.log(`    Enso query failed: ${(e as Error).message}`);
    return null;
  }
}

async function eswapQuote(provider: ethers.Provider): Promise<bigint | null> {
  console.log("\n[2] Eswap core quote — eth_call");
  const quoterCode = await provider.getCode(QUOTER_RAW);
  const router = new ethers.Contract(ROUTER, ROUTER_ABI, provider);
  try {
    const out = (await router.quoteExactInput(HOOK_POOL_KEY, false, -AMOUNT_IN, LEVERAGE)) as bigint;
    if (quoterCode && quoterCode !== "0x") {
      const quoter = new ethers.Contract(QUOTER_RAW, QUOTER_ABI, provider);
      try {
        const q = (await quoter.quoteExactInputSingleWithLeverage(USDC, WETH, POOL_FEE, LEVERAGE, -AMOUNT_IN)) as bigint;
        console.log(`    Quoter.quoteExactInputSingleWithLeverage = ${q} WETH`);
      } catch (e) {
        console.log(`    Quoter call reverted (${(e as Error).message.slice(0, 80)}); router quote below`);
      }
    } else {
      console.log(`    EswapLeverageQuoter has no code at ${QUOTER_RAW} -> using router.quoteExactInput`);
    }
    console.log(`    Router.quoteExactInput($5, 5x) = ${out} WETH (wei)`);
    return out;
  } catch (e) {
    console.log(`    Eswap quote reverted: ${(e as Error).message.slice(0, 200)}`);
    return null;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
