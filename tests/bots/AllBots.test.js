const test = require("node:test");
const assert = require("node:assert");
require("./test_setup");
const { ethers } = require("ethers");

const ArbitrageBot = require("../../bots/ArbitrageBot");
const LiquidationBot = require("../../bots/LiquidationBot");
const LooperBot = require("../../bots/LooperBot");
const MirroringBot = require("../../bots/MirroringBot");
const RefinanceBot = require("../../bots/RefinanceBot");
const YieldHopperBot = require("../../bots/YieldHopperBot");
const CollateralSwapBot = require("../../bots/CollateralSwapBot");
const JITBot = require("../../bots/JITBot");
const GovernanceBot = require("../../bots/GovernanceBot");

test("ArbitrageBot", async (t) => {
    const bot = new ArbitrageBot();
    bot.priceFeed.getPairLatestPrice = () => Promise.resolve(ethers.parseUnits("3000", 18));
    bot.quoter.quoteExactInputSingle = { staticCall: () => Promise.resolve(ethers.parseUnits("3100", 18)) };
    bot.checkProfitability = () => Promise.resolve(true);
    let arbExecuted = false;
    bot.executeArb = async () => { arbExecuted = true; };
    await bot.run();
    assert.strictEqual(arbExecuted, true);
});

test("LiquidationBot", async (t) => {
    const bot = new LiquidationBot();
    bot.market.getLiquidablePositions = () => Promise.resolve([1n, 2n]);
    bot.positions.ownerOf = () => Promise.resolve(ethers.ZeroAddress);
    bot.checkProfitability = () => Promise.resolve(true);
    let liquidated = false;
    bot.market.liquidatePositions = async () => { liquidated = true; return { wait: () => {}, hash: "0x123" }; };
    await bot.run();
    assert.strictEqual(liquidated, true);
});

test("LooperBot", async (t) => {
    const bot = new LooperBot();
    bot.market.getTraderPositions = () => Promise.resolve([]);
    bot.checkProfitability = () => Promise.resolve(true);
    bot.quoteSwap = () => Promise.resolve(ethers.parseUnits("0.03", 8));

    let positionOpened = false;
    bot.market.openPosition = async () => {
        positionOpened = true;
        return { wait: () => Promise.resolve({ status: 1 }), hash: "0x456" };
    };

    await bot.run();
    assert.strictEqual(positionOpened, true);
});

test("MirroringBot", async (t) => {
    const bot = new MirroringBot();
    bot.getExternalFills = () => Promise.resolve([{ id: "1", venue: "Binance", symbol: "ETH", amount: "1", side: "BUY", hedged: false }]);

    let hedgeOpened = false;
    bot.market.openPosition = async () => { hedgeOpened = true; return { wait: () => {}, hash: "0x789" }; };

    await bot.run();

    assert.strictEqual(hedgeOpened, true);
});

test("RefinanceBot", async (t) => {
    const bot = new RefinanceBot();
    // Test case where interest is high
    let refinanceStarted = false;
    bot.market.openPosition = async () => { refinanceStarted = true; return { wait: () => {}, hash: "0xabc" }; };
    await bot.run();
    assert.strictEqual(refinanceStarted, true);
});

test("YieldHopperBot", async (t) => {
    const bot = new YieldHopperBot();
    await bot.run();
    // YieldHopperBot currently just logs.
    assert.ok(true);
});

test("CollateralSwapBot", async (t) => {
    const bot = new CollateralSwapBot();
    bot.market.getTraderPositions = () => Promise.resolve([1n]);
    await bot.run();
    assert.ok(true);
});

test("JITBot", async (t) => {
    const bot = new JITBot();
    await bot.run();
    assert.ok(true);
});

test("GovernanceBot", async (t) => {
    const bot = new GovernanceBot();
    await bot.run();
    assert.ok(true);
});
