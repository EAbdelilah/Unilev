const test = require("node:test");
const assert = require("node:assert");
require("../test_setup");
const { ethers } = require("ethers");
const LooperBot = require("../../../bots/LooperBot");

test("LooperBot", async (t) => {
    const bot = new LooperBot();
    bot.market.getTraderPositions = () => Promise.resolve([]);
    bot.checkProfitability = () => Promise.resolve(true);
    bot.quoteSwap = () => Promise.resolve(ethers.parseUnits("0.03", 8));

    // Mock getErc20 to avoid real contract calls
    bot.getErc20 = async () => ({
        approve: async () => ({ wait: () => Promise.resolve({ status: 1 }), hash: "0x" })
    });

    let positionOpened = false;
    bot.market.openPosition = async () => {
        positionOpened = true;
        return { wait: () => Promise.resolve({ status: 1 }), hash: "0x456" };
    };

    await bot.run();
    assert.strictEqual(positionOpened, true);
});
