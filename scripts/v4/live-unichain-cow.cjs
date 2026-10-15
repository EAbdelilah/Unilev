require("dotenv").config();
const fs = require("fs");
const { ethers } = require("ethers");

const USDC = "0x078d782b760474a361dda0af3839290b0ef57ad6";
const NATIVE = ethers.ZeroAddress;
const HOOK = "0x4bd545f6438a27614098984e1322939af53ad0c8";
const ROUTER = "0xe7c5ae37ddaca662b483ab5f29a30860835e8c3b";
const SETTLEMENT = "0xd87951e9661f09f86f3f0287d9bc1e2ea4fc14b7";
const GPV2 = "0x9008d19f58aabd9ed0d60971565aa8510560ab41";

const HOOK_KEY = [NATIVE, USDC, 3000, 60, HOOK];
const S_KEY = [NATIVE, USDC, 500, 10, ethers.ZeroAddress];

const LEVERAGE = 2;
const MARGIN = 20000n; // 0.02 USDC
const BORROW = MARGIN * BigInt(LEVERAGE - 1);
const KIND_SELL = ethers.keccak256(ethers.toUtf8Bytes("sell"));
const BALANCE_ERC20 = ethers.keccak256(ethers.toUtf8Bytes("erc20"));
const FILL_SOLVER_ETH = 50000000000000n; // 0.00005 ETH gas stipend

const routerAbi = [
    "function closePosition(address,tuple(address,address,uint24,int24,address),address,address,uint256)",
    "function depositBorrowEscrow(address,uint256)",
    "function erc20BorrowEscrow(address,address) view returns (uint256)",
    "function registeredSolvers(address) view returns (bool)",
    "function allowedAggregators(address) view returns (bool)",
    "function solverNotionalCap(address) view returns (uint256)",
];
const erc20 = [
    "function balanceOf(address) view returns (uint256)",
    "function approve(address,uint256) returns (bool)",
    "function transfer(address,uint256) returns (bool)",
];
const hookAbi = [
    "function positions(bytes32,address) view returns (address,uint256,uint256,uint8,bool,uint160,int24,int24,uint128)",
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function wait(p, hash, label) {
    for (let i = 0; i < 90; i++) {
        await sleep(3000);
        const r = await p.getTransactionReceipt(hash).catch(() => null);
        if (r) {
            if (r.status === 1) {
                console.log(`OK   ${label} (gas ${r.gasUsed}) ${hash}`);
                return r;
            }
            throw new Error(`${label} REVERTED ${hash}`);
        }
    }
    throw new Error(`${label} TIMEOUT ${hash}`);
}
const hookIdOf = (k) =>
    ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
            ["address", "address", "uint24", "int24", "address"],
            k,
        ),
    );

(async () => {
    const provider = new ethers.JsonRpcProvider(process.env.UNICHAIN_RPC_URL);
    const gasPrice = 3000000n; // 0.003 gwei
    const owner = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
    const trader = new ethers.Wallet(process.env.TINY_TRADER_PK, provider);
    const solverJson = JSON.parse(
        fs.readFileSync(
            "C:\\Users\\faar_\\AppData\\Local\\Temp\\opencode\\unichain-cow-solver.json",
            "utf8",
        ),
    );
    const solver = new ethers.Wallet(solverJson.privateKey, provider);

    console.log("chainId", (await provider.getNetwork()).chainId);
    console.log("owner ", owner.address);
    console.log("trader", trader.address);
    console.log("solver", solver.address);

    const usdc = new ethers.Contract(USDC, erc20, provider);
    const router = new ethers.Contract(ROUTER, routerAbi, provider);
    const art = require("../../out/EswapCoWSettlement.sol/EswapCoWSettlement.json");
    const settlement = new ethers.Contract(SETTLEMENT, art.abi, provider);

    console.log(
        "solver registeredSolvers:",
        await router.registeredSolvers(solver.address),
        "allowedAggregators:",
        await router.allowedAggregators(solver.address),
    );
    console.log(
        "balances owner: ETH",
        (await provider.getBalance(owner.address)).toString(),
        "USDC",
        (await usdc.balanceOf(owner.address)).toString(),
    );
    console.log(
        "balances solver: ETH",
        (await provider.getBalance(solver.address)).toString(),
        "USDC",
        (await usdc.balanceOf(solver.address)).toString(),
    );

    // ── fund the anonymous solver (idempotent) ───────────────────────────
    const walletBal0 = await usdc.balanceOf(solver.address);
    const escrowBal0 = await router.erc20BorrowEscrow(solver.address, USDC);
    if (walletBal0 < MARGIN || escrowBal0 < BORROW) {
        const topUp = MARGIN + BORROW - walletBal0 - escrowBal0;
        if (topUp > 0n) {
            await wait(
                provider,
                (await new ethers.Contract(USDC, erc20, owner).transfer(solver.address, topUp, { gasPrice })).hash,
                "fund solver USDC",
            );
        }
    }
    if ((await provider.getBalance(solver.address)) < FILL_SOLVER_ETH) {
        await wait(
            provider,
            (await owner.sendTransaction({ to: solver.address, value: FILL_SOLVER_ETH, gasPrice })).hash,
            "fund solver ETH",
        );
    }

    // ── solver capitalises the escrow bond ───────────────────────────────
    const solverUsdc = new ethers.Contract(USDC, erc20, solver);
    await wait(provider, (await solverUsdc.approve(ROUTER, ethers.MaxUint256, { gasPrice })).hash, "solver approve USDC->ROUTER");
    if ((await router.erc20BorrowEscrow(solver.address, USDC)) < BORROW) {
        await wait(
            provider,
            (await new ethers.Contract(ROUTER, routerAbi, solver).depositBorrowEscrow(USDC, BORROW, { gasPrice })).hash,
            "solver depositBorrowEscrow",
        );
    }
    console.log("escrow", (await router.erc20BorrowEscrow(solver.address, USDC)).toString());

    // ── trader signs the canonical CoW order ─────────────────────────────
    const appData = await settlement.leverageCommitment(LEVERAGE);
    const validTo = Math.floor(Date.now() / 1000) + 1800;
    const order = {
        sellToken: USDC,
        buyToken: NATIVE,
        receiver: ethers.ZeroAddress,
        sellAmount: MARGIN,
        buyAmount: 1n,
        validTo,
        appData,
        feeAmount: 0n,
        kind: "sell",
        partiallyFillable: false,
        sellTokenBalance: "erc20",
        buyTokenBalance: "erc20",
    };
    const domain = { name: "Gnosis Protocol", version: "v2", chainId: 130, verifyingContract: GPV2 };
    const types = {
        Order: [
            { name: "sellToken", type: "address" },
            { name: "buyToken", type: "address" },
            { name: "receiver", type: "address" },
            { name: "sellAmount", type: "uint256" },
            { name: "buyAmount", type: "uint256" },
            { name: "validTo", type: "uint32" },
            { name: "appData", type: "bytes32" },
            { name: "feeAmount", type: "uint256" },
            { name: "kind", type: "string" },
            { name: "partiallyFillable", type: "bool" },
            { name: "sellTokenBalance", type: "string" },
            { name: "buyTokenBalance", type: "string" },
        ],
    };
    const signature = await trader.signTypedData(domain, { Order: types.Order }, order);
    const orderForContract = {
        ...order,
        kind: KIND_SELL,
        sellTokenBalance: BALANCE_ERC20,
        buyTokenBalance: BALANCE_ERC20,
    };
    const digestLocal = ethers.TypedDataEncoder.hash(domain, { Order: types.Order }, order);
    const digest = await settlement.hashOrder(orderForContract);
    if (digest !== digestLocal) throw new Error("digest mismatch local vs contract");
    console.log("order digest", digest, "sig", signature.slice(0, 18), "…");

    // ── solver fills the order into a leveraged LONG for the trader ──────
    const fillParams = [LEVERAGE, solver.address, HOOK_KEY, S_KEY];
    const orderTuple = [
        USDC, NATIVE, ethers.ZeroAddress, MARGIN, 1n, validTo, appData, 0n,
        KIND_SELL, false, BALANCE_ERC20, BALANCE_ERC20,
    ];
    await wait(
        provider,
        (
            await new ethers.Contract(SETTLEMENT, art.abi, solver).fillOrder(
                orderTuple, 0, signature, fillParams, { gasPrice },
            )
        ).hash,
        "CoW fillOrder (OPEN LONG)",
    );

    const hookId = hookIdOf(HOOK_KEY);
    const hook = new ethers.Contract(HOOK, hookAbi, provider);
    const pos = await hook.positions(hookId, trader.address);
    console.log(
        "position trader", pos[0], "collateral", pos[1].toString(),
        "borrow", pos[2].toString(), "lev", pos[3], "long", pos[4],
    );
    if (pos[0] === ethers.ZeroAddress || pos[1] === 0n) {
        throw new Error("OPEN did not create a position");
    }

    // ── trader closes the position ───────────────────────────────────────
    const traderRouter = new ethers.Contract(ROUTER, routerAbi, trader);
    await wait(
        provider,
        (await traderRouter.closePosition(HOOK, HOOK_KEY, trader.address, solver.address, 0, { gasPrice })).hash,
        "closePosition",
    );

    const after = await hook.positions(hookId, trader.address);
    console.log("after close trader", after[0], "collateral", after[1].toString(), "liq", after[8].toString());
    console.log(
        "final trader USDC",
        (await usdc.balanceOf(trader.address)).toString(),
        "solver USDC",
        (await usdc.balanceOf(solver.address)).toString(),
        "solver ETH",
        (await provider.getBalance(solver.address)).toString(),
    );
    console.log("CYCLE COMPLETE");
})().catch((e) => {
    console.error("FAILED:", e.shortMessage || e.message);
    console.error(e.stack);
    process.exit(1);
});
