const test = require("node:test");
const assert = require("node:assert");
require("../test_setup");
const { ethers } = require("ethers");
const FlashMMBot = require("../../../bots/FlashMMBot");

test("FlashMMBot runs without crashing", async (t) => {
    const bot = new FlashMMBot();
    bot.checkProfitability = () => Promise.resolve(true);
    await bot.run();
    assert.ok(true);
});
