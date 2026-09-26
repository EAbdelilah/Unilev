/**
 * javascript/v4/realApis/gen-mainnet-0x-fixture.js
 *
 * Fetches a REAL 0x Swap API mainnet quote for USDC -> WETH and pins it into a
 * Solidity library consumed by EswapMainnet0xFullCycleForkTest.t.sol:
 *
 *     src/v4/test/fixtures/Mainnet0xRoute.sol
 *
 * The quote's `to` (0x ExchangeProxy) + `data` (fill calldata) become the
 * `AggregatorRoute` executed by EswapRouter._multiPoolOpenAggregator inside a
 * mainnet fork — the fork swallows the execution, so no real capital moves and
 * there is zero reputation/blacklist risk on this EOA/key.
 *
 * Usage:
 *     node javascript/v4/realApis/gen-mainnet-0x-fixture.js
 *
 * Quote sources (tried in order):
 *   1. 0x Swap API     — used when ZERO_X_API_KEY is set (free self-serve:
 *                        https://dashboard.0x.org). Mainnet is key-gated.
 *   2. 1inch Swap API  — used when ONEINCH_API_KEY is set (free self-serve:
 *                        https://portal.1inch.dev).
 *
 * Exactly one venue can be forced with ESWAP_FIXTURE_VENUE=0x|1inch
 * (skips the other venue even if its key is present).
 *
 * If all sources are unavailable the script writes a compile-able STUB fixture
 * (empty CALLDATA) so the repo always builds; the fork test skips until a real
 * quote is pinned.
 */
const fs = require("fs")
const path = require("path")

// ---- optional ethers (for EIP-55 checksummed address literals) -------------
let getAddress = null
try { getAddress = require("ethers").getAddress } catch (_) { /* root node_modules missing */ }

// ---- 0x quote parameters ---------------------------------------------------
const SELL_TOKEN = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" // USDC  (6 dec)
const BUY_TOKEN = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2" // WETH  (18 dec)
const SELL_AMOUNT = "100000000" // 100 USDC (notional for 50 USDC margin @ 2x)
const SLIPPAGE_BPS = 300
// The router is deployed at this fixed address in the fork test, so the quote
// is bound to the exact address that will execute the fill.
const TAKER = "0x0E5a7a0e5A7A0e5a7A0e5A7a0e5a7a0e5A7a0e5A"
const CHAIN_ID = 1

const FIXTURE_PATH = path.join(__dirname, "../../../src/v4/test/fixtures/Mainnet0xRoute.sol")

// ---- minimal .env reader ---------------------------------------------------
function loadEnv() {
    const env = {}
    try {
        const raw = fs.readFileSync(path.join(__dirname, "../../../.env"), "utf8")
        for (const line of raw.split(/\r?\n/)) {
            const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
            if (m) env[m[1]] = m[2]
        }
    } catch (_) { /* no .env */ }
    return env
}

function writeStub(reason) {
    const taker = getAddress ? getAddress(TAKER.toLowerCase()) : TAKER
    const sellToken = getAddress ? getAddress(SELL_TOKEN.toLowerCase()) : SELL_TOKEN
    const buyToken = getAddress ? getAddress(BUY_TOKEN.toLowerCase()) : BUY_TOKEN
    const body = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice GENERATED FILE — do not edit by hand.
/// Produced by: javascript/v4/realApis/gen-mainnet-0x-fixture.js
/// Status: STUB (no real quote pinned) — ${reason}
/// Regenerate with a valid ZERO_X_API_KEY to embed a REAL 0x mainnet quote.
library Mainnet0xRoute {
    string constant SOURCE = "stub";
    address constant EXCHANGE_PROXY = address(0);
    address constant TAKER = ${toChecksum(TAKER)};
    address constant TOKEN_IN = ${toChecksum(SELL_TOKEN)};
    address constant TOKEN_OUT = ${toChecksum(BUY_TOKEN)};
    uint256 constant SELL_AMOUNT = 100000000;
    uint256 constant EXPECTED_BUY = 0;
    uint256 constant MIN_BUY = 0;
    uint256 constant TX_VALUE = 0;
    // Fork block the quote was bound to (0 => fork at latest head).
    uint256 constant REF_BLOCK = 0;
    bytes constant CALLDATA = hex"";
}
`
    fs.writeFileSync(FIXTURE_PATH, body)
    console.log(`[stub] wrote ${FIXTURE_PATH}\n       (${reason})`)
    return false
}

function q(a) {
    return JSON.stringify(a)
}

// ---- minimal keccak-256 (dependency-free) for EIP-55 checksums -------------
const RC = [
    0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n,
    0x000000000000808bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
    0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
    0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
    0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
    0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n
]
const ROT = [
    [0n, 36n, 3n, 41n, 18n], [1n, 44n, 10n, 45n, 2n],
    [62n, 6n, 43n, 15n, 61n], [28n, 55n, 25n, 21n, 56n],
    [27n, 20n, 39n, 8n, 14n]
]
const M64 = 0xffffffffffffffffn

function _rol(x, n) {
    return ((x << n) & M64) | (x >> (64n - n))
}

function _keccakF(s) {
    for (let round = 0; round < 24; round++) {
        const c = [0n, 0n, 0n, 0n, 0n]
        for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) c[x] ^= s[x + 5 * y]
        for (let x = 0; x < 5; x++) {
            const d = c[(x + 4) % 5] ^ _rol(c[(x + 1) % 5], 1n)
            for (let y = 0; y < 5; y++) s[x + 5 * y] ^= d
        }
        const b = new Array(25).fill(0n)
        for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) {
            b[y + 5 * ((2 * x + 3 * y) % 5)] = _rol(s[x + 5 * y], ROT[x][y])
        }
        for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) {
            s[x + 5 * y] = b[x + 5 * y] ^ ((~b[((x + 1) % 5) + 5 * y]) & b[((x + 2) % 5) + 5 * y])
        }
        s[0] ^= RC[round]
    }
}

function keccak256(msgBuf) {
    const rate = 136
    const blockLen = Math.ceil((msgBuf.length + 1) / rate) * rate
    const padded = Buffer.alloc(blockLen)
    msgBuf.copy(padded)
    padded[msgBuf.length] = 0x01
    padded[blockLen - 1] |= 0x80
    const s = new Array(25).fill(0n)
    for (let i = 0; i < blockLen; i += rate) {
        for (let p = 0; p < rate; p++) {
            const lane = p >> 3
            s[(lane % 5) + 5 * ((lane / 5) | 0)] ^= BigInt(padded[i + p]) << BigInt(8 * (p & 7))
        }
        _keccakF(s)
    }
    const out = Buffer.alloc(32)
    for (let p = 0; p < 32; p++) {
        const lane = p >> 3
        out[p] = Number((s[(lane % 5) + 5 * ((lane / 5) | 0)] >> BigInt(8 * (p & 7))) & 0xffn)
    }
    return out
}

function toChecksum(addr) {
    const low = addr.toLowerCase().replace(/^0x/, "")
    const hash = keccak256(Buffer.from(low, "ascii"))
    let out = "0x"
    for (let i = 0; i < low.length; i++) {
        const ch = low.charAt(i)
        if (/[a-f]/.test(ch)) {
            const byte = hash[i >> 1]
            const nibble = i % 2 === 0 ? byte >> 4 : byte & 0x0f
            out += nibble >= 8 ? ch.toUpperCase() : ch
        } else {
            out += ch
        }
    }
    return out
}

function writeFixture(r) {
    const src = toChecksum(r.to)
    const taker = toChecksum(TAKER)
    const sellToken = toChecksum(SELL_TOKEN)
    const buyToken = toChecksum(BUY_TOKEN)
    const body = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice GENERATED FILE — do not edit by hand.
/// Produced by: javascript/v4/realApis/gen-mainnet-0x-fixture.js (${new Date().toISOString()})
/// REAL ${r.source} mainnet route (chain ${CHAIN_ID}), USDC -> WETH.
///   sellToken     ${SELL_TOKEN}   sellAmount ${r.sellAmount} (notional)
///   buyToken      ${BUY_TOKEN}    expected ${r.expectedBuy}  min ${r.minBuy}
///   refBlock      ${r.blockNumber} (fork pinned here so the quote can never go stale)
///   exchangeProxy ${src}
///   taker         ${taker}  (router deployed at this address in the fork test)
/// Executed by EswapRouter._multiPoolOpenAggregator inside the mainnet fork —
/// no real capital moves, zero reputation/blacklist risk on the quoting EOA.
library Mainnet0xRoute {
    string constant SOURCE = ${q(r.source)};
    address constant EXCHANGE_PROXY = ${toChecksum(r.to)};
    address constant TAKER = ${toChecksum(TAKER)};
    address constant TOKEN_IN = ${toChecksum(SELL_TOKEN)};
    address constant TOKEN_OUT = ${toChecksum(BUY_TOKEN)};
    uint256 constant SELL_AMOUNT = ${r.sellAmount};
    uint256 constant EXPECTED_BUY = ${r.expectedBuy};
    uint256 constant MIN_BUY = ${r.minBuy};
    uint256 constant TX_VALUE = ${r.value};
    // Fork block the quote was bound to (0 => fork at latest head).
    uint256 constant REF_BLOCK = ${r.blockNumber ?? "0"};
    bytes constant CALLDATA = hex"${r.data.slice(2)}";
}
`
    fs.writeFileSync(FIXTURE_PATH, body)
    console.log(`[ok] wrote ${FIXTURE_PATH}`)
    console.log(`     real ${r.source} mainnet route: ${r.sellAmount} -> ${r.expectedBuy} wei WETH (min ${r.minBuy})`)
    console.log(`     refBlock ${r.blockNumber}  exchangeProxy ${r.to}  calldata ${r.data.slice(0, 18)}... (${r.data.length / 2 - 1} bytes)`)
    return true
}

// Current mainnet head block (decimal) — fallback pin when the quote source does
// not report its own block. Uses the configured ETH_MAINNET_RPC_URL; returns
// null when unavailable so the fixture forks at latest.
async function latestBlock(env) {
    const url = (env.ETH_MAINNET_RPC_URL || env.ETH_RPC_URL || "").trim()
    if (!url) return null
    try {
        const res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ jsonrpc: "2.0", method: "eth_blockNumber", params: [], id: 1 })
        })
        const body = await res.json()
        const hex = body?.result
        if (typeof hex !== "string") return null
        return String(BigInt(hex))
    } catch (e) {
        console.error("[block] eth_blockNumber failed:", e.message)
        return null
    }
}

async function quote0x(apiKey) {
    // 0x v2 (allowance-holder) — the current API compatible with contract
    // takers: the exchange proxy pulls the input via the classic ERC20
    // allowance (no Permit2 permit signature required), which is exactly what
    // EswapRouter._aggregatorPrefill sets up. (v1 is deprecated on mainnet and
    // returns "no Route matched"; the permit2 variant needs a signed permit a
    // contract router cannot produce.)
    const url = `https://api.0x.org/swap/allowance-holder/quote?chainId=${CHAIN_ID}&sellToken=${SELL_TOKEN}&buyToken=${BUY_TOKEN}&sellAmount=${SELL_AMOUNT}&taker=${TAKER}&slippageBps=${SLIPPAGE_BPS}`
    const res = await fetch(url, { headers: { "0x-api-key": apiKey, "0x-version": "v2" } })
    const text = await res.text()
    let body = null
    try { body = JSON.parse(text) } catch (_) { /* non-json */ }

    if (res.status !== 200 || !body?.transaction?.to || !body?.transaction?.data) {
        console.error("[0x] v2 allowance-holder quote failed:", res.status, text.slice(0, 300))
        return null
    }
    const to = body.transaction.to.toLowerCase()
    const data = body.transaction.data.startsWith("0x") ? body.transaction.data : "0x" + body.transaction.data
    const expectedBuy = body.buyAmount ?? "0"
    let minBuy = body.minBuyAmount
    if (minBuy === undefined || minBuy === null || Number(minBuy) === 0) {
        minBuy = String(Math.floor((Number(expectedBuy) * (10000 - SLIPPAGE_BPS)) / 10000))
    }
    if (!/^0x[a-fA-F0-9]{40}$/.test(to) || !/^0x[0-9a-fA-F]+$/.test(data) || Number(expectedBuy) === 0) {
        console.error("[0x] malformed payload", { to })
        return null
    }
    const blockNumber = body.blockNumber ? String(BigInt(body.blockNumber)) : null
    return { source: "0x-swap-api-v2-allowance-holder", to, data, value: Number(body.transaction.value ?? "0"), sellAmount: body.sellAmount ?? SELL_AMOUNT, expectedBuy, minBuy, blockNumber }
}

async function quote1inch(apiKey) {
    const url = `https://api.1inch.dev/swap/v6.0/${CHAIN_ID}/swap?src=${SELL_TOKEN}&dst=${BUY_TOKEN}&amount=${SELL_AMOUNT}&from=${TAKER}&slippage=${SLIPPAGE_BPS}&disableEstimate=true`
    const res = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}`, accept: "application/json" } })
    const text = await res.text()
    let body = null
    try { body = JSON.parse(text) } catch (_) { /* non-json */ }

    if (res.status !== 200 || !body?.tx?.to || !body?.tx?.data) {
        console.error("[1inch] swap failed:", res.status, text.slice(0, 300))
        return null
    }
    const to = body.tx.to.toLowerCase()
    const data = body.tx.data.startsWith("0x") ? body.tx.data : "0x" + body.tx.data
    const expectedBuy = body.toAmount ?? "0"
    const minBuy = body.minBuyAmount
        ? String(body.minBuyAmount)
        : String(Math.floor((Number(expectedBuy) * (10000 - SLIPPAGE_BPS)) / 10000))
    if (!/^0x[a-fA-F0-9]{40}$/.test(to) || !/^0x[0-9a-fA-F]+$/.test(data) || Number(expectedBuy) === 0) {
        console.error("[1inch] malformed payload", { to })
        return null
    }
    return { source: "1inch-swap-api", to, data, value: Number(body.tx.value ?? "0"), sellAmount: body.fromAmount ?? SELL_AMOUNT, expectedBuy, minBuy }
}

async function main() {
    const env = loadEnv()
    const zeroXKey = (env.ZERO_X_API_KEY || process.env.ZERO_X_API_KEY || "").trim()
    const oneInchKey = (env.ONEINCH_API_KEY || process.env.ONEINCH_API_KEY || "").trim()
    const venue = (env.ESWAP_FIXTURE_VENUE || process.env.ESWAP_FIXTURE_VENUE || "").trim() || null

    let quote = null
    if (!venue || venue === "0x") {
        if (zeroXKey) quote = await quote0x(zeroXKey).catch((e) => { console.error("[0x] error:", e.message); return null })
    }
    if (!quote && (!venue || venue === "1inch")) {
        if (oneInchKey) quote = await quote1inch(oneInchKey).catch((e) => { console.error("[1inch] error:", e.message); return null })
    }

    if (!quote) {
        const why = !zeroXKey && !oneInchKey
            ? "no ZERO_X_API_KEY or ONEINCH_API_KEY (mainnet is key-gated for 0x/1inch)"
            : `${zeroXKey ? "0x" : ""}${zeroXKey && oneInchKey ? "+" : ""}${oneInchKey ? "1inch" : ""} quote(s) failed`
        return writeStub(why)
    }
    if (quote.value !== 0) {
        return writeStub(`${quote.source} route has a native ETH leg (value=${quote.value}) — unsupported by the accounting path`)
    }
    if (!quote.blockNumber) {
        quote.blockNumber = await latestBlock(env)
    }
    return writeFixture(quote)
}

main().catch((e) => {
    console.error(e)
    process.exit(1)
})