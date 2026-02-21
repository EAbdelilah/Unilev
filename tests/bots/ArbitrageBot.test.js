const test = require("node:test");
const assert = require("node:assert");
require("./test_setup");
const ArbitrageBot = require("../../bots/ArbitrageBot");
const { ethers } = require("ethers");

test("ArbitrageBot runs and detects opportunities", async (t) => {
    const bot = new ArbitrageBot();

    // Mocking specific contract behavior
    bot.priceFeed.getPairLatestPrice = () => Promise.resolve(ethers.parseUnits("3000", 18));
    bot.quoter.quoteExactInputSingle = {
        staticCall: () => Promise.resolve(ethers.parseUnits("3100", 18)) // 3100 > 3000 * 1.015
    };

    // Mock checkProfitability to return true
    bot.checkProfitability = () => Promise.resolve(true);

    // We want to check if executeArb is called
    let arbExecuted = false;
    bot.executeArb = async () => {
        arbExecuted = true;
    };

    await bot.run();

    assert.strictEqual(arbExecuted, true, "Arbitrage should have been executed");
});
