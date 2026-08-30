const { ethers } = require("ethers");
require("dotenv").config({ path: "./dashboard/.env.local" });

const ROUTER_ABI = [
    "function closePosition(address hook, tuple(address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) key, address trader, address solver, uint256 minAmountOut) external",
];

const HOOK_ABI = [
    "function positions(bytes32 poolId, address trader) view returns (uint8 leverage, bool isShort, uint256 collateralAmount, uint256 borrowAmount, uint256 entryPrice, uint256 liquidationPrice, uint256 createdAt)",
    "function positionSolver(bytes32 poolId, address trader) view returns (address)",
    "function insuranceFund(address) view returns (uint256)",
];

async function main() {
    const rpc = process.env.NEXT_PUBLIC_UNICHAIN_RPC_URL || "https://unichain-mainnet.g.alchemy.com/v2/MShMmpJbY-27CEbyan4Ac";
    const provider = new ethers.JsonRpcProvider(rpc);
    const routerAddr = process.env.NEXT_PUBLIC_V4_ROUTER_ADDRESS;
    const hookAddr = process.env.NEXT_PUBLIC_V4_HOOK_ADDRESS;
    const traderAddr = "0x518634753C61342298c3E04326056b3Ce596a566";
    const usdcAddr = "0x078D782b760474a361dDA0AF3839290b0EF57AD6";
    const wethAddr = "0x4200000000000000000000000000000000000006";

    const hook = new ethers.Contract(hookAddr, HOOK_ABI, provider);
    const router = new ethers.Contract(routerAddr, ROUTER_ABI, provider);

    const [c0, c1] = usdcAddr.toLowerCase() < wethAddr.toLowerCase() ? [usdcAddr, wethAddr] : [wethAddr, usdcAddr];
    const poolKey = {
        currency0: c0,
        currency1: c1,
        fee: 3000,
        tickSpacing: 60,
        hooks: hookAddr,
    };

    const poolId = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
            ["address", "address", "uint24", "int24", "address"],
            [c0, c1, 3000, 60, hookAddr]
        )
    );

    const solver = await hook.positionSolver(poolId, traderAddr);
    const insurance = await hook.insuranceFund(usdcAddr);

    console.log("PoolId:", poolId);
    console.log("Position Solver on-chain:", solver);
    console.log("Insurance Fund (USDC):", insurance.toString());

    console.log("\nTesting closePosition with solver = ZeroAddress...");
    try {
        await router.closePosition.staticCall(
            hookAddr,
            poolKey,
            traderAddr,
            ethers.ZeroAddress,
            0,
            { from: traderAddr }
        );
        console.log("✅ Static call with ZeroAddress SUCCEEDED!");
    } catch (e) {
        console.log("❌ Static call with ZeroAddress failed:", e.message);
    }

    console.log("\nTesting closePosition with solver =", solver, "...");
    try {
        await router.closePosition.staticCall(
            hookAddr,
            poolKey,
            traderAddr,
            solver,
            0,
            { from: traderAddr }
        );
        console.log("✅ Static call with solver address SUCCEEDED!");
    } catch (e) {
        console.log("❌ Static call with solver failed:", e.message);
    }
}

main().catch(console.error);
