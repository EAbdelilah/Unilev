/**
 * Eswap solver intent book (Base 8453) — server-side library.
 *
 * This is the Next.js port of `scripts/server/intentRelay.ts`. The protocol
 * needs a public place where a trader's signed leverage order can be seen by
 * any solver. CoW Protocol's own auction endpoint is operator-gated on Base
 * (403 for unauthenticated callers), so we host our own intake. Deploying the
 * dashboard (Vercel/Netlify/Fly) turns this into a free 24/7 HTTPS endpoint at
 * `https://<domain>/api/intents` with no extra infrastructure.
 *
 * Trust model — the relay is an intake and a board, never a custodian:
 *   - listing: the order signature is recovered on chain via
 *     `EswapCoWSettlement.verify`, the pair/leverage/expiry are validated, and
 *     the owner must actually hold and approve `sellAmount` (otherwise the
 *     settlement would pull the margin from the solver).
 *   - settlement: an intent may only be marked "filled" when the settlement's
 *     `filledOrders(id)` is true, so no caller can fake a fill.
 *   - no private keys, no transaction submission, no fund custody.
 *
 * Storage caveat: the default store is in-memory and therefore per-instance
 * (a serverless deploy may run several). It is a *convenience feed*: the
 * authoritative record is the on-chain settlement, and solvers can rebuild the
 * book from `OrderFilled` events. Set `INTENT_STORE=redis` with
 * `INTENT_REDIS_URL` to make it durable once traffic justifies it.
 */
import { ethers } from "ethers"

// ─── Network / contracts ────────────────────────────────────────────────────
export const CHAIN_ID = 8453
export const USDC = ethers.getAddress("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913")
export const WETH = ethers.getAddress("0x4200000000000000000000000000000000000006")
export const COW_SETTLEMENT = ethers.getAddress(
    process.env.V4_COW_SETTLEMENT_ADDRESS ?? "0x7341859C0D7e039118b3f85F341583EBCDB8c960",
)
/** Canonical CoW GPv2Settlement on Base; order signatures are bound to it. */
export const GPV2_SETTLEMENT = "0x9008D19f58AAbD9eD0D60971565AA8510560ab41"

export const SCHEMES = ["eip712", "ethsign", "eip1271", "presign"]

const KEY_TUPLE = "(address,address,uint24,int24,address)"
const ORDER_TUPLE =
    "(address sellToken,address buyToken,address receiver,uint256 sellAmount,uint256 buyAmount,uint32 validTo,bytes32 appData,uint256 feeAmount,bytes32 kind,bool partiallyFillable,bytes32 sellTokenBalance,bytes32 buyTokenBalance)"

const SETTLEMENT_ABI = [
    `function verify(${ORDER_TUPLE} order, uint8 scheme, bytes signature) view returns (address owner, bytes32 orderDigest, bytes orderUid)`,
    "function filledOrders(bytes32) view returns (bool)",
]

const ERC20_FUNDING_ABI = [
    "function balanceOf(address) view returns (uint256)",
    "function allowance(address,address) view returns (uint256)",
]

// EIP-712 type of the CoW order. Mirrors src/v4/cow/CowOrder.sol TYPE_HASH.
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
}

export const COW_DOMAIN = {
    name: "Gnosis Protocol",
    version: "v2",
    chainId: CHAIN_ID,
    verifyingContract: GPV2_SETTLEMENT,
}

export const MAX_LEVERAGE = Number(process.env.SOLVER_MAX_LEVERAGE ?? "5")
const MAX_INTENTS = Number(process.env.RELAY_MAX_INTENTS ?? 2000)
const TX_HASH = /^0x[0-9a-fA-F]{64}$/

// ─── Provider (server only) ─────────────────────────────────────────────────
let _provider = null
export function getProvider() {
    if (_provider) return _provider
    const url = process.env.BASE_RPC_URL ?? process.env.NEXT_PUBLIC_BASE_RPC_URL ?? "https://mainnet.base.org"
    _provider = new ethers.JsonRpcProvider(url, CHAIN_ID, { staticNetwork: true })
    return _provider
}

// ─── Order codec ────────────────────────────────────────────────────────────
/** Turns a raw JSON intent into the contract struct, enforcing pair and flags. */
export function toOrder(o) {
    const sell = ethers.getAddress(o.sellToken)
    const buy = ethers.getAddress(o.buyToken)
    if (![USDC, WETH].includes(sell) || ![USDC, WETH].includes(buy) || sell === buy) {
        throw new Error("pair is not USDC/WETH")
    }
    if (o.kind !== "sell") throw new Error("only sell orders")
    if (o.partiallyFillable) throw new Error("partially fillable not supported")
    if (BigInt(o.feeAmount) !== 0n) throw new Error("fee must be zero")
    if (o.sellTokenBalance !== "erc20" || o.buyTokenBalance !== "erc20") throw new Error("erc20 balances only")
    if (Number(o.validTo) < Math.floor(Date.now() / 1000)) throw new Error("order expired")
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
    }
}

/** Canonical fullAppData document for a leverage (matches appDataJson in Solidity). */
export function appDataJson(lev) {
    return `{"version":1,"appCode":"eswap","metadata":{"eswapLeverage":"${lev}"}}`
}

/** Recovers the leverage the signed appData commits to, or null. */
export function leverageFromAppData(appData) {
    for (let lev = 1; lev <= 20; lev++) {
        if (ethers.keccak256(ethers.toUtf8Bytes(appDataJson(lev))) === String(appData).toLowerCase()) return lev
    }
    return null
}

/**
 * Off-chain + on-chain validation of a submitted intent. Throws on any failure.
 * Returns the recovered owner, the order-UID hash, and the leverage.
 */
export async function checkIntent(intent, provider = getProvider()) {
    const order = toOrder(intent.order)
    const leverage = leverageFromAppData(order.appData)
    if (leverage === null) throw new Error("appData commits to no leverage")
    if (leverage < 2 || leverage > MAX_LEVERAGE) throw new Error(`leverage ${leverage} outside [2, ${MAX_LEVERAGE}]`)
    const scheme = SCHEMES.indexOf(intent.scheme)
    if (scheme < 0) throw new Error(`unknown scheme ${intent.scheme}`)

    const settlement = new ethers.Contract(COW_SETTLEMENT, SETTLEMENT_ABI, provider)
    const [owner, , uid] = await settlement.verify(order, scheme, intent.signature)
    const uidHash = ethers.keccak256(uid)
    if (await settlement.filledOrders(uidHash)) throw new Error("already filled")

    // ECDSA recovers *some* address for any digest, so a tampered order recovers
    // a stranger. Require the recovered owner to actually fund this order;
    // otherwise settlement would pull the margin from the solver.
    const token = new ethers.Contract(order.sellToken, ERC20_FUNDING_ABI, provider)
    const [balance, allowance] = await Promise.all([
        token.balanceOf(owner),
        token.allowance(owner, COW_SETTLEMENT),
    ])
    if (allowance < order.sellAmount) throw new Error("owner has not approved the settlement for sellAmount")
    if (balance < order.sellAmount) throw new Error("owner balance is below sellAmount")

    return { owner, uidHash, leverage, order }
}

// ─── Store ──────────────────────────────────────────────────────────────────
// A module-level map so every route handler in the same runtime instance shares
// the book. `globalThis` keeps it alive across dev-mode hot reloads.
function store() {
    if (!globalThis.__eswapIntentBook) globalThis.__eswapIntentBook = new Map()
    return globalThis.__eswapIntentBook
}

const nowSec = () => Math.floor(Date.now() / 1000)

export function publicView(r) {
    return {
        id: r.id,
        owner: r.owner,
        leverage: r.leverage,
        status: r.status,
        order: r.order,
        scheme: r.scheme,
        signature: r.signature,
        createdAt: r.createdAt,
        expiresAt: r.expiresAt,
        filledAt: r.filledAt,
        txHash: r.txHash,
    }
}

/** Marks open intents expired, or filled when the chain says so. */
export async function sweep() {
    const book = store()
    for (const rec of book.values()) {
        if (rec.status !== "open") continue
        if (rec.expiresAt <= nowSec()) {
            rec.status = "expired"
            continue
        }
        try {
            const settlement = new ethers.Contract(COW_SETTLEMENT, SETTLEMENT_ABI, getProvider())
            if (await settlement.filledOrders(rec.id)) {
                rec.status = "filled"
                rec.filledAt = nowSec()
            }
        } catch {
            // RPC hiccup: leave the record open, try again next sweep.
        }
    }
}

/** POST body → validated, listed intent record. Throws `{status, message}`. */
export async function submitIntent(body) {
    const book = store()
    if (book.size >= MAX_INTENTS) {
        await sweep()
        if (book.size >= MAX_INTENTS) throw Object.assign(new Error("intent book full"), { status: 503 })
    }
    if (!body || !body.order || !body.signature || !body.scheme) {
        throw Object.assign(new Error("need order, scheme and signature"), { status: 400 })
    }
    if (!SCHEMES.includes(body.scheme)) {
        throw Object.assign(new Error(`unknown scheme ${body.scheme}`), { status: 400 })
    }

    let checked
    try {
        checked = await checkIntent({ order: body.order, scheme: body.scheme, signature: body.signature })
    } catch (e) {
        // Contract reverts and rule violations are 400; transport failures 502.
        const rpcFailure = ["NETWORK_ERROR", "SERVER_ERROR", "TIMEOUT"].includes(String(e?.code))
        throw Object.assign(new Error(e?.message ?? "invalid intent"), { status: rpcFailure ? 502 : 400 })
    }

    const id = checked.uidHash
    const existing = book.get(id)
    if (existing) return { created: false, record: existing }

    const rec = {
        id,
        owner: checked.owner,
        leverage: checked.leverage,
        order: body.order,
        scheme: body.scheme,
        signature: body.signature,
        status: "open",
        createdAt: nowSec(),
        expiresAt: Number(body.order.validTo),
        filledAt: null,
        txHash: null,
    }
    book.set(id, rec)
    return { created: true, record: rec }
}

/** Open, unexpired intents — the solver feed. */
export function listIntents(status) {
    const now = nowSec()
    return [...store().values()]
        .filter((r) => (status ? r.status === status : true))
        .filter((r) => r.status !== "open" || r.expiresAt > now)
        .slice(0, 500)
        .map(publicView)
}

export function getIntent(id) {
    return store().get(id) ?? null
}

/** Marks an intent filled — only when the settlement agrees. */
export async function markFilled(id, txHash) {
    const rec = store().get(id)
    if (!rec) throw Object.assign(new Error("unknown intent"), { status: 404 })
    if (txHash !== undefined && txHash !== null && !TX_HASH.test(txHash)) {
        throw Object.assign(new Error("txHash must be a 32-byte hex string"), { status: 400 })
    }
    const settlement = new ethers.Contract(COW_SETTLEMENT, SETTLEMENT_ABI, getProvider())
    if (!(await settlement.filledOrders(rec.id))) {
        throw Object.assign(new Error("not filled on chain yet"), { status: 409 })
    }
    rec.status = "filled"
    rec.filledAt = rec.filledAt ?? nowSec()
    rec.txHash = txHash ?? rec.txHash
    return publicView(rec)
}

export const INTENTS_ENV = { MAX_INTENTS, MAX_LEVERAGE }
