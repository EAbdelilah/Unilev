// Post-fill verification: where did cycle-2's position land?
require("dotenv").config();
const { ethers } = require("ethers");

const RPC = process.env.BASE_RPC_URL || "https://mainnet.base.org";
const TX = "0x70fb117cbe072f1dbbd3ae068830aa5dd7ef98387f459cb435c1a1970a2b767c";
const TRADER3 = "0xe970C2d24A3007adA0145e7b7Cc74De83e7B467e";
const HOOK = "0x6f98Ea19e522Ecc706E0Fb1574BDA8D32aC510C8";
const ROUTER = "0x57E75A87A62ab8Ff14C59FA10Ac2AB2c8cBD45D1";
const SETTLEMENT = "0x8e54f58AaD4bdc29D18C6b02064e1c481AfCCe46";
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const WETH = "0x4200000000000000000000000000000000000006";

(async () => {
    const provider = new ethers.JsonRpcProvider(RPC);

    const HOOK_ABI = [
        "function positions(bytes32,address) view returns (address,uint256,uint256,uint8,bool,uint160,int24,int24,uint128)",
        "function positionSolver(bytes32,address) view returns (address)",
        "function rehypPrincipal(bytes32,address) view returns (uint256)",
    ];
    const hook = new ethers.Contract(HOOK, HOOK_ABI, provider);

    const keyId = (keys) => ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "address", "uint24", "int24", "address"], keys));
    const HOOK_KEY = [WETH, USDC, 3000, 60, HOOK];
    const STD_KEY = [WETH, USDC, 500, 10, ethers.ZeroAddress];
    const hookPool = keyId(HOOK_KEY);
    const stdPool = keyId(STD_KEY);

    for (const [name, pid] of [["hookPool", hookPool], ["stdPool", stdPool]]) {
        const p = await hook.positions(pid, TRADER3);
        const rs = await hook.rehypPrincipal(pid, TRADER3);
        const ps = await hook.positionSolver(pid, TRADER3);
        console.log(`${name} ${pid}: collateral=${p[1]} borrowed=${p[2]} lev=${p[3]} isLong=${p[4]} rehyp=${rs} solver=${ps}`);
    }

    const rec = await provider.getTransactionReceipt(TX);
    console.log(`\ntx ${TX} status=${rec.status} block=${rec.blockNumber} logs=${rec.logs.length}`);
    for (const l of rec.logs) {
        console.log(`  ${l.address} topics0=${l.topics[0] ? l.topics[0].slice(0, 10) : "(none)"} dlen=${(l.data.length - 2) / 2}B topics=${l.topics.length}`);
        if (l.address.toLowerCase() === HOOK.toLowerCase()) console.log(`     data=${l.data.slice(0, 200)}`);
    }

    // who holds the borrowed funds / escrow now
    const router = new ethers.Contract(ROUTER, ["function erc20BorrowEscrow(address,address) view returns (uint256)"], provider);
    const usdc = new ethers.Contract(USDC, ["function balanceOf(address) view returns (uint256)"], provider);
    console.log(`\nescrow(solver,USDC)=${await router.erc20BorrowEscrow("0x144eDdC7B0c73439f70162978beee38a632c145d", USDC)}`);
    console.log(`solver USDC=${await usdc.balanceOf("0x144eDdC7B0c73439f70162978beee38a632c145d")}`);
    console.log(`trader3 USDC=${await usdc.balanceOf(TRADER3)}`);
    const settlement = new ethers.Contract(SETTLEMENT, ["function filledOrders(bytes32) view returns (bool)"], provider);
    const uid = "0x0acb036288192ccccfc575f42d9689d07030034bf991c9bafcbe60f56663aeade970c2d24a3007ada0145e7b7cc74de83e7b467e6ad679d3";
    console.log(`filledOrders(uidHash)=${await settlement.filledOrders(ethers.keccak256(uid))}`);
})().catch((e) => { console.error("FAILED:", e.shortMessage || e.message); process.exit(1); });
