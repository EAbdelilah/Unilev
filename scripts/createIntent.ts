/**
 * Stage 3 — Build + sign the EIP-712 leveraged-open intent (Base 8453).
 *
 * Trader Wallet #1 (`TINY_TRADER_PK`) signs a `LendingIntent` authorizing ONE
 * leveraged open, pinning: the hook pool, the deep standard pool, direction,
 * margin, leverage, the solver wallet who may fill, a deadline and a slippage
 * floor. Writes `intent.json`.
 *
 * NOTE ON PERMIT2 (brief says "Permit2 intent"): EswapRouter does NOT use
 * Permit2. It pulls the margin leg with a plain ERC-20 `safeTransferFrom`, so
 * the trader must hold a standard ERC-20 allowance to the router (or the solver
 * funds the margin via swapMultiPoolForSolverFunded's marginFunder). The signed
 * order here is the router's own `LendingIntent`, which is the real authorization
 * primitive on this deployment. We record the required allowance in intent.json
 * so its absence is never a surprise.
 *
 * No transaction is signed for broadcast; only an off-chain EIP-712 signature.
 *
 * Run: npx tsx scripts/createIntent.ts
 */
import path from "node:path";
import fs from "node:fs";
import dotenv from "dotenv";
import { ethers } from "ethers";

dotenv.config({ path: path.resolve(process.cwd(), ".env"), override: false });

const RPC = process.env.BASE_RPC_URL ?? "https://mainnet.base.org";
const CHAIN_ID = 8453;
const USDC = ethers.getAddress("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
const WETH = ethers.getAddress("0x4200000000000000000000000000000000000006");
const HOOK = ethers.getAddress(process.env.V4_HOOK_ADDRESS ?? "0x6f98Ea19e522Ecc706E0Fb1574BDA8D32aC510C8");
const ROUTER = ethers.getAddress(process.env.V4_ROUTER_ADDRESS ?? "0x57E75A87A62ab8Ff14C59FA10Ac2AB2c8cBD45D1");

const MARGIN = 5_000_000n; // $5.00 USDC
const LEVERAGE = 5; // borrow = margin * (leverage-1) = $20
const BORROW = MARGIN * BigInt(LEVERAGE - 1);

const HOOK_KEY = [WETH, USDC, 3000, 60, HOOK] as const;
const STD_KEY = [WETH, USDC, 500, 10, ethers.ZeroAddress] as const;

const TYPES = {
  LendingIntent: [
    { name: "poolId", type: "bytes32" },
    { name: "standardPoolId", type: "bytes32" },
    { name: "zeroForOne", type: "bool" },
    { name: "amountSpecified", type: "int256" },
    { name: "leverage", type: "uint8" },
    { name: "solver", type: "address" },
    { name: "deadline", type: "uint256" },
    { name: "minAmountOut", type: "uint256" },
    { name: "nonce", type: "uint256" },
  ],
};

const ROUTER_ABI = [
  "function DOMAIN_SEPARATOR() view returns (bytes32)",
  "function hashIntent((bytes32 poolId,bytes32 standardPoolId,bool zeroForOne,int256 amountSpecified,uint8 leverage,address solver,uint256 deadline,uint256 minAmountOut,uint256 nonce) intent) pure returns (bytes32)",
  "function quoteExactInput((address,address,uint24,int24,address) key, bool zeroForOne, int128 amountSpecified, uint8 leverage) view returns (int128)",
];

function poolId(key: readonly [string, string, number, number, string]): string {
  return ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["address", "address", "uint24", "int24", "address"],
      [key[0], key[1], key[2], key[3], key[4]],
    ),
  );
}

async function main() {
  console.log("=== Stage 3: EIP-712 intent creation (Base 8453) ===");
  const pk = process.env.TINY_TRADER_PK;
  if (!pk) throw new Error("TINY_TRADER_PK (Wallet #1 / trader) is unset in .env");
  const trader = new ethers.Wallet(pk).address;
  const solver = ethers.getAddress(process.env.SOLVER_ADDRESS ?? trader);
  console.log(`Wallet #1 (trader/signer) : ${trader}`);
  console.log(`Solver authorized in intent: ${solver}`);

  const provider = new ethers.JsonRpcProvider(RPC);
  const router = new ethers.Contract(ROUTER, ROUTER_ABI, provider);

  // Slippage floor from the live router quote (the signed floor, 1% under).
  let minAmountOut = 0n;
  try {
    const q = (await router.quoteExactInput(HOOK_KEY, false, -MARGIN, LEVERAGE)) as bigint;
    minAmountOut = (q * 99n) / 100n;
    console.log(`Router quote($5, 5x)       : ${q} WETH -> minAmountOut 99% = ${minAmountOut}`);
  } catch (e) {
    console.log(`Router quote failed (${(e as Error).message.slice(0, 80)}); minAmountOut=0`);
  }

  const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
  const nonce = BigInt(Date.now());

  const value = {
    poolId: poolId(HOOK_KEY),
    standardPoolId: poolId(STD_KEY),
    zeroForOne: false, // USDC (currency1) in -> WETH (currency0) out => long
    amountSpecified: -MARGIN,
    leverage: LEVERAGE,
    solver,
    deadline,
    minAmountOut,
    nonce,
  };

  const domain = {
    name: "EswapRouter",
    version: "1",
    chainId: CHAIN_ID,
    verifyingContract: ROUTER,
  };

  // Cross-check our offline struct hash against the live contract's answer.
  const onchainHash = (await router.hashIntent(value)) as string;
  const offlineHash = ethers.TypedDataEncoder.hashStruct("LendingIntent", TYPES, value);
  console.log(`\nhashIntent (on-chain)      : ${onchainHash}`);
  console.log(`hashIntent (offline)       : ${offlineHash}`);
  console.log(`  -> ${onchainHash.toLowerCase() === offlineHash.toLowerCase() ? "MATCH" : "MISMATCH"}`);

  const onchainDomain = (await router.DOMAIN_SEPARATOR()) as string;
  const offlineDomain = ethers.TypedDataEncoder.hashDomain(domain);
  console.log(`DOMAIN_SEPARATOR (on-chain): ${onchainDomain}`);
  console.log(`DOMAIN_SEPARATOR (offline) : ${offlineDomain}`);
  console.log(`  -> ${onchainDomain.toLowerCase() === offlineDomain.toLowerCase() ? "MATCH" : "MISMATCH"}`);

  const digest = ethers.TypedDataEncoder.hash(domain, TYPES, value);
  const wallet = new ethers.Wallet(pk);
  const signature = await wallet.signTypedData(domain, TYPES, value);
  const recovered = ethers.verifyTypedData(domain, TYPES, value, signature);
  console.log(`\ndigest                     : ${digest}`);
  console.log(`signature                  : ${signature}`);
  console.log(`recovered signer           : ${recovered} ${recovered === trader ? "(== trader OK)" : "(MISMATCH!)"}`);

  const payload = {
    _comment:
      "Signed Eswap LendingIntent (the real EIP-712 authorization on this deployment). Permit2 is NOT used by EswapRouter; margin is pulled via ERC-20 safeTransferFrom.",
    chainId: CHAIN_ID,
    router: ROUTER,
    hook: HOOK,
    domain,
    types: TYPES,
    value: { ...value, amountSpecified: value.amountSpecified.toString(), deadline: value.deadline.toString(), minAmountOut: value.minAmountOut.toString(), nonce: value.nonce.toString() },
    trader,
    solver,
    signature,
    digest,
    margin: MARGIN.toString(),
    leverage: LEVERAGE,
    borrowAmount: BORROW.toString(), // 20_000_000 = $20 external solver leg
    hookPoolKey: HOOK_KEY,
    standardPoolKey: STD_KEY,
    requiredAllowance: { token: USDC, owner: trader, spender: ROUTER, amount: MARGIN.toString() },
    createdAt: new Date().toISOString(),
  };

  const outPath = path.resolve(process.cwd(), "intent.json");
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));
  console.log(`\nSaved signed intent -> ${outPath}`);
  console.log(`Borrow requirement  : ${BORROW} base units ($20.00 USDC) funded by solver ${solver}`);
  console.log("No transaction was signed for broadcast.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
