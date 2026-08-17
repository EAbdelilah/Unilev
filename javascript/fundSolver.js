const { ethers } = require("ethers");
require("dotenv").config();
const fs = require("fs");
const path = require("path");

async function main() {
    console.log("=========================================");
    console.log("   Eswap Margin - Solver Funding Tool");
    console.log("=========================================\n");

    const rpcUrl = process.env.POLYGON_RPC_URL || process.env.ETH_RPC_URL;
    if (!rpcUrl) throw new Error("Missing RPC URL in .env");
    
    const privateKey = process.env.PRIVATE_KEY;
    if (!privateKey) throw new Error("Missing PRIVATE_KEY in .env");

    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const solverWallet = new ethers.Wallet(privateKey, provider);
    console.log(`[+] Solver EOA: ${solverWallet.address}`);

    const balance = await provider.getBalance(solverWallet.address);
    console.log(`[+] ETH Balance: ${ethers.formatEther(balance)} ETH`);
    if (balance === 0n) {
        console.log("\n⚠️  WARNING: Solver wallet has 0 ETH for gas!");
        console.log("   Please fund it before running aggregators.\n");
    }

    // Load Router address from dashboard config if it exists
    const dashboardEnvPath = path.join(__dirname, "../dashboard/.env.local");
    let routerAddress;
    if (fs.existsSync(dashboardEnvPath)) {
        const envContent = fs.readFileSync(dashboardEnvPath, "utf-8");
        const match = envContent.match(/NEXT_PUBLIC_ESWAP_ROUTER_ADDRESS=(0x[a-fA-F0-9]{40})/);
        if (match) routerAddress = match[1];
    }
    
    if (!routerAddress) {
        console.log("[-] Could not find Router address in dashboard/.env.local.");
        console.log("    Please make sure you have deployed the contracts first!");
        return;
    }
    console.log(`[+] EswapRouter: ${routerAddress}`);

    // Load supported tokens to approve
    const tokensPath = path.join(__dirname, "../dashboard/src/config/supported_tokens.json");
    if (!fs.existsSync(tokensPath)) {
        console.log("[-] Could not find supported_tokens.json!");
        return;
    }
    
    const tokens = JSON.parse(fs.readFileSync(tokensPath, "utf-8"));
    
    console.log("\n--- Checking Allowances ---");
    const erc20Abi = [
        "function approve(address spender, uint256 amount) public returns (bool)",
        "function allowance(address owner, address spender) public view returns (uint256)",
        "function balanceOf(address account) public view returns (uint256)"
    ];

    for (const token of tokens) {
        // Skip native ETH
        if (token.address.toLowerCase() === "0x0000000000000000000000000000000000000000") continue;

        const contract = new ethers.Contract(token.address, erc20Abi, solverWallet);
        const tokenBalance = await contract.balanceOf(solverWallet.address);
        console.log(`\n${token.symbol}: ${ethers.formatUnits(tokenBalance, token.decimals)}`);

        if (tokenBalance === 0n) {
            console.log(`⚠️  WARNING: 0 balance for ${token.symbol}. Solver will not be able to execute trades needing this token.`);
        }

        const allowance = await contract.allowance(solverWallet.address, routerAddress);
        if (allowance < ethers.MaxUint256 / 2n) {
            console.log(`[>] Approving ${token.symbol} for Router...`);
            const tx = await contract.approve(routerAddress, ethers.MaxUint256);
            await tx.wait();
            console.log(`[+] Approved ${token.symbol}`);
        } else {
            console.log(`[+] ${token.symbol} already approved.`);
        }
    }

    console.log("\n=========================================");
    console.log(" Solver is fully approved and ready!");
    console.log("=========================================\n");
}

main().catch(console.error);
