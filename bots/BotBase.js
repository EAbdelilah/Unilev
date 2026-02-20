const { ethers } = require("ethers");
const {
    getEnvVars,
    setupProviderAndWallet,
    getMarketAbi,
    getPositionsAbi,
    getPriceFeedL1Abi,
    getLiquidityPoolAbi,
    getUniswapV3HelperAbi,
    getErc20Abi,
    getQuoterAbi,
    getStrategyExecutorAbi
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

        // Uniswap V3 Quoter
        this.quoterAddress = this.env.QUOTER_ADDRESS || "0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6";
        this.quoter = new ethers.Contract(this.quoterAddress, getQuoterAbi(), this.provider);

        this.executorAddress = this.env.STRATEGY_EXECUTOR_ADDRESS;
        if (this.executorAddress) {
            this.executor = new ethers.Contract(this.executorAddress, getStrategyExecutorAbi(), this.wallet);
        }

        this.nonce = null;

        // Production Circuit Breakers
        this.MAX_SLIPPAGE_BPS = 100n; // 1%
        this.MAX_TRADE_SIZE_USD = 50000; // $50k max per trade safety limit
    }

    async getNextNonce() {
        if (this.nonce === null) {
            this.nonce = await this.provider.getTransactionCount(this.wallet.address);
        }
        return this.nonce++;
    }

    async getGasPrice() {
        const feeData = await this.provider.getFeeData();
        return feeData.gasPrice;
    }

    async checkProfitability(expectedProfitUsd, estimatedGas) {
        const gasPrice = await this.getGasPrice();
        const gasCostEth = gasPrice * BigInt(estimatedGas);

        // Convert gasCostEth to USD (approximate using ETH/USD price from feed)
        const ethPriceUsd = await this.priceFeed.getTokenLatestPriceInUsd(this.env.WETH);
        const gasCostUsd = (gasCostEth * ethPriceUsd) / ethers.parseEther("1");

        const expectedProfitWei = ethers.parseUnits(expectedProfitUsd.toString(), 18);

        this.log(`Profit Check: Expected $${expectedProfitUsd} | Gas Cost $${ethers.formatUnits(gasCostUsd, 18)}`);

        return expectedProfitWei > gasCostUsd;
    }

    async quoteSwap(tokenIn, tokenOut, fee, amountIn) {
        try {
            return await this.quoter.quoteExactInputSingle.staticCall(
                tokenIn,
                tokenOut,
                fee,
                amountIn,
                0
            );
        } catch (e) {
            this.error(`Quoting failed: ${e.message}`);
            return 0n;
        }
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
