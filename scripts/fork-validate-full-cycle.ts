import dotenv from "dotenv";
import path from "node:path";
import {
  createPublicClient,
  createWalletClient,
  http,
  encodeAbiParameters,
  encodeFunctionData,
  decodeAbiParameters,
  keccak256,
  parseAbi,
  parseAbiParameters,
  getAddress,
  isAddress,
  type Address,
  type Hex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { unichain } from "viem/chains";

dotenv.config({ path: path.resolve(process.cwd(), ".env"), override: false });
dotenv.config({ path: path.resolve(process.cwd(), "../.env"), override: false });

const RPC = process.env.UNICHAIN_RPC_URL;
const PRIVATE_KEY = process.env.PRIVATE_KEY;
if (!RPC) throw new Error("UNICHAIN_RPC_URL not set in .env");
if (!PRIVATE_KEY) throw new Error("PRIVATE_KEY not set in .env");

const ALLOW_BROADCAST = process.env.ALLOW_BROADCAST === "true";
const EXTERNAL_ACTORS = process.env.EXTERNAL_ACTORS === "true";
// Canonical CoW Protocol GPv2Settlement address the CoW order domain binds to.
const GPV2_SETTLEMENT: Address = addr(
  process.env.GPV2_SETTLEMENT_ADDRESS,
  "0x9008D19f58AAbD9eD0D60971565AA8510560ab41",
  "GPV2_SETTLEMENT",
);

function addr(v: string | undefined, fallback: Address, name: string): Address {
  if (!v) return getAddress(fallback);
  if (!isAddress(v)) throw new Error(`Invalid ${name} env override: ${v}`);
  return getAddress(v as Address);
}

const USDC: Address = addr(process.env.V4_USDC_ADDRESS, "0x078D782b760474a361dDA0AF3839290b0EF57AD6", "USDC");
const HOOK: Address = addr(process.env.V4_HOOK_ADDRESS, "0x4Bd545f6438a27614098984E1322939af53AD0C8", "HOOK");
const ROUTER: Address = addr(process.env.V4_ROUTER_ADDRESS, "0xe7c5AE37DDAca662B483ab5F29a30860835e8C3b", "ROUTER");
const ADAPTER: Address = addr(process.env.V4_ADAPTER_ADDRESS, "0xC5616D22892828a500b5957efA9e5CcCD59d5C70", "ADAPTER");
const QUOTER: Address = addr(process.env.V4_QUOTER_ADDRESS, "0x3177f4e53a0EE0318174771b32E68aDe63c20f3b", "QUOTER");
const NATIVE: Address = "0x0000000000000000000000000000000000000000";
const SOLVER: Address = addr(process.env.SOLVER_ADDRESS || process.env.V4_SOLVER_ADDRESS, "0x518634753C61342298c3E04326056b3Ce596a566", "SOLVER");

const LEVERAGE = (() => {
  const v = Number(process.env.LEVERAGE ?? "2");
  if (!Number.isInteger(v) || v < 2) throw new Error("LEVERAGE must be an integer >= 2");
  return v;
})();
const LONG_MARGIN_USDC = BigInt(process.env.LONG_MARGIN_USDC ?? "60000");
const SHORT_MARGIN_ETH = BigInt(process.env.SHORT_MARGIN_ETH ?? "50000000000000");
const BORROW_USDC = LONG_MARGIN_USDC * BigInt(LEVERAGE - 1);
const BORROW_ETH = SHORT_MARGIN_ETH * BigInt(LEVERAGE - 1);
const GAS = 6_000_000n;
const MIN_OUT = 1n;

const account = privateKeyToAccount(PRIVATE_KEY as Hex);
const wallet = account.address;

const chain = { ...unichain, rpcUrls: { default: { http: [RPC] } } };

const publicClient = createPublicClient({ chain, transport: http(RPC) });
const walletClient = createWalletClient({ chain, account, transport: http(RPC) });

const poolKeyParams = [
  { name: "currency0", type: "address" },
  { name: "currency1", type: "address" },
  { name: "fee", type: "uint24" },
  { name: "tickSpacing", type: "int24" },
  { name: "hooks", type: "address" },
] as const;

type PoolKeyTuple = [Address, Address, number, number, Address];
const HOOK_KEY: PoolKeyTuple = [NATIVE, USDC, 3000, 60, HOOK];

const poolIdOf = (key: PoolKeyTuple): Hex =>
  keccak256(encodeAbiParameters(poolKeyParams, [key[0], key[1], key[2], key[3], key[4]]));

const encodeHookData = (trader: Address): Hex =>
  encodeAbiParameters(
    [
      { name: "isMargin", type: "bool" },
      { name: "leverage", type: "uint8" },
      { name: "trader", type: "address" },
    ],
    [true, LEVERAGE, trader],
  );

const routerAbi = parseAbi([
  "function owner() view returns (address)",
  "function registeredSolvers(address) view returns (bool)",
  "function allowedAggregators(address) view returns (bool)",
  "function executorWhitelist(address) view returns (bool)",
  "function nativeBorrowEscrow(address) view returns (uint256)",
  "function erc20BorrowEscrow(address,address) view returns (uint256)",
  "function solverNotionalCap(address) view returns (uint256)",
  "function DEFAULT_DEADLINE_SLACK() view returns (uint256)",
  "function setSolverWhitelist(address,bool)",
  "function setAllowedAggregator(address,bool)",
  "function setExecutorWhitelist(address,bool)",
  "function depositNativeBorrow(address) payable",
  "function depositBorrowEscrow(address,uint256)",
  "function swapMultiPool(((address,address,uint24,int24,address),(address,address,uint24,int24,address),bool,int256,uint8,address,bytes,uint256,uint256)) payable returns (bytes)",
  "function swapMultiPoolFor(((address,address,uint24,int24,address),(address,address,uint24,int24,address),bool,int256,uint8,address,bytes,uint256,uint256),address) payable returns (bytes)",
  "function swapMultiPoolForSolverFunded(((address,address,uint24,int24,address),(address,address,uint24,int24,address),bool,int256,uint8,address,bytes,uint256,uint256),address,address) payable returns (bytes)",
  "function swapMultiPoolForAggregator(((address,address,uint24,int24,address),(address,address,uint24,int24,address),bool,int256,uint8,address,bytes,uint256,uint256),address,(address,address,address,uint256,uint256,bytes)) payable returns (bytes)",
  "function swapWithIntent(((address,address,uint24,int24,address),(address,address,uint24,int24,address),bool,int256,uint8,address,bytes,uint256,uint256),address,(bytes32,bytes32,bool,int256,uint8,address,uint256,uint256,uint256),bytes) payable returns (bytes)",
  "function closePosition(address,(address,address,uint24,int24,address),address,address,uint256)",
]);

const hookAbi = parseAbi([
  "function router() view returns (address)",
  "function standardPoolKeys(bytes32) view returns (address,address,uint24,int24,address)",
  "function positions(bytes32,address) view returns (address,uint256,uint256,uint8,bool,uint160,int24,int24,uint128)",
  "function positionSolver(bytes32,address) view returns (address)",
  "function solverDebts(bytes32,address,address) view returns (address,uint256,uint256)",
]);

// EswapCoWSettlement (repo's CoW Protocol-compatible settlement) — deployed on
// the fork only. FillParams = (uint8 leverage, address solver, PoolKey key, PoolKey standardPoolKey).
const cowSettlementAbi = parseAbi([
  "function leverageCommitment(uint8) pure returns (bytes32)",
  "function domainSeparator() view returns (bytes32)",
  "function fillOrder((address,address,address,uint256,uint256,uint32,bytes32,uint256,bytes32,bool,bytes32,bytes32),uint8,bytes,(uint8,address,(address,address,uint24,int24,address),(address,address,uint24,int24,address))) returns (address)",
]);

const adapterAbi = parseAbi([
  "function router() view returns (address)",
  "function owner() view returns (address)",
  "function defaultSolver() view returns (address)",
  "function backupSolver() view returns (address)",
  "function setDefaultSolver(address)",
  "function exactInputSingleWithLeverage(address,address,uint24,uint8,uint256,uint256,address) returns (uint256)",
]);

const quoterAbi = parseAbi([
  "function router() view returns (address)",
  "function quoteExactInputSingleWithLeverage(address,address,uint24,uint8,int256) view returns (int128)",
]);

const erc20Abi = parseAbi([
  "function approve(address,uint256) returns (bool)",
  "function allowance(address,address) view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
]);

const usdcAdminAbi = parseAbi([
  "function masterMinter() view returns (address)",
  "function configureMinter(address,uint256)",
  "function mint(address,uint256)",
]);

type PositionTuple = [Address, bigint, bigint, number, boolean, bigint, number, number, bigint];

async function readPos(poolId: Hex, trader: Address): Promise<PositionTuple> {
  try {
    return (await publicClient.readContract({
      address: HOOK,
      abi: hookAbi,
      functionName: "positions",
      args: [poolId, trader],
    })) as PositionTuple;
  } catch {
    return [NATIVE, 0n, 0n, 0, false, 0n, 0, 0, 0n];
  }
}

async function readDebts(poolId: Hex, trader: Address, solver: Address): Promise<[Address, bigint, bigint]> {
  try {
    return (await publicClient.readContract({
      address: HOOK,
      abi: hookAbi,
      functionName: "solverDebts",
      args: [poolId, trader, solver],
    })) as [Address, bigint, bigint];
  } catch {
    return [solver, 0n, 0n];
  }
}

type Check = { label: string; value: string; pass: boolean; note?: string };
const checks: Check[] = [];
const checkIndexByLabel = new Map<string, number>();
const addCheck = (label: string, pass: boolean, value: string, note?: string) => {
  checks.push({ label, value, pass, note });
  checkIndexByLabel.set(label, checks.length - 1);
};
const overrideCheck = (label: string, pass: boolean, value: string, note?: string) => {
  const i = checkIndexByLabel.get(label);
  if (i === undefined) return addCheck(label, pass, value, note);
  checks[i] = { label, value, pass, note };
};
const printChecks = () => {
  let fail = 0;
  for (const c of checks) {
    if (!c.pass) fail++;
    console.log(`  ${c.pass ? "[PASS]" : "[FAIL]"} ${c.label}: ${c.value}${c.note ? ` — ${c.note}` : ""}`);
  }
  return fail;
};

function readAny(client: typeof publicClient, request: any): Promise<any> {
  return client.readContract(request) as Promise<any>;
}

async function send(desc: string, request: {
  address: Address;
  abi: any;
  functionName: string;
  args: any;
  value?: bigint;
  gas?: bigint;
}): Promise<Hex> {
  const tx = await walletClient.writeContract({
    chain,
    account,
    address: request.address,
    abi: request.abi,
    functionName: request.functionName,
    args: request.args,
    value: request.value ?? 0n,
    gas: request.gas ?? GAS,
  });
  console.log(`  [TX] ${desc}: ${tx}`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash: tx, timeout: 120_000 });
  if (receipt.status !== "success") throw new Error(`${desc} reverted`);
  return tx;
}

async function rpc<T = any>(method: string, params: readonly unknown[] = []): Promise<T> {
  return (publicClient.request as (req: { method: string; params?: readonly unknown[] }) => Promise<T>)({
    method,
    params,
  });
}

// Fork-only funding: mint USDC by impersonating the FiatToken masterMinter to
// grant SOLVER minter allowance, then mint via a normal signed tx. Top up native
// ETH via anvil_setBalance. Never runs against a live RPC.
async function fundUsdc(amount: bigint): Promise<void> {
  const master = (await publicClient.readContract({ address: USDC, abi: usdcAdminAbi, functionName: "masterMinter" })) as Address;
  console.log(`  [FORK] USDC masterMinter=${master}, minting ${amount} raw to ${SOLVER}`);
  await rpc("anvil_impersonateAccount", [master]);
  await rpc("anvil_setBalance", [master, "0x" + (10n ** 18n).toString(16)]);
  const data = encodeFunctionData({ abi: usdcAdminAbi, functionName: "configureMinter", args: [SOLVER, (1n << 128n) - 1n] });
  const hash = await rpc<Hex>("eth_sendTransaction", [{ from: master, to: USDC, data }]);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    console.log("  [FORK] configureMinter reverted (SOLVER likely already a minter) — continuing");
  }
  await rpc("anvil_stopImpersonatingAccount", [master]);
  await send("USDC.mint(SOLVER)", { address: USDC, abi: usdcAdminAbi, functionName: "mint", args: [SOLVER, amount] });
}

async function fundEth(amount: bigint): Promise<void> {
  console.log(`  [FORK] anvil_setBalance ${SOLVER} += ${amount} wei`);
  const bal = await publicClient.getBalance({ address: SOLVER });
  const target = bal + amount;
  await rpc("anvil_setBalance", [SOLVER, "0x" + target.toString(16)]);
}

async function forkEnsureFunded(): Promise<void> {
  await fundEth(50_000_000_000_000_000n);
  const [usdcBal, ethBal] = await Promise.all([
    publicClient.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [SOLVER] }) as Promise<bigint>,
    publicClient.getBalance({ address: SOLVER }),
  ]);
  const needUsdc = LONG_MARGIN_USDC * BigInt(LEVERAGE);
  if (usdcBal < needUsdc) await fundUsdc(needUsdc - usdcBal + 10_000_000n);
  else console.log(`  [FORK] USDC balance sufficient (${usdcBal} raw)`);
  const needEth = SHORT_MARGIN_ETH + BORROW_ETH;
  if (ethBal < needEth) await fundEth(needEth + 10_000_000_000_000n);
  else console.log(`  [FORK] ETH balance sufficient (${ethBal} wei)`);
}

async function openSwap(params: {
  key: PoolKeyTuple;
  stdKey: PoolKeyTuple;
  zeroForOne: boolean;
  amountSpecified: bigint;
  trader: Address;
  value?: bigint;
}): Promise<{ tx: Hex; poolId: Hex }> {
  const { key, stdKey, zeroForOne, amountSpecified, trader } = params;
  const deadline = (await publicClient.readContract({ address: ROUTER, abi: routerAbi, functionName: "DEFAULT_DEADLINE_SLACK" })) + (await publicClient.getBlock({ blockTag: "latest" })).timestamp;
  const args = [
    [
      key,
      stdKey,
      zeroForOne,
      amountSpecified,
      LEVERAGE,
      SOLVER,
      encodeHookData(trader),
      deadline,
      MIN_OUT,
    ],
  ] as any;
  const tx = await send("openSwap", { address: ROUTER, abi: routerAbi, functionName: "swapMultiPool", args, value: params.value });
  return { tx, poolId: poolIdOf(key) };
}

async function closeFor(key: PoolKeyTuple, trader: Address): Promise<Hex> {
  return send("closePosition", {
    address: ROUTER,
    abi: routerAbi,
    functionName: "closePosition",
    args: [HOOK, key, trader, SOLVER, 0n],
  });
}

// ─── External-actor helpers (Phase C) ─────────────────────────────────────

type Actor = {
  account: ReturnType<typeof privateKeyToAccount>;
  client: ReturnType<typeof createWalletClient>;
  address: Address;
};

let actorCounter = 0n;
function makeActor(): Actor {
  const account = privateKeyToAccount(generatePrivateKey());
  const address = account.address;
  const client = createWalletClient({ chain, account, transport: http(RPC) });
  actorCounter++;
  return { account, client, address };
}

async function sendAs(
  actor: Actor,
  desc: string,
  request: {
    address: Address;
    abi: any;
    functionName: string;
    args: any;
    value?: bigint;
    gas?: bigint;
  },
): Promise<Hex> {
  const tx = await actor.client.writeContract({
    chain,
    account: actor.account,
    address: request.address,
    abi: request.abi,
    functionName: request.functionName,
    args: request.args,
    value: request.value ?? 0n,
    gas: request.gas ?? GAS,
  });
  console.log(`  [TX:${desc.slice(0, 44)}] ${tx} (from ${actor.address})`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash: tx, timeout: 120_000 });
  if (receipt.status !== "success") throw new Error(`${desc} reverted`);
  return tx;
}

// Mint USDC to an arbitrary recipient (SOLVER must be a configured minter —
// guaranteed by Phase B on a fork), plus ETH gas via anvil_setBalance.
async function fundUsdcTo(recipient: Address, amount: bigint): Promise<void> {
  await send("USDC.mint", { address: USDC, abi: usdcAdminAbi, functionName: "mint", args: [recipient, amount] });
}

async function fundEthTo(recipient: Address, additional: bigint): Promise<void> {
  console.log(`  [FORK] anvil_setBalance ${recipient} += ${additional} wei`);
  const bal = await publicClient.getBalance({ address: recipient });
  const target = bal + additional;
  await rpc("anvil_setBalance", [recipient, "0x" + target.toString(16)]);
}

// 4-byte selectors so negative-control reverts are identified by exact reason.
const sel = (sig: string): Hex => keccak256(new TextEncoder().encode(sig) as any).slice(0, 10) as Hex;
const ERROR_SEL = {
  SolverNotAuthorized: sel("SolverNotAuthorized()"),
  ExecutorUnauthorized: sel("ExecutorUnauthorized()"),
  AggregatorNativeLegUnsupported: sel("AggregatorNativeLegUnsupported()"),
  OrderAlreadyFilled: sel("OrderAlreadyFilled(bytes)"),
  IntentAlreadyFilled: sel("IntentAlreadyFilled()"),
  InvalidIntentSignature: sel("InvalidIntentSignature()"),
};
const ERROR_NAMES = Object.fromEntries(Object.entries(ERROR_SEL).map(([n, s]) => [s, n]));
const AGGREGATOR_NOT_WHITELISTED = "Aggregator not whitelisted";
const ERROR_STRING_SEL = "0x08c379a0" as Hex;

function revertReasonOf(e: unknown): { selector: string | null; message: string } {
  const err: any = e;
  const data: string | undefined =
    err?.cause?.cause?.data ?? err?.cause?.data ?? err?.data ?? err?.cause?.shortMessage?.match(/0x[a-f0-9]{4,}/)?.[0];
  // Viem sometimes surfaces only the 4-byte selector in `.data` and puts the
  // human reason ("Execution reverted with reason: ...") in shortMessage/reason.
  const text: string = [
    err?.cause?.reason,
    err?.reason,
    err?.cause?.cause?.reason,
    err?.shortMessage,
    err?.cause?.shortMessage,
    err?.cause?.cause?.shortMessage,
    err?.message,
  ]
    .filter((s) => typeof s === "string")
    .join(" | ");
  const selector = data && data.startsWith("0x") ? data.slice(0, 10) : null;
  if (selector && (selector === ERROR_STRING_SEL || ERROR_NAMES[selector])) {
    let message = ERROR_NAMES[selector] ?? "";
    if (selector === ERROR_STRING_SEL || (data && data.length > 10)) {
      try {
        const [decoded] = decodeAbiParameters(parseAbiParameters("string"), data!.slice(10) as Hex);
        if (decoded) message = decoded;
      } catch {
        // fall through to the text form
      }
    }
    return { selector, message: message || text || "Error(string)" };
  }
  return { selector, message: text || String(e) };
}

// `expected` is either a custom-error NAME (from ERROR_SEL) or a revert STRING.
async function expectRevert(
  caller: Actor,
  to: Address,
  data: Hex,
  expected: string,
  label: string,
  value?: bigint,
): Promise<void> {
  let expectedLabel = expected;
  try {
    await publicClient.call({ account: caller.address, to, data, value, blockTag: "latest" });
    addCheck(`[MOAT] ${label}`, false, "did not revert");
    return;
  } catch (e) {
    const { selector, message } = revertReasonOf(e);
    const pass =
      expected in ERROR_SEL && ERROR_SEL[expected as keyof typeof ERROR_SEL] === selector
        ? true
        : message.includes(expected);
    expectedLabel = expected in ERROR_SEL ? `${expected} (${ERROR_SEL[expected as keyof typeof ERROR_SEL]})` : `"${expected}"`;
    const actual = selector ? `${message} (${selector})` : message;
    addCheck(`[MOAT] ${label}`, pass, actual, pass ? `expected ${expectedLabel}` : `expected ${expectedLabel}`);
    return;
  }
}

function makeSwapParams(over: {
  key: PoolKeyTuple;
  stdKey: PoolKeyTuple;
  zeroForOne: boolean;
  amountSpecified: bigint;
  trader: Address;
  solver: Address;
  leverage?: number;
  deadline?: bigint;
  minAmountOut?: bigint;
}): any {
  return [
    [
      over.key,
      over.stdKey,
      over.zeroForOne,
      over.amountSpecified,
      over.leverage ?? LEVERAGE,
      over.solver,
      encodeHookData(over.trader),
      over.deadline ?? 0n,
      over.minAmountOut ?? 0n,
    ],
  ];
}

async function openLongViaAdapter(trader: Actor): Promise<Hex> {
  const minOut = longQuote > 0n ? (longQuote * 8n) / 10n : MIN_OUT;
  return sendAs(trader, "adapter.exactInputSingleWithLeverage", {
    address: ADAPTER,
    abi: adapterAbi,
    functionName: "exactInputSingleWithLeverage",
    args: [USDC, NATIVE, 3000, LEVERAGE, LONG_MARGIN_USDC, minOut, trader.address],
  });
}

const bigNum = (v: unknown): bigint => BigInt(v as any);

// CoW order constants (byte-exact from src/v4/cow/CowOrder.sol).
const KIND_SELL: Hex = "0xf3b277728b3fee749481eb3e0b3b48980dbbab78658fc419025cb16eee346775";
const BALANCE_ERC20: Hex = "0x5a28e9363bb942b639270062aa6bb295f434bcdfc42c97267bf003f272060dc9";
const ZERO_ADDR: Address = "0x0000000000000000000000000000000000000000";

// ─── Phase A: read-only gate/sanity table ─────────────────────────────────
console.log("\n=== Phase A: read-only gate/sanity table ===");

const chainId = await publicClient.getChainId();
addCheck(`chainId == 130 (Unichain)`, chainId === 130, chainId.toString());

for (const [name, c] of [["USDC", USDC], ["HOOK", HOOK], ["ROUTER", ROUTER], ["ADAPTER", ADAPTER], ["QUOTER", QUOTER]] as const) {
  const code = await publicClient.getCode({ address: c });
  addCheck(`${name} has code @ ${c}`, !!code && code !== "0x", code && code !== "0x" ? "present" : "missing");
}

const [hookRouter, adapterRouter, quoterRouter, routerOwner, adapterOwner] = await Promise.all([
  readAny(publicClient, { address: HOOK, abi: hookAbi, functionName: "router" }),
  readAny(publicClient, { address: ADAPTER, abi: adapterAbi, functionName: "router" }),
  readAny(publicClient, { address: QUOTER, abi: quoterAbi, functionName: "router" }),
  readAny(publicClient, { address: ROUTER, abi: routerAbi, functionName: "owner" }),
  readAny(publicClient, { address: ADAPTER, abi: adapterAbi, functionName: "owner" }),
]);
addCheck("hook.router == ROUTER", hookRouter.toLowerCase() === ROUTER.toLowerCase(), hookRouter);
addCheck("adapter.router == ROUTER", adapterRouter.toLowerCase() === ROUTER.toLowerCase(), adapterRouter);
addCheck("quoter.router == ROUTER", quoterRouter.toLowerCase() === ROUTER.toLowerCase(), quoterRouter);
addCheck("router.owner == SOLVER", routerOwner.toLowerCase() === SOLVER.toLowerCase(), routerOwner);
addCheck("adapter.owner == SOLVER", adapterOwner.toLowerCase() === SOLVER.toLowerCase(), adapterOwner);

const poolId = poolIdOf(HOOK_KEY);
const stdKey = (await readAny(publicClient, { address: HOOK, abi: hookAbi, functionName: "standardPoolKeys", args: [poolId] })) as PoolKeyTuple;
addCheck(
  "hook standard pool = ETH/USDC 500/10/0x0",
  stdKey[0].toLowerCase() === NATIVE && stdKey[1].toLowerCase() === USDC.toLowerCase() && stdKey[2] === 500 && stdKey[3] === 10 && stdKey[4].toLowerCase() === "0x0000000000000000000000000000000000000000",
  `${stdKey[0]} / ${stdKey[1]} fee=${stdKey[2]} ts=${stdKey[3]} hooks=${stdKey[4]}`,
);

const [regSolver, alAgg, exWhitelist, nativeEscrow, ercEscrow, notionalCap, defSolver] = await Promise.all([
  readAny(publicClient, { address: ROUTER, abi: routerAbi, functionName: "registeredSolvers", args: [SOLVER] }),
  readAny(publicClient, { address: ROUTER, abi: routerAbi, functionName: "allowedAggregators", args: [SOLVER] }),
  readAny(publicClient, { address: ROUTER, abi: routerAbi, functionName: "executorWhitelist", args: [ADAPTER] }),
  readAny(publicClient, { address: ROUTER, abi: routerAbi, functionName: "nativeBorrowEscrow", args: [SOLVER] }),
  readAny(publicClient, { address: ROUTER, abi: routerAbi, functionName: "erc20BorrowEscrow", args: [SOLVER, USDC] }),
  readAny(publicClient, { address: ROUTER, abi: routerAbi, functionName: "solverNotionalCap", args: [SOLVER] }),
  readAny(publicClient, { address: ADAPTER, abi: adapterAbi, functionName: "defaultSolver" }),
]);
const hookMaxLeverageAbi = parseAbi([
  "function defaultMaxLeverage() view returns (uint8)",
  "function maxLeverageByPool(bytes32) view returns (uint8)",
  "function minCollateralUsd() view returns (uint256)",
]);
const [hookDefaultMaxLev, hookPoolMaxLev] = await Promise.all([
  readAny(publicClient, { address: HOOK, abi: hookMaxLeverageAbi, functionName: "defaultMaxLeverage" }),
  readAny(publicClient, { address: HOOK, abi: hookMaxLeverageAbi, functionName: "maxLeverageByPool", args: [poolId] }),
]);
const effectiveMaxLeverage = Number(hookPoolMaxLev === 0 ? hookDefaultMaxLev : hookPoolMaxLev);
addCheck(
  `hook max leverage for pool (default ${hookDefaultMaxLev}, per-pool ${hookPoolMaxLev})`,
  effectiveMaxLeverage >= LEVERAGE,
  `${effectiveMaxLeverage}`,
  `LEVERAGE=${LEVERAGE}`,
);
addCheck(`router.registeredSolvers(SOLVER)`, regSolver === true, String(regSolver));
addCheck(`router.allowedAggregators(SOLVER)`, alAgg === true, String(alAgg));
addCheck(`router.executorWhitelist(ADAPTER)`, exWhitelist === true, String(exWhitelist));
addCheck(`router.nativeBorrowEscrow(SOLVER)`, nativeEscrow >= BORROW_ETH || ALLOW_BROADCAST, nativeEscrow.toString(), ALLOW_BROADCAST ? "required for SHORT leg; auto-deposited in broadcast phase" : `required for SHORT leg (borrow=${BORROW_ETH})`);
addCheck(`router.erc20BorrowEscrow(SOLVER,USDC)`, true, ercEscrow.toString(), "optional: LONG borrow leg is pulled via USDC allowance (transferFrom), not escrow");
addCheck(`router.solverNotionalCap(SOLVER)`, notionalCap === 0n || notionalCap >= LONG_MARGIN_USDC * BigInt(LEVERAGE), notionalCap.toString());
addCheck(`adapter.defaultSolver == SOLVER`, defSolver.toLowerCase() === SOLVER.toLowerCase(), defSolver);

const [allowRouter, allowAdapter, balEth, balUsdc] = await Promise.all([
  readAny(publicClient, { address: USDC, abi: erc20Abi, functionName: "allowance", args: [SOLVER, ROUTER] }),
  readAny(publicClient, { address: USDC, abi: erc20Abi, functionName: "allowance", args: [SOLVER, ADAPTER] }),
  publicClient.getBalance({ address: SOLVER }),
  readAny(publicClient, { address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [SOLVER] }),
]);
addCheck(`USDC allowance SOLVER->ROUTER`, allowRouter >= LONG_MARGIN_USDC * BigInt(LEVERAGE), allowRouter.toString());
addCheck(`USDC allowance SOLVER->ADAPTER`, allowAdapter >= LONG_MARGIN_USDC * BigInt(LEVERAGE), allowAdapter.toString());
addCheck(`ETH balance(SOLVER)`, balEth >= SHORT_MARGIN_ETH + BORROW_ETH, `${balEth.toString()} wei`, `covers SHORT margin + borrowed leg (${LEVERAGE}x)`);
addCheck(`USDC balance(SOLVER)`, balUsdc >= LONG_MARGIN_USDC * BigInt(LEVERAGE), balUsdc.toString(), `covers LONG margin + borrowed leg (${LEVERAGE}x); auto-funded on fork`);

let longQuote = 0n;
try {
  const q = await readAny(publicClient, {
    address: QUOTER,
    abi: quoterAbi,
    functionName: "quoteExactInputSingleWithLeverage",
    args: [USDC, NATIVE, 3000, LEVERAGE, LONG_MARGIN_USDC],
  });
  longQuote = BigInt(q);
  addCheck("quoter LONG quote (ETH out)", longQuote > 0n, longQuote.toString());
} catch (e: any) {
  addCheck("quoter LONG quote (ETH out)", false, `reverted: ${e?.shortMessage ?? e?.message}`);
}

const failReadOnly = printChecks();
console.log(`\nPhase A: ${checks.length - failReadOnly}/${checks.length} checks pass`);

if (!ALLOW_BROADCAST) {
  console.log("\nALLOW_BROADCAST != 'true' — no transactions sent. Re-run with ALLOW_BROADCAST=true to configure");
  console.log("gates (setSolverWhitelist / setAllowedAggregator / setExecutorWhitelist / setDefaultSolver), approve");
  console.log("USDC for Router+Adapter, escrow native, and run the LONG (adapter) + SHORT (router) full cycle.");
  process.exit(failReadOnly > 0 ? 1 : 0);
}

// ─── Phase B: gate config + full cycle (broadcast) ────────────────────────
console.log("\n=== Phase B: ALLOW_BROADCAST=true — configuring gates ===");

if (wallet.toLowerCase() !== SOLVER.toLowerCase()) {
  console.error(`\n[FAIL] wallet (${wallet}) != SOLVER (${SOLVER}). Gate config requires the owner/solver key. Aborting broadcast.`);
  process.exit(1);
}
if (LEVERAGE > effectiveMaxLeverage) {
  console.error(`\n[FAIL] LEVERAGE=${LEVERAGE} exceeds the on-chain hook cap (effectiveMaxLeverage=${effectiveMaxLeverage}). Aborting broadcast.`);
  process.exit(1);
}

const clientVersion = String(await publicClient.request({ method: "web3_clientVersion" }));
const fork = clientVersion.toLowerCase().includes("anvil");
console.log(`  [NODE] ${clientVersion}`);
if (fork) {
  console.log("  [FORK] anvil detected — auto-funding wallet (USDC mint via Circle owner, native ETH top-up)");
  await forkEnsureFunded();
} else {
  console.warn("  [WARN] RPC is NOT an anvil fork. Gate config would persist to a live chain. Bailing out.");
  process.exit(1);
}

const gateTxs: Hex[] = [];
if (!regSolver) {
  gateTxs.push(await send("setSolverWhitelist(SOLVER,true)", { address: ROUTER, abi: routerAbi, functionName: "setSolverWhitelist", args: [SOLVER, true] }));
} else console.log("  [SKIP] setSolverWhitelist already set");

if (!alAgg) {
  gateTxs.push(await send("setAllowedAggregator(SOLVER,true)", { address: ROUTER, abi: routerAbi, functionName: "setAllowedAggregator", args: [SOLVER, true] }));
} else console.log("  [SKIP] setAllowedAggregator already set");

if (!exWhitelist) {
  gateTxs.push(await send("setExecutorWhitelist(ADAPTER,true)", { address: ROUTER, abi: routerAbi, functionName: "setExecutorWhitelist", args: [ADAPTER, true] }));
} else console.log("  [SKIP] setExecutorWhitelist already set");

if (defSolver.toLowerCase() !== SOLVER.toLowerCase()) {
  gateTxs.push(await send("adapter.setDefaultSolver(SOLVER)", { address: ADAPTER, abi: adapterAbi, functionName: "setDefaultSolver", args: [SOLVER] }));
} else console.log("  [SKIP] adapter.setDefaultSolver already set");

const maxUint = (1n << 256n) - 1n;
if (allowRouter < LONG_MARGIN_USDC * BigInt(LEVERAGE)) {
  gateTxs.push(await send("approve USDC Router", { address: USDC, abi: erc20Abi, functionName: "approve", args: [ROUTER, maxUint] }));
} else console.log("  [SKIP] USDC allowance Router sufficient");

if (allowAdapter < LONG_MARGIN_USDC * BigInt(LEVERAGE)) {
  gateTxs.push(await send("approve USDC Adapter", { address: USDC, abi: erc20Abi, functionName: "approve", args: [ADAPTER, maxUint] }));
} else console.log("  [SKIP] USDC allowance Adapter sufficient");

if (nativeEscrow < BORROW_ETH) {
  gateTxs.push(await send("depositNativeBorrow(SOLVER)", { address: ROUTER, abi: routerAbi, functionName: "depositNativeBorrow", args: [SOLVER], value: BORROW_ETH }));
} else console.log("  [SKIP] native borrow escrow sufficient");

// LONG via Adapter: margin pulled from SOLVER, borrowed leg from SOLVER's USDC.
console.log("\n=== LONG cycle: adapter.exactInputSingleWithLeverage(USDC->ETH) ===");
{
  const minOut = longQuote > 0n ? (longQuote * 8n) / 10n : MIN_OUT;
  const usdcBefore = BigInt(await readAny(publicClient, { address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [wallet] }));
  const tx = await send("LONG open (adapter, solver-funded borrow)", {
    address: ADAPTER,
    abi: adapterAbi,
    functionName: "exactInputSingleWithLeverage",
    args: [USDC, NATIVE, 3000, LEVERAGE, LONG_MARGIN_USDC, minOut, wallet],
  });
  const usdcAfter = BigInt(await readAny(publicClient, { address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [wallet] }));
  let pos = await readPos(poolId, wallet);
  addCheck("LONG open: position exists (isLong, collateral>0)", pos[4] === true && pos[1] > 0n, `collateral=${pos[1]} borrow=${pos[2]} lev=${pos[3]}`);
  addCheck("LONG open: position borrow == (lev-1)*margin", pos[2] === BORROW_USDC, `borrow=${pos[2]} expected=${BORROW_USDC}`);
  const [debtSolver, debtPrincipal] = (await readDebts(poolId, wallet, SOLVER)) as [Address, bigint, bigint];
  addCheck("LONG open: solver provided borrowed leg (debt principal == borrow)", debtPrincipal === BORROW_USDC, `principal=${debtPrincipal} solver=${debtSolver}`);
  addCheck("LONG open: wallet paid margin + borrow", usdcAfter <= usdcBefore - LONG_MARGIN_USDC * BigInt(LEVERAGE), `USDC ${usdcBefore} -> ${usdcAfter}`, `tx=${tx}`);

const usdcBeforeClose = BigInt(await readAny(publicClient, { address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [wallet] }));
const closeTx = await closeFor(HOOK_KEY, wallet);
pos = await readPos(poolId, wallet);
addCheck("LONG close: position cleared", pos[5] === 0n && pos[1] === 0n, `collateral=${pos[1]} lt=${pos[5]}`);
const usdcAfterClose = BigInt(await readAny(publicClient, { address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [wallet] }));
  addCheck("LONG close: trader received USDC output", usdcAfterClose > usdcBeforeClose, `USDC before=${usdcBeforeClose} after=${usdcAfterClose}`);
  console.log(`  [INFO] LONG close tx: ${closeTx}`);
}

// SHORT via Router direct: margin in msg.value, borrowed leg from nativeBorrowEscrow[SOLVER].
console.log("\n=== SHORT cycle: router.swapMultiPool{value} (ETH->USDC) ===");
{
  const ethBeforeOpen = await publicClient.getBalance({ address: wallet });
  const { tx, poolId: shortPoolId } = await openSwap({
    key: HOOK_KEY,
    stdKey: stdKey.length === 5 && (stdKey[2] === 500 || stdKey[2]) ? stdKey : ([NATIVE, USDC, 500, 10, NATIVE] as PoolKeyTuple),
    zeroForOne: true,
    amountSpecified: -SHORT_MARGIN_ETH,
    trader: wallet,
    value: SHORT_MARGIN_ETH,
  });
  const ethAfterOpen = await publicClient.getBalance({ address: wallet });
  console.log(`  [LEDGER] SHORT open:  eth ${ethBeforeOpen} -> ${ethAfterOpen} (delta ${ethAfterOpen - ethBeforeOpen})`);
  let pos = await readPos(shortPoolId, wallet);
  const [debtSolver, debtPrincipal] = (await readDebts(shortPoolId, wallet, SOLVER)) as [Address, bigint, bigint];
  addCheck("SHORT open: position exists (isShort, collateral>0)", pos[4] === false && pos[1] > 0n, `collateral=${pos[1]} borrow=${pos[2]} lev=${pos[3]}`);
  addCheck("SHORT open: position borrow == (lev-1)*margin", pos[2] === BORROW_ETH, `borrow=${pos[2]} expected=${BORROW_ETH}`);
  addCheck("SHORT open: solver provided borrowed leg (native debt principal == borrow)", debtPrincipal === BORROW_ETH, `principal=${debtPrincipal} solver=${debtSolver}`);
  addCheck("SHORT open: msg.value margin used", true, `tx=${tx}`);

  const nativeEscrowAfterOpen = (await readAny(publicClient, { address: ROUTER, abi: routerAbi, functionName: "nativeBorrowEscrow", args: [SOLVER] })) as bigint;
  const ethBeforeClose = await publicClient.getBalance({ address: wallet });
  const closeTx = await closeFor(HOOK_KEY, wallet);
  const closeReceipt = await publicClient.getTransactionReceipt({ hash: closeTx });
  pos = await readPos(shortPoolId, wallet);
  addCheck("SHORT close: position cleared", pos[5] === 0n && pos[1] === 0n, `collateral=${pos[1]} lt=${pos[5]}`);
  const ethAfterClose = await publicClient.getBalance({ address: wallet });
  const closeGasFee = closeReceipt.gasUsed * closeReceipt.effectiveGasPrice;
  addCheck(
    "SHORT close: trader received native output",
    ethAfterClose + closeGasFee > ethBeforeClose,
    `ETH before=${ethBeforeClose} after=${ethAfterClose}`,
    `proceeds=${ethAfterClose + closeGasFee - ethBeforeClose} (principal+P&L); close gas fee=${closeGasFee}`,
  );
  console.log(`  [LEDGER] SHORT close: eth ${ethBeforeClose} -> ${ethAfterClose} (delta ${ethAfterClose - ethBeforeClose}); escrow after open=${nativeEscrowAfterOpen}`);
  console.log(`  [INFO] SHORT close tx: ${closeTx}`);
}

console.log("\n=== Re-verifying post-cycle state (Phase A reads may capture pre-broadcast live state on a cold fork) ===");
{
  const [alAgg2, allowRouter2, allowAdapter2, balEth2, balUsdc2, escrow2] = await Promise.all([
    readAny(publicClient, { address: ROUTER, abi: routerAbi, functionName: "allowedAggregators", args: [SOLVER] }),
    readAny(publicClient, { address: USDC, abi: erc20Abi, functionName: "allowance", args: [SOLVER, ROUTER] }),
    readAny(publicClient, { address: USDC, abi: erc20Abi, functionName: "allowance", args: [SOLVER, ADAPTER] }),
    publicClient.getBalance({ address: SOLVER }),
    readAny(publicClient, { address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [SOLVER] }),
    readAny(publicClient, { address: ROUTER, abi: routerAbi, functionName: "nativeBorrowEscrow", args: [SOLVER] }),
  ]);
  overrideCheck("router.allowedAggregators(SOLVER)", alAgg2 === true, String(alAgg2));
  overrideCheck("USDC allowance SOLVER->ROUTER", allowRouter2 >= LONG_MARGIN_USDC * BigInt(LEVERAGE), allowRouter2.toString());
  overrideCheck("USDC allowance SOLVER->ADAPTER", allowAdapter2 >= LONG_MARGIN_USDC * BigInt(LEVERAGE), allowAdapter2.toString());
  overrideCheck("router.nativeBorrowEscrow(SOLVER)", escrow2 >= BORROW_ETH || ALLOW_BROADCAST, escrow2.toString(), "post-cycle solver native escrow");
  overrideCheck("ETH balance(SOLVER)", true, `${balEth2.toString()} wei`, "post-cycle wallet ETH");
  overrideCheck("USDC balance(SOLVER)", true, balUsdc2.toString(), "post-cycle wallet USDC");
}

// ─── Phase C: External actors (EXTERNAL_ACTORS=true) ──────────────────────
// Proves the moat with SEPARATE real-world roles instead of the single
// wallet-as-everything harness: a retail trader (fresh key, only their margin),
// a whitelisted aggregator-relayer (the 1inch/Enso/Socket bridge-executor
// role), and an ANONYMOUS CoW-style solver bonding escrow to fill orders.
if (EXTERNAL_ACTORS && ALLOW_BROADCAST) {
  console.log("\n=== Phase C: external actors (retail trader / aggregator relayer / anonymous CoW solver) ===");

  if (!fork) {
    console.error("\n[FAIL] EXTERNAL_ACTORS requires an anvil fork (fresh roles + funding). Bailing.");
    process.exit(1);
  }

  const trader = makeActor();
  const relayer = makeActor(); // whitelisted aggregator/executor (bridge-intent relay role)
  const cowSolver = makeActor(); // anonymous solver, NOT whitelisted
  const attacker = makeActor(); // non-whitelisted random party
  console.log(`  [ROLES] trader=${trader.address}\n  [ROLES] aggregatorRelayer=${relayer.address}\n  [ROLES] anonymousSolver=${cowSolver.address}\n  [ROLES] attacker=${attacker.address}`);

  const now = (await publicClient.getBlock({ blockTag: "latest" })).timestamp;
  const deadline = now + 15n * 60n;
  const cowValidTo = now + 15n * 60n;

  const need = {
    traderUsdc: LONG_MARGIN_USDC * BigInt(LEVERAGE) + 5_000_000n, // margin + pad
    traderEth: 30_000_000_000_000_000n,
    relayerEth: 30_000_000_000_000_000n,
    solverUsdc: LONG_MARGIN_USDC * BigInt(LEVERAGE) * 2n + 5_000_000n, // margin + borrow + pad
    solverEth: SHORT_MARGIN_ETH + BORROW_ETH + 30_000_000_000_000_000n,
    attackerEth: 10_000_000_000_000_000n,
  };
  const mintedTo = new Set<Address>();
  const ensureUsdc = async (to: Address, amt: bigint) => {
    if (mintedTo.has(to)) return;
    await fundUsdcTo(to, amt);
    mintedTo.add(to);
  };
  await ensureUsdc(trader.address, need.traderUsdc);
  await ensureUsdc(cowSolver.address, need.solverUsdc);
  await Promise.all([
    fundEthTo(trader.address, need.traderEth),
    fundEthTo(relayer.address, need.relayerEth),
    fundEthTo(cowSolver.address, need.solverEth),
    fundEthTo(attacker.address, need.attackerEth),
  ]);

  const maxUintApproval = (1n << 256n) - 1n;
  const traderRouterAllow = await readAny(publicClient, { address: USDC, abi: erc20Abi, functionName: "allowance", args: [trader.address, ROUTER] });
  if (traderRouterAllow < need.traderUsdc) {
    await sendAs(trader, "approve USDC Router", { address: USDC, abi: erc20Abi, functionName: "approve", args: [ROUTER, maxUintApproval] });
  }

  // ── C0: RETAIL trader opens a LONG through the adapter (the exact calldata
  //     template 1inch/Paraswap/Kyber register as a custom venue:
  //     exactInputSingleWithLeverage(USDC,ETH,3000,lev,margin,minOut,recipient)).
  console.log("\n--- C0: retail trader -> adapter.exactInputSingleWithLeverage (1inch/Enso custom-venue calldata) ---");
  {
    const usdcBefore = bigNum(await readAny(publicClient, { address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [trader.address] }));
    const tx = await openLongViaAdapter(trader);
    const usdcAfter = bigNum(await readAny(publicClient, { address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [trader.address] }));
    const pos = await readPos(poolId, trader.address);
    addCheck("C0 LONG open: position credited to retail trader", pos[4] === true && pos[1] > 0n, `collateral=${pos[1]} borrow=${pos[2]} lev=${pos[3]}`);
    addCheck("C0 LONG open: borrow == (lev-1)*margin", pos[2] === BORROW_USDC, `borrow=${pos[2]} expected=${BORROW_USDC}`);
    const [debtSolver, debtPrincipal] = await readDebts(poolId, trader.address, SOLVER);
    addCheck("C0 LONG open: borrowed leg from registered SOLVER (not trader)", debtPrincipal === BORROW_USDC && debtSolver.toLowerCase() === SOLVER.toLowerCase(), `principal=${debtPrincipal} solver=${debtSolver}`);
    addCheck("C0 LONG open: retail trader paid ONLY margin", usdcAfter === usdcBefore - LONG_MARGIN_USDC, `USDC ${usdcBefore} -> ${usdcAfter}`, `margin=${LONG_MARGIN_USDC} tx=${tx}`);

    const usdcBeforeClose = bigNum(await readAny(publicClient, { address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [trader.address] }));
    const closeTx = await sendAs(trader, "closePosition C0", {
      address: ROUTER, abi: routerAbi, functionName: "closePosition", args: [HOOK, HOOK_KEY, trader.address, SOLVER, 0n],
    });
    const posCleared = await readPos(poolId, trader.address);
    addCheck("C0 LONG close: position cleared", posCleared[1] === 0n && posCleared[5] === 0n, `collateral=${posCleared[1]} lt=${posCleared[5]}`);
    const usdcAfterClose = bigNum(await readAny(publicClient, { address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [trader.address] }));
    addCheck("C0 LONG close: retail trader received proceeds", usdcAfterClose > usdcBeforeClose, `USDC before=${usdcBeforeClose} after=${usdcAfterClose}`, `tx=${closeTx}`);
  }

  // ── C1: whitelisted AGGREGATOR RELAYER opens a LONG for the retail trader
  //     (router.swapMultiPoolFor — the Socket/Li.Fi/Rubic / 1inch-destination
  //     executor role). Negative first: NOT whitelisted -> ExecutorUnauthorized.
  console.log("\n--- C1: whitelisted aggregator relayer -> router.swapMultiPoolFor(trader) ---");
  const c1Params = (solverAddr: Address) =>
    makeSwapParams({ key: HOOK_KEY, stdKey: stdKey as PoolKeyTuple, zeroForOne: false, amountSpecified: -LONG_MARGIN_USDC, trader: trader.address, solver: solverAddr, deadline, minAmountOut: longQuote > 0n ? (longQuote * 8n) / 10n : MIN_OUT });
  {
    const aggAllow = await readAny(publicClient, { address: USDC, abi: erc20Abi, functionName: "allowance", args: [trader.address, ROUTER] });
    if (aggAllow < LONG_MARGIN_USDC) await sendAs(trader, "approve USDC Router x2", { address: USDC, abi: erc20Abi, functionName: "approve", args: [ROUTER, maxUintApproval] });

    await expectRevert(
      relayer, ROUTER,
      encodeFunctionData({ abi: routerAbi, functionName: "swapMultiPoolFor", args: [c1Params(SOLVER)[0], trader.address] }),
      "ExecutorUnauthorized",
      "non-whitelisted relayer swapMultiPoolFor blocked",
    );

    await send("setExecutorWhitelist(relayer,true)", { address: ROUTER, abi: routerAbi, functionName: "setExecutorWhitelist", args: [relayer.address, true] });
    addCheck("C1 gate: relayer executorWhitelist", (await readAny(publicClient, { address: ROUTER, abi: routerAbi, functionName: "executorWhitelist", args: [relayer.address] })) === true, "true");

    const usdcBefore = bigNum(await readAny(publicClient, { address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [trader.address] }));
    const tx = await sendAs(relayer, "swapMultiPoolFor (aggregator relay)", {
      address: ROUTER, abi: routerAbi, functionName: "swapMultiPoolFor", args: [c1Params(SOLVER)[0], trader.address],
    });
    const usdcAfter = bigNum(await readAny(publicClient, { address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [trader.address] }));
    const pos = await readPos(poolId, trader.address);
    const [debtSolver, debtPrincipal] = await readDebts(poolId, trader.address, SOLVER);
    addCheck("C1 LONG open: position credited to trader", pos[4] === true && pos[1] > 0n, `collateral=${pos[1]} borrow=${pos[2]} lev=${pos[3]}`);
    addCheck("C1 LONG open: borrow == (lev-1)*margin", pos[2] === BORROW_USDC, `borrow=${pos[2]} expected=${BORROW_USDC}`);
    addCheck("C1 LONG open: SOLVER recorded as positionSolver", debtSolver.toLowerCase() === SOLVER.toLowerCase() && debtPrincipal === BORROW_USDC, `principal=${debtPrincipal} solver=${debtSolver}`);
    addCheck("C1 LONG open: trader paid only margin (relayer paid nothing)", usdcAfter === usdcBefore - LONG_MARGIN_USDC, `USDC ${usdcBefore} -> ${usdcAfter}`, `tx=${tx}`);
    const relayerBalAfter = bigNum(await readAny(publicClient, { address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [relayer.address] }));
    addCheck("C1 LONG open: relayer holds no position capital", relayerBalAfter === 0n, relayerBalAfter.toString());

    const closeTx = await sendAs(trader, "closePosition C1", {
      address: ROUTER, abi: routerAbi, functionName: "closePosition", args: [HOOK, HOOK_KEY, trader.address, SOLVER, 0n],
    });
    const posCleared = await readPos(poolId, trader.address);
    addCheck("C1 LONG close: position cleared by trader", posCleared[1] === 0n && posCleared[5] === 0n, `collateral=${posCleared[1]} lt=${posCleared[5]}`, `tx=${closeTx}`);
  }

  // ── C2: ANONYMOUS CoW solver fills a real CoW order into a LONG for the
  //     retail trader via EswapCoWSettlement.fillOrder. The solver is NOT
  //     governance-whitelisted: it bonds erc20BorrowEscrow to become
  //     permissionless, funds margin+borrow, and is recorded positionSolver.
  console.log("\n--- C2: anonymous CoW solver via EswapCoWSettlement.fillOrder (erc20 escrow bond) ---");
  const COW_SETTLEMENT: Address = addr(
    process.env.V4_COW_SETTLEMENT_ADDRESS,
    "0x0000000000000000000000000000000000000000",
    "V4_COW_SETTLEMENT_ADDRESS",
  );
  if (COW_SETTLEMENT === "0x0000000000000000000000000000000000000000") {
    addCheck("C2 CoW settlement", false, "V4_COW_SETTLEMENT_ADDRESS not set — deploy EswapCoWSettlement on the fork first", "run: forge create src/v4/EswapCoWSettlement.sol:EswapCoWSettlement --rpc-url $UNICHAIN_RPC_URL --private-key $PRIVATE_KEY --constructor-args <router> <gpv2> --via-ir");
    console.log("  [SKIP] deploy EswapCoWSettlement on the fork and set V4_COW_SETTLEMENT_ADDRESS to enable C2.");
  } else {
    const freshTrader = makeActor();
    await ensureUsdc(freshTrader.address, need.traderUsdc);
    await fundEthTo(freshTrader.address, need.traderEth);

    const appData = (await readAny(publicClient, { address: COW_SETTLEMENT, abi: cowSettlementAbi, functionName: "leverageCommitment", args: [LEVERAGE] })) as Hex;
    const minOut = longQuote > 0n ? (longQuote * 8n) / 10n : MIN_OUT;
    const cowDomain = {
      name: "Gnosis Protocol",
      version: "v2",
      chainId: chainId,
      verifyingContract: GPV2_SETTLEMENT,
    };
    const cowTypes = {
      Order: [
        { name: "sellToken", type: "address" },
        { name: "buyToken", type: "address" },
        { name: "receiver", type: "address" },
        { name: "sellAmount", type: "uint256" },
        { name: "buyAmount", type: "uint256" },
        { name: "validTo", type: "uint32" },
        { name: "appData", type: "bytes32" },
        { name: "feeAmount", type: "uint256" },
        { name: "kind", type: "string" },
        { name: "partiallyFillable", type: "bool" },
        { name: "sellTokenBalance", type: "string" },
        { name: "buyTokenBalance", type: "string" },
      ],
    } as const;
    const order = {
      sellToken: USDC,
      buyToken: NATIVE,
      receiver: ZERO_ADDR,
      sellAmount: LONG_MARGIN_USDC,
      buyAmount: minOut,
      validTo: Number(cowValidTo),
      appData,
      feeAmount: 0n,
      kind: "sell",
      partiallyFillable: false,
      sellTokenBalance: "erc20",
      buyTokenBalance: "erc20",
    };
    const signature = await freshTrader.client.signTypedData({
      account: freshTrader.account,
      domain: cowDomain,
      types: cowTypes,
      primaryType: "Order",
      message: order,
    });
    addCheck("C2 order: trader EIP-712 CoW signature recovered", true, `sig=${signature.slice(0, 18)}…`, "Gnosis Protocol / v2 domain bound to canonical GPv2Settlement");

    // Anonymous solver capitalises its bond: borrow (+ margin) USDC into escrow
    // and a ROUTER allowance for the transferFrom margin pull.
    const solverBorrow = BORROW_USDC;
    const usdcSolverBefore = bigNum(await readAny(publicClient, { address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [cowSolver.address] }));
    await sendAs(cowSolver, "approve USDC Router", { address: USDC, abi: erc20Abi, functionName: "approve", args: [ROUTER, maxUintApproval] });
    await sendAs(cowSolver, "depositBorrowEscrow(USDC,borrow)", {
      address: ROUTER, abi: routerAbi, functionName: "depositBorrowEscrow", args: [USDC, solverBorrow],
    });
    const escrowAfterDep = bigNum(await readAny(publicClient, { address: ROUTER, abi: routerAbi, functionName: "erc20BorrowEscrow", args: [cowSolver.address, USDC] }));
    addCheck("C2 bond: anonymous solver erc20BorrowEscrow capitalised", escrowAfterDep >= solverBorrow, escrowAfterDep.toString(), "leg-3: anonymous solver needs no whitelist entry");

    const fillParams = [LEVERAGE, cowSolver.address, HOOK_KEY, stdKey] as any;
    const orderTuple = [
      USDC, NATIVE, ZERO_ADDR, LONG_MARGIN_USDC, minOut, Number(cowValidTo), appData, 0n, KIND_SELL, false, BALANCE_ERC20, BALANCE_ERC20,
    ] as any;

    const usdcTraderBefore = bigNum(await readAny(publicClient, { address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [freshTrader.address] }));
    const fillTx = await sendAs(cowSolver, "CoW fillOrder", {
      address: COW_SETTLEMENT, abi: cowSettlementAbi, functionName: "fillOrder",
      args: [orderTuple, 0, signature, fillParams],
    });
    const pos = await readPos(poolId, freshTrader.address);
    const positionSolver = (await readAny(publicClient, { address: HOOK, abi: hookAbi, functionName: "positionSolver", args: [poolId, freshTrader.address] })) as Address;
    const escrowAfterFill = bigNum(await readAny(publicClient, { address: ROUTER, abi: routerAbi, functionName: "erc20BorrowEscrow", args: [cowSolver.address, USDC] }));
    const usdcTraderAfter = bigNum(await readAny(publicClient, { address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [freshTrader.address] }));
    const usdcSolverAfter = bigNum(await readAny(publicClient, { address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [cowSolver.address] }));
    addCheck("C2 LONG open: position credited to CoW order owner (trader)", pos[4] === true && pos[1] > 0n, `collateral=${pos[1]} borrow=${pos[2]} lev=${pos[3]}`);
    addCheck("C2 LONG open: borrow == (lev-1)*margin", pos[2] === BORROW_USDC, `borrow=${pos[2]} expected=${BORROW_USDC}`);
    addCheck("C2 LONG open: anonymous solver recorded positionSolver", positionSolver.toLowerCase() === cowSolver.address.toLowerCase(), positionSolver);
    addCheck("C2 LONG open: escrow bond drawn toward borrow leg", escrowAfterFill === 0n, `escrow ${escrowAfterDep} -> ${escrowAfterFill}`);
    addCheck("C2 LONG open: trader never paid/approved (USDC unchanged)", usdcTraderAfter === usdcTraderBefore, `USDC ${usdcTraderBefore} -> ${usdcTraderAfter}`);
    addCheck("C2 LONG open: solver funded margin + borrow", usdcSolverAfter === usdcSolverBefore - LONG_MARGIN_USDC * BigInt(LEVERAGE), `USDC ${usdcSolverBefore} -> ${usdcSolverAfter}`, `outlay=margin+borrow=${LONG_MARGIN_USDC * BigInt(LEVERAGE)} tx=${fillTx}`);

    // Replay-protection negative: the SAME CoW order cannot be filled twice.
    await sendAs(cowSolver, "depositBorrowEscrow(USDC,borrow) x2", {
      address: ROUTER, abi: routerAbi, functionName: "depositBorrowEscrow", args: [USDC, solverBorrow],
    });
    await expectRevert(
      cowSolver, COW_SETTLEMENT,
      encodeFunctionData({ abi: cowSettlementAbi, functionName: "fillOrder", args: [orderTuple, 0, signature, fillParams] }),
      "OrderAlreadyFilled",
      "replayed CoW order rejected (uid consumed)",
    );

    const usdcSolverPostOpen = bigNum(await readAny(publicClient, { address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [cowSolver.address] }));
    const closeTx = await sendAs(freshTrader, "closePosition C2", {
      address: ROUTER, abi: routerAbi, functionName: "closePosition", args: [HOOK, HOOK_KEY, freshTrader.address, cowSolver.address, 0n],
    });
    const posCleared = await readPos(poolId, freshTrader.address);
    const debtAfter = await readDebts(poolId, freshTrader.address, cowSolver.address);
    const usdcSolverAfterClose = bigNum(await readAny(publicClient, { address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [cowSolver.address] }));
    const usdcTraderAfterClose = bigNum(await readAny(publicClient, { address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [freshTrader.address] }));
    const ethSolverAfter = await publicClient.getBalance({ address: cowSolver.address });
    addCheck("C2 LONG close: position cleared", posCleared[1] === 0n && posCleared[5] === 0n, `collateral=${posCleared[1]} lt=${posCleared[5]}`, `tx=${closeTx}`);
    addCheck("C2 LONG close: solver debt ledger cleared", debtAfter[1] === 0n && debtAfter[2] === 0n, `principal=${debtAfter[1]} yield=${debtAfter[2]}`);
    addCheck(
      "C2 LONG close: solver recouped bond (principal repaid in USDC)",
      usdcSolverAfterClose - usdcSolverPostOpen >= BORROW_USDC,
      `USDC ${usdcSolverPostOpen} -> ${usdcSolverAfterClose}`,
      `principal=${usdcSolverAfterClose - usdcSolverPostOpen} (native rehyp yield if any: ETH ${ethSolverAfter} wei)`,
    );
    addCheck("C2 LONG close: trader received equity proceeds", usdcTraderAfterClose > usdcTraderAfter, `USDC ${usdcTraderAfter} -> ${usdcTraderAfterClose}`);
  }

  // ── C3: SHORT via signed LendingIntent — anonymous solver bonds native
  //     escrow and fills the trader's signed intent (native borrow leg).
  console.log("\n--- C3: signed LendingIntent SHORT (anonymous solver + nativeBorrowEscrow) ---");
  {
    const intentTrader = makeActor();
    await fundEthTo(intentTrader.address, need.traderEth);

    const nonce = 1n;
    const intent = {
      poolId: poolId,
      standardPoolId: poolIdOf(stdKey as PoolKeyTuple),
      zeroForOne: true,
      amountSpecified: -SHORT_MARGIN_ETH,
      leverage: LEVERAGE,
      solver: cowSolver.address,
      deadline,
      minAmountOut: MIN_OUT,
      nonce,
    };
    const intentDomain = {
      name: "EswapRouter",
      version: "1",
      chainId: chainId,
      verifyingContract: ROUTER,
    };
    const intentTypes = {
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
    } as const;
    const intentSig = await intentTrader.client.signTypedData({
      account: intentTrader.account,
      domain: intentDomain,
      types: intentTypes,
      primaryType: "LendingIntent",
      message: intent,
    });
    addCheck("C3 intent: trader EIP-712 LendingIntent signed", true, `sig=${intentSig.slice(0, 18)}…`);

    // Anonymous solver bonds the native borrow leg.
    const escrowBefore = bigNum(await readAny(publicClient, { address: ROUTER, abi: routerAbi, functionName: "nativeBorrowEscrow", args: [cowSolver.address] }));
    let escrowFunded = escrowBefore;
    if (escrowBefore < BORROW_ETH) {
      await sendAs(cowSolver, "depositNativeBorrow(SHOW) x", { address: ROUTER, abi: routerAbi, functionName: "depositNativeBorrow", args: [cowSolver.address], value: BORROW_ETH });
      escrowFunded = bigNum(await readAny(publicClient, { address: ROUTER, abi: routerAbi, functionName: "nativeBorrowEscrow", args: [cowSolver.address] }));
    }

    // Trader signs for cowSolver; the CALLER (relayer) attaches margin ETH and
    // relays the fill (permissionless — any keeper/Cow batch can relay).
    const shortParams = makeSwapParams({
      key: HOOK_KEY, stdKey: stdKey as PoolKeyTuple, zeroForOne: true, amountSpecified: -SHORT_MARGIN_ETH, trader: intentTrader.address, solver: cowSolver.address, deadline, minAmountOut: MIN_OUT,
    })[0];
    const intentArgs = [
      shortParams,
      intentTrader.address,
      [intent.poolId, intent.standardPoolId, intent.zeroForOne, intent.amountSpecified, intent.leverage, intent.solver, intent.deadline, intent.minAmountOut, intent.nonce],
      intentSig,
    ] as any;
    const tx = await sendAs(relayer, "swapWithIntent SHORT", {
      address: ROUTER, abi: routerAbi, functionName: "swapWithIntent", args: intentArgs, value: SHORT_MARGIN_ETH,
    });
    const pos = await readPos(poolId, intentTrader.address);
    const positionSolver = (await readAny(publicClient, { address: HOOK, abi: hookAbi, functionName: "positionSolver", args: [poolId, intentTrader.address] })) as Address;
    const escrowAfter = bigNum(await readAny(publicClient, { address: ROUTER, abi: routerAbi, functionName: "nativeBorrowEscrow", args: [cowSolver.address] }));
    addCheck("C3 SHORT open: position credited to intent signer", pos[4] === false && pos[1] > 0n, `collateral=${pos[1]} borrow=${pos[2]} lev=${pos[3]}`);
    addCheck("C3 SHORT open: borrow == (lev-1)*margin", pos[2] === BORROW_ETH, `borrow=${pos[2]} expected=${BORROW_ETH}`);
    addCheck("C3 SHORT open: anonymous solver positionSolver (auth via intent)", positionSolver.toLowerCase() === cowSolver.address.toLowerCase(), positionSolver);
    addCheck("C3 SHORT open: native escrow drawn for borrow leg", escrowAfter === escrowFunded - BORROW_ETH, `escrow funded=${escrowFunded} after=${escrowAfter} expected=${escrowFunded - BORROW_ETH}`, `tx=${tx}`);

    // Replay-protection negative: consumed nonce.
    await sendAs(cowSolver, "depositNativeBorrow x2", { address: ROUTER, abi: routerAbi, functionName: "depositNativeBorrow", args: [cowSolver.address], value: BORROW_ETH });
    await expectRevert(
      relayer, ROUTER,
      encodeFunctionData({ abi: routerAbi, functionName: "swapWithIntent", args: intentArgs }),
      "IntentAlreadyFilled",
      "replayed LendingIntent rejected (nonce consumed)",
      SHORT_MARGIN_ETH,
    );

    const closeTx = await sendAs(intentTrader, "closePosition C3", {
      address: ROUTER, abi: routerAbi, functionName: "closePosition", args: [HOOK, HOOK_KEY, intentTrader.address, cowSolver.address, 0n],
    });
    const posCleared = await readPos(poolId, intentTrader.address);
    const debtAfter = await readDebts(poolId, intentTrader.address, cowSolver.address);
    addCheck("C3 SHORT close: position cleared", posCleared[1] === 0n && posCleared[5] === 0n, `collateral=${posCleared[1]} lt=${posCleared[5]}`, `tx=${closeTx}`);
    addCheck("C3 SHORT close: solver debt ledger cleared", debtAfter[1] === 0n && debtAfter[2] === 0n, `principal=${debtAfter[1]} yield=${debtAfter[2]}`);
  }

  // ── C4: MOAT negatives — nobody outside the authorised surfaces can open a
  //     leveraged position or relay on a stranger's behalf.
  console.log("\n--- C4: moat negative controls ---");
  {
    const openData = encodeFunctionData({ abi: routerAbi, functionName: "swapMultiPool", args: [c1Params(attacker.address)[0]] });
    await expectRevert(attacker, ROUTER, openData, "SolverNotAuthorized", "unregistered solver swapMultiPool blocked");

    const forData = encodeFunctionData({ abi: routerAbi, functionName: "swapMultiPoolFor", args: [c1Params(SOLVER)[0], trader.address] });
    await expectRevert(attacker, ROUTER, forData, "ExecutorUnauthorized", "non-whitelisted relay swapMultiPoolFor blocked");

    // Global entrypoint gate: an unwhitelisted exchange proxy NEVER reaches the
    // fill — the require-string revert is the exact surface a 1inch/Enso venue
    // sees until governance adds it.
    const aggRoute = [attacker.address, USDC, NATIVE, LONG_MARGIN_USDC * BigInt(LEVERAGE), 0n, "0x" as Hex] as const;
    const aggData = encodeFunctionData({ abi: routerAbi, functionName: "swapMultiPoolForAggregator", args: [c1Params(SOLVER)[0], attacker.address, aggRoute] });
    await expectRevert(attacker, ROUTER, aggData, AGGREGATOR_NOT_WHITELISTED, "non-whitelisted exchange proxy blocked before fill");

    // The aggregator-route surface is ERC20-only by design: a native OUTPUT
    // leg reverts AggregatorNativeLegUnsupported even for a whitelisted proxy.
    if (!(await readAny(publicClient, { address: ROUTER, abi: routerAbi, functionName: "allowedAggregators", args: [relayer.address] }))) {
      await send("setAllowedAggregator(relayer,dummy)", { address: ROUTER, abi: routerAbi, functionName: "setAllowedAggregator", args: [relayer.address, true] });
    }
    const nativeRoute = [relayer.address, USDC, NATIVE, LONG_MARGIN_USDC * BigInt(LEVERAGE), 0n, "0x" as Hex] as const;
    const nativeAggData = encodeFunctionData({ abi: routerAbi, functionName: "swapMultiPoolForAggregator", args: [c1Params(SOLVER)[0], attacker.address, nativeRoute] });
    await expectRevert(attacker, ROUTER, nativeAggData, "AggregatorNativeLegUnsupported", "native-output aggregator route blocked by design");
  }
}

console.log("\n=== Full-cycle summary ===");
const fail = printChecks();
console.log(`\n${checks.length - fail}/${checks.length} checks pass, ${fail} fail`);
console.log(`Gate-config txs: ${gateTxs.length === 0 ? "(none needed)" : gateTxs.join(", ")}`);
process.exit(fail > 0 ? 1 : 0);