const { ethers } = require("ethers");

const RPC_URL = "https://polygon-mainnet.g.alchemy.com/v2/MShMmpJbY-27CEbyan4Ac";
const FACTORY_ADDRESS = "0x1F98431c8aD98523631AE4a59f267346ea31F984";
const PRICEFEED_ADDRESS = "0x015c3722683b54fff1491a92bfd9c72ca3c84cc4";

const TOKENS = {
    WBTC: { address: "0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6", decimals: 8 },
    WETH: { address: "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619", decimals: 18 },
    USDC: { address: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", decimals: 6 },
    DAI:  { address: "0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063", decimals: 18 },
    WPOL: { address: "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270", decimals: 18 }
};

const PAIRS = [
    { base: "WBTC", quote: "USDC", fee: 3000 },
    { base: "WETH", quote: "USDC", fee: 3000 },
    { base: "WETH", quote: "WBTC", fee: 3000 },
    { base: "WPOL", quote: "USDC", fee: 3000 },
    { base: "WBTC", quote: "USDC", fee: 500 }, // maybe different fee tier
    { base: "WETH", quote: "USDC", fee: 500 },
];

const factoryAbi = ["function getPool(address,address,uint24) view returns (address)"];
const poolAbi = ["function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)"];
const priceFeedAbi = ["function getPairLatestPrice(address _token0, address _token1) view returns (uint256)"];

async function main() {
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const factory = new ethers.Contract(FACTORY_ADDRESS, factoryAbi, provider);
    const priceFeed = new ethers.Contract(PRICEFEED_ADDRESS, priceFeedAbi, provider);

    console.log("Checking Live Oracle vs Uniswap V3 Pool Price Deviations on Polygon\n");
    console.log(`| ${"Pair".padEnd(12)} | ${"Fee".padEnd(5)} | ${"Oracle Price".padEnd(15)} | ${"Pool Price".padEnd(15)} | ${"Deviation".padEnd(10)} |`);
    console.log(`|${"-".repeat(14)}|${"-".repeat(7)}|${"-".repeat(17)}|${"-".repeat(17)}|${"-".repeat(12)}|`);

    for (const pair of PAIRS) {
        const base = TOKENS[pair.base];
        const quote = TOKENS[pair.quote];

        // 1. Get Oracle Price
        let oraclePriceNum = 0;
        try {
            const oraclePrice = await priceFeed.getPairLatestPrice(base.address, quote.address);
            // Oracle returns price with quote token decimals (scaled by 10^quoteDecimals) per 1 base token.
            oraclePriceNum = Number(oraclePrice) / (10 ** quote.decimals);
        } catch (e) {
            console.log(`| ${pair.base + "/" + pair.quote.padEnd(7)} | ${pair.fee.toString().padEnd(5)} | Oracle Error`.padEnd(68) + "|");
            continue;
        }

        // 2. Get Pool Address
        const poolAddress = await factory.getPool(base.address, quote.address, pair.fee);
        if (poolAddress === ethers.ZeroAddress) {
            console.log(`| ${pair.base + "/" + pair.quote.padEnd(7)} | ${pair.fee.toString().padEnd(5)} | No Pool`.padEnd(68) + "|");
            continue;
        }

        // 3. Get Pool Price
        const pool = new ethers.Contract(poolAddress, poolAbi, provider);
        const { sqrtPriceX96 } = await pool.slot0();
        
        // sqrtPriceX96 is Q64.96 representing sqrt(token1/token0).
        // token0 is the one with smaller address.
        const isBaseToken0 = BigInt(base.address) < BigInt(quote.address);
        
        // Math to get human readable price
        const num = Number(sqrtPriceX96) / (2**96);
        let priceToken1PerToken0 = num * num;
        
        // Adjust for decimals
        const token0Decimals = isBaseToken0 ? base.decimals : quote.decimals;
        const token1Decimals = isBaseToken0 ? quote.decimals : base.decimals;
        
        // price of Token0 in terms of Token1
        priceToken1PerToken0 = priceToken1PerToken0 * (10 ** (token0Decimals - token1Decimals));

        // We want price of Base in terms of Quote
        const poolPriceNum = isBaseToken0 ? priceToken1PerToken0 : (1 / priceToken1PerToken0);

        // 4. Calculate Deviation
        const deviation = Math.abs(poolPriceNum - oraclePriceNum) / oraclePriceNum * 100;

        console.log(`| ${(pair.base + "/" + pair.quote).padEnd(12)} | ${pair.fee.toString().padEnd(5)} | ${oraclePriceNum.toFixed(4).padEnd(15)} | ${poolPriceNum.toFixed(4).padEnd(15)} | ${deviation.toFixed(3) + "%".padEnd(9)} |`);
    }
}

main().catch(console.error);
