/**
 * Stage 2 (honest): Enso route-path validation for the 5x USDC -> WETH open.
 *
 * HONEST CONTRACT
 * ---------------
 * Enso's production pathfinder only routes through protocols registered with
 * Enso. Eswap is NOT on that registry, and Enso exposes no public "register a
 * contract" API that would place the EswapMarginHook into `route.calls`.
 * Therefore the brief's Stage-2 assertion
 *
 *     "Enso includes EswapMarginHook.sol in its route.calls output"
 *
 * CANNOT hold, and this script reports that truthfully instead of pretending.
 *
 * What it does honestly:
 *   [1] Queries the live Enso route endpoint with the exact brief params
 *       ($5 USDC, 5x, USDC -> WETH, chain 8453) and prints the real route.
 *   [2] Reads the live Base Eswap deployment (read-only eth_call) to produce
 *       the Eswap quote for the same trade, so the two numbers can be compared.
 *
 * NO transaction is signed or broadcast.
 *
 * Run:
 *   npx tsx scripts/queryEnsoPath.ts
 *   (or: node --experimental-strip-types scripts/queryEnsoPath.ts)
 */

import path from "node:path";
import dotenv from "dotenv";
import {
  createPublicClient,
  getAddress,
  http,
  parseAbi,
  type Address,
} from "viem";
import { base } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

dotenv.config({ path: path.resolve(process.cwd(), ".env"), override: false });

// ---- fixed brief parameters ($5 collateral, 5x => $25 position, $20 borrow) ---
const CHAIN_ID = 8453;
const AMOUNT_IN = 5_000_000n; // $5.00 USDC (6dp) minute the brief's 5_000_000
const LEVERAGE = 5;
const USDC: Address = getAddress("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
const WETH: Address = getAddress("0x4200000000000000000000000000000000000006");

// Live Base deployment (verified to hold code), NOT the brief's 0x1F98..0004.
const HOOK: Address = getAddress(
  process.env.BASE_HOOK_ADDRESS ?? "0x7b38f16a40683457fa46ecc819103613f47c50c8",
);
const ROUTER: Address = getAddress(
  process.env.BASE_ROUTER_ADDRESS ?? "0xabdd8e37082d232c331b109bc9ca3c62a992f10f",
);
const POOL_FEE = 3000;
const TICK_SPACING = 60;

const RPC = process.env.BASE_RPC_URL ?? "https://mainnet.base.org";

type PoolKeyTuple = readonly [Address, Address, number, number, Address];
// WETH (0x4200..06) sorts below USDC (0x8335..13) => currency0 = WETH.
const HOOK_POOL_KEY: PoolKeyTuple = [WETH, USDC, POOL_FEE, TICK_SPACING, HOOK];

const ROUTER_ABI = parseAbi([
  "function quoteExactInput((address,address,uint24,int24,address) key, bool zeroForOne, int128 amountSpecified, uint8 leverage) view returns (int128 amountOut)",
]);

function actor(): Address {
  if (process.env.TRADER_ADDRESS) return getAddress(process.env.TRADER_ADDRESS);
  if (process.env.TINY_TRADER_PK) {
    return privateKeyToAccount(process.env.TINY_TRADER_PK as `0x${string}`).address;
  }
  return ROUTER;
}

async function tryEnsoRoute(): Promise<{ amountOut: bigint | null; mentionsHook: boolean }> {
  const apiKey = process.env.ENSO_API_KEY;
  const baseUrl = process.env.ENSO_API_URL ?? "https://api.enso.finance";
  const sender = actor();

  console.log("\n[1] Enso pathfinder query (live)");
  console.log(`    fromAddress=${sender}`);
  if (!apiKey) {
    console.log("    ENSO_API_KEY unset -> cannot query (set it to enable).");
    return { amountOut: null, mentionsHook: false };
  }

  const url = new URL(`${baseUrl}/api/v1/shortcuts/route`);
  url.searchParams.set("chainId", String(CHAIN_ID));
  url.searchParams.set("fromAddress", sender);
  url.searchParams.set("tokenIn", USDC);
  url.searchParams.set("tokenOut", WETH);
  url.searchParams.set("amountIn", AMOUNT_IN.toString());
  url.searchParams.set("slippage", "50");
  url.searchParams.set("routingStrategy", "router");
  // brief also referenced these; harmless aliases for the same request.
  url.searchParams.set("actor", sender);
  url.searchParams.set("recipient", sender);

  try {
    const res = await fetch(url, {
      headers: { accept: "application/json", authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(20_000),
    });
    const text = await res.text();
    if (!res.ok) {
      console.log(`    Enso HTTP ${res.status}: ${text.slice(0, 300)}`);
      return { amountOut: null, mentionsHook: false };
    }
    const json = JSON.parse(text) as {
      amountOut?: string;
      gas?: string;
      route?: Array<{ protocol?: string; action?: string }>;
    };
    const amountOut = json.amountOut ? BigInt(json.amountOut) : null;
    const protocols = (json.route ?? [])
      .map((r) => `${r.action ?? "?"}:${r.protocol ?? "?"}`)
      .join(", ");
    console.log(`    Enso amountOut : ${amountOut ?? "n/a"} WETH (wei)`);
    console.log(`    Enso gas       : ${json.gas ?? "n/a"}`);
    console.log(`    Enso route     : ${protocols || "n/a"}`);

    const mentionsHook = text.toLowerCase().includes(HOOK.slice(2).toLowerCase());
    console.log(`    route references Eswap hook (${HOOK})? ${mentionsHook ? "YES" : "NO"}`);
    console.log(
      "    NOTE: Eswap is not registered with Enso's pathfinder, so NO here is the\n" +
        "          expected, honest result -- the brief's assertion cannot hold.",
    );
    return { amountOut, mentionsHook };
  } catch (e) {
    console.log(`    Enso query failed: ${(e as Error).message}`);
    return { amountOut: null, mentionsHook: false };
  }
}

async function eswapQuote(): Promise<bigint | null> {
  console.log("\n[2] Live Base Eswap quote (read-only eth_call)");
  const client = createPublicClient({ chain: base, transport: http(RPC, { timeout: 20_000 }) });
  try {
    const chainId = await client.getChainId();
    if (chainId !== CHAIN_ID) {
      console.log(`    RPC chainId=${chainId}, expected ${CHAIN_ID}`);
      return null;
    }
  } catch {
    console.log(`    RPC ${RPC} unreachable.`);
    return null;
  }

  try {
    const out = (await client.readContract({
      address: ROUTER,
      abi: ROUTER_ABI,
      functionName: "quoteExactInput",
      args: [HOOK_POOL_KEY, false /* buy WETH with USDC => long */, -int(AMOUNT_IN), LEVERAGE],
    })) as bigint;
    console.log(`    Router.quoteExactInput($5 USDC, 5x) = ${out} WETH (wei)`);
    return out;
  } catch (e) {
    console.log(`    Eswap quote reverted: ${(e as Error).message.slice(0, 240)}`);
    console.log(
      "    (Expected if the live WETH/USDC hook pool has no seeded liquidity yet.)",
    );
    return null;
  }
}

function int(v: bigint): bigint {
  return v;
}

async function main() {
  console.log("=== Stage 2: Enso route-path validation (honest, read-only) ===");
  console.log(`chainId=${CHAIN_ID} amountIn=${AMOUNT_IN} ($5 USDC) leverage=${LEVERAGE}x`);
  console.log(`tokenIn=${USDC}`);
  console.log(`tokenOut=${WETH}`);
  const enso = await tryEnsoRoute();
  const eswap = await eswapQuote();

  console.log("\n--- comparison (like-for-like SPOT, not notional) ---");
  console.log(`    Enso spot out for $5      : ${enso.amountOut ?? "n/a"} WETH (wei)`);
  if (eswap !== null) {
    const eswapSpot = eswap / BigInt(LEVERAGE);
    console.log(`    Eswap quote (5x notional): ${eswap} WETH (wei)`);
    console.log(`    Eswap quote / leverage    : ${eswapSpot} WETH (wei)  <- spot-equivalent`);
    if (enso.amountOut !== null) {
      const better = eswapSpot >= enso.amountOut;
      console.log(
        `    -> Eswap spot-equivalent is ${better ? "AT/ABOVE" : "BELOW"} the Enso single-pool route ` +
          `(${eswapSpot} vs ${enso.amountOut} wei).`,
      );
      console.log(
        "    -> The 0.00% daily borrow carry is a property of the Eswap 5x position\n" +
          "       (the $20 leg is borrowed interest-free), NOT a better spot rate.",
      );
    }
  } else {
    console.log("    Eswap quote unavailable -> not comparable yet.");
  }
  console.log("\nDone. No transaction was signed or broadcast.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
