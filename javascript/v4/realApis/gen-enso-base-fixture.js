/**
 * javascript/v4/realApis/gen-enso-base-fixture.js
 *
 * Fetches a REAL Enso Bundle (https://docs.enso.build) for BASE (chain 8453)
 * using `routingStrategy=router` and pins it into a Solidity library consumed by
 * EswapBaseEnsoFullCycleForkTest.t.sol:
 *
 *     src/v4/test/fixtures/BaseEnsoRoute.sol
 *
 * The bundle's `tx.to` (EnsoRouter, execute `ensure`=Router V2 on Base:
 * 0xF75584eF6673aD213a685a1B58Cc0330B8eA22Cf) + `tx.data` (route fill calldata)
 * become the `AggregatorRoute.exchangeProxy` + `callData` executed by
 * EswapRouter._multiPoolOpenAggregator inside a Base fork — the fork swallows
 * execution, so no real capital moves.
 *
 * Usage:
 *     node javascript/v4/realApis/gen-enso-base-fixture.js
 *
 * Requirements: ENSO_API_KEY (free self-serve at https://developers.enso.build).
 * Without it the script writes a compile-able STUB fixture (empty CALLDATA) so
 * the repo always builds; the fork test skips until a real bundle is pinned.
 */
const fs = require("fs")
const path = require("path")

// ---- optional ethers (for EIP-55 checksummed address literals) -------------
let getAddress = null
try { getAddress = require("ethers").getAddress } catch (_) { /* root node_modules missing */ }

// ---- Enso bundle parameters (Base, chain 8453) -----------------------------
const SELL_TOKEN = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" // USDC (6 dec)
const BUY_TOKEN = "0x4200000000000000000000000000000000000006" // WETH (18 dec)
const SELL_AMOUNT = "100000000" // 100 USDC (notional for 50 USDC margin @ 2x)
const SLIPPAGE_BPS = 30 // Enso slippage is in BPS (1..9999; 30 = 0.30%)
const TAKER = "0x0E5a7a0e5A7A0e5a7A0e5A7a0e5a7a0e5A7a0e5A"
const CHAIN_ID = 8453

// Documented EnsoRouter V2 (Base is the same deployment address as mainnet).
const ENSO_ROUTER_V2 = "0xF75584eF6673aD213a685a1B58Cc0330B8eA22Cf"
const ENSO_DELEGATE_V2 = "0xA2F4f9C6ec598CA8c633024f8851c79CA5F43e48"

const BUNDLE_URL = "https://api.enso.build/api/v1/shortcuts/bundle"
const FIXTURE_PATH = path.join(__dirname, "../../../src/v4/test/fixtures/BaseEnsoRoute.sol")

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

function toChecksum(addr) {
    return getAddress ? getAddress(addr.toLowerCase()) : addr.toLowerCase()
}

function writeStub(reason) {
    const taker = toChecksum(TAKER)
    const sellToken = toChecksum(SELL_TOKEN)
    const buyToken = toChecksum(BUY_TOKEN)
    const body = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice GENERATED FILE — do not edit by hand.
/// Produced by: javascript/v4/realApis/gen-enso-base-fixture.js
/// Status: STUB (no real bundle pinned) — ${reason}
/// Regenerate with a valid ENSO_API_KEY to embed a REAL Enso bundle.
library BaseEnsoRoute {
    string constant SOURCE = "stub";
    address constant EXCHANGE_PROXY = address(0);
    address constant TAKER = ${taker};
    address constant TOKEN_IN = ${sellToken};
    address constant TOKEN_OUT = ${buyToken};
    uint256 constant SELL_AMOUNT = 100000000;
    uint256 constant EXPECTED_BUY = 0;
    uint256 constant MIN_BUY = 0;
    uint256 constant REF_BLOCK = 0;
    uint256 constant TX_VALUE = 0;
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

function normalizeAmountMap(map) {
    const out = {}
    if (!map) return out
    if (Array.isArray(map)) {
        for (const pair of map) {
            if (!Array.isArray(pair) || pair.length < 2) continue
            out[toChecksum(pair[0]).toLowerCase()] = pair[1]
        }
    } else if (typeof map === "object") {
        for (const addr of Object.keys(map)) {
            out[toChecksum(addr).toLowerCase()] = map[addr]
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
/// Produced by: javascript/v4/realApis/gen-enso-base-fixture.js (${new Date().toISOString()})
/// REAL Enso Base bundle (chain ${CHAIN_ID}): enso:route USDC -> WETH,
/// routingStrategy=router, fromAddress/receiver = the fixed taker below.
///   sellToken ${SELL_TOKEN}   sellAmount ${r.sellAmount} (notional)
///   buyToken  ${BUY_TOKEN}    expected ${r.expectedBuy}  min ${r.minBuy}
///   refBlock      ${r.refBlock ?? 0} (fork pinned here so the quote can never go stale)
///   exchangeProxy ${src} (EnsoRouter V2 = ${toChecksum(ENSO_ROUTER_V2)})
///   taker         ${taker}  (router deployed at this address in the fork test)
/// Executed by EswapRouter._multiPoolOpenAggregator inside the Base fork —
/// no real capital moves, zero reputation/blacklist risk on the quoting EOA.
library BaseEnsoRoute {
    string constant SOURCE = ${q(r.source)};
    address constant EXCHANGE_PROXY = ${src};
    address constant TAKER = ${taker};
    address constant TOKEN_IN = ${sellToken};
    address constant TOKEN_OUT = ${buyToken};
    uint256 constant SELL_AMOUNT = ${r.sellAmount};
    uint256 constant EXPECTED_BUY = ${r.expectedBuy};
    uint256 constant MIN_BUY = ${r.minBuy};
    uint256 constant REF_BLOCK = ${r.refBlock ?? 0};
    uint256 constant TX_VALUE = ${r.value};
    bytes constant CALLDATA = hex"${r.data.slice(2)}";
}
`
    fs.writeFileSync(FIXTURE_PATH, body)
    console.log(`[ok] wrote ${FIXTURE_PATH}`)
    console.log(`     real ${r.source} Base bundle: ${r.sellAmount} -> ${r.expectedBuy} wei WETH (min ${r.minBuy})`)
    console.log(`     exchangeProxy ${r.to}  calldata ${r.data.slice(0, 18)}... (${r.data.length / 2 - 1} bytes)`)
    return true
}

async function latestBlock(env) {
    const url = (env.BASE_RPC_URL || env.BASE_MAINNET_RPC_URL || "https://mainnet.base.org").trim()
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

async function quoteEnso(apiKey) {
    const url = `${BUNDLE_URL}?chainId=${CHAIN_ID}&fromAddress=${TAKER}&routingStrategy=router&receiver=${TAKER}`
    const actions = [
        {
            protocol: "enso",
            action: "route",
            args: {
                tokenIn: SELL_TOKEN,
                tokenOut: BUY_TOKEN,
                amountIn: SELL_AMOUNT,
                slippage: String(SLIPPAGE_BPS),
                receiver: TAKER
            }
        }
    ]
    const res = await fetch(url, {
        method: "POST",
        headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(actions)
    })
    const text = await res.text()
    let body = null
    try { body = JSON.parse(text) } catch (_) { /* non-json */ }

    if (res.status !== 200 || !body?.tx || !body.tx.to || !body.tx.data) {
        console.error("[enso] bundle failed:", res.status, text.slice(0, 300))
        return null
    }
    const to = body.tx.to.toLowerCase()
    const data = body.tx.data.startsWith("0x") ? body.tx.data : "0x" + body.tx.data
    const wethKey = toChecksum(BUY_TOKEN).toLowerCase()

    if (to === ENSO_DELEGATE_V2.toLowerCase()) {
        console.error("[enso] response routed through the DELEGATE client, expected EnsoRouter:", to)
        return null
    }
    if (to !== ENSO_ROUTER_V2.toLowerCase()) {
        console.warn(`[enso] note: tx.to ${to} is not the documented Base EnsoRouter V2 (${ENSO_ROUTER_V2}); using it as exchangeProxy anyway`)
    }

    const amountsOut = normalizeAmountMap(body.amountsOut)
    const minAmountsOut = normalizeAmountMap(body.minAmountsOut)
    const expectedBuy = amountsOut[wethKey]
    let minBuy = minAmountsOut[wethKey]
    if (minBuy === undefined || minBuy === null || Number(minBuy) === 0) {
        if (expectedBuy) {
            minBuy = String(Math.floor((Number(expectedBuy) * (10000 - SLIPPAGE_BPS)) / 10000))
        } else {
            minBuy = "0"
        }
    }

    const value = Number(body.tx.value ?? "0")
    if (!/^0x[a-fA-F0-9]{40}$/.test(to) || !/^0x[0-9a-fA-F]+$/.test(data)) {
        console.error("[enso] malformed payload", { to })
        return null
    }
    if (!expectedBuy || Number(expectedBuy) === 0) {
        console.error("[enso] no WETH entry in amountsOut", JSON.stringify(body.amountsOut).slice(0, 300))
        return null
    }
    return {
        source: "enso-bundle-base",
        to,
        data,
        value,
        sellAmount: SELL_AMOUNT,
        expectedBuy,
        minBuy
    }
}

async function main() {
    const env = loadEnv()
    const apiKey = (env.ENSO_API_KEY || process.env.ENSO_API_KEY || "").trim()

    if (!apiKey) {
        return writeStub("no ENSO_API_KEY (free self-serve at https://developers.enso.build)")
    }
    const quote = await quoteEnso(apiKey).catch((e) => {
        console.error("[enso] error:", e.message)
        return null
    })
    if (!quote) {
        return writeStub("Enso bundle request failed")
    }
    if (quote.value !== 0) {
        return writeStub(`Enso bundle has a native ETH leg (value=${quote.value}) — unsupported by the accounting path`)
    }
    quote.refBlock = await latestBlock(env)
    return writeFixture(quote)
}

main().catch((e) => {
    console.error(e)
    process.exit(1)
})
