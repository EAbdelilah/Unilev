const BotBase = require("./BotBase");
const { ethers } = require("ethers");

class ArbitrageBot extends BotBase {
    constructor() {
        super("ArbitrageBot");
    }

    async run() {
        this.log("Checking for arbitrage opportunities...");

        const assets = [
            { address: this.env.WBTC, symbol: "WBTC", decimals: 8 },
            { address: this.env.USDC, symbol: "USDC", decimals: 6 }
        ];

        for (const asset of assets) {
            // 1. Get Oracle Price (Chainlink) - This is the "True" price Eswap uses for liquidations
            const oraclePrice = await this.priceFeed.getPairLatestPrice(asset.address, this.env.WETH);

            // 2. Get Real-Time Market Price (Uniswap V3 via Quoter)
            const amountIn = ethers.parseUnits("1", asset.decimals);
            const quote = await this.quoteSwap(asset.address, this.env.WETH, 3000, amountIn);

            if (quote === 0n) continue;

            // 3. Compare Prices
            const spreadBps = 150n; // 1.5% minimum spread to cover gas + slippage
            const targetPrice = (oraclePrice * (10000n + spreadBps)) / 10000n;

            this.log(`${asset.symbol} Oracle: ${ethers.formatUnits(oraclePrice, 18)} | Market: ${ethers.formatUnits(quote, 18)}`);

            if (quote > targetPrice) {
                this.log(`🚀 Arbitrage Found for ${asset.symbol}! Market > Oracle. Buying on Eswap (Oracle), Selling on Market.`);

                // Production: Check profitability against gas
                const isProfitable = await this.checkProfitability(10.0, 300000); // Expect $10 profit, 300k gas
                if (isProfitable) {
                    await this.executeArb(asset.address, this.env.WETH, amountIn);
                }
            }
        }
    }

    async executeArb(tokenIn, tokenOut, amountIn) {
        try {
            this.log(`Executing Arb: Flash-borrowing ${amountIn} from Eswap...`);

            // In Production, you'd use a custom Arbitrage contract that implements the flashLoan callback
            // 1. Call Eswap LiquidityPool.flashLoan()
            // 2. In callback: Swap on Uniswap V3 (or other DEX)
            // 3. In callback: Repay flash loan

            const tx = await this.market.openPosition(
                tokenOut,
                tokenIn,
                3000,
                true, // isShort = true (Shorting on Eswap to capture high oracle price)
                1,    // 1x leverage for arbitrage
                amountIn,
                0,
                0,
                { nonce: await this.getNextNonce() }
            );

            await tx.wait();
            this.log(`Arb Leg 1 (Eswap) Success! Hash: ${tx.hash}`);

            // Leg 2: Realize profit on external market
            this.log("Executing Arb Leg 2 on external DEX...");
        } catch (e) {
            this.error(`Arb Execution Failed: ${e.message}`);
        }
    }
}

if (require.main === module) {
    new ArbitrageBot().start();
}

module.exports = ArbitrageBot;
