// Debug: why does EswapCoWSettlement.fillOrder revert with
// "ERC20: transfer amount exceeds balance"? Identify WHICH account is short by
// re-running eth_call with ERC20 balance state overrides.
require("dotenv").config();
const fs = require("fs");
const os = require("os");
const path = require("path");
const { ethers } = require("ethers");

const RPC = process.env.BASE_RPC_URL || "https://mainnet.base.org";
const API = "https://api.cow.fi/base/api/v1";
const CHAIN_ID = 8453;
const GPV2 = "0x9008D19f58AAbD9eD0D60971565AA8510560ab41";
const SETTLEMENT = "0x8e54f58AaD4bdc29D18C6b02064e1c481AfCCe46";
const USDC = ethers.getAddress("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
const WETH = ethers.getAddress("0x4200000000000000000000000000000000000006");
const HOOK = "0x6f98Ea19e522Ecc706E0Fb1574BDA8D32aC510C8";
const ROUTER = "0x57E75A87A62ab8Ff14C59FA10Ac2AB2c8cBD45D1";

const LEV = 5;
const MARGIN = 40000n;
const HOOK_KEY = [WETH, USDC, 3000, 60, HOOK];
const STD_KEY = [WETH, USDC, 500, 10, ethers.ZeroAddress];
const ORDER_TYPES = {
    Order: [
        { name: "sellToken", type: "address" }, { name: "buyToken", type: "address" },
        { name: "receiver", type: "address" }, { name: "sellAmount", type: "uint256" },
        { name: "buyAmount", type: "uint256" }, { name: "validTo", type: "uint32" },
        { name: "appData", type: "bytes32" }, { name: "feeAmount", type: "uint256" },
        { name: "kind", type: "string" }, { name: "partiallyFillable", type: "bool" },
        { name: "sellTokenBalance", type: "string" }, { name: "buyTokenBalance", type: "string" },
    ],
};
const DOMAIN = { name: "Gnosis Protocol", version: "v2", chainId: CHAIN_ID, verifyingContract: GPV2 };
const POOL_TUPLE = "(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)";
const ORDER_TUPLE = "(address sellToken,address buyToken,address receiver,uint256 sellAmount,uint256 buyAmount,uint32 validTo,bytes32 appData,uint256 feeAmount,bytes32 kind,bool partiallyFillable,bytes32 sellTokenBalance,bytes32 buyTokenBalance)";
const FILL_ABI = [`function fillOrder(${ORDER_TUPLE},uint8,bytes,(uint8 leverage,address solver,${POOL_TUPLE} key,${POOL_TUPLE} standardPoolKey)) returns (address)`];
const E_ABI = ["function balanceOf(address) view returns (uint256)", "function allowance(address,address) view returns (uint256)"];
const key = (f) => JSON.parse(fs.readFileSync(path.join(os.tmpdir(), f), "utf8")).privateKey;
const pad = (h) => h.toLowerCase().replace(/^0x/, "").padStart(64, "0");

(async () => {
    const provider = new ethers.JsonRpcProvider(RPC);
    const trader = new ethers.Wallet(key("eswap-ext-trader2.json"), provider);
    const solver = new ethers.Wallet(key("eswap-ext-solver.json"), provider);
    const usdc = new ethers.Contract(USDC, E_ABI, provider);

    const appData = await new ethers.Contract(SETTLEMENT, ["function leverageCommitment(uint8) view returns (bytes32)"], provider).leverageCommitment(LEV);
    const validTo = Math.floor(Date.now() / 1000) + 1800;
    const order = {
        sellToken: USDC, buyToken: WETH, receiver: trader.address,
        sellAmount: MARGIN.toString(), buyAmount: "15437354205604", validTo,
        appData, feeAmount: "0", kind: "sell", partiallyFillable: false,
        sellTokenBalance: "erc20", buyTokenBalance: "erc20",
    };
    const signature = await trader.signTypedData(DOMAIN, ORDER_TYPES, order);
    const ethOrder = {
        sellToken: order.sellToken, buyToken: order.buyToken, receiver: order.receiver,
        sellAmount: BigInt(order.sellAmount), buyAmount: BigInt(order.buyAmount),
        validTo: order.validTo, appData: order.appData, feeAmount: 0n,
        kind: ethers.keccak256(ethers.toUtf8Bytes("sell")), partiallyFillable: false,
        sellTokenBalance: ethers.keccak256(ethers.toUtf8Bytes("erc20")),
        buyTokenBalance: ethers.keccak256(ethers.toUtf8Bytes("erc20")),
    };
    const params = {
        leverage: LEV, solver: solver.address,
        key: { currency0: HOOK_KEY[0], currency1: HOOK_KEY[1], fee: HOOK_KEY[2], tickSpacing: HOOK_KEY[3], hooks: HOOK_KEY[4] },
        standardPoolKey: { currency0: STD_KEY[0], currency1: STD_KEY[1], fee: STD_KEY[2], tickSpacing: STD_KEY[3], hooks: STD_KEY[4] },
    };
    const data = new ethers.Interface(FILL_ABI).encodeFunctionData("fillOrder", [ethOrder, 0, signature, params]);
    const call = { from: solver.address, to: SETTLEMENT, data };

    console.log(`trader=${trader.address} balance=${await usdc.balanceOf(trader.address)}`);
    console.log(`solver=${solver.address} balance=${await usdc.balanceOf(solver.address)} allowance=${await usdc.allowance(solver.address, ROUTER)}`);
    console.log(`router=${ROUTER} balance=${await usdc.balanceOf(ROUTER)}`);

    const findBalSlot = async (who) => {
        for (let s = 0; s < 40; s++) {
            const loc = ethers.keccak256(ethers.concat(["0x" + pad(who), "0x" + s.toString(16).padStart(64, "0")]));
            const v = await provider.getStorage(USDC, loc);
            if (BigInt(v) === 40000n) return { slot: s, loc };
        }
        return null;
    };
    const solverSlot = await findBalSlot(solver.address);
    const traderSlot = await findBalSlot(trader.address);
    console.log(`USDC balance slot: solver=${JSON.stringify(solverSlot)} trader=${JSON.stringify(traderSlot)}`);

    const run = async (label, override) => {
        const args = [call, "latest"];
        if (override) args.push(override);
        try {
            const res = await provider.send("eth_call", args);
            return `${label}: OK (${res})`;
        } catch (e) {
            const m = e.info && e.info.error && e.info.error.message ? e.info.error.message : (e.shortMessage || e.message);
            return `${label}: REVERT ${m.slice(0, 160)}`;
        }
    };

    console.log(await run("A baseline", null));
    if (solverSlot) {
        const big = "0x" + (10n ** 9n).toString(16).padStart(64, "0");
        console.log(await run("B solver USDC balance = 1000", { [solver.address]: { stateDiff: { [solverSlot.loc]: big } } }));
    }
    if (traderSlot) {
        const big = "0x" + (10n ** 9n).toString(16).padStart(64, "0");
        console.log(await run("C trader USDC balance = 1000", { [trader.address]: { stateDiff: { [traderSlot.loc]: big } } }));
    }
    const routerBig = { [ROUTER]: { stateDiff: {} } };
    for (let s = 0; s < 40; s++) {
        const loc = ethers.keccak256(ethers.concat(["0x" + pad(ROUTER), "0x" + s.toString(16).padStart(64, "0")]));
        const v = await provider.getStorage(USDC, loc);
        if (BigInt(v) === 161000n || BigInt(v) === 160000n) { routerBig[ROUTER].stateDiff[loc] = "0x" + (10n ** 9n).toString(16).padStart(64, "0"); console.log(`  router USDC slot=${s} v=${BigInt(v)}`); }
    }
    console.log(await run("D router USDC balance = 1000", routerBig));
})().catch((e) => { console.error("FAILED:", e.shortMessage || e.message); });
