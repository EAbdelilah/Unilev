// Session start reads: keeper.watchesLength, CoWSettlement.leverageCommitment(5),
// router.registeredSolvers for the 4 settler addresses. READ ONLY.
require("dotenv").config();
const { ethers } = require("ethers");

const RPC = process.env.BASE_RPC_URL || "https://mainnet.base.org";
const KEEPER = "0xb7ce4c1b40BBd537091E973B3c3C7DEB35106A7d";
const COW_SETTLEMENT = "0x8e54f58AaD4bdc29D18C6b02064e1c481AfCCe46";
const ROUTER = "0x57E75A87A62ab8Ff14C59FA10Ac2AB2c8cBD45D1";

const SETTLERS = {
    EswapCoWSettlement: "0x8e54f58AaD4bdc29D18C6b02064e1c481AfCCe46",
    EswapSettlement: "0x1244a9977368A09aA38619D92959A78638Ac0DEa",
    EswapUniswapXSettlement: "0xE8A0EC44818395d5DE7c11df672B409539978Aa7",
    EswapOneInchFusionSettlement: "0x2797C7850e8724B9b7222DDddD42aEFc27c9F20A",
};

const K_ABI = [
    "function watchesLength() view returns (uint256)",
    "function owner() view returns (address)",
    "function slippageBps() view returns (uint256)",
    "function hook() view returns (address)",
    "function router() view returns (address)",
    "function watches(uint256) view returns ((address,address,uint24,int24,address),address)",
];
const C_ABI = ["function leverageCommitment(uint8) view returns (bytes32)"];
const R_ABI = [
    "function registeredSolvers(address) view returns (bool)",
    "function owner() view returns (address)",
    "function allowedAggregators(address) view returns (bool)",
];

(async () => {
    const p = new ethers.JsonRpcProvider(RPC);
    const net = await p.getNetwork();
    console.log(`chainId=${net.chainId} rpc=${RPC}`);

    const keeper = new ethers.Contract(KEEPER, K_ABI, p);
    const cow = new ethers.Contract(COW_SETTLEMENT, C_ABI, p);
    const router = new ethers.Contract(ROUTER, R_ABI, p);

    const [len, kOwner, rOwner, lev5] = await Promise.all([
        keeper.watchesLength().catch((e) => "ERR:" + e.shortMessage),
        keeper.owner().catch((e) => "ERR"),
        router.owner().catch((e) => "ERR"),
        cow.leverageCommitment(5).catch((e) => "ERR:" + e.shortMessage),
    ]);
    console.log(`keeper.watchesLength()      = ${len}`);
    console.log(`keeper.owner()              = ${kOwner}`);
    console.log(`router.owner()              = ${rOwner}`);
    console.log(`CoWSettlement.leverageCommitment(5) = ${lev5}`);

    const expected = ethers.keccak256(
        ethers.toUtf8Bytes(`{"version":1,"appCode":"eswap","metadata":{"eswapLeverage":"5"}}`)
    );
    console.log(`canonical appDataJson(5) keccak = ${expected}`);
    console.log(`levComm(5) == canonical?        = ${String(lev5).toLowerCase() === expected.toLowerCase()}`);

    for (const [name, addr] of Object.entries(SETTLERS)) {
        const code = await p.getCode(addr);
        const reg = await router.registeredSolvers(addr).catch((e) => "ERR:" + e.shortMessage);
        console.log(`router.registeredSolvers(${name} ${addr}) = ${reg}  code=${code === "0x" ? "NONE" : code.length / 2 - 1 + "B"}`);
    }
})();
