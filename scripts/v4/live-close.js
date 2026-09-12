require("dotenv").config();
const { ethers } = require("ethers");

const USDC = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238";
const WETH = "0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9";
const HOOK = "0x4b531dddA7BCB2b6b6c35cCc72846f9189AeD0c8";
const ROUTER = "0x6894be6cc476E0b1D787C0A51Ef99FEc05228C42";
const SOLVER = "0x518634753C61342298c3E04326056b3Ce596a566";

const HOOK_KEY = [USDC, WETH, 3000, 60, HOOK];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function wait(p, hash, label) {
    for (let i = 0; i < 60; i++) {
        await sleep(3000);
        const r = await p.getTransactionReceipt(hash).catch(() => null);
        if (r) {
            if (r.status === 1) { console.log(`OK   ${label} (gas ${r.gasUsed}) ${hash}`); return r; }
            throw new Error(`${label} REVERTED ${hash}`);
        }
    }
    throw new Error(`${label} TIMEOUT ${hash}`);
}

(async () => {
    const provider = new ethers.JsonRpcProvider(process.env.ETH_SEPOLIA_RPC_URL);
    const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
    const gasPrice = (await provider.getFeeData()).gasPrice * 2n;
    const hookId = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["address", "address", "uint24", "int24", "address"], [USDC, WETH, 3000, 60, HOOK]));

    const hook = new ethers.Contract(HOOK, [
        "function positions(bytes32,address) view returns (address,uint256,uint256,uint8,bool,uint160,int24,int24,uint128)",
        "function solverDebts(bytes32,address,address) view returns (address,uint256)"
    ], provider);
    const pos = await hook.positions(hookId, wallet.address);
    console.log("before CLOSE: trader", pos[0], "collateral", pos[1].toString(), "borrowed", pos[2].toString(), "liq", pos[8].toString());
    const debt = await hook.solverDebts(hookId, wallet.address, SOLVER);
    console.log("solverDebts: solver", debt[0], "principal", debt[1].toString());

    const router = new ethers.Contract(ROUTER, ["function closePosition(address,tuple(address,address,uint24,int24,address),address,address,uint256)"], wallet);
    await wait(provider, (await router.closePosition(HOOK, HOOK_KEY, wallet.address, SOLVER, 0, { gasPrice })).hash, "CLOSE");

    const posAfter = await hook.positions(hookId, wallet.address);
    console.log("after CLOSE: trader", posAfter[0], "collateral", posAfter[1].toString(), "liq", posAfter[8].toString());
    const erc = ["function balanceOf(address) view returns (uint256)"];
    const u = new ethers.Contract(USDC, erc, provider), w = new ethers.Contract(WETH, erc, provider);
    console.log("final USDC:", (await u.balanceOf(wallet.address)).toString(), "WETH:", (await w.balanceOf(wallet.address)).toString(), "ETH:", (await provider.getBalance(wallet.address)).toString());
})().catch((e) => { console.error("FAILED:", e.shortMessage || e.message); process.exit(1); });