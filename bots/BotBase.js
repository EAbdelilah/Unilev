const { ethers } = require("ethers");
const {
    getEnvVars,
    setupProviderAndWallet,
    getMarketAbi,
    getPositionsAbi,
    getPriceFeedL1Abi,
    getLiquidityPoolAbi,
    getUniswapV3HelperAbi,
    getErc20Abi
} = require("../javascript/utils");

class BotBase {
    constructor(name) {
        this.name = name;
        this.env = getEnvVars();
        const { provider, wallet } = setupProviderAndWallet(this.env.RPC_URL, this.env.PRIVATE_KEY);
        this.provider = provider;
        this.wallet = wallet;

        this.market = new ethers.Contract(this.env.MARKET_ADDRESS, getMarketAbi(), this.wallet);
        this.positions = new ethers.Contract(this.env.POSITIONS_ADDRESS, getPositionsAbi(), this.wallet);
        this.priceFeed = new ethers.Contract(this.env.PRICEFEEDL1_ADDRESS, getPriceFeedL1Abi(), this.wallet);
        this.helper = new ethers.Contract(this.env.UNISWAPV3HELPER_ADDRESS, getUniswapV3HelperAbi(), this.wallet);
    }

    async log(message) {
        console.log(`[${this.name}] [${new Date().toISOString()}] ${message}`);
    }

    async error(message) {
        console.error(`[${this.name}] [${new Date().toISOString()}] ERROR: ${message}`);
    }

    async getErc20(address) {
        return new ethers.Contract(address, getErc20Abi(), this.wallet);
    }

    async run() {
        throw new Error("run() method must be implemented in the strategy bot");
    }

    start(intervalMs = 15000) {
        this.log("Starting bot...");
        this.run().catch(e => this.error(e.message));
        setInterval(() => {
            this.run().catch(e => this.error(e.message));
        }, intervalMs);
    }
}

module.exports = BotBase;
