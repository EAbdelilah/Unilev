// ── Base (chain 8453) LIVE CoW-solver-settlement open ────────────────────────
// Proves the "aggregators -> solvers" pipeline through the Eswap v4 engine:
//
//   aggregator orderflow : the trader's canonical CoW (GPv2) order
//   solver               : an Eswap-registered / escrow-bonded solver fills it
//   engine               : EswapCoWSettlement.fillOrder -> EswapRouter
//                          .swapMultiPoolForSolverFunded -> margin + borrow
//                          funded by the SOLVER, position credited to the trader
//
// Unlike scripts/v4/live-base-cow.cjs this variant is LIVE-ONLY (no anvil fork
// minting/impersonation), reads every address from .env, and gates the fill on
// an eth_call simulation. Set BROADCAST=1 to actually send transactions.
//
// Env:
//   BASE_RPC_URL, PRIVATE_KEY (solver), TINY_TRADER_PK (order owner),
//   V4_ROUTER_ADDRESS, V4_HOOK_ADDRESS, V4_COW_SETTLEMENT_ADDRESS,
//   COW_GPv2_SETTLEMENT, COW_MARGIN (default 30000), COW_LEVERAGE (default 2),
//   BROADCAST=1
require("dotenv").config();
const fs = require("fs");
const os = require("os");
const path = require("path");
const { ethers } = require("ethers");

const RPC = process.env.BASE_RPC_URL || "https://mainnet.base.org";
const CHAIN_ID = 8453;
const USDC = ethers.getAddress("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
const WETH = ethers.getAddress("0x4200000000000000000000000000000000000006");
const HOOK = ethers.getAddress(process.env.V4_HOOK_ADDRESS || "0x6f98Ea19e522Ecc706E0Fb1574BDA8D32aC510C8");
const ROUTER = ethers.getAddress(process.env.V4_ROUTER_ADDRESS || "0x57E75A87A62ab8Ff14C59FA10Ac2AB2c8cBD45D1");
const SETTLEMENT = ethers.getAddress(process.env.V4_COW_SETTLEMENT_ADDRESS || "0xD2e8b474d6faB4d879Fe4621192B018B35B79488");
const GPV2 = ethers.getAddress(process.env.COW_GPv2_SETTLEMENT || "0x9008D19f58AAbD9eD0D60971565AA8510560ab41");

const LEVERAGE = Number(process.env.COW_LEVERAGE || 2);
const MARGIN = BigInt(process.env.COW_MARGIN || 30000n); // 0.03 USDC
const BORROW = MARGIN * BigInt(LEVERAGE - 1);
const BROADCAST = process.env.BROADCAST === "1";
const GAS = {}; // let ethers populate EIP-1559 fees from the network

const KIND_SELL = ethers.keccak256(ethers.toUtf8Bytes("sell"));
const BALANCE_ERC20 = ethers.keccak256(ethers.toUtf8Bytes("erc20"));
const SCHEME_EIP712 = 0;

const ABI = {
    settlement: [
        "function router() view returns (address)",
        "function gpv2Settlement() view returns (address)",
        "function domainSeparator() view returns (bytes32)",
        "function leverageCommitment(uint8) pure returns (bytes32)",
        "function hashOrder((address,address,address,uint256,uint256,uint32,bytes32,uint256,bytes32,bool,bytes32,bytes32)) view returns (bytes32)",
        "function filledOrders(bytes32) view returns (bool)",
        "function fillOrder((address,address,address,uint256,uint256,uint32,bytes32,uint256,bytes32,bool,bytes32,bytes32) order,uint8 scheme,bytes signature,(uint8 leverage,address solver,(address,address,uint24,int24,address) key,(address,address,uint24,int24,address) standardPoolKey) params) returns (address)",
    ],
    router: [
        "function registeredSolvers(address) view returns (bool)",
        "function erc20BorrowEscrow(address,address) view returns (uint256)",
        "function depositBorrowEscrow(address,uint256)",
    ],
    hook: [
        "function router() view returns (address)",
        "function isAuthorizedPool(bytes32) view returns (bool)",
        "function standardPoolKeys(bytes32) view returns (address,address,uint24,int24,address)",
        "function positions(bytes32,address) view returns (address,uint256,uint256,uint8,bool,uint160,int24,int24,uint128)",
        "function positionSolver(bytes32,address) view returns (address)",
        "function solverDebts(bytes32,address,address) view returns (address,uint256,uint256)",
    ],
    erc20: [
        "function balanceOf(address) view returns (uint256)",
        "function allowance(address,address) view returns (uint256)",
        "function approve(address,uint256) returns (bool)",
    ],
};

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
const idOf = (k) => ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["address", "address", "uint24", "int24", "address"], k));

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

(async () => {
    console.log("=== LIVE CoW solver-settlement open (Base 8453) ===");
    if (!process.env.PRIVATE_KEY) throw new Error("PRIVATE_KEY (solver) unset");

    const provider = new ethers.JsonRpcProvider(RPC);
    const solver = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

    // Order owner (the trader whose aggregator orderflow is being filled). A CoW
    // fill needs NO funds from the owner — the solver fronts margin + borrow — so
    // a fresh signer is fine and avoids clashing with an already-open position.
    const ownerPk = (() => {
        if (process.env.COW_OWNER_PK) return process.env.COW_OWNER_PK;
        const f = process.env.COW_OWNER_FILE || path.join(os.tmpdir(), "eswap-cow-owner.json");
        if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, "utf8")).privateKey;
        const w = ethers.Wallet.createRandom();
        fs.writeFileSync(f, JSON.stringify({ address: w.address, privateKey: w.privateKey }, null, 2));
        console.log(`generated order-owner key -> ${f}`);
        return w.privateKey;
    })();
    const trader = new ethers.Wallet(ownerPk, provider);
    const owner = await trader.getAddress();

    const net = await provider.getNetwork();
    console.log(`chainId        : ${net.chainId}`);
    console.log(`solver         : ${solver.address}`);
    console.log(`trader (owner) : ${owner}`);
    console.log(`margin/borrow  : ${MARGIN} / ${BORROW} (${LEVERAGE}x)`);
    console.log(`router         : ${ROUTER}`);
    console.log(`hook           : ${HOOK}`);
    console.log(`settlement     : ${SETTLEMENT}`);
    console.log(`gpv2 (domain)  : ${GPV2}`);
    console.log(`mode           : ${BROADCAST ? "BROADCAST" : "SIMULATE-ONLY (set BROADCAST=1 to send)"}`);

    for (const [n, a] of [["router", ROUTER], ["hook", HOOK], ["settlement", SETTLEMENT]]) {
        const code = await provider.getCode(a);
        if (code === "0x") throw new Error(`${n} ${a} has NO code on this chain`);
    }

    const settlement = new ethers.Contract(SETTLEMENT, ABI.settlement, provider);
    const router = new ethers.Contract(ROUTER, ABI.router, provider);
    const hook = new ethers.Contract(HOOK, ABI.hook, provider);
    const usdc = new ethers.Contract(USDC, ABI.erc20, provider);

    // ── config sanity ────────────────────────────────────────────────────
    const setRouter = await settlement.router();
    const setGpv2 = await settlement.gpv2Settlement();
    if (ethers.getAddress(setRouter) !== ROUTER) throw new Error(`settlement.router()=${setRouter} != ${ROUTER}`);
    if (ethers.getAddress(setGpv2) !== GPV2) throw new Error(`settlement.gpv2Settlement()=${setGpv2} != ${GPV2}`);
    const hookRouter = await hook.router();
    if (ethers.getAddress(hookRouter) !== ROUTER) throw new Error(`hook.router()=${hookRouter} != ${ROUTER}`);
    if (!(await hook.isAuthorizedPool(idOf([WETH, USDC, 3000, 60, HOOK])))) throw new Error("hook pool not authorized");

    const hookId = idOf([WETH, USDC, 3000, 60, HOOK]);
    const std = await hook.standardPoolKeys(hookId);
    const STD_KEY = [ethers.getAddress(std[0]), ethers.getAddress(std[1]), Number(std[2]), Number(std[3]), ethers.getAddress(std[4])];
    console.log(`hook poolId    : ${hookId}`);
    console.log(`standard key   : [${STD_KEY[0]}, ${STD_KEY[1]}, ${STD_KEY[2]}, ${STD_KEY[3]}, ${STD_KEY[4]}]`);
    if (STD_KEY[0] !== WETH || STD_KEY[1] !== USDC) throw new Error("standard pool currencies unexpected");

    const solverUsdc = await usdc.balanceOf(solver.address);
    const solverEth = await provider.getBalance(solver.address);
    const allowance = await usdc.allowance(solver.address, ROUTER);
    const escrow = await router.erc20BorrowEscrow(solver.address, USDC);
    const whitelisted = await router.registeredSolvers(solver.address);
    console.log("\n--- solver state ---");
    console.log(`  USDC balance          : ${solverUsdc}`);
    console.log(`  ETH balance           : ${solverEth}`);
    console.log(`  USDC allowance->router: ${allowance} (need >= ${MARGIN})`);
    console.log(`  borrow escrow         : ${escrow} (need >= ${BORROW} unless whitelisted)`);
    console.log(`  groundwhitelisted     : ${whitelisted}`);

    // ── build + sign the canonical CoW order (aggregator orderflow) ──────
    const appData = await settlement.leverageCommitment(LEVERAGE);
    const validTo = Math.floor(Date.now() / 1000) + 1800;
    const order = {
        sellToken: USDC,
        buyToken: WETH,
        receiver: ethers.ZeroAddress,
        sellAmount: MARGIN,
        buyAmount: 1n, // slippage floor; solver/engine enforce output >= this
        validTo,
        appData,
        feeAmount: 0n,
        kind: "sell",
        partiallyFillable: false,
        sellTokenBalance: "erc20",
        buyTokenBalance: "erc20",
    };
    const orderTuple = [
        USDC, WETH, ethers.ZeroAddress, MARGIN, 1n, validTo, appData, 0n,
        KIND_SELL, false, BALANCE_ERC20, BALANCE_ERC20,
    ];
    const domain = { name: "Gnosis Protocol", version: "v2", chainId: CHAIN_ID, verifyingContract: GPV2 };
    const types = {
        Order: [
            { name: "sellToken", type: "address" },
            { name: "buyToken", type: "address" },
            { name: "receiver", type: "address" },
            { name: "sellAmount", type: "uint256" },
            { name: "buyAmount", type: "uint256" },
            { name: "validTo", type: "uint32" },
            { name: "appData", type: "bytes32" },
            { name: "feeAmount", type: "uint256" },
            { name: "kind", type: "string" },
            { name: "partiallyFillable", type: "bool" },
            { name: "sellTokenBalance", type: "string" },
            { name: "buyTokenBalance", type: "string" },
        ],
    };

    const signature = await trader.signTypedData(domain, { Order: types.Order }, order);
    const digestLocal = ethers.TypedDataEncoder.hash(domain, { Order: types.Order }, order);
    const digest = await settlement.hashOrder(orderTuple);
    const domainLocal = ethers.TypedDataEncoder.hashDomain(domain);
    const domainOnchain = await settlement.domainSeparator();
    console.log("\n--- order ---");
    console.log(`  domain sep onchain : ${domainOnchain}`);
    console.log(`  domain sep offline : ${domainLocal}  ${domainOnchain === domainLocal ? "(MATCH)" : "(MISMATCH!)"}`);
    console.log(`  digest onchain     : ${digest}`);
    console.log(`  digest offline     : ${digestLocal}  ${digest === digestLocal ? "(MATCH)" : "(MISMATCH!)"}`);
    if (digest !== digestLocal) throw new Error("order digest mismatch");
    if (domainOnchain !== domainLocal) throw new Error("domain separator mismatch");
    const uid = ethers.concat([digest, ethers.zeroPadValue(owner, 20), ethers.toBeHex(validTo, 4)]);
    const uidKey = ethers.keccak256(uid);
    console.log(`  order UID          : ${uid}`);
    console.log(`  signature          : ${signature.slice(0, 20)}…`);

    const fillParams = [LEVERAGE, solver.address, [WETH, USDC, 3000, 60, HOOK], STD_KEY];
    const data = settlement.interface.encodeFunctionData("fillOrder", [orderTuple, SCHEME_EIP712, signature, fillParams]);

    // ── prerequisites (only when broadcasting) ───────────────────────────
    if (BROADCAST) {
        console.log("\n--- prerequisites (solver funds margin + borrow) ---");
        if (allowance < MARGIN) {
            console.log(`  approving USDC->router (${solver.address})`);
            const tx = await new ethers.Contract(USDC, ABI.erc20, solver).approve(ROUTER, ethers.MaxUint256, GAS);
            await wait(provider, tx.hash, "solver approve USDC->router");
        } else {
            console.log("  allowance already sufficient");
        }
        if (!whitelisted && escrow < BORROW) {
            console.log(`  depositing borrow escrow ${BORROW} USDC`);
            const tx = await new ethers.Contract(ROUTER, ABI.router, solver).depositBorrowEscrow(USDC, BORROW, GAS);
            await wait(provider, tx.hash, "solver depositBorrowEscrow");
        } else {
            console.log(`  escrow/whitelist already sufficient (escrow=${escrow}, whitelisted=${whitelisted})`);
        }
    }

    // ── simulate ─────────────────────────────────────────────────────────
    console.log("\n--- eth_call simulation FROM solver ---");
    let simOk = false;
    try {
        const ret = await provider.call({ from: solver.address, to: SETTLEMENT, data });
        console.log(`  fillOrder returned (owner): ${settlement.interface.decodeFunctionResult("fillOrder", ret)[0]}`);
        simOk = true;
    } catch (e) {
        console.log(`  REVERT: ${fmtRevert(e, settlement.interface)}`);
    }

    if (!BROADCAST) {
        console.log("\n[simulate-only] set BROADCAST=1 to send prerequisites + fill.");
        return;
    }
    if (!simOk) {
        console.log("\nSimulation reverted -> NOT broadcasting the fill.");
        return;
    }

    // ── broadcast the solver fill ────────────────────────────────────────
    console.log("\n--- broadcasting solver fill (aggregator orderflow -> engine) ---");
    try {
        const est = await settlement.fillOrder.estimateGas(orderTuple, SCHEME_EIP712, signature, fillParams, { from: solver.address });
        const fee = await provider.getFeeData();
        const price = fee.maxFeePerGas ?? fee.gasPrice ?? 0n;
        console.log(`  est gas=${est}  maxFeePerGas=${price}  estCost=${est * price} wei  balance=${solverEth} wei`);
        if (est * price > solverEth) throw new Error("solver ETH insufficient for estimated fill cost");
    } catch (e) {
        console.log(`  gas estimate failed: ${fmtRevert(e, settlement.interface)}`);
        throw e;
    }
    const tx = await new ethers.Contract(SETTLEMENT, ABI.settlement, solver).fillOrder(orderTuple, SCHEME_EIP712, signature, fillParams, GAS);
    console.log(`  tx.hash = ${tx.hash}`);
    const rcpt = await wait(provider, tx.hash, "CoW fillOrder (OPEN)");

    // ── verify on-chain ──────────────────────────────────────────────────
    const pos = await hook.positions(hookId, owner);
    const debt = await hook.solverDebts(hookId, owner, solver.address);
    const psolver = await hook.positionSolver(hookId, owner);
    const filled = await settlement.filledOrders(uidKey);
    console.log("\n--- on-chain verification ---");
    console.log(`  positions(${hookId}, ${owner})`);
    console.log(`    trader     : ${pos[0]}`);
    console.log(`    collateral : ${pos[1]}`);
    console.log(`    borrowed   : ${pos[2]}`);
    console.log(`    leverage   : ${pos[3]}`);
    console.log(`    isLong     : ${pos[4]}`);
    console.log(`  solverDebts -> solver ${debt[0]}  principal ${debt[1]}`);
    console.log(`  positionSolver: ${psolver}`);
    console.log(`  filledOrders  : ${filled}`);
    console.log(`  solver USDC after : ${await usdc.balanceOf(solver.address)}`);
    console.log(`  solver escrow after: ${await router.erc20BorrowEscrow(solver.address, USDC)}`);

    const artifact = {
        chainId: CHAIN_ID,
        router: ROUTER,
        hook: HOOK,
        settlement: SETTLEMENT,
        gpv2Settlement: GPV2,
        hookPoolKey: [WETH, USDC, 3000, 60, HOOK],
        standardPoolKey: STD_KEY,
        order: {
            ...order,
            sellAmount: order.sellAmount.toString(),
            buyAmount: order.buyAmount.toString(),
            feeAmount: order.feeAmount.toString(),
            appData,
        },
        orderUid: uid,
        digest,
        signature,
        trader: owner,
        solver: solver.address,
        leverage: LEVERAGE,
        margin: MARGIN.toString(),
        borrow: BORROW.toString(),
        txHash: tx.hash,
        blockNumber: rcpt.blockNumber,
        gasUsed: rcpt.gasUsed.toString(),
        position: { trader: pos[0], collateral: pos[1].toString(), borrowed: pos[2].toString(), leverage: Number(pos[3]), isLong: pos[4] },
        solverDebt: { solver: debt[0], principal: debt[1].toString() },
        createdAt: new Date().toISOString(),
    };
    const outPath = path.resolve(process.cwd(), "cow-open.json");
    fs.writeFileSync(outPath, JSON.stringify(artifact, null, 2));
    console.log(`\nSaved artifact -> ${outPath}`);
    console.log("DONE.");
})().catch((e) => {
    console.error("FAILED:", e.shortMessage || e.message);
    if (e.stack) console.error(e.stack);
    process.exit(1);
});
