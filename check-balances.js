const { ethers } = require("ethers");
require("dotenv").config({ path: "./dashboard/.env.local" });

const ERC20_ABI = [
    "function balanceOf(address) view returns (uint256)",
];

const HOOK_ABI = [
    "function manager() view returns (address)",
];

async function main() {
    const rpc = process.env.NEXT_PUBLIC_UNICHAIN_RPC_URL || "https://unichain-mainnet.g.alchemy.com/v2/MShMmpJbY-27CEbyan4Ac";
    const provider = new ethers.JsonRpcProvider(rpc);
    const hookAddr = process.env.NEXT_PUBLIC_V4_HOOK_ADDRESS;
    const usdcAddr = "0x078D782b760474a361dDA0AF3839290b0EF57AD6";
    const wethAddr = "0x4200000000000000000000000000000000000006";

    const hook = new ethers.Contract(hookAddr, HOOK_ABI, provider);
    const managerAddr = await hook.poolManager();

    const usdc = new ethers.Contract(usdcAddr, ERC20_ABI, provider);
    const weth = new ethers.Contract(wethAddr, ERC20_ABI, provider);

    const [hookUsdc, hookWeth, pmUsdc, pmWeth] = await Promise.all([
        usdc.balanceOf(hookAddr),
        weth.balanceOf(hookAddr),
        usdc.balanceOf(managerAddr),
        weth.balanceOf(managerAddr),
    ]);

    console.log("Hook:", hookAddr);
    console.log("PoolManager:", managerAddr);
    console.log("\n--- HOOK ERC20 BALANCES ---");
    console.log("Hook USDC balance:", ethers.formatUnits(hookUsdc, 6));
    console.log("Hook WETH balance:", ethers.formatEther(hookWeth));
    console.log("\n--- POOLMANAGER ERC20 BALANCES ---");
    console.log("PoolManager USDC balance:", ethers.formatUnits(pmUsdc, 6));
    console.log("PoolManager WETH balance:", ethers.formatEther(pmWeth));
}

main().catch(console.error);
