// Probe known candidate trader addresses for live positions on the Base hook pool. READ ONLY.
require("dotenv").config();
const { ethers } = require("ethers");

const RPC = process.env.BASE_RPC_URL || "https://mainnet.base.org";
const HOOK = "0x6f98Ea19e522Ecc706E0Fb1574BDA8D32aC510C8";
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const WETH = "0x4200000000000000000000000000000000000006";
const HOOK_KEY = [WETH, USDC, 3000, 60, HOOK];
const POOL_ID = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(["address", "address", "uint24", "int24", "address"], HOOK_KEY)
);

const CANDIDATES = [
    "0x518634753C61342298c3E04326056b3Ce596a566", // deployer/solver
    "0x17D0EaBe1A1F5781B48aacf972098f2717ed62fF", // CoW order receiver
    "0xe18b33138c0F24930Da64AD9355B3F35988Ef394", // base cow solver EOA
    "0x4c3e4F7ABFa79AF80B47429e6F5a41e26Db21A8a", // enso trader (fork artifact)
    "0xEfb494e0f5f095c0B88eEFDb5857c380f2b00CB9", // enso solver (fork artifact)
    "0x8e54f58AaD4bdc29D18C6b02064e1c481AfCCe46", // CoW settler itself
    "0x1244a9977368A09aA38619D92959A78638Ac0DEa", // generic settler
    "0xd9Aba9723d14b36588bcF9D47c2FF355EEC47F3c", // enso fromAddress in validate script
];

const ABI = [
    "function positions(bytes32,address) view returns (address,uint256,uint256,uint8,bool,uint160,int24,int24,uint128)",
    "function isLiquidatable((address,uint256,uint256,uint8,bool,uint160,int24,int24,uint128),(address,address,uint24,int24,address)) view returns (bool)",
];

(async () => {
    const p = new ethers.JsonRpcProvider(RPC);
    const hook = new ethers.Contract(HOOK, ABI, p);
    console.log(`poolId=${POOL_ID}`);
    for (const t of CANDIDATES) {
        const pos = await hook.positions(POOL_ID, t);
        const open = pos[0] !== ethers.ZeroAddress && pos[1] > 0n;
        let liq = "";
        if (open) {
            try {
                liq = " liquidatable=" + (await hook.isLiquidatable(pos, HOOK_KEY));
            } catch (e) { liq = " liqERR=" + (e.shortMessage || e.message).slice(0, 50); }
        }
        console.log(`${t} open=${open} collateral=${pos[1]} borrowed=${pos[2]} lev=${pos[3]} isLong=${pos[4]}${liq}`);
    }
})();
