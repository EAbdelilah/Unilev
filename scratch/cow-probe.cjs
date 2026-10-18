// (2) off-chain probe: register the canonical lev-5 appData on the CoW Base
// order book, then request a real quote for the margin sell amount.
const { ethers } = require("ethers");
const API = "https://api.cow.fi/base/api/v1";
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const WETH = "0x4200000000000000000000000000000000000006";
const TRADER = "0x17D0EaBe1A1F5781B48aacf972098f2717ed62fF";

const J = async (u, o) => {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), 25000);
    try {
        const r = await fetch(u, { ...o, signal: c.signal });
        const x = await r.text();
        let b; try { b = JSON.parse(x); } catch { b = x.slice(0, 400); }
        return { status: r.status, ok: r.ok, body: b };
    } catch (e) { return { status: 0, ok: false, body: e.message }; }
    finally { clearTimeout(t); }
};

(async () => {
    const LEV = 5;
    const MARGIN = process.argv[2] || "40000"; // 0.04 USDC
    const fullAppData = `{"version":1,"appCode":"eswap","metadata":{"eswapLeverage":"${LEV}"}}`;
    const appData = ethers.keccak256(ethers.toUtf8Bytes(fullAppData));
    console.log(`appData(lev ${LEV}) = ${appData}`);

    const reg = await J(`${API}/app_data/${appData}`, {
        method: "PUT", headers: { "content-type": "application/json" },
        body: JSON.stringify({ fullAppData }),
    });
    console.log(`PUT  /app_data : ${reg.status} ${JSON.stringify(reg.body).slice(0, 300)}`);

    const get = await J(`${API}/app_data/${appData}`);
    console.log(`GET  /app_data : ${get.status} ${JSON.stringify(get.body).slice(0, 300)}`);

    const validTo = Math.floor(Date.now() / 1000) + 1800;
    const q = await J(`${API}/quote`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
            sellToken: USDC, buyToken: WETH, receiver: TRADER,
            sellAmountBeforeFee: MARGIN, validTo, appData,
            feeAmount: "0", kind: "sell", partiallyFillable: false,
            sellTokenBalance: "erc20", buyTokenBalance: "erc20",
            from: TRADER, signingScheme: "eip712",
        }),
    });
    console.log(`POST /quote    : ${q.status} ${JSON.stringify(q.body).slice(0, 500)}`);
})();
