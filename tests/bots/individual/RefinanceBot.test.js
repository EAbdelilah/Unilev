const test = require("node:test");
const assert = require("node:assert");
require("../test_setup");
const { ethers } = require("ethers");
const RefinanceBot = require("../../../bots/RefinanceBot");

test("RefinanceBot", async (t) => {
    const bot = new RefinanceBot();
    let positionOpened = false;
    bot.market.openPosition = async () => {
        positionOpened = true;
        return { wait: () => Promise.resolve({ status: 1 }), hash: "0xabc" };
    };

    await bot.run();
    assert.strictEqual(positionOpened, true);
});
