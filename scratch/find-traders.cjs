// Discover open positions on the live Base hook so the keeper watch list can be
// populated with real candidates. READ ONLY.
require("dotenv").config();
const { ethers } = require("ethers");

const RPC = process.env.BASE_RPC_URL || process.env.BASE_MAINNET_RPC_URL || "https://mainnet.base.org";
const HOOK = "0x6f98Ea19e522Ecc706E0Fb1574BDA8D32aC510C8";
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const WETH = "0x4200000000000000000000000000000000000006";

const HOOK_KEY = [WETH, USDC, 3000, 60, HOOK];
const POOL_ID = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "address", "uint24", "int24", "address"],
        HOOK_KEY
    )
);

const POS_TUPLE =
    "tuple(address trader,uint256 collateralAmount,uint256 borrowedAmount,uint8 leverage,bool isLong,uint160 liquidationSqrtPrice,int24 tickLower,int24 tickUpper,uint128 liquidity)";
const KEY_TUPLE = "tuple(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)";

const ABI = [
    "event MultiPoolMarginOpened(bytes32 indexed poolId, address indexed trader, uint8 leverage, uint256 marginAmount, uint256 boughtAmount)",
    "function positions(bytes32,address) view returns (address,uint256,uint256,uint8,bool,uint160,int24,int24,uint128)",
    `function isLiquidatable(${POS_TUPLE},${KEY_TUPLE}) view returns (bool)`,
    "function paused() view returns (bool)",
];

(async () => {
    const p = new ethers.JsonRpcProvider(RPC);
    const hook = new ethers.Contract(HOOK, ABI, p);
    const latest = await p.getBlockNumber();
    const from = Math.max(0, latest - 400000);
    console.log(`known hook poolId = ${POOL_ID}`);
    console.log(`scanning blocks ${from}..${latest}`);

    const evs = [];
    const CHUNK = 5000;
    for (let start = from; start <= latest; start += CHUNK) {
        const end = Math.min(latest, start + CHUNK - 1);
        for (let attempt = 0; attempt < 5; attempt++) {
            try {
                const part = await hook.queryFilter(hook.filters.MultiPoolMarginOpened(), start, end);
                evs.push(...part);
                break;
            } catch (e) {
                await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
                if (attempt === 4) console.log(`  chunk ${start}..${end} failed: ${e.shortMessage || e.message}`);
            }
        }
        await new Promise((r) => setTimeout(r, 120));
    }
    console.log(`MultiPoolMarginOpened events: ${evs.length}`);

    const seen = new Map();
    for (const e of evs) {
        const key = `${e.args.poolId}|${e.args.trader.toLowerCase()}`;
        if (!seen.has(key)) seen.set(key, { poolId: e.args.poolId, trader: e.args.trader, block: e.blockNumber, tx: e.transactionHash });
    }
    console.log(`unique (poolId,trader): ${seen.size}`);

    for (const v of seen.values()) {
        const pos = await hook.positions(v.poolId, v.trader);
        const open = pos[0].toLowerCase() !== ethers.ZeroAddress.toLowerCase() && pos[1] > 0n;
        let liq = "n/a";
        if (open && v.poolId.toLowerCase() === POOL_ID.toLowerCase()) {
            try {
                liq = await hook.isLiquidatable(
                    { trader: pos[0], collateralAmount: pos[1], borrowedAmount: pos[2], leverage: pos[3], isLong: pos[4], liquidationSqrtPrice: pos[5], tickLower: pos[6], tickUpper: pos[7], liquidity: pos[8] },
                    HOOK_KEY
                );
            } catch (err) { liq = "ERR:" + (err.shortMessage || err.message).slice(0, 70); }
        }
        console.log(
            `  trader=${v.trader} pool=${v.poolId} knownPool=${v.poolId.toLowerCase() === POOL_ID.toLowerCase()} open=${open} collateral=${pos[1]} borrowed=${pos[2]} lev=${pos[3]} isLong=${pos[4]} liq=${liq} tx=${v.tx}`
        );
    }
    console.log(`hook paused = ${await hook.paused().catch(() => "n/a")}`);
})();
