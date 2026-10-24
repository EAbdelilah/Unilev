/**
 * Gas Bootstrap Helper (Base 8453).
 *
 * Both test wallets start nearly ETH-empty. If the user did not send native
 * ETH, this script bootstraps gas from whatever capital exists:
 *
 *   1. If the trader holds ETH dust (> ~2 tx worth) and the solver is empty,
 *      the trader sends half its ETH to the solver.
 *   2. The solver unwraps a slice of its WETH (`WETH9.withdraw`) and sends
 *      half the proceeds to the trader, topping both gas tanks up.
 *
 * Idempotent: re-running is safe — it only transfers when a wallet is below
 * the floor, and it never unwraps more than the configured slice.
 *
 * Env:
 *   GAS_TARGET_WEI   per-wallet target in wei (default 1e13 = 0.00001 ETH)
 *   GAS_UNWRAP_WEI   WETH slice to unwrap if the solver still needs gas
 *                    (default 2e13 = 0.00002 ETH)
 *
 * Run: npx tsx scripts/fundGas.ts
 */
import { ethers } from "ethers";
import { WETH, WETH9_ABI, getProvider, solverWallet, traderWallet } from "./lib/eswapBase";

const GAS_TARGET = BigInt(process.env.GAS_TARGET_WEI ?? "10000000000000"); // 1e13
const UNWRAP_SLICE = BigInt(process.env.GAS_UNWRAP_WEI ?? "20000000000000"); // 2e13

async function main() {
  console.log("=== Gas Bootstrap (Base 8453) ===");
  console.log(`Target per wallet : ${ethers.formatEther(GAS_TARGET)} ETH`);
  console.log(`Unwrap slice      : ${ethers.formatEther(UNWRAP_SLICE)} WETH`);

  const provider = getProvider();
  const net = await provider.getNetwork();
  if (Number(net.chainId) !== 8453) throw new Error(`RPC is chain ${net.chainId}, expected 8453`);

  const trader = traderWallet(provider);
  const solver = solverWallet(provider);
  console.log(`Trader: ${trader.address}`);
  console.log(`Solver: ${solver.address}`);

  const wethSolver = new ethers.Contract(WETH, WETH9_ABI, solver);

  for (let round = 0; round < 3; round++) {
    const traderEth = await provider.getBalance(trader.address);
    const solverEth = await provider.getBalance(solver.address);
    console.log(`\n--- round ${round + 1}: trader=${ethers.formatEther(traderEth)} ETH, solver=${ethers.formatEther(solverEth)} ETH ---`);

    if (traderEth >= GAS_TARGET && solverEth >= GAS_TARGET) {
      console.log("Both wallets at/above target — nothing to do.");
      break;
    }

    // Step 1: trader dust -> solver (only if the trader has meaningful excess).
    if (solverEth < GAS_TARGET && traderEth > GAS_TARGET + 2_000_000_000_000n) {
      const send = (traderEth - GAS_TARGET) / 2n;
      console.log(`trader -> solver: ${ethers.formatEther(send)} ETH`);
      const tx = await trader.sendTransaction({ to: solver.address, value: send });
      console.log(`  tx=${tx.hash}`);
      await tx.wait();
      await waitForBalanceUpdate(provider, solver.address, solverEth);
      continue; // re-check balances before unwrapping
    }

    // Step 2: solver unwraps a WETH slice -> tops up its own ETH -> sends half to trader.
    if (solverEth < GAS_TARGET) {
      const solverWeth = (await wethSolver.balanceOf(solver.address)) as bigint;
      const unwrap = solverWeth >= UNWRAP_SLICE ? UNWRAP_SLICE : solverWeth;
      if (unwrap === 0n) {
        console.log(`solver has no WETH to unwrap — cannot bootstrap gas.`);
        console.log(`Send ~${ethers.formatEther(GAS_TARGET)} ETH to ${solver.address} manually.`);
        break;
      }
      console.log(`solver unwrapping ${ethers.formatEther(unwrap)} WETH...`);
      const wTx = await wethSolver.withdraw(unwrap);
      console.log(`  withdraw tx=${wTx.hash}`);
      await wTx.wait();
      await waitForBalanceUpdate(provider, solver.address, solverEth);

      // Send half the freshly unwrapped ETH to the trader if the trader is short.
      const traderEthNow = await provider.getBalance(trader.address);
      if (traderEthNow < GAS_TARGET) {
        const send = unwrap / 2n;
        console.log(`solver -> trader: ${ethers.formatEther(send)} ETH`);
        const tx = await solver.sendTransaction({ to: trader.address, value: send });
        console.log(`  tx=${tx.hash}`);
        await tx.wait();
        await waitForBalanceUpdate(provider, trader.address, traderEthNow);
      }
      continue;
    }

    // Step 3: solver is fine, trader still short (unusual) — solver sends directly.
    if (traderEth < GAS_TARGET && solverEth > GAS_TARGET + 2_000_000_000_000n) {
      const send = (solverEth - GAS_TARGET) / 2n;
      console.log(`solver -> trader: ${ethers.formatEther(send)} ETH`);
      const tx = await solver.sendTransaction({ to: trader.address, value: send });
      console.log(`  tx=${tx.hash}`);
      await tx.wait();
      await waitForBalanceUpdate(provider, trader.address, traderEth);
    }
  }

  const traderFinal = await provider.getBalance(trader.address);
  const solverFinal = await provider.getBalance(solver.address);
  const solverWethFinal = (await new ethers.Contract(WETH, WETH9_ABI, provider).balanceOf(solver.address)) as bigint;
  console.log(`\n=== FINAL ===`);
  console.log(`Trader ETH : ${ethers.formatEther(traderFinal)}`);
  console.log(`Solver ETH : ${ethers.formatEther(solverFinal)}`);
  console.log(`Solver WETH: ${ethers.formatEther(solverWethFinal)} (short-test capital)`);
  const ok = traderFinal > 0n && solverFinal > 0n;
  console.log(ok ? "Gas bootstrap OK — both wallets have ETH." : "WARNING: at least one wallet still has zero ETH.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

/**
 * Public RPC nodes serve stale balances right after a confirmation from a
 * different node; poll until the balance differs from the pre-tx reading so
 * the next loop round never re-sends on stale data.
 */
async function waitForBalanceUpdate(
  provider: ethers.JsonRpcProvider,
  addr: string,
  before: bigint,
): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const now = await provider.getBalance(addr);
    if (now !== before) return;
    await new Promise((r) => setTimeout(r, 1_500));
  }
}
