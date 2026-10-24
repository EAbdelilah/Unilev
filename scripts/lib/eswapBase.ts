/**
 * Shared Base Mainnet (chain 8453) constants, ABIs, EIP-712 helpers, and
 * intent-build utilities reused by the relay server, solver bot, and every
 * Stage 3-5 pipeline script.
 */
import path from "node:path";
import dotenv from "dotenv";
import { ethers } from "ethers";

dotenv.config({ path: path.resolve(process.cwd(), ".env"), override: false });
// Also try loading from the repo root when scripts run from subdirectories.
dotenv.config({ path: path.resolve(process.cwd(), "..", ".env"), override: false });

// ─── Network ─────────────────────────────────────────────────────────────────
export const CHAIN_ID = 8453;
export const RPC = process.env.BASE_RPC_URL ?? "https://mainnet.base.org";

// ─── Confirmed Base Mainnet addresses ────────────────────────────────────────
export const USDC = ethers.getAddress("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
export const WETH = ethers.getAddress("0x4200000000000000000000000000000000000006");
export const POOL_MANAGER = ethers.getAddress("0x498581fF718922c3f8e6A244956aF099B2652b2b");
export const HOOK = ethers.getAddress(
  process.env.V4_HOOK_ADDRESS ?? "0xe33A630503c640143126BBF222a82689D49b50c8",
);
export const ROUTER = ethers.getAddress(
  process.env.V4_ROUTER_ADDRESS ?? "0xD3360D67E366Cac21a1c18fC9100B93be79e1437",
);
export const ADAPTER = ethers.getAddress(
  process.env.V4_ADAPTER_ADDRESS ?? "0x14FBAF1858d37BF994BDAF9ab4b31A664D4663aD",
);
export const QUOTER = ethers.getAddress(
  process.env.V4_QUOTER_ADDRESS ?? "0x3177f4e53a0EE0318174771b32E68aDe63c20f3b",
);
export const PRICE_FEED = ethers.getAddress(
  process.env.V4_PRICEFEED_ADDRESS ?? "0xE6E7229f878fB2d7dAbAcD2873A9ea4A3c04aFf8",
);

// ─── Pool keys (hook accounting pool + deep standard settlement pool) ────────
export const HOOK_FEE = 3000;
export const HOOK_TICK = 60;
export const STD_FEE = 500;
export const STD_TICK = 10;

// WETH (0x4200..06) sorts below USDC (0x8335..13) => currency0 = WETH.
export const HOOK_KEY = [WETH, USDC, HOOK_FEE, HOOK_TICK, HOOK] as const;
export const STD_KEY = [WETH, USDC, STD_FEE, STD_TICK, ethers.ZeroAddress] as const;

export function poolId(key: readonly [string, string, number, number, string]): string {
  return ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["address", "address", "uint24", "int24", "address"],
      [key[0], key[1], key[2], key[3], key[4]],
    ),
  );
}

export const HOOK_POOL_ID = poolId(HOOK_KEY);
export const STD_POOL_ID = poolId(STD_KEY);

// ─── EIP-712 ─────────────────────────────────────────────────────────────────
export const DOMAIN = {
  name: "EswapRouter",
  version: "1",
  chainId: CHAIN_ID,
  verifyingContract: ROUTER,
} as const;

export const INTENT_TYPES: Record<string, { name: string; type: string }[]> = {
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

export interface LendingIntentValue {
  poolId: string;
  standardPoolId: string;
  zeroForOne: boolean;
  amountSpecified: bigint;
  leverage: number;
  solver: string;
  deadline: bigint;
  minAmountOut: bigint;
  nonce: bigint;
}

/** Payload shape stored/relayed by the order relay (bigints as strings). */
export interface SignedIntent {
  chainId: number;
  router: string;
  hook: string;
  domain: typeof DOMAIN;
  types: typeof INTENT_TYPES;
  value: {
    poolId: string;
    standardPoolId: string;
    zeroForOne: boolean;
    amountSpecified: string;
    leverage: number;
    solver: string;
    deadline: string;
    minAmountOut: string;
    nonce: string;
  };
  trader: string;
  solver: string;
  signature: string;
  digest: string;
  margin: string;
  leverage: number;
  borrowAmount: string;
  hookPoolKey: readonly [string, string, number, number, string];
  standardPoolKey: readonly [string, string, number, number, string];
  requiredAllowance?: { token: string; owner: string; spender: string; amount: string };
  createdAt?: string;
  /** Set by the relay once consumed on-chain. */
  consumedTxHash?: string;
}

/** Convert a relay-stored SignedIntent back into the on-chain struct shape. */
export function toIntentStruct(s: SignedIntent): LendingIntentValue {
  return {
    poolId: s.value.poolId,
    standardPoolId: s.value.standardPoolId,
    zeroForOne: s.value.zeroForOne,
    amountSpecified: BigInt(s.value.amountSpecified),
    leverage: s.value.leverage,
    solver: ethers.getAddress(s.value.solver),
    deadline: BigInt(s.value.deadline),
    minAmountOut: BigInt(s.value.minAmountOut),
    nonce: BigInt(s.value.nonce),
  };
}

// ─── ABIs ────────────────────────────────────────────────────────────────────
export const ROUTER_ABI = [
  "function DOMAIN_SEPARATOR() view returns (bytes32)",
  "function hashIntent((bytes32 poolId,bytes32 standardPoolId,bool zeroForOne,int256 amountSpecified,uint8 leverage,address solver,uint256 deadline,uint256 minAmountOut,uint256 nonce) intent) pure returns (bytes32)",
  "function quoteExactInput((address,address,uint24,int24,address) key, bool zeroForOne, int128 amountSpecified, uint8 leverage) view returns (int128)",
  "function erc20BorrowEscrow(address,address) view returns (uint256)",
  "function depositBorrowEscrow(address token, uint256 amount)",
  "function withdrawBorrowEscrow(address token, uint256 amount)",
  "function registeredSolvers(address) view returns (bool)",
  "function filledIntents(bytes32) view returns (bool)",
  "function closePosition(address hook, (address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) key, address trader, address solver, uint256 minAmountOut)",
  "function swapWithIntent(((address,address,uint24,int24,address) key,(address,address,uint24,int24,address) standardPoolKey,bool zeroForOne,int256 amountSpecified,uint8 leverage,address solver,bytes hookData,uint256 deadline,uint256 minAmountOut) params, address trader, (bytes32 poolId,bytes32 standardPoolId,bool zeroForOne,int256 amountSpecified,uint8 leverage,address solver,uint256 deadline,uint256 minAmountOut,uint256 nonce) intent, bytes signature) payable returns (bytes)",
] as const;

export const HOOK_ABI = [
  "function positions(bytes32 poolId, address trader) view returns (address trader, uint256 collateralAmount, uint256 borrowedAmount, uint8 leverage, bool isLong, uint160 liquidationSqrtPrice, int24 tickLower, int24 tickUpper, uint128 liquidity)",
  "function solverDebts(bytes32 poolId, address trader, address solver) view returns (address solver, uint256 principal, uint256 accumulatedYield)",
  "function protocolFees(address currency) view returns (uint256)",
  "function protocolFeeFor(address trader) view returns (uint256)",
  "function treasury() view returns (address)",
  "function owner() view returns (address)",
  "function reserveFactor() view returns (uint256)",
  "function withdrawProtocolFee(address currency, uint256 amount)",
  "function setConfig((address treasury,address router,uint256 reserveFactor,uint160 maxPriceSwingBps,uint8 defaultMaxLeverage,bool requireTwapOracle) params)",
  "event MultiPoolMarginOpened(bytes32 indexed poolId, address indexed trader, uint8 leverage, uint256 marginAmount, uint256 boughtAmount)",
] as const;

export const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
  "function transfer(address,uint256) returns (bool)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
] as const;

export const WETH9_ABI = [
  "function deposit() payable",
  "function withdraw(uint256 wad)",
  "function balanceOf(address) view returns (uint256)",
] as const;

// ─── Providers / wallets ─────────────────────────────────────────────────────
export function getProvider(): ethers.JsonRpcProvider {
  return new ethers.JsonRpcProvider(RPC);
}

export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === "" || v.startsWith("<")) {
    throw new Error(`${name} is unset or a placeholder in .env`);
  }
  return v.trim();
}

export function traderWallet(provider?: ethers.Provider): ethers.Wallet {
  const pk = process.env.TINY_TRADER_PK ?? process.env.TRADER_PK;
  if (!pk) throw new Error("TINY_TRADER_PK (or TRADER_PK) is unset in .env");
  return new ethers.Wallet(pk, provider);
}

export function solverWallet(provider?: ethers.Provider): ethers.Wallet {
  const pk = requireEnv("SOLVER_PRIVATE_KEY");
  return new ethers.Wallet(pk, provider);
}

export function ownerWallet(provider?: ethers.Provider): ethers.Wallet {
  const pk = requireEnv("PRIVATE_KEY");
  return new ethers.Wallet(pk, provider);
}

// ─── Intent building ─────────────────────────────────────────────────────────
export interface BuildIntentOpts {
  trader: string;
  solver: string;
  /** Margin in the INPUT token's base units (USDC 6dp for longs, WETH 18dp for shorts). */
  margin: bigint;
  leverage: number;
  /**
   * Swap direction. false (default) = long: USDC in -> WETH out.
   * true = short: WETH in -> USDC out. Determines the quote direction and the
   * margin/allowance token.
   */
  zeroForOne?: boolean;
  /** Optional override; defaults to live router quote * 99%. */
  minAmountOut?: bigint;
  deadlineSec?: number;
  nonce?: bigint;
}

/** Input-token (margin) asset for a given direction on the WETH/USDC hook pool. */
export function marginToken(zeroForOne: boolean): string {
  return zeroForOne ? WETH : USDC;
}

export async function buildAndSignIntent(
  wallet: ethers.Wallet,
  opts: BuildIntentOpts,
  provider: ethers.Provider,
): Promise<SignedIntent> {
  const router = new ethers.Contract(ROUTER, ROUTER_ABI, provider);
  const borrow = opts.margin * BigInt(opts.leverage - 1);
  const zeroForOne = opts.zeroForOne ?? false;

  let minAmountOut = opts.minAmountOut ?? 0n;
  if (opts.minAmountOut === undefined) {
    try {
      const q = (await router.quoteExactInput(HOOK_KEY, zeroForOne, -opts.margin, opts.leverage)) as bigint;
      minAmountOut = (q * 99n) / 100n;
    } catch {
      minAmountOut = 0n;
    }
  }

  const deadline = BigInt(Math.floor(Date.now() / 1000) + (opts.deadlineSec ?? 3600));
  const nonce = opts.nonce ?? BigInt(Date.now());

  const value: LendingIntentValue = {
    poolId: HOOK_POOL_ID,
    standardPoolId: STD_POOL_ID,
    zeroForOne,
    amountSpecified: -opts.margin,
    leverage: opts.leverage,
    solver: ethers.getAddress(opts.solver),
    deadline,
    minAmountOut,
    nonce,
  };

  const signature = await wallet.signTypedData(DOMAIN, INTENT_TYPES, value);
  const digest = ethers.TypedDataEncoder.hash(DOMAIN, INTENT_TYPES, value);

  return {
    chainId: CHAIN_ID,
    router: ROUTER,
    hook: HOOK,
    domain: DOMAIN,
    types: INTENT_TYPES,
    value: {
      poolId: value.poolId,
      standardPoolId: value.standardPoolId,
      zeroForOne: value.zeroForOne,
      amountSpecified: value.amountSpecified.toString(),
      leverage: value.leverage,
      solver: value.solver,
      deadline: value.deadline.toString(),
      minAmountOut: value.minAmountOut.toString(),
      nonce: value.nonce.toString(),
    },
    trader: ethers.getAddress(opts.trader),
    solver: value.solver,
    signature,
    digest,
    margin: opts.margin.toString(),
    leverage: opts.leverage,
    borrowAmount: borrow.toString(),
    hookPoolKey: HOOK_KEY,
    standardPoolKey: STD_KEY,
    requiredAllowance: {
      token: marginToken(zeroForOne),
      owner: ethers.getAddress(opts.trader),
      spender: ROUTER,
      amount: opts.margin.toString(),
    },
    createdAt: new Date().toISOString(),
  };
}

// ─── SwapParams construction (solver side) ───────────────────────────────────
export function buildSwapParams(s: SignedIntent, solverAddr: string) {
  const hookData = ethers.AbiCoder.defaultAbiCoder().encode(
    ["bool", "uint8", "address"],
    [true, s.leverage, s.trader],
  );
  return {
    key: s.hookPoolKey,
    standardPoolKey: s.standardPoolKey,
    zeroForOne: s.value.zeroForOne,
    amountSpecified: BigInt(s.value.amountSpecified),
    leverage: s.leverage,
    solver: ethers.getAddress(solverAddr),
    hookData,
    deadline: BigInt(s.value.deadline),
    minAmountOut: BigInt(s.value.minAmountOut),
  };
}

// ─── Error formatting ────────────────────────────────────────────────────────
export function formatRevert(e: unknown, iface?: ethers.Interface): string {
  const err = e as { revert?: { name: string; args?: unknown[] }; data?: string; shortMessage?: string; message?: string };
  if (err?.revert) return `${err.revert.name}(${err.revert.args?.join(", ") ?? ""})`;
  if (err?.data && iface) {
    try {
      const parsed = iface.parseError(err.data);
      if (parsed) return `${parsed.name}(${parsed.args?.join(", ") ?? ""})  [${err.data}]`;
    } catch { /* fall through */ }
    return `${err.shortMessage ?? err.message}  data=${err.data}`;
  }
  return err?.shortMessage ?? err?.message ?? String(e);
}

// ─── Relay URL ───────────────────────────────────────────────────────────────
export const RELAY_HTTP = process.env.RELAY_HTTP_URL ?? "http://localhost:8080";
export const RELAY_WS = process.env.RELAY_WS_URL ?? "ws://localhost:8080/feed";
export const RELAY_PORT = Number(process.env.RELAY_PORT ?? 8080);
