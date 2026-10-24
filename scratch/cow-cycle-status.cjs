// Balance/state probe for the full CoW demand->supply cycle.
require("dotenv").config();
const fs = require("fs");
const os = require("os");
const path = require("path");
const { ethers } = require("ethers");

const RPC = process.env.BASE_RPC_URL || "https://mainnet.base.org";
const ROUTER = "0x57E75A87A62ab8Ff14C59FA10Ac2AB2c8cBD45D1";
const SETTLEMENT = "0x8e54f58AaD4bdc29D18C6b02064e1c481AfCCe46";
const VAULT_RELAYER = "0xC92E8bdf79f0507f65a392b0ab4667716BFE0110";
const USDC = ethers.getAddress("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");

const R_ABI = [
    "function erc20BorrowEscrow(address,address) view returns (uint256)",
    "function registeredSolvers(address) view returns (bool)",
];
const E_ABI = ["function balanceOf(address) view returns (uint256)", "function allowance(address,address) view returns (uint256)"];
const key = (f) => JSON.parse(fs.readFileSync(path.join(os.tmpdir(), f), "utf8")).privateKey;

(async () => {
    const provider = new ethers.JsonRpcProvider(RPC);
    const gov = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
    const trader = new ethers.Wallet(key("eswap-ext-trader2.json"), provider);
    const solver = new ethers.Wallet(key("eswap-ext-solver.json"), provider);

    const router = new ethers.Contract(ROUTER, R_ABI, provider);
    const usdc = new ethers.Contract(USDC, E_ABI, provider);

    const row = async (label, w) => {
        const [bal, eth, esc, allow] = await Promise.all([
            usdc.balanceOf(w.address),
            provider.getBalance(w.address),
            router.erc20BorrowEscrow(w.address, USDC),
            usdc.allowance(w.address, ROUTER),
        ]);
        console.log(`${label.padEnd(8)} ${w.address}  USDC=${bal}  ETH=${eth}  escrow=${esc}  allowRouter=${allow}`);
    };
    await row("deployer", gov);
    const fee = await provider.getFeeData();
    console.log(`gas: maxFee=${fee.maxFeePerGas} maxPriority=${fee.maxPriorityFeePerGas} gasPrice=${fee.gasPrice}`);
    await row("trader", trader);
    await row("solver", solver);
    console.log(`trader -> VaultRelayer allowance = ${await usdc.allowance(trader.address, VAULT_RELAYER)}`);
    console.log(`registeredSolvers(solver)       = ${await router.registeredSolvers(solver.address)}`);

    // previous position (same trader + hook pool) for context
    const HOOK = "0x6f98Ea19e522Ecc706E0Fb1574BDA8D32aC510C8";
    const WETH = ethers.getAddress("0x4200000000000000000000000000000000000006");
    const POOL_ID = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
            ["address", "address", "uint24", "int24", "address"],
            [WETH, USDC, 3000, 60, HOOK],
        ),
    );
    const hook = new ethers.Contract(HOOK, ["function positions(bytes32,address) view returns (address,uint256,uint256,uint8,bool,uint160,int24,int24,uint128)"], provider);
    const pos = await hook.positions(POOL_ID, trader.address);
    console.log(`prev position(trader2): collateral=${pos[1]} borrowed=${pos[2]} lev=${pos[3]} isLong=${pos[4]}`);

    // trader1 (fresh actor for this cycle) + collateral floor
    const trader1 = new ethers.Wallet(key("eswap-ext-trader.json"), provider);
    const pos1 = await hook.positions(POOL_ID, trader1.address);
    console.log(`trader1 ${trader1.address}: USDC=${await usdc.balanceOf(trader1.address)} VRallow=${await usdc.allowance(trader1.address, VAULT_RELAYER)}`);
    console.log(`trader1 position: collateral=${pos1[1]} borrowed=${pos1[2]} lev=${pos1[3]}`);
    const hookFull = new ethers.Contract(HOOK, [
        "function minCollateralUsd() view returns (uint256)",
        "function MIN_COLLATERAL() view returns (uint256)",
        "function defaultMaxLeverage() view returns (uint8)",
    ], provider);
    console.log(`hook minCollateralUsd = ${await hookFull.minCollateralUsd()} ($${ethers.formatUnits(await hookFull.minCollateralUsd(), 18)})`);
    console.log(`hook MIN_COLLATERAL   = ${await hookFull.MIN_COLLATERAL()}`);
    console.log(`hook defaultMaxLeverage = ${await hookFull.defaultMaxLeverage()}`);

    // other candidate actors: do any of them have a free position slot?
    for (const [name, addr] of [
        ["cow-owner", "0x233a579E70c7D689f20f05800f0dB12c3B90aa6C"],
        ["smart-owner", "0x457d474F0E26cDb652D8D47597EbD998A5E75aF6"],
        ["adapter-rcpt", "0x9F3CA377F06c709080b4c11c73832FD16a74c48a"],
        ["watched-trader", "0xd9Aba9723d14b36588bcF9D47c2FF355EEC47F3c"],
    ]) {
        const p = await hook.positions(POOL_ID, addr);
        console.log(`${name.padEnd(14)} ${addr}: collateral=${p[1]} borrowed=${p[2]} lev=${p[3]} USDC=${await usdc.balanceOf(addr)}`);
    }
})().catch((e) => { console.error("FAILED:", e.shortMessage || e.message); process.exit(1); });
