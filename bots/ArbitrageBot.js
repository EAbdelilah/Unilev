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
            if (this.executor) {
                this.log(`Executing ATOMIC Arb: Flash-borrowing ${amountIn} from Eswap...`);

                // Encode Strategy Data for Executor (Action.ARBITRAGE = 0)
                // extraData: Second leg fee (e.g. 500 for 0.05% pool)
                const extraData = ethers.AbiCoder.defaultAbiCoder().encode(["uint24"], [500]);

                const strategyData = ethers.AbiCoder.defaultAbiCoder().encode(
                    ["uint8", "address", "address", "uint24", "uint256", "uint256", "bytes"],
                    [0, tokenIn, tokenOut, 3000, amountIn, 0n, extraData]
                );

                const lpAddress = await this.market.getTokenToLiquidityPools(tokenIn);
                const lp = new ethers.Contract(lpAddress, ["function flashLoan(address,uint256,bytes)"], this.wallet);

                const tx = await lp.flashLoan(this.executorAddress, amountIn, strategyData, { nonce: await this.getNextNonce() });
                await tx.wait();
                this.log(`Atomic Arb Success! Hash: ${tx.hash}`);
            } else {
                this.log(`Executing Semi-Atomic Arb: Using Market openPosition...`);

                const tx = await this.market.openPosition(
                    tokenOut,
                    tokenIn,
                    3000,
                    true, // isShort = true
                    1,
                    amountIn,
                    0,
                    0,
                    { nonce: await this.getNextNonce() }
                );

                await tx.wait();
                this.log(`Arb Leg 1 (Eswap) Success! Hash: ${tx.hash}`);
                this.log("Warning: Leg 2 must be executed manually or by another bot.");
            }
        } catch (e) {
            this.error(`Arb Execution Failed: ${e.message}`);
        }
    }
}

if (require.main === module) {
    new ArbitrageBot().start();
}

module.exports = ArbitrageBot;
