require("dotenv").config();
const { ethers } = require("ethers");

const PM = "0xE03A1074c86CFeDd5C142C4F04F1a1536e203543";
const USDC = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238";
const WETH = "0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9";
const HOOK = "0x4b531dddA7BCB2b6b6c35cCc72846f9189AeD0c8";
const SEEDER = "0x72b80A0C97D643B8644750050747C55c9F53eD5C";
const PK = process.env.PRIVATE_KEY;

const TICK = 200760, LOWER = TICK - 2400, UPPER = TICK + 2400;
const cal = Math.pow(1.0001, TICK / 2), cl = Math.pow(1.0001, LOWER / 2), cu = Math.pow(1.0001, UPPER / 2);
const liq = Math.floor(6e6 * cal * cu / (cu - cal));
const stdKey = [USDC, WETH, 500, 60, ethers.ZeroAddress];
const hookKey = [USDC, WETH, 3000, 60, HOOK];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function wait(p, hash, label, tries = 60) {
    for (let i = 0; i < tries; i++) {
        await sleep(3000);
        const r = await p.getTransactionReceipt(hash).catch(() => null);
        if (r) {
            if (r.status === 1) { console.log(`   OK ${label} (gas ${r.gasUsed})`); return; }
            throw new Error(`${label} REVERTED at ${hash}`);
        }
    }
    throw new Error(`${label} TIMEOUT ${hash}`);
}

(async () => {
    const provider = new ethers.JsonRpcProvider(process.env.ETH_SEPOLIA_RPC_URL);
    const wallet = new ethers.Wallet(PK, provider);
    const art = require("../../out/EswapLpSeeder.sol/EswapLpSeeder.json");
    const iface = new ethers.Interface(art.abi);

    const gasPrice = (await provider.getFeeData()).gasPrice * 3n;
    console.log("gasPrice:", gasPrice.toString());

    const nonce = await wallet.getNonce();
    console.log("current nonce:", nonce);

    // 1) approve USDC on seeder for PM (replacement if pending at same nonce)
    const enc = iface.encodeFunctionData("approveToken", [USDC, PM, ethers.MaxUint256]);
    const tx1 = await wallet.sendTransaction({ to: SEEDER, data: enc, gasPrice, nonce });
    console.log("approve USDC:", tx1.hash);
    await wait(provider, tx1.hash, "approve USDC");

    const enc2 = iface.encodeFunctionData("approveToken", [WETH, PM, ethers.MaxUint256]);
    const tx2 = await wallet.sendTransaction({ to: SEEDER, data: enc2, gasPrice });
    console.log("approve WETH:", tx2.hash);
    await wait(provider, tx2.hash, "approve WETH");

    const enc3 = iface.encodeFunctionData("seed", [stdKey, LOWER, UPPER, BigInt(liq)]);
    const tx3 = await wallet.sendTransaction({ to: SEEDER, data: enc3, gasPrice });
    console.log("seed standard:", tx3.hash);
    await wait(provider, tx3.hash, "seed standard");

    const enc4 = iface.encodeFunctionData("seed", [hookKey, LOWER, UPPER, BigInt(liq)]);
    const tx4 = await wallet.sendTransaction({ to: SEEDER, data: enc4, gasPrice });
    console.log("seed hook:", tx4.hash);
    await wait(provider, tx4.hash, "seed hook");

    const erc = ["function balanceOf(address) view returns (uint256)"];
    const u = new ethers.Contract(USDC, erc, provider), w = new ethers.Contract(WETH, erc, provider);
    console.log("seeder USDC:", (await u.balanceOf(SEEDER)).toString());
    console.log("seeder WETH:", (await w.balanceOf(SEEDER)).toString());
    console.log("deployer WETH:", (await w.balanceOf(wallet.address)).toString());
    console.log("deployer ETH:", (await provider.getBalance(wallet.address)).toString());
})().catch((e) => { console.error("FAILED:", e.shortMessage || e.message); process.exit(1); });