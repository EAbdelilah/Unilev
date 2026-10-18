// ── Base (8453) LIVE "externally-driven" open ───────────────────────────────
// Demonstrates the PERMISSIONLESS path with externally-shaped actors, in ONE tx:
//
//   EXTERNAL TRADER (fresh key, the caller — not a whitelisted executor)
//        -> EswapRouter.swapMultiPoolForAggregator(params, trader, EnsoRoute)
//        -> real EXTERNAL aggregator (EnsoRouter V2, external API + contract) fills the notional
//        -> EXTERNAL SOLVER (fresh key, NOT owner, NOT in registeredSolvers) funds the
//           borrow leg purely from its OWN pre-funded escrow bond (auth leg #3)
//        -> EswapMarginHook records position (trader) + solverDebt (external solver)
//
// What is genuinely external here:
//   * aggregator = Enso (third-party API + third-party on-chain router). Not ours.
//   * solver     = an address with NO governance entry and NOT the owner; it is
//                  authorized ONLY by its own capital bond, i.e. the protocol's
//                  permissionless-solver leg — no allowlist dependency.
//   * caller     = the trader itself (an independent key), so the CRIT-4 relay
//                  moat is satisfied by trader==msg.sender, not by us whitelisting.
// Boundary (honest): we still generate/hold these keys, so a *truly unaffiliated*
// third party can't be summoned on demand. This proves the mechanism is open.
//
// Env: BASE_RPC_URL, PRIVATE_KEY (USDC funder), TINY_TRADER_PK (ETH funder),
//      V4_ROUTER_ADDRESS, V4_HOOK_ADDRESS, ENSO_API_KEY,
//      EXT_MARGIN (default 30000), EXT_LEVERAGE (default 2), BROADCAST=1
require("dotenv").config();
const fs = require("fs");
const os = require("os");
const path = require("path");
const { ethers } = require("ethers");

const RPC = process.env.BASE_RPC_URL || "https://mainnet.base.org";
const CHAIN_ID = 8453;
const USDC = ethers.getAddress("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
const WETH = ethers.getAddress("0x4200000000000000000000000000000000000006");
const ROUTER = ethers.getAddress(process.env.V4_ROUTER_ADDRESS || "0x57E75A87A62ab8Ff14C59FA10Ac2AB2c8cBD45D1");
const HOOK = ethers.getAddress(process.env.V4_HOOK_ADDRESS || "0x6f98Ea19e522Ecc706E0Fb1574BDA8D32aC510C8");

const LEVERAGE = Number(process.env.EXT_LEVERAGE || 2);
const MARGIN = BigInt(process.env.EXT_MARGIN || 30000n);
const NOTIONAL = MARGIN * BigInt(LEVERAGE);
const BORROW = NOTIONAL - MARGIN;
const BROADCAST = process.env.BROADCAST === "1";

const HOOK_KEY = [WETH, USDC, 3000, 60, HOOK];
const STD_KEY = [WETH, USDC, 500, 10, ethers.ZeroAddress];
const ROUTER_ABI = require(path.resolve(process.cwd(), "out/EswapRouter.sol/EswapRouter.json")).abi;
const ESWAP_HOOK_ABI = [
    "function positions(bytes32,address) view returns (address,uint256,uint256,uint8,bool,uint160,int24,int24,uint128)",
    "function positionSolver(bytes32,address) view returns (address)",
    "function solverDebts(bytes32,address,address) view returns (address,uint256,uint256)",
];
const ERC20_ABI = [
    "function balanceOf(address) view returns (uint256)",
    "function allowance(address,address) view returns (uint256)",
    "function approve(address,uint256) returns (bool)",
    "function transfer(address,uint256) returns (bool)",
];
const idOf = (k) => ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["address", "address", "uint24", "int24", "address"], k));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function wait(p, hash, label) {
    for (let i = 0; i < 150; i++) {
        await sleep(2000);
        const r = await p.getTransactionReceipt(hash).catch(() => null);
        if (r) {
            if (r.status === 1) { console.log(`  OK   ${label}  gas=${r.gasUsed}  ${hash}`); return r; }
            throw new Error(`${label} REVERTED ${hash}`);
        }
    }
    throw new Error(`${label} TIMEOUT ${hash}`);
}
function fmtRevert(e, iface) {
    if (e && e.data && iface) {
        try { const p = iface.parseError(e.data); if (p) return `${p.name}(${p.args ? p.args.join(", ") : ""}) [${e.data}]`; } catch {}
        return `${e.shortMessage || e.message} data=${e.data}`;
    }
    return (e && (e.shortMessage || e.message)) || String(e);
}
function normMap(m) {
    const out = {};
    if (Array.isArray(m)) for (const p of m) out[String(p[0]).toLowerCase()] = p[1];
    else if (m && typeof m === "object") for (const k of Object.keys(m)) out[k.toLowerCase()] = m[k];
    return out;
}
function keyFile(name) { return path.join(os.tmpdir(), name); }
function loadOrCreateKey(name) {
    const f = keyFile(name);
    if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, "utf8"));
    const w = ethers.Wallet.createRandom();
    fs.writeFileSync(f, JSON.stringify({ address: w.address, privateKey: w.privateKey }, null, 2));
    console.log(`generated ${name} -> ${w.address} (${f})`);
    return { address: w.address, privateKey: w.privateKey };
}
async function fetchBundle(from, amountIn) {
    const apiKey = (process.env.ENSO_API_KEY || "").trim();
    if (!apiKey) throw new Error("ENSO_API_KEY unset");
    const url = `https://api.enso.build/api/v1/shortcuts/bundle?chainId=${CHAIN_ID}&fromAddress=${from}&routingStrategy=router&receiver=${from}`;
    const res = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify([
            { protocol: "enso", action: "route", args: { tokenIn: USDC, tokenOut: WETH, amountIn: amountIn.toString(), slippage: "30", receiver: from } },
        ]),
    });
    const text = await res.text();
    const body = JSON.parse(text);
    if (res.status !== 200 || !body.tx?.to || !body.tx?.data) throw new Error(`enso bundle failed: ${res.status} ${text.slice(0, 300)}`);
    const ao = normMap(body.amountsOut);
    const mo = normMap(body.minAmountsOut);
    return {
        to: ethers.getAddress(body.tx.to),
        data: body.tx.data.startsWith("0x") ? body.tx.data : "0x" + body.tx.data,
        expectedBuy: ao[WETH.toLowerCase()] ?? null,
        minBuy: mo[WETH.toLowerCase()] ?? null,
    };
}

(async () => {
    console.log("=== LIVE externally-driven open (Base 8453) ===");
    const provider = new ethers.JsonRpcProvider(RPC);
    const deployer = new ethers.Wallet(process.env.PRIVATE_KEY, provider); // USDC funder
    const ethFunder = process.env.TINY_TRADER_PK ? new ethers.Wallet(process.env.TINY_TRADER_PK, provider) : deployer;
    if (Number((await provider.getNetwork()).chainId) !== CHAIN_ID) throw new Error("wrong chain");
    if ((await provider.getCode(ROUTER)) === "0x") throw new Error("router has no code");

    const traderInfo = loadOrCreateKey("eswap-ext-trader.json");
    const solverInfo = loadOrCreateKey("eswap-ext-solver.json");
    const trader = new ethers.Wallet(traderInfo.privateKey, provider);
    const solver = new ethers.Wallet(solverInfo.privateKey, provider);

    const router = new ethers.Contract(ROUTER, ROUTER_ABI, provider);
    const usdc = new ethers.Contract(USDC, ERC20_ABI, provider);
    const hook = new ethers.Contract(HOOK, ESWAP_HOOK_ABI, provider);
    const hookId = idOf(HOOK_KEY);

    console.log(`usdc funder (deployer) : ${deployer.address}`);
    console.log(`eth  funder            : ${ethFunder.address}`);
    console.log(`EXTERNAL trader        : ${trader.address}`);
    console.log(`EXTERNAL solver        : ${solver.address}`);
    console.log(`margin/leverage        : ${MARGIN} / ${LEVERAGE}x (notional ${NOTIONAL}, borrow ${BORROW})`);
    console.log(`mode                   : ${BROADCAST ? "BROADCAST" : "SIMULATE-ONLY"}`);

    // ── prove the solver is genuinely NON-PRIVILEGED ─────────────────────
    const owner = ethers.getAddress(await router.owner());
    const isWhitelisted = await router.registeredSolvers(solver.address);
    console.log("\n--- external-solver non-privilege checks ---");
    console.log(`  router.owner()                 = ${owner}`);
    console.log(`  solver == owner                = ${owner.toLowerCase() === solver.address.toLowerCase()}`);
    console.log(`  registeredSolvers(solver)      = ${isWhitelisted}  (must be false)`);
    if (isWhitelisted) throw new Error("solver is governance-whitelisted — not an external solver");
    if (owner.toLowerCase() === solver.address.toLowerCase()) throw new Error("solver is the owner");

    // ── fund the external actors from our own capital ────────────────────
    console.log("\n--- fund external actors (our capital seeds them) ---");
    const traderUsdcNeed = MARGIN + 1000n;
    if ((await usdc.balanceOf(trader.address)) < traderUsdcNeed) {
        if (!BROADCAST) { console.log(`  trader needs ${traderUsdcNeed} USDC -> BROADCAST=1`); return; }
        const tx = await usdc.connect(deployer).transfer(trader.address, traderUsdcNeed);
        await wait(provider, tx.hash, "USDC deployer -> external trader");
    }
    if ((await usdc.balanceOf(solver.address)) < BORROW) {
        if (!BROADCAST) { console.log(`  solver needs ${BORROW} USDC -> BROADCAST=1`); return; }
        const tx = await usdc.connect(deployer).transfer(solver.address, BORROW);
        await wait(provider, tx.hash, "USDC deployer -> external solver");
    }
    const fundEth = async (to, minWei, label) => {
        if ((await provider.getBalance(to)) >= minWei) return;
        if (!BROADCAST) { console.log(`  ${label} needs ETH -> BROADCAST=1`); return; }
        const tx = await ethFunder.sendTransaction({ to, value: minWei });
        await wait(provider, tx.hash, `ETH ${label}`);
    };
    await fundEth(trader.address, ethers.parseEther("0.00005"), "external trader gas");
    await fundEth(solver.address, ethers.parseEther("0.000012"), "external solver gas");

    // ── the EXTERNAL SOLVER self-bonds its borrow leg ────────────────────
    console.log("\n--- external solver posts its OWN borrow escrow ---");
    if ((await usdc.allowance(solver.address, ROUTER)) < BORROW) {
        const tx = await usdc.connect(solver).approve(ROUTER, ethers.MaxUint256);
        await wait(provider, tx.hash, "solver USDC.approve -> router");
    }
    const escrowNow = await router.erc20BorrowEscrow(solver.address, USDC);
    if (escrowNow < BORROW) {
        const tx = await router.connect(solver).depositBorrowEscrow(USDC, BORROW - escrowNow);
        await wait(provider, tx.hash, "solver depositBorrowEscrow");
    }
    console.log(`  solver escrow bond = ${await router.erc20BorrowEscrow(solver.address, USDC)}`);

    // ── the EXTERNAL TRADER approves the router for its margin ───────────
    console.log("\n--- external trader approves router (margin) ---");
    if ((await usdc.allowance(trader.address, ROUTER)) < MARGIN) {
        const tx = await usdc.connect(trader).approve(ROUTER, ethers.MaxUint256);
        await wait(provider, tx.hash, "trader USDC.approve -> router");
    }

    // ── fresh EXTERNAL aggregator route (Enso) ───────────────────────────
    console.log(`\n--- fresh Enso bundle (external aggregator), notional ${NOTIONAL} ---`);
    const bundle = await fetchBundle(ROUTER, NOTIONAL);
    const minOut = bundle.minBuy ? BigInt(bundle.minBuy) : (BigInt(bundle.expectedBuy) * 99n) / 100n;
    console.log(`  exchangeProxy : ${bundle.to}`);
    console.log(`  expectedBuy   : ${bundle.expectedBuy}  minBuy=${minOut}`);

    const deadline = BigInt(Math.floor(Date.now() / 1000) + 900);
    const hookData = ethers.AbiCoder.defaultAbiCoder().encode(["bool", "uint8", "address"], [true, LEVERAGE, trader.address]);
    // positional tuple encoding (unnamed ABI components safety)
    const params = [HOOK_KEY, STD_KEY, false, -MARGIN, LEVERAGE, solver.address, hookData, deadline, minOut];
    const route = [bundle.to, USDC, WETH, NOTIONAL, 0n, bundle.data];

    // ── SIMULATE: the EXTERNAL TRADER is msg.sender (no executor whitelist) ─
    console.log("\n--- eth_call simulation FROM external trader ---");
    let simOk = false;
    try {
        const out = await router.connect(trader).swapMultiPoolForAggregator.staticCall(params, trader.address, route);
        console.log(`  ok — router returned ${out}`);
        simOk = true;
    } catch (e) {
        console.log(`  REVERT: ${fmtRevert(e, router.interface)}`);
    }
    if (!BROADCAST) { console.log("\n[SIMULATE] set BROADCAST=1 to send."); return; }
    if (!simOk) { console.log("\nSimulation reverted -> NOT broadcasting."); return; }

    // ── BROADCAST: the EXTERNAL TRADER sends the tx, external solver funds borrow ──
    console.log("\n--- broadcasting (msg.sender = external trader) ---");
    const tx = await router.connect(trader).swapMultiPoolForAggregator(params, trader.address, route);
    console.log(`  tx.hash = ${tx.hash}`);
    const rcpt = await wait(provider, tx.hash, "external swapMultiPoolForAggregator");

    const pos = await hook.positions(hookId, trader.address);
    const debt = await hook.solverDebts(hookId, trader.address, solver.address);
    const psolver = await hook.positionSolver(hookId, trader.address);
    const escrowAfter = await router.erc20BorrowEscrow(solver.address, USDC);
    console.log("\n--- on-chain verification ---");
    console.log(`  position.trader   : ${pos[0]}`);
    console.log(`  position.collateral: ${pos[1]}`);
    console.log(`  position.borrowed : ${pos[2]}  leverage=${pos[3]} isLong=${pos[4]}`);
    console.log(`  solverDebt.solver : ${debt[0]}  principal=${debt[1]}`);
    console.log(`  positionSolver    : ${psolver}`);
    console.log(`  external solver escrow after: ${escrowAfter}`);
    console.log(`  solver still NOT whitelisted: ${!(await router.registeredSolvers(solver.address))}`);

    const artifact = {
        chainId: CHAIN_ID,
        kind: "externally-driven-open",
        router: ROUTER, hook: HOOK, hookPoolId: hookId,
        aggregator: { exchangeProxy: bundle.to, expectedBuy: bundle.expectedBuy, minBuy: minOut.toString() },
        externalTrader: trader.address,
        externalSolver: solver.address,
        solverWhitelisted: false,
        caller: trader.address,
        margin: MARGIN.toString(), leverage: LEVERAGE, notional: NOTIONAL.toString(), borrow: BORROW.toString(),
        txHash: tx.hash, blockNumber: rcpt.blockNumber, gasUsed: rcpt.gasUsed.toString(),
        position: { trader: pos[0], collateral: pos[1].toString(), borrowed: pos[2].toString(), leverage: Number(pos[3]), isLong: pos[4] },
        solverDebt: { solver: debt[0], principal: debt[1].toString() },
        positionSolver: psolver,
        solverEscrowAfter: escrowAfter.toString(),
        createdAt: new Date().toISOString(),
    };
    fs.writeFileSync(path.resolve(process.cwd(), "external-open.json"), JSON.stringify(artifact, null, 2));
    console.log("\nSaved -> external-open.json");
    console.log("DONE.");
})().catch((e) => {
    console.error("FAILED:", e.shortMessage || e.message);
    if (e.stack) console.error(e.stack);
    process.exit(1);
});
