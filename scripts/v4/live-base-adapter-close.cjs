// ── Base (8453) LIVE voluntary close of an adapter-front-door open ──────────
// Reads adapter-open.json (produced by live-base-adapter-open.cjs), then unwinds
// the position through EswapRouter.closePosition while msg.sender == trader:
//
//   trader -> EswapRouter.closePosition(hook, key, trader, solver, minOut)
//           -> EswapMarginHookLogic2.closePosition -> settle
//           -> solver repaid (principal + yield); trader receives residual
//
// Env: BASE_RPC_URL, V4_ROUTER_ADDRESS, V4_HOOK_ADDRESS, BROADCAST=1
require("dotenv").config();
const fs = require("fs");
const os = require("os");
const path = require("path");
const { ethers } = require("ethers");

const RPC = process.env.BASE_RPC_URL || "https://mainnet.base.org";
const CHAIN_ID = 8453;
const USDC = ethers.getAddress("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
const WETH = ethers.getAddress("0x4200000000000000000000000000000000000006");
const BROADCAST = process.env.BROADCAST === "1";

const ROUTER_ABI = [
    "function closePosition(address hook,(address,address,uint24,int24,address) key,address trader,address solver,uint256 minAmountOut)",
];
const HOOK_ABI = [
    "function positions(bytes32,address) view returns (address,uint256,uint256,uint8,bool,uint160,int24,int24,uint128)",
    "function positionSolver(bytes32,address) view returns (address)",
    "function solverDebts(bytes32,address,address) view returns (address,uint256,uint256)",
    "function protocolFees(address) view returns (uint256)",
];
const ERC20_ABI = ["function balanceOf(address) view returns (uint256)"];
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

(async () => {
    console.log("=== LIVE adapter close (Base 8453) ===");
    const provider = new ethers.JsonRpcProvider(RPC);
    if (Number((await provider.getNetwork()).chainId) !== CHAIN_ID) throw new Error("wrong chain");

    const art = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "adapter-open.json"), "utf8"));
    const ROUTER = ethers.getAddress(art.router);
    const HOOK = ethers.getAddress(art.hook);
    const HOOK_KEY = [WETH, USDC, 3000, 60, HOOK];
    const traderAddr = ethers.getAddress(art.recipient);
    const solverAddr = ethers.getAddress(art.solver);

    const keyFile = path.join(os.tmpdir(), "eswap-adapter-recipient.json");
    const trader = new ethers.Wallet(JSON.parse(fs.readFileSync(keyFile, "utf8")).privateKey, provider);
    if (trader.address.toLowerCase() !== traderAddr.toLowerCase()) throw new Error("key/address mismatch");

    const router = new ethers.Contract(ROUTER, ROUTER_ABI, provider);
    const hook = new ethers.Contract(HOOK, HOOK_ABI, provider);
    const usdc = new ethers.Contract(USDC, ERC20_ABI, provider);
    const weth = new ethers.Contract(WETH, ERC20_ABI, provider);
    const hookId = idOf(HOOK_KEY);

    const before = {
        pos: await hook.positions(hookId, traderAddr),
        debt: await hook.solverDebts(hookId, traderAddr, solverAddr),
        traderUsdc: await usdc.balanceOf(traderAddr),
        traderWeth: await weth.balanceOf(traderAddr),
        traderEth: await provider.getBalance(traderAddr),
        solverUsdc: await usdc.balanceOf(solverAddr),
        solverWeth: await weth.balanceOf(solverAddr),
        fees: await hook.protocolFees(WETH),
    };
    console.log(`trader ${traderAddr}  solver ${solverAddr}`);
    console.log(`before: traderUsdc=${before.traderUsdc} traderWeth=${before.traderWeth} traderEth=${before.traderEth}`);
    console.log(`        solverUsdc=${before.solverUsdc} solverWeth=${before.solverWeth}`);
    console.log(`        pos.trader=${before.pos[0]} collateral=${before.pos[1]} borrowed=${before.pos[2]} lev=${before.pos[3]} long=${before.pos[4]}`);
    console.log(`        debt.solver=${before.debt[0]} principal=${before.debt[1]}`);
    if (before.pos[0] === ethers.ZeroAddress) throw new Error("no open position to close");

    const minOut = 0n;
    console.log("\n--- eth_call simulation ---");
    try {
        await router.connect(trader).closePosition.staticCall(HOOK, HOOK_KEY, traderAddr, solverAddr, minOut);
        console.log("  ok — closePosition simulates");
    } catch (e) {
        console.log(`  REVERT: ${e.shortMessage || e.message} data=${e.data}`);
        if (!BROADCAST) return;
        throw e;
    }
    if (!BROADCAST) { console.log("\n[SIMULATE] set BROADCAST=1 to send."); return; }

    console.log("\n--- broadcasting (msg.sender = trader) ---");
    const tx = await router.connect(trader).closePosition(HOOK, HOOK_KEY, traderAddr, solverAddr, minOut, { gasLimit: 900_000n });
    console.log(`  tx.hash = ${tx.hash}`);
    const rcpt = await wait(provider, tx.hash, "router.closePosition");

    const after = {
        pos: await hook.positions(hookId, traderAddr),
        traderUsdc: await usdc.balanceOf(traderAddr),
        traderWeth: await weth.balanceOf(traderAddr),
        solverUsdc: await usdc.balanceOf(solverAddr),
        solverWeth: await weth.balanceOf(solverAddr),
        fees: await hook.protocolFees(WETH),
    };
    const dUsdc = after.solverUsdc - before.solverUsdc;
    const dWeth = after.solverWeth - before.solverWeth;
    const tUsdc = after.traderUsdc - before.traderUsdc;
    const tWeth = after.traderWeth - before.traderWeth;
    console.log("\n--- on-chain verification ---");
    console.log(`  position.trader after    : ${after.pos[0]}  (zero == cleared)`);
    console.log(`  position.collateral after: ${after.pos[1]}`);
    console.log(`  solver USDC delta (repaid): ${dUsdc}   solver WETH delta: ${dWeth}`);
    console.log(`  trader USDC delta        : ${tUsdc}   trader WETH delta: ${tWeth}`);
    console.log(`  protocolFees(WETH) before/after: ${before.fees} / ${after.fees}`);

    const artifact = {
        chainId: CHAIN_ID,
        kind: "adapter-front-door-close",
        router: ROUTER, hook: HOOK, hookPoolId: hookId,
        trader: traderAddr, solver: solverAddr,
        positionBefore: { trader: before.pos[0], collateral: before.pos[1].toString(), borrowed: before.pos[2].toString() },
        solverPrincipalBefore: before.debt[1].toString(),
        solverUsdcRepaid: dUsdc.toString(), solverWethRepaid: dWeth.toString(),
        traderUsdcDelta: tUsdc.toString(), traderWethDelta: tWeth.toString(),
        feesBefore: before.fees.toString(), feesAfter: after.fees.toString(),
        positionCleared: after.pos[0] === ethers.ZeroAddress,
        txHash: tx.hash, blockNumber: rcpt.blockNumber, gasUsed: rcpt.gasUsed.toString(),
        createdAt: new Date().toISOString(),
    };
    fs.writeFileSync(path.resolve(process.cwd(), "adapter-close.json"), JSON.stringify(artifact, null, 2));
    console.log("\nSaved -> adapter-close.json");
    console.log("DONE.");
})().catch((e) => {
    console.error("FAILED:", e.shortMessage || e.message);
    if (e.data) console.error("data:", e.data);
    process.exit(1);
});
