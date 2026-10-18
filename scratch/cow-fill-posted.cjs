// (2b) Settle the EXACT CoW orderbook order (UID 0x0cd5...) through
// EswapCoWSettlement.fillOrder() as an anonymous, unwhitelisted, escrow-bonded
// solver — proving a real CoW Base order (appData = leverageCommitment(5)) can
// be coerced into a leveraged Eswap position.
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
const ROUTER = "0x57E75A87A62ab8Ff14C59FA10Ac2AB2c8cBD45D1";
const HOOK = "0x6f98Ea19e522Ecc706E0Fb1574BDA8D32aC510C8";
const USDC = ethers.getAddress("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
const WETH = ethers.getAddress("0x4200000000000000000000000000000000000006");
const EXPECTED_DIGEST = "0x0cd5c005c0f6c746aebb190f3e9aab29ff8bc50aeb2c0fe6bf711d2c350f8902";

const LEV = 5;
const MARGIN = 40000n;
const HOOK_KEY = [WETH, USDC, 3000, 60, HOOK];
const STD_KEY = [WETH, USDC, 500, 10, ethers.ZeroAddress];
const POOL_ID = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(["address", "address", "uint24", "int24", "address"], HOOK_KEY)
);

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
const S_ABI = [
    `function fillOrder(${ORDER_TUPLE},uint8,bytes,(uint8 leverage,address solver,${POOL_TUPLE} key,${POOL_TUPLE} standardPoolKey)) returns (address)`,
    `function verify(${ORDER_TUPLE},uint8,bytes) view returns (address,bytes32,bytes)`,
    "function filledOrders(bytes32) view returns (bool)",
];
const R_ABI = ["function erc20BorrowEscrow(address,address) view returns (uint256)", "function registeredSolvers(address) view returns (bool)"];
const H_ABI = [
    "function positions(bytes32,address) view returns (address,uint256,uint256,uint8,bool,uint160,int24,int24,uint128)",
    "function positionSolver(bytes32,address) view returns (address)",
];
const E_ABI = ["function balanceOf(address) view returns (uint256)", "function allowance(address,address) view returns (uint256)"];
const key = (f) => JSON.parse(fs.readFileSync(path.join(os.tmpdir(), f), "utf8")).privateKey;

(async () => {
    const provider = new ethers.JsonRpcProvider(RPC);
    const trader = new ethers.Wallet(key("eswap-ext-trader2.json"), provider);
    const solver = new ethers.Wallet(key("eswap-ext-solver.json"), provider);
    const settlement = new ethers.Contract(SETTLEMENT, S_ABI, provider);
    const router = new ethers.Contract(ROUTER, R_ABI, provider);
    const hook = new ethers.Contract(HOOK, H_ABI, provider);
    const usdc = new ethers.Contract(USDC, E_ABI, provider);

    // exact order fields as posted to (and fulfilled by) the CoW Base book
    const appData = await new ethers.Contract(SETTLEMENT, ["function leverageCommitment(uint8) view returns (bytes32)"], provider).leverageCommitment(LEV);
    const order = {
        sellToken: USDC, buyToken: WETH, receiver: trader.address,
        sellAmount: "40000", buyAmount: "15437354205604", validTo: 1792322742,
        appData, feeAmount: "0", kind: "sell", partiallyFillable: false,
        sellTokenBalance: "erc20", buyTokenBalance: "erc20",
    };
    const signature = await trader.signTypedData(DOMAIN, ORDER_TYPES, order);
    const digest = ethers.TypedDataEncoder.hash(DOMAIN, ORDER_TYPES, order);
    console.log(`re-signed digest = ${digest}`);
    if (digest !== EXPECTED_DIGEST) throw new Error("digest != the posted order UID digest; aborting");

    const ethOrder = {
        sellToken: order.sellToken, buyToken: order.buyToken, receiver: order.receiver,
        sellAmount: BigInt(order.sellAmount), buyAmount: BigInt(order.buyAmount),
        validTo: order.validTo, appData: order.appData, feeAmount: 0n,
        kind: ethers.keccak256(ethers.toUtf8Bytes(order.kind)), partiallyFillable: false,
        sellTokenBalance: ethers.keccak256(ethers.toUtf8Bytes(order.sellTokenBalance)),
        buyTokenBalance: ethers.keccak256(ethers.toUtf8Bytes(order.buyTokenBalance)),
    };
    const params = {
        leverage: LEV, solver: solver.address,
        key: { currency0: HOOK_KEY[0], currency1: HOOK_KEY[1], fee: HOOK_KEY[2], tickSpacing: HOOK_KEY[3], hooks: HOOK_KEY[4] },
        standardPoolKey: { currency0: STD_KEY[0], currency1: STD_KEY[1], fee: STD_KEY[2], tickSpacing: STD_KEY[3], hooks: STD_KEY[4] },
    };
    const [recovered, , uidBytes] = await settlement.verify(ethOrder, 0, signature);
    const uid = ethers.hexlify(uidBytes);
    console.log(`recovered owner = ${recovered}`);
    console.log(`order UID       = ${uid}`);
    console.log(`filledOrders(uidHash) before = ${await settlement.filledOrders(ethers.keccak256(uidBytes))}`);

    // state of the order on the real CoW book
    const book = await fetch(`${API}/orders/${uid}`).then((r) => r.json()).catch((e) => ({ err: String(e) }));
    console.log(`CoW book state  = ${JSON.stringify(book).slice(0, 400)}`);

    console.log(`\nsolver=${solver.address} registeredSolvers=${await router.registeredSolvers(solver.address)}`);
    console.log(`escrow=${await router.erc20BorrowEscrow(solver.address, USDC)} (borrow=${MARGIN * 4n})`);
    console.log(`solver USDC=${await usdc.balanceOf(solver.address)} allowance=${await usdc.allowance(solver.address, ROUTER)}`);

    const contract = settlement.connect(solver);
    const args = [ethOrder, 0, signature, params];
    try {
        await contract.fillOrder.staticCall(...args);
        console.log("fillOrder staticCall: OK");
    } catch (e) {
        console.log(`fillOrder staticCall REVERT: ${e.shortMessage || e.message} ${e.data || ""}`);
        throw e;
    }
    const tx = await contract.fillOrder(...args, { gasLimit: 3_000_000n });
    console.log(`fillOrder tx = ${tx.hash}`);
    const rec = await tx.wait();
    console.log(`mined block=${rec.blockNumber} status=${rec.status} gasUsed=${rec.gasUsed}`);

    const iface = new ethers.Interface(["event OrderFilled(bytes orderUid, address indexed owner, address indexed solver, uint256 margin, uint8 leverage)"]);
    for (const l of rec.logs) {
        if (l.address.toLowerCase() === SETTLEMENT.toLowerCase()) {
            try { const a = iface.parseLog(l).args; console.log(`OrderFilled uid=${a[0].slice(0, 20)}… owner=${a[1]} solver=${a[2]} margin=${a[3]} lev=${a[4]}`); } catch { }
        }
    }
    const pos = await hook.positions(POOL_ID, trader.address);
    console.log(`hook.positions(trader): collateral=${pos[1]} borrowed=${pos[2]} lev=${pos[3]} isLong=${pos[4]}`);
    console.log(`positionSolver         = ${await hook.positionSolver(POOL_ID, trader.address)}`);
    console.log(`escrow after           = ${await router.erc20BorrowEscrow(solver.address, USDC)}`);
    console.log(`filledOrders(uidHash)  = ${await settlement.filledOrders(ethers.keccak256(uidBytes))}`);

    fs.writeFileSync(path.resolve(process.cwd(), "scratch", "cow-fill-result.json"), JSON.stringify({
        lev: LEV, appData, uid, digest, bookOnCoW: book,
        tx: tx.hash, block: rec.blockNumber, gasUsed: rec.gasUsed.toString(),
        position: { collateral: pos[1].toString(), borrowed: pos[2].toString(), lev: Number(pos[3]), isLong: pos[4] },
        positionSolver: await hook.positionSolver(POOL_ID, trader.address),
        escrowAfter: (await router.erc20BorrowEscrow(solver.address, USDC)).toString(),
        solverRegistered: await router.registeredSolvers(solver.address),
    }, null, 2));
    console.log("saved -> scratch/cow-fill-result.json");
})().catch((e) => { console.error("FAILED:", e.shortMessage || e.message, e.data || ""); process.exit(1); });
