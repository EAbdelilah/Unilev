const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

/**
 * Loads the contract ABI from the JSON file.
 * @param {string} contractName The name of the contract.
 * @returns {object} The contract ABI.
 */
function getAbi(contractName) {
    try {
        const abiPath = path.resolve(__dirname, `../out/${contractName}.sol/${contractName}.json`);
        const abiFile = fs.readFileSync(abiPath, "utf8");
        return JSON.parse(abiFile).abi;
    } catch (error) {
        console.error(`Error loading contract ABI for ${contractName}:`, error.message);
        console.error("Please ensure the contract has been compiled and the ABI file is in the correct path.");
        process.exit(1);
    }
}

/**
 * Loads a standard ERC20 ABI.
 * @returns {object} The ERC20 contract ABI.
 */
function getErc20Abi() {
    return [
        "function name() view returns (string)",
        "function symbol() view returns (string)",
        "function decimals() view returns (uint8)",
        "function balanceOf(address) view returns (uint256)",
        "function approve(address spender, uint256 amount) public returns (bool)",
        "function allowance(address owner, address spender) view returns (uint256)",
        "function deposit() public payable"
    ];
}

/**
 * Fetches and displays the balance of a specific ERC20 token using PriceFeedL1.
 * @param {ethers.Contract} contract The ethers.js contract instance.
 * @param {string} address The wallet address to check.
 * @param {ethers.Contract} priceFeedL1Contract The PriceFeedL1 contract instance.
 */
async function getTokenBalance(contract, address, priceFeedL1Contract) {
    const [name, symbol, decimals, balance] = await Promise.all([
        contract.name(),
        contract.symbol(),
        contract.decimals(),
        contract.balanceOf(address)
    ]);

    const formattedBalance = ethers.formatUnits(balance, decimals);

    // Fetch the USD value from the PriceFeedL1 contract
    const usdValueBigInt = await priceFeedL1Contract.getAmountInUsd(await contract.getAddress(), balance);
    const usdValue = parseFloat(ethers.formatUnits(usdValueBigInt, 18)).toFixed(2); // PriceFeedL1 returns USD with 18 decimals

    console.log(`  ${symbol.padEnd(6)} : ${formattedBalance.padEnd(20)} (~$ ${usdValue} USD)`);
}

/**
 * loads all environment variables and returns them as an object.
 */
function getEnvVars() {
    const envVars = process.env;
    const requiredVars = [
        "RPC_URL", "PRIVATE_KEY", "WETH", "DAI", "USDC", "WBTC", "PRICEFEEDL1_ADDRESS", "POSITIONS_ADDRESS", "UNISWAPV3HELPER_ADDRESS"
    ];

    for (const v of requiredVars) {
        if (!envVars[v]) {
            console.error(`Error: Ensure ${v} is set in ../.env`);
            process.exit(1);
        }
    }

    return {
        RPC_URL: envVars.RPC_URL,
        PRIVATE_KEY: envVars.PRIVATE_KEY,
        WETH: ethers.getAddress(envVars.WETH),
        DAI: ethers.getAddress(envVars.DAI),
        USDC: ethers.getAddress(envVars.USDC),
        WBTC: ethers.getAddress(envVars.WBTC),
        PRICEFEEDL1_ADDRESS: ethers.getAddress(envVars.PRICEFEEDL1_ADDRESS),
        POSITIONS_ADDRESS: ethers.getAddress(envVars.POSITIONS_ADDRESS),
        UNISWAPV3HELPER_ADDRESS: ethers.getAddress(envVars.UNISWAPV3HELPER_ADDRESS),
        MARKET_ADDRESS: ethers.getAddress(envVars.MARKET_ADDRESS),
        LIQUIDITYPOOLFACTORY_ADDRESS: ethers.getAddress(envVars.LIQUIDITYPOOLFACTORY_ADDRESS),
        FEEMANAGER_ADDRESS: ethers.getAddress(envVars.FEEMANAGER_ADDRESS)
    };
}

/**
 * Sets up provider and wallet.
 */
function setupProviderAndWallet(rpcUrl, privateKey) {
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const wallet = new ethers.Wallet(privateKey, provider);
    return { provider, wallet };
}

/**
 * Returns the Market contract ABI.
 * @returns {object} The Market ABI.
 */
function getMarketAbi() {
    return getAbi("Market");
}

/**
 * Returns the Positions contract ABI.
 * @returns {object} The Positions ABI.
 */
function getPositionsAbi() {
    return getAbi("Positions");
}

/**
 * Returns the PriceFeedL1 contract ABI.
 * @returns {object} The PriceFeedL1 ABI.
 */
function getPriceFeedL1Abi() {
    return getAbi("PriceFeedL1");
}

/**
 * Returns the LiquidityPoolFactory contract ABI.
 * @returns {object} The LiquidityPoolFactory ABI.
 */
function getLiquidityPoolFactoryAbi() {
    return getAbi("LiquidityPoolFactory");
}

/**
 * Returns the LiquidityPool contract ABI.
 * @returns {object} The LiquidityPool ABI.
 */
function getLiquidityPoolAbi() {
    return getAbi("LiquidityPool");
}

/**
 * Returns the UniswapV3Helper contract ABI.
 * @returns {object} The UniswapV3Helper ABI.
 */
function getUniswapV3HelperAbi() {
    return getAbi("UniswapV3Helper");
}

/**
 * Returns a basic Uniswap V3 Quoter ABI.
 */
function getQuoterAbi() {
    return [
        "function quoteExactInputSingle(address tokenIn, address tokenOut, uint24 fee, uint256 amountIn, uint160 sqrtPriceLimitX96) external returns (uint256 amountOut)"
    ];
}



/**
 * Calculates the amount of tokens for a given USD value.
 * @param {string} tokenAddress The address of the token.
 * @param {ethers.Contract} priceFeedL1Contract The PriceFeedL1 contract.
 * @param {string} usdAmount The amount in USD (e.g., "10").
 * @returns {Promise<bigint>} The calculated token amount.
 */
async function calculateTokenAmountFromUsd(tokenContract, priceFeedL1Contract, usdAmount) {
    const decimals = await tokenContract.decimals();
    const tokenAddress = await tokenContract.getAddress();
    const priceInUsd = await priceFeedL1Contract.getTokenLatestPriceInUsd(tokenAddress);
    const targetUsdValue = ethers.parseUnits(usdAmount, 18);
    return (targetUsdValue * BigInt(10n ** decimals)) / priceInUsd;
}

/**
 * Fetches and logs details of a position.
 * @param {string|number} posId The position ID.
 * @param {ethers.Contract} marketContract The Market contract instance.
 * @param {ethers.Contract} priceFeedL1Contract The PriceFeedL1 contract instance.
 * @param {ethers.Provider} provider The ethers provider.
 */
async function logPositionDetails(posId, marketContract, priceFeedL1Contract, provider) {
    try {
        const params = await marketContract.getPositionParams(posId);
        // params: baseToken, quoteToken, positionSize, timestamp, isShort, leverage, ...

        const [
            baseToken, quoteToken, positionSize, , isShort, leverage, , , , currentPnL, collateralLeft
        ] = params;

        // Fetch symbols
        const erc20Abi = getErc20Abi();
        const baseTokenContract = new ethers.Contract(baseToken, erc20Abi, provider);
        const quoteTokenContract = new ethers.Contract(quoteToken, erc20Abi, provider);

        const [baseSymbol, baseDecimals, quoteSymbol] = await Promise.all([
            baseTokenContract.symbol(),
            baseTokenContract.decimals(),
            quoteTokenContract.symbol()
        ]);

        const token0 = isShort ? baseToken : quoteToken;
        const token1 = isShort ? quoteToken : baseToken;
        const symbol0 = isShort ? baseSymbol : quoteSymbol;
        const symbol1 = isShort ? quoteSymbol : baseSymbol;

        // Calculate USD value
        // Note: positionSize is essentially the collateral size + borrowed (if margin) or just amount?
        // In openShortPosition, we logged 'amount'. Market.PositionOpened emits 'amount'.
        // getPositionParams returns 'positionSize'. 
        // For short: positionSize = amountBorrow (baseToken).
        // Let's rely on what we have. The user liked the previous output.
        // Previous output used `parsedLog.args.amount` which was the input/margin amount.
        // `getPositionParams` gives the Total size of the position found in the market.
        // This might be slightly different context but for "View All Positions", showing Position Size is appropriate.
        // Let's stick to showing Position Size as per `checkLiquidablePositions.js` logic but enhanced.

        // Wait, for `openShortPosition.js` we want to show the details of the *opened* position.
        // If we use the generic `logPositionDetails` which pulls from `getPositionParams`, it will show valid data.

        // Calculate USD for the Position Size
        const usdAmountBigInt = await priceFeedL1Contract.getAmountInUsd(baseToken, positionSize);
        const usdAmount = parseFloat(ethers.formatUnits(usdAmountBigInt, 18)).toFixed(2);

        // Fetch Position State
        // Enum: 0=NONE, 1=TAKE_PROFIT, 2=ACTIVE, 3=STOP_LOSS, 4=LIQUIDATABLE, 5=BAD_DEBT, 6=EXPIRED
        // We need to call Positions contract for this
        const env = getEnvVars();
        const positionsAbi = getAbi("Positions");
        const positionsContract = new ethers.Contract(env.POSITIONS_ADDRESS, positionsAbi, provider);

        const stateInt = await positionsContract.getPositionState(posId);
        const states = ["NONE", "TAKE_PROFIT", "ACTIVE", "STOP_LOSS", "LIQUIDATABLE", "BAD_DEBT", "EXPIRED"];
        const stateStr = states[Number(stateInt)] || "UNKNOWN";
        const isLiquidable = stateStr === "LIQUIDATABLE" || stateStr === "BAD_DEBT";

        console.log("\n--- Position Details ---");
        console.log(`Position ID: ${posId}`);
        console.log(`State: ${stateStr}`);
        console.log(`Liquidable: ${isLiquidable ? "Yes" : "No"}`);
        console.log(`Type: ${isShort ? "SHORT" : "LONG"} ${leverage}x`);
        console.log(`Token0 (Collateral): ${token0} (${symbol0})`);
        console.log(`Token1 (Target): ${token1} (${symbol1})`);
        console.log(`Size: ${ethers.formatUnits(positionSize, baseDecimals)} ${baseSymbol} (~$${usdAmount})`);
        console.log(`PnL: ${currentPnL}`);
        console.log(`Collateral Left: ${collateralLeft}`);
        console.log("------------------------\n");

    } catch (error) {
        console.error(`Failed to fetch details for Position ${posId}:`, error.message);
    }
}

module.exports = {
    getMarketAbi,
    getPositionsAbi,
    getPriceFeedL1Abi,
    getLiquidityPoolFactoryAbi,
    getLiquidityPoolAbi,
    getUniswapV3HelperAbi,
    getErc20Abi,
    getTokenBalance,
    getEnvVars,
    setupProviderAndWallet,
    calculateTokenAmountFromUsd,
    logPositionDetails
};
