/**
 * javascript/v4/realApis/aggregators.js
 * Real aggregator API integration probes for the Phase A readiness report.
 *
 *   - 0x       `https://{network}.api.0x.org/swap/v1/quote`  (testnet hosts live;
 *              keyless probing works, ZERO_X_API_KEY optional / self-serve)
 *   - Enso     `/api/v1/shortcuts/route|quote`   (self-serve key: developers.enso.build)
 *   - ODOS     `/api/v2/quote`                    (keyless; chain support probe)
 *   - ParaSwap `/prices` (v5.2)                   (keyless; testnets dropped)
 *
 * Every probe maps its real HTTP response to a normalized verdict:
 *   REAL_QUOTE / NO_LIQUIDITY / UNSUPPORTED_CHAIN / AUTH_REQUIRED / API_UNAVAILABLE / HTTP_xxx / API_UNREACHABLE
 */
const path = require("path")

const PARASWAP_TOKENS = {
    130: { USDC: "0x31d0220469e10c4E71834a79b1f276d740d3768F", WETH: "0x4200000000000000000000000000000000000006" },
}
const ODOS_TOKENS = {
    11155111: { USDC: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238", WETH: "0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9" },
    130: { USDC: "0x31d0220469e10c4E71834a79b1f276d740d3768F", WETH: "0x4200000000000000000000000000000000000006" },
}
const ENSO_TOKENS = ODOS_TOKENS
const ZX_TOKENS = {
    11155111: { USDC: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238", WETH: "0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9", DAI: "0xff34B3D4aee8dd8cFA37E242F55C8F4a9bDF45F6" },
    421614: { WETH: "0x980B62Da83eFf3D4576C647993b0c1D7faf17c73", USDC: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d" },
}
const ZX_HOSTS = { 11155111: "https://sepolia.api.0x.org", 421614: "https://arbitrum-sepolia.api.0x.org" }

const REPORTING_ADDR = "0x518634753C61342298c3E04326056b3Ce596a566"

async function getJson(url, opts = {}) {
    const ctl = new AbortController()
    const t = setTimeout(() => ctl.abort(), 30000)
    try {
        const res = await fetch(url, { ...opts, signal: ctl.signal })
        const text = await res.text()
        let body = null
        try { body = JSON.parse(text) } catch (_) { /* non-json */ }
        return { status: res.status, body, text }
    } catch (e) {
        return { status: 0, body: null, text: "", error: e.message }
    } finally {
        clearTimeout(t)
    }
}

/** 0x Swap API v1 — REAL testnet hosts (sepolia.api.0x.org, arbitrum-sepolia...).
 *  Keyless probing works (self-serve key optional via ZERO_X_API_KEY). */
async function zeroXQuote({ apiKey, chainId, src, dst, amount, slippageBps }) {
    const host = ZX_HOSTS[chainId]
    if (!host) return { ok: false, type: "UNSUPPORTED_CHAIN", description: `chain ${chainId} has no 0x testnet host (sepolia + arbitrum-sepolia only)` }
    const url = `${host}/swap/v1/quote?sellToken=${src}&buyToken=${dst}&sellAmount=${amount}&buyer=${REPORTING_ADDR}&slippageBps=${slippageBps ?? 50}`
    const headers = {}
    if (apiKey) headers["0x-api-key"] = apiKey
    const r = await getJson(url, { headers })
    if (r.status === 0) return { ok: false, type: "API_UNREACHABLE", description: r.error }
    if (r.status === 200 && r.body?.sellAmount && r.body?.buyAmount) {
        return { ok: true, type: "REAL_QUOTE", toAmount: r.body.buyAmount, toTokenDecimals: r.body.buyTokenDecimals, estimatedGas: r.body.estimatedGas, chainId, via: "swap/v1" }
    }
    if (r.status === 404 && /no Route matched/i.test(r.body?.message ?? "")) {
        return { ok: false, type: "NO_LIQUIDITY", description: r.body.message, chainId }
    }
    if (r.status === 401 || r.status === 403) return { ok: false, type: "AUTH_REQUIRED", selfServe: true, description: r.body?.message ?? "0x API key required" }
    return { ok: false, type: "HTTP_" + r.status, description: (r.text || JSON.stringify(r.body ?? {})).slice(0, 200), chainId }
}

/** Enso: permissionless, self-serve key (no 1inch-style application/vetting).
 *  GET /shortcuts/quote first, fall back to POST /shortcuts/route. */
async function ensoQuote({ apiKey, chainId, src, dst, amount }) {
    if (!apiKey) {
        return { ok: false, type: "AUTH_REQUIRED", selfServe: true, description: "ENSO_API_KEY not set in .env (free self-serve key: https://developers.enso.build)" }
    }
    const urlq = `https://api.enso.finance/api/v1/shortcuts/quote?chainId=${chainId}&fromAddress=${REPORTING_ADDR}&amountIn=${amount}&tokenIn=${src}&tokenOut=${dst}&routingStrategy=router`
    let r = await getJson(urlq, { headers: { authorization: `Bearer ${apiKey}`, accept: "application/json" } })
    if (r.status === 200 && (r.body?.outputAmount || r.body?.quote)) {
        return { ok: true, type: "REAL_QUOTE", toAmount: r.body.outputAmount ?? r.body.quote.outputAmount, chainId, via: "quote" }
    }
    const urlr = "https://api.enso.finance/api/v1/shortcuts/route"
    const payload = {
        chainId, fromAddress: REPORTING_ADDR, receiver: REPORTING_ADDR, routingStrategy: "router",
        tokenIn: [src], tokenOut: [dst], amountIn: [String(amount)], slippage: "50",
    }
    r = await getJson(urlr, { method: "POST", headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(payload) })
    if (r.status === 200 && r.body?.route) {
        const out = r.body.route.outputAmount ?? r.body.route.minAmountOut ?? r.body.outputAmount
        return { ok: true, type: "REAL_QUOTE", toAmount: out, tx: r.body.tx, chainId, via: "route" }
    }
    if (r.status === 403) return { ok: false, type: "AUTH_REQUIRED", selfServe: true, description: r.body?.message ?? "403 — invalid ENSO_API_KEY" }
    if (r.status === 400 || r.status === 404) return { ok: false, type: "NO_LIQUIDITY", description: r.body?.message ?? r.text?.slice(0, 200), chainId }
    return { ok: false, type: "HTTP_" + r.status, description: (r.text || JSON.stringify(r.body ?? {})).slice(0, 200), chainId }
}

/** ParaSwap v5.2 supported networks. The /networks probe 400s with the list
 *  embedded in the error text, so we parse it from the real response. */
async function paraswapSupportedNetworks() {
    const r = await getJson("https://apiv5.paraswap.io/networks")
    if (r.status !== 400) return { ok: r.status === 200, networks: [] }
    const m = (r.body?.error || r.text || "").match(/Supported chains:\s*(.+)$/)
    if (!m) return { ok: false, networks: [] }
    const networks = m[1].match(/\d+/g).map(Number)
    return { ok: true, networks }
}

async function paraswapPrice({ chainId, src, dst, amount }) {
    const url = `https://apiv5.paraswap.io/prices?srcToken=${src}&destToken=${dst}&amount=${amount}&srcDecimals=6&destDecimals=18&side=SELL&network=${chainId}`
    const r = await getJson(url)
    if (r.status === 0) return { ok: false, type: "API_UNREACHABLE", description: r.error }
    if (r.status === 200 && r.body?.priceRoute) {
        return { ok: true, type: "REAL_QUOTE", toAmount: r.body.priceRoute.destAmount, chainId }
    }
    if (r.status === 400 || r.status === 404) return { ok: false, type: "NO_LIQUIDITY", description: r.body?.error || JSON.stringify(r.body)?.slice(0, 200), chainId }
    return { ok: false, type: "HTTP_" + r.status, description: JSON.stringify(r.body ?? {})?.slice(0, 200), chainId }
}

/** ODOS v2 quote. The live endpoint currently returns a Cloudflare Tunnel 530
 *  (error 1033) — an infrastructure signal, reported as API_UNAVAILABLE. */
async function odosQuote({ chainId, body }) {
    const payload = body ?? {
        chainId,
        inputTokens: [{ tokenAddress: ODOS_TOKENS[chainId].USDC, amount: "5000000" }],
        outputTokens: [{ tokenAddress: ODOS_TOKENS[chainId].WETH, proportion: 1 }],
        userAddr: REPORTING_ADDR,
        slippageLimitPercent: 0.5,
    }
    const r = await getJson("https://api.odos.xyz/api/v2/quote", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) })
    if (r.status === 0) return { ok: false, type: "API_UNREACHABLE", description: r.error }
    if (r.status === 200 && r.body?.pathId) {
        return { ok: true, type: "REAL_QUOTE", toAmount: r.body.outAmounts?.[0], pathId: r.body.pathId, chainId }
    }
    if (/errorCode.?[:\s]*1033/.test(r.text) || /cloudflare tunnel/i.test(r.text)) {
        return { ok: false, type: "API_UNAVAILABLE", description: "530 error 1033 (ODOS Cloudflare tunnel down at probe time)", chainId }
    }
    return { ok: false, type: "HTTP_" + r.status, description: (r.text || JSON.stringify(r.body ?? {})).slice(0, 200), chainId }
}

module.exports = { zeroXQuote, ensoQuote, paraswapSupportedNetworks, paraswapPrice, odosQuote, PARASWAP_TOKENS, ODOS_TOKENS, ENSO_TOKENS, ZX_TOKENS, ZX_HOSTS }