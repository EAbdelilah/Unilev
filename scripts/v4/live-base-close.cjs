// ── Base (8453) LIVE voluntary close ────────────────────────────────────────
// Closes GAP-4 (unwind): after the GAP-6 adapter-external open, the EXTERNAL
// TRADER unwinds via EswapRouter.closePosition -> hook unwind -> solver repaid
// its principal + accumulated yield, trader receives the residual.
//
//   EXTERNAL TRADER (msg.sender == trader, trader-only gate)
//        -> EswapRouter.closePosition(hook, key, trader, solver, minOut)
//        -> EswapMarginHookLogic2.closePosition: _unwindBand -> _settle
//        -> SOLVER repaid (principal + yield); trader gets netToTrader
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
const ROUTER = ethers.getAddress(process.env.V4_ROUTER_ADDRESS || "0x57E75A87A62ab8Ff14C59FA10Ac2AB2c8cBD45D1");
const HOOK = ethers.getAddress(process.env.V4_HOOK_ADDRESS || "0x6f98Ea19e522Ecc706E0Fb1574BDA8D32aC510C8");
const BROADCAST = process.env.BROADCAST === "1";

const HOOK_KEY = [WETH, USDC, 3000, 60, HOOK];
const ROUTER_ABI = [
    "function closePosition(address hook,(address,address,uint24,int24,address) key,address trader,address solver,uint256 minAmountOut)",
];
const ESWAP_HOOK_ABI = [
    "function positions(bytes32,address) view returns (address,uint256,uint256,uint8,bool,uint160,int24,int24,uint128)",
    "function positionSolver(bytes32,address) view returns (address)",
    "function solverDebts(bytes32,address,address) view returns (address,uint256,uint256)",
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
    console.log("=== LIVE voluntary close (Base 8453) ===");
    const provider = new ethers.JsonRpcProvider(RPC);
    if (Number((await provider.getNetwork()).chainId) !== CHAIN_ID) throw new Error("wrong chain");

    const art = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "adapter-external.json"), "utf8"));
    const traderAddr = ethers.getAddress(art.externalTrader);
    const solverAddr = ethers.getAddress(art.externalSolver);
    const traderInfo = JSON.parse(fs.readFileSync(path.join(os.tmpdir(), "eswap-ext-trader2.json"), "utf8"));
    const trader = new ethers.Wallet(traderInfo.privateKey, provider);

    if (trader.address.toLowerCase() !== traderAddr.toLowerCase()) throw new Error("key/address mismatch");

    const router = new ethers.Contract(ROUTER, ROUTER_ABI, provider);
    const hook = new ethers.Contract(HOOK, ESWAP_HOOK_ABI, provider);
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
    };
    console.log(`trader ${traderAddr}  solver ${solverAddr}`);
    console.log(`before: traderUsdc=${before.traderUsdc} traderWeth=${before.traderWeth} traderEth=${before.traderEth}`);
    console.log(`        solverUsdc=${before.solverUsdc} solverWeth=${before.solverWeth}`);
    console.log(`        pos.trader=${before.pos[0]} collateral=${before.pos[1]} borrowed=${before.pos[2]} lev=${before.pos[3]} long=${before.pos[4]}`);
    console.log(`        debt.solver=${before.debt[0]} principal=${before.debt[1]}`);
    if (before.pos[0] === ethers.ZeroAddress) throw new Error("no open position to close");

    // minAmountOut = 0 for a voluntary close (trader accepts any residual).
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

    console.log("\n--- broadcasting (msg.sender = external trader) ---");
    const tx = await router.connect(trader).closePosition(HOOK, HOOK_KEY, traderAddr, solverAddr, minOut, { gasLimit: 900_000n });
    console.log(`  tx.hash = ${tx.hash}`);
    const rcpt = await wait(provider, tx.hash, "router.closePosition");

    const after = {
        pos: await hook.positions(hookId, traderAddr),
        traderUsdc: await usdc.balanceOf(traderAddr),
        traderWeth: await weth.balanceOf(traderAddr),
        traderEth: await provider.getBalance(traderAddr),
        solverUsdc: await usdc.balanceOf(solverAddr),
        solverWeth: await weth.balanceOf(solverAddr),
    };
    const dUsdc = after.solverUsdc - before.solverUsdc;
    const dWeth = after.solverWeth - before.solverWeth;
    const tUsdc = after.traderUsdc - before.traderUsdc;
    const tWeth = after.traderWeth - before.traderWeth;
    console.log("\n--- on-chain verification ---");
    console.log(`  position.trader after   : ${after.pos[0]}  (zero == cleared)`);
    console.log(`  position.collateral after: ${after.pos[1]}`);
    console.log(`  solver USDC delta (repaid): ${dUsdc}   solver WETH delta: ${dWeth}`);
    console.log(`  trader USDC delta        : ${tUsdc}   trader WETH delta: ${tWeth}`);
    console.log(`  trader ETH after         : ${after.traderEth}`);

    const artifact = {
        chainId: CHAIN_ID,
        kind: "external-trader-voluntary-close",
        gap: "GAP-4",
        router: ROUTER, hook: HOOK, hookPoolId: hookId,
        externalTrader: traderAddr, externalSolver: solverAddr, caller: traderAddr,
        positionBefore: { trader: before.pos[0], collateral: before.pos[1].toString(), borrowed: before.pos[2].toString() },
        solverPrincipalBefore: before.debt[1].toString(),
        solverUsdcRepaid: dUsdc.toString(), solverWethRepaid: dWeth.toString(),
        traderUsdcDelta: tUsdc.toString(), traderWethDelta: tWeth.toString(),
        positionCleared: after.pos[0] === ethers.ZeroAddress,
        txHash: tx.hash, blockNumber: rcpt.blockNumber, gasUsed: rcpt.gasUsed.toString(),
        createdAt: new Date().toISOString(),
    };
    fs.writeFileSync(path.resolve(process.cwd(), "close.json"), JSON.stringify(artifact, null, 2));
    console.log("\nSaved -> close.json");
    console.log("DONE.");
})().catch((e) => {
    console.error("FAILED:", e.shortMessage || e.message);
    if (e.data) console.error("data:", e.data);
    process.exit(1);
});
