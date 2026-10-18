// Public-infra recon for gaps 1/2/3: which external rails are reachable?
require("dotenv").config();
const { ethers } = require("ethers");
const J = async (url, opts) => {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), 20000);
    try {
        const r = await fetch(url, { ...opts, signal: c.signal });
        const txt = await r.text();
        let body; try { body = JSON.parse(txt); } catch { body = txt.slice(0, 200); }
        return { status: r.status, ok: r.ok, body };
    } catch (e) { return { status: 0, ok: false, body: e.message }; }
    finally { clearTimeout(t); }
};
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const WETH = "0x4200000000000000000000000000000000000006";

(async () => {
    console.log("=== public-infra recon ===\n");

    // 1. CoW orderbook per chain
    for (const [cid, host] of [[8453, "base"], [100, "xdai"], [1, "mainnet"], [11155111, "sepolia"]]) {
        const v = await J(`https://api.cow.fi/${host}/api/v1/about/version`);
        console.log(`CoW ${host} (${cid}) version: ${v.status} ${JSON.stringify(v.body).slice(0, 120)}`);
    }

    // 2. CoW Base USDC->WETH quote
    const now = Math.floor(Date.now() / 1000);
    const q = await J("https://api.cow.fi/base/api/v1/quote", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
            sellToken: USDC, buyToken: WETH, receiver: null,
            sellAmountBeforeFee: "30000", validTo: now + 1800,
            appData: "0x" + "00".repeat(32), feeAmount: "0", kind: "sell",
            partiallyFillable: false, sellTokenBalance: "erc20", buyTokenBalance: "erc20",
            from: "0x17D0EaBe1A1F5781B48aacf972098f2717ed62fF", signingScheme: "eip712",
        }),
    });
    console.log(`\nCoW Base quote (30000 USDC->WETH): ${q.status} ${JSON.stringify(q.body).slice(0, 300)}`);

    // 3. 4337 bundler reachability (eth_supportedEntryPoints)
    const bundlers = [
        ["pimlico-public", "https://public.pimlico.io/v2/8453/rpc"],
        ["pimlico", "https://api.pimlico.io/v2/8453/rpc"],
        ["stackup", "https://api.stackup.sh/v1/node/8453"],
        ["alchemy", "https://api.alchemy.com/v2/8453"],
        ["eth-infinitism", "https://bundler.ethereum.org"],
    ];
    console.log("\n4337 bundler probes (eth_supportedEntryPoints):");
    for (const [name, url] of bundlers) {
        const r = await J(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_supportedEntryPoints", params: [] }) });
        console.log(`  ${name}: ${r.status} ${JSON.stringify(r.body).slice(0, 150)}`);
    }

    // 4. keyless aggregators
    console.log("\naggregator probes:");
    const odos = await J("https://api.odos.xyz/sor/quote/v2", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chainId: 8453, inputTokens: [{ tokenAddress: USDC, amount: "30000" }], outputTokens: [{ tokenAddress: WETH, proportion: 1 }], userAddr: "0x17D0EaBe1A1F5781B48aacf972098f2717ed62fF" }) });
    console.log(`  odos base: ${odos.status} ${JSON.stringify(odos.body).slice(0, 200)}`);
})().catch((e) => { console.error(e); process.exit(1); });
