const BotBase = require("./BotBase");
const { ethers } = require("ethers");

class LiquidationBot extends BotBase {
    constructor() {
        super("LiquidationBot");
    }

    async run() {
        this.log("Checking for liquidable positions...");
        try {
            const liquidablePositions = await this.market.getLiquidablePositions();
            const posIds = liquidablePositions.filter(id => id > 0n);

            if (posIds.length > 0) {
                this.log(`Found ${posIds.length} liquidable positions.`);

                for (const id of posIds) {
                    const owner = await this.positions.ownerOf(id);
                    if (owner.toLowerCase() === this.wallet.address.toLowerCase()) {
                        this.log(`Self-Liquidation: Position ${id} is mine and liquidatable!`);
                    } else {
                        this.log(`Standard Liquidation: Position ${id} belongs to ${owner}.`);
                    }
                }

                this.log(`Checking profitability for liquidating ${posIds.length} positions...`);

                // Production: Only liquidate if the fixed reward covers gas
                // LiquidationReward is fixed, so we can estimate profit
                const totalRewardUsd = posIds.length * 10.0; // Assume $10 fixed reward per pos for simplicity
                const isProfitable = await this.checkProfitability(totalRewardUsd, 200000 * posIds.length);

                if (isProfitable) {
                    this.log(`Executing liquidation for: ${posIds.join(", ")}`);
                    const tx = await this.market.liquidatePositions(posIds, { nonce: await this.getNextNonce() });
                    await tx.wait();
                    this.log(`Liquidation successful! Hash: ${tx.hash}`);
                } else {
                    this.log("Liquidation not profitable at current gas prices. Waiting...");
                }
            } else {
                this.log("No liquidable positions found.");
            }
        } catch (e) {
            this.error(`Liquidation failed: ${e.message}`);
        }
    }
}

if (require.main === module) {
    new LiquidationBot().start();
}

module.exports = LiquidationBot;
