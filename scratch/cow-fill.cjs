// (2b) CoW end-to-end: register appData, post a REAL CoW Base orderbook order
// signed by the external trader, then settle it into a leveraged Eswap
// position through EswapCoWSettlement.fillOrder() called by an ANONYMOUS
// (unwhitelisted, escrow-bonded) solver.
require("dotenv").config();
const fs = require("fs");
const os = require("os");
const path = require("path");
const { ethers } = require("ethers");

const RPC = process.env.BASE_RPC_URL || "https://mainnet.base.org";
const API = "https://api.cow.fi/base/api/v1";
const CHAIN_ID = 8453;
const GPV2 = "0x9008D19f58AAbD9eD0D60971565AA8510560ab41";
const SETTLEMENT = "0x8e54f58AaD4bdc29D18C6b02064e1c481AfCCe46"; // EswapCoWSettlement
const ROUTER = "0x57E75A87A62ab8Ff14C59FA10Ac2AB2c8cBD45D1";
const HOOK = "0x6f98Ea19e522Ecc706E0Fb1574BDA8D32aC510C8";
const USDC = ethers.getAddress("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
const WETH = ethers.getAddress("0x4200000000000000000000000000000000000006");

const LEV = 5;
const MARGIN = 14000n; // 0.014 USDC; borrow = 0.056 USDC (fits the 0.095 USDC treasury)
const HOOK_KEY = [WETH, USDC, 3000, 60, HOOK];
const STD_KEY = [WETH, USDC, 500, 10, ethers.ZeroAddress];
const POOL_ID = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(["address", "address", "uint24", "int24", "address"], HOOK_KEY)
);

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
const DOMAIN = { name: "Gnosis Protocol", version: "v2", chainId: CHAIN_ID, verifyingContract: GPV2 };

const POOL_TUPLE = "(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)";
const ORDER_TUPLE = "(address sellToken,address buyToken,address receiver,uint256 sellAmount,uint256 buyAmount,uint32 validTo,bytes32 appData,uint256 feeAmount,bytes32 kind,bool partiallyFillable,bytes32 sellTokenBalance,bytes32 buyTokenBalance)";
const FILL_PARAMS_TUPLE = `(uint8 leverage,address solver,${POOL_TUPLE} key,${POOL_TUPLE} standardPoolKey)`;
const S_ABI = [
    `function fillOrder(${ORDER_TUPLE} order,uint8 scheme,bytes signature,${FILL_PARAMS_TUPLE} params) returns (address)`,
    `function verify(${ORDER_TUPLE} order,uint8 scheme,bytes signature) view returns (address,bytes32,bytes)`,
    `function hashOrder(${ORDER_TUPLE} order) view returns (bytes32)`,
    `function leverageCommitment(uint8) view returns (bytes32)`,
    `function appDataJson(uint8) view returns (string)`,
    "function filledOrders(bytes32) view returns (bool)",
    "function domainSeparator() view returns (bytes32)",
];
const R_ABI = ["function erc20BorrowEscrow(address,address) view returns (uint256)", "function registeredSolvers(address) view returns (bool)"];
const H_ABI = [
    "function positions(bytes32,address) view returns (address,uint256,uint256,uint8,bool,uint160,int24,int24,uint128)",
    "function positionSolver(bytes32,address) view returns (address)",
    "function rehypPrincipal(bytes32,address) view returns (uint256)",
];
const E_ABI = ["function balanceOf(address) view returns (uint256)"];

const J = async (u, o) => {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), 30000);
    try {
        const r = await fetch(u, { ...o, signal: c.signal });
        const x = await r.text();
        let b; try { b = JSON.parse(x); } catch { b = x.slice(0, 400); }
        return { status: r.status, ok: r.ok, body: b };
    } catch (e) { return { status: 0, ok: false, body: e.message }; }
    finally { clearTimeout(t); }
};
const key = (f) => JSON.parse(fs.readFileSync(path.join(os.tmpdir(), f), "utf8")).privateKey;

(async () => {
    const provider = new ethers.JsonRpcProvider(RPC);
    const trader = new ethers.Wallet(key("eswap-ext-trader3.json"), provider);
    const solver = new ethers.Wallet(key("eswap-ext-solver.json"), provider);

    const settlement = new ethers.Contract(SETTLEMENT, S_ABI, provider);
    const router = new ethers.Contract(ROUTER, R_ABI, provider);
    const hook = new ethers.Contract(HOOK, H_ABI, provider);
    const usdc = new ethers.Contract(USDC, E_ABI, provider);

    console.log(`trader(owner) = ${trader.address}`);
    console.log(`solver        = ${solver.address}  registeredSolvers=${await router.registeredSolvers(solver.address)}`);

    // ── 1. canonical appData commitment ────────────────────────────────────
    const fullAppData = await settlement.appDataJson(LEV);
    const appData = ethers.keccak256(ethers.toUtf8Bytes(fullAppData));
    const onChain = await settlement.leverageCommitment(LEV);
    console.log(`fullAppData   = ${fullAppData}`);
    console.log(`appData hash  = ${appData}`);
    console.log(`leverageCommitment(${LEV}) on-chain = ${onChain}  match=${appData === onChain}`);
    if (appData !== onChain) throw new Error("appData preimage does not match on-chain commitment");

    const reg = await J(`${API}/app_data/${appData}`, {
        method: "PUT", headers: { "content-type": "application/json" },
        body: JSON.stringify({ fullAppData }),
    });
    console.log(`PUT /app_data/${appData} -> ${reg.status} ${JSON.stringify(reg.body).slice(0, 200)}`);

    // ── 2. signed CoW order (feeAmount MUST be 0 for Eswap settlement) ─────
    const validTo = Math.floor(Date.now() / 1000) + 1800;
    let q = null;
    for (let i = 0; i < 5 && !q; i++) {
        const r = await J(`${API}/quote`, {
            method: "POST", headers: { "content-type": "application/json" },
            body: JSON.stringify({
                sellToken: USDC, buyToken: WETH, receiver: trader.address,
                sellAmountBeforeFee: MARGIN.toString(), validTo, appData,
                feeAmount: "0", kind: "sell", partiallyFillable: false,
                sellTokenBalance: "erc20", buyTokenBalance: "erc20",
                from: trader.address, signingScheme: "eip712",
            }),
        });
        if (r.ok) { q = r; break; }
        console.log(`  POST /quote ${r.status}, waiting ${(i + 1) * 25}s (${JSON.stringify(String(r.body)).slice(0, 120)})`);
        await new Promise((r2) => setTimeout(r2, 25000 * (i + 1)));
    }
    // Fallback: buy floor from the earlier live quote (margin 40_000), scaled
    // to this margin (the fill swaps 5x notional, so any fair single-swap price
    // is a floor).
    const QUOTED_BUY_FALLBACK = (15460990425377n * MARGIN) / 40000n;
    const quotedBuy = q ? BigInt(q.body.quote.buyAmount) : QUOTED_BUY_FALLBACK;
    if (q) console.log(`quote: sell ${q.body.quote.sellAmount} fee ${q.body.quote.feeAmount} buy ${q.body.quote.buyAmount}`);
    else console.log(`quote unavailable (rate limited) -> reusing prior live quote buyAmount=${QUOTED_BUY_FALLBACK}`);
    const order = {
        sellToken: USDC, buyToken: WETH, receiver: trader.address,
        sellAmount: MARGIN.toString(), buyAmount: quotedBuy.toString(), validTo,
        appData, feeAmount: "0", kind: "sell", partiallyFillable: false,
        sellTokenBalance: "erc20", buyTokenBalance: "erc20",
    };
    console.log(`order: sell ${order.sellAmount} fee ${order.feeAmount} buy ${order.buyAmount} validTo=${order.validTo}`);

    const signature = await trader.signTypedData(DOMAIN, ORDER_TYPES, order);
    const digest = ethers.TypedDataEncoder.hash(DOMAIN, ORDER_TYPES, order);

    // on-chain form of the same order (bytes32 markers instead of strings)
    const ethOrder = {
        sellToken: order.sellToken, buyToken: order.buyToken, receiver: order.receiver,
        sellAmount: BigInt(order.sellAmount), buyAmount: BigInt(order.buyAmount),
        validTo: order.validTo, appData: order.appData, feeAmount: BigInt(order.feeAmount),
        kind: ethers.keccak256(ethers.toUtf8Bytes(order.kind)),
        partiallyFillable: order.partiallyFillable,
        sellTokenBalance: ethers.keccak256(ethers.toUtf8Bytes(order.sellTokenBalance)),
        buyTokenBalance: ethers.keccak256(ethers.toUtf8Bytes(order.buyTokenBalance)),
    };

    // ── 3. on-chain agreement: digest / owner recovery ─────────────────────
    const chainDigest = await settlement.hashOrder(ethOrder);
    const [recovered, , uidBytes] = await settlement.verify(ethOrder, 0, signature);
    const uid = ethers.hexlify(uidBytes);
    console.log(`off-chain digest = ${digest}`);
    console.log(`on-chain  digest = ${chainDigest}  match=${digest === chainDigest}`);
    console.log(`recovered owner  = ${recovered}  match=${recovered.toLowerCase() === trader.address.toLowerCase()}`);
    console.log(`order UID        = ${uid}`);
    if (digest !== chainDigest) throw new Error("EIP-712 digest mismatch");
    if (recovered.toLowerCase() !== trader.address.toLowerCase()) throw new Error("owner recovery mismatch");

    // ── 4. post to the live CoW Base order book ────────────────────────────
    let post = null;
    for (let i = 0; i < 6; i++) {
        post = await J(`${API}/orders`, {
            method: "POST", headers: { "content-type": "application/json" },
            body: JSON.stringify({ ...order, signingScheme: "eip712", signature, from: trader.address }),
        });
        if (post.status !== 429) break;
        console.log(`  POST /orders 429, waiting ${(i + 1) * 15}s`);
        await new Promise((r) => setTimeout(r, 15000 * (i + 1)));
    }
    console.log(`POST /orders -> ${post.status} ${JSON.stringify(post.body).slice(0, 300)}`);
    let live = null;
    if (post.ok || post.status === 201) {
        await new Promise((r) => setTimeout(r, 2000));
        live = await J(`${API}/orders/${uid}`);
        console.log(`GET /orders/{uid} -> ${live.status} ${JSON.stringify(live.body).slice(0, 300)}`);
    }

    // ── 5. settle through EswapCoWSettlement as the anonymous solver ───────
    const params = {
        leverage: LEV, solver: solver.address,
        key: { currency0: HOOK_KEY[0], currency1: HOOK_KEY[1], fee: HOOK_KEY[2], tickSpacing: HOOK_KEY[3], hooks: HOOK_KEY[4] },
        standardPoolKey: { currency0: STD_KEY[0], currency1: STD_KEY[1], fee: STD_KEY[2], tickSpacing: STD_KEY[3], hooks: STD_KEY[4] },
    };

    const escrowBefore = await router.erc20BorrowEscrow(solver.address, USDC);
    console.log(`\nescrow before = ${escrowBefore} (borrow = ${MARGIN * (BigInt(LEV) - 1n)})`);
    console.log(`trader USDC before = ${await usdc.balanceOf(trader.address)}  solver USDC before = ${await usdc.balanceOf(solver.address)}`);

    const contract = settlement.connect(solver);
    const args = [ethOrder, 0, signature, params];
    let simulation;
    try {
        await contract.fillOrder.staticCall(...args);
        simulation = "OK";
    } catch (e) {
        simulation = `REVERT: ${e.shortMessage || e.message} ${e.data ? "data=" + e.data : ""} ${e.info && e.info.error && e.info.error.data ? "info=" + JSON.stringify(e.info.error.data).slice(0, 400) : ""}`;
    }
    console.log(`fillOrder staticCall (msg.sender=${solver.address}): ${simulation}`);
    if (simulation !== "OK") throw new Error("staticCall failed; not broadcasting");

    const tx = await contract.fillOrder(...args, { gasLimit: 3_000_000n });
    console.log(`fillOrder tx = ${tx.hash}`);
    const rec = await tx.wait();
    console.log(`mined block=${rec.blockNumber} status=${rec.status} gasUsed=${rec.gasUsed}`);

    // ── 6. prove it ────────────────────────────────────────────────────────
    const iface = new ethers.Interface([
        "event OrderFilled(bytes orderUid, address indexed owner, address indexed solver, uint256 margin, uint8 leverage)",
    ]);
    const fills = [];
    for (const l of rec.logs) {
        if (l.address.toLowerCase() === SETTLEMENT.toLowerCase()) {
            try { fills.push(iface.parseLog(l).args); } catch { /* other event */ }
        }
    }
    console.log(`OrderFilled events in tx: ${fills.length}`);
    for (const f of fills) console.log(`  owner=${f[0]} solver=${f[1]} margin=${f[2]} lev=${f[3]}`);

    const pos = await hook.positions(POOL_ID, trader.address);
    console.log(`hook.positions(trader): collateral=${pos[1]} borrowed=${pos[2]} lev=${pos[3]} isLong=${pos[4]}`);
    console.log(`positionSolver         = ${await hook.positionSolver(POOL_ID, trader.address)}`);
    console.log(`rehypPrincipal(trader)  = ${await hook.rehypPrincipal(POOL_ID, trader.address)}`);
    console.log(`escrow after           = ${await router.erc20BorrowEscrow(solver.address, USDC)}`);
    console.log(`filledOrders(uidHash)  = ${await settlement.filledOrders(ethers.keccak256(uidBytes))}`);
    console.log(`trader USDC after      = ${await usdc.balanceOf(trader.address)} (margin pulled from SOLVER, not trader)`);
    console.log(`solver  USDC after     = ${await usdc.balanceOf(solver.address)}`);

    // ── 7. order book state, then cancel so GPv2 cannot double-settle ──────
    // A bare DELETE is rejected: the orderbook requires an EIP-712 signature of
    // `OrderCancellation(bytes orderUid)` from the ORDER OWNER, over the same
    // GPv2 domain as the order (cowprotocol/services openapi: cancelOrder).
    if (live) {
        const after = await J(`${API}/orders/${uid}`);
        console.log(`GET /orders/{uid} after fill -> ${after.status} ${JSON.stringify(after.body).slice(0, 300)}`);
        const cancelSig = await trader.signTypedData(
            DOMAIN,
            { OrderCancellation: [{ name: "orderUid", type: "bytes" }] },
            { orderUid: uid },
        );
        const del = await J(`${API}/orders/${uid}`, {
            method: "DELETE", headers: { "content-type": "application/json" },
            body: JSON.stringify({ signature: cancelSig, signingScheme: "eip712" }),
        });
        console.log(`DELETE /orders/{uid} (owner-signed cancel) -> ${del.status} ${JSON.stringify(del.body).slice(0, 200)}`);
        await new Promise((r) => setTimeout(r, 1500));
        const verified = await J(`${API}/orders/${uid}`);
        console.log(`GET /orders/{uid} after cancel -> ${verified.status} invalidated=${verified.body && verified.body.invalidated}`);
        var cancelState = { delete: del.body, after: verified.body };
    }

    fs.writeFileSync(path.resolve(process.cwd(), "scratch", "cow-fill-result.json"), JSON.stringify({
        lev: LEV, appData, fullAppData, onChainCommitment: onChain, order, signature, digest, chainDigest, uid,
        quote: q ? q.body : "rate-limited; used cached buy floor", post: post.body, orderOnBook: live && live.body,
        tx: tx.hash, block: rec.blockNumber, gasUsed: rec.gasUsed.toString(),
        position: { collateral: pos[1].toString(), borrowed: pos[2].toString(), lev: Number(pos[3]), isLong: pos[4] },
        positionSolver: await hook.positionSolver(POOL_ID, trader.address),
        escrowAfter: (await router.erc20BorrowEscrow(solver.address, USDC)).toString(),
        cancel: (typeof cancelState !== "undefined" && cancelState) || null,
    }, null, 2));
    console.log("saved -> scratch/cow-fill-result.json");
})().catch((e) => { console.error("FAILED:", e.shortMessage || e.message, e.data || ""); console.error(e.stack || ""); process.exit(1); });
