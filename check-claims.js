const { ethers } = require("ethers");
require("dotenv").config({ path: "./dashboard/.env.local" });

const MANAGER_ABI = [
    "function balanceOf(address owner, uint256 id) view returns (uint256)",
];

const HOOK_ABI = [
    "function manager() view returns (address)",
    "function positions(bytes32 poolId, address trader) view returns (uint8 leverage, bool isShort, uint256 collateralAmount, uint256 borrowAmount, uint256 entryPrice, uint256 liquidationPrice, uint256 createdAt)",
    "function _claimBalances(address trader, uint256 id) view returns (uint256)",
];

async function main() {
    const rpc = process.env.NEXT_PUBLIC_UNICHAIN_RPC_URL || "https://unichain-mainnet.g.alchemy.com/v2/MShMmpJbY-27CEbyan4Ac";
    const provider = new ethers.JsonRpcProvider(rpc);

    const hookAddr = process.env.NEXT_PUBLIC_V4_HOOK_ADDRESS;
    const traderAddr = "0x518634753C61342298c3E04326056b3Ce596a566";
    const wethAddr = "0x4200000000000000000000000000000000000006";
    const usdcAddr = "0x078D782b760474a361dDA0AF3839290b0EF57AD6";

    const hook = new ethers.Contract(hookAddr, HOOK_ABI, provider);
    const managerAddr = await hook.manager();
    const manager = new ethers.Contract(managerAddr, MANAGER_ABI, provider);

    const wethClaimId = BigInt(wethAddr);
    const usdcClaimId = BigInt(usdcAddr);

    const [hookWethClaim, hookUsdcClaim] = await Promise.all([
        manager.balanceOf(hookAddr, wethClaimId),
        manager.balanceOf(hookAddr, usdcClaimId),
    ]);

    console.log("Hook address:", hookAddr);
    console.log("Manager address:", managerAddr);
    console.log("Hook 6909 Claim Balance of WETH:", hookWethClaim.toString());
    console.log("Hook 6909 Claim Balance of USDC:", hookUsdcClaim.toString());
}

main().catch(console.error);
