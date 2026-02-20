const BotBase = require("./BotBase");
const { ethers } = require("ethers");

class LooperBot extends BotBase {
    constructor() {
        super("LooperBot");
    }

    async run() {
        this.log("Monitoring yield for Looping opportunities...");

        const targetToken = this.env.WBTC;
        const marginToken = this.env.USDC;
        const fee = 3000; // 0.3%
        const leverage = 3;
        const marginAmount = ethers.parseUnits("100", 6); // $100 USDC

        // Check if we already have a position
        const myPositions = await this.market.getTraderPositions(this.wallet.address);
        if (myPositions.length > 0) {
            this.log(`Already have ${myPositions.length} active positions. Skipping...`);
            return;
        }

        // Production Readiness: Dynamic Quoting & Profitability
        const expectedProfitUsd = 5.0; // Target $5 profit from yield/trend
        const isProfitable = await this.checkProfitability(expectedProfitUsd, 500000); // Est 500k gas for open

        if (!isProfitable) {
            this.log("Gas costs exceed expected profit. Skipping...");
            return;
        }

        // Quoting for slippage protection (Longing WBTC)
        const quote = await this.quoteSwap(marginToken, targetToken, fee, marginAmount * BigInt(leverage - 1));
        const minOut = (quote * 995n) / 1000n; // 0.5% slippage

        this.log(`Looper Execution: Opening 3x Long ${targetToken} with $${ethers.formatUnits(marginAmount, 6)} margin.`);

        try {
            if (this.executor) {
                this.log("Executing ATOMIC Looping via StrategyExecutor...");
                const strategyData = ethers.AbiCoder.defaultAbiCoder().encode(
                    ["uint8", "address", "address", "uint24", "uint256", "uint256", "bytes"],
                    [1, marginToken, targetToken, fee, marginAmount, minOut, "0x"]
                );

                const lpAddress = await this.market.getTokenToLiquidityPools(marginToken);
                const lp = new ethers.Contract(lpAddress, ["function flashLoan(address,uint256,bytes)"], this.wallet);

                const tx = await lp.flashLoan(this.executorAddress, marginAmount, strategyData, { nonce: await this.getNextNonce() });
                await tx.wait();
                this.log(`Atomic Looping Success! Hash: ${tx.hash}`);
                return;
            }

            const tokenContract = await this.getErc20(marginToken);
            await tokenContract.approve(this.env.MARKET_ADDRESS, marginAmount, { nonce: await this.getNextNonce() });

            const tx = await this.market.openPosition(
                marginToken,
                targetToken,
                fee,
                false, // isShort = false (Long)
                leverage,
                marginAmount,
                0, // limit price
                0, // stop loss
                { nonce: await this.getNextNonce() }
            );
            await tx.wait();
            this.log(`Looper Position Opened! Hash: ${tx.hash}`);
        } catch (e) {
            this.error(`Looper Execution Failed: ${e.message}`);
        }
    }
}

if (require.main === module) {
    new LooperBot().start();
}

module.exports = LooperBot;
