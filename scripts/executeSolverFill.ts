/**
 * Stage 4 — External (un-affiliated) Solver fill (Base 8453).
 *
 * Reads `intent.json`, connects as Wallet #2 (the solver) and submits the
 * leveraged open. The real permissionless external-solver entrypoint on this
 * deployment is `EswapRouter.swapWithIntent`: the trader's signed LendingIntent
 * REPLACES the governance whitelist, so any solver the trader signed for can
 * relay/fill, drawing the $20 borrow leg from its own escrow/balance.
 *
 *  - If SOLVER_PRIVATE_KEY is set, the tx is SENT (real funds + gas).
 *  - Otherwise it is executed as an `eth_call` FROM the solver address and the
 *    exact on-chain revert is reported (no funds required).
 *
 * Note: the brief names `EswapMarginHook.registerMarginOpen()` and
 * `EswapRouter.swapMultiPoolForSolverFunded()` as the calls to make from Wallet
 * #2. `registerMarginOpen` is hook-only (the router calls it) and would revert
 * with an access-control error from an EOA. `swapMultiPoolForSolverFunded` is
 * also supported but needs the solver whitelisted OR fully bonded; the signed
 * intent path below is the genuinely permissionless one.
 *
 * Run: npx tsx scripts/executeSolverFill.ts
 */
import path from "node:path";
import fs from "node:fs";
import dotenv from "dotenv";
import { ethers } from "ethers";

dotenv.config({ path: path.resolve(process.cwd(), ".env"), override: false });

const RPC = process.env.BASE_RPC_URL ?? "https://mainnet.base.org";
const ROUTER = ethers.getAddress(process.env.V4_ROUTER_ADDRESS ?? "0x57E75A87A62ab8Ff14C59FA10Ac2AB2c8cBD45D1");

const SWAP_WITH_INTENT_ABI = [
  "function swapWithIntent(((address,address,uint24,int24,address) key,(address,address,uint24,int24,address) standardPoolKey,bool zeroForOne,int256 amountSpecified,uint8 leverage,address solver,bytes hookData,uint256 deadline,uint256 minAmountOut) params, address trader, (bytes32 poolId,bytes32 standardPoolId,bool zeroForOne,int256 amountSpecified,uint8 leverage,address solver,uint256 deadline,uint256 minAmountOut,uint256 nonce) intent, bytes signature) returns (bytes)",
  "function registeredSolvers(address) view returns (bool)",
  "function erc20BorrowEscrow(address,address) view returns (uint256)",
];
const ERC20_ABI = ["function balanceOf(address) view returns (uint256)", "function allowance(address,address) view returns (uint256)"];

async function main() {
  console.log("=== Stage 4: external solver fill (Base 8453) ===");
  const intentPath = path.resolve(process.cwd(), "intent.json");
  if (!fs.existsSync(intentPath)) throw new Error("intent.json not found — run createIntent.ts first");
  const intentJson = JSON.parse(fs.readFileSync(intentPath, "utf8"));

  const provider = new ethers.JsonRpcProvider(RPC);
  const usdc = new ethers.Contract(intentJson.requiredAllowance.token, ERC20_ABI, provider);

  // Wallet #2 (solver). We only have a key if SOLVER_PRIVATE_KEY is present.
  const solverPk = process.env.SOLVER_PRIVATE_KEY;
  const solver = solverPk
    ? new ethers.Wallet(solverPk).address
    : ethers.getAddress(process.env.SOLVER_ADDRESS ?? intentJson.solver);

  console.log(`Solver wallet (Wallet #2) : ${solver}  ${solverPk ? "(has key)" : "(NO key -> simulation only)"}`);
  console.log(`Trader (intent signer)    : ${intentJson.trader}`);
  console.log(`Leverage / borrow         : ${intentJson.leverage}x / ${intentJson.borrowAmount} USDC`);

  const traderUsdc = await usdc.balanceOf(intentJson.trader);
  const traderAllowance = await usdc.allowance(intentJson.trader, ROUTER);
  const solverUsdc = await usdc.balanceOf(solver);
  const solverEscrow = await new ethers.Contract(ROUTER, SWAP_WITH_INTENT_ABI, provider).erc20BorrowEscrow(
    solver,
    intentJson.requiredAllowance.token,
  );
  console.log("\n--- preconditions ---");
  console.log(`  trader USDC balance     : ${traderUsdc} (need >= ${intentJson.margin} to fund margin)`);
  console.log(`  trader -> router allow. : ${traderAllowance}`);
  console.log(`  solver USDC balance     : ${solverUsdc} (need >= ${intentJson.borrowAmount} if not escrowed)`);
  console.log(`  solver borrow escrow    : ${solverEscrow}`);

  const hookData = ethers.AbiCoder.defaultAbiCoder().encode(
    ["bool", "uint8", "address"],
    [true, intentJson.leverage, intentJson.trader],
  );
  const params = {
    key: intentJson.hookPoolKey,
    standardPoolKey: intentJson.standardPoolKey,
    zeroForOne: intentJson.value.zeroForOne,
    amountSpecified: BigInt(intentJson.value.amountSpecified),
    leverage: intentJson.leverage,
    solver,
    hookData,
    deadline: BigInt(intentJson.value.deadline),
    minAmountOut: BigInt(intentJson.value.minAmountOut),
  };
  const intentArg = {
    poolId: intentJson.value.poolId,
    standardPoolId: intentJson.value.standardPoolId,
    zeroForOne: intentJson.value.zeroForOne,
    amountSpecified: BigInt(intentJson.value.amountSpecified),
    leverage: intentJson.leverage,
    solver,
    deadline: BigInt(intentJson.value.deadline),
    minAmountOut: BigInt(intentJson.value.minAmountOut),
    nonce: BigInt(intentJson.value.nonce),
  };

  const routerRead = new ethers.Contract(ROUTER, SWAP_WITH_INTENT_ABI, provider);
  const calldata = routerRead.interface.encodeFunctionData("swapWithIntent", [
    params,
    intentJson.trader,
    intentArg,
    intentJson.signature,
  ]);

  console.log(`\nBuilt call: swapWithIntent(params, trader=${intentJson.trader}, intent, sig)`);
  console.log(`  solver whitelisted? ${await routerRead.registeredSolvers(solver)}`);

  // Always simulate first so we never blind-broadcast a doomed tx.
  console.log("\n--- eth_call simulation FROM solver ---");
  let simOk = false;
  try {
    const ret = await provider.call({ from: solver, to: ROUTER, data: calldata });
    console.log(`  call returned: ${ret}`);
    simOk = true;
  } catch (e: any) {
    console.log(`  REVERT: ${formatRevert(e, routerRead.interface)}`);
  }

  if (!solverPk) {
    console.log("\n[BLOCKER] SOLVER_PRIVATE_KEY is unset — cannot sign/broadcast Wallet #2.");
    console.log("          Wallet #2 must hold >= 20 USDC + ETH for L2 gas to fill for real.");
    console.log("No transaction was broadcast.");
    return;
  }

  if (!simOk) {
    console.log("\nSimulation reverted -> NOT broadcasting (would waste gas).");
    return;
  }

  console.log("\n--- broadcasting solver fill ---");
  const wallet = new ethers.Wallet(solverPk, provider);
  const router = new ethers.Contract(ROUTER, SWAP_WITH_INTENT_ABI, wallet);
  const tx = await router.swapWithIntent(params, intentJson.trader, intentArg, intentJson.signature);
  console.log(`  tx.hash = ${tx.hash}`);
  const rcpt = await tx.wait();
  console.log(`  status  = ${rcpt?.status}  gasUsed = ${rcpt?.gasUsed}  tx.origin = ${rcpt?.from}`);
  fs.writeFileSync(path.resolve(process.cwd(), "fill.json"), JSON.stringify({ hash: tx.hash, gasUsed: rcpt?.gasUsed?.toString(), from: rcpt?.from }, null, 2));
}

function formatRevert(e: any, iface: ethers.Interface): string {
  if (e?.revert) return `${e.revert.name}(${e.revert.args?.join(", ") ?? ""})`;
  if (e?.data) {
    try {
      const parsed = iface.parseError(e.data);
      if (parsed) return `${parsed.name}(${parsed.args?.join(", ") ?? ""})  [${e.data}]`;
    } catch {}
    return `${e.shortMessage ?? e.message}  data=${e.data}`;
  }
  return e?.shortMessage ?? e?.message ?? String(e);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
