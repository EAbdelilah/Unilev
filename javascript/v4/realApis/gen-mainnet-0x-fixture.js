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
 *   2. KyberSwap Agg.  — keyless REST fallback; returns real mainnet route
 *                        calldata with the same {to, data} shape.
 *
 * If BOTH are unavailable the script writes a compile-able STUB fixture (empty
 * CALLDATA) so the repo always builds; the fork test skips until a real quote
 * is pinned.
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
const SLIPPAGE_BPS = 30
// The router is deployed at this fixed address in the fork test, so the quote
// is bound to the exact address that will execute the fill.
const TAKER = "0x0E5a7a0e5A7A0e5a7A0e5A7a0e5a7a0e5A7a0e5A"
const CHAIN_ID = 1
// KyberSwap MetaAggregationRouterV2 (mainnet) — keyless fallback source.
const KYBER_BUILD = "https://aggregator-api.kyberswap.com/ethereum/api/v1/route/build"
const KYBER_ROUTES = "https://aggregator-api.kyberswap.com/ethereum/api/v1/routes"

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
    address constant TAKER = ${taker};
    address constant TOKEN_IN = ${sellToken};
    address constant TOKEN_OUT = ${buyToken};
    uint256 constant SELL_AMOUNT = 100000000;
    uint256 constant EXPECTED_BUY = 0;
    uint256 constant MIN_BUY = 0;
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

function toChecksum(addr) {
    return getAddress ? getAddress(addr.toLowerCase()) : addr.toLowerCase()
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
///   exchangeProxy ${src}
///   taker         ${taker}  (router deployed at this address in the fork test)
/// Executed by EswapRouter._multiPoolOpenAggregator inside the mainnet fork —
/// no real capital moves, zero reputation/blacklist risk on the quoting EOA.
library Mainnet0xRoute {
    string constant SOURCE = ${q(r.source)};
    address constant EXCHANGE_PROXY = ${src};
    address constant TAKER = ${taker};
    address constant TOKEN_IN = ${sellToken};
    address constant TOKEN_OUT = ${buyToken};
    uint256 constant SELL_AMOUNT = ${r.sellAmount};
    uint256 constant EXPECTED_BUY = ${r.expectedBuy};
    uint256 constant MIN_BUY = ${r.minBuy};
    uint256 constant TX_VALUE = ${r.value};
    bytes constant CALLDATA = hex"${r.data.slice(2)}";
}
`
    fs.writeFileSync(FIXTURE_PATH, body)
    console.log(`[ok] wrote ${FIXTURE_PATH}`)
    console.log(`     real ${r.source} mainnet route: ${r.sellAmount} -> ${r.expectedBuy} wei WETH (min ${r.minBuy})`)
    console.log(`     exchangeProxy ${r.to}  calldata ${r.data.slice(0, 18)}... (${r.data.length / 2 - 1} bytes)`)
    return true
}

async function quote0x(apiKey) {
    const url = `https://api.0x.org/swap/v1/quote?sellToken=${SELL_TOKEN}&buyToken=${BUY_TOKEN}&sellAmount=${SELL_AMOUNT}&taker=${TAKER}&slippageBps=${SLIPPAGE_BPS}`
    const res = await fetch(url, { headers: { "0x-api-key": apiKey, "0x-chain-id": String(CHAIN_ID) } })
    const text = await res.text()
    let body = null
    try { body = JSON.parse(text) } catch (_) { /* non-json */ }

    if (res.status !== 200 || !body?.data || !body?.to) {
        console.error("[0x] quote failed:", res.status, text.slice(0, 300))
        return null
    }
    const to = body.to.toLowerCase()
    const data = body.data.startsWith("0x") ? body.data : "0x" + body.data
    const expectedBuy = body.buyAmount ?? "0"
    let minBuy = body.minBuyAmount
    if (minBuy === undefined || minBuy === null || Number(minBuy) === 0) {
        minBuy = String(Math.floor((Number(expectedBuy) * (10000 - SLIPPAGE_BPS * 100)) / 10000))
    }
    if (!/^0x[a-fA-F0-9]{40}$/.test(to) || !/^0x[0-9a-fA-F]+$/.test(data) || Number(expectedBuy) === 0) {
        console.error("[0x] malformed payload", { to })
        return null
    }
    return { source: "0x-swap-api", to, data, value: Number(body.value ?? "0"), sellAmount: body.sellAmount ?? SELL_AMOUNT, expectedBuy, minBuy }
}

async function quoteKyber() {
    const routesUrl = `${KYBER_ROUTES}?tokenIn=${SELL_TOKEN}&tokenOut=${BUY_TOKEN}&amountIn=${SELL_AMOUNT}`
    const rr = await fetch(routesUrl)
    const rj = await rr.json().catch(() => null)
    const summary = rj?.data?.routeSummary
    if (rr.status !== 200 || !summary) {
        console.error("[kyber] routes failed:", rr.status)
        return null
    }
    // Far-future deadline so the pinned calldata cannot expire inside the fork.
    const buildBody = {
        routeSummary: summary,
        sender: TAKER,
        recipient: TAKER,
        slippageTolerance: SLIPPAGE_BPS,
        deadline: 4102444800, // 2100-01-01
        source: "eswap"
    }
    const br = await fetch(KYBER_BUILD, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildBody)
    })
    const bj = await br.json().catch(() => null)
    const d = bj?.data
    if (br.status !== 200 || !d?.data || !d?.routerAddress) {
        console.error("[kyber] build failed:", br.status, JSON.stringify(bj).slice(0, 300))
        return null
    }
    const to = d.routerAddress.toLowerCase()
    const data = d.data.startsWith("0x") ? d.data : "0x" + d.data
    const expectedBuy = d.amountOut
    const minBuy = d.amountOutMin && Number(d.amountOutMin) > 0
        ? String(d.amountOutMin)
        : String(Math.floor((Number(expectedBuy) * (10000 - SLIPPAGE_BPS * 100)) / 10000))
    if (!/^0x[a-fA-F0-9]{40}$/.test(to) || !/^0x[0-9a-fA-F]+$/.test(data) || Number(expectedBuy) === 0) {
        console.error("[kyber] malformed payload", { to })
        return null
    }
    return { source: "kyberswap-aggregator", to, data, value: Number(d.transactionValue ?? "0"), sellAmount: d.amountIn ?? SELL_AMOUNT, expectedBuy, minBuy }
}

async function main() {
    const env = loadEnv()
    const apiKey = (env.ZERO_X_API_KEY || process.env.ZERO_X_API_KEY || "").trim()

    const quote =
        (apiKey ? await quote0x(apiKey).catch((e) => { console.error("[0x] error:", e.message); return null; }) : null) ||
        (await quoteKyber().catch((e) => { console.error("[kyber] error:", e.message); return null; }))

    if (!quote) {
        const why = apiKey
            ? "0x quote failed and KyberSwap fallback failed"
            : "no ZERO_X_API_KEY (0x mainnet is key-gated) and KyberSwap fallback failed"
        return writeStub(why)
    }
    if (quote.value !== 0) {
        return writeStub(`${quote.source} route has a native ETH leg (value=${quote.value}) — unsupported by the accounting path`)
    }
    return writeFixture(quote)
}

main().catch((e) => {
    console.error(e)
    process.exit(1)
})