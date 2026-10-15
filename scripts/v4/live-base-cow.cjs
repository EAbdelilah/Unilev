require("dotenv").config();
const fs = require("fs");
const { ethers } = require("ethers");

// ── Base (chain 8453) external CoW-solver cycle ──────────────────────────────
// Opens then closes a leveraged WETH/USDC LONG margin position by having a
// solver fill a canonical CoW order through EswapCoWSettlement.fillOrder.
//
// Defaults target the local Base fork (127.0.0.1:8546). Override with env:
//   BASE_RPC_URL            RPC endpoint (default http://127.0.0.1:8546)
//   V4_COW_SETTLEMENT_ADDRESS  settlement (defaults to the fork deploy below)
//   FORK=0                  disable fork-only USDC minting / ETH top-up
const RPC = process.env.BASE_RPC_URL || "http://127.0.0.1:8546";
const CHAIN_ID = 8453;
const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"; // Base USDC (lowercase for ethers)
const WETH = "0x4200000000000000000000000000000000000006";
const HOOK = "0x7b38f16a40683457fa46ecc819103613f47c50c8";
const ROUTER = "0xabdd8e37082d232c331b109bc9ca3c62a992f10f";
const SETTLEMENT = (process.env.V4_COW_SETTLEMENT_ADDRESS || "0xdc453856fc89135d3bece24a87d407168c40d6bb").toLowerCase();
const GPV2 = "0x9008d19f58aabd9ed0d60971565aa8510560ab41";
const IS_FORK = process.env.FORK !== "0";

const HOOK_KEY = [WETH, USDC, 3000, 60, HOOK];
const S_KEY = [WETH, USDC, 500, 10, ethers.ZeroAddress];

const LEVERAGE = 2;
const MARGIN = 20000n; // 0.02 USDC
const BORROW = MARGIN * BigInt(LEVERAGE - 1);
const KIND_SELL = ethers.keccak256(ethers.toUtf8Bytes("sell"));
const BALANCE_ERC20 = ethers.keccak256(ethers.toUtf8Bytes("erc20"));
const FILL_SOLVER_ETH = 2000000000000000n; // 0.002 ETH gas for the fill
const GAS = { gasPrice: 100000000n }; // 0.1 gwei (Base base fee ~0.005-0.011 gwei)

const routerAbi = [
    "function closePosition(address,tuple(address,address,uint24,int24,address),address,address,uint256)",
    "function depositBorrowEscrow(address,uint256)",
    "function erc20BorrowEscrow(address,address) view returns (uint256)",
    "function registeredSolvers(address) view returns (bool)",
];
const erc20 = [
    "function balanceOf(address) view returns (uint256)",
    "function allowance(address,address) view returns (uint256)",
    "function approve(address,uint256) returns (bool)",
    "function transfer(address,uint256) returns (bool)",
];
const usdcAdminAbi = [
    "function masterMinter() view returns (address)",
    "function configureMinter(address,uint256)",
    "function mint(address,uint256)",
];
const hookAbi = [
    "function positions(bytes32,address) view returns (address,uint256,uint256,uint8,bool,uint160,int24,int24,uint128)",
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function wait(p, hash, label) {
    for (let i = 0; i < 120; i++) {
        await sleep(2000);
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
    const provider = new ethers.JsonRpcProvider(RPC);
    const owner = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
    const trader = new ethers.Wallet(process.env.TINY_TRADER_PK, provider);

    // Solver key: SOLVER_PK env, else a persisted key at SOLVER_FILE (generated
    // on first run so the same solver address is reused for the live run).
    const SOLVER_FILE = process.env.SOLVER_FILE || "C:\\Users\\faar_\\AppData\\Local\\Temp\\opencode\\base-cow-solver.json";
    let solverPk = process.env.SOLVER_PK;
    if (!solverPk && fs.existsSync(SOLVER_FILE)) {
        solverPk = JSON.parse(fs.readFileSync(SOLVER_FILE, "utf8")).privateKey;
    }
    if (!solverPk) {
        const w = ethers.Wallet.createRandom();
        solverPk = w.privateKey;
        fs.writeFileSync(SOLVER_FILE, JSON.stringify({ address: w.address, privateKey: w.privateKey }, null, 2));
        console.log("generated solver key ->", SOLVER_FILE, w.address);
    }
    const solver = new ethers.Wallet(solverPk, provider);

    console.log("chainId", (await provider.getNetwork()).chainId);
    console.log("owner ", owner.address);
    console.log("trader", trader.address);
    console.log("solver", solver.address);
    console.log("settlement", SETTLEMENT, "router", ROUTER, "hook", HOOK);

    const usdc = new ethers.Contract(USDC, erc20, provider);
    const usdcAdmin = new ethers.Contract(USDC, usdcAdminAbi, provider);
    const router = new ethers.Contract(ROUTER, routerAbi, provider);
    const art = require("../../out/EswapCoWSettlement.sol/EswapCoWSettlement.json");
    const settlement = new ethers.Contract(SETTLEMENT, art.abi, provider);

    if (IS_FORK) {
        // Fund native ETH gas FIRST (so the solver can pay for the mint tx),
        // then USDC (margin + borrow escrow) via Circle masterMinter
        // impersonation.
        for (const w of [solver.address, trader.address]) {
            if ((await provider.getBalance(w)) < FILL_SOLVER_ETH) {
                await provider.send("anvil_setBalance", [
                    w,
                    "0x" + ethers.parseEther("10").toString(16),
                ]);
                console.log("  [FORK] anvil_setBalance", w, "-> 10 ETH");
            }
        }
        const want = MARGIN + BORROW + 1000000n;
        if ((await usdc.balanceOf(solver.address)) < want) {
            const master = await usdcAdmin.masterMinter();
            console.log("  [FORK] USDC masterMinter =", master);
            await provider.send("anvil_impersonateAccount", [master]);
            await provider.send("anvil_setBalance", [master, "0xde0b6b3a7640000"]);
            const data = usdcAdmin.interface.encodeFunctionData("configureMinter", [
                solver.address,
                ethers.MaxUint256,
            ]);
            const cmHash = await provider.send("eth_sendTransaction", [{ from: master, to: USDC, data }]);
            await wait(provider, cmHash, "USDC.configureMinter(solver) (fork)");
            await provider.send("anvil_stopImpersonatingAccount", [master]);
            await wait(
                provider,
                (
                    await new ethers.Contract(USDC, usdcAdminAbi, solver).mint(
                        solver.address,
                        want,
                        GAS,
                    )
                ).hash,
                "USDC.mint -> solver (fork)",
            );
        }
    }

    console.log(
        "solver USDC", (await usdc.balanceOf(solver.address)).toString(),
        "ETH", (await provider.getBalance(solver.address)).toString(),
    );

    // ── solver capitalises the escrow bond + approves the router ─────────
    const solverUsdc = new ethers.Contract(USDC, erc20, solver);
    if ((await usdc.allowance(solver.address, ROUTER)) < BORROW) {
        await wait(provider, (await solverUsdc.approve(ROUTER, ethers.MaxUint256, GAS)).hash, "solver approve USDC->ROUTER");
    } else {
        console.log("solver USDC->ROUTER already approved (skip ~36k gas)");
    }
    if ((await router.erc20BorrowEscrow(solver.address, USDC)) < BORROW) {
        await wait(
            provider,
            (await new ethers.Contract(ROUTER, routerAbi, solver).depositBorrowEscrow(USDC, BORROW, GAS)).hash,
            "solver depositBorrowEscrow",
        );
    }
    console.log("escrow", (await router.erc20BorrowEscrow(solver.address, USDC)).toString());

    // ── trader signs the canonical CoW order (sell USDC -> buy WETH) ─────
    const appData = await settlement.leverageCommitment(LEVERAGE);
    const validTo = Math.floor(Date.now() / 1000) + 1800;
    const order = {
        sellToken: USDC,
        buyToken: WETH,
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
    const domain = { name: "Gnosis Protocol", version: "v2", chainId: CHAIN_ID, verifyingContract: GPV2 };
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
        USDC, WETH, ethers.ZeroAddress, MARGIN, 1n, validTo, appData, 0n,
        KIND_SELL, false, BALANCE_ERC20, BALANCE_ERC20,
    ];
    await wait(
        provider,
        (
            await new ethers.Contract(SETTLEMENT, art.abi, solver).fillOrder(
                orderTuple, 0, signature, fillParams, GAS,
            )
        ).hash,
        "CoW fillOrder (OPEN LONG WETH)",
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
        (await traderRouter.closePosition(HOOK, HOOK_KEY, trader.address, solver.address, 0, GAS)).hash,
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
