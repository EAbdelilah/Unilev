require("dotenv").config();
const { ethers } = require("ethers");

const PM = "0xE03A1074c86CFeDd5C142C4F04F1a1536e203543";
const USDC = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238";
const WETH = "0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9";
const HOOK = "0x4b531dddA7BCB2b6b6c35cCc72846f9189AeD0c8";
const SEEDER = "0x72b80A0C97D643B8644750050747C55c9F53eD5C";

const TICK = 200760;
const LOWER = TICK - 2400;
const UPPER = TICK + 2400;
const cal = Math.pow(1.0001, TICK / 2);
const cl = Math.pow(1.0001, LOWER / 2);
const cu = Math.pow(1.0001, UPPER / 2);
const liq = Math.floor(6e6 * cal * cu / (cu - cal));
const a0 = liq * (cu - cal) / (cal * cu);
const a1 = liq * (cal - cl);

const stdKey = [USDC, WETH, 500, 60, ethers.ZeroAddress];
const hookKey = [USDC, WETH, 3000, 60, HOOK];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function sendAndWait(p, label, prom) {
    const tx = await prom;
    console.log(`-> ${label}: ${tx.hash}`);
    for (let i = 0; i < 40; i++) {
        await sleep(3000);
        const r = await p.getTransactionReceipt(tx.hash).catch(() => null);
        if (r) {
            if (r.status === 1) { console.log(`   OK (gasUsed ${r.gasUsed})`); return r; }
            throw new Error(`${label} REVERTED`);
        }
    }
    throw new Error(`${label} TIMEOUT waiting for receipt`);
}

(async () => {
    const pk = process.env.PRIVATE_KEY;
    const provider = new ethers.JsonRpcProvider(process.env.ETH_SEPOLIA_RPC_URL);
    const wallet = new ethers.Wallet(pk, provider);
    const fee = (await provider.getFeeData()).gasPrice;

    const usdc = new ethers.Contract(USDC, ["function transfer(address,uint256) returns (bool)", "function balanceOf(address) view returns (uint256)"], wallet);
    const weth = new ethers.Contract(WETH, ["function deposit() payable", "function transfer(address,uint256) returns (bool)", "function balanceOf(address) view returns (uint256)"], wallet);

    console.log("liq per pool:", liq, "a0:", a0.toFixed(0), "a1:", a1.toFixed(0));

    const usdcFund = BigInt(Math.floor(a0 * 2) + 1e6);
    const wethFund = BigInt(Math.ceil(a1 * 2 * 1.05 + 1e15));

    await sendAndWait(provider, "wrap 0.008 ETH", weth.deposit({ value: "8000000000000000", gasPrice: fee }));
    await sendAndWait(provider, "weth->seeder", weth.transfer(SEEDER, wethFund, { gasPrice: fee }));

    const art = require("../../out/EswapLpSeeder.sol/EswapLpSeeder.json");
    const seedC = new ethers.Contract(SEEDER, art.abi, wallet);
    await sendAndWait(provider, "approve USDC", seedC.approveToken(USDC, PM, ethers.MaxUint256, { gasPrice: fee }));
    await sendAndWait(provider, "approve WETH", seedC.approveToken(WETH, PM, ethers.MaxUint256, { gasPrice: fee }));

    await sendAndWait(provider, "seed standard 500/60", seedC.seed(stdKey, LOWER, UPPER, BigInt(liq), { gasPrice: fee }));
    await sendAndWait(provider, "seed hook 3000/60", seedC.seed(hookKey, LOWER, UPPER, BigInt(liq), { gasPrice: fee }));

    console.log("seeder USDC:", (await usdc.balanceOf(SEEDER)).toString());
    console.log("seeder WETH:", (await weth.balanceOf(SEEDER)).toString());
    console.log("deployer USDC:", (await usdc.balanceOf(wallet.address)).toString());
    console.log("deployer WETH:", (await weth.balanceOf(wallet.address)).toString());
    console.log("deployer ETH :", (await provider.getBalance(wallet.address)).toString());
})().catch((e) => { console.error("FAILED:", e.shortMessage || e.message); process.exit(1); });