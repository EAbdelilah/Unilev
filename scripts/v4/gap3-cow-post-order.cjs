// GAP-3: drive the live CoW Base orderbook with a REAL Eswap order.
// Off-chain (no gas). Shows:
//   1. on-chain leverageCommitment(2) has NO CoW appData pre-image (the blocker)
//   2. a leverage-ENCODING fullAppData JSON that CoW WILL register
//   3. the orderbook accepts + indexes a real order signed by the external trader
const fs = require("fs");
const os = require("os");
const path = require("path");
const { ethers } = require("ethers");

const RPC = process.env.BASE_RPC_URL || "https://mainnet.base.org";
const CHAIN_ID = 8453;
const API = "https://api.cow.fi/base/api/v1";
const GPV2 = "0x9008D19f58AAbD9eD0D60971565AA8510560ab41";
const USDC = ethers.getAddress("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
const WETH = ethers.getAddress("0x4200000000000000000000000000000000000006");
const SETTLEMENT = "0xD2e8b474d6faB4d879Fe4621192B018B35B79488";

const ORDER_TYPES = {
    Order: [
        { name: "sellToken", type: "address" }, { name: "buyToken", type: "address" },
        { name: "receiver", type: "address" }, { name: "sellAmount", type: "uint256" },
        { name: "buyAmount", type: "uint256" }, { name: "validTo", type: "uint32" },
        { name: "appData", type: "bytes32" }, { name: "feeAmount", type: "uint256" },
        { name: "kind", type: "string" }, { name: "partiallyFillable", type: "bool" },
        { name: "sellTokenBalance", type: "string" }, { name: "buyTokenBalance", type: "string" },
    ],
};
const domain = { name: "Gnosis Protocol", version: "v2", chainId: CHAIN_ID, verifyingContract: GPV2 };

const J = async (url, opts) => {
    const c = new AbortController(); const t = setTimeout(() => c.abort(), 25000);
    try {
        const r = await fetch(url, { ...opts, signal: c.signal });
        const txt = await r.text();
        let body; try { body = JSON.parse(txt); } catch { body = txt.slice(0, 300); }
        return { status: r.status, ok: r.ok, body };
    } catch (e) { return { status: 0, ok: false, body: e.message }; }
    finally { clearTimeout(t); }
};

(async () => {
    const provider = new ethers.JsonRpcProvider(RPC);
    const trader = new ethers.Wallet(JSON.parse(fs.readFileSync(path.join(os.tmpdir(), "eswap-ext-trader2.json"), "utf8")).privateKey, provider);
    const settlement = new ethers.Contract(SETTLEMENT, ["function leverageCommitment(uint8) view returns (bytes32)"], provider);
    const levComm = await settlement.leverageCommitment(2);

    const LEV = 2;
    const fullAppData = `{"version":1,"appCode":"eswap","metadata":{"eswapLeverage":"${LEV}"}}`;
    const appData = ethers.keccak256(ethers.toUtf8Bytes(fullAppData));
    console.log(`trader2                 = ${trader.address}`);
    console.log(`on-chain levComm(2)     = ${levComm}`);
    console.log(`CoW-registerable appData= ${appData}  (keccak256 of fullAppData)`);
    console.log(`=> identical? ${levComm.toLowerCase() === appData.toLowerCase()}  (THIS is the gap-3 blocker)`);
    console.log(`   fullAppData = ${fullAppData}`);

    // 1. register the pre-image on the live CoW orderbook
    const reg = await J(`${API}/app_data/${appData}`, {
        method: "PUT", headers: { "content-type": "application/json" },
        body: JSON.stringify({ fullAppData }),
    });
    console.log(`\nPUT /app_data/{hash}: ${reg.status} ${JSON.stringify(reg.body).slice(0, 200)}`);

    // 1b. CoW VaultRelayer must be approved by the order owner to pull USDC
    const VAULT_RELAYER = "0xC92E8bdf79f0507f65a392b0ab4667716BFE0110";
    const erc20 = new ethers.Contract(USDC, ["function allowance(address,address) view returns (uint256)", "function approve(address,uint256) returns (bool)"], provider);
    const allow = await erc20.allowance(trader.address, VAULT_RELAYER);
    console.log(`\nUSDC allowance(trader2 -> CoW VaultRelayer) = ${allow}`);
    if (allow < 30000n && process.env.BROADCAST === "1") {
        const tx = await erc20.connect(trader).approve(VAULT_RELAYER, ethers.MaxUint256);
        console.log(`  approve tx ${tx.hash}`);
        await tx.wait();
        console.log(`  allowance now ${await erc20.allowance(trader.address, VAULT_RELAYER)}`);
    }

    const now = Math.floor(Date.now() / 1000);
    const validTo = now + 1800;

    // 2. live quote with the registered appData
    const q = await J(`${API}/quote`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
            sellToken: USDC, buyToken: WETH, receiver: trader.address,
            sellAmountBeforeFee: "30000", validTo, appData,
            feeAmount: "0", kind: "sell", partiallyFillable: false,
            sellTokenBalance: "erc20", buyTokenBalance: "erc20",
            from: trader.address, signingScheme: "eip712",
        }),
    });
    console.log(`\nCoW /quote (registered appData): ${q.status} ${JSON.stringify(q.body).slice(0, 250)}`);

    const buyAmount = q.ok ? (BigInt(q.body.quote.buyAmount) * 99n / 100n).toString() : "11000000000000";
    const order = {
        sellToken: USDC, buyToken: WETH, receiver: trader.address,
        sellAmount: "30000", buyAmount, validTo, appData,
        feeAmount: "0", kind: "sell", partiallyFillable: false,
        sellTokenBalance: "erc20", buyTokenBalance: "erc20",
    };
    const signature = await trader.signTypedData(domain, ORDER_TYPES, order);
    const digest = ethers.TypedDataEncoder.hash(domain, ORDER_TYPES, order);
    const uid = ethers.hexlify(ethers.concat([digest, ethers.getBytes(trader.address), ethers.toBeArray(validTo).slice(-4)]));
    console.log(`\norder digest=${digest}`);
    console.log(`order UID   =${uid}`);

    const sendOrder = async () => {
        for (let i = 0; i < 6; i++) {
            const r = await J(`${API}/orders`, {
                method: "POST", headers: { "content-type": "application/json" },
                body: JSON.stringify({ ...order, signingScheme: "eip712", signature, from: trader.address }),
            });
            if (r.status !== 429) return r;
            const wait = 15000 * (i + 1);
            console.log(`  POST /orders 429 — waiting ${wait / 1000}s (attempt ${i + 1}/6)`);
            await new Promise((res) => setTimeout(res, wait));
        }
        return { status: 429, ok: false, body: "rate limited" };
    };
    const post = await sendOrder();
    console.log(`\nPOST /orders: ${post.status} ${JSON.stringify(post.body).slice(0, 300)}`);
    let got = null;
    if (post.status === 201 || post.ok) {
        await new Promise((r) => setTimeout(r, 2000));
        got = await J(`${API}/orders/${uid}`);
        console.log(`GET /orders/{uid}: ${got.status} ${JSON.stringify(got.body).slice(0, 500)}`);
    }
    fs.writeFileSync(path.resolve(process.cwd(), "cow-base-order.json"),
        JSON.stringify({ levCommOnChain: levComm, registeredAppData: appData, fullAppData, digest, uid, order, signature, quote: q.body, post: post.body, orderState: got && got.body }, null, 2));
    console.log("\nSaved -> cow-base-order.json");
})().catch((e) => { console.error("FAILED:", e.shortMessage || e.message); process.exit(1); });
