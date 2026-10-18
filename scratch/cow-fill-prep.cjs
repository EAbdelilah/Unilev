// (2a) CoW end-to-end fill — PREP: capitalise an anonymous (unwhitelisted)
// solver: top up gas, approve the router for the MARGIN leg, bond the BORROW
// leg in erc20BorrowEscrow. Permissionless path: solver stays registered=false.
require("dotenv").config();
const fs = require("fs");
const os = require("os");
const path = require("path");
const { ethers } = require("ethers");

const RPC = process.env.BASE_RPC_URL || "https://mainnet.base.org";
const ROUTER = "0x57E75A87A62ab8Ff14C59FA10Ac2AB2c8cBD45D1";
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const VAULT_RELAYER = "0xC92E8bdf79f0507f65a392b0ab4667716BFE0110";

const LEV = 5;
const MARGIN = 40_000n; // 0.04 USDC (kept dust-sized: deployer treasury is ~0.30 USDC)
const BORROW = MARGIN * (BigInt(LEV) - 1n); // 0.16 USDC

const R_ABI = [
    "function erc20BorrowEscrow(address,address) view returns (uint256)",
    "function registeredSolvers(address) view returns (bool)",
    "function depositBorrowEscrow(address,uint256)",
    "function solverNotionalCap(address) view returns (uint256)",
];
const E_ABI = [
    "function balanceOf(address) view returns (uint256)",
    "function allowance(address,address) view returns (uint256)",
    "function approve(address,uint256) returns (bool)",
    "function transfer(address,uint256) returns (bool)",
];

const key = (f) => JSON.parse(fs.readFileSync(path.join(os.tmpdir(), f), "utf8")).privateKey;

(async () => {
    const provider = new ethers.JsonRpcProvider(RPC);
    const gov = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
    const trader = new ethers.Wallet(key("eswap-ext-trader2.json"), provider); // order owner
    const solver = new ethers.Wallet(key("eswap-ext-solver.json"), provider); // fill executor

    const router = new ethers.Contract(ROUTER, R_ABI, provider);
    const usdc = new ethers.Contract(USDC, E_ABI, provider);

    console.log(`trader(owner) = ${trader.address}`);
    console.log(`solver        = ${solver.address}`);
    console.log(`solver registeredSolvers = ${await router.registeredSolvers(solver.address)}`);
    console.log(`margin=${MARGIN} borrow=${BORROW} (lev ${LEV})`);

    const send = async (label, fn, opts = {}) => {
        const tx = await fn(opts);
        console.log(`${label} tx ${tx.hash}`);
        const rec = await tx.wait();
        if (rec.status !== 1) throw new Error(`${label} reverted`);
        console.log(`  block=${rec.blockNumber} gasUsed=${rec.gasUsed}`);
        return rec;
    };

    // 1. gas top-up for the solver (anonymous executor pays its own gas)
    const solEth = await provider.getBalance(solver.address);
    if (solEth < 2n * 10n ** 13n) {
        await send("deployer -> solver ETH", (o) => gov.sendTransaction({ to: solver.address, value: 10n ** 14n, gasLimit: 21000n, ...o }));
    } else {
        console.log(`solver ETH sufficient: ${ethers.formatEther(solEth)}`);
    }

    // 1b. fund the two actors from the treasury (dust-sized trade)
    const topUp = async (label, who, need) => {
        const bal = await usdc.balanceOf(who.address);
        if (bal >= need) { console.log(`${label} USDC ok: ${bal}`); return; }
        const amount = need - bal;
        console.log(`${label} short ${amount}, funding from deployer (treasury=${await usdc.balanceOf(gov.address)})`);
        await send(`deployer -> ${label} USDC`, (o) => usdc.connect(gov).transfer(who.address, amount, o));
        console.log(`  ${label} USDC now = ${await usdc.balanceOf(who.address)}`);
    };
    await topUp("solver", solver, MARGIN + BORROW);
    await topUp("trader", trader, MARGIN);

    // 2. trader's CoW order-book eligibility (order already posted once? check)
    console.log(`trader USDC           = ${await usdc.balanceOf(trader.address)}`);
    console.log(`trader -> VaultRelayer= ${await usdc.allowance(trader.address, VAULT_RELAYER)}`);
    if ((await usdc.allowance(trader.address, VAULT_RELAYER)) === 0n) {
        await send("trader approve VaultRelayer", (o) => usdc.connect(trader).approve(VAULT_RELAYER, ethers.MaxUint256, o));
    }

    // 3. escrow bond covering the WHOLE borrow notional (permissionless leg)
    const escrow = await router.erc20BorrowEscrow(solver.address, USDC);
    console.log(`erc20BorrowEscrow(solver, USDC) before = ${escrow}`);
    if (escrow < BORROW) {
        await router.connect(solver).depositBorrowEscrow.staticCall(USDC, BORROW - escrow);
        await send("solver approve router (escrow)", (o) => usdc.connect(solver).approve(ROUTER, BORROW - escrow, o));
        await send("solver depositBorrowEscrow", (o) => router.connect(solver).depositBorrowEscrow(USDC, BORROW - escrow, o));
    }
    console.log(`erc20BorrowEscrow(solver, USDC) after  = ${await router.erc20BorrowEscrow(solver.address, USDC)}`);

    // 4. margin approval: the borrow leg comes from escrow, the remainder
    //    (margin) is transferFrom'd from marginFunder == solver.
    const allowRouter = await usdc.allowance(solver.address, ROUTER);
    console.log(`solver -> router USDC allowance = ${allowRouter}`);
    if (allowRouter < MARGIN) {
        await send("solver approve router (margin)", (o) => usdc.connect(solver).approve(ROUTER, MARGIN, o));
    }

    console.log(`\nFINAL: escrow=${await router.erc20BorrowEscrow(solver.address, USDC)} allowRouter=${await usdc.allowance(solver.address, ROUTER)} solverUSDC=${await usdc.balanceOf(solver.address)} solverETH=${ethers.formatEther(await provider.getBalance(solver.address))}`);
    console.log(`registeredSolvers(solver) still = ${await router.registeredSolvers(solver.address)} (must stay false for the permissionless proof)`);
})().catch((e) => { console.error("FAILED:", e.shortMessage || e.message); process.exit(1); });
