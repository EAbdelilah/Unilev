/**
 * Automated protocol fee sweeper (Base mainnet).
 *
 *   node scripts/v4/live/withdrawFees.cjs --dry-run    # inspect accrued fees only
 *   node scripts/v4/live/withdrawFees.cjs              # sweep fees > 0 to treasury (owner key)
 *
 * Env (from .env):
 *   BASE_RPC_URL
 *   V4_HOOK_ADDRESS
 *   PRIVATE_KEY (owner of the hook)
 */
const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");

const CHAIN_ID = 8453;
const USDC = ethers.getAddress("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
const WETH = ethers.getAddress("0x4200000000000000000000000000000000000006");

function loadEnv() {
  const env = {};
  const file = path.resolve(process.cwd(), ".env");
  if (!fs.existsSync(file)) return env;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return env;
}

const argv = process.argv.slice(2);
const dryRun = argv.includes("--dry-run");

async function main() {
  const env = loadEnv();
  const RPC = process.env.BASE_RPC_URL || env.BASE_RPC_URL || "https://mainnet.base.org";
  const HOOK = ethers.getAddress(process.env.V4_HOOK_ADDRESS || env.V4_HOOK_ADDRESS || "0x7b3F232BB5a0346fADb8B92B31B3e7bC60bD90c8");
  const PK = process.env.PRIVATE_KEY || env.PRIVATE_KEY;

  const provider = new ethers.JsonRpcProvider(RPC, CHAIN_ID, { staticNetwork: true });
  const net = await provider.getNetwork();
  if (Number(net.chainId) !== CHAIN_ID) throw new Error(`RPC chain ${net.chainId} != ${CHAIN_ID}`);

  const hookArtifact = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "dashboard/src/abis/EswapMarginHook.json"), "utf8"));
  const hookAbi = Array.isArray(hookArtifact) ? hookArtifact : hookArtifact.abi;
  const hookRead = new ethers.Contract(HOOK, hookAbi, provider);

  const treasury = await hookRead.treasury();
  console.log("=== Eswap protocol fee sweeper (Base 8453) ===");
  console.log("hook:", HOOK);
  console.log("treasury:", treasury);
  console.log("mode:", dryRun ? "DRY RUN" : "EXECUTE");

  if (treasury === ethers.ZeroAddress) {
    console.log("Treasury not set on hook; cannot withdraw. Exiting.");
    return;
  }

  const currencies = [
    { symbol: "USDC", address: USDC, decimals: 6 },
    { symbol: "WETH", address: WETH, decimals: 18 },
  ];

  let signer;
  if (!dryRun) {
    if (!PK) throw new Error("PRIVATE_KEY required for non-dry-run (owner key)");
    signer = new ethers.Wallet(PK, provider);
    const owner = await hookRead.owner();
    if (signer.address.toLowerCase() !== String(owner).toLowerCase()) {
      console.warn(`Warning: signer ${signer.address} != hook.owner() ${owner}. Tx will likely revert.`);
    }
  }

  const hookWrite = signer ? new ethers.Contract(HOOK, hookAbi, signer) : null;

  for (const c of currencies) {
    const fees = await hookRead.protocolFees(c.address);
    console.log(`\n[${c.symbol}] protocolFees(${c.address}) = ${fees.toString()} (${ethers.formatUnits(fees, c.decimals)})`);
    if (fees === 0n) {
      console.log(`  -> nothing to sweep.`);
      continue;
    }
    if (dryRun) {
      console.log(`  -> would call withdrawProtocolFee(${c.address}, ${fees.toString()}) to treasury ${treasury}`);
      continue;
    }
    console.log(`  -> calling withdrawProtocolFee...`);
    const tx = await hookWrite.withdrawProtocolFee(c.address, fees);
    console.log(`     tx: ${tx.hash}`);
    const rc = await tx.wait();
    console.log(`     status: ${rc.status} block: ${rc.blockNumber}`);
  }
  console.log("\nDone.");
}

main().catch((e) => {
  console.error("FAILED:", e.shortMessage || e.message);
  process.exit(1);
});
