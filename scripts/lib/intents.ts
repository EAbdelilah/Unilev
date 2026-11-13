/**
 * Shared intent codec for the Eswap CoW-style solver path (Base 8453).
 *
 * Used by the intent relay (scripts/server/intentRelay.ts), the solver bot
 * (scripts/solvers/cowSolverBot.ts) and the relay check. Pure helpers plus one
 * on-chain verification, with no side effects at import time.
 */
import { ethers } from "ethers";
import { CHAIN_ID, USDC, WETH } from "./eswapBase";

export const COW_SETTLEMENT = ethers.getAddress(
    process.env.V4_COW_SETTLEMENT_ADDRESS ?? "0x7341859C0D7e039118b3f85F341583EBCDB8c960",
);
// The canonical CoW GPv2Settlement on Base. Signatures are bound to it.
export const GPV2_SETTLEMENT = "0x9008D19f58AAbD9eD0D60971565AA8510560ab41";
export const SCHEMES = ["eip712", "ethsign", "eip1271", "presign"] as const;
export type Scheme = (typeof SCHEMES)[number];

const KEY_TUPLE = "(address,address,uint24,int24,address)";
const ORDER_TUPLE =
    "(address sellToken,address buyToken,address receiver,uint256 sellAmount,uint256 buyAmount,uint32 validTo,bytes32 appData,uint256 feeAmount,bytes32 kind,bool partiallyFillable,bytes32 sellTokenBalance,bytes32 buyTokenBalance)";

export const SETTLEMENT_ABI = [
    `function fillOrder(${ORDER_TUPLE} order, uint8 scheme, bytes signature, (uint8 leverage,address solver,${KEY_TUPLE} key,${KEY_TUPLE} standardPoolKey) params) returns (address owner)`,
    `function verify(${ORDER_TUPLE} order, uint8 scheme, bytes signature) view returns (address owner, bytes32 orderDigest, bytes orderUid)`,
    "function filledOrders(bytes32) view returns (bool)",
];

const ERC20_FUNDING_ABI = [
    "function balanceOf(address) view returns (uint256)",
    "function allowance(address,address) view returns (uint256)",
];

// EIP-712 type of the CoW order. Matches src/v4/cow/CowOrder.sol TYPE_HASH.
export const ORDER_TYPES = {
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
};
export const COW_DOMAIN = {
    name: "Gnosis Protocol",
    version: "v2",
    chainId: CHAIN_ID,
    verifyingContract: GPV2_SETTLEMENT,
};

export type RawOrder = {
    sellToken: string;
    buyToken: string;
    receiver: string;
    sellAmount: string;
    buyAmount: string;
    validTo: number;
    appData: string;
    feeAmount: string;
    kind: string;
    partiallyFillable: boolean;
    sellTokenBalance: string;
    buyTokenBalance: string;
};
export type Intent = { order: RawOrder; scheme: Scheme; signature: string };

/** Relay-stored intent: a feed record carries an id and its on-chain UID. */
export type FeedIntent = Intent & { id?: string; owner?: string; leverage?: number; expiresAt?: number };

export const MAX_LEVERAGE = Number(process.env.SOLVER_MAX_LEVERAGE ?? "5");

/** Turns a raw intent into the contract struct, enforcing the pair and flags. */
export function toOrder(o: RawOrder) {
    const sell = ethers.getAddress(o.sellToken);
    const buy = ethers.getAddress(o.buyToken);
    if (![USDC, WETH].includes(sell) || ![USDC, WETH].includes(buy) || sell === buy) {
        throw new Error("pair is not USDC/WETH");
    }
    if (o.kind !== "sell") throw new Error("only sell orders");
    if (o.partiallyFillable) throw new Error("partially fillable not supported");
    if (BigInt(o.feeAmount) !== 0n) throw new Error("fee must be zero");
    if (o.sellTokenBalance !== "erc20" || o.buyTokenBalance !== "erc20") throw new Error("erc20 balances only");
    if (o.validTo < Math.floor(Date.now() / 1000)) throw new Error("order expired");
    return {
        sellToken: sell,
        buyToken: buy,
        receiver: ethers.getAddress(o.receiver),
        sellAmount: BigInt(o.sellAmount),
        buyAmount: BigInt(o.buyAmount),
        validTo: Number(o.validTo),
        appData: o.appData,
        feeAmount: 0n,
        kind: ethers.id("sell"),
        partiallyFillable: false,
        sellTokenBalance: ethers.id("erc20"),
        buyTokenBalance: ethers.id("erc20"),
    };
}

/** The canonical fullAppData document for a leverage (matches appDataJson). */
export function appDataJson(lev: number): string {
    return `{"version":1,"appCode":"eswap","metadata":{"eswapLeverage":"${lev}"}}`;
}

/** Recovers the leverage a signed appData commits to, or null if none. */
export function leverageFromAppData(appData: string): number | null {
    for (let lev = 1; lev <= 20; lev++) {
        if (ethers.keccak256(ethers.toUtf8Bytes(appDataJson(lev))) === appData.toLowerCase()) return lev;
    }
    return null;
}

/**
 * Full off-chain + on-chain check of a submitted intent. Throws on any failure.
 * Returns the recovered owner, the 56-byte order UID hash, and the leverage.
 */
export async function checkIntent(
    intent: Intent,
    provider: ethers.Provider,
): Promise<{ owner: string; uidHash: string; leverage: number; order: ReturnType<typeof toOrder> }> {
    const order = toOrder(intent.order);
    const leverage = leverageFromAppData(order.appData);
    if (leverage === null) throw new Error("appData commits to no leverage");
    if (leverage < 2 || leverage > MAX_LEVERAGE) throw new Error(`leverage ${leverage} outside [2, ${MAX_LEVERAGE}]`);
    const scheme = SCHEMES.indexOf(intent.scheme);
    if (scheme < 0) throw new Error(`unknown scheme ${intent.scheme}`);
    const settlement = new ethers.Contract(COW_SETTLEMENT, SETTLEMENT_ABI, provider) as unknown as {
        verify(o: unknown, s: number, sig: string): Promise<[string, string, string]>;
        filledOrders(uidHash: string): Promise<boolean>;
    };
    const [owner, , uid] = await settlement.verify(order, scheme, intent.signature);
    const uidHash = ethers.keccak256(uid);
    if (await settlement.filledOrders(uidHash)) throw new Error("already filled");
    // ECDSA recovers *some* address for any digest, so a tampered order recovers
    // a stranger. Require the recovered owner to actually fund this order. The
    // settlement otherwise pulls the margin from the solver, which must never happen.
    const token = new ethers.Contract(order.sellToken, ERC20_FUNDING_ABI, provider) as unknown as {
        balanceOf(who: string): Promise<bigint>;
        allowance(who: string, spender: string): Promise<bigint>;
    };
    const [balance, allowance] = await Promise.all([
        token.balanceOf(owner),
        token.allowance(owner, COW_SETTLEMENT),
    ]);
    if (allowance < order.sellAmount) throw new Error("owner has not approved the settlement for sellAmount");
    if (balance < order.sellAmount) throw new Error("owner balance is below sellAmount");
    return { owner, uidHash, leverage, order };
}

/** Builds a signed demo intent under the real CoW domain. */
export async function demoIntent(): Promise<Intent> {
    const trader = ethers.Wallet.createRandom();
    const order: RawOrder = {
        sellToken: USDC,
        buyToken: WETH,
        receiver: ethers.ZeroAddress,
        sellAmount: "1000000000", // $1,000 USDC
        buyAmount: "500000000000000000", // 0.5 WETH slippage floor
        validTo: Math.floor(Date.now() / 1000) + 3600,
        appData: ethers.keccak256(ethers.toUtf8Bytes(appDataJson(5))),
        feeAmount: "0",
        kind: "sell",
        partiallyFillable: false,
        sellTokenBalance: "erc20",
        buyTokenBalance: "erc20",
    };
    const value = { ...toOrder(order), kind: "sell", sellTokenBalance: "erc20", buyTokenBalance: "erc20" };
    const signature = await trader.signTypedData(COW_DOMAIN, ORDER_TYPES, value);
    return { order, scheme: "eip712", signature };
}
