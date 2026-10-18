// ── Base (chain 8453) LIVE aggregator front-door open ────────────────────────
// Canonical "aggregator -> engine -> solver" flow documented in docs/FULL_CYCLE_PROOF.md §2:
//
//   fresh trader -> EswapLeverageAdapter.exactInputSingleWithLeverageAggregator
//                   -> EswapRouter.swapMultiPoolForAggregator
//                   -> exchangeProxy.call(real Enso bundle calldata)   (real aggregator)
//                   -> EswapMarginHook accounting (position + solver debt)
//
//   Aggregator = real Enso route (EnsoRouter V2, whitelisted exchangeProxy)
//   Solver     = defaultSolver resolved by the adapter, funds the borrow leg
//   Trader     = a fresh recipient credited with the position (no protocol capital)
//
// Idempotent: deploys the adapter once, then re-runs setup + the fill. Set
// BROADCAST=1 to send state-changing transactions; otherwise it only reads/simulates.
//
// Env: BASE_RPC_URL, PRIVATE_KEY (deployer/owner/solver), SOLVER_ADDRESS,
//      V4_ROUTER_ADDRESS, V4_HOOK_ADDRESS, ENSO_API_KEY,
//      ADAPTER_MARGIN (default 30000), ADAPTER_LEVERAGE (default 2), BROADCAST=1
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

const LEVERAGE = Number(process.env.ADAPTER_LEVERAGE || 2);
const MARGIN = BigInt(process.env.ADAPTER_MARGIN || 30000n); // 0.03 USDC
const NOTIONAL = MARGIN * BigInt(LEVERAGE);
const BORROW = NOTIONAL - MARGIN;
const FEE = 3000;
const BROADCAST = process.env.BROADCAST === "1";

const ART = require(path.resolve(process.cwd(), "out/EswapLeverageAdapter.sol/EswapLeverageAdapter.json"));

const ABI = {
    router: [
        "function executorWhitelist(address) view returns (bool)",
        "function registeredSolvers(address) view returns (bool)",
        "function setExecutorWhitelist(address,bool)",
        "function setSolverWhitelist(address,bool)",
        "function owner() view returns (address)",
    ],
    erc20: [
        "function balanceOf(address) view returns (uint256)",
        "function allowance(address,address) view returns (uint256)",
        "function approve(address,uint256) returns (bool)",
        "function transfer(address,uint256) returns (bool)",
    ],
    hook: [
        "function positions(bytes32,address) view returns (address,uint256,uint256,uint8,bool,uint160,int24,int24,uint128)",
        "function positionSolver(bytes32,address) view returns (address)",
        "function solverDebts(bytes32,address,address) view returns (address,uint256,uint256)",
    ],
};

const HOOK_KEY = [WETH, USDC, 3000, 60, HOOK];
const STD_KEY = [WETH, USDC, 500, 10, ethers.ZeroAddress];
const idOf = (k) => ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["address", "address", "uint24", "int24", "address"], k));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function wait(p, hash, label) {
    for (let i = 0; i < 150; i++) {
        await sleep(2000);
        const r = await p.getTransactionReceipt(hash).catch(() => null);
        if (r) {
            if (r.status === 1) {
                console.log(`  OK   ${label}  gas=${r.gasUsed}  ${hash}`);
                return r;
            }
            throw new Error(`${label} REVERTED ${hash}`);
        }
    }
    throw new Error(`${label} TIMEOUT ${hash}`);
}
function fmtRevert(e, iface) {
    if (e && e.data && iface) {
        try {
            const p = iface.parseError(e.data);
            if (p) return `${p.name}(${p.args ? p.args.join(", ") : ""}) [${e.data}]`;
        } catch {}
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
async function fetchBundle(from, amountIn) {
    const apiKey = (process.env.ENSO_API_KEY || "").trim();
    if (!apiKey) throw new Error("ENSO_API_KEY unset — the aggregator leg needs a live Enso route");
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
        value: String(body.tx.value ?? "0"),
        expectedBuy: ao[WETH.toLowerCase()] ?? null,
        minBuy: mo[WETH.toLowerCase()] ?? null,
    };
}

(async () => {
    console.log("=== LIVE aggregator front-door open (Base 8453) ===");
    if (!process.env.PRIVATE_KEY) throw new Error("PRIVATE_KEY unset");
    const provider = new ethers.JsonRpcProvider(RPC);
    const deployer = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
    const solver = ethers.getAddress(process.env.SOLVER_ADDRESS || deployer.address);
    if (Number((await provider.getNetwork()).chainId) !== CHAIN_ID) throw new Error("wrong chain");
    if ((await provider.getCode(ROUTER)) === "0x") throw new Error("router has no code");

    // fresh trader/recipient (the adapter pulls the MARGIN from them)
    const recipientPk = (() => {
        if (process.env.ADAPTER_RECIPIENT_PK) return process.env.ADAPTER_RECIPIENT_PK;
        const f = path.join(os.tmpdir(), "eswap-adapter-recipient.json");
        if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, "utf8")).privateKey;
        const w = ethers.Wallet.createRandom();
        fs.writeFileSync(f, JSON.stringify({ address: w.address, privateKey: w.privateKey }, null, 2));
        console.log(`generated recipient key -> ${f}`);
        return w.privateKey;
    })();
    const recipient = new ethers.Wallet(recipientPk, provider);

    console.log(`deployer(owner) : ${deployer.address}`);
    console.log(`solver          : ${solver}`);
    console.log(`recipient       : ${recipient.address}`);
    console.log(`margin/leverage : ${MARGIN} / ${LEVERAGE}x  (notional ${NOTIONAL}, borrow ${BORROW})`);
    console.log(`mode            : ${BROADCAST ? "BROADCAST" : "SIMULATE-ONLY (set BROADCAST=1)"}`);

    // ── deploy adapter if needed ─────────────────────────────────────────
    let adapterAddr = process.env.ADAPTER_ADDRESS || "0xC5616D22892828a500b5957efA9e5CcCD59d5C70";
    let adapter;
    if ((await provider.getCode(adapterAddr)) === "0x") {
        if (!BROADCAST) {
            console.log(`\nadapter ${adapterAddr} has no code -> run with BROADCAST=1 to deploy`);
            return;
        }
        console.log(`\n--- deploying EswapLeverageAdapter(router=${ROUTER}) ---`);
        const factory = new ethers.ContractFactory(ART.abi, ART.bytecode.object, deployer);
        adapter = await factory.deploy(ROUTER);
        const deployRcpt = await adapter.deploymentTransaction().wait();
        adapterAddr = await adapter.getAddress();
        console.log(`  OK   adapter deployed  gas=${deployRcpt.gasUsed}  ${adapterAddr}`);
    } else {
        adapter = new ethers.Contract(adapterAddr, ART.abi, provider);
    }
    const adapterOwner = await adapter.owner();
    if (ethers.getAddress(adapterOwner) !== deployer.address) throw new Error(`adapter.owner=${adapterOwner} != deployer`);
    if (ethers.getAddress(await adapter.router()) !== ROUTER) throw new Error("adapter.router mismatch");

    const router = new ethers.Contract(ROUTER, ABI.router, provider);
    const usdc = new ethers.Contract(USDC, ABI.erc20, provider);
    const hook = new ethers.Contract(HOOK, ABI.hook, provider);

    // ── setup (idempotent) ───────────────────────────────────────────────
    console.log("\n--- setup ---");
    const txs = [];
    if (!(await router.executorWhitelist(adapterAddr))) txs.push(["router.setExecutorWhitelist(adapter,true)", () => router.connect(deployer).setExecutorWhitelist(adapterAddr, true)]);
    if (!(await router.registeredSolvers(solver))) txs.push(["router.setSolverWhitelist(solver,true)", () => router.connect(deployer).setSolverWhitelist(solver, true)]);
    txs.push(["adapter.registerPool(USDC,WETH,3000,...)", () => adapter.connect(deployer).registerPool(USDC, WETH, FEE, HOOK_KEY, STD_KEY)]);
    txs.push(["adapter.setDefaultSolver(solver)", () => adapter.connect(deployer).setDefaultSolver(solver)]);
    if (BROADCAST) {
        for (const [label, fn] of txs) {
            const tx = await fn();
            await wait(provider, tx.hash, label);
        }
    } else {
        for (const [label] of txs) console.log(`  would send: ${label}`);
        if (txs.length) {
            console.log("\n[simulate-only] set BROADCAST=1 to run setup + fill.");
            return;
        }
    }
    console.log(`  adapter.defaultSolver = ${await adapter.defaultSolver()}`);
    const reg = await adapter.getPoolKey(USDC, WETH, FEE);
    console.log(`  adapter pool[USDC->WETH,${FEE}] hookKey hooks=${reg[0].hooks}`);

    // ── fund recipient (margin) + approve router ─────────────────────────
    console.log("\n--- fund recipient (margin) + approve ---");
    const needMargin = MARGIN + 1000n;
    if ((await usdc.balanceOf(recipient.address)) < needMargin) {
        if (!BROADCAST) {
            console.log(`  recipient USDC=${await usdc.balanceOf(recipient.address)} < ${needMargin} -> run with BROADCAST=1`);
            return;
        }
        const tx = await usdc.connect(deployer).transfer(recipient.address, needMargin);
        await wait(provider, tx.hash, "deployer USDC.transfer -> recipient");
    } else {
        console.log(`  recipient already funded (${await usdc.balanceOf(recipient.address)})`);
    }
    const needEth = ethers.parseEther("0.00002");
    if ((await provider.getBalance(recipient.address)) < needEth) {
        if (BROADCAST) {
            const tx = await deployer.sendTransaction({ to: recipient.address, value: needEth });
            await wait(provider, tx.hash, "deployer ETH -> recipient (gas)");
        } else {
            console.log(`  recipient ETH=${ethers.formatEther(await provider.getBalance(recipient.address))} < ${ethers.formatEther(needEth)} -> run with BROADCAST=1`);
        }
    } else {
        console.log(`  recipient already has ETH (${ethers.formatEther(await provider.getBalance(recipient.address))})`);
    }
    if ((await usdc.allowance(recipient.address, ROUTER)) < MARGIN) {
        const tx = await usdc.connect(recipient).approve(ROUTER, ethers.MaxUint256);
        await wait(provider, tx.hash, "recipient USDC.approve -> router");
    } else {
        console.log("  recipient->router allowance already sufficient");
    }
    console.log(`  solver USDC=${await usdc.balanceOf(solver)} allowance->router=${await usdc.allowance(solver, ROUTER)}`);

    // ── fresh aggregator route ───────────────────────────────────────────
    console.log(`\n--- fetch fresh Enso bundle (notional ${NOTIONAL} USDC) ---`);
    const bundle = await fetchBundle(ROUTER, NOTIONAL);
    const minOut = bundle.minBuy ? BigInt(bundle.minBuy) : (BigInt(bundle.expectedBuy) * 99n) / 100n;
    console.log(`  exchangeProxy : ${bundle.to} (EnsoRouter V2, whitelisted)`);
    console.log(`  expectedBuy   : ${bundle.expectedBuy}  minBuy=${minOut}`);

    const route = { exchangeProxy: bundle.to, tokenIn: USDC, tokenOut: WETH, sellAmount: NOTIONAL, value: 0n, callData: bundle.data };
    const args = [USDC, WETH, FEE, LEVERAGE, MARGIN, minOut, recipient.address, route];

    // ── simulate ─────────────────────────────────────────────────────────
    console.log("\n--- eth_call simulation FROM deployer (aggregator resolver) ---");
    let simOk = false;
    try {
        const amountOut = await adapter.connect(deployer).exactInputSingleWithLeverageAggregator.staticCall(...args);
        console.log(`  amountOut (WETH) = ${amountOut}`);
        simOk = true;
    } catch (e) {
        console.log(`  REVERT: ${fmtRevert(e, adapter.interface)}`);
    }

    if (!BROADCAST) {
        console.log("\n[simulate-only] set BROADCAST=1 to send the aggregator+solver fill.");
        return;
    }
    if (!simOk) {
        console.log("\nSimulation reverted -> NOT broadcasting.");
        return;
    }

    // ── broadcast ────────────────────────────────────────────────────────
    console.log("\n--- broadcasting aggregator+solver fill ---");
    const tx = await adapter.connect(deployer).exactInputSingleWithLeverageAggregator(...args);
    console.log(`  tx.hash = ${tx.hash}`);
    const rcpt = await wait(provider, tx.hash, "adapter.exactInputSingleWithLeverageAggregator");

    // ── verify ───────────────────────────────────────────────────────────
    const hookId = idOf(HOOK_KEY);
    const pos = await hook.positions(hookId, recipient.address);
    const debt = await hook.solverDebts(hookId, recipient.address, solver);
    const psolver = await hook.positionSolver(hookId, recipient.address);
    console.log("\n--- on-chain verification ---");
    console.log(`  positions(${hookId}, ${recipient.address})`);
    console.log(`    trader     : ${pos[0]}`);
    console.log(`    collateral : ${pos[1]}`);
    console.log(`    borrowed   : ${pos[2]}`);
    console.log(`    leverage   : ${pos[3]}`);
    console.log(`    isLong     : ${pos[4]}`);
    console.log(`  solverDebts -> solver ${debt[0]}  principal ${debt[1]}`);
    console.log(`  positionSolver: ${psolver}`);
    console.log(`  solver USDC after: ${await usdc.balanceOf(solver)}`);

    const artifact = {
        chainId: CHAIN_ID,
        kind: "adapter-front-door-open",
        adapter: adapterAddr,
        router: ROUTER,
        hook: HOOK,
        hookPoolId: hookId,
        hookPoolKey: HOOK_KEY,
        standardPoolKey: STD_KEY,
        aggregator: { exchangeProxy: bundle.to, expectedBuy: bundle.expectedBuy, minBuy: minOut.toString() },
        solver,
        recipient: recipient.address,
        margin: MARGIN.toString(),
        leverage: LEVERAGE,
        notional: NOTIONAL.toString(),
        borrow: BORROW.toString(),
        txHash: tx.hash,
        blockNumber: rcpt.blockNumber,
        gasUsed: rcpt.gasUsed.toString(),
        position: { trader: pos[0], collateral: pos[1].toString(), borrowed: pos[2].toString(), leverage: Number(pos[3]), isLong: pos[4] },
        solverDebt: { solver: debt[0], principal: debt[1].toString() },
        positionSolver: psolver,
        createdAt: new Date().toISOString(),
    };
    const out = path.resolve(process.cwd(), "adapter-open.json");
    fs.writeFileSync(out, JSON.stringify(artifact, null, 2));
    console.log(`\nSaved artifact -> ${out}`);
    console.log("DONE.");
})().catch((e) => {
    console.error("FAILED:", e.shortMessage || e.message);
    if (e.stack) console.error(e.stack);
    process.exit(1);
});
