// (1) Keeper enable: owner adds the live open-position trader to the keeper watch
// list on the Base hook pool, then verifies watchesLength / checkUpkeep.
require("dotenv").config();
const { ethers } = require("ethers");

const RPC = process.env.BASE_RPC_URL || "https://mainnet.base.org";
const KEEPER = "0xb7ce4c1b40BBd537091E973B3c3C7DEB35106A7d";
const HOOK = "0x6f98Ea19e522Ecc706E0Fb1574BDA8D32aC510C8";
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const WETH = "0x4200000000000000000000000000000000000006";
const HOOK_KEY = [WETH, USDC, 3000, 60, HOOK];
const POOL_ID = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(["address", "address", "uint24", "int24", "address"], HOOK_KEY)
);
const TRADER = "0xd9Aba9723d14b36588bcF9D47c2FF355EEC47F3c"; // live open position on this pool

const K_ABI = [
    "function addWatch((address,address,uint24,int24,address),address)",
    "function watchesLength() view returns (uint256)",
    "function watches(uint256) view returns ((address,address,uint24,int24,address),address)",
    "function isWatched(bytes32,bytes32) view returns (bool)",
    "function owner() view returns (address)",
    "function checkUpkeep(bytes) view returns (bool,bytes)",
];
const H_ABI = [
    "function positions(bytes32,address) view returns (address,uint256,uint256,uint8,bool,uint160,int24,int24,uint128)",
    "function maxLeverageByPool(bytes32) view returns (uint8)",
    "function isAuthorizedPool(bytes32) view returns (bool)",
];

(async () => {
    const provider = new ethers.JsonRpcProvider(RPC);
    const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
    const keeper = new ethers.Contract(KEEPER, K_ABI, wallet);
    const hook = new ethers.Contract(HOOK, H_ABI, provider);

    const kOwner = await keeper.owner();
    console.log(`keeper.owner() = ${kOwner}`);
    console.log(`signer         = ${wallet.address}`);
    if (kOwner.toLowerCase() !== wallet.address.toLowerCase()) throw new Error("signer is not keeper owner");
    console.log(`isAuthorizedPool = ${await hook.isAuthorizedPool(POOL_ID)}`);
    console.log(`maxLeverageByPool = ${await hook.maxLeverageByPool(POOL_ID)}`);

    const pos = await hook.positions(POOL_ID, TRADER);
    console.log(`position(${TRADER}): trader=${pos[0]} collateral=${pos[1]} borrowed=${pos[2]} lev=${pos[3]} isLong=${pos[4]}`);
    if (pos[0] === ethers.ZeroAddress || pos[1] === 0n) throw new Error("no live position for the watch candidate");

    const before = await keeper.watchesLength();
    console.log(`watchesLength before = ${before}`);

    // Simulate first (eth_call with state override not needed; use callStatic via .staticCall)
    await keeper.addWatch.staticCall(HOOK_KEY, TRADER);
    console.log("addWatch staticCall OK");

    const fee = await provider.getFeeData();
    const tx = await keeper.addWatch(HOOK_KEY, TRADER, {
        gasLimit: 400000n,
        maxFeePerGas: (fee.gasPrice || 1000000000n) * 2n,
        maxPriorityFeePerGas: 1000000n,
    });
    console.log(`addWatch tx = ${tx.hash}`);
    const rec = await tx.wait();
    console.log(`mined block=${rec.blockNumber} status=${rec.status} gasUsed=${rec.gasUsed}`);

    const after = await keeper.watchesLength();
    const w0 = await keeper.watches(0);
    console.log(`watchesLength after = ${after}`);
    console.log(`watches(0) = key=${JSON.stringify(w0[0])} trader=${w0[1]}`);
    console.log(`WatchAdded events: ${rec.logs.filter((l) => l.address.toLowerCase() === KEEPER.toLowerCase()).length} keeper log(s)`);

    const [needed, performData] = await keeper.checkUpkeep("0x");
    console.log(`checkUpkeep("") -> upkeepNeeded=${needed} performData=0x${ethers.hexlify(performData).slice(2, 66)}`);
})().catch((e) => { console.error("FAILED:", e.shortMessage || e.message); process.exit(1); });
