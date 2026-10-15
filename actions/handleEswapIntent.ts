/**
 * Stage 3 (fork-only): solver bot that fills an Eswap leveraged-open intent.
 *
 * Two entry points share one implementation:
 *
 *   - `handleEswapIntent` — the Tenderly Web3 Action signature. When deployed
 *     to Tenderly, `@tenderly/actions` supplies `ActionFn`/`Context`/`Event`
 *     and secrets come from `context.secrets`. We declare those types locally
 *     so this file type-checks with ZERO Tenderly dependency installed.
 *
 *   - `main()` — runs the identical logic locally under `tsx` against an anvil
 *     Base fork. This is the path used for the offline validation.
 *
 * What it actually does (the real entrypoint, not the brief's fictional
 * `executeLeveragedSwap`):
 *
 *   router.swapMultiPoolForSolverFunded(params, trader, marginFunder)
 *
 *   * margin leg   <- marginFunder (must approve the router)
 *   * borrow leg   <- router.erc20BorrowEscrow[params.solver][borrowToken]
 *                     (THIS is the solver capital the brief calls the
 *                      "$800 / $20 borrow leg")
 *   * the hook records `solverDebts[poolId][trader][solver]` as a senior claim
 *
 * SAFETY: defaults to eth_call simulation. It only sends a transaction when
 * SOLVER_BROADCAST === "true". No real funds are touched by default.
 *
 * Run:
 *   npx tsx actions/handleEswapIntent.ts
 */

import path from "node:path";
import dotenv from "dotenv";
import { AbiCoder, Contract, JsonRpcProvider, Wallet, getAddress, isAddress, type InterfaceAbi } from "ethers";

dotenv.config({ path: path.resolve(process.cwd(), ".env"), override: false });

// ---------------------------------------------------------------------------
// Minimal Tenderly types (avoids a hard dependency on @tenderly/actions).
// On Tenderly these are provided by the runtime; locally they describe main().
// ---------------------------------------------------------------------------
export interface TenderlySecretReader {
  get(key: string): string;
}
export interface TenderlyContext {
  secrets: TenderlySecretReader;
}
export interface TenderlyEvent {
  transactions?: unknown[];
}
export type ActionFn = (context: TenderlyContext, event: TenderlyEvent) => Promise<void>;

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const WETH = getAddress("0x4200000000000000000000000000000000000006");
const USDC = getAddress("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
const HOOK = envAddr("BASE_HOOK_ADDRESS", "0x7b38f16a40683457fa46ecc819103613f47c50c8");
const ROUTER = envAddr("BASE_ROUTER_ADDRESS", "0xabdd8e37082d232c331b109bc9ca3c62a992f10f");
const POOL_FEE = 3000;
const TICK_SPACING = 60;

// $5 margin at 5x => $20 borrow leg (matches Stage 4).
const MARGIN_USDC = BigInt(process.env.MARGIN_USDC ?? "5000000"); // 5 USDC (6dp)
const LEVERAGE = Number(process.env.LEVERAGE ?? "5");

const ROUTER_ABI: InterfaceAbi = [
  "function swapMultiPoolForSolverFunded(" +
    "((address,address,uint24,int24,address) key," +
    "(address,address,uint24,int24,address) standardPoolKey," +
    "bool zeroForOne,int256 amountSpecified,uint8 leverage,address solver," +
    "bytes hookData,uint256 deadline,uint256 minAmountOut) params," +
    "address trader,address marginFunder) payable returns (bytes)",
];

// WETH sorts below USDC => currency0 = WETH; zeroForOne=false buys WETH (long).
const HOOK_KEY = [WETH, USDC, POOL_FEE, TICK_SPACING, HOOK] as const;
const STANDARD_KEY = [WETH, USDC, 500, 10, "0x0000000000000000000000000000000000000000"] as const;

function envAddr(key: string, fallback: string): string {
  const v = process.env[key];
  if (!v) return getAddress(fallback);
  if (!isAddress(v)) throw new Error(`Invalid ${key}: ${v}`);
  return getAddress(v as string);
}

function buildParams(trader: string, solver: string) {
  const coder = AbiCoder.defaultAbiCoder();
  const hookData = coder.encode(["bool", "uint8", "address"], [true, LEVERAGE, trader]);
  return {
    key: HOOK_KEY,
    standardPoolKey: STANDARD_KEY,
    zeroForOne: false,
    amountSpecified: -MARGIN_USDC,
    leverage: LEVERAGE,
    solver,
    hookData,
    deadline: Math.floor(Date.now() / 1000) + 900,
    minAmountOut: 0n,
  };
}

async function execute(
  context: TenderlyContext,
  opts: { rpcUrl: string; privateKey: string; trader: string; marginFunder: string },
): Promise<void> {
  const provider = new JsonRpcProvider(opts.rpcUrl);
  const solverWallet = new Wallet(opts.privateKey, provider);
  const solver = await solverWallet.getAddress();

  // 1. Detect the pending Eswap intent (here: the configured trader/margin).
  const params = buildParams(opts.trader, solver);
  const router = new Contract(ROUTER, ROUTER_ABI, solverWallet);

  console.log(`[solver] ${solver}`);
  console.log(`[solver] router ${ROUTER}`);
  console.log(`[solver] margin ${MARGIN_USDC} (USDC raw), leverage ${LEVERAGE}x`);
  console.log(`[solver] borrow leg = ${MARGIN_USDC * BigInt(LEVERAGE - 1)} (USDC raw)`);

  // 2. Simulate first: proves the borrow leg + escrow settle without spending.
  try {
    const sim = await router.swapMultiPoolForSolverFunded.staticCall(
      params,
      opts.trader,
      opts.marginFunder,
    );
    console.log(`[solver] staticCall OK, return len=${(sim as string).length}`);
  } catch (e) {
    console.log(`[solver] staticCall reverted: ${(e as Error).message.slice(0, 300)}`);
    console.log("[solver] (fork likely missing: solver whitelist / escrow / pool liquidity)");
    return;
  }

  // 3. Only broadcast when explicitly enabled.
  if (process.env.SOLVER_BROADCAST !== "true") {
    console.log("[solver] SOLVER_BROADCAST != true -> simulation only, no tx sent.");
    return;
  }

  const tx = await router.swapMultiPoolForSolverFunded(params, opts.trader, opts.marginFunder);
  console.log(`[solver] tx ${tx.hash}`);
  const receipt = await tx.wait();
  console.log(`[solver] mined in block ${receipt?.blockNumber}, gas ${receipt?.gasUsed?.toString()}`);
}

// ---------------------------------------------------------------------------
// Tenderly Web3 Action entry point
// ---------------------------------------------------------------------------
export const handleEswapIntent: ActionFn = async (context: TenderlyContext, _event: TenderlyEvent) => {
  const rpcUrl = context.secrets.get("TENDERLY_RPC_URL");
  const privateKey = context.secrets.get("SOLVER_PRIVATE_KEY");
  const trader = context.secrets.get("ESWAP_TRADER_ADDRESS");
  const marginFunder = context.secrets.get("ESWAP_MARGIN_FUNDER_ADDRESS");
  await execute(context, { rpcUrl, privateKey, trader, marginFunder });
};

// ---------------------------------------------------------------------------
// Local runner (anvil Base fork)
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  console.log("=== Stage 3: solver intent handler (fork-only) ===");
  const rpcUrl = process.env.TENDERLY_RPC_URL ?? process.env.FORK_RPC ?? "http://127.0.0.1:8545";
  const privateKey = process.env.SOLVER_PRIVATE_KEY;
  if (!privateKey) throw new Error("SOLVER_PRIVATE_KEY not set");
  const provider = new JsonRpcProvider(rpcUrl);
  const solver = await new Wallet(privateKey).getAddress();
  const trader = process.env.ESWAP_TRADER_ADDRESS ?? solver;
  const marginFunder = process.env.ESWAP_MARGIN_FUNDER_ADDRESS ?? solver;

  await execute({ secrets: { get: (k: string) => process.env[k] ?? "" } }, {
    rpcUrl,
    privateKey,
    trader,
    marginFunder,
  });
}

// Execute main() only when run directly (`tsx actions/handleEswapIntent.ts`).
const invokedDirectly =
  typeof process !== "undefined" &&
  Array.isArray(process.argv) &&
  process.argv[1] !== undefined &&
  process.argv[1].replace(/\\/g, "/").endsWith("handleEswapIntent.ts");

if (invokedDirectly) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
