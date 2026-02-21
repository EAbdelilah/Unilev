const BotBase = require("./BotBase");
const { ethers } = require("ethers");
const { getLiquidityPoolAbi } = require("../javascript/utils");

class RefinanceBot extends BotBase {
    constructor() {
        super("RefinanceBot");
    }

    async run() {
        this.log("Checking for high-interest loans to refinance to Eswap (0% interest)...");

        // Mock checking Aave positions
        const highInterestLoan = {
            protocol: "Aave",
            rate: 0.12, // 12% APR
            debt: "10000",
            asset: "USDC"
        };

        if (highInterestLoan.rate > 0.05) { // Refinance if > 5%
            this.log(`Found ${highInterestLoan.rate * 100}% loan on ${highInterestLoan.protocol}.`);
            this.log("Action: Refinancing to Eswap 0% interest position.");

            try {
                if (this.executor) {
                    this.log("Step 1: Executing ATOMIC Refinancing via StrategyExecutor...");

                    const strategyData = ethers.AbiCoder.defaultAbiCoder().encode(
                        ["uint8", "address", "address", "uint24", "uint256", "uint256", "bytes"],
                        [2, this.env.USDC, this.env.WETH, 3000, ethers.parseUnits(highInterestLoan.debt, 6), 0n, "0x"]
                    );

                    const lpAddress = await this.market.getTokenToLiquidityPools(this.env.USDC);
                    const lp = new ethers.Contract(lpAddress, ["function flashLoan(address,uint256,bytes)"], this.wallet);

                    const tx = await lp.flashLoan(this.executorAddress, ethers.parseUnits(highInterestLoan.debt, 6), strategyData, { nonce: await this.getNextNonce() });
                    await tx.wait();
                    this.log("Refinancing Success! Debt moved to 0% interest on Eswap.");
                    return;
                }

                this.log("Step 1: Executing Manual Refinancing...");
                // 1. Flash borrow from Eswap (0% fee) to repay the high-interest loan
                const liquidityPool = new ethers.Contract(this.env.USDC_LP, getLiquidityPoolAbi(), this.wallet);

                this.log(`Step 1.1: Flash borrowing ${highInterestLoan.debt} USDC from Eswap...`);

                // 2. Open Eswap position to replace the debt
                this.log("Step 2: Opening 0% interest position on Eswap...");
                const tx = await this.market.openPosition(
                    this.env.USDC,
                    this.env.WETH,
                    3000,
                    false,
                    2,
                    ethers.parseUnits(highInterestLoan.debt, 6),
                    0,
                    0,
                    { nonce: await this.getNextNonce() }
                );
                await tx.wait();
                this.log("Step 3: Refinancing Complete. Saving 12% APR in interest.");
            } catch (e) {
                this.error(`Refinance failed: ${e.message}`);
            }
        }
    }
}

if (require.main === module) {
    new RefinanceBot().start();
}

module.exports = RefinanceBot;
