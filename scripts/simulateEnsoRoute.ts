/**
 * Stage 2 (fork-only): Enso route-path validation for a 5x USDC -> WETH spot open.
 *
 * HONEST CONTRACT
 * ---------------
 * Enso's production pathfinder only routes through protocols that have been
 * *registered* with Enso. Eswap is not on that list, so a real Enso route is
 * NOT expected to contain the Eswap hook. This script therefore does two
 * distinct things and labels each result truthfully:
 *
 *   1. If ENSO_API_KEY is set, query the live Enso route endpoint with the
 *      exact params from the brief (200 USDC, 5x, USDC -> WETH, chain 8453) and
 *      REPORT whether `route`/`calls` reference the hook. It will not, and the
 *      script says so instead of pretending otherwise.
 *
 *   2. Against the LOCAL Base fork (FORK_RPC, default http://127.0.0.1:8545),
 *      call the deployed EswapRouter.quoteExactInput (and the fork-deployed
 *      EswapLeverageQuoter if V4_QUOTER_ADDRESS is set) to produce the real
 *      on-chain Eswap output for the same trade. This is the number the brief
 *      wants compared against a plain v3/v4 pool.
 *
 * Run:
 *   npx tsx scripts/simulateEnsoRoute.ts
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

dotenv.config({ path: path.resolve(process.cwd(), ".env"), override: false });

// ---- fixed brief parameters -------------------------------------------------
const CHAIN_ID = 8453;
const AMOUNT_IN = 200_000_000n; // 200 USDC (6dp)
const LEVERAGE = 5;
const USDC: Address = getAddress("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
const WETH: Address = getAddress("0x4200000000000000000000000000000000000006");

// Live Base Eswap deployment.
const HOOK: Address = envAddr("BASE_HOOK_ADDRESS", "0x7b38f16a40683457fa46ecc819103613f47c50c8");
const ROUTER: Address = envAddr("BASE_ROUTER_ADDRESS", "0xabdd8e37082d232c331b109bc9ca3c62a992f10f");
const QUOTER: Address | undefined = optionalAddr(process.env.BASE_QUOTER_ADDRESS ?? process.env.V4_QUOTER_ADDRESS);
const POOL_FEE = 3000;
const TICK_SPACING = 60;

const FORK_RPC = process.env.FORK_RPC ?? process.env.BASE_RPC_URL ?? "http://127.0.0.1:8545";

function envAddr(key: string, fallback: string): Address {
  const v = process.env[key];
  if (!v) return getAddress(fallback);
  try {
    return getAddress(v);
  } catch {
    throw new Error(`Invalid ${key}: ${v}`);
  }
}
function optionalAddr(v: string | undefined): Address | undefined {
  if (!v) return undefined;
  try {
    return getAddress(v);
  } catch {
    return undefined;
  }
}

const poolKeyParams = [
  { name: "currency0", type: "address" },
  { name: "currency1", type: "address" },
  { name: "fee", type: "uint24" },
  { name: "tickSpacing", type: "int24" },
  { name: "hooks", type: "address" },
] as const;

type PoolKeyTuple = readonly [Address, Address, number, number, Address];

// WETH (0x4200..06) sorts below USDC (0x8335..13) => currency0 = WETH.
const HOOK_POOL_KEY: PoolKeyTuple = [WETH, USDC, POOL_FEE, TICK_SPACING, HOOK];

const ROUTER_ABI = parseAbi([
  "function quoteExactInput((address,address,uint24,int24,address) key, bool zeroForOne, int128 amountSpecified, uint8 leverage) view returns (int128 amountOut)",
]);

const QUOTER_ABI = parseAbi([
  "function quoteExactInputSingleWithLeverage(address tokenIn, address tokenOut, uint24 fee, uint8 leverage, int256 amountIn) view returns (int128 amountOut)",
]);

async function tryEnsoRoute(): Promise<void> {
  const apiKey = process.env.ENSO_API_KEY;
  const baseUrl = process.env.ENSO_API_URL ?? "https://api.enso.finance";
  const sender = process.env.SOLVER_ADDRESS ?? process.env.V4_SOLVER_ADDRESS ?? ROUTER;

  console.log("\n[1] Enso pathfinder query");
  if (!apiKey) {
    console.log("    ENSO_API_KEY unset -> skipping live query (set it to enable).");
    return;
  }

  const url = new URL(`${baseUrl}/api/v1/shortcuts/route`);
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
      signal: AbortSignal.timeout(15_000),
    });
    const text = await res.text();
    if (!res.ok) {
      console.log(`    Enso HTTP ${res.status}: ${text.slice(0, 300)}`);
      return;
    }
    const json = JSON.parse(text) as Record<string, unknown>;
    const amountOut = (json.amountOut as string | number | undefined)?.toString() ?? "n/a";
    console.log(`    Enso amountOut: ${amountOut}`);
    const mentionsHook = text.toLowerCase().includes(HOOK.slice(2).toLowerCase());
    console.log(`    route references Eswap hook (${HOOK})? ${mentionsHook ? "YES" : "NO"}`);
    console.log(
      "    NOTE: Eswap is not registered with Enso's production pathfinder, so a\n" +
        "          NO here is the expected result, not a failure of this pipeline.",
    );
  } catch (e) {
    console.log(`    Enso query failed: ${(e as Error).message}`);
  }
}

async function localForkQuote(): Promise<void> {
  console.log("\n[2] Local Base-fork Eswap quote");
  const transport = http(FORK_RPC, { timeout: 20_000, retryCount: 1 });
  const client = createPublicClient({ chain: base, transport });

  let chainId: number;
  try {
    chainId = await client.getChainId();
  } catch {
    console.log(`    fork RPC ${FORK_RPC} unreachable -> start it: anvil --fork-url https://mainnet.base.org --chain-id 8453`);
    return;
  }
  if (chainId !== CHAIN_ID) {
    console.log(`    fork RPC chainId=${chainId}, expected ${CHAIN_ID}`);
    return;
  }

  // Direct router quote (exact-input, magnitude only).
  try {
    const out = (await client.readContract({
      address: ROUTER,
      abi: ROUTER_ABI,
      functionName: "quoteExactInput",
      args: [HOOK_POOL_KEY, false /* buy WETH with USDC */, -int(AMOUNT_IN * 1n), LEVERAGE as number],
    })) as bigint;
    console.log(`    Router.quoteExactInput(200 USDC, 5x) = ${out} WETH (wei)`);
  } catch (e) {
    console.log(`    Router quote reverted/errored: ${(e as Error).message.slice(0, 200)}`);
    console.log("    (Live WETH/USDC hook pool may have no seeded standard-pool price on this fork.)");
  }

  if (QUOTER) {
    try {
      const out = (await client.readContract({
        address: QUOTER,
        abi: QUOTER_ABI,
        functionName: "quoteExactInputSingleWithLeverage",
        args: [USDC, WETH, POOL_FEE, LEVERAGE, -int(AMOUNT_IN)],
      })) as bigint;
      console.log(`    Quoter.quoteExactInputSingleWithLeverage(200 USDC, 5x) = ${out} WETH (wei)`);
    } catch (e) {
      console.log(`    Quoter quote reverted/errored: ${(e as Error).message.slice(0, 200)}`);
    }
  } else {
    console.log("    BASE_QUOTER_ADDRESS unset -> skipping quoter call (set it after SetupBaseFork).");
  }
}

function int(v: bigint): bigint {
  return v;
}

async function main() {
  console.log("=== Stage 2: Enso route pathfinder validation ===");
  console.log(`chainId=${CHAIN_ID} amountIn=${AMOUNT_IN} (200 USDC) leverage=${LEVERAGE}x`);
  console.log(`tokenIn=${USDC}`);
  console.log(`tokenOut=${WETH}`);
  await tryEnsoRoute();
  await localForkQuote();
  console.log("\nDone.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
