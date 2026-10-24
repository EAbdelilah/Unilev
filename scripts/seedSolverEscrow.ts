/**
 * Stage 5a — Solver Escrow Seeding.
 *
 * Solver (Wallet #2) approves USDC (or WETH for short tests) to the EswapRouter
 * and calls `depositBorrowEscrow(token, amount)`, then asserts the escrow grew.
 *
 * Env:
 *   SEED_AMOUNT   base units to deposit (default 250_000 = $0.25 USDC)
 *   SEED_TOKEN    "USDC" (default) or "WETH"
 *
 * Run: npx tsx scripts/seedSolverEscrow.ts
 */
import { ethers } from "ethers";
import {
  ERC20_ABI,
  ROUTER,
  ROUTER_ABI,
  USDC,
  WETH,
  getProvider,
  solverWallet,
} from "./lib/eswapBase";

const TOKEN_NAME = (process.env.SEED_TOKEN ?? "USDC").toUpperCase();
const TOKEN = TOKEN_NAME === "WETH" ? WETH : USDC;
const DECIMALS = TOKEN_NAME === "WETH" ? 18 : 6;
const SEED_AMOUNT = BigInt(process.env.SEED_AMOUNT ?? "250000");

async function main() {
  console.log("=== Stage 5a: Solver Escrow Seeding (Base 8453) ===");
  console.log(`Seed: ${ethers.formatUnits(SEED_AMOUNT, DECIMALS)} ${TOKEN_NAME} (${SEED_AMOUNT} base units)`);

  const provider = getProvider();
  const net = await provider.getNetwork();
  if (Number(net.chainId) !== 8453) throw new Error(`RPC is chain ${net.chainId}, expected 8453`);
  console.log(`RPC chainId: ${net.chainId}  block = ${await provider.getBlockNumber()}`);

  const solver = solverWallet(provider);
  console.log(`Solver wallet: ${solver.address}`);

  const token = new ethers.Contract(TOKEN, ERC20_ABI, provider);
  const routerRead = new ethers.Contract(ROUTER, ROUTER_ABI, provider);

  const bal = (await token.balanceOf(solver.address)) as bigint;
  const allow = (await token.allowance(solver.address, ROUTER)) as bigint;
  const escrowBefore = (await routerRead.erc20BorrowEscrow(solver.address, TOKEN)) as bigint;
  console.log(`\n${TOKEN_NAME} balance : ${ethers.formatUnits(bal, DECIMALS)} (need >= ${SEED_AMOUNT})`);
  console.log(`Router allowance : ${allow} (need >= ${SEED_AMOUNT})`);
  console.log(`Escrow before    : ${escrowBefore}`);

  if (bal < SEED_AMOUNT) {
    throw new Error(
      `insufficient ${TOKEN_NAME}: balance ${bal} < ${SEED_AMOUNT}. Fund ${solver.address} first.`,
    );
  }

  // Approve if needed.
  if (allow < SEED_AMOUNT) {
    console.log(`\nApproving ${SEED_AMOUNT} ${TOKEN_NAME} -> router...`);
    const approveTx = await new ethers.Contract(TOKEN, ERC20_ABI, solver).approve(ROUTER, SEED_AMOUNT);
    console.log(`  approve tx=${approveTx.hash}`);
    await approveTx.wait();
    console.log(`  approved.`);
  } else {
    console.log(`\nAllowance sufficient — skipping approve.`);
  }

  // Deposit escrow.
  console.log(`\nDepositing ${SEED_AMOUNT} ${TOKEN_NAME} into borrow escrow...`);
  const routerWrite = new ethers.Contract(ROUTER, ROUTER_ABI, solver);
  const depTx = await routerWrite.depositBorrowEscrow(TOKEN, SEED_AMOUNT);
  console.log(`  depositBorrowEscrow tx=${depTx.hash}`);
  const rcpt = await depTx.wait();
  if (rcpt?.status !== 1) throw new Error("depositBorrowEscrow tx reverted");
  console.log(`  CONFIRMED block=${rcpt.blockNumber} gas=${rcpt.gasUsed}`);

  // Assert.
  const escrowAfter = (await routerRead.erc20BorrowEscrow(solver.address, TOKEN)) as bigint;
  const ok = escrowAfter >= escrowBefore + SEED_AMOUNT;
  console.log(`\nEscrow after: ${escrowAfter}`);
  console.log(`  [${ok ? "PASS" : "FAIL"}] escrow grew by ${SEED_AMOUNT}`);
  if (!ok) throw new Error(`FAIL: escrow ${escrowAfter} did not grow by ${SEED_AMOUNT}`);

  console.log(
    `\n=== ESCROW SEEDED: ${ethers.formatUnits(escrowAfter, DECIMALS)} ${TOKEN_NAME} available for fills ===`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
