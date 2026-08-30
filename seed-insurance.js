const { ethers } = require("ethers");
require("dotenv").config({ path: "./dashboard/.env.local" });
require("dotenv").config({ path: "./.env" });

const HOOK_ABI = [
    "function insuranceFund(address) view returns (uint256)",
    "function seedInsuranceFund(address currency, uint256 amount) external",
    "function positions(bytes32 poolId, address trader) view returns (uint8 leverage, bool isShort, uint256 collateralAmount, uint256 borrowAmount, uint256 entryPrice, uint256 liquidationPrice, uint256 createdAt)",
];

const ERC20_ABI = [
    "function balanceOf(address) view returns (uint256)",
    "function approve(address spender, uint256 amount) external returns (bool)",
    "function allowance(address owner, address spender) view returns (uint256)",
];

const ROUTER_ABI = [
    "function closePosition(tuple(address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) key, address trader, uint256 deadline, uint256 minAmountOut) external returns (int128, int128)",
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

    console.log("=== CHECKING INSURANCE FUND & CLOSING POSITION ===");
    console.log("Signer:", signer.address);
    console.log("Hook:", hookAddr);

    const hook = new ethers.Contract(hookAddr, HOOK_ABI, provider);
    const usdc = new ethers.Contract(usdcAddr, ERC20_ABI, provider);
    const weth = new ethers.Contract(wethAddr, ERC20_ABI, provider);

    const [insuranceUsdc, insuranceWeth, signerUsdc] = await Promise.all([
        hook.insuranceFund(usdcAddr),
        hook.insuranceFund(wethAddr),
        usdc.balanceOf(signer.address),
    ]);

    console.log("Current Insurance Fund (USDC):", insuranceUsdc.toString(), `($${ethers.formatUnits(insuranceUsdc, 6)})`);
    console.log("Current Insurance Fund (WETH):", insuranceWeth.toString(), `(${ethers.formatEther(insuranceWeth)} WETH)`);
    console.log("Signer USDC balance:", ethers.formatUnits(signerUsdc, 6));

    // Seed 0.05 USDC into the insurance fund
    const seedAmount = ethers.parseUnits("0.05", 6);
    if (insuranceUsdc === 0n && signerUsdc >= seedAmount) {
        console.log("\n--- Seeding Insurance Fund with 0.05 USDC ---");
        const allowance = await usdc.allowance(signer.address, hookAddr);
        if (allowance < seedAmount) {
            console.log("Approving USDC to Hook...");
            const appTx = await usdc.connect(signer).approve(hookAddr, ethers.MaxUint256);
            await appTx.wait();
            console.log("Approved!");
        }

        console.log("Calling seedInsuranceFund...");
        const hookWithSigner = hook.connect(signer);
        const seedTx = await hookWithSigner.seedInsuranceFund(usdcAddr, seedAmount);
        console.log("Seed Tx:", seedTx.hash);
        await seedTx.wait();
        console.log("✅ Insurance fund seeded!");

        const newInsurance = await hook.insuranceFund(usdcAddr);
        console.log("New Insurance Fund (USDC):", newInsurance.toString());
    }

    // Now test simulating closePosition
    console.log("\n--- Simulating Close Position for Trader ---");
    const router = new ethers.Contract(routerAddr, ROUTER_ABI, provider);
    const [c0, c1] = usdcAddr.toLowerCase() < wethAddr.toLowerCase() ? [usdcAddr, wethAddr] : [wethAddr, usdcAddr];

    const poolKey = {
        currency0: c0,
        currency1: c1,
        fee: 3000,
        tickSpacing: 60,
        hooks: hookAddr,
    };

    const deadline = Math.floor(Date.now() / 1000) + 3600;
    try {
        await router.closePosition.staticCall(poolKey, traderAddr, deadline, 0, { from: traderAddr });
        console.log("✅ closePosition simulation SUCCEEDED!");
    } catch (err) {
        console.log("❌ closePosition simulation failed:", err.message);
        if (err.data) console.log("Revert data:", err.data);
    }
}

main().catch(console.error);
