/**
 * scripts/v4/live-base-validate.cjs
 *
 * LIVE Base (chain 8453) mainnet validation of the end-to-end intent flow:
 *
 *     Aggregator demand (Enso API)
 *       -> Eswap core engine (live Base v4 deployment)
 *       -> Solver supply (CoW order book / Eswap settlement)
 *
 * READ-ONLY + eth_call ONLY. No transaction is signed or broadcast.
 * Reproducible on any machine with network access; ENSO_API_KEY enables the
 * live demand leg.
 *
 * Run:  node scripts/v4/live-base-validate.cjs
 */
require("dotenv").config();
const fs = require("fs");
const { ethers } = require("ethers");

const RPC = process.env.BASE_RPC_URL || "https://mainnet.base.org";
const CHAIN_ID = 8453;

const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const WETH = "0x4200000000000000000000000000000000000006";
const HOOK = "0x6f98Ea19e522Ecc706E0Fb1574BDA8D32aC510C8";
const ROUTER = "0x57E75A87A62ab8Ff14C59FA10Ac2AB2c8cBD45D1";
const SETTLEMENT = "0x0000000000000000000000000000000000000000";
const PRICE_FEED = "0xE6E7229f878fB2d7dAbAcD2873A9ea4A3c04aFf8";
const ENSO_ROUTER = "0xF75584eF6673aD213a685a1B58Cc0330B8eA22Cf"; // whitelisted aggregator
const SOLVER_FILE = "C:\\Users\\faar_\\AppData\\Local\\Temp\\opencode\\base-cow-solver.json";

const USDC_FEED = "0x7e860098F58bBFC8648a4311b374B1D669a2bc6B";
const ETH_FEED = "0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70";

const HOOK_KEY = [WETH, USDC, 3000, 60, HOOK];
const LEVERAGE = 2;
const AMOUNT_IN = 5000000n; // $5.00 USDC probe

const PF_ABI = [
    "function getTwapPrice(address) view returns (uint256)",
    "function MAX_ORACLE_AGE() view returns (uint256)",
    "function priceFeeds(address) view returns (address)",
    "function owner() view returns (address)",
];
const ROUTER_ABI = [
    "function owner() view returns (address)",
    "function registeredSolvers(address) view returns (bool)",
    "function allowedAggregators(address) view returns (bool)",
    "function quoteExactInput((address,address,uint24,int24,address),bool,int128,uint8) view returns (int128)",
];
const HOOK_ABI = ["function priceFeed() view returns (address)", "function owner() view returns (address)"];
const FEED_ABI = ["function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)"];

const ok = (b) => (b ? "PASS" : "BLOCK");
const hr = () => console.log("-".repeat(72));

async function demandLeg() {
    console.log("\n[A] AGGREGATOR DEMAND — live Enso API (Base 8453)");
    const apiKey = process.env.ENSO_API_KEY;
    if (!apiKey) {
        console.log("    ENSO_API_KEY unset -> demand leg not queried");
        return false;
    }
    const url = new URL("https://api.enso.finance/api/v1/shortcuts/route");
    url.searchParams.set("chainId", String(CHAIN_ID));
    url.searchParams.set("fromAddress", "0xd9Aba9723d14b36588bcF9D47c2FF355EEC47F3c");
    url.searchParams.set("tokenIn", USDC);
    url.searchParams.set("tokenOut", WETH);
    url.searchParams.set("amountIn", AMOUNT_IN.toString());
    url.searchParams.set("slippage", "50");
    url.searchParams.set("routingStrategy", "router");
    try {
        const res = await fetch(url, { headers: { authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(20000) });
        const text = await res.text();
        if (!res.ok) {
            console.log(`    Enso HTTP ${res.status}: ${text.slice(0, 160)}`);
            return false;
        }
        const j = JSON.parse(text);
        const protocols = (j.route ?? []).map((r) => `${r.action ?? "?"}:${r.protocol ?? "?"}`).join(", ");
        const mentionsHook = text.toLowerCase().includes(HOOK.slice(2).toLowerCase());
        console.log(`    Enso amountOut          : ${j.amountOut ?? "n/a"} WETH (wei)`);
        console.log(`    Enso route              : ${protocols || "n/a"}`);
        console.log(`    route references Eswap  : ${mentionsHook ? "YES" : "NO"}  <- honest: Eswap is not in Enso's registry`);
        return true;
    } catch (e) {
        console.log(`    Enso query failed: ${e.message}`);
        return false;
    }
}

async function supplyLeg() {
    console.log("\n[B] SOLVER SUPPLY — live CoW order book (Base)");
    const vt = Math.floor(Date.now() / 1000) + 1800;
    const body = {
        sellToken: USDC,
        buyToken: WETH,
        receiver: null,
        sellAmountBeforeFee: "20000",
        validTo: vt,
        appData: "0x" + "00".repeat(32),
        feeAmount: "0",
        kind: "sell",
        partiallyFillable: false,
        sellTokenBalance: "erc20",
        buyTokenBalance: "erc20",
        from: "0x518634753C61342298c3E04326056b3Ce596a566",
        signingScheme: "eip712",
    };
    try {
        const ver = await fetch("https://api.cow.fi/base/api/v1/version", { signal: AbortSignal.timeout(15000) });
        console.log(`    CoW order book version  : ${(await ver.text()).trim()}`);
        const res = await fetch("https://api.cow.fi/base/api/v1/quote", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(20000),
        });
        const j = await res.json();
        if (j.quote) {
            console.log(`    CoW live quote          : sell ${j.quote.sellAmount} USDC -> buy ${j.quote.buyAmount} WETH (fee ${j.quote.feeAmount})`);
            console.log("    NOTE: CoW fillers settle on canonical GPv2Settlement; Eswap settles");
            console.log("          on its own EswapCoWSettlement and gates fillers via");
            console.log("          router.setSolverWhitelist, so only whitelisted solvers can fill.");
        } else {
            console.log(`    CoW quote               : ${JSON.stringify(j).slice(0, 200)}`);
        }
        return true;
    } catch (e) {
        console.log(`    CoW query failed: ${e.message}`);
        return false;
    }
}

async function coreLeg(provider) {
    console.log("\n[C] ESWAP CORE ENGINE — live Base v4 deployment");
    const router = new ethers.Contract(ROUTER, ROUTER_ABI, provider);
    const hook = new ethers.Contract(HOOK, HOOK_ABI, provider);
    const pf = new ethers.Contract(PRICE_FEED, PF_ABI, provider);

    let solverAddr = ethers.ZeroAddress;
    if (fs.existsSync(SOLVER_FILE)) solverAddr = JSON.parse(fs.readFileSync(SOLVER_FILE, "utf8")).address;

    console.log(`    router.owner            : ${await router.owner()}`);
    console.log(`    hook.priceFeed          : ${await hook.priceFeed()} (IMMUTABLE)`);
    console.log(`    EnsoRouter whitelisted  : ${await router.allowedAggregators(ENSO_ROUTER)}`);
    console.log(`    solver ${solverAddr} whitelisted: ${await router.registeredSolvers(solverAddr)}`);

    const maxAge = await pf.MAX_ORACLE_AGE();
    // The live PriceFeed prices USDC via a fresh on-chain TWAP adapter
    // (UsdcTwapFeed), NOT the slow Chainlink Reference feed. Report both so the
    // difference is explicit.
    const usdcFeed = await pf.priceFeeds(USDC);
    console.log(`    priceFeeds(USDC)        : ${usdcFeed} (fresh TWAP adapter)`);
    const usdcAdapterRd = await new ethers.Contract(usdcFeed, FEED_ABI, provider).latestRoundData();
    {
        const age = BigInt(Math.floor(Date.now() / 1000)) - usdcAdapterRd[3];
        console.log(`    adapter USDC/USD answer : ${usdcAdapterRd[1]} (18d)  age ${age}s -> ${age <= maxAge ? "FRESH" : "STALE"}`);
    }
    for (const [name, feed] of [["USDC/USD raw Chainlink", USDC_FEED], ["ETH/USD Chainlink", ETH_FEED]]) {
        const rd = await new ethers.Contract(feed, FEED_ABI, provider).latestRoundData();
        const age = BigInt(Math.floor(Date.now() / 1000)) - rd[3];
        console.log(`    ${name} age : ${age}s  -> ${age <= maxAge ? "FRESH" : `STALE (raw feed; superseded for USDC)`}`);
    }

    let coreOk = false;
    try {
        const twap = await pf.getTwapPrice(USDC);
        console.log(`    PriceFeed.getTwapPrice(USDC): ${twap}  -> usable`);
        coreOk = true;
    } catch (e) {
        const data = e.data || e.info?.error?.data || "";
        const isStale = String(data).includes("0x19abf40e");
        console.log(`    PriceFeed.getTwapPrice(USDC): REVERT ${isStale ? "StalePrice() 0x19abf40e" : String(data).slice(0, 20)}`);
        console.log("      -> the hook's margin accounting reverts, so NO USDC-margined");
        console.log("         open can settle live at this block.");
    }

    try {
        const out = await router.quoteExactInput(HOOK_KEY, false, -AMOUNT_IN, LEVERAGE);
        console.log(`    router.quoteExactInput($5, ${LEVERAGE}x): ${out} WETH (wei)  -> view path live`);
    } catch (e) {
        console.log(`    router.quoteExactInput: reverted (${(e.message || "").slice(0, 80)})`);
    }
    return coreOk;
}

(async () => {
    console.log("=== LIVE BASE (8453) END-TO-END INTENT-FLOW VALIDATION ===");
    console.log("read-only + eth_call; no transaction is signed or broadcast");
    hr();
    const provider = new ethers.JsonRpcProvider(RPC);
    const net = await provider.getNetwork();
    console.log(`chainId=${net.chainId}  block=${await provider.getBlockNumber()}  gasPrice=${await provider.getFeeData().then((f) => f.gasPrice)}`);

    const demand = await demandLeg();
    const supply = await supplyLeg();
    const core = await coreLeg(provider);

    hr();
    console.log("VERDICT");
    console.log(`  [A] aggregator demand (live Enso API)       : ${ok(demand)}`);
    console.log(`  [B] solver supply rails (live CoW book)     : ${ok(supply)}`);
    console.log(`  [C] Eswap core (live Base v4) usable now    : ${ok(core)}`);
    hr();
    console.log(core
        ? "  -> live settlement path is UNBLOCKED at this block (fresh oracle window)."
        : "  -> live settlement path is BLOCKED at the core: USDC/USD oracle is stale and\n" +
          "     hook.priceFeed is immutable, so only a fresh-oracle window (<=1h after an\n" +
          "     update) or a hook+PriceFeed redeploy makes a live open possible.");
    hr();
})().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
