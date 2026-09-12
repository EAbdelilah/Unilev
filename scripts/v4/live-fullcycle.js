require("dotenv").config();
const { ethers } = require("ethers");

const PM = "0xE03A1074c86CFeDd5C142C4F04F1a1536e203543";
const USDC = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238";
const WETH = "0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9";
const HOOK = "0x4b531dddA7BCB2b6b6c35cCc72846f9189AeD0c8";
const ROUTER = "0x6894be6cc476E0b1D787C0A51Ef99FEc05228C42";
const ADAPTER = "0xB9189d3ee8eED50C8A9E0Af10141Bd7CED4cfc68";
const QUOTER = "0xCA17Afa1BE6CBf7A968766b67d1EFA0650c1E302";
const SOLVER = process.env.SOLVER_ADDRESS || "0x518634753C61342298c3E04326056b3Ce596a566";

const MARGIN = 2e6; // 2 USDC
const LEVERAGE = 2;
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
    console.log("trader=solver=deployer", wallet.address, "gasPrice", gasPrice.toString());

    const erc = ["function balanceOf(address) view returns (uint256)", "function approve(address,uint256) returns (bool)"];
    const usdc = new ethers.Contract(USDC, erc, wallet);

    const hookId = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["address", "address", "uint24", "int24", "address"], [USDC, WETH, 3000, 60, HOOK]));
    console.log("hookId:", hookId.slice(0, 18), "...");

    console.log("deployer USDC:", (await usdc.balanceOf(wallet.address)).toString(), "ETH:", (await provider.getBalance(wallet.address)).toString());

    await wait(provider, (await usdc.approve(ROUTER, ethers.MaxUint256, { gasPrice })).hash, "approve router");

    const quoter = new ethers.Contract(QUOTER, ["function quoteExactInputSingleWithLeverage(address,address,uint24,uint8,int256) view returns (int128)"], provider);
    const quote = (await quoter.quoteExactInputSingleWithLeverage(USDC, WETH, 3000, LEVERAGE, BigInt(MARGIN))).toString();
    console.log("quote (WETH raw):", quote);

    const adapter = new ethers.Contract(ADAPTER, ["function exactInputSingleWithLeverage(address,address,uint24,uint8,uint256,uint256,address)"], wallet);
    await wait(provider, (await adapter.exactInputSingleWithLeverage(USDC, WETH, 3000, LEVERAGE, MARGIN, 0, wallet.address, { gasPrice })).hash, "OPEN");

    const hook = new ethers.Contract(HOOK, ["function positions(bytes32,address) view returns (address,uint256,uint256,uint8,bool,uint160,int24,int24,uint128)"], provider);
    const pos = await hook.positions(hookId, wallet.address);
    console.log("position after OPEN: trader", pos[0], "collateral", pos[1].toString(), "borrowed", pos[2].toString(), "lev", pos[3], "long", pos[4], "lpLower", pos[6], "lpUpper", pos[7]);
    if (pos[0] === ethers.ZeroAddress) throw new Error("OPEN did not create a position");

    const solverDebt = await hook.solverDebts(hookId, wallet.address, SOLVER);
    console.log("solverDebts(principal):", solverDebt[0], solverDebt[1].toString());

    const router = new ethers.Contract(ROUTER, ["function closePosition(address,tuple(address,address,uint24,int24,address),address,address,uint256)"], wallet);
    await wait(provider, (await router.closePosition(HOOK, HOOK_KEY, wallet.address, SOLVER, 0, { gasPrice })).hash, "CLOSE");

    const posAfter = await hook.positions(hookId, wallet.address);
    console.log("position after CLOSE: trader", posAfter[0], "collateral", posAfter[1].toString(), "liq", posAfter[8].toString());

    console.log("final deployer USDC:", (await usdc.balanceOf(wallet.address)).toString(), "WETH:", (await new ethers.Contract(WETH, ["function balanceOf(address) view returns (uint256)"], provider).balanceOf(wallet.address)).toString(), "ETH:", (await provider.getBalance(wallet.address)).toString());
})().catch((e) => { console.error("FAILED:", e.shortMessage || e.message); process.exit(1); });