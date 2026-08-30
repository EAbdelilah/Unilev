const { ethers } = require("ethers");
require("dotenv").config({ path: "./dashboard/.env.local" });
require("dotenv").config({ path: "./.env" });

const ERC20_ABI = [
    "function balanceOf(address) view returns (uint256)",
    "function transfer(address to, uint256 amount) external returns (bool)",
];

const ROUTER_ABI = [
    "function closePosition(address hook, tuple(address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) key, address trader, address solver, uint256 minAmountOut) external returns (int128, int128)",
];

async function main() {
    const rpc = process.env.NEXT_PUBLIC_UNICHAIN_RPC_URL || "https://unichain-mainnet.g.alchemy.com/v2/MShMmpJbY-27CEbyan4Ac";
    const provider = new ethers.JsonRpcProvider(rpc);
    const privateKey = process.env.PRIVATE_KEY;
    const signer = new ethers.Wallet(privateKey, provider);

    const hookAddr = process.env.NEXT_PUBLIC_V4_HOOK_ADDRESS;
    const routerAddr = process.env.NEXT_PUBLIC_V4_ROUTER_ADDRESS;
    const traderAddr = "0x518634753C61342298c3E04326056b3Ce596a566";
    const usdcAddr = "0x078D782b760474a361dDA0AF3839290b0EF57AD6";
    const wethAddr = "0x4200000000000000000000000000000000000006";

    const usdc = new ethers.Contract(usdcAddr, ERC20_ABI, signer);
    const router = new ethers.Contract(routerAddr, ROUTER_ABI, signer);

    console.log("Hook address:", hookAddr);
    const hookUsdcBal = await usdc.balanceOf(hookAddr);
    console.log("Hook current physical USDC balance:", ethers.formatUnits(hookUsdcBal, 6));

    // Send 0.05 USDC physically to the Hook contract to cover the 1963-unit shortfall buffer
    console.log("\nSending 0.05 USDC physically to the Hook address...");
    const tx = await usdc.transfer(hookAddr, ethers.parseUnits("0.05", 6));
    console.log("Transfer tx:", tx.hash);
    await tx.wait();
    console.log("Transferred!");

    const newHookUsdc = await usdc.balanceOf(hookAddr);
    console.log("New Hook physical USDC balance:", ethers.formatUnits(newHookUsdc, 6));

    // Now test simulating closePosition!
    const [c0, c1] = usdcAddr.toLowerCase() < wethAddr.toLowerCase() ? [usdcAddr, wethAddr] : [wethAddr, usdcAddr];
    const poolKey = {
        currency0: c0,
        currency1: c1,
        fee: 3000,
        tickSpacing: 60,
        hooks: hookAddr,
    };

    console.log("\nSimulating closePosition from trader...");
    try {
        await router.closePosition.staticCall(
            hookAddr,
            poolKey,
            traderAddr,
            traderAddr,
            0,
            { from: traderAddr }
        );
        console.log("🎉🎉 closePosition simulation PASSED 100%!");
    } catch (e) {
        console.log("Simulation error:", e.message);
        if (e.data) console.log("Revert data:", e.data);
    }
}

main().catch(console.error);
