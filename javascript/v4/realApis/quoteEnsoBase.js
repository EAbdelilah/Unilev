/**
 * javascript/v4/realApis/quoteEnsoBase.js
 *
 * Fetches a REAL Enso bundle (https://docs.enso.build) for BASE (8453) and writes
 * the executable payload to ensoBundle.json so it can be replayed on-chain by
 * EswapRouter.swapMultiPoolForAggregator:
 *
 *   URL/args: chainId=8453, fromAddress=<router>, receiver=<router>,
 *             routingStrategy=router, enso:route USDC -> WETH, amountIn=<notional>.
 *
 *   tx.to    -> AggregatorRoute.exchangeProxy (EnsoRouter V2 on Base)
 *   tx.data  -> AggregatorRoute.callData
 *
 * Usage:
 *   node javascript/v4/realApis/quoteEnsoBase.js [amountIn] [fromAddress] [slippageBps]
 * Requirements: ENSO_API_KEY in .env (or the environment).
 */
const fs = require("fs")
const path = require("path")

const CHAIN_ID = 8453
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
const WETH = "0x4200000000000000000000000000000000000006"
const DEFAULT_ROUTER = "0x57E75A87A62ab8Ff14C59FA10Ac2AB2c8cBD45D1"
const BUNDLE_URL = "https://api.enso.build/api/v1/shortcuts/bundle"
const OUT = path.join(__dirname, "ensoBundle.json")

function loadEnv() {
    const env = {}
    try {
        const raw = fs.readFileSync(path.join(__dirname, "../../../.env"), "utf8")
        for (const line of raw.split(/\r?\n/)) {
            const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
            if (m) env[m[1]] = m[2].trim()
        }
    } catch (_) {}
    return env
}

function normMap(map) {
    const out = {}
    if (!map) return out
    if (Array.isArray(map)) {
        for (const p of map) if (Array.isArray(p) && p.length >= 2) out[String(p[0]).toLowerCase()] = p[1]
    } else if (typeof map === "object") {
        for (const k of Object.keys(map)) out[String(k).toLowerCase()] = map[k]
    }
    return out
}

async function main() {
    const env = loadEnv()
    const apiKey = (process.env.ENSO_API_KEY || env.ENSO_API_KEY || "").trim()
    if (!apiKey) {
        console.error("missing ENSO_API_KEY")
        process.exit(1)
    }
    const amountIn = String(process.argv[2] || process.env.AMOUNT_IN || "60000")
    const from = String(process.argv[3] || process.env.FROM || DEFAULT_ROUTER)
    const slippage = String(process.argv[4] || process.env.SLIPPAGE_BPS || "30")

    const url = `${BUNDLE_URL}?chainId=${CHAIN_ID}&fromAddress=${from}&routingStrategy=router&receiver=${from}`
    const actions = [
        {
            protocol: "enso",
            action: "route",
            args: { tokenIn: USDC, tokenOut: WETH, amountIn, slippage, receiver: from },
        },
    ]
    const res = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(actions),
    })
    const text = await res.text()
    let body = null
    try {
        body = JSON.parse(text)
    } catch (_) {}

    if (res.status !== 200 || !body || !body.tx || !body.tx.to || !body.tx.data) {
        console.error("enso bundle failed:", res.status, text.slice(0, 500))
        process.exit(1)
    }

    const amountsOut = normMap(body.amountsOut)
    const minAmountsOut = normMap(body.minAmountsOut)
    const out = {
        source: "enso-bundle-base",
        chainId: CHAIN_ID,
        from,
        amountIn,
        slippageBps: Number(slippage),
        to: body.tx.to,
        value: String(body.tx.value ?? "0"),
        data: body.tx.data.startsWith("0x") ? body.tx.data : "0x" + body.tx.data,
        amountsOut,
        minAmountsOut,
        expectedBuy: amountsOut[WETH.toLowerCase()] ?? null,
        minBuy: minAmountsOut[WETH.toLowerCase()] ?? null,
    }
    fs.writeFileSync(OUT, JSON.stringify(out, null, 2))
    console.log(JSON.stringify(out, null, 2))
}

main().catch((e) => {
    console.error(e)
    process.exit(1)
})
