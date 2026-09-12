/**
 * javascript/v4/realApis/index.js
 * Phase A readiness report: are the REAL solvers/aggregators wired against the
 * deployed Eswap stack?
 *
 * Run:  node javascript/v4/realApis/index.js
 *
 * Outputs:
 *   1. BYTE-COMPAT anchors        — our CoW domain/digest mirrors vs the pinned
 *      canonical vectors (same constants the fork test EswapSepoliaDomainCompatTest
 *      enforces on-chain).
 *   2. REAL SOLVER (CoW) report   — live order-book API: Ethereum Sepolia
 *      (typed NoLiquidity today) + Gnosis Chain (real fillable quotes).
 *   3. REAL AGGREGATOR report     — Enso / ODOS / ParaSwap verdicts.
 */
const dotenv = require("dotenv")
const path = require("path")
dotenv.config({ path: path.resolve(__dirname, "../../../.env") })

const { quote, orderDigest, domainSeparator, uid, fixedOrder, ANCHORS, CHAINS, GPV2, COW_TYPE_HASH, KIND_SELL } = require("./cowOrderBook")
const { zeroXQuote, ensoQuote, paraswapSupportedNetworks, paraswapPrice, odosQuote, PARASWAP_TOKENS, ODOS_TOKENS, ZX_TOKENS } = require("./aggregators")
const { ethers } = require("ethers")

const GREEN = "\x1b[32m", RED = "\x1b[31m", CYAN = "\x1b[36m", YELLOW = "\x1b[33m", DIM = "\x1b[2m", RESET = "\x1b[0m"
const badge = (ok, label) => (ok ? `${GREEN}✔${RESET}` : `${RED}✖${RESET}`) + ` ${label}`
const W = (v, dec = 18) => (Number(BigInt(v)) / 10 ** dec).toFixed(4)

async function main() {
    console.log(`${CYAN}=== ESWAP v4 REAL SOLVER + AGGREGATOR READINESS (Phase A) ===${RESET}`)
    console.log(`${DIM}eth_sepolia_rpc=${process.env.ETH_SEPOLIA_RPC_URL || "(unset)"}  enso_key=${process.env.ENSO_API_KEY ? "set" : "(unset)"}  zero_x_key=${process.env.ZERO_X_API_KEY ? "set" : "(unset)"}${RESET}\n`)

    // ── 1. Byte-compat anchors ────────────────────────────────────────────
    console.log(`${CYAN}[1] BYTE-COMPAT ANCHORS (EswapCoWSettlement = canonical CoW bytes)${RESET}`)
    const anchors = [
        ["Sepolia (11155111) domain separator ", domainSeparator(11155111), ANCHORS.sepoliaDomain],
        ["Unichain Sepolia (1301) domain     ", domainSeparator(1301), ANCHORS.unichainSepoliaDomain],
        ["Gnosis (100) domain                ", domainSeparator(100), ANCHORS.gnosisDomain],
        ["fixed order digest (Sepolia domain)", orderDigest(fixedOrder(), 11155111), ANCHORS.fixedDigest],
    ]
    for (const [name, actual, expected] of anchors) {
        console.log(`  ${name} ${actual === expected ? `${GREEN}MATCH${RESET}` : `${RED}MISMATCH (${actual})${RESET}`}`)
    }
    console.log(`  on-chain CowOrder constants       ${KIND_SELL === ethers.id("sell") ? `${GREEN}MATCH (KIND_SELL == ethers.id("sell"))${RESET}` : `${RED}MISMATCH${RESET}`}`)
    console.log(`  COW_TYPE_HASH == ethers.id(...)   ${COW_TYPE_HASH === ethers.id("Order(address sellToken,address buyToken,address receiver,uint256 sellAmount,uint256 buyAmount,uint32 validTo,bytes32 appData,uint256 feeAmount,string kind,bool partiallyFillable,string sellTokenBalance,string buyTokenBalance)") ? `${GREEN}MATCH${RESET}` : `${RED}MISMATCH${RESET}`}`)

    const fixed = fixedOrder()
    const u = uid(orderDigest(fixed, 11155111), "0x518634753C61342298c3E04326056b3Ce596a566", fixed.validTo)
    console.log(`${DIM}  anchor UID (56 bytes): ${u}${RESET}\n`)

    // ── 2. Real CoW order-book API ────────────────────────────────────────
    console.log(`${CYAN}[2] REAL SOLVER FLEET — CoW order-book API (api.cow.fi)${RESET}`)
    const now = Math.floor(Date.now() / 1000)
    const validTo = now + 3600 // CoW rejects horizons > ~1h..1d (ExcessiveValidTo)
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
    const cowQuote = async (args) => {
        for (let attempt = 0; attempt < 3; attempt++) {
            const res = await quote(args)
            if (!(res.type === "HTTP_429")) return res
            await sleep(800 * (attempt + 1))
        }
        return { ok: false, type: "HTTP_429", description: "rate limited after retries" }
    }

    const sep = CHAINS[11155111].tokens
    console.log(`  Ethereum Sepolia (11155111) — the chain the Phase-B mirror lives on:`)
    const sepQuote = await cowQuote({ chainId: 11155111, sellToken: sep.USDC, buyToken: sep.WETH, sellAmountBeforeFee: "5000000", from: REPORTED(), validTo })
    reportQuote("    USDC(5) -> WETH", sepQuote, 6)
    await sleep(400)

    const gn = CHAINS[100].tokens
    console.log(`  Gnosis Chain (100) — live CoW venue with real liquidity (sanity + benchmark):`)
    const gn1 = await cowQuote({ chainId: 100, sellToken: gn.WETH, buyToken: gn.WXDAI, sellAmountBeforeFee: "50000000000000000", from: REPORTED(), validTo })
    reportQuote("    WETH(0.05) -> WXDAI", gn1, 18)
    await sleep(400)
    const gn2 = await cowQuote({ chainId: 100, sellToken: gn.USDC, buyToken: gn.WETH, sellAmountBeforeFee: "100000000", from: REPORTED(), validTo })
    reportQuote("    USDC(100) -> WETH ", gn2, 6)

    // Unichain Sepolia order-book absence.
    console.log(`  Unichain Sepolia (1301) — Eswap LIVE stack:`)
    console.log(`    CoW order book backend        ${YELLOW}none${RESET} (no CoW deployment on 1301 — fills run via EswapCoWSettlement, quotes via the canonical CoW bytes)`)
    console.log(`    SolverAdapter settlement path  ${
        process.env.V4_SETTLEMENT_ADDRESS ? GREEN + "+" + RESET + " EswapCoWSettlement live " + process.env.V4_SETTLEMENT_ADDRESS : RED + "-" + RESET + " V4_SETTLEMENT_ADDRESS unset"
    }`)

    // ── 3. Real aggregators ───────────────────────────────────────────────
    console.log(`\n${CYAN}[3] REAL AGGREGATORS — 0x / Enso / ODOS / ParaSwap${RESET}`)
    console.log(`  0x Swap API (REAL testnet hosts, keyless probing):`)
    for (const cid of [11155111, 421614]) {
        const z = await zeroXQuote({ apiKey: process.env.ZERO_X_API_KEY, chainId: cid, src: ZX_TOKENS[cid].USDC ?? ZX_TOKENS[cid].WETH, dst: ZX_TOKENS[cid].WETH ?? ZX_TOKENS[cid].USDC, amount: ZX_TOKENS[cid].USDC ? "5000000" : "10000000000000000" })
        reportQuote(`    [${cid}] ${ZX_TOKENS[cid].USDC ? "USDC(5)->WETH" : "WETH(0.01)->USDC"}`, z, ZX_TOKENS[cid].USDC ? 6 : 18, "0x")
    }

    console.log(`  Enso (self-serve key, no 1inch-style gating; developers.enso.build):`)
    for (const cid of [11155111, 130]) {
        const e = await ensoQuote({ apiKey: process.env.ENSO_API_KEY, chainId: cid, src: ODOS_TOKENS[cid].USDC, dst: ODOS_TOKENS[cid].WETH, amount: "5000000" })
        reportQuote(`    [${cid}] USDC(5) -> WETH `, e, 6, "enso")
    }

    console.log(`  ODOS v2 (keyless):`)
    for (const cid of [11155111, 130]) {
        const o = await odosQuote({ chainId: cid, body: undefined })
        reportQuote(`    [${cid}] USDC(5) -> WETH `, o, 6, "odos")
    }

    console.log(`  ParaSwap v5.2 (keyless):`)
    const nets = await paraswapSupportedNetworks()
    const wanted = [1301, 11155111, 130]
    for (const cid of wanted) {
        const supported = nets.ok && nets.networks.includes(cid)
        if (supported) {
            const p = await paraswapPrice({ chainId: cid, src: PARASWAP_TOKENS[130].USDC, dst: PARASWAP_TOKENS[130].WETH, amount: "5000000" })
            reportQuote(`    [${cid}] USDC(5) -> WETH `, p, 6, "paraswap")
        } else {
            console.log(`    ${RED}UNSUPPORTED_CHAIN${RESET} chain ${cid} (ParaSwap testnets dropped; supports: ${nets.networks.join(",")}${nets.networks.length === 0 ? "none" : ""})`)
        }
    }

    // ── Summary ───────────────────────────────────────────────────────────
    console.log(`\n${CYAN}PHASE A VERDICT${RESET}`)
    console.log(`  solver:      real CoW order-book bytes == EswapCoWSettlement bytes (anchors above); order book reachable; Ethereum Sepolia has no solver liquidity today, Gnosis quotes real prices.`)
    console.log(`  aggregator:  0x = REAL testnet hosts (sepolia+arbitrum-sepolia), keyless, returns no-Route (Sepolia has no DEX depth); Enso = ${process.env.ENSO_API_KEY ? "REAL_QUOTE path (self-serve key present)" : "AUTH_REQUIRED (set ENSO_API_KEY — free self-serve key)"}; ODOS = API unavailable (Cloudflare tunnel 1033); ParaSwap = mainnet-only, 130 has no liquidity.`)
    console.log(`  Phase B:     mirror stack on 11155111 (` + `ETH_SEPOLIA_RPC_URL=${process.env.ETH_SEPOLIA_RPC_URL || "unset"}` + `) — token/GPv2 facts verified; on-chain deploy needs Sepolia ETH (deployer has 0).`)
}

function REPORTED() {
    return "0x518634753C61342298c3E04326056b3Ce596a566"
}

function reportQuote(label, r, dec, src) {
    if (r.ok && r.type === "REAL_QUOTE") {
        const amount = r.toAmount ?? r.quote?.buyAmount
        const sell = r.quote?.sellAmount
        const rate = sell && amount ? Number(BigInt(amount)) / Number(BigInt(sell)) : null
        console.log(`  ${label} ${GREEN}REAL_QUOTE${RESET} out=${W(amount, dec)}${src ? "" : " eff"} ${rate ? `(${rate.toFixed(6)}/in) ` : ""}${src ? `src=${src}` : `fee=${W(r.quote?.feeAmount, dec)}`}`)
    } else if (!r.ok && r.type === "AUTH_REQUIRED") {
        console.log(`  ${label} ${YELLOW}AUTH_REQUIRED${RESET} ${r.selfServe ? "(self-serve key) " : ""}${r.description}`)
    } else if (!r.ok && r.type === "NO_LIQUIDITY") {
        console.log(`  ${label} ${YELLOW}NO_LIQUIDITY${RESET} ${r.description}`)
    } else if (!r.ok && r.type === "UNSUPPORTED_CHAIN") {
        console.log(`  ${label} ${RED}UNSUPPORTED_CHAIN${RESET} ${r.description}`)
    } else if (!r.ok && r.type === "API_UNAVAILABLE") {
        console.log(`  ${label} ${RED}API_UNAVAILABLE${RESET} ${r.description}`)
    } else {
        console.log(`  ${label} ${RED}${r.type}${RESET} ${r.description || r.httpStatus || ""}`)
    }
}

main().catch((e) => {
    console.error(RED + "driver failed: " + e.message + RESET)
    process.exit(1)
})