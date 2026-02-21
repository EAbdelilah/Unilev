const test = require("node:test");
const assert = require("node:assert");
require("../test_setup");
const { ethers } = require("ethers");
const MirroringBot = require("../../../bots/MirroringBot");

test("MirroringBot", async (t) => {
    const bot = new MirroringBot();
    bot.getExternalFills = () => Promise.resolve([{ id: "1", venue: "Binance", symbol: "ETH", amount: "1", side: "BUY", hedged: false }]);

    let hedgeOpened = false;
    bot.market.openPosition = async () => {
        hedgeOpened = true;
        return { wait: () => Promise.resolve({ status: 1 }), hash: "0x789" };
    };

    await bot.run();
    assert.strictEqual(hedgeOpened, true);
});
