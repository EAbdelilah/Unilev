const { ethers } = require("ethers");
require("dotenv").config();

async function main() {
    const provider = new ethers.JsonRpcProvider(process.env.POLYGON_RPC_URL);
    const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

    const envPath = require('path').resolve(__dirname, '../.env');
    const fs = require('fs');
    const envVars = fs.readFileSync(envPath, 'utf8');
    const marketMatch = envVars.match(/MARKET_ADDRESS=(0x[a-fA-F0-9]{40})/);
    
    if (!marketMatch) {
        throw new Error("MARKET_ADDRESS not found in .env");
    }
    const marketAddress = marketMatch[1];
    console.log("Market Address:", marketAddress);

    const abi = [
        "function initializeTokens(address[] calldata _tokens, address[] calldata _priceFeeds) external returns (address[])"
    ];

    const market = new ethers.Contract(marketAddress, abi, wallet);

    const tokens = [
        "0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6", // WBTC
        "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619", // WETH
        "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", // USDC
        "0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063", // DAI
        "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270"  // WPOL
    ];

    const priceFeeds = [
        "0xDE31F8bFBD8c84b5360CFACCa3539B938dd78ae6", // WBTC
        "0xF9680D99D6C9589e2a93a78A04A279e509205945", // WETH
        "0xfE4A8cc5b5B2366C1B58Bea3858e81843581b2F7", // USDC
        "0x4746DeC9e833A82EC7C2C1356372CcF2cfcD2F3D", // DAI
        "0xAB594600376Ec9fD91F8e885dADF0CE036862dE0"  // WPOL
    ];

    console.log("Initializing tokens...");
    const tx = await market.initializeTokens(tokens, priceFeeds);
    console.log("Transaction Hash:", tx.hash);
    await tx.wait();
    console.log("Tokens initialized successfully!");
}

main().catch(console.error);
