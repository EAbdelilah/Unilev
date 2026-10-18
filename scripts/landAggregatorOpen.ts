/**
 * scripts/landAggregatorOpen.ts
 *
 * Lands a LIVE Base leveraged open through the permissionless aggregator path:
 *
 *   trader -> EswapRouter.swapMultiPoolForAggregator(params, trader, route)
 *             where route.callData = a REAL Enso bundle for USDC -> WETH,
 *             route.exchangeProxy = EnsoRouter V2, route.sellAmount = notional,
 *             solver = the escrow-bonded borrow provider.
 *
 * The borrow leg is drawn from `erc20BorrowEscrow[solver][USDC]` (bonded
 * on-chain beforehand), so no protocol capital funds the position.
 *
 * Usage:
 *   npx tsx scripts/landAggregatorOpen.ts            # simulate (eth_call) only
 *   BROADCAST=1 npx tsx scripts/landAggregatorOpen.ts  # simulate + broadcast
 *
 * Reads: javascript/v4/realApis/ensoBundle.json (from quoteEnsoBase.js), .env.
 */
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import {
  createPublicClient,
  createWalletClient,
  encodeAbiParameters,
  getAddress,
  http,
  keccak256,
  parseAbi,
  type Address,
  type Hex,
} from "viem";
import { base } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

dotenv.config({ path: path.resolve(process.cwd(), ".env"), override: false });

const CHAIN_ID = 8453;
const RPC = process.env.BASE_RPC_URL ?? "https://mainnet.base.org";
const USDC: Address = getAddress("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
const WETH: Address = getAddress("0x4200000000000000000000000000000000000006");

const ROUTER: Address = getAddress(
  process.env.BASE_ROUTER_ADDRESS ?? "0x57E75A87A62ab8Ff14C59FA10Ac2AB2c8cBD45D1",
);
const HOOK: Address = getAddress(
  process.env.BASE_HOOK_ADDRESS ?? "0x6f98Ea19e522Ecc706E0Fb1574BDA8D32aC510C8",
);
const SOLVER: Address = getAddress(
  process.env.SOLVER_ADDRESS ?? "0x518634753C61342298c3E04326056b3Ce596a566",
);

const LEVERAGE = Number(process.env.LEVERAGE ?? "2");

const ROUTER_ABI = parseAbi([
  "function swapMultiPoolForAggregator(((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) key,(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) standardPoolKey,bool zeroForOne,int256 amountSpecified,uint8 leverage,address solver,bytes hookData,uint256 deadline,uint256 minAmountOut) params,address trader,(address exchangeProxy,address tokenIn,address tokenOut,uint256 sellAmount,uint256 value,bytes callData) route) returns (bytes)",
]);

function loadBundle() {
  const p = path.join(process.cwd(), "javascript/v4/realApis/ensoBundle.json");
  const j = JSON.parse(fs.readFileSync(p, "utf8"));
  if (!j.to || !j.data) throw new Error(`bad bundle at ${p}`);
  return j as {
    to: Address;
    data: Hex;
    value: string;
    amountIn: string;
    expectedBuy: string | null;
    minBuy: string | null;
    from: Address;
  };
}

type Bundle = ReturnType<typeof loadBundle>;

function normMap(m: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (Array.isArray(m)) {
    for (const p of m as [string, string][]) out[String(p[0]).toLowerCase()] = p[1];
  } else if (m && typeof m === "object") {
    for (const k of Object.keys(m as object)) out[k.toLowerCase()] = (m as Record<string, string>)[k];
  }
  return out;
}

/**
 * Fetch a FRESH Enso bundle (the embedded route deadline is ~2 minutes, so the
 * quote, simulation and broadcast must all happen in one run). Falls back to the
 * pinned ensoBundle.json when ENSO_API_KEY is unset.
 */
async function fetchBundle(from: Address, amountIn: bigint): Promise<Bundle> {
  const apiKey = (process.env.ENSO_API_KEY ?? "").trim();
  if (!apiKey) {
    console.log("[enso] ENSO_API_KEY unset -> using pinned ensoBundle.json");
    return loadBundle();
  }
  const url =
    `https://api.enso.build/api/v1/shortcuts/bundle?chainId=${CHAIN_ID}` +
    `&fromAddress=${from}&routingStrategy=router&receiver=${from}`;
  const actions = [
    {
      protocol: "enso",
      action: "route",
      args: { tokenIn: USDC, tokenOut: WETH, amountIn: amountIn.toString(), slippage: "30", receiver: from },
    },
  ];
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(actions),
  });
  const text = await res.text();
  const body = JSON.parse(text) as {
    tx?: { to?: string; data?: string; value?: string };
    amountsOut?: unknown;
    minAmountsOut?: unknown;
  };
  if (res.status !== 200 || !body.tx?.to || !body.tx?.data) {
    throw new Error(`enso bundle failed: ${res.status} ${text.slice(0, 300)}`);
  }
  const ao = normMap(body.amountsOut);
  const mo = normMap(body.minAmountsOut);
  console.log("[enso] fresh bundle fetched");
  return {
    to: getAddress(body.tx.to),
    data: (body.tx.data.startsWith("0x") ? body.tx.data : "0x" + body.tx.data) as Hex,
    value: String(body.tx.value ?? "0"),
    amountIn: amountIn.toString(),
    expectedBuy: ao[WETH.toLowerCase()] ?? null,
    minBuy: mo[WETH.toLowerCase()] ?? null,
    from,
  };
}

async function main() {
  const key = process.env.TINY_TRADER_PK;
  if (!key) throw new Error("TINY_TRADER_PK unset");
  const account = privateKeyToAccount(key as Hex);

  const bundle = await fetchBundle(getAddress(ROUTER), BigInt(process.env.NOTIONAL ?? "60000"));
  const notional = BigInt(bundle.amountIn);
  const margin = notional / BigInt(LEVERAGE);
  const borrow = notional - margin;

  const transport = http(RPC, { timeout: 30_000 });
  const pub = createPublicClient({ chain: base, transport });
  const wallet = createWalletClient({ account, chain: base, transport });

  const chainId = await pub.getChainId();
  if (chainId !== CHAIN_ID) throw new Error(`RPC chainId=${chainId}, expected ${CHAIN_ID}`);

  const block = await pub.getBlock();
  const deadline = block.timestamp + 1800n;
  const minOut = bundle.minBuy ? BigInt(bundle.minBuy) : (BigInt(bundle.expectedBuy!) * 99n) / 100n;

  const key0 = { currency0: WETH, currency1: USDC, fee: 3000, tickSpacing: 60, hooks: HOOK };
  const keyStd = { currency0: WETH, currency1: USDC, fee: 500, tickSpacing: 10, hooks: "0x0000000000000000000000000000000000000000" as Address };

  const params = {
    key: key0,
    standardPoolKey: keyStd,
    zeroForOne: false,
    amountSpecified: -margin,
    leverage: LEVERAGE,
    solver: SOLVER,
    hookData: "0x" as Hex,
    deadline,
    minAmountOut: minOut,
  };
  const route = {
    exchangeProxy: getAddress(bundle.to),
    tokenIn: USDC,
    tokenOut: WETH,
    sellAmount: notional,
    value: 0n,
    callData: bundle.data,
  };

  console.log("=== Land aggregator-routed leveraged open (Base) ===");
  console.log(`router   ${ROUTER}`);
  console.log(`hook     ${HOOK}`);
  console.log(`trader   ${account.address}`);
  console.log(`solver   ${SOLVER}`);
  console.log(`notional ${notional} (${notional / BigInt(LEVERAGE)} margin x ${LEVERAGE})`);
  console.log(`borrow   ${borrow}`);
  console.log(`minOut   ${minOut} wei WETH`);
  console.log(`proxy    ${route.exchangeProxy} (EnsoRouter V2)`);
  console.log(`callData ${bundle.data.slice(0, 20)}... (${bundle.data.length / 2 - 1} bytes)`);
  console.log(`deadline ${deadline}`);

  console.log("\n[simulate] eth_call swapMultiPoolForAggregator ...");
  try {
    const { result } = await pub.simulateContract({
      address: ROUTER,
      abi: ROUTER_ABI,
      functionName: "swapMultiPoolForAggregator",
      args: [params as never, account.address, route as never],
      account,
    });
    console.log(`[simulate] OK -> ${result}`);
  } catch (e) {
    const err = e as { shortMessage?: string; message?: string; cause?: unknown; raw?: Hex };
    console.error("[simulate] REVERT:", err.shortMessage ?? err.message);
    const cause = err.cause as { raw?: Hex } | undefined;
    const raw = err.raw ?? cause?.raw;
    if (raw) console.error("raw:", raw);
    process.exit(2);
  }

  if (process.env.BROADCAST !== "1") {
    console.log("\n[simulate-only] set BROADCAST=1 to send.");
    return;
  }

  console.log("\n[broadcast] sending ...");
  const hash = await wallet.writeContract({
    address: ROUTER,
    abi: ROUTER_ABI,
    functionName: "swapMultiPoolForAggregator",
    args: [params as never, account.address, route as never],
    account,
    chain: base,
  });
  console.log(`[broadcast] tx ${hash}`);
  const receipt = await pub.waitForTransactionReceipt({ hash, timeout: 120_000 });
  console.log(`[broadcast] status=${receipt.status} block=${receipt.blockNumber} gasUsed=${receipt.gasUsed}`);
  if (receipt.status !== "success") process.exit(3);

  const pos = await pub.readContract({
    address: HOOK,
    abi: parseAbi([
      "function positions(bytes32,address) view returns (address trader,uint256 collateralAmount,uint256 borrowedAmount,uint8 leverage,bool isLong,uint160 liquidationSqrtPrice,int24 tickLower,int24 tickUpper,uint128 liquidity)",
    ]),
    functionName: "positions",
    args: [poolId(), account.address],
  });
  console.log("[verify] position:", pos);
}

function poolId(): Hex {
  // keccak256(abi.encode(PoolKey)) == keccak256(abi.encode(currency0,currency1,fee,tickSpacing,hooks))
  return keccak256(
    encodeAbiParameters(
      [
        { type: "address" },
        { type: "address" },
        { type: "uint24" },
        { type: "int24" },
        { type: "address" },
      ],
      [WETH, USDC, 3000, 60, HOOK],
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
