const test = require("node:test");
const assert = require("node:assert");
require("../test_setup");
const { ethers } = require("ethers");

const YieldHopperBot = require("../../../bots/YieldHopperBot");
const CollateralSwapBot = require("../../../bots/CollateralSwapBot");
const JITBot = require("../../../bots/JITBot");

test("Skeleton Bots run without crashing", async (t) => {
    await new YieldHopperBot().run();

    const csBot = new CollateralSwapBot();
    csBot.market.getTraderPositions = () => Promise.resolve([1n]);
    await csBot.run();

    await new JITBot().run();

    assert.ok(true);
});
